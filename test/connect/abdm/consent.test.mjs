// test/connect/abdm/consent.test.mjs — Stage-4 Task-5: consent-artifact JWS verify + per-request re-validation (R3/R4).
// INVARIANTS under test:
//   R3 — no persisted consent WITHOUT a verified JWS. An invalid signature, an unavailable JWKS, or a
//        non-GRANTED payload NEVER writes a connect_abdm_consent_req row; JWKS-unavailable is fail-closed
//        (getPinnedJwks THROWS) and verifyJws is never even reached (never ok:true).
//   R4 — revalidateForRequest binds EACH data request to a SPECIFIC verified, in-scope, unexpired, still-
//        GRANTED artifact: status must be GRANTED (a since-REVOKED/EXPIRED consent fails), `now` must lie
//        within permission.dateRange AND within expiry, and req.{careContexts,hiTypes,purpose} must be a
//        subset of / equal to the artifact's. Bounds are INCLUSIVE on both ends (documented in consent.js).
// Test seams: verifyJws is injected via deps.verifyJws (signature outcomes are stubbed); getPinnedJwks is
// the REAL pinned primitive, driven by a mock fetch (happy) or forced to fail-closed by an unset URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchConsentArtifact, verifyConsentArtifact, revalidateForRequest } from "../../../functions/_connect/abdm/consent.js";
import { getConsentReq } from "../../../functions/_connect/abdm/state.js";
import { ALLOW, buildAuditEvent } from "../../../functions/_connect/audit.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";

const NOW = "2026-06-01T00:00:00.000Z";
// An allow-listed ABDM JWKS host (see jws.js ABDM_JWKS_HOSTS) so the REAL getPinnedJwks succeeds under a mock fetch.
const JWKS_ENV = { ABDM_JWKS_URL: "https://healthidsbx.abdm.gov.in/certs" };
const NO_JWKS_ENV = {};   // unset URL => getPinnedJwks throws (fail-closed) before any verify

function kvMock() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, String(v)) }; }
function jwksFetch() { return async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ kid: "k1", kty: "RSA" }] }) }); }
function spyAudit() { const calls = []; const fn = async (f) => { calls.push(f); }; fn.calls = calls; return fn; }
// Injected verifyJws stub — records calls, returns a canned outcome. payload = the SIGNED consent detail.
function stubVerify(outcome) { const calls = []; const fn = async (token, opts) => { calls.push({ token, opts }); return outcome; }; fn.calls = calls; return fn; }

// A well-formed SIGNED consent detail (this is what the verified JWS payload carries).
const signedDetail = (over = {}) => ({
  consentId: "consent-123",
  status: "GRANTED",
  careContexts: [{ careContextReference: "cc-A" }, { careContextReference: "cc-B" }],
  hiTypes: ["OPConsultation", "DiagnosticReport"],
  purpose: { code: "CAREMGT", text: "Care Management" },
  permission: {
    dateRange: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" },
    dataEraseAt: "2027-01-01T00:00:00.000Z", frequency: { unit: "HOUR", value: 1, repeats: 0 },
  },
  expiry: "2026-12-31T00:00:00.000Z",
  ...over,
});

function makeDeps(over = {}) {
  return {
    db: makeAbdmDb({}), kv: kvMock(), secrets: null, gateway: null,
    fetch: jwksFetch(), audit: spyAudit(), now: () => NOW,
    verifyJws: stubVerify({ ok: true, payload: signedDetail() }), ...over,
  };
}

// ───────────────────────── fetchConsentArtifact ─────────────────────────
test("fetchConsentArtifact fires a consentFetch on the gateway (fire-and-forget) with the consentId", async () => {
  const calls = [];
  const gateway = { post: async (key, body) => { calls.push({ key, body }); return { status: 202, body: {} }; } };
  const deps = makeDeps({ gateway });
  const out = await fetchConsentArtifact(JWKS_ENV, deps, { requestId: "r1", consentId: "consent-123" });
  assert.equal(out, undefined, "returns void");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, "consentFetch");
  assert.equal(calls[0].body.consentId, "consent-123");
});

test("fetchConsentArtifact refuses to fire without a consentId (fail-closed)", async () => {
  const gateway = { post: async () => { throw new Error("should not be called"); } };
  await assert.rejects(() => fetchConsentArtifact(JWKS_ENV, makeDeps({ gateway }), { requestId: "r1" }));
});

