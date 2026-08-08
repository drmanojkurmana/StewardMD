// test/queue-roles.test.mjs — OPD staff RBAC (pure capability matrix). Guards least-privilege + the
// owner's non-negotiables: nurse can record vitals but NEVER treat; unmapped logins are read-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPS, ROLES, can, capsFor, roleForActor, requireCap, isRole } from "../functions/_queue_roles.js";

test("nurse can run the queue + record vitals but NEVER treat", () => {
  assert.equal(can("nurse", CAPS.QUEUE_REORDER), true);
  assert.equal(can("nurse", CAPS.QUEUE_ASSIGN), true);
  assert.equal(can("nurse", CAPS.QUEUE_PRIORITY), true);
  assert.equal(can("nurse", CAPS.EMR_VITALS), true);
  assert.equal(can("nurse", CAPS.EMR_TREAT), false);   // the load-bearing safety rule
  assert.equal(can("nurse", CAPS.STAFF_ADMIN), false);
});

test("only doctor/admin may treat; only admin manages staff", () => {
  assert.equal(can("doctor", CAPS.EMR_TREAT), true);
  assert.equal(can("admin", CAPS.EMR_TREAT), true);
  assert.equal(can("supervisor", CAPS.EMR_TREAT), false);
  assert.equal(can("reception", CAPS.EMR_TREAT), false);
  assert.equal(can("intern", CAPS.EMR_TREAT), false);
  assert.equal(can("admin", CAPS.STAFF_ADMIN), true);
  assert.equal(can("doctor", CAPS.STAFF_ADMIN), false);
  assert.equal(can("supervisor", CAPS.STAFF_ADMIN), false);
});

test("reception registers + assigns but cannot reorder/priority/EMR", () => {
  assert.equal(can("reception", CAPS.QUEUE_ADD), true);
  assert.equal(can("reception", CAPS.QUEUE_ASSIGN), true);
  assert.equal(can("reception", CAPS.QUEUE_REORDER), false);
  assert.equal(can("reception", CAPS.QUEUE_PRIORITY), false);
  assert.equal(can("reception", CAPS.EMR_VITALS), false);
});

test("viewer (unmapped default) is read-only", () => {
  assert.deepEqual(capsFor("viewer"), [CAPS.QUEUE_VIEW]);
  assert.equal(can("viewer", CAPS.QUEUE_ADD), false);
  assert.equal(can("viewer", CAPS.QUEUE_REORDER), false);
});

test("unknown role holds no capabilities", () => {
  assert.deepEqual(capsFor("wizard"), []);
  assert.equal(can("wizard", CAPS.QUEUE_VIEW), false);
  assert.equal(isRole("wizard"), false);
  assert.equal(isRole("nurse"), true);
});

test("roleForActor: owner->admin, staff record used, else least-privilege viewer; client role never trusted blindly", () => {
  assert.equal(roleForActor({ role: "nurse" }, null, true), "admin");           // owner always admin
  assert.equal(roleForActor(null, { role: "supervisor" }, false), "supervisor"); // staff mapping
  assert.equal(roleForActor(null, { role: "hacker" }, false), "viewer");         // bogus mapped role
  assert.equal(roleForActor(null, null, false), "viewer");                       // unmapped
  assert.equal(roleForActor({ role: "doctor" }, null, false), "doctor");         // trusted doctor session
  assert.equal(roleForActor({ role: "not-a-role" }, null, false), "viewer");     // bogus actor role ignored
});

test("requireCap throws a 403-shaped error only when the capability is missing", () => {
  assert.equal(requireCap("nurse", CAPS.EMR_VITALS), true);
  assert.throws(() => requireCap("nurse", CAPS.EMR_TREAT), (e) => e.status === 403 && e.detail === CAPS.EMR_TREAT);
  assert.throws(() => requireCap("viewer", CAPS.QUEUE_ADD), (e) => e.status === 403);
});

test("every role's caps are valid capability strings (no typos)", () => {
  const valid = new Set(Object.values(CAPS));
  for (const role of ROLES) for (const c of capsFor(role)) assert.equal(valid.has(c), true, role + " has bad cap " + c);
});
