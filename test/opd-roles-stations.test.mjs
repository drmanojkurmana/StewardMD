/* test/opd-roles-stations.test.mjs — the OPD role audit fixes (24 Aug 2026).
 *
 * Covers, in the order the audit ranked them:
 *   BLOCKING  pharmacy role + dispensing station did not exist
 *   BLOCKING  the cashier was redirected into a billing station that is switched off
 *   BLOCKING  an invited doctor resolved to "not a member" in the phone app (uid vs email)
 *   GAP       no HR role: onboarding a nurse required full admin
 *   GAP       intern could advance a patient but not register one
 *   GAP       payment could not be reflected back into the visit
 *   PRIVACY   /list shipped completed + cancelled patients to every client
 *   FOOTGUN   roleForActor imported into the router would demote every nurse
 *
 * node --test test/opd-roles-stations.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPS, ROLE_CAPS, can, capsFor } from "../functions/_queue_roles.js";
import { canOrderTransition, isOrderTerminal, isDispensable, validateOrder, ORDER_STATES } from "../functions/_clinic_billing.js";

const ROUTER = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
const CONSOLE_HTML = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
const STATION_HTML = readFileSync(new URL("../clinic-billing.html", import.meta.url), "utf8");
const ORG_STORE = readFileSync(new URL("../functions/_opd_org_store.js", import.meta.url), "utf8");

/* ---------------------------------------------------------------- pharmacy */
test("pharmacy is a real role that can read and dispense orders", () => {
  assert.ok(ROLE_CAPS.pharmacy, "pharmacy role must exist");
  assert.ok(can("pharmacy", CAPS.ORDER_READ));
  assert.ok(can("pharmacy", CAPS.ORDER_DISPENSE));
  assert.ok(can("pharmacy", CAPS.QUEUE_VIEW));
});

test("SAFETY: the pharmacy cannot take money, and the cashier cannot release medicines", () => {
  assert.equal(can("pharmacy", CAPS.BILLING_CHARGE), false, "dispensing and collecting payment stay separate");
  assert.equal(can("cashier", CAPS.ORDER_DISPENSE), false);
  assert.equal(can("pharmacy", CAPS.EMR_VIEW), false, "dispensing needs the order, not the consultation notes");
  assert.equal(can("pharmacy", CAPS.EMR_TREAT), false);
});

test("an order can only be dispensed after it is paid", () => {
  assert.ok(ORDER_STATES.includes("dispensed"));
  assert.equal(canOrderTransition("paid", "dispensed"), true);
  assert.equal(canOrderTransition("ordered", "dispensed"), false, "never hand over an unbilled order");
  assert.equal(canOrderTransition("billed", "dispensed"), false, "never hand over an unpaid order");
  assert.equal(canOrderTransition("cancelled", "dispensed"), false);
  assert.equal(canOrderTransition("dispensed", "paid"), false, "dispensing is final");
});

test("only medicines are dispensable; investigations finish at paid", () => {
  assert.equal(isDispensable({ status: "paid", kind: "medication" }), true);
  assert.equal(isDispensable({ status: "paid", kind: "investigation" }), false);
  assert.equal(isDispensable({ status: "billed", kind: "medication" }), false);
  // isOrderTerminal keeps its old single-argument behaviour for non-medication callers.
  assert.equal(isOrderTerminal("paid"), true, "back-compatible: no kind -> terminal");
  assert.equal(isOrderTerminal("paid", "medication"), false, "a paid medicine is still owed to the patient");
  assert.equal(isOrderTerminal("paid", "investigation"), true);
  assert.equal(isOrderTerminal("dispensed", "medication"), true);
});

test("the server exposes a pharmacy queue and a dispense action, capability-gated", () => {
  assert.match(ROUTER, /pharmacy:\s*CAPS\.ORDER_READ/);
  assert.match(ROUTER, /dispense:\s*CAPS\.ORDER_DISPENSE/);
  assert.match(ROUTER, /sub === "pharmacy" && method === "GET"/);
  assert.match(ROUTER, /sub === "dispense" && method === "POST"/);
});

test("the station page has a pharmacy mode", () => {
  assert.match(STATION_HTML, /station.*pharmacy/i);
  assert.match(STATION_HTML, /pharmacyView/);
  assert.match(STATION_HTML, /data-disp/, "each owed medicine gets a dispense control");
});