// ───────────────────────── verifyConsentArtifact ─────────────────────────
test("valid artifact JWS => persisted as GRANTED (consent_id + hi_types) and returns ok:true", async () => {
  const deps = makeDeps();
  const r = await verifyConsentArtifact(JWKS_ENV, deps, { signature: "h.p.s" });
  assert.equal(r.ok, true);
  assert.equal(r.consent.consentId, "consent-123");
  assert.equal(r.consent.status, "GRANTED");
  assert.equal(deps.verifyJws.calls.length, 1, "verifyJws was invoked");
  const row = await getConsentReq(deps.db, "consent-123");
  assert.ok(row, "GRANTED row persisted (keyed by consentId)");
  assert.equal(row.status, "GRANTED");
  assert.equal(row.consent_id, "consent-123");
  assert.deepEqual(JSON.parse(row.hi_types), ["OPConsultation", "DiagnosticReport"]);
});

test("invalid signature => NOT persisted, fail-closed ok:false, audit consent.denied (metadata-only)", async () => {
  const deps = makeDeps({ verifyJws: stubVerify({ ok: false, payload: null, reason: "bad-signature" }) });
  const r = await verifyConsentArtifact(JWKS_ENV, deps, { signature: "h.p.bad" });
  assert.equal(r.ok, false);
  assert.equal((deps.db._tables.connect_abdm_consent_req || []).length, 0, "no row written on a bad signature");
  const denied = deps.audit.calls.find((f) => f.action === "consent.denied");
  assert.ok(denied, "a consent.denied audit was emitted");
  // metadata-only: every audit key is ALLOW-listed (buildAuditEvent drops nothing).
  assert.deepEqual(new Set(Object.keys(buildAuditEvent(denied))), new Set(Object.keys(denied)));
  for (const k of Object.keys(denied)) assert.ok(ALLOW.includes(k), `audit key ${k} not ALLOW-listed`);
});

test("JWKS unavailable during verify => fail-closed (NEVER ok:true) and verifyJws is never reached", async () => {
  // env has no ABDM_JWKS_URL => the REAL getPinnedJwks throws before any signature check. Even though the
  // injected verifyJws would say ok:true, it must never be called and nothing must persist.
  const verify = stubVerify({ ok: true, payload: signedDetail() });
  const deps = makeDeps({ verifyJws: verify });
  const r = await verifyConsentArtifact(NO_JWKS_ENV, deps, { signature: "h.p.s" });
  assert.equal(r.ok, false, "fail-closed when JWKS unavailable");
  assert.notEqual(r.ok, true);
  assert.equal(verify.calls.length, 0, "signature verification is NEVER attempted without a pinned JWKS");
  assert.equal((deps.db._tables.connect_abdm_consent_req || []).length, 0, "no row written");
});

test("a verified but NON-GRANTED (e.g. DENIED) artifact is NOT persisted as GRANTED", async () => {
  const deps = makeDeps({ verifyJws: stubVerify({ ok: true, payload: signedDetail({ status: "DENIED" }) }) });
  const r = await verifyConsentArtifact(JWKS_ENV, deps, { signature: "h.p.s" });
  assert.equal(r.ok, false);
  assert.equal((deps.db._tables.connect_abdm_consent_req || []).length, 0, "a DENIED artifact never persists a GRANTED row");
});

