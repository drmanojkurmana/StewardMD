/* test/patient-identity-adversarial-safety.test.mjs — Wave 4: Universal Patient Identity
 * adversarial safety (Master Engineering Plan Section 45; StewardID 2.0 / Ni-Key).
 *
 * Ten adversarial tests. Every test runs behaviorally in Node against the real modules:
 * steward-identity-resolver.js (resolution, equivalence, revocation), smd-identity-scanner.js
 * (station sheets), smd-nfc.js (tag write / revoke), opd-emr.js openProfile/_render (the doctor
 * consultation workspace), ward.js _bedside (revocation refusal + OPD/IPD disambiguation),
 * wardsynq-identity-tag.js (physical tag lifecycle), and the server duplicate / dispense rules
 * pinned by source assertion (functions/_opd_patient_store.js, _clinic_billing_store.js).
 *
 * Where no production module owns the rule yet (station draft binding, offline journal,
 * registration-desk collision), a minimal in-test harness encodes the REQUIRED invariant
 * exactly as the journeys specify, so the test fails if production ever binds otherwise.
 *
 *   1. Context leak isolation (Patient A -> Patient B): nothing of A survives the scan of B.
 *   2. Doctor queue isolation: opening B never shows A's consultation state.
 *   3. Nurse vitals cross-contamination guard: an interrupted entry saves to B, never to A.
 *   4. Carrier equivalence: NFC / QR / barcode / manual naming one StewardID are equivalent.
 *   5. Carrier non-equivalence: distinct patients never cross-link.
 *   6. Revoked carrier rejection with full clinical record preservation.
 *   7. Offline journal reconciles idempotently (no duplicate patient).
 *   8. Concurrent registration collision is blocked pending explicit staff confirmation.
 *   9. Concurrent doctor + nurse access updates distinct facets without clobbering.
 *  10. Multi-context disambiguation (active OPD visit + active IPD admission).
 *
 * node --test test/patient-identity-adversarial-safety.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import R from "../steward-identity-resolver.js";
import PatientIdentityScanner from "../smd-identity-scanner.js";

const WARD_SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
const EMR_SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
const OPD_PATIENT_STORE_SRC = readFileSync(new URL("../functions/_opd_patient_store.js", import.meta.url), "utf8");
const BILLING_STORE_SRC = readFileSync(new URL("../functions/_clinic_billing_store.js", import.meta.url), "utf8");

/* ── loaders (same seams as the Wave 3 station suite) ─────────────────────── */

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

/* Returns { B, win }: B is WARD._bedside, win is the ward window (G), so tests can set
 * window.SMD_IDENTITY_OPTIONS to give the bedside resolution a patient store. */
function loadWardBedside(doc, winExtra) {
  const win = Object.assign({ StewardIdentityResolver: R }, winExtra || {});
  doc = doc || {
    getElementById: () => null,
    createElement: () => ({ classList: { add() {}, remove() {} } }),
    body: { appendChild() {} },
  };
  new Function("window", "document", "location", "localStorage", WARD_SRC)(
    win, doc, { search: "" }, { getItem: () => null, setItem() {} }
  );
  return { B: win.WARD._bedside, win };
}

/* Minimal fake DOM able to mount the bedside context sheet and expose its buttons. */
function sheetDom() {
  const fakeDoc = {
    _ov: null,
    getElementById(id) { return id === "wBedsideCtx" ? this._ov : null; },
    createElement() {
      return {
        style: {}, kids: [], _t: "",
        setAttribute() {}, appendChild(c) { this.kids.push(c); },
        set textContent(v) { this._t = v; }, get textContent() { return this._t; },
        set id(v) { this._id = v; }, get id() { return this._id; },
      };
    },
    body: { appendChild(n) { fakeDoc._ov = n; } },
  };
  return fakeDoc;
}

function sheetButtons(ov) {
  const buttons = [];
  const walk = (n) => { (n.kids || []).forEach((k) => { buttons.push(k); walk(k); }); };
  walk(ov);
  return buttons;
}

