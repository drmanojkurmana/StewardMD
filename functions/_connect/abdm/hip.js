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
import { revalidateForRequest, getConsentReqByConsentId } from "./consent.js";  // Stage-4: the request-time R4 checklist + the FRESH by-consentId D1 reload (R5 authority)
import { hmacPseudonym } from "../audit.js";                                    // per-tenant HMAC pseudonym (raw ABHA never stored/logged)
import { SecretsUnavailable } from "../secrets.js";                            // fail-closed AND audited when a secret op is unavailable mid-guard
import { resolveActor, resolveTenant } from "../identity.js";                   // Tasks 6+8: server-derived actor+membership (PermissionError before any write)
import { putConsentReq, getConsentReq, updateConsentStatus } from "./state.js"; // Task 8: reuse the MONOTONIC (R6) consent lifecycle store
import { guardedKvPut, looksLikePhi, PhiLeakError } from "./no-phi.js";         // R16: NON-PHI rate-limit KV write + owner-set `display` label validation

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
// Decode a persisted scope column off the reloaded consent row — the SAME helpers hiu.js#requestHealthInformation
// uses so the R5 guard revalidates against IDENTICAL fresh-from-D1 scope. Non-string ⇒ passthrough; a non-JSON
// string ⇒ verbatim (fail-soft — revalidateForRequest's own array/purpose guards then fail closed).
const parseHiTypes = (v) => { if (v == null) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return [v]; } };
const parseJson = (v) => { if (v == null) return null; if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };

// ── assertServeAllowed — the R5 cross-patient OVER-SHARE guardrail (Task 5, DUAL-ADVERSARIAL) ───────────────
// Throws OverShareError (audited `hip.denied`, metadata only) on ANY miss; returns void when the WHOLE transfer
// is provably in-scope for ONE patient. Enforces R5 in FULL; a single miss refuses the WHOLE transfer — it never
// drops-and-serves-the-rest. No cross-patient bytes ever reach the seal (this runs BEFORE serialize/seal).
//
// TRUST MODEL (dual-adversarial FIX): NOTHING here is trusted from the caller except the `consentId` it names.
// The authoritative consent state is RELOADED FRESH from D1 by that id (getConsentReqByConsentId) — EXACTLY the
// pattern hiu.js#requestHealthInformation uses — so status (since-REVOKED), the PERSISTED signed scope
// (care_contexts/hi_types/purpose/date_range/expires_at) AND the subject pseudonym (patient_abha_hash) all come
// from the DB row, never a caller-supplied `consent` object. A stale/widened/forged caller scope cannot pass, and
// there is NO `hmacPseudonym(rawABHA)` recompute — subject binding is a hex compare against the row's hash, so an
// attacker-pickable/self-referential ABHA (and its non-string "[object Object]" collision) is impossible.
//   (iv) FRESH consent bind: revalidateForRequest against the RELOADED row (status/dateRange/expiry + scope subset)
//        — a since-REVOKED/EXPIRED/out-of-dateRange or scope-widened request is refused off the DB.
//   (i)  subject bind: EVERY loaded record's patientAbhaHash EQUALS the reloaded row's patient_abha_hash.
//   (d)  registration bind: EVERY served careContext has a registered row (getServableCareContexts, scoped to the
//        row's patient hash) — a careContext whose registration belongs to a DIFFERENT patient is refused.
//   (ii) each served careContextReference is EXPLICITLY in the reloaded row's persisted careContexts;
//   (iii) each record's hiType is a subset of the reloaded row's hiTypes.
// A missing D1 row => status null => fail-closed. deps = { db, audit, now }; args = { consentId, careContexts,
// records, tenantId }. A secret op that goes unavailable mid-guard (SecretsUnavailable) still audits hip.denied.
export async function assertServeAllowed(env, deps, { consentId, careContexts, records, tenantId } = {}) {
  const nowIso = isoOf(deps && deps.now);
  const db = deps && deps.db;
  const deny = async (reason) => {
    if (deps && deps.audit) await deps.audit({
      action: "hip.denied", outcome: "denied", ts: nowIso, tenantId,
      consentId: consentId || null,                        // a non-PHI artifact id (R16)
      scope: { reason },                                    // stable PHI-free reason; NEVER the ABHA/careContextRef
    });
    throw new OverShareError(reason);
  };

  try {
    if (consentId == null) return await deny("no-consent");
    if (!db) return await deny("no-db");                    // fail-closed: no authoritative store => refuse
    if (!Array.isArray(records)) return await deny("no-records");
    const servedCC = (Array.isArray(careContexts) ? careContexts : []).map(ccKey);
    if (servedCC.length === 0) return await deny("no-carecontexts");

    // RELOAD the ONE authoritative consent row FRESH from D1 (the Stage-4 by-consentId reconciled lookup). This is
    // the whole fix: status + persisted scope + patient hash are read HERE, never trusted from the caller. A
    // missing row (or a row with no persisted subject hash) fails closed.
    const fresh = await getConsentReqByConsentId(db, consentId);
    const rowHash = fresh && fresh.patient_abha_hash;
    if (!fresh || typeof rowHash !== "string" || rowHash.length === 0) return await deny("no-consent-row");
    const consent = {
      id: fresh.consent_id || consentId,
      status: fresh.status,                                                     // FRESH — the since-REVOKED catch
      careContexts: fresh.care_contexts != null ? parseJson(fresh.care_contexts) : [],
      hiTypes: fresh.hi_types != null ? parseHiTypes(fresh.hi_types) : [],
      purpose: fresh.purpose != null ? parseJson(fresh.purpose) : null,
      permission: { dateRange: fresh.date_range != null ? parseJson(fresh.date_range) : {} },
      expiry: fresh.expires_at != null ? fresh.expires_at : null,
    };

    // (iv) FRESH consent bind FIRST — revalidateForRequest binds status/dateRange/expiry AND subset-checks the
    //      served careContexts/hiTypes/purpose against the RELOADED scope (so a stale/widened caller scope or a
    //      since-REVOKED/EXPIRED grant is refused off the DB, defence-in-depth with the per-record checks below).
    const servedHi = [...new Set(records.map((r) => String(r && r.hiType)))];
    const reval = revalidateForRequest(consent, { careContexts: servedCC, hiTypes: servedHi, purpose: consent.purpose }, nowIso);
    if (!reval.ok) return await deny("consent:" + reval.reason);

    // The reloaded row's persisted careContexts as an EXPLICIT allow-set (no wildcard, no registration-implied
    // membership) + the granted hiTypes.
    const artifactCC = new Set((Array.isArray(consent.careContexts) ? consent.careContexts : []).map(ccKey));
    const grantedHi = new Set((Array.isArray(consent.hiTypes) ? consent.hiTypes : []).map(String));

    // (d) The registered care-contexts for the CONSENT ROW's patient (D1-authoritative subject bind at the
    //     care-context layer). getServableCareContexts is scoped to `rowHash`, so every returned row belongs to
    //     the consent's patient; a served careContext whose registration is under a DIFFERENT patient is simply
    //     absent from this set and refused below.
    const servable = await getServableCareContexts(db, tenantId, rowHash);
    const servableRefs = new Set();
    for (const r of servable) {
      if (!ctEqualHex(String(r && r.patient_abha_hash), rowHash)) return await deny("carecontext-cross-patient");
      const rk = ccKey(r && r.ref);
      if (rk != null) servableRefs.add(rk);
    }

    for (const rec of records) {
      if (!rec || typeof rec !== "object") return await deny("bad-record");
      // (i) subject == the reloaded row's patient hash — a SINGLE mismatch refuses the WHOLE transfer (no leak).
      if (typeof rec.patientAbhaHash !== "string" || rec.patientAbhaHash.length === 0) return await deny("record-no-subject");
      if (!ctEqualHex(rec.patientAbhaHash, rowHash)) return await deny("cross-patient");
      // (ii) explicit careContext membership in the reloaded row's scope.
      const ref = ccKey(rec.careContextRef);
      if (ref == null || !artifactCC.has(ref)) return await deny("carecontext-not-in-artifact");
      // (iii) hiType subset of the reloaded row's hiTypes.
      if (!grantedHi.has(String(rec.hiType))) return await deny("hitype-out-of-scope");
      // (d) the served careContext must be REGISTERED to the consent's patient (D1 subject bind).
      if (!servableRefs.has(ref)) return await deny("carecontext-not-registered-to-patient");
    }
    // Provably one-patient, in-scope, fresh-D1-consent-bound. Void => allowed.
  } catch (e) {
    // A secret op going unavailable mid-guard (e.g. an at-rest unseal on the reload) must STILL audit hip.denied —
    // fail-closed AND audited (the adversary's blind-spot: the old hmac recompute threw here unaudited). Any other
    // error (incl. the OverShareError a normal deny already audited) propagates unchanged.
    if (e instanceof SecretsUnavailable) return await deny("secrets-unavailable");
    throw e;
  }
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
// deps = { db, secrets, gateway, fetch, audit, now, source, jwks }; req = { tenantId, consentId, careContexts,
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
  //     Reloads the authoritative consent row FRESH from D1 by consentId. Throws OverShareError (audits
  //     hip.denied). Nothing below runs on a refused transfer.
  await assertServeAllowed(env, deps, { consentId: req.consentId, careContexts, records: loaded, tenantId: req.tenantId });

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
      consentId: req.consentId || null, transactionId: req.transactionId,
      resourceCounts: { pages: outbound.length, pushed }, scope: { error: String(e && e.message) },
    });
    throw e;
  }

  // (5) Audit hip.served (metadata ONLY: consentId, transactionId, careContextHash, page count — never the ABHA
  //     or a raw careContextReference; the careContextHash is an HMAC of the served refs, R14).
  const outcome = outbound.length === 0 ? "FAILED" : (warnings.length > 0 ? "PARTIAL" : "SERVED");
  if (deps.audit) await deps.audit({
    action: "hip.served", outcome: "ok", ts: nowIso, tenantId: req.tenantId,
    consentId: req.consentId || null, transactionId: req.transactionId,
    careContextHash: outbound.length ? await hmacPseudonym(env, req.tenantId, outbound.map((o) => o.careContextRef).sort().join("|")) : null,
    resourceCounts: { pages: pushed, warnings: warnings.length },
  });

  return { pushed: pushed > 0, pages: pushed, outcome, warnings };
}

