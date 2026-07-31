// functions/_connect/abdm/hip.js — ABDM HIP SERVE orchestration (Stage-5 Tasks 4+5; spec §3/§4, R1/R5/R11/R14).
//
// StewardMD as a Health Information PROVIDER: turn a record we ALREADY HOLD (a FollowCare discharge episode)
// into an NDHM-FHIR document, Fidelius-seal it against the requesting HIU's keyMaterial, and push it to the
// HIU's dataPushUrl. This file is the MIRROR/INVERSE of the Stage-4 HIU consume path — it only SEQUENCES the
// already-built Stage-1..5 primitives in the serve direction and adds NO crypto/state of its own (PONYTAIL:
// reuse hip-crypto/serialize/consent/audit/hip-sources; minimal code). PHI is pass-through: the NDHM plaintext
// lives ONLY in a request-scoped variable, is sealed immediately, and is NEVER persisted or logged. The pushed
// body carries ciphertext + the HIP keyMaterial ONLY, never plaintext.
//
// ⛔ R5 CROSS-PATIENT GUARDRAIL (assertServeAllowed): the last line of defence before any seal. It refuses the
// WHOLE transfer (never drop-and-serve-the-rest) on ANY cross-patient / out-of-scope record, so no cross-patient
// bytes ever reach sealEntries. It is DUAL-ADVERSARIAL-reviewed — see the invariants inline.
import { flagOn } from "../testkit.js";
import { sealEntries } from "./hip-crypto.js";                                  // Task 3: ONE fresh keyMaterial per page (call WITHOUT io — prod path)
import { serializeNdhm, validateNdhmDoc } from "../connectors/abdm/serialize.js"; // Task 2: SCCM -> NDHM-FHIR + structural gate
import { revalidateForRequest } from "./consent.js";                            // Stage-4: the request-time R4 checklist (fresh status/date/scope)
import { hmacPseudonym } from "../audit.js";                                    // per-tenant HMAC pseudonym (raw ABHA never stored/logged)

// A cross-patient / out-of-scope over-share was refused (R5). Carries a stable, PHI-free `reason`.
export class OverShareError extends Error {
  constructor(reason) { super("over-share refused: " + reason); this.name = "OverShareError"; this.reason = reason; }
}
// The HIU-supplied dataPushUrl failed the anti-SSRF gate (https + host-allow-list + no-userinfo). PHI-free reason.
export class PushUrlError extends Error {
  constructor(reason) { super("dataPushUrl refused: " + reason); this.name = "PushUrlError"; this.reason = reason; }
}

// HIP requires BOTH the base connect flag AND the separate HIP flag (default OFF). Kept local so hip.js is
// self-contained; Task-7's hip-flags.js exports the same predicate for the ingress edit.
// // VERIFY: the real env-var name for `smd_connect_hip` (defaulted here to CONNECT_HIP_FLAG).
const hipFlagOn = (env) => flagOn(env) && String(env && env.CONNECT_HIP_FLAG) === "1";

