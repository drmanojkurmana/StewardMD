// functions/_connect/abdm/consent.js — HIU consent-artifact JWS verify + per-request re-validation (Stage-4 Task-5).
// The consent-binding gate (spec §4, R3/R4). Dependency-injected; Node+Workers parity; no Date.now/global reads.
//
// INVARIANTS
//   R3 — NO persisted consent without a verified JWS. verifyConsentArtifact writes a GRANTED row ONLY after
//        getPinnedJwks (fail-closed: THROWS if the pinned JWKS is unavailable) AND verifyJws both succeed AND
//        the SIGNED payload's status is GRANTED. There is no "skip verification" path: a JWKS-unavailable /
//        bad-signature / non-GRANTED / malformed artifact persists nothing and audits `consent.denied`.
//   R4 — `mode:live` is PER-REQUEST-ARTIFACT-BOUND. revalidateForRequest re-runs the normative checklist for
//        EVERY data request and binds it to a SPECIFIC verified, in-scope, unexpired, still-GRANTED artifact
//        (a tenant flag is necessary-not-sufficient). Any checklist miss => fail-closed {ok:false, reason}.
//
// TRUST BOUNDARY (adversary-proof, deliberate): the ONLY field trusted from the untrusted `artifact` envelope
// is `artifact.signature` (the JWS). EVERY consent/scope field — consentId, status, careContexts, hiTypes,
// purpose, permission, expiry — is read from the VERIFIED JWS PAYLOAD, never the surrounding envelope. This
// makes a "signed-object substitution" (wrap a validly-signed detail in an envelope claiming wider scope)
// STRUCTURALLY impossible: the scope you get is exactly the scope that was signed.
//
// BOUNDARY SEMANTICS (deliberate, documented — reviewers will probe): every validity window is a CLOSED
// interval, INCLUSIVE on BOTH ends. A request is honored iff  from <= now <= to  AND  now <= expiry. We reject
// only STRICTLY-outside instants, so a request landing exactly on `from`, `to`, or `expiry` is still honored
// (avoids spurious rejection at the exact boundary instant; ABDM's permission.dateRange is a closed interval).
// `expiry` is REQUIRED: a missing/unparseable expiry is fail-closed (we NEVER read "no expiry" as "never expires").
import { verifyJws as realVerifyJws, getPinnedJwks } from "./jws.js";
import { updateConsentStatus, ConnectStateError } from "./state.js"; // REUSE the Stage-3 monotonic guard (R6); do not duplicate the rank logic.

// ── fetchConsentArtifact ────────────────────────────────────────────────────────────────────────────────
// On a GRANTED consent-notify, fire the artifact fetch (fire-and-forget: the gateway 202-accepts and the
// artifact is delivered LATER on the on-fetch webhook, which Task-4 routes to verifyConsentArtifact). We do
// NOT persist GRANTED here — that would violate R3 (no persisted consent before its JWS is verified).
export async function fetchConsentArtifact(env, deps, { requestId, consentId } = {}) {
  const { gateway } = deps;
  if (!consentId) throw new Error("fetchConsentArtifact requires a consentId");   // fail-closed: never fire blind
  await gateway.post("consentFetch", { consentId });   // 202-accept; gateway.post throws on a non-2xx/202
  // void — the verified artifact arrives asynchronously on the on-fetch webhook.
}

