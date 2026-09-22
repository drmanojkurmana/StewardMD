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
test("everyone shares the common dashboard and has sign out buttons on both opd and billing", () => {
  assert.match(CONSOLE_HTML, /st\.billingOn/, "the console must know the server's billing switch");
  assert.match(CONSOLE_HTML, /id="lo"/, "OPD console has Sign out button");
  assert.match(STATION_HTML, /id="loBtn"/, "billing station has Sign out button");
  assert.match(STATION_HTML, /billing_disabled/, "billing station explains when billing is switched off");
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

test("OPD queue shows billing chips and Bill button with MRN", () => {
  assert.match(CONSOLE_HTML, /data-a="bill"/, "OPD tickets must have a Bill button");
  assert.match(CONSOLE_HTML, /data-mrn=/, "OPD tickets must pass MRN to billing");
  assert.match(CONSOLE_HTML, /billingStatus/, "OPD tickets render billing status chips");
  assert.match(CONSOLE_HTML, /\/clinic-billing\?patientId=/, "Bill action redirects to /clinic-billing with patientId prefilled");
  assert.match(CONSOLE_HTML, /orgId=/, "Bill action carries the org");
  assert.match(CONSOLE_HTML, /ticketId=/, "Bill action carries the ticket");
});

test("clinic billing station displays Today's OPD Queue and handles ticket/MRN lookup", () => {
  assert.match(STATION_HTML, /Today.*OPD Queue/, "Billing station must render today's registered OPD patients");
  assert.match(STATION_HTML, /data-opd-bill=/, "Today's OPD queue has 1-click Bill buttons");
  assert.match(STATION_HTML, /P\.get\("ticketId"\)/, "Billing station handles ticketId in query params");
});

test("queue router provides orders, tariff, and today's opd patients in bill segment", () => {
  assert.match(ROUTER, /sub === "orders" && method === "GET"/, "Router must handle GET orders for billing");
  assert.match(ROUTER, /sub === "tariff" && method === "GET"/, "Router must handle GET tariff for price list");
  assert.match(ROUTER, /opdPatients/, "Router bill queue must return opdPatients");
});

test("tariff and order validation supports consultation fee and rich metadata", async () => {
  const { validateTariff, validateOrder } = await import("../functions/_clinic_billing.js");
  const trf = validateTariff({
    name: "Consultation - Dr. Rajesh",
    kind: "consultation",
    price: 50000,
    doctorId: "dr1",
    doctorName: "Dr. Rajesh",
    stock: 0,
    dosageForm: "",
    unit: ""
  });
  assert.equal(trf.ok, true);
  assert.equal(trf.item.kind, "consultation");
  assert.equal(trf.item.doctorId, "dr1");
  assert.equal(trf.item.doctorName, "Dr. Rajesh");
  assert.equal(trf.item.price, 50000);

  const medTrf = validateTariff({
    name: "Paracetamol 650mg",
    kind: "medication",
    price: 3000,
    stock: 150,
    dosageForm: "Tab",
    unit: "strip"
  });
  assert.equal(medTrf.ok, true);
  assert.equal(medTrf.item.kind, "medication");
  assert.equal(medTrf.item.stock, 150);
  assert.equal(medTrf.item.dosageForm, "Tab");
  assert.equal(medTrf.item.unit, "strip");

  const ordCons = validateOrder({ patientId: "P1", name: "Consultation", kind: "consultation", qty: 1, unitPrice: 50000 });
  assert.equal(ordCons.ok, true);
  assert.equal(ordCons.order.kind, "consultation");

  const ordSvc = validateOrder({ patientId: "P1", name: "ECG", kind: "service", qty: 1, unitPrice: 25000 });
  assert.equal(ordSvc.ok, true);
  assert.equal(ordSvc.order.kind, "service");
});

test("OPD admin provides Tariff & Stock manager, Quick Pay, and dual billing flows", () => {
  assert.match(CONSOLE_HTML, /id="tariffBtn"/, "OPD header must include Tariff & Stock button");
  assert.match(CONSOLE_HTML, /openTariffAdmin/, "OPD console must define openTariffAdmin");
  assert.match(CONSOLE_HTML, /openQuickPay/, "OPD console must define openQuickPay");
  assert.match(CONSOLE_HTML, /autoQueueConsultationFee/, "OPD console must define autoQueueConsultationFee");
  assert.match(CONSOLE_HTML, /Doctor Fees/, "Tariff admin must offer Doctor Fees tab");
  assert.match(CONSOLE_HTML, /Pharmacy Stock/, "Tariff admin must offer Pharmacy Stock tab");
  assert.match(CONSOLE_HTML, /Investigations/, "Tariff admin must offer Investigations tab");
  assert.match(CONSOLE_HTML, /Billing Flow/, "Tariff admin must offer Billing Flow tab");
  assert.match(CONSOLE_HTML, /Pay First \(Pre-Paid Consultation\)/, "Billing flow offers Pay First option");
  assert.match(CONSOLE_HTML, /Doctor Visit First \(Post-Paid Consultation\)/, "Billing flow offers Doctor Visit First option");
});

test("clinic billing station offers 1-click consultation fee and OPD admin link", () => {
  assert.match(STATION_HTML, /tQuickCons/, "Billing station offers 1-click quick consultation fee button");
  assert.match(STATION_HTML, /Go to OPD Admin/, "Empty price list directs owner to OPD Admin");
});

test("org schema preserves opdBillingMode and defaultConsultationFee", async () => {
  const { org } = await import("../functions/_opd_org.js");
  const o1 = org({ id: "o1", name: "Clinic 1", opdBillingMode: "doctor_first", defaultConsultationFee: 75000 });
  assert.equal(o1.opdBillingMode, "doctor_first");
  assert.equal(o1.defaultConsultationFee, 75000);

  const o2 = org({ id: "o2", name: "Clinic 2" });
  assert.equal(o2.opdBillingMode, "pay_first", "defaults to pay_first");
  assert.equal(o2.defaultConsultationFee, 0);
});

test("MaikOS: triage vitals sync and unified catalog in OPD EMR and queue", async () => {
  const OPD_EMR_SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const QUEUE_SRC = readFileSync(new URL("../queue.js", import.meta.url), "utf8");
  const { decorateForDoctor } = await import("../functions/_queue_engine.js");

  // 1. decorateForDoctor retains vitals
  const decorated = await decorateForDoctor({}, [{
    id: "t1", encName: "", encMobile: "", mrn: "MRN-1",
    vitals: { sbp: "120", dbp: "80", pulse: "72", temp: "98.4", spo2: "99", rr: "16", weight: "68" }
  }]);
  assert.ok(decorated[0].vitals, "decorated ticket must carry vitals");
  assert.equal(decorated[0].vitals.sbp, "120");
  assert.equal(decorated[0].vitals.pulse, "72");

  // 2. queue.js passes vitals and orgId into OPDEMR.openProfile
  assert.match(QUEUE_SRC, /vitals:\s*t\.vitals/, "openTicketEmr must pass ticket vitals");
  assert.match(QUEUE_SRC, /orgId:\s*st\.orgId/, "openTicketEmr must pass orgId");

  // 3. opd-emr.js implements applyTicketVitals, vitalsSyncBanner, and unified non-GHIS catalog search
  assert.match(OPD_EMR_SRC, /applyTicketVitals/, "opd-emr.js must define applyTicketVitals");
  assert.match(OPD_EMR_SRC, /vitalsSyncBanner/, "opd-emr.js must define vitalsSyncBanner");
  assert.match(OPD_EMR_SRC, /oe-vitals-synced/, "opd-emr.js must render synced vitals badge");
  assert.match(OPD_EMR_SRC, /inv-catalog\?kind=/, "opd-emr.js routes non-GHIS searches to inv-catalog");
  assert.doesNotMatch(OPD_EMR_SRC, /st\.source !== "ghis".*offghis/, "offghis wall must be removed for clinic records");
});