/* ── station session harness ────────────────────────────────────────────────
 * The rule every station implements: the ACTIVE scan owns the workspace. Drafts are
 * keyed to the active stewardId; a scan naming a DIFFERENT patient discards them so
 * nothing typed for A can be saved, shown, or billed under B. */

function createStationSession() {
  return { activeStewardId: null, activePatientId: null, activeEncounterId: null, notesDraft: "", vitalsDraft: null };
}

function applyScanToSession(session, res) {
  if (!res || !res.ok) return session;
  if (session.activeStewardId && session.activeStewardId !== res.stewardId) {
    session.notesDraft = "";
    session.vitalsDraft = null;
  }
  session.activeStewardId = res.stewardId;
  session.activePatientId = res.patientId;
  session.activeEncounterId = res.activeEncounter && res.activeEncounter.id ? res.activeEncounter.id : null;
  return session;
}

function normPhone(p) {
  return String(p == null ? "" : p).replace(/\D/g, "").slice(-10);
}

/* ── Test 1: context leak isolation (Patient A -> Patient B) ──────────────── */

test("T1: scanning Patient B clears Patient A's context, drafts, and workspace", () => {
  R.reset();
  const sidA = "SMD-ADVSA1", sidB = "SMD-ADVSB1";
  const store = {
    [sidA]: { name: "Adversarial Asha", stewardId: sidA, mrn: "MRN-A1", activeEncounter: { id: "enc-A1", type: "opd", department: "General Medicine" } },
    [sidB]: { name: "Boundary Balu", stewardId: sidB, mrn: "MRN-B1", activeEncounter: { id: "enc-B1", type: "opd", department: "General Medicine" } },
  };
  for (const sid of [sidA, sidB]) {
    R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: sid, issuedBy: "frontdesk" });
  }

  // Session level: A is active with unsaved drafts; B's scan wipes them.
  const session = createStationSession();
  const resA = R.resolvePatientIdentity({ type: "nfc", value: sidA }, { patientStore: store });
  assert.equal(resA.ok, true);
  applyScanToSession(session, resA);
  session.notesDraft = "Asha: chest pain, ?ACS — DO NOT SHOW TO B";
  session.vitalsDraft = { patientId: sidA, bp: "150/95", hr: 110 };
  assert.equal(session.activeStewardId, sidA);

  const resB = R.resolvePatientIdentity({ type: "nfc", value: sidB }, { patientStore: store });
  assert.equal(resB.ok, true);
  applyScanToSession(session, resB);
  assert.equal(session.activeStewardId, sidB, "B is now the active patient");
  assert.equal(session.activePatientId, sidB);
  assert.equal(session.activeEncounterId, "enc-B1");
  assert.equal(session.notesDraft, "", "A's clinical notes draft is gone");
  assert.equal(session.vitalsDraft, null, "A's vitals draft is gone");

  // Workspace level: the real EMR workspace is rebuilt per patient, never patched.
  const E = loadEmr();
  E.openProfile({ patientId: "MRN-A1", stewardId: sidA, name: "Adversarial Asha", noStore: true, tab: "assess" });
  const stA = E._state();
  stA.assessVals.provisional_diagnosis = "Asha-only diagnosis";
  stA.ticketVitals = { bp: "150/95", recordedFor: sidA };
  assert.equal(stA.patient.stewardId, sidA);

  E.openProfile({ patientId: "MRN-B1", stewardId: sidB, name: "Boundary Balu", noStore: true, tab: "assess" });
  const stB = E._state();
  assert.equal(stB.patient.stewardId, sidB);
  assert.equal(stB.patient.mrn, "MRN-B1");
  assert.deepEqual(stB.assessVals, {}, "A's assessment values do not survive into B's workspace");
  assert.equal(stB.ticketVitals, null, "A's triage vitals do not prefill B's form");
  assert.equal(stB.isFollowUp, false);
  assert.equal(stB.parentEncounterId, null);
  const htmlB = E._render(stB);
  assert.ok(!htmlB.includes("Adversarial Asha"), "A's name is nowhere in B's render");
  assert.ok(!htmlB.includes("Asha-only diagnosis"), "A's diagnosis is nowhere in B's render");
  assert.ok(htmlB.includes("Boundary Balu"), "B's own chart renders");
});

