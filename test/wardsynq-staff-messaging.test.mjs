import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-staff-messaging.test.mjs - staff message threads (staff-messaging.js).
 *
 * GET /api/queue/ward/staff-messages, POST /api/queue/ward/staff-message-send, /api/queue/ward/staff-message-edit,
 * /api/queue/ward/staff-message-recall, /api/queue/ward/staff-message-read and /api/queue/ward/staff-message-escalate:
 * a patient thread is read only after the patient is (audited), read state per reader, edits and recalls kept as
 * versions, the escalation push carries no name, MRN, ward, bed or text. Negative authorization on each route.
 * Same harness shape as wardsynq-discharge-capacity.test.mjs.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-staff-messaging.test.mjs
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
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test", CASHIER = "cashier@example.test", DESK = "reception@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"], [CASHIER, "cashier"], [DESK, "reception"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

const SM = await import("../functions/_wardsynq/staff-messaging.js");
const { grantForRole } = await import("../functions/_wardsynq/actor.js");
const STRANGER = "stranger@example.test";
const T = TENANT_ROW.id;
const q = (extra) => `?orgId=${ORG}${extra || ""}`;

async function admitted(suffix) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Message Testcase " + suffix, mobile: "98765330" + suffix, gender: "female", ageYears: 61 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "4", class: "IPD" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { ...adm, mrn: reg.mrn, name: "Message Testcase " + suffix };
}
const otherHospital = () => {
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "doctor", active: true }, updateTime: "t1" });
};
const anon = async (path, body) => (await onRequest({ request: new Request("https://x/api/queue" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), env: ENV })).status;
const count = async (type) => ((await RECORD.latestByType(T, type, 1000)) || []).length;

test("a patient thread: sent to the nurses, unread for them until read, reply unread for the doctor", async () => {
  seedHospital();
  const a = await admitted("01");
  const sent = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, encounterId: a.encounterId, subject: "Bed 4 fluids", body: "Please recheck urine output at 14:00.", toRoles: ["nurse"] });
  assert.equal(sent.__status, 200, JSON.stringify(sent));
  assert.equal(sent.threadId, sent.messageId);

  const mine = await as(NURSE, "/ward/staff-messages" + q("&view=mine"));
  assert.equal(mine.__status, 200, JSON.stringify(mine));
  assert.equal(mine.threads.length, 1);
  assert.equal(mine.threads[0].unread, 1);
  assert.equal(mine.threads[0].patient.name, a.name, "the inbox names whose thread it is");
  assert.equal(mine.threads[0].messages[0].body, "Please recheck urine output at 14:00.");
  // Not for the reception desk's inbox: addressed to nurses.
  assert.equal((await as(DESK, "/ward/staff-messages" + q("&view=mine"))).threads.length, 0);

  const read = await as(NURSE, "/ward/staff-message-read", "POST", { orgId: ORG, threadId: sent.threadId });
  assert.equal(read.__status, 200, JSON.stringify(read));
  assert.equal((await as(NURSE, "/ward/staff-messages" + q("&patientId=" + a.patientId))).threads[0].unread, 0);

  const reply = await as(NURSE, "/ward/staff-message-send", "POST", { orgId: ORG, threadId: sent.threadId, body: "Done: 40 ml in the last hour." });
  assert.equal(reply.__status, 200, JSON.stringify(reply));
  const doc = await as(DOCTOR, "/ward/staff-messages" + q("&patientId=" + a.patientId));
  assert.equal(doc.threads[0].messages.length, 2);
  assert.equal(doc.threads[0].unread, 1, "the doctor has not read the nurse's reply");
  const stored = await RECORD.latest(T, "StaffMessage", reply.messageId);
  assert.equal(stored.patientId, a.patientId, "a reply inherits the thread's patient; it cannot drift to another");
});

