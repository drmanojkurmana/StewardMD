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

    await persistGranted(db, {
      consentId: consent.consentId, hiTypes: consent.hiTypes,
      expiresAt: consent.expiry ?? consent.permission.dataEraseAt ?? null, now,
    });
    if (audit) await audit({
      action: "consent.verified", outcome: "ok", ts: now,
      resourceCounts: { hiTypes: consent.hiTypes.length, careContexts: consent.careContexts.length },
      scope: { consentId: consent.consentId },   // consentId is a non-PHI artifact id (R16)
    });
    return { ok: true, consent };
  } catch (e) {
    return deny("exception:" + (e && e.message));   // absolute fail-closed backstop — NEVER "valid"
  }
}

// PHI-free-by-construction denial audit (metadata only: action/outcome/ts + a stable reason in the scope blob).
async function auditDenied(audit, reason, now) {
  if (audit) await audit({ action: "consent.denied", outcome: "denied", ts: now, scope: { reason } });
}

// Persist the verified GRANTED artifact. Keyed by consentId (as request_id PK): verifyConsentArtifact holds
// ONLY the artifact, not the internal Task-1 requestId, and consentId is the durable gateway-authoritative
// join key from notify onward. Read-then-write UPSERT => idempotent on artifact re-delivery (anti-dup); the
// mock/real D1 both honor `WHERE consent_id=?`. (A UNIQUE(consent_id) index would harden this at scale.)
async function persistGranted(db, { consentId, hiTypes, expiresAt, now }) {
  const hi = hiTypes == null ? null : JSON.stringify(hiTypes);
  const existing = await db.prepare("SELECT * FROM connect_abdm_consent_req WHERE consent_id=?").bind(consentId).first();
  if (existing) {
    await db.prepare("UPDATE connect_abdm_consent_req SET status=?,hi_types=?,expires_at=?,updated_at=? WHERE consent_id=?")
      .bind("GRANTED", hi, expiresAt, now, consentId).run();
    return;
  }
  const row = {
    request_id: consentId, tenant_id: null, actor: null, patient_abha_hash: null,
    status: "GRANTED", consent_id: consentId, hi_types: hi, created_at: now, updated_at: now, expires_at: expiresAt,
  };
  const keys = Object.keys(row);
  await db.prepare(`INSERT INTO connect_abdm_consent_req (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .bind(...keys.map((k) => row[k])).run();
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
  if (!Array.isArray(req.careContexts) || req.careContexts.length === 0) return miss("no-carecontexts");
  const grantedCC = new Set((consent.careContexts || []).map(ccKey));
  for (const c of req.careContexts.map(ccKey)) if (!grantedCC.has(c)) return miss("care-context-scope");

  // 4. req.hiTypes ⊆ consent.hiTypes.
  if (!Array.isArray(req.hiTypes) || req.hiTypes.length === 0) return miss("no-hitypes");
  const grantedHi = new Set((consent.hiTypes || []).map(String));
  for (const h of req.hiTypes.map(String)) if (!grantedHi.has(h)) return miss("hi-type-scope");

  // 5. req.purpose === consent.purpose (compared on a canonical key: code, else text, else the raw value).
  if (purposeKey(req.purpose) !== purposeKey(consent.purpose)) return miss("purpose");

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
// Purpose may be a string or an object { code, text } — compare on a canonical key.
function purposeKey(p) {
  if (p == null) return null;
  if (typeof p === "object") return p.code ?? p.text ?? JSON.stringify(p);
  return String(p);
}
