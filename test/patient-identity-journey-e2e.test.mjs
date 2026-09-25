/* test/patient-identity-journey-e2e.test.mjs — Wave 4: Universal Patient Identity
 * full-lifecycle journey (StewardID 2.0 / Ni-Key).
 *
 * One patient, end to end, against the real modules: registration mints the canonical
 * StewardID; the done card issues the identity package (Code128 barcode + QR label via
 * barcode128.js / pglog-qr.js, Ni-Key NFC write with read-back verification via smd-nfc.js);
 * OPD queue check-in, nurse triage, doctor consultation, follow-up (parentEncounterId),
 * pharmacy dispense (dispensedBy/dispensedAt), billing invoice + payment, IPD admission
 * with bedside 5-rights verification, and carrier replacement with full continuity.
 *
 * Tests run in file order sharing one journey state J; each stage asserts its own
 * artifacts AND that every earlier artifact still names the same patient. Server-only
 * writes (invoice totals, dispense patient-claim guard) are pinned by source assertion
 * plus a faithful in-test execution of the same rule.
 *
 * node --test test/patient-identity-journey-e2e.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import R from "../steward-identity-resolver.js";
import PatientIdentityScanner from "../smd-identity-scanner.js";
import SMD_NFC from "../smd-nfc.js";

const require = createRequire(import.meta.url);
const BC = require("../barcode128.js");
const QR = require("../pglog-qr.js");

const WARD_SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
const EMR_SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
const REG_SRC = readFileSync(new URL("../patient-register.js", import.meta.url), "utf8");
const BILLING_SRC = readFileSync(new URL("../clinic-billing.html", import.meta.url), "utf8");
const BILLING_STORE_SRC = readFileSync(new URL("../functions/_clinic_billing_store.js", import.meta.url), "utf8");

/* patient-register.js is a window IIFE; its pure card builders then run DOM-free. */
const regWindow = { document: {} };
globalThis.window = regWindow;
const REG = (await import("../patient-register.js")).default;
delete globalThis.window;

function loadEmr() {
  const mkEl = () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    _h: "", set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
  });
  const rootEl = mkEl();
  const win = { SMD_QUEUE_FLAGS: { bool: (k) => k === "smd_opd_emr" } };
  const doc = {
    getElementById: (id) => (id === "smdOpdEmr" ? rootEl : null),
    createElement: () => mkEl(), body: { appendChild() {} },
    addEventListener() {}, querySelectorAll: () => [],
  };
  new Function("window", "document", "location", "localStorage", EMR_SRC)(
    win, doc, { search: "", hostname: "" }, { getItem: () => null, setItem() {} }
  );
  return win.OPDEMR;
}

function loadWardBedside() {
  const win = { StewardIdentityResolver: R };
  const doc = {
    getElementById: () => null,
    createElement: () => ({ classList: { add() {}, remove() {} } }),
    body: { appendChild() {} },
  };
  new Function("window", "document", "location", "localStorage", WARD_SRC)(
    win, doc, { search: "" }, { getItem: () => null, setItem() {} }
  );
  return win.WARD._bedside;
}

class MockNDEFReader {
  async scan() { return Promise.resolve(); }
  async write() { return Promise.resolve(); }
}

/* The journey state: every stage stamps (patientId, encounterId); the last stage proves
 * the whole chain still resolves to the same patient after a carrier replacement. */
const J = {
  sid: "", mrn: "MRN-J1", name: "Journey Jaya",
  store: {}, encounters: [], tickets: [], vitals: [], notes: [], orders: [],
  invoices: [], dispenses: [], administrations: [], carriers: {},
};
function patientRecord() { return J.store[J.sid]; }
function resolveAs(type, value) {
  return R.resolvePatientIdentity({ type, value }, { patientStore: J.store });
}

/* ── Stage 1: front-desk registration mints the canonical StewardID ────────── */