// ── verifyConsentArtifact ───────────────────────────────────────────────────────────────────────────────
// Verify artifact.signature (JWS) against the PINNED JWKS, then persist the signed GRANTED consent. Returns
// { ok, consent }. deps.verifyJws is an optional test seam; production uses the real pinned verifier.
export async function verifyConsentArtifact(env, deps, artifact) {
  const { db, kv, fetch, audit } = deps;
  const verifyJws = deps.verifyJws || realVerifyJws;
  const now = typeof deps.now === "function" ? deps.now() : deps.now;
  const deny = async (reason) => { await auditDenied(audit, reason, now); return { ok: false, reason, consent: null }; };
  try {
    if (!artifact || typeof artifact !== "object") return deny("no-artifact");
    const sig = artifact.signature;
    if (typeof sig !== "string" || !sig) return deny("no-signature");

    // Fail-closed: an unavailable pinned JWKS THROWS here — verifyJws is never reached (never a false "valid").
    let jwks;
    try { jwks = await getPinnedJwks(env, { fetch, kv }); }
    catch { return deny("jwks-unavailable"); }

    // Default asymmetric-only allow-list (RS256/ES256) — alg:none/HMAC confusion is structurally impossible.
    const v = await verifyJws(sig, { jwks });
    if (!v || !v.ok) return deny("bad-signature");

    // Parse scope from the VERIFIED payload ONLY (trust boundary above); the envelope is never consulted.
    const consent = parseConsent(v.payload);
    if (!consent || !consent.consentId) return deny("no-consentId");
    if (consent.status !== "GRANTED") return deny("not-granted");   // only a signed GRANT is persisted

    // Persist the FULL signed scope onto the ONE reconciled lifecycle row (resolved via consent_id) through
    // the MONOTONIC guard. Two refusal shapes, both writing NOTHING:
    //  - "no-linked-row": a webhook REORDER (artifact before the notify's link) — FAIL CLOSED (ok:false), so the
    //    caller refuses/retries; nothing is bound and no self-keyed orphan row is created.
    //  - "monotonic": a replayed GRANTED arriving after a terminal REVOKED/EXPIRED row — a BENIGN no-op: the
    //    signature verified but the terminal state already wins, so we return ok:true, persisted:false.
    // consent.verified is audited ONLY on an actual persist.
    const persisted = await persistGranted(db, {
      consentId: consent.consentId, careContexts: consent.careContexts, hiTypes: consent.hiTypes,
      purpose: consent.purpose, dateRange: consent.permission.dateRange,
      expiresAt: consent.expiry ?? consent.permission.dataEraseAt ?? null,
      // FIX-2 (Stage-6 T2): the patient-level ERASURE deadline, written to its OWN `data_erase_at` column — kept
      // DISTINCT from consent-VALIDITY `expiresAt` (dataEraseAt is usually a later, separate bound). Without this
      // writer `data_erase_at` was always NULL, so state.js#sweep's dataEraseAt trigger AND care-context erasure
      // were dead in prod (only the REVOKE path fired). // VERIFY (owner): whether ABDM's dataEraseAt equals the
      // artifact expiry or is a separate (usually later) bound — see the schema pin on this column.
      dataEraseAt: consent.permission.dataEraseAt ?? null, now,
    });
    if (!persisted.ok && persisted.reason === "no-linked-row") return deny("no-linked-row");
    if (persisted.ok && audit) await audit({
      action: "consent.verified", outcome: "ok", ts: now,
      resourceCounts: { hiTypes: consent.hiTypes.length, careContexts: consent.careContexts.length },
      scope: { consentId: consent.consentId },   // consentId is a non-PHI artifact id (R16)
    });
    return { ok: true, consent, persisted: persisted.ok };
  } catch (e) {
    return deny("exception:" + (e && e.message));   // absolute fail-closed backstop — NEVER "valid"
  }
}

// PHI-free-by-construction denial audit (metadata only: action/outcome/ts + a stable reason in the scope blob).
async function auditDenied(audit, reason, now) {
  if (audit) await audit({ action: "consent.denied", outcome: "denied", ts: now, scope: { reason } });
}

// ── reconciliation helpers (the ONE-row join) ───────────────────────────────────────────────────────────
// Resolve the lifecycle row by its durable join key. `consent_id` is NULL until the GRANT notify links it,
// so a null lookup value never matches. Kept here (not state.js) because state.js is frozen this stage.
export async function getConsentReqByConsentId(db, consentId) {
  if (consentId == null) return null;
  return (await db.prepare("SELECT * FROM connect_abdm_consent_req WHERE consent_id=?").bind(consentId).first()) || null;
}

// LINK the gateway consentId onto our lifecycle row (keyed by our internal requestId). Called from the GRANT
// consent-notify (engine routing): it carries BOTH ids, so this is where the two halves converge onto ONE row.
// // VERIFY: assumes ABDM's notify echoes our correlation requestId AND the consent artefact id (field mapping
// unconfirmed — research WAF-blocked). Idempotent: re-linking the same consentId is a no-op-equivalent write.
export async function linkConsentId(db, requestId, consentId, now) {
  if (requestId == null || consentId == null) return { ok: false };
  const res = await db.prepare("UPDATE connect_abdm_consent_req SET consent_id=?,updated_at=? WHERE request_id=?")
    .bind(consentId, now, requestId).run();
  if (!res || res.success === false) throw new ConnectStateError("linkConsentId update failed");
  return { ok: (res.meta?.changes || 0) > 0 };
}

