/* test/wardsynq-claims-audit-fixes.test.mjs - insurance-claim defects from the 2026-09-27 audit (BILL-08, 09, 10, 15, 16,
 * 17, 18, 21), each through the real /api/queue router where a route is involved.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-claims-audit-fixes.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { as, seed, H, ENV, ORG_ID, ADMIN, CASHIER, DOCTOR } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const A = await import("../wardsynq/wardsynq-nhcx-adapter.js");
const { codeClaim, submit, deny, settle, moveBalanceToPatient, BillingError } = await import("../wardsynq/wardsynq-billing.js");
const { scrubClaim } = await import("../functions/_wardsynq/claims-ops.js");
const { payerRuleWarnings } = await import("../wardsynq/wardsynq-tpa-adapter.js");

/* ---- NHCX keys made fresh per run, as in wardsynq-nhcx.test.mjs ---- */
const subtle = crypto.subtle;
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const len = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
const tlv = (tag, ...parts) => { const body = cat(...parts); return cat(new Uint8Array([tag, ...len(body.length)]), body); };
const u8 = (a) => new Uint8Array(a);
const SHA256_RSA = tlv(0x30, u8([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b, 0x05, 0x00]));
const nameOf = (cn) => tlv(0x30, tlv(0x31, tlv(0x30, u8([0x06, 0x03, 0x55, 0x04, 0x03]), tlv(0x0c, new TextEncoder().encode(cn)))));
const pem = (label, der) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
async function certFor(publicKey, cn) {
  const spki = u8(await subtle.exportKey("spki", publicKey));
  const validity = tlv(0x30, tlv(0x17, new TextEncoder().encode("260101000000Z")), tlv(0x17, new TextEncoder().encode("360101000000Z")));
  const tbs = tlv(0x30, tlv(0xa0, tlv(0x02, u8([2]))), tlv(0x02, u8([1])), SHA256_RSA, nameOf(cn), validity, nameOf(cn), spki);
  const signer = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: u8([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const sig = u8(await subtle.sign("RSASSA-PKCS1-v1_5", signer.privateKey, tbs));
  return pem("CERTIFICATE", tlv(0x30, tbs, SHA256_RSA, tlv(0x03, u8([0]), sig)));
}
const oaepPair = () => subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: u8([1, 0, 1]), hash: "SHA-1" }, true, ["encrypt", "decrypt"]);
const signPair = () => subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: u8([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const payerKeys = await oaepPair(), hospKeys = await oaepPair(), gatewayKeys = await signPair();
const PAYER_CERT = await certFor(payerKeys.publicKey, "payer"), HOSP_CERT = await certFor(hospKeys.publicKey, "hospital"), GATEWAY_CERT = await certFor(gatewayKeys.publicKey, "gateway");
const HOSP_PRIVATE = pem("PRIVATE KEY", u8(await subtle.exportKey("pkcs8", hospKeys.privateKey))); // security-scan: allow key generated at test runtime, never committed
async function jwt(claims) {
  const b64 = (o) => A.b64uEncode(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  return `${input}.${A.b64uEncode(u8(await subtle.sign("RSASSA-PKCS1-v1_5", gatewayKeys.privateKey, new TextEncoder().encode(input))))}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
const GATEWAY = "https://93.184.216.40/api/v0.8";
const SETTINGS = { ref: "icici", gatewayUrl: GATEWAY, senderCode: "1000-hosp", recipientCode: "2000-icici", username: "billing@hosp.test", providerName: "WSQ Ward Hospital" };
const SECRETS = { secret: "nhcx-participant-secret-0001", encryptionCert: PAYER_CERT.replace(/\n/g, ""), signingCert: GATEWAY_CERT, privateKey: HOSP_PRIVATE };
const saveNhcx = (over) => as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payer", provider: "nhcx", name: "ICICI Lombard", settings: SETTINGS, secrets: SECRETS, ...(over || {}) });

/** A gateway: token, then 202 for any protocol path (or what `over` answers). Records each call. */
function gateway(seen, over) {
  return async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith("/participant/auth/token/generate")) return new Response(JSON.stringify({ access_token: "gw-access-token", expires_in: 6000 }), { status: 200 });
    if (over) { const r = await over(url, init); if (r) return r; }
    const hdr = A.peekJweHeader(JSON.parse(init.body).payload);
    return new Response(JSON.stringify({ timestamp: "1629057611000", api_call_id: hdr["x-hcx-api_call_id"], correlation_id: hdr["x-hcx-correlation_id"] }), { status: 202 });
  };
}
const sends = (seen, path) => seen.filter((s) => s.url === `${GATEWAY}${path}`).length;
async function answer(correlationId, resource) {
  const header = { "x-hcx-sender_code": "2000-icici", "x-hcx-recipient_code": "1000-hosp", "x-hcx-api_call_id": crypto.randomUUID(), "x-hcx-correlation_id": correlationId, "x-hcx-timestamp": new Date().toISOString() };
  const payload = await A.encryptJwe(header, { resourceType: "Bundle", type: "collection", entry: [{ resource }] }, await A.importEncryptionKey(HOSP_CERT));
  return { body: { payload }, headers: { authorization: `Bearer ${await jwt({ jti: crypto.randomUUID(), iss: "nhcx-gateway", sub: "2000-icici", iat: nowS(), exp: nowS() + 300 })}` } };
}
const deliver = (path, a) => as(null, `/nhcx-callback/${ORG_ID}/${path}`, "POST", a.body, a.headers);

/* ---- the ward ---- */
let mobile = 9876540000;
async function admitWithProblem() {
  mobile++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Claim Audit Person", mobile: String(mobile), gender: "female", ageYears: 50 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: String(mobile).slice(-2) });
  assert.equal(adm.__status, 200, adm.__text);
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG_ID, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "I10", display: "Essential hypertension" } });
  return { ...adm, mrn: reg.mrn };
}
const discharge = async (encounterId) => {
  const r = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG_ID, encounterId, disposition: "home", billDeferredReason: "Billed separately in this test", overrideReason: "Open items accepted in this test" });
  assert.equal(r.__status, 200, r.__text);
  return r;
};
const post = (path, body) => as(CASHIER, path, "POST", { orgId: ORG_ID, ...body });
const claimsOf = async (patientId) => (await as(CASHIER, `/ward/claims?orgId=${ORG_ID}&patientId=${patientId}`)).claims;
const PAYERS = { payers: [{ id: "paper", name: "Paper TPA", adapter: "manual" }, { id: "star", name: "Star Health", adapter: "manual", rules: { preauthRequiredAbove: 10000, timelyFilingDays: 30 } }] };

test("BILL-08: submit needs a coded claim and deny a submitted or queried one; a paid claim is never resubmitted, re-settled or denied", async () => {
  const rec = { conditions: [{ code: "I10" }] };
  const coded = () => codeClaim({ encounterId: "e", patientId: "p", record: rec, codes: ["I10"], codedBy: "c", now: "2026-09-01T00:00:00Z" });
  const sent = submit(coded(), { by: "c" });
  assert.throws(() => submit(sent, { by: "c" }), (e) => e instanceof BillingError && e.code === "NOT_CODED");
  assert.throws(() => deny(coded(), { reason: "r" }), (e) => e instanceof BillingError && e.code === "NOT_SUBMITTED");

  seed(PAYERS);
  const adm = await admitWithProblem();
  const claim = await post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "paper" });
  assert.equal((await post("/ward/claim-state", { claimId: claim.claimId, action: "submit", submittedAmount: 5000 })).state, "submitted");
  const again = await post("/ward/claim-state", { claimId: claim.claimId, action: "submit", submittedAmount: 5000 });
  assert.equal(again.__status, 422, again.__text);
  assert.equal(again.code, "NOT_CODED");
  const paid = await post("/ward/claim-state", { claimId: claim.claimId, action: "settle", paidAmount: 3000 });
  assert.equal(paid.state, "paid", paid.__text);
  const moved = await post("/ward/claim-state", { claimId: claim.claimId, action: "balance-to-patient", amount: 2000, reason: "co-pay" });
  assert.equal(moved.__status, 200, moved.__text);
  for (const [action, extra] of [["submit", { submittedAmount: 5000 }], ["deny", { reason: "late" }], ["settle", { paidAmount: 1000 }], ["resubmit", { reason: "again" }]]) {
    const r = await post("/ward/claim-state", { claimId: claim.claimId, action, ...extra });
    assert.equal(r.__status, 422, `${action} on a paid claim: ${r.__text}`);
  }
  const after = (await claimsOf(adm.patientId)).find((c) => c.id === claim.claimId);
  assert.equal(after.state, "paid");
  assert.equal(after.settlement.paidAmount, 3000, "the first settlement stands");
  assert.equal(after.history.filter((h) => h.event === "balance-moved-to-patient").length, 1);
});

test("BILL-09: two submits at once reach the payer once; a failed record after a send says it was sent", async () => {
  seed();
  assert.equal((await saveNhcx()).__status, 200);
  const seen = [];
  ENV.WSQ_TPA_FETCH = gateway(seen);
  try {
    const adm = await admitWithProblem();
    const claim = await post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "icici", policyNumber: "POL-1" });
    const [a, b] = await Promise.all([1, 2].map(() => post("/ward/claim-state", { claimId: claim.claimId, action: "submit", submittedAmount: 5000 })));
    assert.deepEqual([a.__status, b.__status].sort(), [200, 409], `${a.__text} | ${b.__text}`);
    assert.equal(sends(seen, "/claim/submit"), 1, "the payer received the claim once");

    // The send succeeds and the record write after it fails: the answer says the claim went.
    const adm2 = await admitWithProblem();
    const claim2 = await post("/ward/claim", { patientId: adm2.patientId, encounterId: adm2.encounterId, codes: ["I10"], payerId: "icici", policyNumber: "POL-2" });
    let failNext = false;
    ENV.WSQ_TPA_FETCH = gateway(seen, async (url) => { if (url.endsWith("/claim/submit")) failNext = true; return null; });
    const append = H.RECORD.append.bind(H.RECORD);
    H.RECORD.append = async (t, recs, ctx) => {
      if (failNext && recs.some((r) => r.resourceType === "Claim")) { failNext = false; throw new Error("store unavailable"); }
      return append(t, recs, ctx);
    };
    const r = await post("/ward/claim-state", { claimId: claim2.claimId, action: "submit", submittedAmount: 5000 });
    H.RECORD.append = append;
    assert.equal(r.__status, 502, r.__text);
    assert.equal(r.sent, true, r.__text);
    assert.match(r.message, /reached the payer/);
    const again = await post("/ward/claim-state", { claimId: claim2.claimId, action: "submit", submittedAmount: 5000 });
    assert.equal(again.__status, 409, "a second send is refused while the first one's outcome is unrecorded: " + again.__text);
    assert.equal(again.error, "submission_in_progress");
    // Past the send window the request that held it is gone: the claim is released, and its history says so.
    const held = H.RECORD._rows.filter((r) => r.id === claim2.claimId).pop();
    held.body.sending.at = new Date(Date.now() - 10 * 60000).toISOString();
    const released = await post("/ward/claim-state", { claimId: claim2.claimId, action: "submit", submittedAmount: 5000 });
    assert.equal(released.__status, 200, released.__text);
    assert.equal(released.claim.sending, undefined);
    assert.ok(released.claim.history.some((h) => h.event === "send-outcome-unrecorded"));
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("BILL-10: a claim the payer never received stays coded with the attempt recorded, and can be sent again", async () => {
  seed();
  assert.equal((await saveNhcx()).__status, 200);
  const seen = [];
  ENV.WSQ_TPA_FETCH = gateway(seen);
  try {
    const adm = await admitWithProblem();
    const claim = await post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "icici" });
    const r = await post("/ward/claim-state", { claimId: claim.claimId, action: "submit", submittedAmount: 15000 });
    assert.equal(r.__status, 502, r.__text);
    assert.equal(r.error, "claim_not_sent");
    assert.equal(sends(seen, "/claim/submit"), 0);
    const kept = (await claimsOf(adm.patientId)).find((c) => c.id === claim.claimId);
    assert.equal(kept.state, "coded", "never marked submitted");
    assert.equal(kept.submittedAt, undefined);
    assert.equal(kept.adapter.state, "failed");
    assert.ok(kept.history.some((h) => h.event === "not-sent"), JSON.stringify(kept.history));

    const retry = await post("/ward/claim-state", { claimId: claim.claimId, action: "submit", submittedAmount: 15000, policyNumber: "POL-7" });
    assert.equal(retry.__status, 200, retry.__text);
    assert.equal(retry.state, "submitted");
    assert.equal(retry.claim.adapter.state, "sent");
    assert.equal(sends(seen, "/claim/submit"), 1);
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("BILL-15: two connectors on one NHCX payer code; the second one's answer lands on its claim", async () => {
  seed();
  assert.equal((await saveNhcx()).__status, 200);
  assert.equal((await saveNhcx({ name: "ICICI via group policy", settings: { ...SETTINGS, ref: "icici-group" } })).__status, 200);
  const seen = [];
  ENV.WSQ_TPA_FETCH = gateway(seen);
  try {
    const adm = await admitWithProblem();
    const claim = await post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "icici-group", policyNumber: "POL-2" });
    const sub = await post("/ward/claim-state", { claimId: claim.claimId, action: "submit", submittedAmount: 15000 });
    assert.equal(sub.__status, 200, sub.__text);
    const res = await deliver("claim/on_submit", await answer(sub.claim.adapter.exchange.correlationId, { resourceType: "ClaimResponse", id: "CR-9", status: "active", use: "claim", outcome: "complete",
      total: [{ category: { coding: [{ code: "benefit" }] }, amount: { value: 12000, currency: "INR" } }] }));
    assert.equal(res.__status, 202, res.__text);
    const after = (await claimsOf(adm.patientId)).find((c) => c.id === claim.claimId);
    assert.deepEqual([after.adapter.state, after.approvedAmount], ["acknowledged", 12000]);
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("BILL-16: the checklist does not accept an approval from an earlier stay", async () => {
  const payer = { id: "star", name: "Star Health", rules: { preauthRequiredAbove: 10000 } };
  const claim = { id: "c2", encounterId: "enc2", patientId: "p1", payerId: "star", codes: [{ code: "I10" }], submittedAmount: 240000 };
  const old = { id: "pa-old", patientId: "p1", payerId: "star", treatment: "Knee replacement", state: "approved", authorizedAmount: 250000, decidedAt: "2026-03-01T09:00:00Z" };
  const stays = [{ id: "enc1", patientId: "p1", class: "IPD", periodStart: "2026-03-02T08:00:00Z", periodEnd: "2026-03-10T08:00:00Z" }, { id: "enc2", patientId: "p1", class: "IPD", periodStart: "2026-09-20T08:00:00Z" }];
  const facts = (preAuths, encounters) => ({ conditions: [], preAuths, packageAssignment: null, encounter: stays[1], encounters, dischargeSummary: null, invoice: null });
  const earlier = scrubClaim(claim, facts([old], stays), { payer });
  assert.deepEqual(earlier.blocking.map((f) => f.code), ["preauth_missing"], "last stay's approval does not count");
  const current = { ...old, id: "pa-new", decidedAt: "2026-09-18T09:00:00Z" };
  assert.equal(scrubClaim(claim, facts([old, current], stays), { payer }).clean, true, "this stay's approval does");
  assert.deepEqual(scrubClaim(claim, facts([current], undefined), { payer }).blocking.map((f) => f.code), ["preauth_unchecked"], "stays unread: said as unchecked");

  // Through the route: stay 1 with an approval, discharged; stay 2 claimed above the payer's threshold.
  seed(PAYERS);
  const adm = await admitWithProblem();
  assert.equal((await post("/ward/preauth", { patientId: adm.patientId, treatment: "Knee replacement", state: "approved", payerId: "star", authorizedAmount: 250000, decidedAt: "2026-01-01T00:00:00.000Z" })).__status, 200);
  await discharge(adm.encounterId);
  const adm2 = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: adm.mrn, ward: "Medical A", bed: "77" });
  assert.equal(adm2.__status, 200, adm2.__text);
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG_ID, problem: { patientId: adm2.patientId, encounterId: adm2.encounterId, code: "I25.1", display: "Coronary artery disease" } });
  const claim2 = await post("/ward/claim", { patientId: adm2.patientId, encounterId: adm2.encounterId, codes: ["I25.1"], payerId: "star" });
  const r = await post("/ward/claim-state", { claimId: claim2.claimId, action: "submit", submittedAmount: 240000 });
  assert.equal(r.__status, 422, r.__text);
  assert.deepEqual(r.findings.map((f) => f.code), ["preauth_missing"]);
});

test("BILL-17: a claim coded after discharge carries the discharge date, and timely filing counts from it", async () => {
  seed(PAYERS);
  const adm = await admitWithProblem();
  await discharge(adm.encounterId);
  const enc = await H.RECORD.latest("tenant-wsq", "Encounter", adm.encounterId);
  assert.ok(enc.periodEnd, "the stay has ended");
  const claim = await post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "star" });
  assert.equal(claim.__status, 200, claim.__text);
  assert.equal(claim.claim.dischargedAt, enc.periodEnd);
  const later = new Date(Date.parse(enc.periodEnd) + 31 * 86400000).toISOString();
  assert.match(payerRuleWarnings(claim.claim, PAYERS.payers[1], { now: later }).join(" "), /30 days from discharge has passed/);
});

test("BILL-18: a retried Code claim returns the stay's open claim; a retried pre-auth request with the same key is not sent again", async () => {
  seed(PAYERS);
  const adm = await admitWithProblem();
  const c1 = await post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "paper", idempotencyKey: "k-claim-1" });
  await new Promise((r) => setTimeout(r, 5));
  const c2 = await post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "paper", idempotencyKey: "k-claim-2" });
  assert.equal(c2.__status, 200, c2.__text);
  assert.equal(c2.claimId, c1.claimId);
  assert.equal(c2.existing, true);
  assert.equal((await claimsOf(adm.patientId)).filter((c) => c.encounterId === adm.encounterId).length, 1);

  assert.equal((await saveNhcx()).__status, 200);
  const seen = [];
  ENV.WSQ_TPA_FETCH = gateway(seen);
  try {
    const body = { patientId: adm.patientId, treatment: "PTCA", state: "requested", payerId: "icici", requestedAmount: 50000, policyNumber: "POL-2", codes: ["I10"], idempotencyKey: "k-preauth-1" };
    const p1 = await post("/ward/preauth", body);
    assert.equal(p1.__status, 200, p1.__text);
    await new Promise((r) => setTimeout(r, 5));
    const p2 = await post("/ward/preauth", body);
    assert.equal(p2.__status, 200, p2.__text);
    assert.equal(p2.preAuthId, p1.preAuthId, "the retry replays the first answer");
    assert.equal(sends(seen, "/preauth/submit"), 1, "the payer received one request");
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("BILL-18: two Code claim requests for one stay at the same moment make exactly one claim", async () => {
  seed(PAYERS);
  const adm = await admitWithProblem();
  const [a, b] = await Promise.all([1, 2].map(() => post("/ward/claim", { patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "paper" })));
  assert.deepEqual([a.__status, b.__status], [200, 200], `${a.__text} | ${b.__text}`);
  assert.equal(a.claimId, b.claimId, "both answers name the one claim");
  assert.equal([a, b].filter((r) => r.existing).length, 1, "the second is told it got the existing claim");
  assert.equal((await claimsOf(adm.patientId)).filter((c) => c.encounterId === adm.encounterId).length, 1);
});

test("BILL-21: with no submitted amount on the claim, nothing moves to the patient", () => {
  const claim = settle({ state: "submitted", history: [] }, { paidAmount: 1000, by: "cashier" });
  assert.equal(claim.settlement.outstandingAmount, null);
  assert.throws(() => moveBalanceToPatient(claim, { amount: 999999, reason: "co-pay", by: "cashier" }), (e) => e instanceof BillingError && e.code === "NO_OUTSTANDING");
  assert.equal(claim.settlement.balanceWith, "unassigned");
});