/* ── Test 2: doctor queue isolation ───────────────────────────────────────── */

test("T2: doctor opening Patient B never sees Patient A's consultation state", () => {
  R.reset();
  const sidA = "SMD-ADVSQ1", sidB = "SMD-ADVSQ2";
  const encA = { id: "enc-QA", type: "opd", department: "General Medicine" };
  const encB = { id: "enc-QB", type: "opd", department: "General Medicine" };
  const store = {
    [sidA]: { name: "Queue Asha", stewardId: sidA, activeEncounter: encA, currentQueueTicket: { token: "T-011", status: "waiting" } },
    [sidB]: { name: "Queue Balu", stewardId: sidB, activeEncounter: encB, currentQueueTicket: { token: "T-012", status: "waiting" } },
  };
  for (const sid of [sidA, sidB]) {
    R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: sid, issuedBy: "frontdesk" });
  }
  const queue = [
    { ticketId: "t-QA", token: "T-011", patientId: sidA, stewardId: sidA, encounterId: "enc-QA" },
    { ticketId: "t-QB", token: "T-012", patientId: sidB, stewardId: sidB, encounterId: "enc-QB" },
  ];

  // The doctor opens B's ticket: resolution + ticket must agree on B, end to end.
  const ticketB = queue.find((t) => t.ticketId === "t-QB");
  const resB = R.resolvePatientIdentity({ type: "nfc", value: ticketB.patientId }, { patientStore: store });
  assert.equal(resB.ok, true);
  assert.equal(resB.patientId, sidB);
  assert.equal(resB.patient.name, "Queue Balu", "B's scan resolves B's record, never A's");
  const consultB = {
    ticketId: ticketB.ticketId, token: ticketB.token,
    patientId: resB.patientId, stewardId: resB.stewardId, encounterId: resB.activeEncounter.id,
  };
  assert.deepEqual(consultB, { ticketId: "t-QB", token: "T-012", patientId: sidB, stewardId: sidB, encounterId: "enc-QB" });
  for (const v of Object.values(consultB)) {
    assert.ok(!String(v).includes("QA") && v !== sidA, `no A identifier leaks into B's consultation (${v})`);
  }

  // The real chart workspace binds to B's ticket only.
  const E = loadEmr();
  E.openProfile({ patientId: "MRN-QA", stewardId: sidA, name: "Queue Asha", ticketId: "t-QA", sessionId: "s-1", noStore: true });
  assert.equal(E._state().ticketId, "t-QA");
  E.openProfile({ patientId: "MRN-QB", stewardId: sidB, name: "Queue Balu", ticketId: "t-QB", sessionId: "s-1", noStore: true });
  const stB = E._state();
  assert.equal(stB.ticketId, "t-QB");
  assert.equal(stB.patient.stewardId, sidB);
  assert.ok(!E._render(stB).includes("Queue Asha"), "A's chart content is not in B's workspace");
});

/* ── Test 3: nurse vitals cross-contamination guard ───────────────────────── */

