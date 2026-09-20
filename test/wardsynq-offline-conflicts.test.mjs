/* test/wardsynq-offline-conflicts.test.mjs - G2: bedside writes kept on the device while offline, and the
 * conflict review after reconnect.
 *
 * Outbox (ward-offline.js): a write made offline is queued and said to be on the device only; after
 * reconnect a version conflict or a changed order becomes a CONFLICT carrying the record as it is now, and
 * resend, edit and discard each need the person's decision. Server, through the real router:
 * POST /api/queue/ward/mar refuses a dose whose order changed (order_changed, with the order now) or was
 * stopped; POST /api/queue/ward/nursing-task-act returns the task as it is now with its conflict;
 * POST /api/queue/ward/offline-resolve records the decision, with 401 / 403 (wrong role, another hospital)
 * and nothing written. Screen (ward.js in a VM): offline keep, the bar, the side by side, and a discard that
 * the server did not record leaves the entry on the device.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-offline-conflicts.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
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
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { resetMemory: resetRateLimits } = await import("../functions/_wardsynq/rate-limit.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const T1 = { id: "tenant-wsq", name: "WSQ", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const T2 = { id: "tenant-two", name: "Two", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-two" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === T1.id ? { ...T1 } : String(a[0]) === T2.id ? { ...T2 } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => (String(request.headers.get("Cf-Access-Authenticated-User-Email") || "") === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
await import("../ward-offline.js");
const WO = globalThis.WARD_OFFLINE;

const ORG = "org-wsq", ORG2 = "org-two";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test", OTHER = "nurse@two.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1" };

function seed() {
  docs.clear(); clock = 1; RECORD = new MemoryRepository(); resetRateLimits();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward", kind: "clinic", mode: "wardsynq", connectTenantId: T1.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-TWO001", name: "Two", kind: "clinic", mode: "wardsynq", connectTenantId: T2.id, ownerUid: "cfa:nobody2", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(ORG2)}__${sanitize(idFor(OTHER))}`, { fields: { orgId: ORG2, identity: idFor(OTHER), role: "nurse", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function patientOnDrug() {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Offline Testcase", mobile: "9876500012", gender: "female", ageYears: 60 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "3", admittedAt: "2026-09-07T08:00:00.000Z" });
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Ondansetron", dose: { value: 4, unit: "mg" }, route: "iv", frequency: "TID" } });
  assert.equal(ord.__status, 200, JSON.stringify(ord));
  return { reg, adm, orderId: ord.orderId || (ord.order && ord.order.id) };
}
const writes = () => RECORD._rows.length + RECORD.audit.length;
const durable = () => Object.assign(WO.memoryStore(), { durable: true });

/* ================================================================ outbox */

test("G2 outbox: a write made offline is queued and said to be on the device only; nothing is sent while offline", async () => {
  let online = false; const sent = [];
  const box = WO.create({ store: durable(), actor: () => "staff:org~nurse", online: () => online, fetch: async (u, o) => { sent.push([u, o]); return { status: 200, json: async () => ({ ok: true, written: 1 }) }; } });
  await box.enqueue("vitals", { orgId: ORG, patientId: "p1", vitals: { pulse: "88" } }, { label: "Vitals", patientId: "p1" });
  const s = box.state();
  assert.equal(s.waiting, 1);
  assert.equal(WO.label(s).text, "Offline (1 waiting)");
  assert.equal(s.queued[0].label, "Vitals");
  assert.equal((await box.sync()).stopped, "offline");
  assert.equal(sent.length, 0, "nothing leaves while offline");
  online = true;
  const out = await box.sync();
  assert.equal(out.sent, 1);
  assert.equal(JSON.parse(sent[0][1].body).recordedAt.length > 10, true, "the bedside time travels with it");
  assert.ok(sent[0][1].headers["X-Offline-Created-At"]);
  assert.equal(box.state().waiting, 0);
});