test("reading a patient thread reads the patient as the caller first, and that read is audited", async () => {
  seedHospital();
  const a = await admitted("02");
  await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "Review", body: "Can you see her today?", toRoles: ["doctor"] });
  const before = RECORD.audit.length;
  const r = await as(NURSE, "/ward/staff-messages" + q("&patientId=" + a.patientId));
  assert.equal(r.__status, 200);
  const rows = RECORD.audit.slice(before).filter((e) => e.action === "record.read" && e.actor === idFor(NURSE));
  assert.ok(rows.some((e) => e.scope && e.scope.resourceType === "Patient"), "the patient read that gates the thread is on the audit trail");
  assert.ok(rows.some((e) => e.scope && e.scope.resourceType === "StaffMessage"), "and so is the thread read");
  // A patient who is not in this hospital's record is not found, and no message is written about them.
  const ghost = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: "opd-pat-not-here", subject: "x", body: "about nobody" });
  assert.equal(ghost.__status, 404);
  assert.equal(await count("StaffMessage"), 1);
});

test("who may see a patient thread: a role that cannot read patients has no grant to the messages either", () => {
  for (const role of ["cashier", "billing", "lab", "pharmacy", "kitchen", "housekeeping"]) {
    const g = grantForRole(role);
    const reads = (t) => g && (g.read === null || g.read.includes(t));
    assert.ok(!reads("StaffMessage"), role + " cannot read staff messages");
    assert.ok(!(g && g.write && g.write.includes("StaffMessage")), role + " cannot write them");
  }
  for (const role of ["doctor", "nurse", "reception"]) assert.ok(grantForRole(role).write === null || grantForRole(role).write.includes("StaffMessage"), role);
});

test("negative authorization on every staff message route: no session 401, wrong role 403 with nothing written, another hospital 403", async () => {
  seedHospital(); otherHospital();
  const a = await admitted("03");
  const ok = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "Positive case", body: "Allowed.", toRoles: ["nurse"] });
  assert.equal(ok.__status, 200, "positive case");
  const n0 = await count("StaffMessage"), r0 = await count("StaffMessageRead");
  const posts = {
    "/ward/staff-message-send": { orgId: ORG, patientId: a.patientId, subject: "s", body: "b" },
    "/ward/staff-message-edit": { orgId: ORG, messageId: ok.messageId, body: "changed" },
    "/ward/staff-message-recall": { orgId: ORG, messageId: ok.messageId, reason: "wrong patient" },
    "/ward/staff-message-read": { orgId: ORG, threadId: ok.threadId },
    "/ward/staff-message-escalate": { orgId: ORG, messageId: ok.messageId },
  };
  for (const [path, body] of Object.entries(posts)) {
    assert.equal(await anon(path + q(), body), 401, path + " anon");
    for (const who of [CASHIER, PHARM]) assert.equal((await as(who, path + q(), "POST", body)).__status, 403, path + " " + who);
    assert.equal((await as(STRANGER, path + q(), "POST", body)).__status, 403, path + " other hospital");
  }
  assert.equal(await anon("/ward/staff-messages" + q()), 401);
  assert.equal((await as(CASHIER, "/ward/staff-messages" + q())).__status, 403);
  assert.equal((await as(STRANGER, "/ward/staff-messages" + q("&patientId=" + a.patientId))).__status, 403, "other hospital");
  assert.equal(await count("StaffMessage"), n0, "nothing written by a refused caller");
  assert.equal(await count("StaffMessageRead"), r0);
  const again = await RECORD.latest(T, "StaffMessage", ok.messageId);
  assert.equal(again.body, "Allowed.");
  assert.equal(again.recalled, null);
});

