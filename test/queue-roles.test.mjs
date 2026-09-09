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
  assert.equal(can("nurse", CAPS.EMR_VIEW), true);     // may READ clinical notes/history (view-only)
  assert.equal(can("nurse", CAPS.EMR_TREAT), false);   // the load-bearing safety rule (never edit/prescribe)
  assert.equal(can("nurse", CAPS.STAFF_ADMIN), false);
});

test("outside staff may READ clinical notes/history but never edit them", () => {
  // Owner ask: the sister/front-desk can view + download a patient's notes; only doctors write.
  ["nurse", "supervisor", "reception"].forEach((r) => {
    assert.equal(can(r, CAPS.EMR_VIEW), true, r + " reads notes");
    assert.equal(can(r, CAPS.EMR_TREAT), false, r + " cannot edit/order/prescribe");
  });
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

// TASK 4.13 (Enterprise RBAC/ABAC): billing/him/blood_bank, least-privilege by construction.
test("billing: reads charges/invoices/claims, never collects payment or touches the chart", () => {
  assert.equal(can("billing", CAPS.BILLING_VIEW), true);
  assert.equal(can("billing", CAPS.ORDER_READ), true);
  assert.equal(can("billing", CAPS.BILLING_CHARGE), false, "a billing clerk does not collect payment - that is cashier's job");
  assert.equal(can("billing", CAPS.EMR_VIEW), false);
  assert.equal(can("billing", CAPS.EMR_TREAT), false);
});

test("him: reads the chart to decide a release and records it, but holds no clinical or billing authority", () => {
  assert.equal(can("him", CAPS.HIM_ROI), true);
  assert.equal(can("him", CAPS.EMR_VIEW), true);
  assert.equal(can("him", CAPS.EMR_TREAT), false);
  assert.equal(can("him", CAPS.STAFF_ADMIN), false, "HIM is not staff.admin - hr's own grant is untouched by this role");
  assert.equal(can("him", CAPS.BILLING_VIEW), false);
});

test("blood_bank: issues transfusions and holds nothing else clinical", () => {
  assert.equal(can("blood_bank", CAPS.TRANSFUSION_ISSUE), true);
  assert.equal(can("blood_bank", CAPS.EMR_VIEW), false);
  assert.equal(can("blood_bank", CAPS.EMR_VITALS), false);
  assert.equal(can("blood_bank", CAPS.EMR_TREAT), false);
});

test("hr's own grant is unwidened by TASK 4.13 - still no HIM_ROI, no TRANSFUSION_ISSUE", () => {
  assert.equal(can("hr", CAPS.HIM_ROI), false);
  assert.equal(can("hr", CAPS.TRANSFUSION_ISSUE), false);
});