/* ---------------------------------------------------------------- HR */
test("HR can manage staff without gaining clinical or billing power", () => {
  assert.ok(can("hr", CAPS.STAFF_ADMIN), "the whole point of the role");
  assert.ok(can("hr", CAPS.ANALYTICS_VIEW));
  for (const forbidden of [CAPS.EMR_VIEW, CAPS.EMR_TREAT, CAPS.EMR_VITALS, CAPS.BILLING_CHARGE,
                           CAPS.QUEUE_ADD, CAPS.QUEUE_REORDER, CAPS.QUEUE_ASSIGN, CAPS.ORDER_CREATE]) {
    assert.equal(can("hr", forbidden), false, "hr must not hold " + forbidden);
  }
});

test("the console offers every real role, including the new ones", () => {
  const line = CONSOLE_HTML.split("\n").find((l) => l.includes("var ROLES="));
  for (const r of ["nurse", "reception", "intern", "doctor", "cashier", "pharmacy", "hr", "admin"]) {
    assert.ok(line.includes('"' + r + '"'), r + " must be assignable in the Staff panel");
  }
});

/* ---------------------------------------------------------------- intern */
test("an intern can now register a walk-in, but still cannot triage", () => {
  assert.ok(can("intern", CAPS.QUEUE_ADD), "the person handed a walk-in must be able to enter them");
  assert.ok(can("intern", CAPS.EMR_VITALS));
  assert.equal(can("intern", CAPS.QUEUE_REORDER), false, "who is seen next stays the nurse's authority");
  assert.equal(can("intern", CAPS.QUEUE_ASSIGN), false);
  assert.equal(can("intern", CAPS.EMR_TREAT), false, "never prescribing");
  assert.deepEqual(capsFor("intern"), capsFor("resident"), "resident mirrors intern");
});

/* ---------------------------------------------------------------- cashier landing */
test("the cashier is not redirected into a station the server has switched off", () => {
  assert.match(CONSOLE_HTML, /st\.billingOn/, "the console must know the server's billing switch");
  assert.match(CONSOLE_HTML, /stationRole&&st\.billingOn/, "redirect only when the station is actually on");
  assert.match(CONSOLE_HTML, /stationRole&&!st\.billingOn/, "otherwise explain, do not strand");
  assert.match(ROUTER, /billing: BILL\.billingEnabled\(env\)/, "whoami reports it");
});

/* ---------------------------------------------------------------- invited doctor */
test("membership resolves by uid OR email, so an invited doctor works in the app", () => {
  assert.match(ORG_STORE, /if \(!m && actor && actor\.email\) m = await getMembership\(env, orgId, actor\.email\)/);
});

/* ---------------------------------------------------------------- payment -> visit */
test("an order carries the visit link so a payment can reach the doctor's timeline", () => {
  const v = validateOrder({ patientId: "SMD-AB12CD-0007", name: "Amoxicillin 500mg", kind: "medication", ticketId: "t1", sessionId: "s1" });
  assert.ok(v.ok);
  assert.equal(v.order.ticketId, "t1");
  assert.equal(v.order.sessionId, "s1");
  // A billing-desk walk-in has no visit to notify - that must not break the order.
  const w = validateOrder({ patientId: "SMD-AB12CD-0008", name: "Dressing", kind: "investigation" });
  assert.ok(w.ok);
  assert.equal(w.order.ticketId, "");
});

/* ---------------------------------------------------------------- privacy + footgun */
test("PRIVACY: /list returns only active tickets", () => {
  const list = ROUTER.slice(ROUTER.indexOf('seg === "list"'));
  const handler = list.slice(0, 1200);
  assert.match(handler, /ACTIVE\.indexOf\(t\.status\) > -1/, "finished patients must not be broadcast every poll");
});

test("FOOTGUN: roleForActor is not imported into the queue router", () => {
  const importLine = ROUTER.split("\n").find((l) => l.includes("_queue_roles.js") && l.startsWith("import"));
  assert.ok(importLine, "the roles import must still exist");
  assert.equal(importLine.includes("roleForActor"), false,
    "roleForActor prefers actor.role, hardcoded to 'viewer' for staff - wiring it up demotes every nurse");
});

test("the ?mock=1 preview says it is a preview", () => {
  assert.match(CONSOLE_HTML, /Preview with sample data/);
});