// Persist the verified SIGNED grant onto the ONE reconciled lifecycle row (resolved via consent_id — the join
// the GRANT notify linked). Status goes through the Stage-3 MONOTONIC guard (updateConsentStatus), NEVER a raw
// `status='GRANTED'`: a replayed GRANTED arriving after a terminal REVOKED/EXPIRED row is refused and the row
// stays terminal. The full SIGNED scope (careContexts/hiTypes/purpose/dateRange/expiry) is persisted so the
// data-request can revalidate off a DB reload. Fail-closed: every write checks res.success (like state.insertRow).
// Returns { ok, reason? } — ok:false = a refusal that wrote NOTHING: reason "monotonic" (a terminal row wins) or
// "no-linked-row" (see below); ok:true = the grant was applied to the linked row.
async function persistGranted(db, { consentId, careContexts, hiTypes, purpose, dateRange, expiresAt, dataEraseAt, now }) {
  const enc = (v) => (v == null ? null : JSON.stringify(v));
  const cc = enc(careContexts), hi = enc(hiTypes), pu = enc(purpose), dr = enc(dateRange);
  const row = await getConsentReqByConsentId(db, consentId);
  // FAIL CLOSED on NO linked row. The GRANT consent-notify's linkConsentId is the SOLE path that creates the
  // consent_id join, so a verified artifact with no linked row means a webhook REORDER (the artifact was
  // processed before the notify's link committed). We do NOT self-key an INSERT here: a self-keyed
  // request_id=consentId row could go stale-GRANTED while a later REVOKE lands on the internal-requestId row,
  // reopening the two-row since-REVOKED fail-open. Refusing keeps it ONE row — the data-request stays refused
  // until the notify links + the artifact is re-verified (the fetch is triggered BY the notify, so in the real
  // flow the link always commits first and this branch is unreachable). // VERIFY the notify→fetch ordering.
  if (!row) return { ok: false, reason: "no-linked-row" };
  // MONOTONIC status FIRST (reuse state.js): a terminal/lower-rank row refuses here → we write NO scope, so a
  // since-REVOKED row can never be un-revoked or have its scope re-widened by a replayed GRANTED artifact.
  const guarded = await updateConsentStatus(db, row.request_id, "GRANTED", now);
  if (!guarded.ok) return { ok: false, reason: "monotonic", status: guarded.status };
  // FIX-2: persist `data_erase_at` alongside the scope, DISTINCT from `expires_at`. state.js#sweep reads this
  // column to fire the patient-level dataEraseAt erasure (derived state + care-contexts); a NULL here (no dataEraseAt
  // in the signed permission) leaves that trigger dormant, exactly as the REVOKE-only path behaved before.
  const res = await db.prepare(
    "UPDATE connect_abdm_consent_req SET care_contexts=?,hi_types=?,purpose=?,date_range=?,expires_at=?,data_erase_at=?,updated_at=? WHERE request_id=?")
    .bind(cc, hi, pu, dr, expiresAt, dataEraseAt ?? null, now, row.request_id).run();
  if (!res || res.success === false) throw new ConnectStateError("persistGranted scope update failed");
  return { ok: true, status: "GRANTED" };
}

