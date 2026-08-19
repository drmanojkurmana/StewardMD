// The first ABDM callbacks we have ever SEEN, driven through the real handlers.
//
// Every other suite in this directory tests a shape we reasoned our way to. This one tests three bodies
// that arrived from dev.abdm.gov.in on 2026-08-19, against a sandbox ABHA address. Their fixtures are in
// fixtures/real-callbacks.mjs, captured and identifier-masked by scripts/abdm-capture.py.
//
// Two defects fell out of the first three bodies, which is roughly the hit rate the INFERRED comments
// predicted:
//   D10  consent/request/notify can carry a top-level `error` and NO status. The handler ignored `error`
//        entirely and wrote a bare DENIED, so "the patient refused" and "the CM had nothing to share"
//        were indistinguishable afterwards.
//   D11  token/on-generate-token commonly arrives as a pure FAILURE with no token. The receiver filed it
//        as "uncorrelated" - which reads as "we could not match this to a patient" when the truth was
//        "ABDM rejected the demographics". Different problems, different fixes, so different audit lines.
//
// What these bodies also CONFIRM is as valuable as what they broke: the ABDM envelope is
// `{ ..., error: null|{code,message}, response: { requestId } }`, and `ourRequestId` / `consentRequest.id`
// were already reading it correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_CALLBACKS, OBSERVED_PATHS } from "./fixtures/real-callbacks.mjs";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { HIU_HANDLERS } from "../../../functions/_connect/abdm/hiu-handlers.js";
import { probeFromDiscovery } from "../../../functions/_connect/abdm/hip-handlers.js";
import { matchDemographics, indexPatient } from "../../../functions/_connect/abdm/demographic-index.js";

const NOW = "2026-08-19T19:41:58.000Z";
const ENV = { CONNECT_FLAG: "1", CONNECT_HIU_FLAG: "1", ABDM_ENV: "sandbox", ABDM_HIU_ID: "IN2810006668" };
const byPath = (frag) => REAL_CALLBACKS.find((c) => c.path.includes(frag));

function deps(tables = {}) {
  const audits = [], posted = [];
  return {
    audits, posted, db: makeAbdmDb(tables), now: () => new Date(NOW),
    audit: async (e) => { audits.push(e); },
    gateway: { post: async (key, body) => { posted.push({ key, body }); return { status: 202, body: {} }; } },
  };
}
const CONSENT_REQ_ID = "939bc5eb-2059-47a9-a9a1-d4041b6cbfa0";
const consentRow = (o = {}) => ({
  request_id: "req-1", tenant_id: "t1", consent_request_id: CONSENT_REQ_ID,
  status: "REQUESTED", created_at: NOW, updated_at: NOW, ...o,
});

// ── what actually arrived ───────────────────────────────────────────────────────────────────────────
test("four callbacks were captured, and every one carries ABDM's envelope", () => {
  assert.equal(REAL_CALLBACKS.length, 4);
  assert.deepEqual(OBSERVED_PATHS, [
    "/api/v3/hiu/consent/request/on-init",
    "/api/v3/hiu/consent/request/notify",
    "/api/v3/hip/token/on-generate-token",
    "/api/v3/hip/patient/care-context/discover",
  ]);
  for (const c of REAL_CALLBACKS) {
    assert.equal(c.method, "POST");
    assert.equal(c.hasBearer, true, c.path + " arrived without a bearer");
    assert.ok(c.headers["REQUEST-ID"], c.path + " has no REQUEST-ID");
    assert.ok(c.headers["TIMESTAMP"], c.path + " has no TIMESTAMP");
  }
  // The `error` envelope is on the RESPONSE-style callbacks. Discovery is a REQUEST to us and carries a
  // transactionId instead - so "every callback has an error key" would have been the wrong lesson to draw
  // from the first three bodies.
  for (const c of REAL_CALLBACKS.filter((x) => !x.path.includes("discover"))) {
    assert.ok("error" in c.body, c.path + " has no error key");
  }
  assert.ok(byPath("discover").body.transactionId, "discovery correlates by transactionId, not response.requestId");
  // The HIU callbacks carry X-HIU-ID; the HIP one carries X-HIP-ID. That is how the receiver picks a tenant.
  assert.equal(byPath("/hiu/").headers["X-HIU-ID"], "IN2810006668");
  assert.equal(byPath("/hip/token").headers["X-HIP-ID"], "IN2810006668");
});

