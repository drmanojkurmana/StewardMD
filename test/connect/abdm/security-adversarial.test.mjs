// test/connect/abdm/security-adversarial.test.mjs — one place that answers "can this be abused?".
//
// The unit suites prove each guard works in isolation. This one drives the REAL mounted surfaces - the
// M1 route and the V3 callback receiver - through the attacks that would actually be attempted, because a
// guard that is correct but not reached is not a guard.
//
// Every test below is named after the thing it stops. If one of these ever goes red, something that
// protects a patient has been removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest as m1Route } from "../../../functions/api/abdm/[[path]].js";
import { onRequest as receiver } from "../../../functions/api/v3/[[path]].js";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { hmacPseudonym } from "../../../functions/_connect/audit.js";
import { HIP_HANDLERS } from "../../../functions/_connect/abdm/hip-handlers.js";
import { serializeNdhm, validateNdhmDoc } from "../../../functions/_connect/connectors/abdm/serialize.js";
import { assertServeAllowed, OverShareError } from "../../../functions/_connect/abdm/hip.js";

const NOW = "2026-08-19T00:00:00.000Z";
const HMAC = Buffer.from("connect-test-hmac-salt-key-1234").toString("base64");

// ── the M1 route: two hospitals, one patient index each ─────────────────────────────────────────────
// Dr A belongs to hospital-a only. Dr B belongs to hospital-b only.
function m1Env(over = {}) {
  return {
    ABDM_M1_FLAG: "1", ABDM_ENV: "sandbox", CONNECT_HMAC_SALT: HMAC,
    ABDM_HIP_ID: "IN2810006668", ABDM_TENANT_ID: "hospital-a",
    CONNECT_DB: makeAbdmDb({
      connect_tenant: [{ id: "hospital-a", mode: "sandbox" }, { id: "hospital-b", mode: "sandbox" }],
      connect_membership: [
        { user_id: "fb:drA", tenant_id: "hospital-a", role: "clinician" },
        { user_id: "fb:drB", tenant_id: "hospital-b", role: "clinician" },
      ],
      connect_abha_link: [],
    }),
    MAIK_KV: makeMockKv(),
    ...over,
  };
}
const m1Ctx = (env, request) => ({ request, env, waitUntil: () => {} });
const post = (path, body, who = "drA") => new Request("https://stewardmd.in/api/abdm" + path, {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test:" + who },
  body: JSON.stringify(body),
});
const get = (path, who = "drA") => new Request("https://stewardmd.in/api/abdm" + path, {
  headers: { authorization: "Bearer test:" + who },
});

// The route resolves identity through _usage.identify. It is not stubbed here, so these requests arrive
// unauthenticated - which is itself the first thing worth asserting.
test("CROSS-TENANT ABHA BINDING: an unauthenticated caller cannot bind an ABHA at all", async () => {
  const env = m1Env();
  const res = await m1Route(m1Ctx(env, post("/link", {
    tenantId: "hospital-b", abhaNumber: "91234567890123", abhaAddress: "victim@sbx", patientRef: "P-9",
  })));
  assert.equal(res.status, 401, "no identity, no write");
  assert.equal((env.CONNECT_DB._tables.connect_abha_link || []).length, 0);
});

test("CROSS-TENANT ABHA BINDING: the M1 surface is invisible with the flag off", async () => {
  const env = m1Env({ ABDM_M1_FLAG: "0" });
  const res = await m1Route(m1Ctx(env, post("/link", { tenantId: "hospital-a" })));
  assert.equal(res.status, 404, "flag off must not even admit the surface exists");
});

test("CROSS-TENANT LOOKUP: probing whether an ABHA is registered elsewhere needs membership", async () => {
  const env = m1Env();
  const res = await m1Route(m1Ctx(env, get("/link/lookup?tenantId=hospital-b&abhaNumber=91234567890123")));
  assert.ok(res.status === 401 || res.status === 403, "got " + res.status);
});