test("J1: registration mints a canonical StewardID for the walk-in patient", () => {
  R.reset();
  /* 2026-09-24: the StewardID is minted and reserved by the SERVER at registration. The sheet used to
   * mint one itself, unique only within its tab, and the server dropped it - so the card resolved
   * nowhere. The sheet now mints nothing; R.mintStewardId below stands in for the server's answer. */
  assert.doesNotMatch(REG_SRC, /mintStewardId\(\)/, "the register sheet never mints an ID on the device");
  J.sid = R.mintStewardId();
  assert.match(J.sid, /^SMP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/, "SMP-, never the clinic-code SMD- namespace");
  J.store[J.sid] = {
    name: J.name, stewardId: J.sid, mrn: J.mrn, mobile: "9876543220",
    history: [], encounters: J.encounters,
  };
  assert.equal(patientRecord().stewardId, J.sid);
});

/* ── Stage 2: identity package — barcode + QR label, Ni-Key write + verify ── */

test("J2: done card issues barcode + QR label and a read-back-verified Ni-Key tag", async () => {
  regWindow.openFileLabel = () => {};
  const html = REG._doneHtml({ mrn: J.mrn, stewardId: J.sid, name: J.name });
  assert.match(html, /Write Ni-Key NFC Tag/);
  assert.match(html, new RegExp('data-sid="' + J.sid + '"'));
  assert.match(html, /data-a="print-label"/, "file label offered where the dialog exists");
  delete regWindow.openFileLabel;

  // The label renderers both encode this patient's identity.
  const barcode = BC.toSvg(J.sid);
  assert.ok(barcode.startsWith("<svg"));
  assert.ok(barcode.includes("<rect"), "rect bars");
  assert.match(barcode, new RegExp("<text[^>]*>" + J.sid + "</text>"), "StewardID captioned under the bars");
  const deepLink = "https://stewardmd.in/opd?uid=" + encodeURIComponent(J.sid);
  const qr = QR.toSvg(deepLink);
  assert.ok(qr.startsWith("<svg"), "QR label renders");

  // WRITE -> READ BACK -> COMPARE -> SUCCESS through the real NFC bridge.
  globalThis.window = { NDEFReader: MockNDEFReader };
  try {
    const written = await SMD_NFC.writeTag(
      { text: J.sid, url: deepLink },
      { verifyReadBack: true, simulatedReadBack: J.sid }
    );
    assert.equal(written.success, true);
    await assert.rejects(
      SMD_NFC.writeTag({ text: J.sid, url: "" }, { verifyReadBack: true, simulatedReadBack: "WRONG" }),
      (e) => e.code === "WRITE_VERIFICATION_FAILED",
      "a mismatched read-back fails the write"
    );
  } finally {
    delete globalThis.window;
  }

  // All three carriers resolve to the same patient from here on.
  J.carriers.nfc = R.registerCarrier({ patientId: J.sid, stewardId: J.sid, type: "nfc", value: J.sid, issuedBy: "frontdesk" });
  J.carriers.qr = R.registerCarrier({ patientId: J.sid, stewardId: J.sid, type: "qr", value: deepLink, issuedBy: "frontdesk" });
  J.carriers.barcode = R.registerCarrier({ patientId: J.sid, stewardId: J.sid, type: "barcode", value: J.sid, issuedBy: "frontdesk" });
  for (const [type, value] of [["nfc", J.sid], ["qr", deepLink], ["barcode", J.sid], ["manual", J.sid.toLowerCase()]]) {
    const r = resolveAs(type, value);
    assert.equal(r.ok, true, `${type} resolves`);
    assert.equal(r.patient.name, J.name, `${type} names this patient`);
  }
});

/* ── Stage 3: OPD queue check-in ───────────────────────────────────────────── */

test("J3: patient takes a queue token for today's session", () => {
  const enc = { id: "enc-J-opd1", type: "opd", department: "General Medicine", status: "active", patientId: J.sid };
  J.encounters.push(enc);
  const ticket = {
    ticketId: "t-J1", token: "T-001", patientId: J.sid, stewardId: J.sid,
    encounterId: enc.id, department: "General Medicine", status: "waiting", identityStatus: "verified",
  };
  J.tickets.push(ticket);
  patientRecord().activeEncounter = enc;
  patientRecord().currentQueueTicket = { token: ticket.token, status: ticket.status };
  assert.equal(ticket.patientId, J.sid, "the ticket names the canonical identity, not a fallback");
  assert.equal(ticket.identityStatus, "verified");
  const r = resolveAs("nfc", J.sid);
  assert.deepEqual(r.activeEncounter, enc);
  assert.equal(r.currentQueueTicket.token, "T-001");
});