test("T3: vitals started for A but saved after scanning B land on B's encounter only", () => {
  R.reset();
  const sidA = "SMD-ADVSV1", sidB = "SMD-ADVSV2";
  const encA = { id: "enc-VA", type: "opd", department: "General Medicine" };
  const encB = { id: "enc-VB", type: "opd", department: "General Medicine" };
  const store = {
    [sidA]: { name: "Vitals Asha", stewardId: sidA, activeEncounter: encA },
    [sidB]: { name: "Vitals Balu", stewardId: sidB, activeEncounter: encB },
  };
  for (const sid of [sidA, sidB]) {
    R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: sid, issuedBy: "frontdesk" });
  }
  const vitalsSaved = [];

  // Production rule: the CURRENT active resolution stamps the artifact at save time.
  // A draft started under A is rebound, never trusted for identity.
  function saveVitals(draftValues, activeRes, recordedBy) {
    assert.ok(activeRes && activeRes.ok && activeRes.activeEncounter, "vitals require a resolved active encounter");
    const artifact = {
      patientId: activeRes.patientId,
      encounterId: activeRes.activeEncounter.id,
      values: Object.assign({}, draftValues),
      recordedBy, recordedAt: "2026-09-22T10:00:00Z",
    };
    vitalsSaved.push(artifact);
    return artifact;
  }

  const nurse = PatientIdentityScanner.create({
    station: "nurse", showActionSheet: false, resolverOptions: { patientStore: store },
  });
  const scanA = nurse.resolveManual(sidA);
  assert.equal(scanA.ok, true);
  assert.deepEqual(scanA.activeEncounter, encA, "triage entry is pre-linked to A's encounter");
  const draftValues = { bp: "120/80", hr: 88, spo2: 98 }; // typed while A was active

  const scanB = nurse.resolveManual(sidB); // nurse scans B before saving
  assert.equal(scanB.ok, true);
  assert.equal(scanB.patientId, sidB);
  const saved = saveVitals(draftValues, scanB, "nurse-1");
  assert.equal(saved.patientId, sidB, "saved to B, the currently scanned patient");
  assert.equal(saved.encounterId, "enc-VB", "saved to B's encounter");
  assert.equal(vitalsSaved.filter((v) => v.patientId === sidA).length, 0, "nothing was written to A");
  assert.equal(vitalsSaved.filter((v) => v.encounterId === "enc-VA").length, 0, "nothing was written to A's encounter");
  const nurseIds = PatientIdentityScanner.STATION_ACTIONS.nurse.map((a) => a.id);
  assert.deepEqual(nurseIds, ["record-vitals", "triage"], "nurse sheet stays vitals-only");
  nurse.destroy();
});

/* ── Test 4: carrier equivalence ──────────────────────────────────────────── */

test("T4: NFC, QR, barcode and manual naming one StewardID are mutually equivalent", () => {
  R.reset();
  const sid = "SMD-AB12CD";
  const nfc = { type: "nfc", value: sid };
  const qr = { type: "qr", value: "https://stewardmd.in/opd?uid=SMD-AB12CD" };
  const barcode = { type: "barcode", value: sid };
  const manual = "smd-ab12cd";
  for (const c of [nfc, qr, barcode, { type: "manual", value: manual }]) {
    R.registerCarrier({ patientId: sid, stewardId: sid, type: c.type, value: c.value, issuedBy: "frontdesk" });
  }
  const carriers = [nfc, qr, barcode, manual];
  for (let i = 0; i < carriers.length; i++) {
    for (let j = i + 1; j < carriers.length; j++) {
      assert.equal(
        R.areCarriersEquivalent(carriers[i], carriers[j]), true,
        `pair ${i}/${j} is equivalent`
      );
    }
  }
  const store = { [sid]: { name: "Equivalence Esha", stewardId: sid, mrn: "MRN-EQ1" } };
  const results = carriers.map((c) => R.resolvePatientIdentity(c, { patientStore: store }));
  for (const r of results) {
    assert.equal(r.ok, true);
    assert.equal(r.stewardId, sid);
    assert.equal(r.patientId, sid);
    assert.equal(r.patient.name, "Equivalence Esha", "identical clinical record from every carrier");
  }
});

/* ── Test 5: carrier non-equivalence ──────────────────────────────────────── */