// A discovery source exceeded its fixed-window probe budget (R11 anti-enumeration). PHI-free (carries only the
// non-PHI sourceId). Thrown BEFORE any care-context lookup so an over-limit source learns nothing.
export class RateLimited extends Error {
  constructor(sourceId) { super("discovery rate-limited: " + sourceId); this.name = "RateLimited"; this.sourceId = sourceId; }
}

// Injected clock -> epoch ms (never Date.now / the wall clock). Mirrors isoOf; used only for the fixed-window bucket.
function epochMs(clock) {
  const d = typeof clock === "function" ? clock() : clock;
  if (d && typeof d.getTime === "function") return d.getTime();
  if (typeof d === "number") return d;
  if (typeof d === "string" && d) { const n = Date.parse(d); return Number.isNaN(n) ? 0 : n; }
  return 0;
}

// The exact ABHA identifier on a discovery probe. EXACT identifier ONLY — the demographic fields (name/gender/
// yob/mobile) are DELIBERATELY not read here: a demographic-only probe carries no exact identifier, so it can
// never match (no fuzzy/substring/demographic matching, ever).
function probeAbha(probe) {
  if (!probe || typeof probe !== "object") return null;
  const v = probe.abhaAddress ?? probe.abha ?? probe.healthId ?? probe.id;
  return typeof v === "string" && v ? v : null;
}

// Rate-limit budget (per source, fixed window). Env-tunable; fail-safe defaults. Reads are off injected `env` only.
const discoLimit = (env) => { const n = Number(env && env.CONNECT_HIP_DISCO_LIMIT); return Number.isFinite(n) && n > 0 ? n : 30; };
const discoWindowSec = (env) => { const n = Number(env && env.CONNECT_HIP_DISCO_WINDOW_SEC); return Number.isFinite(n) && n > 0 ? n : 60; };

// Fixed-window per-source counter under ONE non-PHI key `connect:abdm:disco:<sourceId>`. The window bucket index
// lives in the VALUE (so a new window resets the count even before the TTL fires), and expirationTtl bounds the
// key's lifetime. Returns { limited } — over-budget => { limited:true } and NO increment (the caller refuses).
async function bumpDiscoveryRate(kv, sourceId, nowMs, limit, windowSec) {
  const key = `connect:abdm:disco:${sourceId}`;                     // non-PHI: only the requesting source id, never the ABHA
  const win = Math.floor(nowMs / (windowSec * 1000));               // fixed-window bucket
  let rec = null;
  try { rec = JSON.parse((await kv.get(key)) || "null"); } catch { rec = null; }
  const count = rec && rec.win === win ? (Number(rec.count) || 0) : 0;  // a new window resets the count
  if (count >= limit) return { limited: true };
  await guardedKvPut(kv, key, JSON.stringify({ win, count: count + 1 }), { expirationTtl: windowSec * 2 }); // R16: key = sourceId only, value = counts — guard keeps it PHI-free
  return { limited: false };
}