/* ── Stage 4: nurse triage — scan, then vitals pre-linked ──────────────────── */

test("J4: nurse scans the Ni-Key and records triage vitals pre-linked to patient + encounter", () => {
  const nurse = PatientIdentityScanner.create({
    station: "nurse", showActionSheet: false, resolverOptions: { patientStore: J.store },
  });
  const res = nurse.resolveManual(J.sid);
  assert.equal(res.ok, true);
  assert.equal(res.patient.name, J.name);
  assert.equal(res.activeEncounter.id, "enc-J-opd1", "triage entry is pre-linked to the encounter");
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.nurse.map((a) => a.id), ["record-vitals", "triage"]);
  const vitals = {
    patientId: res.patientId, encounterId: res.activeEncounter.id,
    values: { bp: "126/82", hr: 88, spo2: 98, tempF: 99.1 },
    recordedBy: "nurse-1", recordedAt: "2026-09-22T09:15:00Z",
  };
  J.vitals.push(vitals);
  patientRecord().triageVitals = vitals.values;
  assert.equal(vitals.patientId, J.sid);
  assert.equal(vitals.encounterId, "enc-J-opd1");
  nurse.destroy();
});

/* ── Stage 5: doctor consultation — action sheet, triage review, dx + rx ──── */

test("J5: doctor scans, reviews triage vitals, and writes diagnosis + prescription", () => {
  const actions = PatientIdentityScanner.STATION_ACTIONS.doctor.map((a) => a.label);
  assert.deepEqual(actions, ["View Profile", "Start Consultation", "Start Follow-up"], "context-aware action sheet");
  const doctor = PatientIdentityScanner.create({
    station: "doctor", showActionSheet: false, resolverOptions: { patientStore: J.store },
  });
  const res = doctor.resolveManual(J.sid);
  assert.equal(res.ok, true);
  assert.equal(res.patientId, J.sid);

  const E = loadEmr();
  E.openProfile({
    patientId: J.mrn, stewardId: J.sid, name: J.name,
    ticketId: "t-J1", sessionId: "s-J1", vitals: patientRecord().triageVitals, noStore: true, tab: "assess",
  });
  const st = E._state();
  assert.equal(st.patient.stewardId, J.sid);
  assert.deepEqual(st.ticketVitals, { bp: "126/82", hr: 88, spo2: 98, tempF: 99.1 }, "triage vitals prefill the consult");
  st.assessVals.provisional_diagnosis = "Acute viral fever";
  st.assessVals.management_plan = "Rest, fluids, antipyretic";
  J.notes.push({ patientId: J.sid, encounterId: "enc-J-opd1", diagnosis: st.assessVals.provisional_diagnosis, plan: st.assessVals.management_plan, writtenBy: "doc-1" });
  J.E = E;

  const rx = [
    { drug: "Paracetamol 500mg", dose: "1 tab TDS x 3 days", route: "oral" },
    { drug: "ORS sachets", dose: "1 sachet in 1L water", route: "oral" },
  ];
  rx.forEach((line, i) => J.orders.push(Object.assign({
    orderId: "ord-J" + (i + 1), kind: "medication", patientId: J.sid, encounterId: "enc-J-opd1",
    prescribedBy: "doc-1", prescribedAt: "2026-09-22T09:40:00Z", status: "ordered", qty: 1, unitPrice: i === 0 ? 500 : 1200,
  }, line)));
  assert.equal(J.orders.length, 2);
  for (const o of J.orders) {
    assert.equal(o.patientId, J.sid);
    assert.equal(o.encounterId, "enc-J-opd1");
  }
  doctor.destroy();
});