test("an edit and a recall are new versions: the earlier text stays in the record, only the author may make them", async () => {
  seedHospital();
  const a = await admitted("04");
  const m = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "Dose", body: "Give 1 g now.", toRoles: ["nurse"] });
  assert.equal((await as(NURSE, "/ward/staff-message-edit", "POST", { orgId: ORG, messageId: m.messageId, body: "Give 2 g now." })).__status, 403, "not the author");
  const e = await as(DOCTOR, "/ward/staff-message-edit", "POST", { orgId: ORG, messageId: m.messageId, body: "Give 500 mg now." });
  assert.equal(e.__status, 200, JSON.stringify(e));
  assert.equal((await as(DOCTOR, "/ward/staff-message-recall", "POST", { orgId: ORG, messageId: m.messageId, reason: "no" })).__status, 422, "a recall says why");
  const r = await as(DOCTOR, "/ward/staff-message-recall", "POST", { orgId: ORG, messageId: m.messageId, reason: "sent on the wrong thread" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  const hist = await RECORD.history(T, "StaffMessage", m.messageId);
  assert.deepEqual(hist.map((h) => h.body), ["Give 1 g now.", "Give 500 mg now.", "Give 500 mg now."], "every version kept");
  assert.equal(hist[2].recalled.reason, "sent on the wrong thread");
  const list = await as(NURSE, "/ward/staff-messages" + q("&patientId=" + a.patientId));
  const shown = list.threads[0].messages[0];
  assert.equal(shown.body, null, "a recalled message's text is not shown");
  assert.equal(shown.recalled.by, idFor(DOCTOR));
  assert.equal((await as(DOCTOR, "/ward/staff-message-edit", "POST", { orgId: ORG, messageId: m.messageId, body: "again" })).__status, 409, "a recalled message is not edited");
});

test("the escalation push carries no name, MRN, ward, bed or message text", async () => {
  const p = SM.messagePushPayload();
  const all = JSON.stringify(p);
  assert.deepEqual(Object.keys(p.data).sort(), ["kind", "type", "urgency", "v"]);
  for (const word of ["Testcase", "SMD", "MRN", "Medical A", "bed", "Bed", "urine"]) assert.ok(!all.includes(word), word);
  seedHospital();
  const a = await admitted("05");
  const m = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "Urgent", body: "Patient in Bed 4 desaturating.", toRoles: ["nurse"], urgent: true });
  assert.equal(m.__status, 200, JSON.stringify(m));
  assert.equal(m.escalation.reason, "PUSH_OFF", "this hospital has push alerts off: said, never reported as sent");
  assert.equal(m.escalation.sent, 0);
});

test("escalation goes to the addressed roles who have not read the thread, never to the sender, and never says delivered", async () => {
  seedHospital();
  const kv = new Map();
  ENV.PUSH_KV = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
  const org = docs.get(`q_orgs/${ORG}`);
  docs.set(`q_orgs/${ORG}`, { ...org, fields: { ...org.fields, wardsynq: { alerts: { push: { enabled: true } } } } });
  const NURSE2 = "nurse2@example.test";
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(NURSE2))}`, { fields: { orgId: ORG, identity: idFor(NURSE2), role: "nurse", active: true }, updateTime: "t1" });
  for (const [email, tok] of [[NURSE, "tok-n1"], [NURSE2, "tok-n2"], [DOCTOR, "tok-d"]]) {
    kv.set(`push:who:${ORG}~${idFor(email)}`, JSON.stringify({ tokenIds: [tok] }));
    kv.set(`push:native:${tok}`, JSON.stringify({ token: "device-" + tok, platform: "android" }));
  }
  try {
    const a = await admitted("06");
    const m = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "Chest pain", body: "Please see her now.", toRoles: ["nurse"] });
    await as(NURSE, "/ward/staff-message-read", "POST", { orgId: ORG, threadId: m.threadId });
    const e = await as(DOCTOR, "/ward/staff-message-escalate", "POST", { orgId: ORG, messageId: m.messageId });
    assert.equal(e.__status, 200, JSON.stringify(e));
    assert.equal(e.escalation.recipients, 1, JSON.stringify(e) + "the nurse who read it is not pushed; the sender is not either");
    assert.equal(e.escalation.total, 1, JSON.stringify(e.escalation));
    assert.equal(e.escalation.sent, 0);
    assert.equal(e.escalation.reason, "PUSH_NOT_CONFIGURED", "no push credentials on this server: nothing sent, and it says so");
    const stored = await RECORD.latest(T, "StaffMessage", m.messageId);
    assert.equal(stored.escalations.length, 1, "the attempt is on the record");
  } finally { delete ENV.PUSH_KV; }
});

test("a message stating the sex of a foetus is refused and nothing is written (PC&PNDT s.5(2))", async () => {
  seedHospital();
  const a = await admitted("07");
  const r = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "USG", body: "Scan done, it's a boy.", toRoles: ["doctor"] });
  assert.equal(r.__status, 422);
  assert.equal(r.error, "foetal_sex_refused");
  assert.equal(await count("StaffMessage"), 0);
});

test("a unit thread needs no patient; one thread is about a patient or a unit, never both", async () => {
  seedHospital();
  const u = await as(NURSE, "/ward/staff-message-send", "POST", { orgId: ORG, unit: "Medical A", subject: "Oxygen cylinder", body: "Spare cylinder is empty.", toRoles: ["supervisor"] });
  assert.equal(u.__status, 200, JSON.stringify(u));
  const both = await as(NURSE, "/ward/staff-message-send", "POST", { orgId: ORG, unit: "Medical A", patientId: "x", subject: "s", body: "b" });
  assert.equal(both.error, "binding_required");
  const all = await as(DESK, "/ward/staff-messages" + q("&unit=" + encodeURIComponent("Medical A")));
  assert.equal(all.threads.length, 1);
  assert.equal(all.threads[0].patientId, null);
});

test("PURE threadsOf: unread counts only others' unrecalled messages after the last read", () => {
  const msgs = [
    { id: "t1", threadId: "t1", from: "a", sentAt: "2026-09-17T08:00:00Z", subject: "s", toRoles: ["nurse"] },
    { id: "m2", threadId: "t1", from: "b", sentAt: "2026-09-17T09:00:00Z" },
    { id: "m3", threadId: "t1", from: "b", sentAt: "2026-09-17T10:00:00Z", recalled: { by: "b" } },
  ];
  const [t] = SM.threadsOf(msgs, new Map([["t1", "2026-09-17T08:30:00Z"]]), "a", "doctor");
  assert.equal(t.unread, 1);
  assert.equal(t.forMe, true, "the starter is always part of the thread");
  assert.equal(SM.threadsOf(msgs, new Map(), "c", "doctor")[0].forMe, false);
});

/* Named people (R2-3). GET /api/queue/ward/staff-message-people and toPeople on POST /api/queue/ward/staff-message-send. */
const NURSE2 = "nurse2@example.test";
function secondNurse() { docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(NURSE2))}`, { fields: { orgId: ORG, identity: idFor(NURSE2), role: "nurse", active: true, displayName: "Sister Two", email: NURSE2 }, updateTime: "t1" }); }

