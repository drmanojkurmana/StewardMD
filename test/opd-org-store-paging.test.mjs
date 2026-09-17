/* R4-3 shared-store caps: beds, wards, rooms, departments, queue tickets, sessions, staff, the events timeline and the
 * chart of accounts read every page, through the real Firestore REST client. fetch plays Firestore's runQuery (the
 * same fake as clinic-billing-paging.test.mjs): equality filters, __name__ order, startAt after a name, limit.
 * Nothing past the old caps may be dropped; a failed page is an error; past a ceiling the read throws.
 * node --test --experimental-test-module-mocks test/opd-org-store-paging.test.mjs */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../functions/_fbadmin.js", { namedExports: { serviceAccountToken: async () => "tok" } });
const ORG = await import("../functions/_opd_org_store.js");
const Q = await import("../functions/_queue_engine.js");
const ACCOUNTS = await import("../functions/_accounts_store.js");

const ROOT = "projects/stewardmd-498ec/databases/(default)/documents/";
let docs = [];          // [{ coll, id, fields }]
let calls = [];         // structuredQuery bodies
let failOnCall = 0;     // 1-based call number that answers 500
const enc = (v) => (typeof v === "number" ? { integerValue: String(v) } : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) });
const dec = (v) => ("integerValue" in v ? Number(v.integerValue) : "booleanValue" in v ? v.booleanValue : v.stringValue);
globalThis.fetch = async (url, init) => {
  assert.match(String(url), /:runQuery$/);
  const q = JSON.parse(init.body).structuredQuery;
  calls.push(q);
  if (failOnCall && calls.length === failOnCall) return new Response("boom", { status: 500 });
  const w = q.where || null;
  const filters = !w ? [] : w.compositeFilter ? (assert.equal(w.compositeFilter.op, "AND"), w.compositeFilter.filters) : [w];
  for (const f of filters) assert.equal(f.fieldFilter.op, "EQUAL", "equality only: no composite index needed");
  if (q.orderBy) assert.deepEqual(q.orderBy, [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }]);
  let rows = docs.filter((d) => d.coll === q.from[0].collectionId)
    .filter((d) => filters.every((f) => d.fields[f.fieldFilter.field.fieldPath] === dec(f.fieldFilter.value)))
    .map((d) => ({ name: ROOT + d.coll + "/" + d.id, d }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (q.startAt) rows = rows.filter((r) => r.name > q.startAt.values[0].referenceValue);
  if (q.limit) rows = rows.slice(0, q.limit);
  const out = rows.map((r) => ({ document: { name: r.name, fields: Object.fromEntries(Object.entries(r.d.fields).map(([k, v]) => [k, enc(v)])) } }));
  return new Response(JSON.stringify(out.length ? out : [{ readTime: "x" }]), { status: 200 });
};
const pad = (n) => String(n).padStart(6, "0");
const reset = () => { docs = []; calls = []; failOnCall = 0; };

test("650 beds across 2 pages are all listed (the board read 500); another hospital's beds are not", async () => {
  reset();
  for (let i = 0; i < 650; i++) docs.push({ coll: "q_beds", id: "bed" + pad(i), fields: { orgId: "o1", wardId: i < 400 ? "w1" : "w2", name: "B" + i, active: true } });
  docs.push({ coll: "q_beds", id: "bedzzz", fields: { orgId: "o2", wardId: "w1", name: "Other", active: true } });
  const beds = await ORG.listBeds({}, "o1");
  assert.equal(beds.length, 650);
  assert.ok(beds.find((b) => b.name === "B649"), "bed 650 is on the board");
  assert.equal(calls.length, 2);
  assert.equal((await ORG.listBeds({}, "o1", "w2")).length, 250, "one ward's beds past the old cap");
});

test("a bed page that fails errors instead of returning the first 500 beds", async () => {
  reset();
  for (let i = 0; i < 650; i++) docs.push({ coll: "q_beds", id: "bed" + pad(i), fields: { orgId: "o1", wardId: "w1", name: "B" + i } });
  failOnCall = 2;
  await assert.rejects(() => ORG.listBeds({}, "o1"), /fs_query_failed/);
});

test("more beds than BED_CAP throws (507) rather than show a partial board", async () => {
  reset();
  for (let i = 0; i <= ORG.BED_CAP; i++) docs.push({ coll: "q_beds", id: "bed" + pad(i), fields: { orgId: "o1", wardId: "w1", name: "B" + i } });
  await assert.rejects(() => ORG.listBeds({}, "o1"), (e) => e.message === "beds_too_many" && e.status === 507);
});

test("250 wards, 250 rooms and 250 departments are all listed (each read 200)", async () => {
  reset();
  for (let i = 0; i < 250; i++) {
    docs.push({ coll: "q_wards", id: "w" + pad(i), fields: { orgId: "o1", name: "Ward " + i } });
    docs.push({ coll: "q_departments", id: "d" + pad(i), fields: { orgId: "o1", name: "Dept " + i } });
    docs.push({ coll: "q_rooms", id: "r" + pad(i), fields: { orgId: "o1", name: "Room " + i, departmentId: "d" + pad(i) } });
  }
  assert.equal((await ORG.listWards({}, "o1")).length, 250);
  assert.equal((await ORG.listDepartments({}, "o1")).length, 250);
  const rooms = await ORG.listRooms({}, "o1");
  assert.equal(rooms.length, 250);
  assert.equal(rooms.find((r) => r.name === "Room 249").department, "Dept 249", "room 250's department resolves from department 250");
});

test("a session's 600 tickets all come back (the queue read 500)", async () => {
  reset();
  for (let i = 0; i < 600; i++) docs.push({ coll: "q_tickets", id: "t" + pad(i), fields: { sessionId: "s1", hospitalId: "h1", status: "registered" } });
  docs.push({ coll: "q_tickets", id: "tzzz", fields: { sessionId: "s2", hospitalId: "h1", status: "registered" } });
  assert.equal((await Q.listTickets({}, "s1")).length, 600);
});

test("today's sessions are found past 300 older ones (the board read the hospital's first 200 and filtered by day)", async () => {
  reset();
  for (let i = 0; i < 300; i++) docs.push({ coll: "q_sessions", id: "a" + pad(i), fields: { hospitalId: "h1", date: "2026-01-01", doctorUid: "d" + i } });
  docs.push({ coll: "q_sessions", id: "z1", fields: { hospitalId: "h1", date: "2026-09-17", doctorUid: "dx" } });
  docs.push({ coll: "q_sessions", id: "z2", fields: { hospitalId: "h2", date: "2026-09-17", doctorUid: "dy" } });
  const s = await Q.listSessions({}, "h1", "2026-09-17");
  assert.deepEqual(s.map((x) => x.id), ["z1"]);
  assert.ok(calls[0].where.compositeFilter, "asked by hospital AND day");
});

test("250 staff mappings are all listed (read 200), removed ones left out", async () => {
  reset();
  for (let i = 0; i < 250; i++) docs.push({ coll: "q_staff", id: "e" + pad(i), fields: { hospitalId: "h1", role: "nurse", employeeId: "e" + i } });
  docs.push({ coll: "q_staff", id: "ezzz", fields: { hospitalId: "h1", role: "viewer", removedAt: 5 } });
  assert.equal((await Q.listStaff({}, "h1")).length, 250);
});

test("600 other-session events plus 3 of this session: the timeline shows the 3 (it read the hospital's first 500)", async () => {
  reset();
  docs.push({ coll: "q_tickets", id: "tk1", fields: { sessionId: "s1", hospitalId: "h1", mrnLast4: "1234" } });
  docs.push({ coll: "q_tickets", id: "tk2", fields: { sessionId: "s1", hospitalId: "h1", mrnLast4: "5678" } });
  // Named so they sort BEFORE this session's rows, exactly how the old first-500 read lost them.
  for (let i = 0; i < 600; i++) docs.push({ coll: "q_events", id: "a" + pad(i), fields: { hospitalId: "h1", ticketId: "other" + i, action: "move", ts: i } });
  docs.push({ coll: "q_events", id: "z1", fields: { hospitalId: "h1", ticketId: "tk1", action: "register", ts: 1000 } });
  docs.push({ coll: "q_events", id: "z2", fields: { hospitalId: "h1", ticketId: "tk1", action: "call", ts: 2000 } });
  docs.push({ coll: "q_events", id: "z3", fields: { hospitalId: "h1", ticketId: "tk2", action: "register", ts: 1500 } });
  docs.push({ coll: "q_events", id: "z4", fields: { hospitalId: "h2", ticketId: "tk1", action: "register", ts: 3000 } });   // another hospital
  const ev = await Q.auditTimeline({}, { id: "s1", hospitalId: "h1" });
  assert.deepEqual(ev.map((e) => [e.action, e.mrnLast4]), [["call", "1234"], ["register", "5678"], ["register", "1234"]]);
  for (const q of calls.slice(1)) assert.ok(q.where.compositeFilter, "events asked by hospital AND ticket");
});

test("a failed events page is an error, not an empty timeline", async () => {
  reset();
  docs.push({ coll: "q_tickets", id: "tk1", fields: { sessionId: "s1", hospitalId: "h1" } });
  failOnCall = 2;
  await assert.rejects(() => Q.auditTimeline({}, { id: "s1", hospitalId: "h1" }), /fs_query_failed/);
});

test("a chart of 600 accounts is read whole (it read 500)", async () => {
  reset();
  for (let i = 0; i < 600; i++) docs.push({ coll: "q_acct_chart", id: "a" + pad(i), fields: { orgId: "o1", code: String(10000 + i), name: "Account " + i, type: "expense" } });
  const r = await ACCOUNTS.getChart({}, "o1");
  assert.equal(r.defaulted, false);
  assert.equal(r.chart.length, 600);
});