/* ── Stage 6: follow-up links to the prior consult, never overwrites it ───── */

test("J6: follow-up consult links parentEncounterId and preserves the original note", () => {
  const enc2 = { id: "enc-J-opd2", type: "opd", department: "General Medicine", status: "active", patientId: J.sid, parentEncounterId: "enc-J-opd1" };
  J.encounters.push(enc2);
  const E = loadEmr();
  E.openProfile({
    patientId: J.mrn, stewardId: J.sid, name: J.name,
    isFollowUp: true, parentEncounterId: "enc-J-opd1", noStore: true, tab: "assess",
  });
  const st = E._state();
  assert.equal(st.isFollowUp, true);
  assert.equal(st.parentEncounterId, "enc-J-opd1");
  assert.equal(E._followUpLink(), "enc-J-opd1");
  const html = E._render(st);
  assert.match(html, /Follow-up/);
  assert.ok(html.includes(J.sid), "the follow-up chart names this patient");

  st.assessVals.provisional_diagnosis = "Viral fever, resolving";
  J.notes.push({ patientId: J.sid, encounterId: "enc-J-opd2", parentEncounterId: "enc-J-opd1", diagnosis: st.assessVals.provisional_diagnosis, writtenBy: "doc-1" });
  assert.equal(J.notes.length, 2, "two notes, one per encounter");
  assert.equal(J.notes[0].encounterId, "enc-J-opd1");
  assert.equal(J.notes[0].diagnosis, "Acute viral fever", "the original consultation note is untouched");
  assert.equal(J.notes[1].parentEncounterId, "enc-J-opd1");
  patientRecord().activeEncounter = enc2;
});

/* ── Stage 7: pharmacy dispenses against the verified identity ─────────────── */

test("J7: pharmacist scans the Ni-Key and dispenses with dispensedBy/dispensedAt", () => {
  assert.match(BILLING_SRC, /data-pat="'\+esc\(o\.patientId/, "dispense call tagged with patientId");
  assert.match(BILLING_STORE_SRC, /status: "dispensed", dispensedAt: Date\.now\(\), dispensedBy: actor/, "server stamps the pharmacy act");
  assert.match(BILLING_STORE_SRC, /error: "patient_mismatch"/, "wrong-patient dispense refused");
  assert.ok(!/administeredBy\s*:/.test(BILLING_STORE_SRC), "dispense stays distinct from bedside administration");

  const pharmacy = PatientIdentityScanner.create({
    station: "pharmacy", showActionSheet: false, resolverOptions: { patientStore: J.store },
  });
  const res = pharmacy.resolveManual(J.sid);
  assert.equal(res.ok, true);
  assert.equal(res.patientId, J.sid);
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.pharmacy.map((a) => a.id), ["dispense-order"]);

  // Faithful execution of the server rule: only this encounter's lines, claimed patient
  // must match, handover stamped dispensedBy/dispensedAt.
  const queue = J.orders.filter((o) => o.encounterId === "enc-J-opd1" && o.kind === "medication");
  assert.equal(queue.length, 2, "the queue is encounter-filtered");
  function dispense(order, claim, actor) {
    if (claim && claim.patientId && claim.patientId !== String(order.patientId)) {
      return { ok: false, error: "patient_mismatch" };
    }
    order.status = "dispensed";
    order.dispensedBy = actor;
    order.dispensedAt = "2026-09-22T11:05:00Z";
    J.dispenses.push({ orderId: order.orderId, patientId: order.patientId, encounterId: order.encounterId, dispensedBy: actor, dispensedAt: order.dispensedAt });
    return { ok: true };
  }
  assert.deepEqual(dispense(queue[0], { patientId: "SMD-WRONG1" }, "pharm-1"), { ok: false, error: "patient_mismatch" });
  for (const o of queue) {
    const r = dispense(o, { patientId: res.patientId }, "pharm-1");
    assert.equal(r.ok, true);
    assert.equal(o.dispensedBy, "pharm-1");
    assert.ok(o.dispensedAt);
    assert.ok(!("administeredBy" in o), "no bedside field on the pharmacy handover");
  }
  pharmacy.destroy();
});

