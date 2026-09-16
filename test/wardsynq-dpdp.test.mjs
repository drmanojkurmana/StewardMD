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

const ORG = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const OWNER = "owner@example.test", DPO = "dpo@example.test", RECEPTION = "desk@example.test", NURSE = "nurse@example.test", HR = "hr@example.test";
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
  for (const [email, role] of [[DPO, "dpo"], [RECEPTION, "reception"], [NURSE, "nurse"], [HR, "hr"]]) {
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
const NOTICE = { language: "en", text: "We collect your name, contact details and health information to treat you. You may withdraw consent for anything other than your treatment at any time, raise a grievance with our Data Protection Officer, and complain to the Data Protection Board of India.", dpoContact: "dpo@hospital.example, 040-1234" };

test("pure: no hospital clock means no due date, never an invented one", () => {
  const c = clocksOf(null);
  assert.equal(c.responseDays.access, null);
  assert.equal(c.breachBoardHours, null);
  assert.equal(c.confirmed, false);
  const r = newRequest({ patientId: "p", kind: "access", detail: "copy of my data", receivedVia: "email" }, c, "u");
  assert.equal(r.request.dueBy, null);
  assert.equal(newRequest({ patientId: "p", kind: "nomination", detail: "nominate my son", receivedVia: "letter" }, c, "u").error, "nominee_required");
  const withClock = newRequest({ patientId: "p", kind: "erasure", detail: "erase my data", receivedVia: "email" }, clocksOf({ responseDays: { erasure: 30 } }), "u");
  assert.equal(Date.parse(withClock.request.dueBy) - Date.parse(withClock.request.receivedAt), 30 * 86400000);
  assert.equal(withClock.request.clock.confirmed, false);
});

test("pure: a breach cannot be closed silently, and a notification time cannot precede detection", () => {
  const b = { detectedAt: "2026-09-01T10:00:00.000Z", state: "open", actions: [], history: [] };
  assert.equal(applyBreachUpdate(b, { event: "board-notified", at: "2026-08-31T10:00:00Z" }, "u", "2026-09-02T00:00:00.000Z").error, "time_invalid");
  assert.equal(applyBreachUpdate({ ...b, assessment: { text: "x" } }, { event: "close", summary: "done" }, "u", "2026-09-02T00:00:00.000Z").error, "reason_required");
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
  const pub = await as(DPO, "/ward/privacy-notice", "POST", { orgId: ORG, ...NOTICE });
  assert.equal(pub.__status, 200, JSON.stringify(pub));
  assert.equal(pub.notice.version, 1);
  const list = await as(RECEPTION, "/ward/privacy-notices?orgId=" + ORG);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.notices.length, 1);
  const noLang = await as(RECEPTION, "/ward/privacy-acknowledge", "POST", { orgId: ORG, patientId: "pat-1", language: "hi", method: "given-printed" });
  assert.equal(noLang.__status, 409, "no Hindi notice is published");
  const ack = await as(RECEPTION, "/ward/privacy-acknowledge", "POST", { orgId: ORG, patientId: "pat-1", language: "en", method: "given-printed" });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  assert.equal(ack.written, 1);
  assert.equal(ack.acknowledgement.noticeVersion, 1);
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

  const filed = await as(DPO, "/ward/data-request", "POST", { orgId: ORG, patientId: "pat-1", kind: "erasure", detail: "Please erase my data", receivedVia: "email" });
  assert.equal(filed.__status, 200, JSON.stringify(filed));
  assert.equal(filed.request.clock.days, 30);
  assert.ok(filed.request.dueBy);
  const done = await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "complete", response: "Done as described." });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal(done.request.state, "completed");
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
  const filed = await as(DPO, "/ward/data-request", "POST", { orgId: ORG, patientId: "pat-2", kind: "erasure", detail: "Erase", receivedVia: "letter" });
  const r = await as(DPO, "/ward/data-request-act", "POST", { orgId: ORG, requestId: filed.request.id, action: "complete", response: "Done." });
  assert.equal(r.__status, 502, JSON.stringify(r));
  assert.equal(r.error, "erasure_partial");
  assert.equal(r.request.state, "in-progress");
  assert.equal(r.erasure.failures[0].step, "registration-details");
  const q = await as(DPO, "/ward/data-requests?orgId=" + ORG);
  assert.equal(q.requests[0].state, "in-progress");
  assert.equal(q.clocks.confirmed, false);
  assert.equal(q.requests[0].overdue, null, "no hospital clock: not overdue, not on time either");
});

test("breach: recorded with the hospital's clock, notification times kept, holdings answer an access request", async () => {
  seedHospital({ breachBoardHours: 72 });
  await seed({ resourceType: "Patient", id: "pat-1", name: "Asha A", mrn: "M1", dob: "1980-01-01", identifiers: [] });
  const detectedAt = new Date(Date.now() - 3600000).toISOString();
  const b = await as(DPO, "/ward/data-breach", "POST", { orgId: ORG, detectedAt, description: "Discharge summaries emailed to the wrong address", dataCategories: ["health"], affectedCount: 3 });
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(Date.parse(b.breach.boardDueBy) - Date.parse(detectedAt), 72 * 3600000);
  assert.equal(b.breach.principalsDueBy, null);
  const early = await as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b.breach.id, event: "board-notified", at: new Date(Date.parse(detectedAt) - 60000).toISOString() });
  assert.equal(early.__status, 422);
  const told = await as(DPO, "/ward/data-breach-update", "POST", { orgId: ORG, breachId: b.breach.id, event: "board-notified", at: new Date().toISOString(), reference: "DPB-1" });
  assert.equal(told.__status, 200, JSON.stringify(told));
  assert.equal(told.breach.boardLate, false);
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
