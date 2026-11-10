/* test/queue-patient-key.test.mjs - one on-device clinic record per PATIENT, not per ticket.
 *
 * REGRESSION (found 2026-11-09): localClinicId keyed the device record by ticket id. A returning patient
 * gets a new ticket each visit, so Monday's notes were not there on Thursday, and the record carried a
 * second MR number (SMD-<code>-<seq>) that was not the one the server issued.
 *
 * Runs the REAL queue.js against a store with the real shape (addPatient / getPatient / listPatients).
 * node --test test/queue-patient-key.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../queue.js", import.meta.url), "utf8");

function load(ls) {
  const mem = Object.assign({}, ls || {});
  const pts = [];
  const store = {
    addPatient: (p) => { const id = "p" + (pts.length + 1) + "x" + Math.random().toString(36).slice(2, 6); pts.unshift({ id, name: p.name, mrn: p.mrn }); return id; },
    getPatient: (id) => pts.find((x) => x.id === id) || null,
    listPatients: () => pts.slice(),
    deletePatient: (id) => { const i = pts.findIndex((x) => x.id === id); if (i >= 0) pts.splice(i, 1); },
    localStore: { getConsult: () => ({}), saveConsult: () => {} }
  };
  const localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const opened = [];
  const win = { localStorage, addEventListener: () => {}, SMD_CLINIC: store, OPDEMR: { openProfile: (o) => opened.push(o) }, toast: () => {} };
  const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add() {}, remove() {} }, style: {} }), body: { appendChild() {} }, addEventListener: () => {} };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, localStorage);
  const Q = win.QUEUE;
  Object.assign(Q._st, { session: { id: "s1", doctorName: "Dr Asha" }, orgId: "org1", ghisToken: null });
  return { Q, store, pts, opened, mem };
}
const MON = { id: "t-mon", name: "Ramesh Kumar", ghisPatientId: "SMD-CLN-00007", status: "waiting" };
const THU = { id: "t-thu", name: "Ramesh Kumar", ghisPatientId: "smd-cln-00007 ", status: "waiting", visitType: "followup" };

test("a follow-up ticket opens the SAME device record as the first visit", () => {
  const { Q, pts, opened } = load();
  Q._st.tickets = [MON, THU];
  Q._openTicketEmr("t-mon", "assess"); Q._openTicketEmr("t-thu", "assess");
  assert.equal(pts.length, 1, "one patient, one record");
  assert.equal(opened[0].patientId, opened[1].patientId);
});

test("the record carries the server's MR number, not a second device number", () => {
  const { Q, pts, opened } = load();
  Q._st.tickets = [MON];
  Q._openTicketEmr("t-mon", "assess");
  assert.equal(pts[0].mrn, "SMD-CLN-00007");
  assert.equal(opened[0].displayId, "SMD-CLN-00007");
});

test("a record that is in the store but not in this phone's map (restored backup) is found by its number", () => {
  const { Q, store, pts, opened } = load();
  const existing = store.addPatient({ name: "Ramesh Kumar", mrn: "SMD-CLN-00007" });
  Q._st.tickets = [THU];
  Q._openTicketEmr("t-thu", "assess");
  assert.equal(pts.length, 1);
  assert.equal(opened[0].patientId, existing);
});

test("two different patients never share a record", () => {
  const { Q, pts, opened } = load();
  Q._st.tickets = [MON, { id: "t-b", name: "Sita Devi", ghisPatientId: "SMD-CLN-00008", status: "waiting" }];
  Q._openTicketEmr("t-mon", "assess"); Q._openTicketEmr("t-b", "assess");
  assert.equal(pts.length, 2);
  assert.notEqual(opened[0].patientId, opened[1].patientId);
});

test("tickets with no MR number each get their own record, and a deleted record's number is not reused", () => {
  const { Q, store, pts } = load({ smd_opd_clinic_code: "ABC" });
  Q._st.tickets = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  Q._openTicketEmr("a", "assess"); Q._openTicketEmr("b", "assess");
  assert.deepEqual(pts.map((p) => p.mrn).sort(), ["SMD-ABC-001", "SMD-ABC-002"]);
  store.deletePatient(pts.find((p) => p.mrn === "SMD-ABC-001").id);
  Q._openTicketEmr("c", "assess");
  assert.deepEqual(pts.map((p) => p.mrn).sort(), ["SMD-ABC-002", "SMD-ABC-003"], "003, not a second 002");
});

test("smd_opd_patient_key=0 restores one record per ticket", () => {
  const { Q, pts } = load({ smd_opd_patient_key: "0" });
  Q._st.tickets = [MON, THU];
  Q._openTicketEmr("t-mon", "assess"); Q._openTicketEmr("t-thu", "assess");
  assert.equal(pts.length, 2);
});