/* ── Stage 8: billing aggregates, invoices, and collects ───────────────────── */

test("J8: cashier scans the Ni-Key, invoices the encounter, and marks it paid", () => {
  const billing = PatientIdentityScanner.create({
    station: "billing", showActionSheet: false, resolverOptions: { patientStore: J.store },
  });
  const res = billing.resolveManual(J.sid);
  assert.equal(res.ok, true);
  assert.equal(res.patientId, J.sid, "canonical identity: no duplicate billing account");
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.billing.map((a) => a.id), ["review-bill"]);

  const unbilled = J.orders.filter((o) => o.patientId === J.sid && o.status !== "billed" && o.status !== "paid");
  assert.ok(unbilled.length > 0, "unbilled orders aggregate for this patient");
  const total = unbilled.reduce((s, o) => s + (o.unitPrice || 0) * (o.qty || 1), 0);
  const invoice = {
    invoiceId: "inv-J1", patientId: J.sid, encounterId: "enc-J-opd1",
    lines: unbilled.map((o) => ({ orderId: o.orderId, amount: (o.unitPrice || 0) * (o.qty || 1) })),
    total, status: "open",
  };
  J.invoices.push(invoice);
  for (const o of unbilled) { o.status = "billed"; o.invoiceId = invoice.invoiceId; }
  invoice.status = "paid";
  invoice.paidMethod = "upi";
  invoice.paidAt = "2026-09-22T11:20:00Z";
  for (const o of unbilled) o.status = "paid";
  assert.equal(invoice.total, 1700);
  assert.equal(invoice.status, "paid");
  assert.ok(J.orders.every((o) => o.patientId === J.sid), "every billed line belongs to this patient");
  billing.destroy();
});

/* ── Stage 9: IPD admission with bedside 5-rights verification ─────────────── */

test("J9: admitted to a ward bed, bedside scan passes 5-rights before administration", () => {
  const B = loadWardBedside();
  const encIpd = { id: "enc-J-ipd1", type: "ipd", department: "General Medicine", status: "active", patientId: J.sid, parentEncounterId: "enc-J-opd2" };
  J.encounters.push(encIpd);
  const admission = { admissionId: "adm-J1", patientId: J.sid, encounterId: encIpd.id, ward: "Ward 3", bed: "Bed 24" };
  J.admission = admission;
  patientRecord().activeAdmission = admission;

  const band = R.registerCarrier({ patientId: J.sid, stewardId: J.sid, type: "wristband", value: "BAND-J1", issuedBy: "ward" });
  assert.equal(band.status, "active");
  assert.equal(B.normalize("https://stewardmd.in/opd?uid=" + J.sid.toLowerCase()), J.sid);
  assert.equal(B.revoked("wristband", "BAND-J1"), false, "a live band is not refused");

  // Five rights, fail closed: right patient, drug, dose, route, time.
  function fiveRights(order, scan, nowMs) {
    const failures = [];
    if (String(scan.patientId).toUpperCase() !== String(order.patientId).toUpperCase()) failures.push("patient");
    if (String(scan.drug).trim().toLowerCase() !== String(order.drug).trim().toLowerCase()) failures.push("drug");
    if (String(scan.dose).trim().toLowerCase() !== String(order.dose).trim().toLowerCase()) failures.push("dose");
    if (String(scan.route).trim().toLowerCase() !== String(order.route).trim().toLowerCase()) failures.push("route");
    if (Math.abs(nowMs - scan.scheduledAt) > 60 * 60 * 1000) failures.push("time");
    return { pass: failures.length === 0, failures };
  }
  const medOrder = { orderId: "ord-J1", patientId: J.sid, drug: "Paracetamol 500mg", dose: "1 tab TDS x 3 days", route: "oral" };
  const now = Date.parse("2026-09-22T14:00:00Z");
  const goodScan = { patientId: J.sid, drug: "Paracetamol 500mg", dose: "1 tab TDS x 3 days", route: "oral", scheduledAt: now };
  const good = fiveRights(medOrder, goodScan, now);
  assert.deepEqual(good, { pass: true, failures: [] });
  J.administrations.push({
    orderId: medOrder.orderId, patientId: J.sid, encounterId: encIpd.id, admissionId: admission.admissionId,
    administeredBy: "nurse-2", administeredAt: "2026-09-22T14:00:00Z",
  });

  const wrongPatient = fiveRights(medOrder, Object.assign({}, goodScan, { patientId: "SMD-WRONG1" }), now);
  assert.equal(wrongPatient.pass, false, "wrong patient is a hard stop");
  assert.deepEqual(wrongPatient.failures, ["patient"]);
  const wrongDrug = fiveRights(medOrder, Object.assign({}, goodScan, { drug: "Insulin" }), now);
  assert.equal(wrongDrug.pass, false, "wrong drug is a hard stop");
  assert.equal(J.administrations.length, 1, "only the verified administration was stamped");
  const adm = J.administrations[0];
  assert.equal(adm.admissionId, "adm-J1");
  assert.ok(!("dispensedBy" in adm), "administration stays distinct from the pharmacy handover");
});