// A careContext may be a raw reference string or an object { careContextReference | reference | id } — the SAME
// canonicalization consent.js uses, so membership compares like-for-like against the verified artifact.
function ccKey(c) {
  if (c == null) return null;
  if (typeof c === "string") return c;
  if (typeof c === "object") return c.careContextReference ?? c.reference ?? c.id ?? null;
  return String(c);
}
// Injected clock -> ISO string (never Date.now / the wall clock). Mirrors the Stage-5 source's isoOf.
function isoOf(clock) {
  const d = typeof clock === "function" ? clock() : clock;
  if (d && typeof d.toISOString === "function") return d.toISOString();
  if (typeof d === "number") return new Date(d).toISOString();
  if (typeof d === "string" && d) return d;
  return new Date(0).toISOString();
}
// Constant-time equality for two equal-length hex HMACs (defence-in-depth; both sides are our own 64-char hex).
function ctEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── assertServeAllowed — the R5 cross-patient OVER-SHARE guardrail (Task 5, DUAL-ADVERSARIAL) ───────────────
// Throws OverShareError (audited `hip.denied`, metadata only) on ANY miss; returns void when the WHOLE transfer
// is provably in-scope for ONE patient. Enforces R5 in FULL; a single miss refuses the WHOLE transfer — it never
// drops-and-serves-the-rest. No cross-patient bytes ever reach the seal (this runs BEFORE serialize/seal).
//   (i)   subject bind: HMAC(consent.patientAbha) == patient_abha_hash on EVERY served record;
//   (ii)  each served careContextReference is EXPLICITLY in the freshly-verified artifact's careContexts;
//   (iii) each record's hiType is a subset of consent.hiTypes;
//   (iv)  the consent is bound FRESH via revalidateForRequest (status/dateRange/expiry + scope subset) so a
//         since-REVOKED/EXPIRED/out-of-dateRange grant is refused, NOT the stored registration linkage.
// The freshly-VERIFIED artifact (its JWS checked upstream by consent.js#verifyConsentArtifact at ingest) is
// passed in as `consent`; this guard binds it to THIS request. args = { consent, careContexts, records, tenantId }.
export async function assertServeAllowed(env, deps, { consent, careContexts, records, tenantId } = {}) {
  const nowIso = isoOf(deps && deps.now);
  const deny = async (reason) => {
    if (deps && deps.audit) await deps.audit({
      action: "hip.denied", outcome: "denied", ts: nowIso, tenantId,
      consentId: (consent && consent.consentId) || null,   // a non-PHI artifact id (R16)
      scope: { reason },                                    // stable PHI-free reason; NEVER the ABHA/careContextRef
    });
    throw new OverShareError(reason);
  };

  if (!consent || typeof consent !== "object") return deny("no-consent");
  if (!Array.isArray(records)) return deny("no-records");
  const servedCC = (Array.isArray(careContexts) ? careContexts : []).map(ccKey);
  if (servedCC.length === 0) return deny("no-carecontexts");

  // (iv) FRESH consent bind FIRST — a since-REVOKED/EXPIRED/out-of-dateRange grant fails HERE even if it verified
  //      cleanly at fetch time. revalidateForRequest ALSO subset-checks careContexts/hiTypes/purpose (R4), which
  //      composes with the explicit per-record checks below (defence-in-depth).
  const servedHi = [...new Set(records.map((r) => String(r && r.hiType)))];
  const reval = revalidateForRequest(consent, { careContexts: servedCC, hiTypes: servedHi, purpose: consent.purpose }, nowIso);
  if (!reval.ok) return deny("consent:" + reval.reason);

  // (i) subject bind — compute the consent patient's per-tenant pseudonym ONCE. A missing patientAbha fails
  //     closed (never null==null). hmacPseudonym throws if CONNECT_HMAC_SALT is unavailable (fail-closed).
  if (consent.patientAbha == null) return deny("no-patient");
  const expected = await hmacPseudonym(env, tenantId, consent.patientAbha);

  // The freshly-verified artifact's careContexts as an EXPLICIT allow-set (no wildcard, no registration-implied
  // membership) + the granted hiTypes.
  const artifactCC = new Set((Array.isArray(consent.careContexts) ? consent.careContexts : []).map(ccKey));
  const grantedHi = new Set((Array.isArray(consent.hiTypes) ? consent.hiTypes : []).map(String));

  for (const rec of records) {
    if (!rec || typeof rec !== "object") return deny("bad-record");
    // (i) subject == consent patient — a SINGLE mismatch refuses the WHOLE transfer (no cross-patient leak).
    if (typeof rec.patientAbhaHash !== "string" || rec.patientAbhaHash.length === 0) return deny("record-no-subject");
    if (!ctEqualHex(rec.patientAbhaHash, expected)) return deny("cross-patient");
    // (ii) explicit careContext membership in the fresh artifact.
    const ref = ccKey(rec.careContextRef);
    if (ref == null || !artifactCC.has(ref)) return deny("carecontext-not-in-artifact");
    // (iii) hiType subset of consent.hiTypes.
    if (!grantedHi.has(String(rec.hiType))) return deny("hitype-out-of-scope");
  }
  // Provably one-patient, in-scope, fresh-consent-bound. Void => allowed.
}

