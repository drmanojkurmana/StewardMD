// functions/_connect/abdm/ingress.js — ABDM HIU inbound webhook handler (Stage-4 Task-4; R6/R2/R8/R17).
// The ONE ingress for gateway/HIP callbacks. It carries NO StewardMD actor (ABDM-authenticated): identity is
// the verified ABDM body-signature + the correlation row our ids match — the TENANT IS ALWAYS the row's,
// never the body, never a header (a header is only a cross-check). Strict fail-closed order:
//   (1) verify body-signature → (2) replay-defend (freshness + REQUEST-ID nonce) → (3) correlate → (4) route.
// The invariant that matters: a junk/unknown push NEVER touches R2 (correlate precedes buffer), consent
// transitions stay monotonic, and the ingress REUSES the Stage-2/3 primitives — it reinvents none of them.
import { flagOn, jsonResponse } from "../testkit.js";
import { verifyJws, getPinnedJwks } from "./jws.js";
import {
  getConsentReq, getTxnByTransactionId,
  updateConsentStatus, attachTransactionId, advanceStatus, claimAck,
  bufferEntry,
} from "./state.js";
import { linkConsentId, getConsentReqByConsentId } from "./consent.js"; // one-row reconciliation join (state.js is frozen this stage)

// Pinned inbound algs (asymmetric-only; jws.js re-intersects with its own allow-list, so HS*/none can never
// survive even if this widened). // VERIFY which one ABDM actually signs with (research WAF-blocked).
const INGRESS_ALGS = Object.freeze(["RS256", "ES256"]);
const FRESHNESS_MS = 5 * 60 * 1000;         // TIMESTAMP freshness window (R6). // VERIFY ABDM's real skew budget.
const NONCE_PREFIX = "connect:abdm:nonce:"; // KV, NON-PHI (R16): the REQUEST-ID nonce only — never PHI.
const NONCE_TTL_SEC = 15 * 60;              // >= freshness window, so a replay is caught by nonce OR freshness.

// ADR-2H inbound field seam — the data-push entry shape (// VERIFY vs the ABDM HIP transfer payload). Kept
// local so a rename lands in exactly one place, mirroring hiu.js#CONSENT_FIELDS / gateway.js#FIELDS.
const PUSH_FIELDS = Object.freeze({
  entries: "entries",
  careContextRef: "careContextReference",   // HMAC'd inside bufferEntry before any key/log/dedupe (R14)
  content: "content",                       // Fidelius ciphertext (base64) — buffered AS-IS, never plaintext
  checksum: "checksum",
});

const hdr = (request, name) =>
  (request && request.headers && typeof request.headers.get === "function") ? request.headers.get(name) : null;

const reject = (status, code) => jsonResponse({ error: code }, { status }); // sanitized; never echoes body/sig/PHI

// ADR-2H // VERIFY: ABDM signs the webhook body as a compact JWS carried AS the POST body. If the live scheme
// turns out to be a detached signature header instead, swap the source here (this is the single seam).
const extractSignedJws = (rawBody) => (typeof rawBody === "string" ? rawBody.trim() : "") || null;

// Header→tenant CROSS-CHECK only. In a multi-tenant HIU each tenant registers its OWN HIU-id, so X-HIU-ID
// identifies the tenant (map via config in prod; identity here — walking skeleton). If present it MUST equal
// the correlation row's tenant_id; the authoritative tenant is ALWAYS the row, never this header.
const tenantClaim = (request) => hdr(request, "X-HIU-ID") || null;

function fresh(tsHeader, nowFn) {
  const t = Date.parse(tsHeader);
  if (Number.isNaN(t)) return false;              // missing/unparseable TIMESTAMP → not fresh (fail-closed)
  const nowMs = Date.parse(typeof nowFn === "function" ? nowFn() : nowFn);
  if (Number.isNaN(nowMs)) return false;
  return Math.abs(nowMs - t) <= FRESHNESS_MS;
}

// Correlate our ids → the in-scope row + AUTHORITATIVE tenant. Transfer callbacks carry only a transaction_id
// (→ txn); request callbacks carry a request_id (→ consent_req). Prefer the txn (an on-request carries both,
// but its transaction_id is not yet attached, so it correctly falls through to the consent_req). Unknown id ⇒
// null (the caller 403s BEFORE any R2 write). requestId is CARRIED FORWARD from the txn so the request_id-keyed
// FSM (advanceStatus) can key off it even for a transfer event that shipped only a transaction_id.
async function correlate(db, ev) {
  const tid = ev.transactionId, rid = ev.requestId, cid = ev.consentId;
  if (tid != null) {
    const txn = await getTxnByTransactionId(db, tid);
    if (txn) return { requestId: txn.request_id, transactionId: tid, tenantId: txn.tenant_id };
  }
  if (rid != null) {
    const cr = await getConsentReq(db, rid);
    if (cr) return { requestId: rid, transactionId: tid ?? null, tenantId: cr.tenant_id };
  }
  // Durable-join fallback (R6/R3): once the GRANT notify LINKED consent_id onto the lifecycle row, a later
  // notify (REVOKE/EXPIRE) that echoes ONLY the consentId still correlates to that ONE row — removing the
  // dependence on ABDM re-echoing our internal requestId on every callback. // VERIFY the notify's real ids.
  if (cid != null) {
    const cr = await getConsentReqByConsentId(db, cid);
    if (cr) return { requestId: cr.request_id, transactionId: tid ?? null, tenantId: cr.tenant_id };
  }
  return null;
}