// ── revalidateForRequest — the normative REQUEST-TIME checklist (R4) ─────────────────────────────────────
// Re-run per data-request. ALL must hold or {ok:false, reason}. Pure (no db/clock reads); `now` is an ISO string.
export function revalidateForRequest(consent, req, now) {
  if (!consent || typeof consent !== "object") return miss("no-consent");
  if (!req || typeof req !== "object") return miss("no-request");

  // 1. Still GRANTED — re-checked EVERY request, so a since-REVOKED/EXPIRED consent fails here even if it
  //    verified cleanly at fetch time. (A tenant live-flag is necessary-not-sufficient; THIS is the binding.)
  if (consent.status !== "GRANTED") return miss("not-granted");

  // 2. `now` within permission.dateRange AND within expiry — closed intervals, INCLUSIVE both ends (see header).
  const t = Date.parse(now);
  if (Number.isNaN(t)) return miss("bad-now");
  const dr = (consent.permission && consent.permission.dateRange) || {};
  const from = Date.parse(dr.from), to = Date.parse(dr.to);
  if (Number.isNaN(from) || Number.isNaN(to)) return miss("bad-daterange");
  if (t < from || t > to) return miss("date-range");
  const expiry = consent.expiry == null ? NaN : Date.parse(consent.expiry);
  if (Number.isNaN(expiry)) return miss("bad-expiry");   // expiry REQUIRED — fail-closed, never "never expires"
  if (t > expiry) return miss("expired");

  // 3. req.careContexts ⊆ consent.careContexts (a real request names >=1; an empty/absent set binds nothing).
  //    BOTH sides must be arrays: a non-array granted scope is a corrupt/absent grant — fail closed, NEVER
  //    throw on `.map` (Adversary-A: a hostile `consent.careContexts` string must not crash the gate).
  if (!Array.isArray(req.careContexts) || req.careContexts.length === 0) return miss("no-carecontexts");
  if (!Array.isArray(consent.careContexts)) return miss("care-context-scope");
  const grantedCC = new Set(consent.careContexts.map(ccKey));
  for (const c of req.careContexts.map(ccKey)) if (!grantedCC.has(c)) return miss("care-context-scope");

  // 4. req.hiTypes ⊆ consent.hiTypes. Same array guard on the granted side (never `.map` a non-array grant).
  if (!Array.isArray(req.hiTypes) || req.hiTypes.length === 0) return miss("no-hitypes");
  if (!Array.isArray(consent.hiTypes)) return miss("hi-type-scope");
  const grantedHi = new Set(consent.hiTypes.map(String));
  for (const h of req.hiTypes.map(String)) if (!grantedHi.has(h)) return miss("hi-type-scope");

  // 5. req.purpose === consent.purpose (canonical key: code, else text, else raw). purpose is REQUIRED on BOTH
  //    sides and fails CLOSED on null/absent EITHER side (Adversary-A: never let null==null read as a match —
  //    it is the lone R4 field that otherwise fails OPEN; a purpose-present guard pins least-privilege).
  const reqPurpose = purposeKey(req.purpose), grantedPurpose = purposeKey(consent.purpose);
  if (reqPurpose == null || grantedPurpose == null) return miss("purpose");
  if (reqPurpose !== grantedPurpose) return miss("purpose");

  return { ok: true };
}
function miss(reason) { return { ok: false, reason }; }

// ── field parsing / normalization ────────────────────────────────────────────────────────────────────────
// Parse the SIGNED consent detail from a verified JWS payload. ABDM signs the `consentDetail`; accept either
// a payload that IS the detail or one that wraps it under `consentDetail`. Status may sit at the payload root
// or inside the detail. Everything here comes from the verified payload only — never the artifact envelope.
function parseConsent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const d = (payload.consentDetail && typeof payload.consentDetail === "object") ? payload.consentDetail : payload;
  const perm = (d.permission && typeof d.permission === "object") ? d.permission : {};
  const dateRange = (perm.dateRange && typeof perm.dateRange === "object") ? perm.dateRange : {};
  return {
    consentId: d.consentId ?? d.id ?? null,
    status: payload.status ?? d.status ?? null,
    careContexts: Array.isArray(d.careContexts) ? d.careContexts.map(ccKey).filter((x) => x != null) : [],
    hiTypes: Array.isArray(d.hiTypes) ? d.hiTypes.map(String) : [],
    purpose: d.purpose ?? null,
    permission: {
      dateRange: { from: dateRange.from ?? null, to: dateRange.to ?? null },
      dataEraseAt: perm.dataEraseAt ?? null,
      frequency: perm.frequency ?? null,
    },
    expiry: d.expiry ?? payload.expiry ?? null,
  };
}

// A careContext may be a raw reference string or an object { careContextReference | reference | id }.
function ccKey(c) {
  if (c == null) return null;
  if (typeof c === "string") return c;
  if (typeof c === "object") return c.careContextReference ?? c.reference ?? c.id ?? null;
  return String(c);
}
// Purpose may be a string or an object { code, text } — compare on a canonical key. EXPORTED (additive) so the
// engine consume tail (meta.consentPurpose stamp) + the use-time assertPurposeBound bind on the SAME key this
// request-time revalidate uses — request-time and use-time purpose-binding must never drift (DPDP §14.2, R15).
export function purposeKey(p) {
  if (p == null) return null;
  if (typeof p === "object") return p.code ?? p.text ?? JSON.stringify(p);
  return String(p);
}