test("the identifier masking actually held - no ABHA address reached the committed fixture", () => {
  const s = JSON.stringify(REAL_CALLBACKS);
  assert.ok(!/@sbx|@abdm/.test(s), "an ABHA address leaked into a tracked file");
  assert.ok(!/\b[6-9]\d{9}\b/.test(s), "a mobile number leaked into a tracked file");
  assert.ok(!/\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b/.test(s), "an ABHA number leaked into a tracked file");
  // A NAME is PHI that no value-regex can spot - it is masked by KEY. This was a real leak: the discovery
  // body carries patient.name and the first version of the redactor passed it straight through.
  assert.ok(!/Kurmana|Manoj/i.test(s), "a patient NAME leaked into a tracked file");
  assert.equal(byPath("discover").body.patient.name, "<name>", "the name key must be masked, not dropped");
});

// ── consent on-init: our parser was RIGHT ───────────────────────────────────────────────────────────
test("consent on-init: consentRequest.id and response.requestId parse as assumed", async () => {
  const c = byPath("consent/request/on-init");
  assert.equal(c.body.error, null, "this one succeeded");
  assert.equal(c.body.consentRequest.id, CONSENT_REQ_ID);
  assert.ok(c.body.response.requestId);

  const d = deps({ connect_abdm_consent_req: [consentRow({ consent_request_id: null })] });
  await HIU_HANDLERS["consent-on-init"]({ env: ENV, deps: d, body: { ...c.body, response: { requestId: "req-1" } }, headers: {} });
  const row = d.db._tables.connect_abdm_consent_req[0];
  assert.equal(row.consent_request_id, CONSENT_REQ_ID, "the CM's id must be attached to our row");
  assert.ok(d.audits.some((a) => a.action === "abdm.hiu.consent.init" && a.outcome === "ok"));
});

// ── D10: the notify that broke ──────────────────────────────────────────────────────────────────────
test("D10 consent notify with an ERROR and no status records the REASON, not a bare DENIED", async () => {
  const c = byPath("consent/request/notify");
  assert.equal(c.body.notification.consentRequestId, CONSENT_REQ_ID);
  assert.match(c.body.error.code, /ABDM-1120/);
  assert.equal(c.body.notification.status, undefined, "the real body carries NO status - that is the trap");

  const d = deps({ connect_abdm_consent_req: [consentRow()] });
  await HIU_HANDLERS["consent-hiu-notify"]({ env: ENV, deps: d, body: c.body, headers: {} });

  const ev = d.audits.find((a) => a.action === "abdm.hiu.consent.notify");
  assert.ok(ev, "the notify must be audited");
  assert.equal(ev.outcome, "error", "an ABDM error is not an 'ok' notify");
  assert.match(ev.scope.code, /ABDM-1120/);
  // The row still moves out of REQUESTED - the request cannot proceed - but now with a reason on record.
  assert.equal(d.db._tables.connect_abdm_consent_req[0].status, "DENIED");
  // ...and it is still ACKNOWLEDGED. An unacknowledged notify is a delivery failure to the gateway, which
  // retries - and every retry would carry the same error and be dropped the same way.
  assert.equal(d.posted.length, 1, "the error notify must still be acknowledged");
  assert.equal(d.posted[0].key, "consentHiuOnNotify");
});