// handleIngress(env, deps, request) -> Response. deps = { db, r2, kv, secrets, jwks, ingestEvent, now }
// (+ optional fetch/verifyJws injection for the composition root / tests).
export async function handleIngress(env, deps, request) {
  if (!flagOn(env)) return reject(404, "not_found");        // flag OFF → do not leak existence

  // (1) VERIFY body-signature (fail-closed). An unconfigured/unavailable JWKS is UNVERIFIABLE → 401, not 500.
  let ev;
  try {
    const token = extractSignedJws(await request.text());
    const jwks = deps.jwks || await getPinnedJwks(env, { fetch: deps.fetch, kv: deps.kv });
    const verify = deps.verifyJws || verifyJws;
    const vr = token ? await verify(token, { jwks, allowedAlgs: INGRESS_ALGS }) : null;
    if (!vr || !vr.ok) return reject(401, "bad_signature");
    ev = (vr.payload && typeof vr.payload === "object") ? vr.payload : {};
  } catch {
    return reject(401, "bad_signature");                    // never echo the raw body/signature
  }

  try {
    // (2) REPLAY DEFENSE (R6): a stale TIMESTAMP → reject; a seen REQUEST-ID → idempotent 202 no-op.
    if (!fresh(hdr(request, "TIMESTAMP"), deps.now)) return reject(401, "stale_timestamp");
    const reqId = hdr(request, "REQUEST-ID");
    const nonceKey = reqId ? NONCE_PREFIX + reqId : null;
    if (nonceKey && deps.kv && (await deps.kv.get(nonceKey))) {
      return jsonResponse({ ok: true, deduped: true }, { status: 202 });  // replay → no state change
    }

    // (3) CORRELATE BEFORE BUFFER (R6): unknown id, or a header tenant-claim that disagrees with the row → 403.
    const corr = await correlate(deps.db, ev);
    if (!corr) return reject(403, "unknown_correlation");   // NO R2 write reached
    const claim = tenantClaim(request);
    if (claim != null && String(claim) !== String(corr.tenantId)) return reject(403, "tenant_mismatch");

    // (4) ROUTE (R9). CARRY-FORWARD the resolved request_id onto the event (transfer events lack it, but the
    //     FSM is request_id-keyed). boundDeps PRE-BIND db so ingestEvent stays db-agnostic (it calls the state
    //     fns with NO db). data-push buffers each already-encrypted entry HERE, ONLY after correlation.
    const now = deps.now;
    const rawEvent = { ...ev, requestId: corr.requestId };
    const boundDeps = {
      linkConsentId: (rid, cid, n) => linkConsentId(deps.db, rid, cid, n),
      updateConsentStatus: (rid, st, n) => updateConsentStatus(deps.db, rid, st, n),
      attachTransactionId: (rid, tid, n) => attachTransactionId(deps.db, rid, tid, n),
      advanceStatus: (rid, f, t, n) => advanceStatus(deps.db, rid, f, t, n),
      claimAck: (tid, n) => claimAck(deps.db, tid, n),
      now,
    };
    if (ev.type === "data-push") {
      const nowIso = typeof now === "function" ? now() : now;
      const entries = Array.isArray(ev[PUSH_FIELDS.entries]) ? ev[PUSH_FIELDS.entries] : [];
      for (const e of entries) {
        await bufferEntry(deps.r2, env, corr.transactionId,
          e[PUSH_FIELDS.careContextRef], e[PUSH_FIELDS.content], e[PUSH_FIELDS.checksum], nowIso);
      }
    }
    await deps.ingestEvent(env, boundDeps, rawEvent);

    // Record the REQUEST-ID nonce only AFTER a clean run, so a mid-flight failure is retried, not swallowed.
    if (nonceKey && deps.kv) await deps.kv.put(nonceKey, "1", { expirationTtl: NONCE_TTL_SEC });
    return jsonResponse({ ok: true }, { status: 202 });
  } catch {
    return reject(500, "ingress_error");                    // genuine storage/route failure → fail-closed
  }
}