test("scope fields are read from the VERIFIED payload, never the envelope (signed-object substitution is impossible)", async () => {
  // The signed payload grants ONLY cc-A; the untrusted envelope claims cc-A AND cc-B. We must bind to the
  // signed payload, so a later request for cc-B must fail revalidation.
  const deps = makeDeps({ verifyJws: stubVerify({ ok: true, payload: signedDetail({ careContexts: [{ careContextReference: "cc-A" }] }) }) });
  const r = await verifyConsentArtifact(JWKS_ENV, deps, {
    signature: "h.p.s", careContexts: [{ careContextReference: "cc-A" }, { careContextReference: "cc-B" }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.consent.careContexts, ["cc-A"], "only the signed care context is trusted");
  const req = { careContexts: ["cc-B"], hiTypes: ["OPConsultation"], purpose: { code: "CAREMGT" } };
  assert.equal(revalidateForRequest(r.consent, req, NOW).ok, false, "the envelope-only care context is out of scope");
});

// ───────────────────────── revalidateForRequest (R4 checklist) ─────────────────────────
// A GRANTED, in-window artifact + an in-scope request.
const consent = () => ({
  consentId: "c1", status: "GRANTED",
  careContexts: ["cc-A", "cc-B"], hiTypes: ["OPConsultation", "DiagnosticReport"],
  purpose: { code: "CAREMGT" },
  permission: { dateRange: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" }, dataEraseAt: "2027-01-01T00:00:00.000Z", frequency: null },
  expiry: "2026-12-31T00:00:00.000Z",
});
const req = (over = {}) => ({ careContexts: ["cc-A"], hiTypes: ["OPConsultation"], purpose: { code: "CAREMGT" }, ...over });

test("revalidate: an in-scope, in-window, GRANTED artifact passes", () => {
  assert.deepEqual(revalidateForRequest(consent(), req(), NOW), { ok: true });
});

test("revalidate: a since-REVOKED consent fails (status is re-checked per request, not just at fetch)", () => {
  const r = revalidateForRequest({ ...consent(), status: "REVOKED" }, req(), NOW);
  assert.equal(r.ok, false);
});

test("revalidate: a since-EXPIRED consent (status EXPIRED) fails", () => {
  assert.equal(revalidateForRequest({ ...consent(), status: "EXPIRED" }, req(), NOW).ok, false);
});

test("revalidate: `now` below dateRange.from fails (lower boundary)", () => {
  assert.equal(revalidateForRequest(consent(), req(), "2025-12-31T23:59:59.999Z").ok, false);
});

test("revalidate: `now` above dateRange.to fails (upper boundary)", () => {
  // one ms past `to` (2026-12-31T00:00:00.000Z), and still <= expiry-equal-to `to`, so ONLY the dateRange bound bites.
  assert.equal(revalidateForRequest(consent(), req(), "2026-12-31T00:00:00.001Z").ok, false);
});

test("revalidate: dateRange bounds are INCLUSIVE — exactly `from` and exactly `to` are honored", () => {
  assert.equal(revalidateForRequest(consent(), req(), "2026-01-01T00:00:00.000Z").ok, true, "exact from");
  assert.equal(revalidateForRequest(consent(), req(), "2026-12-31T00:00:00.000Z").ok, true, "exact to (== expiry)");
});

test("revalidate: a requested careContext NOT in the artifact fails", () => {
  assert.equal(revalidateForRequest(consent(), req({ careContexts: ["cc-Z"] }), NOW).ok, false);
});

test("revalidate: scope-widening — artifact grants {cc-A} but request asks {cc-A,cc-B} fails", () => {
  const c = { ...consent(), careContexts: ["cc-A"] };
  assert.equal(revalidateForRequest(c, req({ careContexts: ["cc-A", "cc-B"] }), NOW).ok, false);
});

test("revalidate: a requested hiType NOT in the artifact fails", () => {
  assert.equal(revalidateForRequest(consent(), req({ hiTypes: ["Prescription"] }), NOW).ok, false);
});

test("revalidate: hiType scope-widening — {OPConsultation} granted but {OPConsultation,DiagnosticReport,ImmunizationRecord} requested fails", () => {
  const c = { ...consent(), hiTypes: ["OPConsultation"] };
  assert.equal(revalidateForRequest(c, req({ hiTypes: ["OPConsultation", "DiagnosticReport"] }), NOW).ok, false);
});

test("revalidate: purpose mismatch fails", () => {
  assert.equal(revalidateForRequest(consent(), req({ purpose: { code: "BREAKGLASS" } }), NOW).ok, false);
});

test("revalidate: an expired artifact fails even when `now` is inside dateRange", () => {
  // expiry in the past relative to `now`, but `now` is inside [from,to] — proves expiry is an INDEPENDENT bound.
  const c = { ...consent(), expiry: "2026-05-01T00:00:00.000Z" };
  const r = revalidateForRequest(c, req(), NOW);   // NOW = 2026-06-01, inside dateRange, past expiry
  assert.equal(r.ok, false);
});

test("revalidate: expiry upper bound is INCLUSIVE — exactly at expiry is honored", () => {
  const c = { ...consent(), expiry: "2026-06-01T00:00:00.000Z" };   // == NOW
  assert.equal(revalidateForRequest(c, req(), NOW).ok, true);
});

test("revalidate: fail-closed on a missing/unparseable expiry", () => {
  assert.equal(revalidateForRequest({ ...consent(), expiry: null }, req(), NOW).ok, false);
  assert.equal(revalidateForRequest({ ...consent(), expiry: "not-a-date" }, req(), NOW).ok, false);
});

test("revalidate: fail-closed on a request that names no careContexts or no hiTypes (nothing to bind)", () => {
  assert.equal(revalidateForRequest(consent(), req({ careContexts: [] }), NOW).ok, false);
  assert.equal(revalidateForRequest(consent(), req({ hiTypes: [] }), NOW).ok, false);
  assert.equal(revalidateForRequest(consent(), req({ careContexts: undefined }), NOW).ok, false);
});

test("revalidate: fail-closed on a malformed dateRange or an unparseable `now`", () => {
  assert.equal(revalidateForRequest({ ...consent(), permission: { dateRange: { from: "x", to: "y" } } }, req(), NOW).ok, false);
  assert.equal(revalidateForRequest(consent(), req(), "not-a-date").ok, false);
});
