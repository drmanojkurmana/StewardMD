/* test/wardsynq-abdm-share.test.mjs - ABDM Scan and Share at a WardSynQ hospital (functions/_wardsynq/abdm-share.js).
 * Routes: GET "/ward/abdm-share" (queue.view), POST "/ward/abdm-share-register" (queue.add).
 * Also: issueShareToken (the token seam bound in functions/api/v3) and hip-handlers onPatientShare's failure answer. */
import { as, seed, docs, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { sharingCounters, issueShareToken, GENERAL_COUNTER, SHARE_TOKEN_EXPIRY_SEC } = await import("../functions/_wardsynq/abdm-share.js");
const { shareProfileUrl, connectionOf } = await import("../functions/_wardsynq/abdm-connect.js");
const { readAbhaProof } = await import("../functions/_wardsynq/abdm-desk.js");
const { makeAbdmDb } = await import("../functions/_connect/abdm/abdm-testkit.js");
const { HIP_HANDLERS } = await import("../functions/_connect/abdm/hip-handlers.js");

const HIP = "IN2810006668";
ENV.ABDM_CLIENT_SECRET = "bridge-secret-for-tests";
ENV.CONNECT_HMAC_SALT = Buffer.from("connect-test-hmac-salt-key-1234").toString("base64");
ENV.CONNECT_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");

const tenantRow = (id, settings) => ({ id, name: id, status: "active", mode: "live", settings: JSON.stringify(settings) });
const tenantDb = () => makeAbdmDb({ connect_tenant: [
  tenantRow("tenant-wsq", { wardsynq: { orgId: ORG_ID } }),
  tenantRow("tenant-other", { wardsynq: { orgId: OTHER } }),
  tenantRow("tenant-native", {}),
] });

const PATIENT = { name: "Ramesh Kumar", gender: "M", yearOfBirth: "1980", mobile: "9876543210",
  abhaNumber: "91-2345-6789-0123", abhaAddress: "ramesh@sbx", address: { line: "12 MG Road", district: "Pune", state: "MH", pinCode: "411001" } };
const DEPT = "dep-card";

function seedHospital({ departmentScope } = {}) {
  seed();
  const org = docs.get(`q_orgs/${ORG_ID}`).fields;
  org.regionProfile = { hfrId: HIP };
  if (departmentScope) org.tokens = { scope: "department", prefixes: {}, deptAliases: {} };
  docs.set(`q_departments/${DEPT}`, { fields: { id: DEPT, orgId: ORG_ID, name: "Cardiology", code: "C", type: "general", active: true }, updateTime: "t1" });
  docs.set("q_departments/dep-old", { fields: { id: "dep-old", orgId: ORG_ID, name: "Closed Ward", code: "X", type: "general", active: false }, updateTime: "t1" });
}
async function connect() {
  const base = { orgId: ORG_ID, kind: "abdm", provider: "shared-bridge" };
  for (const settings of [{ hfrFacilityId: HIP, status: "draft" }, { hfrFacilityId: HIP, status: "submitted" }, { hfrFacilityId: HIP, status: "sandbox-linked", hipId: HIP, hiuId: HIP }]) {
    const r = await as(ADMIN, "/ward/connector-save", "POST", { ...base, settings });
    assert.equal(r.__status, 200, r.__text);
  }
}
const view = (who, orgId) => as(who, `/ward/abdm-share?orgId=${orgId || ORG_ID}`);
const register = (who, body) => as(who, "/ward/abdm-share-register", "POST", { orgId: ORG_ID, ...body });
const share = (tenantId, context, patient) => issueShareToken(ENV, { db: tenantDb() }, { tenantId, context, hipId: HIP, patient: patient || PATIENT });
const ticketsSnapshot = () => JSON.stringify([...docs].filter(([p]) => p.startsWith("q_tickets/")));

/* ---- the QR counters (PURE) ------------------------------------------------------------------------------ */

test("sharingCounters / shareProfileUrl: ABDM's hyphenated share-profile URL per counter, none when not connected", () => {
  const conn = connectionOf({ active: true, settings: { status: "sandbox-linked", hipId: HIP, hfrFacilityId: HIP } }, { ABDM_CLIENT_SECRET: "x" });
  assert.equal(conn.connected, true);
  // D13 (docs/connect/abdm/V3-SPEC-RECONCILIATION.md): hip-id and counter-id, hyphenated.
  assert.equal(shareProfileUrl(conn, "desk"), `https://phrsbx.abdm.gov.in/share-profile?hip-id=${HIP}&counter-id=desk`);
  assert.equal(shareProfileUrl(connectionOf(null), "desk"), null);
  assert.equal(shareProfileUrl(conn, "bad id!"), null);

  const departments = [
    { id: DEPT, name: "Cardiology", code: "C", active: true },
    { id: "dep-ortho", name: "", code: "O", active: true },
    { id: "dep-old", name: "Closed Ward", active: false },
    { id: "bad id!", name: "Unsafe", active: true },
    null,
  ];
  const general = sharingCounters(conn, { tokens: { scope: "hospital" } }, departments);
  assert.deepEqual(general.map((c) => c.counterId), [GENERAL_COUNTER, DEPT, "dep-ortho"], "inactive and unsafe ids are skipped");
  assert.equal(general[0].departmentId, null);
  assert.equal(general[1].url, `https://phrsbx.abdm.gov.in/share-profile?hip-id=${HIP}&counter-id=${DEPT}`);
  assert.equal(general[2].name, "O", "a department with no name shows its code");

  const perDept = sharingCounters(conn, { tokens: { scope: "department" } }, departments);
  assert.deepEqual(perDept.map((c) => c.counterId), [DEPT, "dep-ortho"], "no general desk QR when every token needs a department");

  assert.deepEqual(sharingCounters(connectionOf(null), {}, departments), [], "not connected: no QR at all");
});

/* ---- who may see and register ---------------------------------------------------------------------------- */

test("negative authorization: no session 401; hr 403 on register; another hospital's admin 403 on both; nothing written", async () => {
  seedHospital({ departmentScope: true });
  await connect();
  const issued = await share(T, DEPT);
  const before = writesNow(), tickets = ticketsSnapshot();

  assert.equal((await view(null)).__status, 401);
  assert.equal((await register(null, { ticketId: issued.ticketId, mrn: "MRN-1" })).__status, 401);
  const hr = await register(HR, { ticketId: issued.ticketId, mrn: "MRN-1" });
  assert.equal(hr.__status, 403, hr.__text);
  const otherView = await view(OTHER_ADMIN);
  assert.equal(otherView.__status, 403, otherView.__text);
  assert.ok(!otherView.__text.includes("Ramesh"));
  const otherReg = await register(OTHER_ADMIN, { ticketId: issued.ticketId, mrn: "MRN-1" });
  assert.equal(otherReg.__status, 403, otherReg.__text);

  assert.equal(writesNow(), before, "no refused call wrote a record");
  assert.equal(ticketsSnapshot(), tickets, "no refused call touched a ticket");
  assert.equal(docs.get(`q_tickets/${issued.ticketId}`).fields.ghisPatientId, "");
});

test("GET not connected: 200 with the reason code and no counters", async () => {
  seedHospital();
  const r = await view(NURSE);
  assert.equal(r.__status, 200, r.__text);
  assert.equal(r.connection.connected, false);
  assert.equal(r.connection.code, "not_set_up");
  assert.deepEqual(r.counters, []);
  assert.deepEqual(r.shares, []);
});

/* ---- the share, the desk, the registration --------------------------------------------------------------- */

test("positive: a share is queued in the counter's department, listed with its sealed profile and a desk proof, then registered once", async () => {
  seedHospital({ departmentScope: true });
  await connect();

  const issued = await share(T, DEPT);
  assert.equal(issued.tokenNumber, "C-001");
  assert.equal(issued.expirySec, 1800);
  assert.equal(SHARE_TOKEN_EXPIRY_SEC, 1800);
  const doc = docs.get(`q_tickets/${issued.ticketId}`).fields;
  assert.equal(doc.abdmShareOrg, ORG_ID);
  assert.equal(doc.departmentId, DEPT);
  assert.ok(doc.encShare, "the profile is sealed on the ticket");
  for (const plain of ["Ramesh", "ramesh@sbx", "91234567890123", "91-2345-6789-0123", "9876543210", "MG Road"]) {
    assert.ok(!doc.encShare.includes(plain), `encShare leaks ${plain}`);
    assert.ok(!doc.encName.includes(plain) && !doc.encMobile.includes(plain), `sealed name/mobile leak ${plain}`);
  }

  await assert.rejects(() => share(T, "no-such-counter"), /unknown counter/);
  await assert.rejects(() => share(T, "dep-old"), /unknown counter/, "an inactive department is not a counter");
  await assert.rejects(() => share(T, GENERAL_COUNTER), (e) => e.message === "token_department_required", "department scope gives no token without a department");

  const listed = await view(NURSE);
  assert.equal(listed.__status, 200, listed.__text);
  assert.equal(listed.connection.connected, true);
  assert.equal(listed.connection.hipId, HIP);
  assert.deepEqual(listed.counters.map((c) => c.counterId), [DEPT]);
  assert.equal(listed.counters[0].url, `https://phrsbx.abdm.gov.in/share-profile?hip-id=${HIP}&counter-id=${DEPT}`);
  assert.equal(listed.shares.length, 1);
  const row = listed.shares[0];
  assert.equal(row.ticketId, issued.ticketId);
  assert.equal(row.token, "C-001");
  assert.equal(row.registered, false);
  assert.equal(row.mrn, null);
  assert.equal(row.name, "Ramesh Kumar");
  assert.equal(row.profile.abhaAddress, "ramesh@sbx");
  assert.equal(row.profile.abhaNumber, "91234567890123", "the ABHA number is stored as digits");
  assert.equal(row.profile.address.pinCode, "411001");
  assert.deepEqual(await readAbhaProof(ENV, row.abhaProof, ORG_ID), { abhaNumber: "91234567890123", abhaAddress: "ramesh@sbx" });
  assert.equal(await readAbhaProof(ENV, row.abhaProof, OTHER), null, "the proof is this hospital's only");

  const reg = await register(NURSE, { ticketId: issued.ticketId, mrn: "WSQ-000123" });
  assert.equal(reg.__status, 200, reg.__text);
  assert.equal(reg.mrn, "WSQ-000123");
  const after = docs.get(`q_tickets/${issued.ticketId}`).fields;
  assert.equal(after.ghisPatientId, "WSQ-000123");
  assert.equal(after.encShare, "", "the sealed profile is dropped once the register holds it");

  const again = await register(NURSE, { ticketId: issued.ticketId, mrn: "WSQ-000999" });
  assert.equal(again.__status, 409, again.__text);
  assert.equal(docs.get(`q_tickets/${issued.ticketId}`).fields.ghisPatientId, "WSQ-000123");

  const done = (await view(NURSE)).shares[0];
  assert.equal(done.registered, true);
  assert.equal(done.mrn, "WSQ-000123");
  assert.equal(done.profile, undefined);
  assert.equal(done.abhaProof, undefined);
});

test("a general hospital prints the desk counter; another hospital's share is 404 here and left untouched", async () => {
  seedHospital();
  await connect();
  const desk = await share(T, GENERAL_COUNTER, { ...PATIENT, name: "Sita Devi", abhaAddress: "sita@sbx" });
  assert.equal(desk.tokenNumber, "1");
  const listed = await view(NURSE);
  assert.deepEqual(listed.counters.map((c) => c.counterId), [GENERAL_COUNTER, DEPT]);

  const theirs = await share("tenant-other", GENERAL_COUNTER, { ...PATIENT, name: "Other Patient", abhaAddress: "other@sbx" });
  assert.equal(docs.get(`q_tickets/${theirs.ticketId}`).fields.abdmShareOrg, OTHER);
  assert.deepEqual((await view(NURSE)).shares.map((s) => s.ticketId), [desk.ticketId], "only this hospital's shares are listed");
  const own = await view(OTHER_ADMIN, OTHER);
  assert.equal(own.__status, 200, own.__text);
  assert.deepEqual(own.shares.map((s) => s.ticketId), [theirs.ticketId]);
  assert.ok(!own.__text.includes("Sita"), "another hospital never sees this one's shares");
  const snap = JSON.stringify(docs.get(`q_tickets/${theirs.ticketId}`));
  const r = await register(NURSE, { ticketId: theirs.ticketId, mrn: "WSQ-1" });
  assert.equal(r.__status, 404, r.__text);
  assert.equal(JSON.stringify(docs.get(`q_tickets/${theirs.ticketId}`)), snap);
  const plain = await register(NURSE, { ticketId: "no-such-ticket", mrn: "WSQ-1" });
  assert.equal(plain.__status, 404, plain.__text);
});

test("a tenant that is not a WardSynQ hospital keeps the OPD bridge (observed: a pool ticket with no sealed share)", async () => {
  // Asserted through opd-bridge.js issueQueueToken's observable behaviour rather than mock.module: its OPD org id is
  // the tenant id, the counter code is the ticket's department, and no ABDM share is sealed on the ticket.
  seedHospital();
  const r = await share("tenant-native", "counter-7");
  assert.equal(r.tokenNumber, 1, "the bridge's numeric place in the pool, not a WardSynQ token");
  assert.equal(r.expirySec, 1800);
  assert.ok(r.sessionId, "only the bridge returns the pool session");
  const doc = docs.get(`q_tickets/${r.ticketId}`).fields;
  assert.equal(doc.hospitalId, "tenant-native");
  assert.equal(doc.department, "counter-7");
  assert.equal(doc.abdmShareOrg, undefined);
  assert.equal(doc.encShare, undefined);
});

/* ---- ABDM hears a failure, never a token that does not exist ---------------------------------------------- */

test("onPatientShare: a token seam that throws or returns no number answers FAILURE with no profile", async () => {
  const env = { CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", ABDM_HIP_ID: HIP, ABDM_TENANT_ID: T, CONNECT_HMAC_SALT: ENV.CONNECT_HMAC_SALT };
  const body = { intent: "PROFILE_SHARE", metaData: { hipId: HIP, context: DEPT },
    profile: { patient: { abhaNumber: "91234567890123", abhaAddress: "ramesh@sbx", name: "Ramesh Kumar", gender: "M", yearOfBirth: "1980", phoneNumber: "9876543210" } } };
  for (const issueQueueToken of [async () => { throw new Error("unknown counter"); }, async () => ({ tokenNumber: null })]) {
    const calls = [], audits = [];
    const deps = { db: makeAbdmDb({}), now: () => new Date("2026-09-16T00:00:00Z"), audit: async (a) => { audits.push(a); },
      gateway: { post: async (key, b) => { calls.push({ key, body: b }); return { status: 202, body: {} }; } }, issueQueueToken };
    await HIP_HANDLERS["patient-share"]({ env, deps, body, headers: { requestId: "req-9", timestamp: "2026-09-16T00:00:00Z", entityId: HIP } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, "patientShareOnShare");
    const ack = calls[0].body.acknowledgement;
    assert.equal(ack.status, "FAILURE");
    assert.equal(ack.profile, undefined);
    assert.ok(!JSON.stringify(calls[0].body).includes("tokenNumber"));
    assert.deepEqual(calls[0].body.response, { requestId: "req-9" });
    assert.equal(audits[0].outcome, "failed");
    assert.ok(!JSON.stringify(audits).includes("ramesh@sbx"), "the audit carries a pseudonym, not the ABHA");
  }
});
