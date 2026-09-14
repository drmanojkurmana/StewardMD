/* test/opd-dept-token-routes.test.mjs - D7 per-department OPD tokens through the real router.
 *
 * Routes: POST /api/queue/room, POST /api/queue/room/update (a room's department), POST /api/queue/pool and
 * POST /api/queue/ticket (the desk's department picker), GET /api/queue/org (what the picker reads).
 * For each: no session 401, a member without the capability 403 with nothing written, another hospital's
 * admin refused, and the right role succeeds. Same in-memory Firestore harness as neg-auth-org-members.
 *
 * node --test --experimental-test-module-mocks test/opd-dept-token-routes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, ORG, api, seed, dept, ENV, OWNER_A, OWNER_B, HR_A, HR_B, NURSE_A, VIEWER_A, CASHIER_A, DAY } from "./helpers/opd-router-harness.mjs";

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

test("D14 POST /api/queue/org/update tokens: per-department numbering is refused while a department lacks its own prefix; 401, 403 and another hospital write nothing; the admin saves once each has one", async () => {
  seed();
  dept("dnone", "org-a", "Dermatology", "");   // no code, so no default prefix
  const scope = async () => (await ORG.getOrg(ENV, "org-a")).tokens.scope;
  const body = { orgId: "org-a", tokens: { scope: "department", prefixes: { dcard: "C" } } };
  assert.equal((await api("/org/update", "POST", body)).__status, 401);
  assert.equal((await api("/org/update", "POST", body, NURSE_A)).__status, 403);
  const other = await api("/org/update", "POST", body, HR_B);
  assert.ok(other.__status === 403 || other.__status === 404);
  const refused = await api("/org/update", "POST", body, HR_A);
  assert.equal(refused.__status, 422, JSON.stringify(refused));
  assert.equal(refused.error, "token_prefixes_required");
  assert.deepEqual(refused.problems, ["Dermatology has no prefix."]);
  assert.match(refused.message, /was not saved[\s\S]*Dermatology has no prefix/);
  const dup = await api("/org/update", "POST", { orgId: "org-a", tokens: { scope: "department", prefixes: { dcard: "GM", dnone: "D" } } }, HR_A);
  assert.equal(dup.__status, 422); assert.match(dup.message, /both use the prefix GM/);
  assert.equal(await scope(), "hospital", "nothing refused was saved");
  const ok = await api("/org/update", "POST", { orgId: "org-a", tokens: { scope: "department", prefixes: { dcard: "C", dnone: "D" } } }, HR_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(await scope(), "department");
  assert.equal((await api("/org/update", "POST", { orgId: "org-a", tokens: { scope: "hospital" } }, HR_A)).__status, 200, "going back to one sequence needs no prefixes");
});

test("D14 POST /api/queue/patient/register forQueue: in per-department numbering the desk is refused BEFORE an MR number is issued when no department or no prefix; the queue add refuses the same", async () => {
  seed({ scope: "department", prefixes: { dcard: "C" } });
  dept("dnone", "org-a", "Dermatology", "");
  const reg = { orgId: "org-a", name: "Meena Rao", mobile: "9876500001", gender: "female", ageYears: 40, forQueue: "pool" };
  const patients = () => [...docs.keys()].filter((k) => k.startsWith("q_patients/")).length;
  assert.equal((await api("/patient/register", "POST", reg)).__status, 401);
  assert.equal((await api("/patient/register", "POST", reg, CASHIER_A)).__status, 403);
  const none = await api("/patient/register", "POST", reg, NURSE_A);
  assert.equal(none.__status, 422); assert.equal(none.error, "token_department_required"); assert.match(none.errors.departmentId, /Choose a department/);
  const noPrefix = await api("/patient/register", "POST", { ...reg, departmentId: "dnone" }, NURSE_A);
  assert.equal(noPrefix.__status, 422); assert.equal(noPrefix.error, "token_prefix_missing"); assert.match(noPrefix.message, /no token prefix/);
  assert.equal(patients(), 0, "no MR number issued for a registration the queue would refuse");
  const pool = await api("/pool", "POST", { orgId: "org-a", name: "x", mobile: "9876500002", date: DAY }, NURSE_A);
  assert.equal(pool.__status, 422); assert.equal(pool.error, "token_department_required"); assert.match(pool.message, /Choose a department to give a token/);
  assert.equal([...docs.keys()].filter((k) => k.startsWith("q_tickets/")).length, 0);
  const ok = await api("/patient/register", "POST", { ...reg, departmentId: "dcard" }, NURSE_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const noQueue = await api("/patient/register", "POST", { ...reg, mobile: "9876500003", forQueue: undefined }, NURSE_A);
  assert.equal(noQueue.__status, 200, "a registration not for the queue (a ward admission) is not held to the token rules");
});

test("D14 POST /api/queue/import: a roster row whose department has no token department is an issue naming it, not a silent skip", async () => {
  seed({ scope: "department", prefixes: { dcard: "C" }, deptAliases: { "cardio opd": "dcard" } });
  const sess = await api(`/session?hospitalId=org-a&date=${DAY}`, "GET", null, OWNER_A);
  const body = { sessionId: sess.session.id, rows: [{ PatientName: "Asha", PatientId: "MR7", VisitId: "e1", Department: "Cardio OPD" }, { PatientName: "Ravi", PatientId: "MR8", VisitId: "e2", Department: "ENT" }] };
  assert.equal((await api("/import", "POST", body)).__status, 401);
  assert.equal((await api("/import", "POST", body, OWNER_B)).__status, 403);
  const r = await api("/import", "POST", body, OWNER_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.imported, 1);
  assert.deepEqual(r.issues, [{ reason: "token_department_required", department: "ENT" }]);
  assert.equal(r.tickets[0].token, "C-001");
});