test("G2 outbox: after reconnect a conflict keeps the entry with the record as it is now; the queue moves on; resend needs a reason and sends against the current version", async () => {
  const sent = [];
  const answers = [{ status: 409, json: { ok: false, error: "version_conflict", currentVersion: 3, current: { id: "t1", title: "Turn patient", status: "done", version: 3 } } }, { status: 200, json: { ok: true, written: 1 } }, { status: 200, json: { ok: true, written: 1 } }];
  const box = WO.create({ store: durable(), actor: () => "staff:org~nurse", online: () => true, fetch: async (u, o) => { sent.push([u, o]); const a = answers.shift(); return { status: a.status, json: async () => a.json }; } });
  await box.enqueue("nursing-task-done", { orgId: ORG, taskId: "t1", action: "done", expectedVersion: 2 }, { label: "Task done", expectedVersion: 2 });
  await box.enqueue("fluid", { orgId: ORG, entries: [{ direction: "in", kind: "oral", value: "200", at: "2026-09-14T08:00:00Z" }] }, { label: "Fluid" });
  const out = await box.sync();
  assert.deepEqual([out.conflicts, out.sent], [1, 1], "the conflict is an answer; the fluid behind it still went");
  const it = box.state().items[0];
  assert.equal(it.state, "conflict");
  assert.equal(it.current.status, "done");
  assert.equal(it.currentVersion, 3);
  assert.equal(it.body.taskId, "t1");
  assert.equal(it.editable, false, "a task done is not edited, it is resent or discarded");
  assert.match(WO.itemText(it), /changed on the server after you saw it\. Nothing was overwritten/);

  await assert.rejects(box.keepMine(it.id, "no"), /say why/);
  await assert.rejects(box.keepMine(it.id, "I did turn them", undefined, { x: 1 }), /cannot be edited/);
  const kept = await box.keepMine(it.id, "Turned at 08:00, before the other entry");
  assert.equal(kept.body.expectedVersion, 3);
  assert.notEqual(kept.idempotencyKey, it.idempotencyKey, "a different write gets a different key");
  await box.sync();
  const last = sent[sent.length - 1];
  assert.equal(JSON.parse(last[1].body).expectedVersion, 3);
  assert.equal(decodeURIComponent(last[1].headers["X-Offline-Conflict-Reason"]), "Turned at 08:00, before the other entry");
  assert.equal(box.state().items.length, 0);
});

test("G2 outbox: a dose whose order changed is a conflict against the ORDER version; a refused vitals entry can be edited; discard is explicit", async () => {
  const answers = [
    { status: 409, json: { ok: false, error: "order_changed", currentVersion: 2, current: { drug: "Ondansetron", dose: { value: 8, unit: "mg" }, status: "active", version: 2 } } },
    { status: 200, json: { ok: true, skipped: "no_numeric_values" } },
  ];
  const sent = [];
  const box = WO.create({ store: durable(), actor: () => "fb:uid1", online: () => true, fetch: async (u, o) => { sent.push(JSON.parse(o.body)); const a = answers.shift() || { status: 200, json: { ok: true, written: 1 } }; return { status: a.status, json: async () => a.json }; } });
  await box.enqueue("mar", { orgId: ORG, action: "administer", orderId: "o1", dueAt: "2026-09-14T09:00:00Z", patient: { id: "p1" } }, { label: "Ondansetron administer", expectedVersion: 1 });
  await box.enqueue("vitals", { orgId: ORG, vitals: { pulse: "eighty" } }, { label: "Vitals" });
  assert.equal(sent.length, 0);
  await box.sync();
  assert.equal(sent[0].expectedOrderVersion, 1, "a dose carries the order version the nurse saw");
  const [mar, vit] = box.state().items;
  assert.equal(mar.state, "conflict");
  assert.equal(mar.error, "order_changed");
  assert.match(WO.itemText(mar), /the order changed after this dose was charted\. Nothing was recorded/);
  assert.equal(mar.editable, false);
  assert.equal(vit.state, "refused", "ok:true that recorded nothing is not a save");
  assert.equal(vit.editable, true);

  const edited = await box.keepMine(vit.id, "Pulse typed as a word", undefined, { pulse: "80" });
  assert.deepEqual(edited.body.vitals, { pulse: "80" });
  const resent = await box.keepMine(mar.id, "Checked the new dose with the doctor");
  assert.equal(resent.body.expectedOrderVersion, 2, "re-sent against the order as it is now, and checked again by the eMAR");
  assert.equal(resent.body.expectedVersion, undefined);
  await assert.rejects(box.discard(resent.id), /still waiting/);
});