test("a thread to one named nurse is seen by that nurse and not by another nurse, who cannot open, reply to or mark it either", async () => {
  seedHospital(); secondNurse();
  const a = await admitted("08");
  const sent = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "Just you", body: "Please check her cannula.", toPeople: [idFor(NURSE)] });
  assert.equal(sent.__status, 200, JSON.stringify(sent));
  const stored = await RECORD.latest(T, "StaffMessage", sent.messageId);
  assert.deepEqual(stored.toPeople.map((p) => p.identity), [idFor(NURSE)]);
  assert.deepEqual(stored.toRoles, []);

  const hers = await as(NURSE, "/ward/staff-messages" + q("&view=mine"));
  assert.equal(hers.threads.length, 1, "the named nurse has it in her own inbox");
  assert.equal(hers.threads[0].forMe, true);
  for (const extra of ["&view=mine", "", "&patientId=" + a.patientId]) {
    const other = await as(NURSE2, "/ward/staff-messages" + q(extra));
    assert.equal(other.__status, 200, JSON.stringify(other));
    assert.equal(other.threads.length, 0, "another nurse does not see it" + extra);
  }
  const n0 = await count("StaffMessage"), r0 = await count("StaffMessageRead");
  assert.equal((await as(NURSE2, "/ward/staff-message-send", "POST", { orgId: ORG, threadId: sent.threadId, body: "me too" })).__status, 403);
  assert.equal((await as(NURSE2, "/ward/staff-message-read", "POST", { orgId: ORG, threadId: sent.threadId })).__status, 403);
  assert.equal((await as(NURSE2, "/ward/staff-message-escalate", "POST", { orgId: ORG, messageId: sent.messageId })).__status, 403);
  assert.equal(await count("StaffMessage"), n0);
  assert.equal(await count("StaffMessageRead"), r0);

  const reply = await as(NURSE, "/ward/staff-message-send", "POST", { orgId: ORG, threadId: sent.threadId, body: "Resited." });
  assert.equal(reply.__status, 200, JSON.stringify(reply));
  assert.deepEqual((await RECORD.latest(T, "StaffMessage", reply.messageId)).toPeople.map((p) => p.identity), [idFor(NURSE)], "a reply inherits the named addressees");
  assert.equal((await as(DOCTOR, "/ward/staff-messages" + q())).threads[0].messages.length, 2, "the sender still sees the thread");
});