// ── the V3 receiver: unauthorized and replayed callbacks ────────────────────────────────────────────
function cbEnv(over = {}) {
  return {
    CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", ABDM_ENV: "sandbox", CONNECT_HMAC_SALT: HMAC,
    ABDM_HIP_ID: "IN2810006668", ABDM_TENANT_ID: "hospital-a",
    CONNECT_DB: makeAbdmDb({}), CONNECT_R2: makeR2(), MAIK_KV: makeMockKv(), ...over,
  };
}
const cbCtx = (env, request) => ({ request, env, waitUntil: () => {} });
const callback = (path, body, headers = {}) => new Request("https://abdm.stewardmd.in" + path, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "REQUEST-ID": headers.requestId || crypto.randomUUID(),
    TIMESTAMP: headers.timestamp || new Date().toISOString(),
    "X-HIP-ID": headers.hipId || "IN2810006668",
    ...(headers.bearer ? { authorization: "Bearer " + headers.bearer } : {}),
  },
  body: JSON.stringify(body || {}),
});

test("UNAUTHORIZED CALLBACK: no bearer is refused, never acted on", async () => {
  const env = cbEnv();
  const res = await receiver(cbCtx(env, callback("/api/v3/hip/patient/care-context/discover", { patient: { id: "x@sbx" } })));
  assert.ok(res.status === 401 || res.status === 503, "got " + res.status);
  assert.notEqual(res.status, 202, "a 2xx here would mean we processed an unauthenticated callback");
});

