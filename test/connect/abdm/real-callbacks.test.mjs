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
test("three callbacks were captured, and every one carries ABDM's envelope", () => {
  assert.equal(REAL_CALLBACKS.length, 3);
  assert.deepEqual(OBSERVED_PATHS, [
    "/api/v3/hiu/consent/request/on-init",
    "/api/v3/hiu/consent/request/notify",
    "/api/v3/hip/token/on-generate-token",
  ]);
  for (const c of REAL_CALLBACKS) {
    assert.equal(c.method, "POST");
    assert.equal(c.hasBearer, true, c.path + " arrived without a bearer");
    assert.ok(c.headers["REQUEST-ID"], c.path + " has no REQUEST-ID");
    assert.ok(c.headers["TIMESTAMP"], c.path + " has no TIMESTAMP");
    // `error` is ALWAYS present - null on success, an object on failure. Nothing may treat it as optional.
    assert.ok("error" in c.body, c.path + " has no error key");
  }
  // The HIU callbacks carry X-HIU-ID; the HIP one carries X-HIP-ID. That is how the receiver picks a tenant.
  assert.equal(byPath("/hiu/").headers["X-HIU-ID"], "IN2810006668");
  assert.equal(byPath("/hip/token").headers["X-HIP-ID"], "IN2810006668");
});

test("the identifier masking actually held - no ABHA address reached the committed fixture", () => {
  const s = JSON.stringify(REAL_CALLBACKS);
  assert.ok(!/@sbx|@abdm/.test(s), "an ABHA address leaked into a tracked file");
  assert.ok(!/\b[6-9]\d{9}\b/.test(s), "a mobile number leaked into a tracked file");
  assert.ok(!/\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b/.test(s), "an ABHA number leaked into a tracked file");
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