test("D10 regression: a real GRANTED notify is untouched by the error branch", async () => {
  // The fix must not swallow the success path. No captured GRANT yet (it needs a tap in the ABHA app), so
  // this is still a constructed body - marked as such rather than passed off as evidence.
  const granted = { notification: { consentRequestId: CONSENT_REQ_ID, status: "GRANTED", consentArtefacts: [] } };
  const d = deps({ connect_abdm_consent_req: [consentRow()] });
  await HIU_HANDLERS["consent-hiu-notify"]({ env: ENV, deps: d, body: granted, headers: {} });
  const ev = d.audits.find((a) => a.action === "abdm.hiu.consent.notify");
  assert.equal(ev.outcome, "ok");
  assert.equal(d.db._tables.connect_abdm_consent_req[0].status, "GRANTED");
});

// ── D11: the link-token failure ─────────────────────────────────────────────────────────────────────
test("D11 on-generate-token arrives as a pure FAILURE - no token, only an error", () => {
  const c = byPath("token/on-generate-token");
  assert.match(c.body.error.code, /ABDM-1207/);
  assert.match(c.body.error.message, /does not match the details on record with Aadhaar/i);
  assert.ok(c.body.response.requestId);
  // The shape our old code hoped for is simply absent. It is not nested, not renamed - it is not there.
  assert.equal(c.body.linkToken, undefined);
  assert.equal(c.body.accessToken, undefined);
  assert.equal(c.body.link, undefined);
});

test("D11 the receiver files it as a link-token FAILURE, not as 'uncorrelated'", async () => {
  // The two outcomes need different fixes, so they must not share an audit line. "uncorrelated" means we
  // could not identify the patient; this was ABDM rejecting the demographics we sent.
  const { onGenerateToken } = await import("../../../functions/api/v3/[[path]].js");
  const c = byPath("token/on-generate-token");
  const audits = [];
  const d = { now: () => NOW, audit: async (e) => { audits.push(e); }, correlate: null };

  await onGenerateToken({ env: ENV, deps: d, body: c.body });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "abdm.linktoken.failed");
  assert.equal(audits[0].outcome, "error");
  assert.match(audits[0].detail, /ABDM-1207/);
  assert.match(audits[0].detail, /Aadhaar/i);
  assert.equal(audits[0].transactionId, c.body.response.requestId, "the requestId correlates it to our call");
});

test("D11 a token-less body with NO error is still 'uncorrelated' - the old path survives", async () => {
  const { onGenerateToken } = await import("../../../functions/api/v3/[[path]].js");
  const audits = [];
  const d = { now: () => NOW, audit: async (e) => { audits.push(e); }, correlate: null };
  await onGenerateToken({ env: ENV, deps: d, body: { response: { requestId: "r-1" } } });
  assert.equal(audits[0].action, "abdm.linktoken.uncorrelated");
  assert.equal(audits[0].outcome, "skipped");
});

test("D11 a SUCCESSFUL token is still cached - the error branch must not shadow it", async () => {
  const { onGenerateToken } = await import("../../../functions/api/v3/[[path]].js");
  const puts = [];
  const d = {
    now: () => NOW, audit: async () => {}, correlate: async () => "abha-hash-1",
    kv: { put: async (k, v, o) => { puts.push({ k, v, o }); }, get: async () => null },
  };
  await onGenerateToken({ env: { ...ENV, ABDM_HIP_ID: "IN2810006668" }, deps: d,
    body: { linkToken: "tok-abc", error: null, response: { requestId: "r-1" } } });
  assert.equal(puts.length, 1, "a real token must still be cached");
  assert.match(JSON.stringify(puts[0]), /tok-abc/);
});

// ── D12: the discovery probe, and the arm that could never have fired ───────────────────────────────
test("D12 the real probe carries identifier ARRAYS, not the flat fields the matcher wanted", () => {
  const p = byPath("discover").body.patient;
  // This is the shape nothing in the spec text told us about.
  assert.equal(p.mobile, undefined, "there is NO patient.mobile - that was the whole defect");
  assert.equal(p.mrn, undefined);
  assert.ok(Array.isArray(p.verifiedIdentifiers));
  assert.equal(p.unverifiedIdentifiers, null, "NULL, not [] - iterating it directly would throw");
  const types = p.verifiedIdentifiers.map((i) => i.type);
  assert.deepEqual(types, ["MOBILE", "ABHA_NUMBER", "abhaAddress"]);
  // Casing is INCONSISTENT in ABDM's own payload: two upper-snake, one camelCase.
  assert.notEqual(types[2], types[2].toUpperCase(), "abhaAddress really is camelCase on the wire");
  // ABHA_NUMBER is an EMPTY STRING, not an absent key.
  assert.equal(p.verifiedIdentifiers.find((i) => i.type === "ABHA_NUMBER").value, "");
});