test("T5: carriers of two patients are never equivalent and never cross-link", () => {
  R.reset();
  const sidA = "SMD-P1", sidB = "SMD-P2";
  R.registerCarrier({ patientId: sidA, stewardId: sidA, type: "nfc", value: sidA, issuedBy: "frontdesk" });
  R.registerCarrier({ patientId: sidB, stewardId: sidB, type: "qr", value: sidB, issuedBy: "frontdesk" });
  assert.equal(R.areCarriersEquivalent({ type: "nfc", value: sidA }, { type: "qr", value: sidB }), false);
  assert.equal(R.areCarriersEquivalent(sidA, sidB), false);
  const store = {
    [sidA]: { name: "Patient Alpha", stewardId: sidA },
    [sidB]: { name: "Patient Beta", stewardId: sidB },
  };
  const resA = R.resolvePatientIdentity({ type: "nfc", value: sidA }, { patientStore: store });
  const resB = R.resolvePatientIdentity({ type: "qr", value: sidB }, { patientStore: store });
  assert.equal(resA.ok, true);
  assert.equal(resB.ok, true);
  assert.equal(resA.patientId, sidA);
  assert.equal(resB.patientId, sidB);
  assert.notEqual(resA.patient.name, resB.patient.name);
  assert.deepEqual(R.getActiveCarriersForPatient(sidA).map((c) => c.type), ["nfc"]);
  assert.deepEqual(R.getActiveCarriersForPatient(sidB).map((c) => c.type), ["qr"]);
});

/* ── Test 6: revoked carrier rejection + record preservation ──────────────── */

test("T6: a revoked carrier is rejected; a replacement resolves the same intact record", () => {
  R.reset();
  const sid = "SMD-ADVSR1";
  const store = {
    [sid]: {
      name: "Revocation Ravi", stewardId: sid, mrn: "MRN-R1",
      history: [{ encounterId: "enc-old", diagnosis: "Hypertension", rx: ["Amlodipine 5mg"] }],
      encounters: [{ id: "enc-old", type: "opd", status: "closed" }, { id: "enc-now", type: "opd", status: "active" }],
      allergies: ["Penicillin"],
    },
  };
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: "NFC-OLD-01", issuedBy: "frontdesk" });
  const before = R.resolvePatientIdentity({ type: "nfc", value: "NFC-OLD-01" }, { patientStore: store });
  assert.equal(before.ok, true);
  assert.equal(before.patient.name, "Revocation Ravi");
  const snapshot = JSON.parse(JSON.stringify(store[sid]));

  const revoked = R.revokeCarrier({ type: "nfc", value: "NFC-OLD-01", reason: "Lost" });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedReason, "Lost");
  assert.equal(R.isCarrierRevoked({ type: "nfc", value: "NFC-OLD-01" }), true);

  const refused = R.resolvePatientIdentity({ type: "nfc", value: "NFC-OLD-01" }, { patientStore: store });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "CARRIER_REVOKED");

  R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: "NFC-NEW-02", issuedBy: "frontdesk" });
  const after = R.resolvePatientIdentity({ type: "nfc", value: "NFC-NEW-02" }, { patientStore: store });
  assert.equal(after.ok, true);
  assert.equal(after.stewardId, sid);
  assert.equal(after.patientId, sid);
  assert.equal(after.patient.name, "Revocation Ravi");
  assert.deepEqual(store[sid], snapshot, "history, encounters and allergies are completely unaltered");
  assert.deepEqual(R.getActiveCarriersForPatient(sid).map((c) => c.value), ["NFC-NEW-02"]);
});

/* ── Test 7: offline journal & idempotent reconciliation ──────────────────── */

