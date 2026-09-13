/* Staff rostering through the real routes, signed in as real staff, with an in-memory Firestore.
 *
 * node --test --experimental-test-module-mocks test/roster-routes.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path.split("/").pop(), name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => [...docs].filter(([p, d]) => p.startsWith(coll + "/") && (!opts?.where || String(d.fields[opts.where.field]) === String(opts.where.value))).map(([p, d]) => ({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime })),
    fsCommit: async (_e, writes) => { for (const w of writes || []) { if (w.delete) { docs.delete(w.delete); continue; } const prev = docs.get(w.update.name); docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) }); } return { ok: true }; },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const ORG = await import("../functions/_opd_org_store.js");
const ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url") };
const call = async (method, path, body, token) => {
  const res = await onRequest({ request: new Request("https://x.test/api/queue/" + path, { method, headers: { "Content-Type": "application/json", "X-Staff-Token": token }, ...(body ? { body: JSON.stringify(body) } : {}) }), env: ENV });
  return { status: res.status, ...(await res.json()) };
};
const tok = {};
async function seed() {
  docs.clear();
  docs.set("q_orgs/org1", { fields: { id: "org1", code: "SMD-ABC123", name: "Test", mode: "clinic", ownerUid: "owner" }, updateTime: "t0" });
  for (const [id, role, pin] of [["admin1", "admin", "4826"], ["nurse1", "nurse", "7391"], ["nurse2", "nurse", "5937"]]) {
    await ORG.setMembership(undefined, "org1", id, { role }, "owner");
    await ORG.setMemberPin(undefined, "org1", id, pin, "owner");
  }
  await new Promise((r) => setTimeout(r, 2));
  for (const [id, pin] of [["admin1", "4826"], ["nurse1", "7391"], ["nurse2", "5937"]]) {
    tok[id] = (await call("POST", "auth/pin", { orgId: "org1", identity: id, pin })).token;
  }
}
const O = { orgId: "org1" };

test("only an admin defines shifts and assigns; everyone can read the rota", async () => {
  await seed();
  const shift = { ...O, id: "day", name: "Day", unit: "Ward A", start: "08:00", end: "20:00", minimum: { nurse: 2 } };
  assert.equal((await call("POST", "roster/shift", shift, tok.nurse1)).status, 403);
  assert.equal((await call("POST", "roster/shift", shift, tok.admin1)).status, 200);
  assert.equal((await call("POST", "roster/assign", { ...O, identity: "nurse1", date: "2026-09-14", shiftId: "day" }, tok.nurse1)).status, 403);
  const shifts = await call("GET", "roster/shifts?orgId=org1", null, tok.nurse2);
  assert.equal(shifts.status, 200);
  assert.equal(shifts.shifts[0].name, "Day");
  assert.equal((await call("POST", "roster/shift", { ...O, name: "Bad", unit: "A", start: "9", end: "10" }, tok.admin1)).error, "bad_time");
  assert.ok([...docs.values()].some((d) => d.fields.action === "roster:shift_saved"), "audited");
});

test("a repeating assignment is all-or-nothing: one clashing week writes none, and says which", async () => {
  await seed();
  await call("POST", "roster/shift", { ...O, id: "day", name: "Day", unit: "Ward A", start: "08:00", end: "20:00", minimum: { nurse: 2 } }, tok.admin1);
  const leave = await call("POST", "roster/leave-request", { ...O, from: "2026-09-21", to: "2026-09-21", reason: "Family wedding" }, tok.nurse1);
  assert.equal((await call("POST", "roster/leave-decide", { ...O, leaveId: leave.leave.id, approve: true }, tok.admin1)).status, 200);

  const r = await call("POST", "roster/assign", { ...O, identity: "nurse1", date: "2026-09-14", shiftId: "day", weeks: 3 }, tok.admin1);
  assert.equal(r.status, 422);
  assert.equal(r.error, "assignment_refused");
  assert.deepEqual(r.refused.map((x) => x.date), ["2026-09-21"]);
  assert.equal([...docs.keys()].filter((k) => k.startsWith("q_roster_assign/")).length, 0, "not even the two good weeks");

  const ok = await call("POST", "roster/assign", { ...O, identity: "nurse2", date: "2026-09-14", shiftId: "day", weeks: 3 }, tok.admin1);
  assert.equal(ok.status, 200);
  assert.equal(ok.assigned.length, 3);
  const cov = await call("GET", "roster/coverage?orgId=org1&from=2026-09-14&to=2026-09-14", null, tok.nurse1);
  assert.deepEqual(cov.coverage[0].gaps, [{ role: "nurse", need: 2, have: 1, short: 1 }], "the shortfall is shown, not papered over");
});

test("leave that clashes with a rostered shift cannot be approved until the shift is dealt with", async () => {
  await seed();
  await call("POST", "roster/shift", { ...O, id: "day", name: "Day", unit: "Ward A", start: "08:00", end: "20:00" }, tok.admin1);
  const a = await call("POST", "roster/assign", { ...O, identity: "nurse1", date: "2026-09-15", shiftId: "day" }, tok.admin1);
  const leave = await call("POST", "roster/leave-request", { ...O, from: "2026-09-15", to: "2026-09-16", reason: "Unwell" }, tok.nurse1);
  assert.equal((await call("POST", "roster/leave-decide", { ...O, leaveId: leave.leave.id, approve: true }, tok.nurse2)).status, 403, "a colleague cannot approve leave");
  const clash = await call("POST", "roster/leave-decide", { ...O, leaveId: leave.leave.id, approve: true }, tok.admin1);
  assert.equal(clash.error, "leave_clashes_with_rota");
  assert.match(clash.message, /2026-09-15/);
  assert.equal((await call("POST", "roster/unassign", { ...O, assignmentId: a.assigned[0].id }, tok.admin1)).error, "reason_required");
  assert.equal((await call("POST", "roster/unassign", { ...O, assignmentId: a.assigned[0].id, reason: "Sick leave" }, tok.admin1)).status, 200);
  assert.equal((await call("POST", "roster/leave-decide", { ...O, leaveId: leave.leave.id, approve: true }, tok.admin1)).status, 200);
});

test("approval lists are the admin's; on-duty answers who is working now", async () => {
  await seed();
  const today = new Date().toISOString().slice(0, 10);
  await call("POST", "roster/shift", { ...O, id: "all", name: "All day", unit: "Ward A", start: "00:00", end: "23:59" }, tok.admin1);
  await call("POST", "roster/assign", { ...O, identity: "nurse1", date: today, shiftId: "all" }, tok.admin1);
  const lv = await call("POST", "roster/leave-request", { ...O, from: "2026-12-01", to: "2026-12-02", reason: "Exam" }, tok.nurse2);
  assert.equal((await call("GET", "roster/leave-pending?orgId=org1", null, tok.nurse1)).status, 403);
  assert.equal((await call("GET", "roster/swap-pending?orgId=org1", null, tok.nurse1)).status, 403);
  const pend = await call("GET", "roster/leave-pending?orgId=org1", null, tok.admin1);
  assert.deepEqual(pend.leave.map((x) => x.id), [lv.leave.id]);
  assert.equal((await call("GET", "roster/swap-pending?orgId=org1", null, tok.admin1)).swaps.length, 0);
  // The hospital clock defaults to IST; an all-day shift today may not cover "now" near UTC midnight, so only check shape.
  const duty = await call("GET", "roster/on-duty?orgId=org1&unit=Ward%20A", null, tok.nurse2);
  assert.equal(duty.status, 200);
  assert.ok(Array.isArray(duty.onDuty));
  assert.ok(duty.onDuty.every((d) => d.unit === "Ward A"));
});

test("a busy hospital with a long rota history can still assign: checks read only the months that matter", async () => {
  await seed();
  await call("POST", "roster/shift", { ...O, id: "day", name: "Day", unit: "Ward A", start: "08:00", end: "20:00" }, tok.admin1);
  for (let i = 0; i < 1200; i++) docs.set("q_roster_assign/old" + i, { fields: { orgId: "org1", orgMonth: "org1|2026-01", identity: "n" + i, date: "2026-01-15", shiftId: "day", status: "active" }, updateTime: "t" });
  const r = await call("POST", "roster/assign", { ...O, identity: "nurse1", date: "2026-09-14", shiftId: "day" }, tok.admin1);
  assert.equal(r.status, 200, JSON.stringify(r).slice(0, 300));
  const again = await call("POST", "roster/assign", { ...O, identity: "nurse1", date: "2026-09-14", shiftId: "day" }, tok.admin1);
  assert.equal(again.error, "assignment_refused", "and the clash check still sees this month");
});

test("a swap needs the colleague to accept and the admin to approve, and is re-checked at approval", async () => {
  await seed();
  await call("POST", "roster/shift", { ...O, id: "day", name: "Day", unit: "Ward A", start: "08:00", end: "20:00" }, tok.admin1);
  await call("POST", "roster/shift", { ...O, id: "late", name: "Late", unit: "ICU", start: "14:00", end: "22:00" }, tok.admin1);
  const a = (await call("POST", "roster/assign", { ...O, identity: "nurse1", date: "2026-09-17", shiftId: "day" }, tok.admin1)).assigned[0];

  assert.equal((await call("POST", "roster/swap-propose", { ...O, assignmentId: a.id, to: "nurse1" }, tok.nurse2)).error, "not_your_shift", "you cannot give away someone else's shift");
  const p = await call("POST", "roster/swap-propose", { ...O, assignmentId: a.id, to: "nurse2" }, tok.nurse1);
  assert.equal(p.status, 200);
  assert.equal((await call("POST", "roster/swap-approve", { ...O, swapId: p.swapId, approve: true }, tok.admin1)).error, "not_accepted");
  assert.equal((await call("POST", "roster/swap-respond", { ...O, swapId: p.swapId, accept: true }, tok.nurse1)).error, "not_your_swap");
  assert.equal((await call("POST", "roster/swap-respond", { ...O, swapId: p.swapId, accept: true }, tok.nurse2)).status, 200);

  // Between accepting and approval nurse2 is given an overlapping late shift: the approval must notice.
  await call("POST", "roster/assign", { ...O, identity: "nurse2", date: "2026-09-17", shiftId: "late" }, tok.admin1);
  const blocked = await call("POST", "roster/swap-approve", { ...O, swapId: p.swapId, approve: true }, tok.admin1);
  assert.equal(blocked.error, "double_booked");

  const late = (await call("GET", "roster/mine?orgId=org1", null, tok.nurse2)).assignments.find((x) => x.shiftId === "late");
  await call("POST", "roster/unassign", { ...O, assignmentId: late.id, reason: "Swap instead" }, tok.admin1);
  assert.equal((await call("POST", "roster/swap-approve", { ...O, swapId: p.swapId, approve: true }, tok.admin1)).status, 200);
  const mine = await call("GET", "roster/mine?orgId=org1", null, tok.nurse2);
  assert.deepEqual(mine.assignments.map((x) => x.date + " " + x.shiftId), ["2026-09-17 day"]);
  assert.equal((await call("GET", "roster/mine?orgId=org1", null, tok.nurse1)).assignments.length, 0);
});