/* ================================================================ server */

test("G2 POST /api/queue/ward/mar: a dose charted against an order that changed is refused with the order now; a stopped order is refused; nothing written", async () => {
  seed();
  const { adm, orderId } = await patientOnDrug();
  const order = await RECORD.latest(T1.id, "MedicationOrder", orderId);
  const from = new Date().toISOString(), to = new Date(Date.now() + 86400000).toISOString();
  const round = await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${encodeURIComponent(adm.patientId)}&from=${from}&to=${to}`);
  assert.equal(round.__status, 200, JSON.stringify(round));
  assert.equal(round.due[0].orderVersion, order.version, "the round names the order version the nurse sees");
  const body = { orgId: ORG, action: "verify", orderId, dueAt: round.due[0].dueAt, patient: { id: adm.patientId }, expectedOrderVersion: order.version, idempotencyKey: "off-aaaaaaaaaaaaaaaa" };

  await RECORD.append(T1.id, [{ ...order, version: order.version + 1, dose: { value: 8, unit: "mg" } }], {});
  const before = RECORD._rows.length;
  const changed = await as(NURSE, "/ward/mar", "POST", body);
  assert.equal(changed.__status, 409, JSON.stringify(changed));
  assert.equal(changed.error, "order_changed");
  assert.equal(changed.currentVersion, order.version + 1);
  assert.deepEqual(changed.current.dose, { value: 8, unit: "mg" });
  assert.equal(RECORD._rows.length, before, "no administration record");
  assert.equal(await RECORD.latest(T1.id, "MedicationAdministration", changed.administrationId), null);

  const ok = await as(NURSE, "/ward/mar", "POST", { ...body, expectedOrderVersion: order.version + 1, idempotencyKey: "off-bbbbbbbbbbbbbbbb" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.to, "verified");

  const cur = await RECORD.latest(T1.id, "MedicationOrder", orderId);
  await RECORD.append(T1.id, [{ ...cur, version: cur.version + 1, status: "stopped" }], {});
  const stopped = await as(NURSE, "/ward/mar", "POST", { ...body, action: "dispense", expectedOrderVersion: cur.version, idempotencyKey: "off-cccccccccccccccc" });
  assert.equal(stopped.__status, 409);
  assert.equal(stopped.error, "order_not_active", "a stopped order is refused first, whatever version was seen");
  // A retry of the dose already recorded is answered with what it did, not refused by the version check.
  const replay = await as(NURSE, "/ward/mar", "POST", { ...body, expectedOrderVersion: order.version + 1, idempotencyKey: "off-bbbbbbbbbbbbbbbb" });
  assert.equal(replay.replayed, true, JSON.stringify(replay));
});

test("G2 POST /api/queue/ward/nursing-task-act: a stale task comes back with the task as it is now", async () => {
  seed();
  const { adm } = await patientOnDrug();
  const t = await as(NURSE, "/ward/nursing-task", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, title: "Turn patient", dueAt: "2026-09-07T10:00:00.000Z" });
  assert.equal(t.__status, 200, JSON.stringify(t));
  const done = await as(NURSE, "/ward/nursing-task-act", "POST", { orgId: ORG, encounterId: adm.encounterId, taskId: t.task.id, action: "done", expectedVersion: t.task.version });
  assert.equal(done.__status, 200, JSON.stringify(done));
  const late = await as(NURSE, "/ward/nursing-task-act", "POST", { orgId: ORG, encounterId: adm.encounterId, taskId: t.task.id, action: "done", expectedVersion: t.task.version, idempotencyKey: "off-dddddddddddddddd" });
  assert.equal(late.__status, 409);
  assert.equal(late.error, "version_conflict");
  assert.equal(late.current.status, "done");
  assert.equal(late.currentVersion, done.task.version);
});

test("G2 POST /api/queue/ward/offline-resolve: no session 401; a role that could not make the write 403; another hospital 403; nothing written; a nurse's decision is audited", async () => {
  seed();
  const choice = { orgId: ORG, kind: "mar", choice: "discard", idempotencyKey: "off-eeeeeeeeeeeeeeee", patientId: "opd-pat-x", error: "order_changed", expectedVersion: 1, currentVersion: 2, createdAt: "2026-09-14T08:00:00Z" };
  const before = writes();
  assert.equal((await as(null, "/ward/offline-resolve", "POST", choice)).__status, 401);
  const doc = await as(DOCTOR, "/ward/offline-resolve", "POST", choice);
  assert.equal(doc.__status, 403, "a doctor cannot give a dose, so cannot decide about one " + JSON.stringify(doc));
  assert.equal((await as(PHARM, "/ward/offline-resolve", "POST", { ...choice, kind: "vitals" })).__status, 403, "pharmacy does not chart vitals");
  assert.equal((await as(OTHER, "/ward/offline-resolve", "POST", choice)).__status, 403, "a nurse of another hospital");
  assert.equal(writes(), before, "no audit row, no record for a refused call");
  assert.equal((await as(NURSE, "/ward/offline-resolve", "POST", { ...choice, kind: "sms" })).__status, 422);
  assert.equal((await as(NURSE, "/ward/offline-resolve", "POST", { ...choice, choice: "resend", reason: "" })).__status, 422, "resend needs a reason");
  assert.equal(writes(), before);

  const ok = await as(NURSE, "/ward/offline-resolve", "POST", choice);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const row = RECORD.audit.filter((a) => a.action === "offline.discard");
  assert.equal(row.length, 1);
  assert.equal(row[0].actor, idFor(NURSE));
  assert.deepEqual([row[0].scope.kind, row[0].scope.idempotencyKey, row[0].scope.refusal, row[0].scope.expectedVersion, row[0].scope.currentVersion], ["mar", "off-eeeeeeeeeeeeeeee", "order_changed", 1, 2]);
  assert.ok(!JSON.stringify(row[0]).includes("opd-pat-x"), "the audit row carries no patient id");
  const resend = await as(NURSE, "/ward/offline-resolve", "POST", { ...choice, kind: "vitals", choice: "resend", reason: "Taken at the bedside at 08:00" });
  assert.equal(resend.__status, 200);
  assert.equal(RECORD.audit.filter((a) => a.action === "offline.resend")[0].scope.reason, "Taken at the bedside at 08:00");
});

/* ================================================================ screen */

function loadWard(opts) {
  const els = new Map(), calls = [];
  const el = (id) => { if (!els.has(id)) els.set(id, { id, value: "", innerHTML: "", outerHTML: "", classList: { add() {}, remove() {}, contains: () => true }, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] }); return els.get(id); };
  const sb = {
    navigator: { userAgent: "node", onLine: opts.onLine }, location: { hash: "", href: "" },
    document: { getElementById: (id) => el(id), createElement: () => el("x" + Math.random()), addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k === "smd_opd_staff_tok" ? Buffer.from("org-wsq~cfa:nurse1.1999999999999").toString("base64url") + ".sig" : ""), setItem() {}, removeItem() {} },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    crypto: webcrypto, confirm: () => true, addEventListener() {},
    fetch: async (u, o) => { calls.push({ u, body: o && o.body ? JSON.parse(o.body) : null, headers: o && o.headers }); const r = await opts.answer(u, o && o.body ? JSON.parse(o.body) : null); if (r instanceof Error) throw r; return { status: r.status || 200, json: async () => r.json }; },
    setTimeout: (f) => setTimeout(f, 0), clearTimeout, console, Promise, Date, JSON, Uint8Array,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb);
  vm.runInContext(readFileSync(new URL("../ward-offline.js", import.meta.url), "utf8"), sb);
  const realFor = sb.WARD_OFFLINE.deviceFor;
  let dev = null;
  // The device's IndexedDB, as a durable memory store; everything else is ward-offline.js's own.
  sb.WARD_OFFLINE.deviceFor = (deps) => dev || (dev = sb.WARD_OFFLINE.create({ ...deps, store: Object.assign(sb.WARD_OFFLINE.memoryStore(), { durable: true }), fetch: sb.fetch, online: () => sb.navigator.onLine }));
  sb.WARD_OFFLINE.device = () => dev;
  assert.equal(typeof realFor, "function");
  vm.runInContext(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), sb);
  return { sb, W: sb.WARD, els: el, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("G2 screen: offline, a bedside write is kept on the device and never shown as saved; online with no answer it is kept with the SAME request key", async () => {
  const { sb, W, calls } = loadWard({ onLine: false, answer: async () => ({ json: { ok: true, written: 1 } }) });
  W._st.orgId = ORG; W._st.sel = { patientId: "p1", encounterId: "e1" }; W._st.view = "chart";
  let answered = false;
  W._bedsideWrite("vitals", { orgId: ORG, encounterId: "e1", patientId: "p1", vitals: { pulse: "90" }, recordedAt: "2026-09-14T08:00:00Z" }, { label: "Vitals", patientId: "p1" }, () => { answered = true; }, "Could not record vitals.");
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(calls.length, 0, "nothing sent offline");
  assert.equal(answered, false);
  assert.match(W._st.note, /Vitals saved on this device, not yet sent: it is NOT in the record until it is sent/);
  assert.ok(!/Recorded|Charted/.test(W._st.note));
  const html = W._render(W._st);
  assert.match(html, /id="wOffBar"[^>]*>.*Offline \(1 waiting\).*1 saved on this device, not yet sent/);
  assert.ok(html.includes('data-w-act="offlinereview"'));

  sb.navigator.onLine = true;
  const lost = loadWard({ onLine: true, answer: async (u) => (u.endsWith("/ward/fluid") ? new Error("network") : { json: { ok: true } }) });
  lost.W._st.orgId = ORG; lost.W._st.sel = { patientId: "p1", encounterId: "e1" };
  const body = { orgId: ORG, patientId: "p1", entries: [{ direction: "in", kind: "oral", value: "100", at: "2026-09-14T08:00:00Z" }] };
  lost.W._bedsideWrite("fluid", body, { label: "Fluid entry", patientId: "p1" }, () => { throw new Error("no answer arrived"); }, "Could not chart that.");
  for (let i = 0; i < 20 && !/saved on this device/.test(lost.W._st.note || ""); i++) await tick();
  assert.equal(lost.calls.length, 3, "the ordinary retries first");
  const q = await lost.sb.WARD_OFFLINE.device().list();
  assert.equal(q.length, 1);
  assert.equal(q[0].body.idempotencyKey, lost.calls[0].body.idempotencyKey, "the resend is the same write as the attempt whose answer was lost");
});

test("G2 screen: the conflict review shows the entry beside the record now; a discard the server did not record leaves it on the device; a recorded one removes it", async () => {
  let resolveOk = false;
  const { W, sb, els, calls } = loadWard({ onLine: true, answer: async (u) => {
    if (u.endsWith("/ward/mar")) return { status: 409, json: { ok: false, error: "order_changed", currentVersion: 2, current: { drug: "Ondansetron", dose: { value: 8, unit: "mg" }, status: "active", version: 2 } } };
    if (u.endsWith("/ward/offline-resolve")) return resolveOk ? { json: { ok: true, recorded: true } } : { status: 502, json: { ok: false, error: "audit_failed", message: "The decision could not be recorded, so nothing was changed on this device." } };
    return { json: { ok: true } };
  } });
  W._st.orgId = ORG; W._dispatch("offlinereview");
  const dev = sb.WARD_OFFLINE.device();
  await dev.enqueue("mar", { orgId: ORG, action: "administer", orderId: "o1", dueAt: "2026-09-14T09:00:00Z", patient: { id: "p1" }, idempotencyKey: "off-1111111111111111" }, { label: "Ondansetron administer", patientId: "p1", expectedVersion: 1 });
  await dev.sync();
  const html = W._render(W._st);
  assert.match(html, /Your entry/);
  assert.match(html, /The record now/);
  assert.match(html, /dose\.value<\/b> <span>8/, "the order as it is now");
  assert.match(html, /order version now 2, you saw version 1/);
  assert.match(html, /the order changed after this dose was charted\. Nothing was recorded/);
  assert.match(html, /never in the record/);
  assert.ok(html.includes('data-w-act="offlineresend:off-1111111111111111"') && html.includes('data-w-act="offlinediscard:off-1111111111111111"'));
  assert.ok(!html.includes('data-w-act="offlineedit:off-1111111111111111"'), "a dose is not edited");

  // Resend without a reason: refused on the screen, nothing posted.
  const n0 = calls.length;
  W._offlineChoice("off-1111111111111111", "resend");
  assert.equal(calls.length, n0);
  assert.match(W._st.err, /Say why your entry should stand/);

  // Retest 2026-09-16: Discard is confirmed on the ward (askFor), and nothing is sent until its own button.
  W._offlineChoice("off-1111111111111111", "discard");
  assert.match(W._st.ask.spec.title, /Discard this Ondansetron administer\?/);
  assert.equal(calls.length, n0, "asking sends nothing");
  W._dispatch("askok");
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(calls[calls.length - 1].u, "/api/queue/ward/offline-resolve");
  assert.equal(calls[calls.length - 1].body.choice, "discard");
  assert.equal((await dev.list()).length, 1, "the server did not record it, so it is still on the device");
  assert.match(W._st.ask.err, /could not be recorded/, "said in the question, which stays open");
  W._dispatch("askcancel");

  resolveOk = true;
  W._offlineChoice("off-1111111111111111", "discard");
  W._dispatch("askok");
  for (let i = 0; i < 10; i++) await tick();
  assert.equal((await dev.list()).length, 0);
  assert.match(W._st.note, /Discarded\. It was never in the record/);

  // Resend with a reason: recorded first, then queued again against the order now and sent.
  await dev.enqueue("mar", { orgId: ORG, action: "administer", orderId: "o1", dueAt: "2026-09-14T09:00:00Z", patient: { id: "p1" }, idempotencyKey: "off-2222222222222222" }, { label: "Ondansetron administer", patientId: "p1", expectedVersion: 1 });
  await dev.sync();
  els("wOffWhy_off-2222222222222222").value = "Confirmed the new dose with Dr Rao";
  W._offlineChoice("off-2222222222222222", "resend");
  for (let i = 0; i < 20; i++) await tick();
  const resolve = calls.filter((c) => c.u.endsWith("/ward/offline-resolve")).pop();
  assert.equal(resolve.body.reason, "Confirmed the new dose with Dr Rao");
  const marSend = calls.filter((c) => c.u.endsWith("/ward/mar")).pop();
  assert.equal(marSend.body.expectedOrderVersion, 2);
  assert.equal(decodeURIComponent(marSend.headers["X-Offline-Conflict-Reason"]), "Confirmed the new dose with Dr Rao");
  assert.ok(calls.indexOf(resolve) < calls.indexOf(marSend), "the decision is recorded before the resend");
  assert.ok(!/[—–]/.test(html));
});