// ── getServableCareContexts — the EXACT-match care-context lookup (shared by discovery + serve) ──────────────
// Per-tenant AND per-patient scoped, EXACT equality only (WHERE tenant_id=? AND patient_abha_hash=?, both col=?).
// Fail-closed on a missing tenant/hash (returns [] — never an unscoped table scan). The patient_abha_hash is a
// per-tenant HMAC, so it is impossible to hit another tenant's row even if a raw ABHA collided across tenants.
export async function getServableCareContexts(db, tenantId, patientAbhaHash) {
  if (!db || tenantId == null || !patientAbhaHash) return [];        // fail-closed: never scan the whole table
  const { results = [] } = await db
    .prepare("SELECT * FROM connect_abdm_carecontext WHERE tenant_id=? AND patient_abha_hash=?")
    .bind(tenantId, patientAbhaHash).all();
  return results;
}

// ── handleDiscovery — exact-match, rate-limited, PHI-free-audited care-context discovery (Task 6) ────────────
// deps = { db, kv, audit }; args = { probe, sourceId, now }. Returns a CONSTANT-shape { matched, careContexts:[] }.
// Fail-closed, in order: flag-gate -> per-source RATE LIMIT (over-limit => RateLimited, audited, NO lookup) ->
// EXACT-IDENTIFIER match ONLY (HMAC the probe ABHA, look up connect_abdm_carecontext by patient_abha_hash EXACT
// equality; a demographic-only probe with no exact ABHA => matched:false, NEVER fuzzy) -> audit EVERY probe
// (metadata only: sourceId, matched bool, count — NEVER a raw ABHA/demographics) -> return matches on an exact hit
// else the CONSTANT { matched:false, careContexts:[] } (a registered-miss and an unregistered patient are
// byte-identical, blunting the existence oracle).
// // VERIFY (owner): discovery is a SYNCHRONOUS request/response (ABDM care-contexts/discover SLA — no async
// fan-out here) and the response contract is { matched, careContexts:[{ referenceNumber, display }] }; confirm
// the exact wire field names + whether matchedBy must be echoed when Task-7 wires the ingress.
export async function handleDiscovery(env, deps, { probe, sourceId, now } = {}) {
  if (!hipFlagOn(env)) return { matched: false, careContexts: [] };  // flag OFF => constant no-op, no existence leak
  const { db, kv, audit } = deps || {};
  const nowIso = isoOf(now);
  const sid = String(sourceId == null ? "" : sourceId);
  const tenantId = probe && probe.tenantId;

  // (1) RATE LIMIT FIRST — an over-budget source is refused BEFORE any care-context lookup (learns nothing).
  const rl = await bumpDiscoveryRate(kv, sid, epochMs(now), discoLimit(env), discoWindowSec(env));
  if (rl.limited) {
    if (audit) await audit({ action: "hip.discovery", outcome: "denied", ts: nowIso, tenantId: tenantId ?? null, scope: { sourceId: sid, reason: "rate-limited" } });
    throw new RateLimited(sid);
  }

  // (2) EXACT-IDENTIFIER match ONLY. No exact ABHA (a demographic-only probe) => never look up, never match.
  let matched = false;
  let careContexts = [];
  const abha = probeAbha(probe);
  if (abha != null && tenantId != null) {
    const patientAbhaHash = await hmacPseudonym(env, tenantId, abha);        // raw ABHA hashed before any lookup
    const rows = await getServableCareContexts(db, tenantId, patientAbhaHash);
    if (rows.length > 0) { matched = true; careContexts = rows.map((r) => ({ referenceNumber: r.ref, display: r.display })); }
  }

  // (3) Audit EVERY probe (metadata ONLY — buildAuditEvent structurally drops anything outside ALLOW; sourceId +
  //     matched live in `scope`, the count in `resourceCounts`; the raw ABHA/demographics NEVER appear).
  if (audit) await audit({
    action: "hip.discovery", outcome: "ok", ts: nowIso, tenantId: tenantId ?? null,
    scope: { sourceId: sid, matched }, resourceCounts: { careContexts: careContexts.length },
  });

  // (4) CONSTANT shape on a miss (unregistered patient, demographic-only probe, and registered-miss are identical).
  if (!matched) return { matched: false, careContexts: [] };
  return { matched: true, careContexts };
}