test("UNAUTHORIZED CALLBACK: a forged bearer cannot be minted by us - it is checked against ABDM's JWKS", async () => {
  const env = cbEnv();
  const res = await receiver(cbCtx(env, callback("/api/v3/hip/patient/share", { intent: "PROFILE_SHARE" },
    { bearer: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.zzzz" })));
  assert.ok(res.status === 401 || res.status === 503);
});

test("UNAUTHORIZED CALLBACK: mandatory headers are enforced BEFORE any bearer work", async () => {
  const env = cbEnv();
  const r = new Request("https://abdm.stewardmd.in/api/v3/hip/patient/share", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal((await receiver(cbCtx(env, r))).status, 400);
});

test("UNAUTHORIZED CALLBACK: a stale TIMESTAMP is refused (anti-replay window)", async () => {
  const env = cbEnv();
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const res = await receiver(cbCtx(env, callback("/api/v3/hip/patient/share", {}, { timestamp: old })));
  assert.equal(res.status, 400);
});

test("UNKNOWN CALLBACK PATH: 404, never treated as a known kind", async () => {
  const env = cbEnv();
  assert.equal((await receiver(cbCtx(env, callback("/api/v3/hip/patient/shares", {})))).status, 404);
  assert.equal((await receiver(cbCtx(env, callback("/api/v3/../../admin", {})))).status, 404);
});

test("FLAG OFF: the whole receiver is invisible", async () => {
  const env = cbEnv({ CONNECT_FLAG: "0" });
  assert.equal((await receiver(cbCtx(env, callback("/api/v3/hip/patient/share", {})))).status, 404);
});

// ── cross-patient / cross-tenant at the handler level ───────────────────────────────────────────────
function handlerDeps(tables = {}, over = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      db: makeAbdmDb(tables), r2: makeR2(), kv: makeMockKv(),
      gateway: { post: async (key, body) => { calls.push({ key, body }); return { status: 202 }; } },
      now: () => new Date(NOW), audit: async () => {}, ...over,
    },
  };
}
const ENV_H = { CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", ABDM_ENV: "sandbox", CONNECT_HMAC_SALT: HMAC,
                ABDM_HIP_ID: "IN2810006668", ABDM_TENANT_ID: "hospital-a" };
const hdrs = (o = {}) => ({ requestId: "req-1", timestamp: NOW, entityId: o.hipId ?? "IN2810006668" });
const cc = (o) => ({ id: o.id, tenant_id: o.tenant || "hospital-a", patient_abha_hash: o.hash,
                     source: "consented-store", ref: o.ref, hi_type: "OPConsultation",
                     display: o.display || "OPD visit 3 March 2026", linked_at: NOW });

test("CROSS-PATIENT LEAKAGE: discovery for patient A never returns patient B's care contexts", async () => {
  const a = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const b = await hmacPseudonym(ENV_H, "hospital-a", "bob@sbx");
  const h = handlerDeps({ connect_abdm_carecontext: [
    cc({ id: "1", hash: a, ref: "OPD:alice" }), cc({ id: "2", hash: b, ref: "OPD:bob" }),
  ] });
  await HIP_HANDLERS.discover({ env: ENV_H, deps: h.deps, headers: hdrs(),
    body: { transactionId: "tx", patient: { id: "alice@sbx" } } });
  const refs = JSON.stringify(h.calls[0].body);
  assert.ok(refs.includes("OPD:alice"));
  assert.ok(!refs.includes("OPD:bob"), "one patient's probe must never surface another's records");
});

test("CROSS-TENANT LEAKAGE: an unknown HIP id resolves to NO tenant, so nothing is served", async () => {
  const a = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const h = handlerDeps({ connect_abdm_carecontext: [cc({ id: "1", hash: a, ref: "OPD:alice" })] });
  await assert.rejects(() => HIP_HANDLERS.discover({ env: ENV_H, deps: h.deps,
    headers: hdrs({ hipId: "IN9999999999" }), body: { patient: { id: "alice@sbx" } } }));
  assert.equal(h.calls.length, 0, "a guessed tenant would serve one hospital's records under another's id");
});

test("CROSS-TENANT LEAKAGE: care contexts registered to another tenant are invisible", async () => {
  const a = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const h = handlerDeps({ connect_abdm_carecontext: [cc({ id: "1", tenant: "hospital-b", hash: a, ref: "OPD:otherhosp" })] });
  await HIP_HANDLERS.discover({ env: ENV_H, deps: h.deps, headers: hdrs(),
    body: { transactionId: "tx", patient: { id: "alice@sbx" } } });
  assert.deepEqual(h.calls[0].body.patient, [], "the same patient at another hospital is not ours to disclose");
});

// ── consent scope + wrong care-context ──────────────────────────────────────────────────────────────
const consentRow = (o = {}) => ({
  request_id: o.rid || "rq", tenant_id: "hospital-a", consent_id: o.cid || "cid-1",
  status: o.status || "GRANTED", patient_abha_hash: o.hash,
  care_contexts: JSON.stringify(o.ccs || ["OPD:1"]),
  hi_types: JSON.stringify(o.hiTypes || ["OPConsultation"]),
  purpose: JSON.stringify({ code: "CAREMGT" }),
  date_range: JSON.stringify({ from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }),
  created_at: NOW, updated_at: NOW, expires_at: "2027-01-01T00:00:00Z",
});
const guardDeps = (rows) => ({ db: makeAbdmDb({ connect_abdm_consent_req: rows, connect_abdm_carecontext: [] }),
                               audit: async () => {}, now: () => NOW });

test("WRONG CARE-CONTEXT: serving a context the consent does not name is REFUSED", async () => {
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const deps = guardDeps([consentRow({ hash, ccs: ["OPD:1"] })]);
  await assert.rejects(() => assertServeAllowed(ENV_H, deps, {
    consentId: "cid-1", tenantId: "hospital-a",
    careContexts: ["OPD:2"],                                     // NOT in the consent
    records: [{ careContextRef: "OPD:2", patientAbhaHash: hash, hiType: "OPConsultation" }],
  }), OverShareError);
});

test("CONSENT SCOPE: an hiType outside the grant is REFUSED", async () => {
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const deps = guardDeps([consentRow({ hash, hiTypes: ["OPConsultation"] })]);
  await assert.rejects(() => assertServeAllowed(ENV_H, deps, {
    consentId: "cid-1", tenantId: "hospital-a", careContexts: ["OPD:1"],
    records: [{ careContextRef: "OPD:1", patientAbhaHash: hash, hiType: "DischargeSummary" }],
  }), OverShareError);
});

test("CROSS-PATIENT: one out-of-scope record refuses the WHOLE transfer, never drop-and-serve-the-rest", async () => {
  const alice = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const bob = await hmacPseudonym(ENV_H, "hospital-a", "bob@sbx");
  const deps = guardDeps([consentRow({ hash: alice, ccs: ["OPD:1", "OPD:2"] })]);
  await assert.rejects(() => assertServeAllowed(ENV_H, deps, {
    consentId: "cid-1", tenantId: "hospital-a", careContexts: ["OPD:1", "OPD:2"],
    records: [{ careContextRef: "OPD:1", patientAbhaHash: alice, hiType: "OPConsultation" },
              { careContextRef: "OPD:2", patientAbhaHash: bob, hiType: "OPConsultation" }],
  }), OverShareError, "serving the in-scope half would still have leaked that Bob exists");
});

test("EXPIRED / REVOKED CONSENT: a terminal consent serves nothing", async () => {
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  for (const status of ["REVOKED", "EXPIRED", "DENIED"]) {
    const deps = guardDeps([consentRow({ hash, status })]);
    await assert.rejects(() => assertServeAllowed(ENV_H, deps, {
      consentId: "cid-1", tenantId: "hospital-a", careContexts: ["OPD:1"],
      records: [{ careContextRef: "OPD:1", patientAbhaHash: hash, hiType: "OPConsultation" }],
    }), OverShareError, status + " must refuse");
  }
});

test("NO CONSENT AT ALL: an unknown consentId fails CLOSED", async () => {
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const deps = guardDeps([]);
  await assert.rejects(() => assertServeAllowed(ENV_H, deps, {
    consentId: "never-granted", tenantId: "hospital-a", careContexts: ["OPD:1"],
    records: [{ careContextRef: "OPD:1", patientAbhaHash: hash, hiType: "OPConsultation" }],
  }), OverShareError);
  await assert.rejects(() => assertServeAllowed(ENV_H, deps, {
    consentId: null, tenantId: "hospital-a", careContexts: ["OPD:1"], records: [],
  }), OverShareError);
});

// ── duplicate callbacks ─────────────────────────────────────────────────────────────────────────────
test("DUPLICATE CALLBACK: the consent store is monotonic, so a replayed GRANT cannot undo a REVOKE", async () => {
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const h = handlerDeps({ connect_abdm_consent_req: [
    { request_id: "cid-1", consent_id: "cid-1", tenant_id: "hospital-a", status: "REVOKED",
      patient_abha_hash: hash, created_at: NOW, updated_at: NOW },
  ] });
  for (let i = 0; i < 3; i++) {
    await HIP_HANDLERS["consent-notify"]({ env: ENV_H, deps: h.deps, headers: hdrs(),
      body: { notification: { status: "GRANTED", consentId: "cid-1", consentDetail: { patient: { id: "alice@sbx" } } } } });
  }
  assert.equal(h.deps.db._tables.connect_abdm_consent_req[0].status, "REVOKED");
});

test("DUPLICATE CALLBACK: repeating a REVOKE is idempotent, not an error", async () => {
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const h = handlerDeps({ connect_abdm_consent_req: [
    { request_id: "cid-1", consent_id: "cid-1", tenant_id: "hospital-a", status: "GRANTED",
      patient_abha_hash: hash, created_at: NOW, updated_at: NOW },
  ] });
  for (let i = 0; i < 3; i++) {
    await HIP_HANDLERS["consent-notify"]({ env: ENV_H, deps: h.deps, headers: hdrs(),
      body: { notification: { status: "REVOKED", consentId: "cid-1", consentDetail: { patient: { id: "alice@sbx" } } } } });
  }
  assert.equal(h.deps.db._tables.connect_abdm_consent_req[0].status, "REVOKED");
  assert.equal(h.calls.filter((c) => c.key === "consentHipOnNotify").length, 3, "each is still acknowledged");
});

// ── malformed FHIR ──────────────────────────────────────────────────────────────────────────────────
test("MALFORMED FHIR: a degraded bundle is REJECTED by our own gate, never pushed", async () => {
  const ctx = { now: () => new Date(NOW), tenant: { id: "hospital-a" } };
  for (const bad of [null, {}, { patient: null }, { conditions: "not-an-array" }, { profile: 42 }]) {
    const doc = serializeNdhm(ctx, bad);
    const v = validateNdhmDoc(doc);
    assert.equal(v.ok, false, "a bundle built from " + JSON.stringify(bad) + " must not pass the gate");
  }
});

test("MALFORMED FHIR: the serializer never throws, so one bad record cannot kill a transfer", () => {
  const ctx = { now: () => new Date(NOW), tenant: { id: "hospital-a" } };
  for (const bad of [undefined, null, 0, "", [], { documents: [{}] }]) {
    const doc = serializeNdhm(ctx, bad);
    assert.equal(doc.resourceType, "Bundle", "always a Bundle, even a rejected one");
  }
});

test("ATTACHMENT BYTES: every profile EXCEPT HealthDocumentRecord refuses to carry them", () => {
  // The old assertion was a blanket "no bytes, ever". That is no longer true, and pretending otherwise
  // would hide a real widening: NRCES makes DocumentReference.content.attachment.data min=1, so a
  // HealthDocumentRecord without the scanned bytes is structurally INVALID. The rule is now narrower and
  // more precise - bytes for that one profile, nothing anywhere else - and this test pins exactly that.
  const ctx = { now: () => new Date(NOW), tenant: { id: "hospital-a" } };
  const withScan = (profile) => ({
    profile, patient: { id: "p1", name: { text: "A" } },
    documents: [{ id: "d0", text: "summary" },
                { id: "scan", status: "current", contentType: "application/pdf",
                  data: "JVBERi0xLjQgc3ludGhldGlj", text: "scanned report" }],
  });

  for (const profile of ["OPConsultRecord", "PrescriptionRecord", "DiagnosticReportRecord",
                         "DischargeSummaryRecord", "WellnessRecord"]) {
    const json = JSON.stringify(serializeNdhm(ctx, withScan(profile)));
    assert.ok(!json.includes("JVBERi0xLjQgc3ludGhldGlj"), profile + " must NOT carry attachment bytes");
    assert.ok(!/"data":/.test(json), profile + " must have no data element at all");
  }

  // …and HealthDocumentRecord, where the document IS the payload, does - and is valid because of it.
  const hdr = serializeNdhm(ctx, withScan("HealthDocumentRecord"));
  const json = JSON.stringify(hdr);
  assert.ok(json.includes("JVBERi0xLjQgc3ludGhldGlj"), "a health-document record carries its document");
  assert.equal(validateNdhmDoc(hdr).ok, true, JSON.stringify(validateNdhmDoc(hdr).errors));
});

test("ATTACHMENT BYTES: a HealthDocumentRecord with NO scanned bytes is REFUSED, not emitted hollow", () => {
  const ctx = { now: () => new Date(NOW), tenant: { id: "hospital-a" } };
  const doc = serializeNdhm(ctx, {
    profile: "HealthDocumentRecord", patient: { id: "p1", name: { text: "A" } },
    documents: [{ id: "d0", text: "summary" }],                 // narrative only, no bytes
  });
  assert.equal(validateNdhmDoc(doc).ok, false,
    "the HIU would otherwise see a care context that resolves to an empty document");
});

test("ATTACHMENT BYTES: a data: URI is refused everywhere, including HealthDocumentRecord", () => {
  const ctx = { now: () => new Date(NOW), tenant: { id: "hospital-a" } };
  const doc = serializeNdhm(ctx, {
    profile: "HealthDocumentRecord", patient: { id: "p1", name: { text: "A" } },
    documents: [{ id: "d0", text: "s" },
                { id: "scan", status: "current", contentType: "application/pdf",
                  data: "JVBER", url: "data:application/pdf;base64,JVBER", text: "x" }],
  });
  assert.ok(!JSON.stringify(doc).includes("data:application/pdf"), "a data: URI is never serialised");
});

// ── PHI / secret leakage ────────────────────────────────────────────────────────────────────────────
test("PHI LEAKAGE: nothing a handler audits carries a raw ABHA, mobile or Aadhaar", async () => {
  const seen = [];
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const h = handlerDeps({ connect_abdm_carecontext: [cc({ id: "1", hash, ref: "OPD:1" })] });
  h.deps.audit = async (e) => { seen.push(e); };

  await HIP_HANDLERS.discover({ env: ENV_H, deps: h.deps, headers: hdrs(),
    body: { transactionId: "tx", patient: { id: "alice@sbx", phoneNumber: "9876543210" } } });
  await HIP_HANDLERS["patient-share"]({ env: ENV_H, deps: h.deps, headers: hdrs(), body: {
    intent: "PROFILE_SHARE", metaData: { hipId: "IN2810006668", context: "1" },
    profile: { patient: { abhaAddress: "alice@sbx", abhaNumber: "91234567890123",
                          name: "Alice Kumar", phoneNumber: "9876543210" } },
  } });

  assert.ok(seen.length > 0, "the probes must be auditable at all");
  const blob = JSON.stringify(seen);
  assert.ok(!blob.includes("alice@sbx"), "no raw ABHA address in the audit trail");
  assert.ok(!blob.includes("9876543210"), "no raw mobile");
  assert.ok(!blob.includes("91234567890123"), "no raw ABHA number");
  assert.ok(!blob.includes("Alice Kumar"), "no patient name");
});

test("SECRET LEAKAGE: the ABDM credential VALUE is never in a tracked file", async () => {
  const { readFileSync } = await import("node:fs");
  const root = (f) => readFileSync(new URL("../../../" + f, import.meta.url), "utf8");
  // The clientId/clientSecret split is deliberate and documented in wrangler.toml: the id is an
  // identifier ABDM issues to the integrator and is a var; the SECRET is the credential and must only
  // ever be a Pages secret. A session cannot be obtained with the id alone.
  for (const f of ["wrangler.toml", "db/connect_abdm_schema.sql"]) {
    const src = root(f);
    assert.ok(!/ABDM_CLIENT_SECRET\s*=\s*"[^"]+"/.test(src), "ABDM_CLIENT_SECRET must never be committed in " + f);
    assert.ok(!/CONNECT_MASTER_KEY\s*=\s*"[^"]+"/.test(src), "CONNECT_MASTER_KEY must never be committed in " + f);
    assert.ok(!/CONNECT_HMAC_SALT\s*=\s*"[^"]+"/.test(src), "CONNECT_HMAC_SALT must never be committed in " + f);
  }
  // And the helper scripts source credentials from outside the repo rather than embedding them.
  const probe = root("scripts/abdm-sandbox-probe.sh");
  assert.ok(probe.includes("stewardmd-secrets"), "the probe must source credentials from outside the repo");
  assert.ok(!/clientSecret":\s*"[A-Za-z0-9]{8,}/.test(probe), "no literal secret in the probe script");
});

test("PHI LEAKAGE: an on-discover body publishes pseudonyms, never the identifier it was probed with", async () => {
  const hash = await hmacPseudonym(ENV_H, "hospital-a", "alice@sbx");
  const h = handlerDeps({ connect_abdm_carecontext: [cc({ id: "1", hash, ref: "OPD:1" })] });
  await HIP_HANDLERS.discover({ env: ENV_H, deps: h.deps, headers: hdrs(),
    body: { transactionId: "tx", patient: { id: "alice@sbx" } } });
  const body = JSON.stringify(h.calls[0].body);
  assert.ok(!body.includes("alice@sbx"), "the CM already knows the address; echoing it back is gratuitous");
  assert.ok(body.includes(hash), "the patient reference is the pseudonym");
});