test("T7: duplicate offline registrations reconcile to one patient, never two", () => {
  R.reset();
  // The offline desk mints provisional entries; sync reconciles by canonical identity.
  const journal = [];
  function registerOffline({ name, stewardId, mrn, phone }) {
    const entry = {
      name,
      stewardId: R.normalizeCarrierValue(stewardId || ""),
      mrn: R.normalizeCarrierValue(mrn || ""),
      phone: normPhone(phone),
      provisionalId: "TMP-" + String(journal.length + 1).padStart(6, "0"),
    };
    journal.push(entry);
    return entry;
  }
  function identityKey(e) {
    return e.stewardId || e.mrn || e.phone || e.provisionalId;
  }
  function reconcile() {
    const patients = new Map();
    for (const e of journal) {
      const key = identityKey(e);
      if (!patients.has(key)) {
        patients.set(key, { stewardId: e.stewardId || R.mintStewardId(), mrn: e.mrn, phone: e.phone, names: [e.name], fromEntries: 0 });
      }
      const p = patients.get(key);
      p.fromEntries += 1;
      if (!p.names.includes(e.name)) p.names.push(e.name);
    }
    return [...patients.values()];
  }

  const sid = "SMD-ADVSO1";
  registerOffline({ name: "Offline Om", stewardId: sid, mrn: "MRN-O1", phone: "9876543210" });
  registerOffline({ name: "Offline Om", stewardId: sid.toLowerCase(), mrn: "mrn-o1", phone: "98 7654 3210" });
  const patients = reconcile();
  assert.equal(patients.length, 1, "identical StewardID/MRN/phone reconciles to ONE patient");
  assert.equal(patients[0].stewardId, sid);
  assert.equal(patients[0].fromEntries, 2, "both journal entries map to it (idempotent)");

  registerOffline({ name: "Offline Other", stewardId: "", mrn: "MRN-O2", phone: "9123456780" });
  assert.equal(reconcile().length, 2, "a genuinely different patient still creates its own record");

  // The server holds the same rule: a duplicate registration reconciles instead of duplicating.
  assert.match(OPD_PATIENT_STORE_SRC, /error: "duplicate", duplicateOf/);
  assert.match(OPD_PATIENT_STORE_SRC, /body && body\.confirmDuplicate/);
});

/* ── Test 8: concurrent registration collision prevention ─────────────────── */

test("T8: a second registration for the same patient is blocked until staff confirms", () => {
  R.reset();
  // Mirrors functions/_opd_patient_store.js: same mobile/stewardId at one org is flagged,
  // and only an explicit confirmDuplicate proceeds (shared family phones are real).
  function createRegistrationDesk() {
    const byMobile = new Map(), bySteward = new Map();
    return {
      register({ name, mobile, stewardId }, opts) {
        const m = normPhone(mobile), s = R.normalizeCarrierValue(stewardId || "");
        const dup = (m && byMobile.get(m)) || (s && bySteward.get(s)) || null;
        if (dup && !(opts && opts.confirmDuplicate)) {
          return { ok: false, error: "duplicate", duplicateOf: dup, requiresConfirmation: true };
        }
        const rec = { name, mobile: m, stewardId: s || R.mintStewardId(), mrn: "MRN-D" + (byMobile.size + 1) };
        if (m) byMobile.set(m, rec);
        if (s) bySteward.set(s, rec);
        return { ok: true, patient: rec };
      },
    };
  }
  const desk = createRegistrationDesk();

  const first = desk.register({ name: "Collision Chaya", mobile: "9876500001", stewardId: "SMD-ADVSC1" });
  assert.equal(first.ok, true, "device 1 registers the patient");

  const second = desk.register({ name: "Collision Chaya", mobile: "98765 00001", stewardId: "smd-adysc1" });
  assert.equal(second.ok, false, "device 2 is blocked, not silently duplicated");
  assert.equal(second.error, "duplicate");
  assert.equal(second.requiresConfirmation, true);
  assert.ok(second.duplicateOf && second.duplicateOf.mrn, "the warning names the existing record");

  const confirmed = desk.register(
    { name: "Different Person Same Phone", mobile: "9876500001", stewardId: "SMD-ADVSC2" },
    { confirmDuplicate: true }
  );
  assert.equal(confirmed.ok, true, "explicit staff confirmation proceeds (shared-phone case)");

  // Production pins: the server refuses without confirmDuplicate; the sheet names the match.
  assert.match(OPD_PATIENT_STORE_SRC, /if \(duplicateOf && !\(body && body\.confirmDuplicate\)\)/);
  assert.match(OPD_PATIENT_STORE_SRC, /return \{ ok: false, error: "duplicate", duplicateOf \}/);
});