// ── linkCareContext — care-context REGISTRATION (Task 8) ─────────────────────────────────────────────────────
// deps = { db, audit, identify }; req = { request, tenantId, abhaAddress, ref, hiType, display, source, now }.
// Server-DERIVES the actor + tenant (resolveActor/resolveTenant): a non-authenticated actor throws AuthError and a
// non-member throws PermissionError BEFORE any write (no row on a refused caller). The raw ABHA is POST-body-only:
// it is HMAC'd to patient_abha_hash before D1 and is absent from every persisted + audited field. IDEMPOTENT: the
// row id is a stable HMAC over (tenant, patient_abha_hash, ref), so a repeat link of the same triple check-then-
// inserts nothing (no duplicate). Audited (hip.linked, metadata only). Returns { id }.
export async function linkCareContext(env, deps, req = {}) {
  const { db, audit, identify } = deps || {};
  const nowIso = isoOf(req.now);
  // (R16) `display` is an OWNER-set episode LABEL only — reject a PHI-shaped label (name/ABHA/Aadhaar/mobile) and
  // bound its length FIRST (cheap input guard), so a patient name/identifier can never be persisted as a label.
  const display = req.display == null ? null : String(req.display).slice(0, 120);
  if (display && looksLikePhi(display)) throw new PhiLeakError("care-context display must be a non-PHI owner-set label", "linkCareContext.display");
  // Server-derive identity + membership BEFORE any write. Both throw (AuthError / PermissionError) on failure.
  const actor = await resolveActor(identify, req.request, env);
  const { tenant } = await resolveTenant(db, actor.id, req.tenantId);

  const abhaAddress = req.abhaAddress ?? req.abha;                   // POST-body ONLY — hashed immediately below
  const patientAbhaHash = await hmacPseudonym(env, tenant.id, abhaAddress);  // fail-closed if the ABHA is missing/salt absent
  const ref = req.ref;
  const source = req.source || "followcare";
  // Stable, deterministic id over (tenant, patient_abha_hash, ref) => idempotent linkage. Reuses hmacPseudonym
  // (non-PHI hex); a repeat of the same triple yields the same id, so the check-then-insert dedupes.
  const id = await hmacPseudonym(env, tenant.id, `carecontext:${patientAbhaHash}:${ref}`);

  const existing = await db.prepare("SELECT * FROM connect_abdm_carecontext WHERE id=?").bind(id).first();
  if (!existing) {
    const res = await db.prepare(
      "INSERT INTO connect_abdm_carecontext (id,tenant_id,patient_abha_hash,source,ref,hi_type,display,linked_at) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id, tenant.id, patientAbhaHash, source, ref, req.hiType ?? null, display, nowIso).run();
    if (!res || res.success === false) throw new Error("linkCareContext insert failed");
  }

  if (audit) await audit({
    action: "hip.linked", outcome: "ok", ts: nowIso, tenantId: tenant.id, actor: actor.id,
    careContextHash: await hmacPseudonym(env, tenant.id, String(ref)),   // HMAC of the ref — never the raw careContextReference
    scope: { source },
  });
  return { id };
}

// ── putHipConsent / getHipConsent — HIP-side consent store (Task 8) ──────────────────────────────────────────
// Reuses the connect_abdm_consent_req lifecycle row (keyed by requestId) and its MONOTONIC updateConsentStatus
// (R6 anti-replay): a status is only applied if it is equal-or-higher rank and the current status is non-terminal,
// so a REPLAYED OLDER status (e.g. a GRANTED replayed after a REVOKE) is refused ({ ok:false }) and never regresses
// the row. The raw ABHA never reaches here — the caller passes the already-HMAC'd patientAbhaHash. Returns the
// updateConsentStatus result { ok, status }.
export async function putHipConsent(db, { requestId, tenantId, patientAbhaHash, hiTypes, expiresAt, status = "GRANTED", now } = {}) {
  const existing = await getConsentReq(db, requestId);
  if (!existing) {
    await putConsentReq(db, { requestId, tenantId, actor: null, patientAbhaHash, hiTypes, expiresAt, now });
  }
  return updateConsentStatus(db, requestId, status, now);            // monotonic: an older replayed status => { ok:false }
}

export async function getHipConsent(db, requestId) {
  return getConsentReq(db, requestId);
}