// ── dataPushUrl anti-SSRF gate ──────────────────────────────────────────────────────────────────────────────
// The HIU supplies the push target, so it is UNTRUSTED. https ONLY + host allow-list + NO userinfo, all before
// any POST. Fail-closed: an unparseable URL or an empty/unconfigured allow-list refuses ALL.
// // VERIFY (owner): the ABDM-registered HIU push-host allow-list, OR whether the transfer instead routes via the
// trusted CM gateway /health-information/transfer (ADR-2H seam) — in which case the URL is gateway-owned, not HIU.
function parseAllowedHosts(v) {
  if (typeof v !== "string" || !v.trim()) return [];
  return v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function assertPushUrlAllowed(env, rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) throw new PushUrlError("missing");
  let u;
  try { u = new URL(rawUrl); } catch { throw new PushUrlError("unparseable"); }
  if (u.protocol !== "https:") throw new PushUrlError("not-https");
  if (u.username || u.password) throw new PushUrlError("userinfo-present");   // no user@host — a classic SSRF/cred vector
  const host = (u.hostname || "").toLowerCase();
  if (!host) throw new PushUrlError("no-host");
  const allow = parseAllowedHosts(env && env.CONNECT_HIP_PUSH_HOSTS);
  if (allow.length === 0) throw new PushUrlError("allow-list-empty");          // fail-closed: no allow-list => refuse all
  if (!allow.includes(host)) throw new PushUrlError("host-not-allow-listed");
  return u;
}

// Outbound push headers. JSON + no-store (PHI must not be cached). REQUEST-ID/TIMESTAMP mirror the NON-secret
// fields of gateway.js#gatewayHeaders. // VERIFY (ADR-2H): when routed via the CM gateway, add the auth +
// X-HIP-ID headers from gatewayHeaders(); this direct dataPushUrl push is the mock-first seam.
function pushHeaders(nowIso) {
  return {
    "content-type": "application/json",
    "cache-control": "no-store",
    pragma: "no-cache",
    "REQUEST-ID": (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2),
    TIMESTAMP: nowIso,
  };
}

// POST one sealed page to the validated dataPushUrl. The body carries CIPHERTEXT (content+checksum) + the HIP
// keyMaterial + the opaque careContextReference — NEVER plaintext. // VERIFY: the live transfer wire-shape (one
// entry per page keeps it nonce-safe AND Stage-4 consumeTransfer-compatible).
async function pushPage(deps, req, nowIso, page, careContextReference) {
  const body = {
    transactionId: req.transactionId,
    keyMaterial: page.keyMaterial,
    careContextReference,
    entries: [{ content: page.content, checksum: page.checksum, media: "application/fhir+json", status: "final" }],
  };
  let res;
  try { res = await deps.fetch(req.dataPushUrl, { method: "POST", headers: pushHeaders(nowIso), body: JSON.stringify(body) }); }
  catch (e) { throw new Error("dataPush request failed: " + (e && e.message)); }
  if (res.status !== 202 && !res.ok) throw new Error("dataPush HTTP " + res.status);   // non-202/non-2xx => fail-closed
}