/* ── Stage 10: lost card → revoke → replacement with full continuity ──────── */

test("J10: lost Ni-Key revoked, replacement written + verified, same patient continues", async () => {
  R.revokeCarrier({ type: "nfc", value: J.sid, reason: "Lost" });
  assert.equal(R.isCarrierRevoked({ type: "nfc", value: J.sid }), true);
  const refused = R.resolvePatientIdentity({ type: "nfc", value: J.sid }, { patientStore: J.store });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "CARRIER_REVOKED");

  // The QR and barcode carriers from stage 2 keep working: the patient is never stranded.
  assert.equal(resolveAs("qr", "https://stewardmd.in/opd?uid=" + J.sid).patient.name, J.name);
  assert.equal(resolveAs("barcode", J.sid).patient.name, J.name);

  // Replacement Ni-Key: WRITE -> READ BACK -> COMPARE -> SUCCESS, then registered.
  globalThis.window = { NDEFReader: MockNDEFReader };
  try {
    const ok = await SMD_NFC.writeTag(
      { text: J.sid, url: "https://stewardmd.in/opd?uid=" + J.sid },
      { verifyReadBack: true, simulatedReadBack: J.sid }
    );
    assert.equal(ok.success, true);
  } finally {
    delete globalThis.window;
  }
  R.registerCarrier({ patientId: J.sid, stewardId: J.sid, type: "nfc", value: J.sid, issuedBy: "frontdesk" });
  assert.equal(R.isCarrierRevoked({ type: "nfc", value: J.sid }), false, "re-issue reactivates the carrier");

  // Full continuity: one identity across every stage's artifacts.
  const res = resolveAs("nfc", J.sid);
  assert.equal(res.ok, true);
  assert.equal(res.patientId, J.sid);
  assert.equal(res.patient.name, J.name);
  assert.equal(J.encounters.length, 3, "OPD consult + follow-up + IPD admission");
  assert.deepEqual(J.encounters.map((e) => e.id), ["enc-J-opd1", "enc-J-opd2", "enc-J-ipd1"]);
  assert.equal(J.encounters[1].parentEncounterId, "enc-J-opd1", "follow-up linked");
  assert.equal(J.encounters[2].parentEncounterId, "enc-J-opd2", "admission linked");
  for (const [label, rows] of [["vitals", J.vitals], ["notes", J.notes], ["orders", J.orders], ["dispenses", J.dispenses]]) {
    assert.ok(rows.length > 0, `${label} exist`);
    for (const row of rows) assert.equal(row.patientId, J.sid, `${label} row names this patient`);
  }
  assert.equal(J.invoices.length, 1);
  assert.equal(J.invoices[0].status, "paid");
  assert.equal(J.administrations.length, 1);
  assert.equal(J.admission.bed, "Bed 24");
  assert.deepEqual(R.getActiveCarriersForPatient(J.sid).map((c) => c.type).sort(), ["barcode", "nfc", "qr", "wristband"]);
});