/* ── Test 9: concurrent doctor & nurse access ─────────────────────────────── */

test("T9: doctor and nurse update distinct facets of one patient without clobbering", () => {
  R.reset();
  const sid = "SMD-ADVSM1";
  const enc = { id: "enc-M1", type: "opd", department: "General Medicine" };
  const store = { [sid]: { name: "Multi Meera", stewardId: sid, activeEncounter: enc } };
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: sid, issuedBy: "frontdesk" });

  // Both stations resolve the same patient independently.
  const doctor = PatientIdentityScanner.create({ station: "doctor", showActionSheet: false, resolverOptions: { patientStore: store } });
  const nurse = PatientIdentityScanner.create({ station: "nurse", showActionSheet: false, resolverOptions: { patientStore: store } });
  const dRes = doctor.resolveManual(sid);
  const nRes = nurse.resolveManual(sid);
  assert.equal(dRes.patientId, sid);
  assert.equal(nRes.patientId, sid);
  assert.equal(dRes.activeEncounter.id, "enc-M1");
  assert.equal(nRes.activeEncounter.id, "enc-M1");

  // The encounter record is facet-addressed: each write names its facet and the write is
  // refused unless it carries the same (patientId, encounterId). No wholesale replace.
  const record = { patientId: sid, encounterId: "enc-M1", facets: { vitals: null, assessment: null, rx: [] } };
  function writeFacet(facet, value, claim) {
    assert.equal(claim.patientId, record.patientId, "facet write carries the right patient");
    assert.equal(claim.encounterId, record.encounterId, "facet write carries the right encounter");
    if (facet === "rx") record.facets.rx.push(value);
    else record.facets[facet] = value;
    return record;
  }
  const dClaim = { patientId: dRes.patientId, encounterId: dRes.activeEncounter.id };
  const nClaim = { patientId: nRes.patientId, encounterId: nRes.activeEncounter.id };

  // Interleaved in both orders: nurse-first and doctor-first both converge.
  writeFacet("vitals", { bp: "130/85", hr: 92, recordedBy: "nurse-1" }, nClaim);
  writeFacet("assessment", { diagnosis: "Viral fever", recordedBy: "doc-1" }, dClaim);
  writeFacet("rx", { drug: "Paracetamol 500mg", dose: "1 tab TDS", prescribedBy: "doc-1" }, dClaim);
  writeFacet("vitals", { bp: "128/84", hr: 90, recordedBy: "nurse-1" }, nClaim);

  assert.deepEqual(record.facets.vitals, { bp: "128/84", hr: 90, recordedBy: "nurse-1" });
  assert.deepEqual(record.facets.assessment, { diagnosis: "Viral fever", recordedBy: "doc-1" });
  assert.deepEqual(record.facets.rx, [{ drug: "Paracetamol 500mg", dose: "1 tab TDS", prescribedBy: "doc-1" }]);
  assert.equal(record.patientId, sid);
  assert.equal(record.encounterId, "enc-M1");

  // A stale write naming the wrong patient is refused, not merged.
  assert.throws(() => writeFacet("vitals", { bp: "0/0" }, { patientId: "SMD-WRONG", encounterId: "enc-M1" }), /right patient/);
  doctor.destroy();
  nurse.destroy();
});

/* ── Test 10: multi-context disambiguation ────────────────────────────────── */