// ── serveTransfer — guard -> load -> serialize -> seal -> push (Task 4) ──────────────────────────────────────
// deps = { db, secrets, gateway, fetch, audit, now, source, jwks }; req = { tenantId, consent, careContexts,
// hiuKeyMaterial, dataPushUrl, transactionId }. Returns { pushed:boolean, pages:number, outcome, warnings }.
// Fail-closed, in order: flag-gate -> load every requested record -> R5 GUARD (before any seal) -> anti-SSRF
// URL gate (before any POST) -> per-record serialize/validate (skip+warn on failure => PARTIAL) -> seal ONE page
// per record (fresh keyMaterial) -> push each -> audit hip.served. A guard miss throws OverShareError (hip.denied
// audited); a push error stops + audits hip.failed.
export async function serveTransfer(env, deps, req) {
  if (!hipFlagOn(env)) return { pushed: false, pages: 0, outcome: "DISABLED", warnings: [] };   // flag OFF => no-op, no existence leak
  const nowIso = isoOf(deps && deps.now);
  const { source } = deps;
  const careContexts = Array.isArray(req.careContexts) ? req.careContexts : [];
  if (careContexts.length === 0) return { pushed: false, pages: 0, outcome: "EMPTY", warnings: [] };

  // (0) Load every requested record (subject pseudonym + hiType + SCCM record). loadRecord THROWS on a missing
  //     ref (fail-closed). This READ is internal (our own DB) and is NOT a serve: nothing is sealed or pushed
  //     until the guard passes. It supplies the subjects the R5 guard must check.
  const loaded = [];
  for (const cc of careContexts) {
    const careContextRef = ccKey(cc);
    const rec = await source.loadRecord(env, deps, { tenantId: req.tenantId, careContextRef });
    loaded.push(Object.assign({ careContextRef }, rec));
  }

  // (1) R5 GUARD FIRST — refuse the WHOLE transfer on ANY cross-patient / out-of-scope record BEFORE any seal.
  //     Throws OverShareError (audits hip.denied). Nothing below runs on a refused transfer.
  await assertServeAllowed(env, deps, { consent: req.consent, careContexts, records: loaded, tenantId: req.tenantId });

  // (2) Anti-SSRF: validate the HIU-supplied dataPushUrl BEFORE any seal/POST. A bad URL => nothing is sealed.
  assertPushUrlAllowed(env, req.dataPushUrl);

  // (3) Per record: serialize -> validate -> seal ONE page. A serialize/validate failure SKIPS that record with
  //     a warning (contributes to PARTIAL) instead of dropping it silently. The NDHM plaintext is request-scoped
  //     and sealed immediately (never persisted/logged). sealEntries is called WITHOUT io (prod CSPRNG path) and
  //     one plaintext at a time => ONE fresh keyMaterial per page (R1, nonce-safe).
  const warnings = [];
  const outbound = [];
  for (const rec of loaded) {
    const record = rec.record || {};
    if (!record.profile && (rec.recordType || record.recordType)) record.profile = rec.recordType || record.recordType;
    const ctx = { now: (typeof deps.now === "function" ? deps.now : () => new Date(nowIso)), tenant: { id: req.tenantId } };
    const doc = serializeNdhm(ctx, record);
    const v = validateNdhmDoc(doc);
    if (!v.ok) { warnings.push({ careContextRef: rec.careContextRef, errors: v.errors }); continue; }
    const [page] = await sealEntries(req.hiuKeyMaterial, [JSON.stringify(doc)]);
    outbound.push({ page, careContextRef: rec.careContextRef });
  }

  // (4) POST each page. Any push error => stop + hip.failed (metadata only) + propagate (fail-closed).
  let pushed = 0;
  try {
    for (const o of outbound) { await pushPage(deps, req, nowIso, o.page, o.careContextRef); pushed++; }
  } catch (e) {
    if (deps.audit) await deps.audit({
      action: "hip.failed", outcome: "failed", ts: nowIso, tenantId: req.tenantId,
      consentId: (req.consent && req.consent.consentId) || null, transactionId: req.transactionId,
      resourceCounts: { pages: outbound.length, pushed }, scope: { error: String(e && e.message) },
    });
    throw e;
  }

  // (5) Audit hip.served (metadata ONLY: consentId, transactionId, careContextHash, page count — never the ABHA
  //     or a raw careContextReference; the careContextHash is an HMAC of the served refs, R14).
  const outcome = outbound.length === 0 ? "FAILED" : (warnings.length > 0 ? "PARTIAL" : "SERVED");
  if (deps.audit) await deps.audit({
    action: "hip.served", outcome: "ok", ts: nowIso, tenantId: req.tenantId,
    consentId: (req.consent && req.consent.consentId) || null, transactionId: req.transactionId,
    careContextHash: outbound.length ? await hmacPseudonym(env, req.tenantId, outbound.map((o) => o.careContextRef).sort().join("|")) : null,
    resourceCounts: { pages: pushed, warnings: warnings.length },
  });

  return { pushed: pushed > 0, pages: pushed, outcome, warnings };
}
