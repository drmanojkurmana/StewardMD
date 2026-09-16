/* test/wardsynq-dpdp.test.mjs - DPDP Act 2023: privacy notice, acknowledgement, data principal requests (erasure done
 * for real), breach register, and the patient's own portal routes, through the real /api/queue and /api/portal handlers.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-dpdp.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async () => ({}),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});


const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { onRequest: portalRequest } = await import("../functions/api/portal/[[path]].js");
const { AccessGrant, hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { clocksOf, newRequest, applyBreachUpdate } = await import("../functions/_wardsynq/dpdp.js");
const { lawOn, requestClock, childGate, guardianGate } = await import("../functions/_wardsynq/privacy-law.js");
const { retentionMap, activeHolds, classesOf } = await import("../functions/_wardsynq/retention.js");

const ORG = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const OWNER = "owner@example.test", DPO = "dpo@example.test", RECEPTION = "desk@example.test", NURSE = "nurse@example.test", HR = "hr@example.test";
const DPO2 = "dpo2@example.test", HIM = "him@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
const T = TENANT_ROW.id;
const NOW = new Date().toISOString();
let seq = 0;
const seed = (rec) => RECORD.append(T, [{ version: 1, meta: { recordedAt: NOW, effectiveAt: NOW, source: { system: "wardsynq-native", sourceId: null } }, ...rec }], { idempotencyKey: "seed-" + (++seq) });

function seedHospital(dpdp) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  const org = (id) => ({ fields: { id, code: "SMD-" + id, name: "Hospital " + id, kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(OWNER), createdAt: 1, wardsynq: { patientAccess: { enabled: true }, ...(dpdp ? { dpdp } : {}) } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG}`, org(ORG));
  docs.set(`q_orgs/${OTHER}`, org(OTHER));
  for (const [email, role] of [[DPO, "dpo"], [DPO2, "dpo"], [HIM, "him"], [RECEPTION, "reception"], [NURSE, "nurse"], [HR, "hr"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function portal(sub, body) {
  const res = await portalRequest({ request: new Request("https://x/api/portal/" + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: ORG, ...body }) }), env: ENV, params: { path: [sub] } });
  const j = await res.json().catch(() => ({}));
  j.__status = res.status;
  return j;
}
const count = async (type) => (await RECORD.latestByType(T, type, 100)).length;
const NOTICE = {
  language: "en", dpoContact: "dpo@hospital.example, 040-1234", grievanceContact: "Grievance Officer, 040-1235",
  dataItems: "Name, age, sex, address, phone, ABHA number, diagnoses, test results, medicines",
  purposes: "Treating you, billing for that care, and reports the law requires",
  withdrawConsent: "Tell the desk or use the portal", rights: "Write to the DPO or use the portal",
  recipients: "Your insurer, when you ask; public health authorities as the law requires",
  collectingAgency: "Hospital org-wsq, 1 Main Road, Guntur 522001",
  boardComplaint: "Complain to the Data Protection Board of India online",
};
const IN_FORCE = { dpdpStartDate: "2025-11-13" }; // a hospital applying DPDP early: every DPDP clock runs today

test("pure: the law on a day, from the legal opinion (G.S.R. 843(E), 846(E)); a hospital may only bring DPDP earlier", () => {
  const before = lawOn(null, Date.parse("2026-09-17T12:00:00+05:30"));
  assert.equal(before.regime, "spdi-2011");
  assert.equal(before.dpdpStart, "2027-05-13");
  assert.equal(before.consentManagerStart, "2026-11-13");
  assert.equal(before.dpdpInForce, false);
  assert.equal(lawOn(null, Date.parse("2027-05-12T23:59:00+05:30")).dpdpInForce, false);
  assert.equal(lawOn(null, Date.parse("2027-05-13T00:00:00+05:30")).regime, "dpdp-2025");
  assert.equal(lawOn({ dpdpStartDate: "2028-01-01" }, Date.parse("2027-06-01T00:00:00Z")).dpdpStart, "2027-05-13", "a later start is not used");
  assert.equal(lawOn(IN_FORCE, Date.parse("2026-09-17T00:00:00Z")).dpdpInForce, true);
});

test("pure: confirmed clocks: SPDI one month (never past 30 days) now, DPDP per kind from commencement, capped at 90", () => {
  const c = clocksOf(null, Date.parse("2026-09-17T00:00:00Z"));
  assert.equal(c.confirmed, true);
  assert.equal(c.responseDays.access, 30);
  assert.equal(c.certInHours, 6);
  assert.equal(c.boardDetailedHours, 72);
  assert.equal(c.breachPrincipalHours, 72);
  // SPDI before commencement: one calendar month from 1 Feb is 28 days, shorter than 30.
  const feb = requestClock("access", "2026-02-01T10:00:00.000Z", c);
  assert.equal(feb.clock.regime, "spdi-2011");
  assert.equal((Date.parse(feb.dueBy) - Date.parse("2026-02-01T10:00:00.000Z")) / 86400000, 28);
  assert.match(feb.clock.citation, /r\.5\(9\)/);
  // DPDP: the hospital's 45 is used, 120 is past the 90-day cap and the default 30 is used instead.
  const d = clocksOf({ ...IN_FORCE, responseDays: { erasure: 45, access: 120 } }, Date.now());
  assert.equal(d.responseDays.erasure, 45);
  assert.equal(d.responseDays.access, 30);
  assert.equal(d.responseSource.access, "default");
  const r = newRequest({ patientId: "p", kind: "erasure", detail: "erase my data", receivedVia: "email" }, d, "u");
  assert.equal(r.request.clock.regime, "dpdp-2025");
  assert.equal(Date.parse(r.request.dueBy) - Date.parse(r.request.receivedAt), 45 * 86400000);
  assert.equal(newRequest({ patientId: "p", kind: "nomination", detail: "nominate my son", receivedVia: "letter" }, d, "u").error, "nominee_required");
  // The patients' target passes 72 hours only with a written reason.
  assert.equal(clocksOf({ breachPrincipalHours: 96 }).breachPrincipalHours, 72);
  assert.equal(clocksOf({ breachPrincipalHours: 96, breachPrincipalHoursReason: "Rural patients reached by post only" }).breachPrincipalHours, 96);
});

test("pure: a breach closes only once CERT-In, the patients and (where it applies) the Board are told; no silent close", () => {
  const b = { detectedAt: "2026-09-01T10:00:00.000Z", state: "open", actions: [], history: [], boardDuty: true, boardDetailedDueBy: "2026-09-04T10:00:00.000Z" };
  const now = "2026-09-02T00:00:00.000Z";
  assert.equal(applyBreachUpdate(b, { event: "board-notified", at: "2026-08-31T10:00:00Z" }, "u", now).error, "time_invalid");
  const closing = applyBreachUpdate({ ...b, assessment: { text: "x" } }, { event: "close", summary: "done, nothing to tell anyone about here" }, "u", now);
  assert.equal(closing.error, "notifications_required");
  assert.deepEqual(closing.missing, ["cert-in", "principals", "board"]);
  assert.equal(applyBreachUpdate(b, { event: "principals-notified", at: "2026-09-01T12:00:00Z", count: 3, intimation: { nature: "Emails sent to the wrong address" } }, "u", now).error, "intimation_incomplete");
  assert.equal(applyBreachUpdate(b, { event: "board-notified", at: "2026-09-01T12:00:00Z", report: { facts: "Three summaries emailed wrongly" } }, "u", now).error, "board_report_incomplete");
  assert.equal(applyBreachUpdate(b, { event: "board-extension", reference: "DPB/EXT/1", extendedTo: "2026-09-03T00:00:00Z" }, "u", now).error, "extension_date_invalid");
  const proposed = applyBreachUpdate(b, { event: "not-a-breach", reasons: "The file held no personal data at all, only a blank template" }, "u", now).breach;
  assert.equal(applyBreachUpdate(proposed, { event: "confirm-not-a-breach" }, "u", now).error, "second_approver_required");
  assert.equal(applyBreachUpdate(proposed, { event: "confirm-not-a-breach" }, "v", now).breach.state, "withdrawn");
  // Before commencement the Board is not a condition of closing.
  const spdi = { ...b, boardDuty: false, assessment: { text: "x" }, certInReportedAt: now, principalsNotifiedAt: now };
  assert.equal(applyBreachUpdate(spdi, { event: "close" }, "u", now).breach.state, "closed");
});

test("pure: s.5(2) re-notice: a patient whose last acknowledgement predates commencement is listed; one acknowledged since is not", async () => {
  const { renoticeDue } = await import("../functions/_wardsynq/dpdp.js");
  const acks = [
    { patientId: "p1", acknowledgedAt: "2027-01-10T10:00:00.000Z" },
    { patientId: "p2", acknowledgedAt: "2027-02-01T10:00:00.000Z" }, { patientId: "p2", acknowledgedAt: "2027-05-20T10:00:00.000Z" },
  ];
  assert.deepEqual(renoticeDue(acks, "2027-05-13").map((x) => x.patientId), ["p1"]);
});

test("pure: children's data (r.10): care is exempt, a non-care purpose for a minor needs a verified parent, only from commencement", () => {
  const atMs = Date.parse("2027-06-01T00:00:00Z");
  const law = lawOn(null, atMs), early = lawOn(null, Date.parse("2026-09-17T00:00:00Z"));
  assert.equal(childGate({ dob: "2015-01-01", purpose: "research", atMs, law: early }).required, false);
  assert.equal(childGate({ dob: "2015-01-01", purpose: "treatment", atMs, law }).reason, "health-services-exempt");
  assert.equal(childGate({ dob: "1980-01-01", purpose: "marketing", atMs, law }).required, false);
  const minor = childGate({ dob: "2015-01-01", purpose: "research", atMs, law, givenBy: "patient" });
  assert.equal(minor.required, true);
  assert.equal(minor.satisfied, false);
  assert.equal(childGate({ dob: "", purpose: "marketing", atMs, law }).reason, "date-of-birth-not-recorded");
  assert.equal(childGate({ dob: "2015-01-01", purpose: "research", atMs, law, givenBy: "parent", verification: { method: "digilocker-token", reference: "DL-123", parentName: "Sita" } }).satisfied, true);
  assert.equal(guardianGate({ givenBy: "legal-guardian", law, minor: false, appointment: { source: "court" } }).satisfied, false);
});

test("pure: retention (H.4): ten years after the last in-patient stay, a child's until 21 at least; an MLC entry holds the record", async () => {
  const facts = { patient: { dob: "2020-03-01" }, encounters: [{ class: "IPD", status: "finished", periodStart: "2024-01-01T00:00:00Z", periodEnd: "2024-01-05T00:00:00Z" }],
    registers: { mlc: [{ id: "reg-mlc-1", serial: "MLC/2024/00001", eventDate: "2024-01-01", recordedAt: "2024-01-01T00:00:00Z", fields: { status: "open" } }], formf: [], mtp: [] }, documents: [], consents: [], placed: [] };
  const map = retentionMap(facts, null, Date.parse("2026-09-17T00:00:00Z"));
  const ipd = map.find((x) => x.class === "clinical-ipd");
  assert.equal(ipd.keepUntil.slice(0, 10), "2041-03-01", "a child admitted at 3: kept until 3 years after turning 18, later than 2034");
  assert.match(ipd.rule, /DGHS Office Memorandum/);
  assert.equal(map.find((x) => x.class === "mlc").keepUntil.slice(0, 10), "2034-01-01");
  assert.equal(classesOf({ years: { "clinical-opd": 1 } }).classes["clinical-opd"].years, 3, "never below the floor");
  const holds = activeHolds([], facts.registers.mlc);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].auto, true);
  assert.equal(activeHolds([{ id: holds[0].id, state: "lifted" }], facts.registers.mlc).length, 0);
  // H.4.8: inactive three years after death, never destroyed for that reason.
  const { retentionView } = await import("../functions/_wardsynq/retention.js");
  const dead = retentionView({ ...facts, patient: { dob: "1950-01-01", deceased: { at: "2022-01-01T00:00:00Z" } } }, null, Date.parse("2026-09-17T00:00:00Z"));
  assert.equal(dead.deceased.inactiveFrom.slice(0, 10), "2025-01-01");
  assert.equal(dead.deceased.inactive, true);
  assert.ok(dead.retained.length > 0, "an inactive record keeps its retention classes");
});

test("no session: 401 on /ward/data-requests and /ward/privacy-notice", async () => {
  seedHospital();
  assert.equal((await as(null, "/ward/data-requests?orgId=" + ORG)).__status, 401);
  assert.equal((await as(null, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE })).__status, 401);
});

test("wrong role: a nurse and hr cannot publish the notice, open the DPO queue or record a breach, and nothing is written", async () => {
  seedHospital();
  for (const who of [NURSE, HR]) {
    const r = await as(who, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE });
    assert.equal(r.__status, 403, JSON.stringify(r));
    assert.equal((await as(who, "/ward/data-requests?orgId=" + ORG)).__status, 403);
    assert.equal((await as(who, "/ward/data-breach", "POST", { orgId: ORG, detectedAt: NOW, description: "laptop with a spreadsheet lost" })).__status, 403);
    assert.equal((await as(who, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: "x", event: "assess", assessment: "not ours to decide" })).__status, 403);
    assert.equal((await as(who, "/ward/data-request-act", "POST", { orgId: ORG, requestId: "x", action: "start" })).__status, 403);
    assert.equal((await as(who, "/ward/data-holdings?orgId=" + ORG + "&patientId=p1")).__status, 403);
  }
  assert.equal(await count("PrivacyNotice"), 0);
  assert.equal(await count("DataBreach"), 0);
  // The desk records acknowledgements; it cannot file a data request in the DPO's place.
  assert.equal((await as(RECEPTION, "/ward/data-request", "POST", { orgId: ORG, patientId: "p1", kind: "access", detail: "copy", receivedVia: "email" })).__status, 403);
  assert.equal(await count("DataPrincipalRequest"), 0);
  // hr holds queue.view and staff.admin but no clinical actor: the desk act is refused.
  assert.equal((await as(HR, "/ward/privacy-acknowledge", "POST", { orgId: ORG, patientId: "p1", language: "en", method: "given-printed" })).__status, 403);
  assert.equal(await count("PrivacyAcknowledgement"), 0);
});

test("another hospital: the DPO of one hospital is refused in another, nothing written", async () => {
  seedHospital();
  const r = await as(DPO, "/ward/privacy-notice", "POST", { orgId: OTHER, ...NOTICE });
  assert.ok(r.__status === 403 || r.__status === 404, JSON.stringify(r));
  const q = await as(DPO, "/ward/data-requests?orgId=" + OTHER);
  assert.ok(q.__status === 403 || q.__status === 404, JSON.stringify(q));
  assert.equal(await count("PrivacyNotice"), 0);
});

test("notice and acknowledgement: the DPO publishes, the desk reads it and records the patient was given it, once per version", async () => {
  seedHospital();
  await seed({ resourceType: "Patient", id: "pat-1", name: "Asha A", mrn: "M1", dob: "1980-01-01", identifiers: [] });
  const bad = await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE, dpoContact: "" });
  assert.equal(bad.__status, 422);
  assert.equal(bad.error, "dpo_contact_required");
  // SPDI Rules 2011 r.5(3): the collecting agency's name and address is a required part, and nothing is written without it.
  const noAgency = await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE, collectingAgency: "" });
  assert.equal(noAgency.__status, 422);
  assert.equal(noAgency.part, "collectingAgency");
  assert.equal(await count("PrivacyNotice"), 0);
  const pub = await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE });
  assert.equal(pub.__status, 200, JSON.stringify(pub));
  assert.equal(pub.notice.version, 1);
  const list = await as(RECEPTION, "/ward/privacy-notices?orgId=" + ORG);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.notices.length, 1);
  assert.equal(list.law.dpdpStart, "2027-05-13");
  // SPDI Rules 2011 r.5(1): the written consent to collecting health data, and the form it took.
  const noForm = await as(RECEPTION, "/ward/privacy-acknowledge", "POST", { orgId: ORG, patientId: "pat-1", language: "en", method: "given-printed", healthDataConsent: true });
  assert.equal(noForm.__status, 422);
  assert.equal(noForm.error, "consent_form_required");
  const noLang = await as(RECEPTION, "/ward/privacy-acknowledge", "POST", { orgId: ORG, patientId: "pat-1", language: "hi", method: "given-printed" });
  assert.equal(noLang.__status, 409, "no Hindi notice is published");
  const ack = await as(RECEPTION, "/ward/privacy-acknowledge", "POST", { orgId: ORG, patientId: "pat-1", language: "en", method: "given-printed", healthDataConsent: true, consentForm: "signed-paper" });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  assert.equal(ack.written, 1);
  assert.equal(ack.acknowledgement.noticeVersion, 1);
  assert.equal(ack.acknowledgement.healthDataConsent.form, "signed-paper");
  const again = await as(RECEPTION, "/ward/privacy-acknowledge", "POST", { orgId: ORG, patientId: "pat-1", language: "en", method: "given-printed" });
  assert.equal(again.skipped, "already_acknowledged");
  const read = await as(RECEPTION, "/ward/privacy-acknowledgements?orgId=" + ORG + "&patientId=pat-1");
  assert.equal(read.acknowledgements.length, 1);
});

test("erasure: non-care consents withdrawn, ABHA removed from the current record, registration extras cleared, clinical record kept and said so", async () => {
  seedHospital({ responseDays: { erasure: 30 } });
  await seed({ resourceType: "Patient", id: "pat-1", name: "Asha A", mrn: "M1", dob: "1980-01-01", identifiers: [{ system: "opd-mrn", value: "M1" }, { system: "abha-number", value: "12-3456-7890-1234" }] });
  await seed({ resourceType: "PatientConsent", id: "c-research", patientId: "pat-1", scope: "research", decision: "granted", recordedAt: NOW, source: { system: "wardsynq-native" } });
  await seed({ resourceType: "PatientConsent", id: "c-treat", patientId: "pat-1", scope: "treatment", decision: "granted", recordedAt: NOW, source: { system: "wardsynq-native" } });
  docs.set(`q_patients/${sanitize(ORG + "__M1")}`, { fields: { orgId: ORG, mrn: "M1", district: "Guntur", encAddress: "enc", pincode: "522001", abhaNumber: "12-3456-7890-1234", abhaConsent: true }, updateTime: "t1" });

  await seed({ resourceType: "Encounter", id: "enc-ipd-1", patientId: "pat-1", class: "IPD", status: "finished", periodStart: "2025-01-01T00:00:00.000Z", periodEnd: "2025-01-04T00:00:00.000Z" });

  const filed = await as(DPO, "/ward/data-request", "POST", { orgId: ORG, patientId: "pat-1", kind: "erasure", detail: "Please erase my data", receivedVia: "email" });
  assert.equal(filed.__status, 200, JSON.stringify(filed));
  assert.equal(filed.request.clock.regime, "spdi-2011", "before 13 May 2027 the SPDI grievance clock applies");
  assert.ok(filed.request.dueBy);
  // DPDP Rules r.9 / SPDI r.5(9): no published contact, no answer; nothing is erased.
  const noContact = await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "complete", response: "Done as described." });
  assert.equal(noContact.__status, 409, JSON.stringify(noContact));
  assert.equal(noContact.error, "contact_required");
  assert.equal((await RECORD.latest(T, "PatientConsent", "c-research")).decision, "granted");
  assert.equal((await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE })).__status, 200);
  const done = await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "complete", response: "Done as described." });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal(done.request.state, "completed");
  assert.equal(done.request.responseContact.dpoContact, NOTICE.dpoContact);
  const ipd = done.erasure.retained.classes.find((x) => x.class === "clinical-ipd");
  assert.equal(ipd.keepUntil.slice(0, 10), "2035-01-04", "the answer names the class, the rule and the end date");
  assert.match(ipd.rule, /A\.12034\/3\/2014/);
  assert.deepEqual(done.erasure.consentsWithdrawn, ["research"]);
  assert.deepEqual(done.erasure.removedFromCurrentRecord, ["abha-number"]);
  assert.deepEqual(done.erasure.registrationDetailsRemoved.sort(), ["abhaConsent", "abhaNumber", "address", "district", "pincode"]);
  assert.match(done.erasure.retained.reason, /s8\(7\)/);
  assert.match(done.erasure.historyNote, /not erased/);
  assert.equal((await RECORD.latest(T, "PatientConsent", "c-treat")).decision, "granted", "treatment consent untouched");
  assert.equal((await RECORD.latest(T, "PatientConsent", "c-research")).decision, "withdrawn");
  assert.equal((await RECORD.latest(T, "Patient", "pat-1")).identifiers.length, 1);
  assert.equal(docs.get(`q_patients/${sanitize(ORG + "__M1")}`).fields.district, "");
  assert.equal((await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "reject", response: "again" })).__status, 409);
});

test("erasure that cannot finish is not reported done: the request stays open with what did and did not happen", async () => {
  seedHospital();
  await seed({ resourceType: "Patient", id: "pat-2", name: "Bina B", mrn: "M2", dob: "1970-01-01", identifiers: [] });
  await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE });
  const filed = await as(DPO, "/ward/data-request", "POST", { orgId: ORG, patientId: "pat-2", kind: "erasure", detail: "Erase", receivedVia: "letter" });
  const r = await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "complete", response: "Done." });
  assert.equal(r.__status, 502, JSON.stringify(r));
  assert.equal(r.error, "erasure_partial");
  assert.equal(r.request.state, "in-progress");
  assert.equal(r.erasure.failures[0].step, "registration-details");
  const q = await as(DPO, "/ward/data-requests?orgId=" + ORG);
  assert.equal(q.requests[0].state, "in-progress");
  assert.equal(q.clocks.confirmed, true);
  assert.equal(q.law.regime, "spdi-2011");
  assert.equal(q.requests[0].overdue, false, "the SPDI clock runs: on time today");
});

const REPORT = { facts: "Three discharge summaries emailed to a wrong address on 1 Sep", circumstances: "An autocomplete picked the wrong address", mitigation: "Recipient asked to delete; confirmed in writing", findings: "A records clerk, no intent", remedial: "Autocomplete turned off for outside addresses" };
const INTIMATION = { nature: "Your discharge summary was emailed to a wrong address on 1 Sep", consequences: "Someone else may have read your diagnosis", mitigation: "The recipient deleted it and confirmed in writing", safetyMeasures: "Watch for calls claiming to be from the hospital", contact: "dpo@hospital.example, 040-1234" };

test("breach today (SPDI): the CERT-In 6-hour clock runs, no Board clock before commencement, notification times kept, holdings answer an access request", async () => {
  seedHospital({ breachBoardHours: 72 });
  await seed({ resourceType: "Patient", id: "pat-1", name: "Asha A", mrn: "M1", dob: "1980-01-01", identifiers: [] });
  const detectedAt = new Date(Date.now() - 3600000).toISOString();
  const b = await as(DPO, "/ward/data-breach", "POST", { orgId: ORG, detectedAt, description: "Discharge summaries emailed to the wrong address", dataCategories: ["health"], affectedCount: 3 });
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(Date.parse(b.breach.certInDueBy) - Date.parse(detectedAt), 6 * 3600000, "CERT-In Directions 2022 (ii)");
  assert.equal(b.breach.boardDetailedDueBy, null, "the old hospital-set 72 hours is not used; r.7 starts on 13 May 2027");
  assert.equal(b.breach.boardDuty, false);
  assert.equal(Date.parse(b.breach.principalsDueBy) - Date.parse(detectedAt), 72 * 3600000, "the hospital's 72-hour policy target");
  assert.equal(b.breach.certInLate, false);
  const early = await as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b.breach.id, event: "cert-in-reported", at: new Date(Date.parse(detectedAt) - 60000).toISOString() });
  assert.equal(early.__status, 422);
  const certIn = await as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b.breach.id, event: "cert-in-reported", at: new Date().toISOString(), reference: "CERTIn-2026-1" });
  assert.equal(certIn.__status, 200, JSON.stringify(certIn));
  assert.equal(certIn.breach.certInLate, false);
  const told = await as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b.breach.id, event: "board-notified", at: new Date().toISOString(), reference: "DPB-1", report: REPORT });
  assert.equal(told.__status, 200, JSON.stringify(told));
  assert.match(told.breach.boardReport.intimations, /not yet been recorded/);
  const h = await as(DPO, "/ward/data-holdings?orgId=" + ORG + "&patientId=pat-1");
  assert.equal(h.__status, 200, JSON.stringify(h));
  assert.ok(h.holdings.some((x) => x.type === "Patient"));
});

test("portal: the patient reads the notice, acknowledges it and makes a request; a wrong token is 401", async () => {
  seedHospital();
  await seed({ resourceType: "Patient", id: "pat-1", name: "Asha A", mrn: "M1", dob: "1980-01-01", identifiers: [] });
  await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE });
  const token = "tok-g-self";
  await seed(AccessGrant({ id: "g-self", patientId: "pat-1", issuedBy: "dr:1", issuedAt: NOW, codeHash: await hashSecret("00000000", "g-self"), redeemedAt: NOW, tokenHash: await hashSecret(token, "g-self") }));
  assert.equal((await portal("privacy", { grantId: "g-self", token: "wrong" })).__status, 401);
  assert.equal((await portal("data-request", { grantId: "g-self", token: "wrong", kind: "access", detail: "copy please" })).__status, 401);
  const p = await portal("privacy", { grantId: "g-self", token, language: "te" });
  assert.equal(p.__status, 200, JSON.stringify(p));
  assert.equal(p.notice.language, "en", "no Telugu notice: English is shown");
  assert.equal(p.acknowledged, false);
  const a = await portal("privacy-acknowledge", { grantId: "g-self", token, language: "en" });
  assert.equal(a.__status, 200, JSON.stringify(a));
  assert.equal((await portal("privacy", { grantId: "g-self", token, language: "en" })).acknowledged, true);
  const r = await portal("data-request", { grantId: "g-self", token, kind: "correction", detail: "My date of birth is wrong" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal((await as(DPO, "/ward/data-requests?orgId=" + ORG)).requests[0].receivedVia, "portal");
});

test("breach under DPDP (applied early): 72-hour Board report from awareness, all five patient headings, no close until everyone is told, not-a-breach needs a second person", async () => {
  seedHospital(IN_FORCE);
  await seed({ resourceType: "PrivacyAcknowledgement", id: "ack-old", patientId: "pat-old", noticeId: "wsq-privacy-notice-en", noticeVersion: 1, language: "en", acknowledgedAt: "2025-10-01T10:00:00.000Z" });
  const queue = await as(DPO, "/ward/data-requests?orgId=" + ORG);
  assert.equal(queue.renotice.open, true, "s.5(2) re-notice list opens at commencement");
  assert.deepEqual(queue.renotice.patients.map((x) => x.patientId), ["pat-old"]);
  const detectedAt = new Date(Date.now() - 5 * 3600000).toISOString(), awareAt = new Date(Date.now() - 4 * 3600000).toISOString();
  const b = await as(DPO, "/ward/data-breach", "POST", { orgId: ORG, detectedAt, awareAt, description: "Ward laptop stolen with an unencrypted census sheet", affectedCount: 40 });
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.breach.boardDuty, true);
  assert.equal(Date.parse(b.breach.boardDetailedDueBy) - Date.parse(awareAt), 72 * 3600000, "r.7(2)(b) runs from becoming aware");
  assert.equal(Date.parse(b.breach.certInDueBy) - Date.parse(awareAt), 6 * 3600000);
  const id = b.breach.id, now = new Date().toISOString();
  const upd = (body) => as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: id, ...body });
  await upd({ event: "assess", assessment: "Forty inpatients' names, beds and diagnoses" });
  const half = await upd({ event: "principals-notified", at: now, count: 40, method: "SMS and phone", intimation: { ...INTIMATION, safetyMeasures: "" } });
  assert.equal(half.__status, 422);
  assert.equal(half.part, "safetyMeasures");
  const shut = await upd({ event: "close", summary: "Laptop recovered" });
  assert.equal(shut.__status, 422);
  assert.deepEqual(shut.missing, ["cert-in", "principals", "board"]);
  assert.equal((await upd({ event: "principals-notified", at: now, count: 40, method: "SMS and phone", intimation: INTIMATION })).__status, 200);
  assert.equal((await upd({ event: "board-extension", reference: "DPB/EXT/7", extendedTo: new Date(Date.parse(b.breach.boardDetailedDueBy) + 86400000).toISOString() })).__status, 200);
  const board = await upd({ event: "board-notified", at: now, reference: "DPB-7", report: REPORT });
  assert.match(board.breach.boardReport.intimations, /40 people/, "the sixth heading is filled from the patients' log");
  assert.equal((await upd({ event: "cert-in-reported", at: now, reference: "CERTIn-7" })).__status, 200);
  assert.equal((await upd({ event: "close", summary: "Laptop recovered" })).breach.state, "closed");

  const b2 = await as(DPO, "/ward/data-breach", "POST", { orgId: ORG, detectedAt, description: "Suspected leak of a blank consent template" });
  const p = await as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b2.breach.id, event: "not-a-breach", reasons: "The file was a blank template with no personal data in it" });
  assert.equal(p.__status, 200, JSON.stringify(p));
  const self = await as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b2.breach.id, event: "confirm-not-a-breach" });
  assert.equal(self.error, "second_approver_required");
  const other = await as(DPO2, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b2.breach.id, event: "confirm-not-a-breach" });
  assert.equal(other.__status, 200, JSON.stringify(other));
  assert.equal(other.breach.state, "withdrawn");
  assert.equal(other.breach.certInLate, null, "a withdrawn record runs no clock");
});

test("legal hold: an MLC entry holds the record, erasure is refused and nothing is erased; only the records officer lifts it, with a disposal reference", async () => {
  seedHospital();
  await seed({ resourceType: "Patient", id: "pat-1", name: "Asha A", mrn: "M1", dob: "1980-01-01", identifiers: [{ system: "abha-number", value: "12-3456-7890-1234" }] });
  await seed({ resourceType: "PatientConsent", id: "c-research", patientId: "pat-1", scope: "research", decision: "granted", recordedAt: NOW, source: { system: "wardsynq-native" } });
  await seed({ resourceType: "_wardsynq_register_mlc", id: "reg-mlc-1", kind: "mlc", patientId: "pat-1", serial: "MLC/2026/00001", eventDate: "2026-09-01", recordedAt: NOW, fields: { status: "open", category: "assault" } });
  docs.set(`q_patients/${sanitize(ORG + "__M1")}`, { fields: { orgId: ORG, mrn: "M1", district: "Guntur" }, updateTime: "t1" });
  await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE });
  const filed = await as(DPO, "/ward/data-request", "POST", { orgId: ORG, patientId: "pat-1", kind: "erasure", detail: "Please erase my data", receivedVia: "email" });
  const refused = await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "complete", response: "Erased." });
  assert.equal(refused.__status, 409, JSON.stringify(refused));
  assert.equal(refused.error, "legal_hold");
  assert.equal(refused.holds[0].reference, "MLC/2026/00001");
  assert.equal((await RECORD.latest(T, "PatientConsent", "c-research")).decision, "granted", "nothing erased under a hold");
  assert.equal((await RECORD.latest(T, "DataPrincipalRequest", filed.request.id)).state, "received");

  const view = await as(HIM, "/ward/retention?orgId=" + ORG + "&mrn=M1");
  assert.equal(view.__status, 404, "M1's patient id is not pat-1 in this fixture");
  const r = await as(HIM, "/ward/retention?orgId=" + ORG + "&patientId=pat-1");
  assert.equal(r.__status, 200, JSON.stringify(r));
  const hold = r.holds[0];
  assert.equal(hold.auto, true);
  assert.equal((await as(DPO, "/ward/legal-hold-lift", "POST", { orgId: ORG, holdId: hold.id, patientId: "pat-1", liftReference: "Case closed by order 12/2026" })).__status, 403, "the DPO cannot lift a hold");
  const noRef = await as(HIM, "/ward/legal-hold-lift", "POST", { orgId: ORG, holdId: hold.id, patientId: "pat-1", liftReference: "" });
  assert.equal(noRef.error, "disposal_reference_required");
  assert.equal(await count("LegalHold"), 0);
  const lifted = await as(HIM, "/ward/legal-hold-lift", "POST", { orgId: ORG, holdId: hold.id, patientId: "pat-1", liftReference: "Sessions court judgment SC 12/2026" });
  assert.equal(lifted.__status, 200, JSON.stringify(lifted));
  assert.equal(lifted.hold.state, "lifted");
  const done = await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "complete", response: "Erased what the law allows." });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.deepEqual(done.erasure.consentsWithdrawn, ["research"]);
  assert.ok(done.erasure.retained.classes.some((x) => x.class === "mlc" && x.untilProceedingsEnd), "the MLC case sheet is kept ten years or until proceedings end");
});

test("legal hold routes: no session 401, wrong role 403 and nothing written, another hospital refused, the DPO places one", async () => {
  seedHospital();
  await seed({ resourceType: "Patient", id: "pat-1", name: "Asha A", mrn: "M1", dob: "1980-01-01", identifiers: [] });
  const body = { orgId: ORG, patientId: "pat-1", reason: "court-case", reference: "OS 44/2026, Guntur" };
  assert.equal((await as(null, "/ward/retention?orgId=" + ORG + "&patientId=pat-1")).__status, 401);
  assert.equal((await as(null, "/ward/legal-hold", "POST", body)).__status, 401);
  assert.equal((await as(null, "/ward/legal-hold-lift", "POST", { orgId: ORG, holdId: "x", liftReference: "Order 1/2026" })).__status, 401);
  for (const who of [NURSE, RECEPTION, HR]) {
    assert.equal((await as(who, "/ward/retention?orgId=" + ORG + "&patientId=pat-1")).__status, 403, who);
    assert.equal((await as(who, "/ward/legal-hold", "POST", body)).__status, 403, who);
    assert.equal((await as(who, "/ward/legal-hold-lift", "POST", { orgId: ORG, holdId: "x", liftReference: "Order 1/2026" })).__status, 403, who);
  }
  const elsewhere = await as(DPO, "/ward/legal-hold", "POST", { ...body, orgId: OTHER });
  assert.ok(elsewhere.__status === 403 || elsewhere.__status === 404, JSON.stringify(elsewhere));
  assert.equal(await count("LegalHold"), 0);
  const bad = await as(DPO, "/ward/legal-hold", "POST", { ...body, reason: "because" });
  assert.equal(bad.__status, 422);
  const placed = await as(DPO, "/ward/legal-hold", "POST", body);
  assert.equal(placed.__status, 200, JSON.stringify(placed));
  assert.equal((await as(HIM, "/ward/retention?orgId=" + ORG + "&patientId=pat-1")).holds[0].reason, "court-case");
  const lift = await as(HIM, "/ward/legal-hold-lift", "POST", { orgId: ORG, holdId: placed.hold.id, liftReference: "Suit withdrawn, order dated 2 Sep" });
  assert.equal(lift.__status, 200, JSON.stringify(lift));
});

test("children (r.10, DPDP applied early): a research consent for a child needs a verified parent; treatment does not; a portal account and a message opt-in are gated the same way", async () => {
  seedHospital(IN_FORCE);
  const DOCTOR = "doctor@example.test";
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
  await seed({ resourceType: "Patient", id: "kid-1", name: "Ravi R", mrn: "K1", dob: "2016-05-01", identifiers: [] });
  const research = { orgId: ORG, patientId: "kid-1", scope: "research", decision: "granted", givenBy: "parent", giverName: "Lata R" };
  const refused = await as(NURSE, "/ward/consent", "POST", research);
  assert.equal(refused.__status, 422, JSON.stringify(refused));
  assert.equal(refused.error, "parental_consent_required");
  assert.equal(await count("PatientConsent"), 0);
  assert.equal((await as(NURSE, "/ward/consent", "POST", { ...research, scope: "treatment" })).__status, 200, "health services are exempt (Fourth Schedule Part A item 1)");
  const ok = await as(NURSE, "/ward/consent", "POST", { ...research, parentVerification: { method: "id-held", reference: "Aadhaar on file, last 4 1234", parentName: "Lata R" } });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal((await RECORD.latest(T, "PatientConsent", ok.consentId)).parentVerification.method, "id-held");

  const enrol = await as(DOCTOR, "/ward/patient-enrol", "POST", { orgId: ORG, patientId: "kid-1", identifiedBy: "Mother with Aadhaar" });
  assert.equal(enrol.__status, 422, JSON.stringify(enrol));
  assert.equal(enrol.error, "parental_consent_required");
  const enrolled = await as(DOCTOR, "/ward/patient-enrol", "POST", { orgId: ORG, patientId: "kid-1", identifiedBy: "Mother with Aadhaar", parentVerification: { method: "digilocker-token", reference: "DL-TOKEN-99", parentName: "Lata R" } });
  assert.equal(enrolled.__status, 200, JSON.stringify(enrolled));

  const msg = await as(RECEPTION, "/ward/comm-preference", "POST", { orgId: ORG, patientId: "kid-1", channel: "sms", optedIn: true, mobile: "9876543210", note: "Mother signed at the desk" });
  assert.equal(msg.__status, 422, JSON.stringify(msg));
  assert.equal(msg.error, "parental_consent_required");
});