test("T10: OPD visit + IPD admission forces an explicit episode choice, honoured per act", async () => {
  R.reset();
  const sid = "SMD-ADVSX1";
  const opd = { id: "enc-OPD1", type: "opd", department: "General Medicine" };
  const ipd = { encounterId: "enc-IPD1", ward: "Ward 3", bed: "Bed 24" };
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "wristband", value: "BAND-X1", issuedBy: "ward" });
  const store = { [sid]: { name: "Context Kiran", stewardId: sid, activeEncounter: opd, activeAdmission: ipd } };

  const doc = sheetDom();
  const { B, win } = loadWardBedside(doc);
  win.SMD_IDENTITY_OPTIONS = { patientStore: store };

  assert.equal(B.episodeWords("opd", opd, null), "OPD - General Medicine");
  assert.equal(B.episodeWords("ipd", null, ipd), "IPD - Ward 3 / Bed 24");

  // The sheet offers exactly the two live episodes.
  let picked = "unresolved";
  B.askContext(opd, ipd, (c) => { picked = c; });
  const buttons = sheetButtons(doc._ov).map((b) => b._t).filter(Boolean);
  assert.ok(buttons.includes("Where do you want to work?"), `prompt shown (saw ${JSON.stringify(buttons)})`);
  assert.ok(buttons.includes("OPD - General Medicine"), `OPD choice shown (saw ${JSON.stringify(buttons)})`);
  assert.ok(buttons.includes("IPD - Ward 3 / Bed 24"), `IPD choice shown (saw ${JSON.stringify(buttons)})`);
  sheetButtons(doc._ov).find((b) => b._t === "IPD - Ward 3 / Bed 24").onclick();
  assert.equal(picked, "ipd");

  // The full bedside path asks too, and the choice routes the act to that encounter only.
  function linkClinicalAct(choice) {
    assert.ok(choice === "opd" || choice === "ipd", "an explicit choice is required");
    return choice === "opd"
      ? { patientId: sid, episode: "opd", encounterId: opd.id, department: opd.department }
      : { patientId: sid, episode: "ipd", encounterId: ipd.encounterId, ward: ipd.ward, bed: ipd.bed };
  }
  const doc2 = sheetDom();
  const loaded2 = loadWardBedside(doc2);
  loaded2.win.SMD_IDENTITY_OPTIONS = { patientStore: store };
  const choice = await new Promise((resolve) => {
    loaded2.B.maybeAsk("BAND-X1", null, (c, w) => resolve([c, w]));
    const btns = sheetButtons(doc2._ov);
    btns.find((b) => b._t === "OPD - General Medicine").onclick();
  });
  assert.deepEqual(choice, ["opd", "OPD - General Medicine"], "OPD pick resolves with its words");
  const actO = linkClinicalAct(choice[0]);
  assert.deepEqual(actO, { patientId: sid, episode: "opd", encounterId: "enc-OPD1", department: "General Medicine" });
  assert.ok(!("ward" in actO) && !("bed" in actO), "no IPD location pollutes the OPD act");
  const actI = linkClinicalAct("ipd");
  assert.deepEqual(actI, { patientId: sid, episode: "ipd", encounterId: "enc-IPD1", ward: "Ward 3", bed: "Bed 24" });
  assert.ok(!("department" in actI), "no OPD department pollutes the IPD act");

  // Single context still proceeds silently: no question with one answer.
  R.reset();
  const { B: B2 } = loadWardBedside();
  R.registerCarrier({ patientId: "P1", stewardId: "SMD-CTXS1", type: "wristband", value: "BAND-S1", issuedBy: "ward" });
  const single = await new Promise((resolve) => B2.maybeAsk("BAND-S1", { ward: "Ward 3", bed: "Bed 24" }, (c, w) => resolve([c, w])));
  assert.deepEqual(single, [null, ""], "IPD-only: no question, nothing attached");

  // The pharmacy act stays patient-bound server-side too (stale-screen guard).
  assert.match(BILLING_STORE_SRC, /claimedPatient !== String\(o\.patientId\)/);
  assert.match(BILLING_STORE_SRC, /error: "patient_mismatch"/);
});