test("naming a member of another hospital, or someone whose role cannot see the patient, is refused naming who, and nothing is written", async () => {
  seedHospital(); otherHospital();
  const a = await admitted("09");
  const stranger = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "s", body: "b", toPeople: [idFor(STRANGER)] });
  assert.equal(stranger.__status, 422, JSON.stringify(stranger));
  assert.equal(stranger.error, "people_refused");
  assert.equal(stranger.refused[0].reason, "not_member");
  assert.ok(stranger.detail.includes(idFor(STRANGER)), "the refusal names who");
  const cashier = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "s", body: "b", toRoles: ["nurse"], toPeople: [idFor(NURSE), idFor(CASHIER)] });
  assert.equal(cashier.__status, 422, JSON.stringify(cashier));
  assert.deepEqual(cashier.refused.map((r) => [r.identity, r.reason]), [[idFor(CASHIER), "cannot_read"]]);
  assert.equal(await count("StaffMessage"), 0);
});

test("an alert on a named thread goes to the named person who has not read it, not to other members of their role", async () => {
  seedHospital(); secondNurse();
  const kv = new Map();
  ENV.PUSH_KV = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
  const org = docs.get(`q_orgs/${ORG}`);
  docs.set(`q_orgs/${ORG}`, { ...org, fields: { ...org.fields, wardsynq: { alerts: { push: { enabled: true } } } } });
  for (const [email, tok] of [[NURSE, "tok-n1"], [NURSE2, "tok-n2"]]) {
    kv.set(`push:who:${ORG}~${idFor(email)}`, JSON.stringify({ tokenIds: [tok] }));
    kv.set(`push:native:${tok}`, JSON.stringify({ token: "device-" + tok, platform: "android" }));
  }
  try {
    const a = await admitted("10");
    const m = await as(DOCTOR, "/ward/staff-message-send", "POST", { orgId: ORG, patientId: a.patientId, subject: "Named", body: "See bed 4.", toPeople: [idFor(NURSE2)] });
    const e = await as(DOCTOR, "/ward/staff-message-escalate", "POST", { orgId: ORG, messageId: m.messageId });
    assert.equal(e.__status, 200, JSON.stringify(e));
    assert.equal(e.escalation.recipients, 1, "only the named nurse");
    assert.equal(e.escalation.total, 1);
  } finally { delete ENV.PUSH_KV; }
});

test("GET /api/queue/ward/staff-message-people: label and role only, never the caller or a role that cannot see patients; negative authorization", async () => {
  seedHospital(); secondNurse(); otherHospital();
  assert.equal(await anon("/ward/staff-message-people" + q()), 401);
  assert.equal((await as(CASHIER, "/ward/staff-message-people" + q())).__status, 403);
  assert.equal((await as(STRANGER, "/ward/staff-message-people" + q())).__status, 403, "other hospital");
  const r = await as(DOCTOR, "/ward/staff-message-people" + q());
  assert.equal(r.__status, 200, JSON.stringify(r));
  const ids = r.people.map((p) => p.identity);
  assert.ok(ids.includes(idFor(NURSE)) && ids.includes(idFor(NURSE2)));
  assert.ok(!ids.includes(idFor(DOCTOR)), "not the caller");
  assert.ok(!ids.includes(idFor(CASHIER)) && !ids.includes(idFor(PHARM)), "not a role that cannot read the chart");
  assert.ok(!ids.includes(idFor(STRANGER)), "not another hospital's member");
  assert.equal(r.people.find((p) => p.identity === idFor(NURSE2)).label, "Sister Two");
  for (const p of r.people) assert.deepEqual(Object.keys(p).sort(), ["identity", "label", "role"]);
});