test("D12 probeFromDiscovery flattens it into what the matcher actually reads", () => {
  const probe = probeFromDiscovery(byPath("discover").body.patient);
  assert.ok(probe.mobile, "the VERIFIED mobile must reach the matcher - ABDM's primary arm");
  assert.equal(probe.gender, "M");
  assert.equal(probe.yearOfBirth, 1997);
  assert.ok(probe.abhaAddress, "the address resolves from patient.id or the abhaAddress identifier");
  assert.equal(probe.abhaNumber, null, 'an empty-string ABHA_NUMBER is not an identifier');
  assert.equal(probe.mrn, null, "no MR number was declared");
});

test("D12 an unverified MR number stays UNVERIFIED - it is patient-declared, never trusted alone", () => {
  const probe = probeFromDiscovery({
    id: "x@sbx", gender: "F", yearOfBirth: 1990, name: "N",
    verifiedIdentifiers: [{ type: "MOBILE", value: "9000000001" }],
    unverifiedIdentifiers: [{ type: "MR", value: "MRN-77" }],
  });
  assert.equal(probe.mobile, "9000000001");
  assert.equal(probe.mrn, "MRN-77");
});

test("D12 hostile probes do not crash the flattener", () => {
  for (const bad of [null, undefined, {}, [], "x", 42,
                     { verifiedIdentifiers: null }, { verifiedIdentifiers: "no" },
                     { verifiedIdentifiers: [null, 1, { type: null, value: null }] },
                     { verifiedIdentifiers: [{ type: "MOBILE", value: "   " }] }]) {
    const p = probeFromDiscovery(bad);
    assert.equal(typeof p, "object");
    assert.ok(p.mobile === null || typeof p.mobile === "string");
  }
  // A whitespace-only value is not a mobile number.
  assert.equal(probeFromDiscovery({ verifiedIdentifiers: [{ type: "MOBILE", value: "   " }] }).mobile, null);
});

test("D12 END TO END: the real probe now MATCHES an indexed patient - before the fix it could not", async () => {
  // The point of the whole demographic matcher. Index a patient whose details are the ones the real probe
  // carries, then run the REAL captured body through the flattener and the matcher.
  const ENVX = { CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64") };
  const raw = byPath("discover").body.patient;
  // The captured fixture is masked, so substitute a stand-in mobile for both sides of the comparison; the
  // SHAPE is the evidence here, not the digits.
  const probeRaw = { ...raw, verifiedIdentifiers: raw.verifiedIdentifiers.map((i) => i.type === "MOBILE" ? { ...i, value: "9876543210" } : i), name: "Ramesh Kumar" };
  const d = { db: makeAbdmDb({}), now: () => NOW };
  await indexPatient(ENVX, d, {
    tenantId: "t1", patientRef: "MR-001",
    name: "Ramesh Kumar", mobile: "9876543210", gender: "M", yearOfBirth: 1997,
  });

  const flat = probeFromDiscovery(probeRaw);
  const hit = await matchDemographics(ENVX, d, { tenantId: "t1", probe: flat });
  assert.equal(hit.matched, true, hit.reason);
  assert.deepEqual(hit.matchedBy, ["MOBILE"]);
  assert.equal(hit.patientRef, "MR-001");

  // ...and the un-flattened body, which is exactly what the old code passed, still cannot match.
  const missed = await matchDemographics(ENVX, d, { tenantId: "t1", probe: probeRaw });
  assert.equal(missed.matched, false, "the raw ABDM body has no probe.mobile, so the mobile arm is dead");
});
