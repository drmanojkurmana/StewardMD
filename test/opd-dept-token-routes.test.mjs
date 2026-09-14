/* test/opd-dept-token-routes.test.mjs - D7 per-department OPD tokens through the real router.
 *
 * Routes: POST /api/queue/room, POST /api/queue/room/update (a room's department), POST /api/queue/pool and
 * POST /api/queue/ticket (the desk's department picker), GET /api/queue/org (what the picker reads).
 * For each: no session 401, a member without the capability 403 with nothing written, another hospital's
 * admin refused, and the right role succeeds. Same in-memory Firestore harness as neg-auth-org-members.
 *
 * node --test --experimental-test-module-mocks test/opd-dept-token-routes.test.mjs
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
        if (!path.startsWith(coll + "/") || path.indexOf("/", coll.length + 1) >= 0) continue;
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
        if (cd && cd.exists === true && !cur) throw Object.assign(new Error("missing"), { code: "precondition" });
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

const ORG = await import("../functions/_opd_org_store.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const uidFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
export const OWNER_A = "owner-a@example.test", OWNER_B = "owner-b@example.test";
export const HR_A = "hr-a@example.test", HR_B = "hr-b@example.test", NURSE_A = "nurse-a@example.test", VIEWER_A = "viewer-a@example.test", CASHIER_A = "cashier-a@example.test";
export const DAY = "2026-09-14";

let ENV;
export function reset() {
  docs.clear(); clock = 1;
  ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url") };
}
export async function api(path, method, body, email) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const org = (id, owner, extra) => docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id.toUpperCase().replace(/[^A-Z]/g, "").padEnd(6, "X").slice(0, 6), name: id, kind: "clinic", mode: "native", ownerUid: uidFor(owner), createdAt: 1, ...(extra || {}) }, updateTime: "t1" });
const member = (orgId, email, role) => docs.set(`q_members/${sanitize(orgId)}__${sanitize(email)}`, { fields: { orgId, identity: email, role, active: true, createdAt: 1 }, updateTime: "t1" });
const dept = (id, orgId, name, code) => docs.set(`q_departments/${id}`, { fields: { id, orgId, name, code: code || "", type: "general", active: true }, updateTime: "t1" });
export function seed(tokens) {
  reset();
  org("org-a", OWNER_A, tokens ? { tokens } : {});
  org("org-b", OWNER_B);
  member("org-a", HR_A, "hr"); member("org-a", NURSE_A, "nurse"); member("org-a", VIEWER_A, "viewer"); member("org-a", CASHIER_A, "cashier");
  member("org-b", HR_B, "admin");
  dept("dcard", "org-a", "Cardiology", "CAR"); dept("dmed", "org-a", "General Medicine", "GM");
  dept("dtheirs", "org-b", "Their Cardiology", "TC");
}
export { docs, ORG };
const tickets = () => [...docs.entries()].filter(([k]) => k.startsWith("q_tickets/")).map(([, d]) => d.fields);
const rooms = () => [...docs.entries()].filter(([k]) => k.startsWith("q_rooms/")).map(([k, d]) => ({ id: k.slice(8), ...d.fields }));

test("POST /api/queue/room with a department: 401 without a session, 403 for a nurse, another hospital's department refused 422, nothing written; the admin's room carries the department", async () => {
  seed();
  const body = { orgId: "org-a", name: "Heart room", departmentId: "dcard" };
  assert.equal((await api("/room", "POST", body)).__status, 401);
  assert.equal((await api("/room", "POST", body, NURSE_A)).__status, 403);
  const other = await api("/room", "POST", { ...body, orgId: "org-a" }, HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const foreign = await api("/room", "POST", { ...body, departmentId: "dtheirs" }, HR_A);
  assert.equal(foreign.__status, 422); assert.equal(foreign.error, "department_not_found"); assert.match(foreign.message, /not one of this hospital's departments/);
  assert.equal(rooms().length, 0);
  const ok = await api("/room", "POST", body, HR_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.room.department, "Cardiology");
  assert.equal(rooms()[0].departmentId, "dcard");
  const read = await api("/org?orgId=org-a", "GET", null, NURSE_A);
  assert.equal(read.rooms[0].department, "Cardiology", "GET /api/queue/org, what the picker and the room list read");
});

test("POST /api/queue/room/update departmentId: 401, nurse 403, other hospital refused, foreign department 422, all unchanged; admin sets and clears it", async () => {
  seed();
  const rm = await ORG.createRoom(ENV, "org-a", { name: "R1" }, "seed");
  const set = { orgId: "org-a", roomId: rm.id, departmentId: "dmed" };
  const dep = () => docs.get("q_rooms/" + rm.id).fields.departmentId;
  assert.equal((await api("/room/update", "POST", set)).__status, 401);
  assert.equal((await api("/room/update", "POST", set, NURSE_A)).__status, 403);
  const other = await api("/room/update", "POST", { ...set, orgId: "org-b" }, HR_B);
  assert.equal(other.__status, 404, "another hospital's admin cannot touch this room by id");
  assert.equal((await api("/room/update", "POST", { ...set, departmentId: "dtheirs" }, HR_A)).__status, 422);
  assert.equal(dep(), null);
  const ok = await api("/room/update", "POST", set, HR_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.room.department, "General Medicine");
  assert.equal(dep(), "dmed");
  assert.equal((await api("/room/update", "POST", { ...set, departmentId: null }, HR_A)).room.department, "");
});

test("POST /api/queue/pool with the picker's departmentId: 401, 403 without queue.add, other hospital refused, bad department 422 with a sentence; the desk gets the department's token", async () => {
  seed({ scope: "department", prefixes: { dcard: "C" } });
  const body = { orgId: "org-a", name: "Asha", mobile: "9876543210", departmentId: "dcard", date: DAY };
  assert.equal((await api("/pool", "POST", body)).__status, 401);
  assert.equal((await api("/pool", "POST", body, VIEWER_A)).__status, 403);
  assert.equal((await api("/pool", "POST", body, CASHIER_A)).__status, 403);
  const other = await api("/pool", "POST", body, HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const bad = await api("/pool", "POST", { ...body, departmentId: "dtheirs" }, NURSE_A);
  assert.equal(bad.__status, 422); assert.equal(bad.error, "department_not_found"); assert.ok(bad.message);
  assert.equal(tickets().length, 0, "no refusal wrote a ticket");
  const ok = await api("/pool", "POST", body, NURSE_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.ticket.token, "C-001");
  assert.equal(ok.ticket.department, "Cardiology");
  assert.equal(ok.ticket.departmentId, "dcard");
});

test("POST /api/queue/ticket with departmentId (the doctor's own session): 401, a doctor may add, a department of another hospital is refused", async () => {
  seed({ scope: "department", prefixes: { dmed: "M" } });
  const sess = await api(`/session?hospitalId=org-a&date=${DAY}`, "GET", null, OWNER_A);
  assert.equal(sess.__status, 200, JSON.stringify(sess));
  const body = { sessionId: sess.session.id, name: "Ravi", mobile: "9876543211", departmentId: "dmed" };
  assert.equal((await api("/ticket", "POST", body)).__status, 401);
  assert.equal((await api("/ticket", "POST", body, OWNER_B)).__status, 403, "another account cannot add to this doctor's session");
  assert.equal((await api("/ticket", "POST", { ...body, departmentId: "dtheirs" }, OWNER_A)).__status, 422);
  assert.equal(tickets().length, 0);
  const ok = await api("/ticket", "POST", body, OWNER_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.ticket.token, "M-001");
});

test("screens: the desk sheet offers the hospital's departments, says when they did not load, and a refused queue add is never shown as added", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  const win = { document: { getElementById: () => null } };
  new Function("window", "module", read("patient-register.js"))(win, undefined);
  const html = win.SMD_PATIENTREG._sheetHtml;
  const two = html({ mode: "native", departments: [{ id: "dcard", name: "Cardiology" }, { id: "dx", name: "Closed", active: false }], departmentRequired: true });
  assert.match(two, /id="pr_departmentId"/);
  assert.match(two, /Choose a department/);
  assert.match(two, /value="dcard">Cardiology/);
  assert.doesNotMatch(two, /Closed/, "inactive departments are not offered");
  assert.match(html({ mode: "native", departments: null, departmentRequired: true }), /could not be loaded\. A token cannot be given without one/);
  assert.doesNotMatch(html({ mode: "native" }), /pr_departmentId|departments could not/, "not a queue registration: no picker");
  const opd = read("opd.html"), q = read("queue.js"), idx = read("index.html");
  assert.match(opd, /departmentId:\(sent&&sent\.departmentId\)\|\|""/, "console pool add sends the picked department");
  assert.match(opd, /but NOT queued/);
  assert.match(q, /departmentId: \(sent && sent\.departmentId\) \|\| ""/, "app sends the picked department");
  assert.match(q, /but NOT queued/);
  assert.match(opd, /patient-register\.js\?v=[\w-]+/);
  assert.match(idx, /patient-register\.js\?v=[\w-]+/);
  for (const t of [two, opd.slice(opd.indexOf("function openPoolAdd"), opd.indexOf("function openPoolAdd") + 3000)]) assert.doesNotMatch(t, /[—–]/, "no em or en dash");
});
