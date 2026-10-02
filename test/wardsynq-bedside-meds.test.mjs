/* test/wardsynq-bedside-meds.test.mjs - the bedside medication fixes from the audit (lane B):
 *   CLIN-10 (B6)  the ward screen's scan body is the server's scan contract, so a dose can be charted as given
 *   CLIN-11 (B7)  the wristband is the patient record's, not the request's; a dose cannot be scanned early
 *   CLIN-12 (B8)  a finding the prescriber answered at order entry does not block every bedside scan
 *   CLIN-13 (B9)  an as-needed dose is charted from the round, and when the last one was given is shown
 *   CLIN-17 (B10) a missed dose stays on the round as overdue after its window has passed
 *   CLIN-18 (B11) a high-alert witness must be real staff
 *   CLIN-19 (B12) a bedside check that did not run is shown on the ward screen
 *   CLIN-20 (B13) a pharmacist's query stops the dispense and is said at the bedside
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-bedside-meds.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { as, seedHospital, admittedPatient, docs, sanitize, idFor, ORG, DOCTOR, NURSE, H } = await import("./_wardsynq-alert-harness.mjs");

const PHARM = "pharmacy@example.test";
function seed(cfg) {
  seedHospital(cfg || {});
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(PHARM))}`, { fields: { orgId: ORG, identity: idFor(PHARM), role: "pharmacy", active: true }, updateTime: "t1" });
}
const prescribe = (p, drug, value, unit, route, frequency, extra) => as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, ...(extra || {}),
  order: { patientId: p.patientId, encounterId: p.encounterId, drug, dose: { value, unit }, route, frequency } });
const schedule = (p, fromH, toH) => as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${p.patientId}&from=${encodeURIComponent(new Date(Date.now() + fromH * 3600e3).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + toH * 3600e3).toISOString())}`);
const mar = (p, d, action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: d.orderId, dueAt: d.dueAt, patient: { id: p.patientId }, expectedOrderVersion: d.orderVersion, ...(extra || {}) });
/* The body ward.js marAction sends for a scan: the two scans, and the row's dose and route once the nurse has ticked
 * that the prepared dose and route were checked against the order. */
const wardScan = (p, d, patientBarcode, drugBarcode) => mar(p, d, "scan", { scan: { patientBarcode, drugBarcode, dose: d.dose, route: d.route } });
const ready = async (p, d) => { for (const a of ["verify", "dispense"]) assert.equal((await mar(p, d, a)).__status, 200, a); };
const statDose = async (p, drug, value, unit, route, extra) => {
  const o = await prescribe(p, drug, value, unit, route, "STAT", extra);
  assert.equal(o.__status, 200, JSON.stringify(o));
  const d = (await schedule(p, -1, 1)).due.find((x) => x.orderId === o.orderId);
  assert.ok(d, "the STAT dose is on the round");
  return { o, d };
};

test("CLIN-10: the ward screen's scan body passes the five rights, and the dose is charted as given", async () => {
  seed();
  const p = await admittedPatient();
  const { d } = await statDose(p, "Ceftriaxone", 1, "g", "IV");
  await ready(p, d);
  const s = await wardScan(p, d, p.mrn, "Ceftriaxone");
  assert.equal(s.__status, 200, JSON.stringify(s));
  assert.equal(s.to, "scanned");
  const a = await mar(p, d, "administer");
  assert.equal(a.__status, 200, JSON.stringify(a));
  assert.equal(a.to, "administered");
  // And ward.js really sends that shape.
  assert.match(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), /body\.scan = \{ patientBarcode: val\("wScanP"\), drugBarcode: val\("wScanD"\) \}/);
});

test("CLIN-11: another patient's wristband fails whatever the body claims, and a dose cannot be scanned hours early", async () => {
  seed();
  const p = await admittedPatient();
  const other = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Other Person", mobile: "9876512999", gender: "female", ageYears: 30 });
  assert.ok(other.mrn);
  const { d } = await statDose(p, "Ceftriaxone", 1, "g", "IV");
  await ready(p, d);
  const wrong = await mar(p, d, "scan", { patient: { id: p.patientId, mrn: other.mrn }, scan: { patientBarcode: other.mrn, drugBarcode: "Ceftriaxone", dose: d.dose, route: d.route } });
  assert.equal(wrong.__status, 409);
  assert.deepEqual(wrong.reasons.map((r) => r.code), ["FIVE_RIGHTS_PATIENT"]);

  const bd = await prescribe(p, "Pantoprazole", 40, "mg", "IV", "BD");
  const later = (await schedule(p, 0, 30)).due.find((x) => x.orderId === bd.orderId && Date.parse(x.dueAt) - Date.now() > 2 * 3600e3);
  await ready(p, later);
  const early = await wardScan(p, later, p.mrn, "Pantoprazole");
  assert.equal(early.__status, 409, JSON.stringify(early));
  assert.deepEqual(early.reasons.map((r) => r.code), ["FIVE_RIGHTS_TIME"]);
});

test("CLIN-12: an interaction overridden at order entry does not block the scan; an allergy recorded since does", async () => {
  seed();
  const p = await admittedPatient();
  assert.equal((await prescribe(p, "Warfarin", 5, "mg", "PO", "OD")).__status, 200);
  const chk = await prescribe(p, "Aspirin", 75, "mg", "PO", "STAT", { checkOnly: true });
  assert.ok(chk.safety.overridables.some((f) => f.code === "INTERACTION_MAJOR"), JSON.stringify(chk.safety));
  const { d } = await statDose(p, "Aspirin", 75, "mg", "PO", { overrideReason: "post-stent, cardiology advised" });
  await ready(p, d);
  const s = await wardScan(p, d, p.mrn, "Aspirin");
  assert.equal(s.__status, 200, JSON.stringify(s));
  assert.ok(s.safetyWarnings.some((w) => w.code === "INTERACTION_MAJOR" && w.overriddenAtOrder), "still shown to the nurse, as a warning");

  // Something nobody has decided on still stops the scan.
  seed();
  const p2 = await admittedPatient();
  assert.equal((await prescribe(p2, "Warfarin", 5, "mg", "PO", "OD")).__status, 200);
  const two = await statDose(p2, "Aspirin", 75, "mg", "PO", { overrideReason: "post-stent, cardiology advised" });
  assert.equal((await as(DOCTOR, "/ward/allergy", "POST", { orgId: ORG, patientId: p2.patientId, substance: "Aspirin", reaction: "urticaria" })).__status, 200);
  await ready(p2, two.d);
  const blocked = await wardScan(p2, two.d, p2.mrn, "Aspirin");
  assert.equal(blocked.__status, 409, JSON.stringify(blocked));
  assert.ok(blocked.reasons.some((r) => /^ALLERGY/.test(r.code)));
  assert.ok(!blocked.reasons.some((r) => r.code === "INTERACTION_MAJOR"), "the answered interaction is not asked again");
});

test("CLIN-13: an as-needed dose is given from the round and shows when it was last given", async () => {
  seed();
  const p = await admittedPatient();
  const o = await prescribe(p, "Ondansetron", 4, "mg", "IV", "PRN");
  assert.equal(o.__status, 200);
  const before = await schedule(p, -1, 1);
  const item = before.prn.find((x) => x.orderId === o.orderId);
  assert.ok(item && !item.lastGivenAt);
  // "Give now": a row at this minute, through the same steps.
  const t = new Date(); t.setSeconds(0, 0);
  const d = { ...item, dueAt: t.toISOString() };
  await ready(p, d);
  assert.equal((await wardScan(p, d, p.mrn, "Ondansetron")).__status, 200);
  assert.equal((await mar(p, d, "administer")).__status, 200);
  const after = await schedule(p, -1, 1);
  assert.ok(after.prn.find((x) => x.orderId === o.orderId).lastGivenAt, "last given is shown");
  const row = after.due.find((x) => x.orderId === o.orderId);
  assert.equal(row.status, "administered");
  assert.equal(row.asNeeded, true);
  assert.match(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), /data-w-act="givenow:/, "the ward screen offers Give now");
});

test("CLIN-17: a dose nobody gave stays on the round and the worklist as overdue after its window", async (t) => {
  seed();
  const p = await admittedPatient();
  const o = await prescribe(p, "Pantoprazole", 40, "mg", "IV", "q6h");
  assert.equal(o.__status, 200);
  // A day and a half later, the worklist's window (the last 12 hours) no longer contains the first doses.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 36 * 3600e3 });
  try {
    const s = await schedule(p, -12, 4);
    const early = s.due.filter((x) => x.orderId === o.orderId && x.beforeWindow);
    assert.ok(early.length >= 3, JSON.stringify(s.due.map((x) => [x.dueAt, x.overdue, x.beforeWindow])));
    assert.ok(early.every((x) => x.overdue && x.status === null));
    const wl = await as(NURSE, `/ward/nurse-worklist?orgId=${ORG}&ward=Medical%20A`);
    const row = wl.rows.find((r) => r.patientId === p.patientId);
    assert.ok(row.overdue >= early.length, JSON.stringify(row));
  } finally { t.mock.timers.reset(); }
});

test("CLIN-18: a high-alert witness authenticates with their own staff PIN; a typed name alone is refused", async () => {
  seed({ highAlertDrugs: ["INSULIN"] });
  const { genSalt, hashSecret, PIN_MAX_ATTEMPTS } = await import("../functions/_opd_auth.js");
  const key = `q_members/${sanitize(ORG)}__nurse1`, salt = genSalt();
  docs.set(key, { ...docs.get(key), fields: { ...docs.get(key).fields, pinSalt: salt, pinHash: await hashSecret("2468", salt) } });
  const p = await admittedPatient();
  const { d } = await statDose(p, "Insulin regular", 6, "unit", "SC");
  await ready(p, d);
  assert.equal((await wardScan(p, d, p.mrn, "Insulin regular")).__status, 200);
  const code = async (extra) => { const r = await mar(p, d, "administer", extra); return r.__status === 200 ? "given" : (r.reasons || []).map((x) => x.code).join(",") || r.error; };

  assert.equal(await code({ witnessId: "nurse1" }), "WITNESS_PIN_REQUIRED", "an identifier alone is not a witness");
  assert.equal(await code({ witnessId: "nobody-at-all", witnessPin: "2468" }), "WITNESS_PIN_UNAVAILABLE");
  assert.equal(await code({ witnessId: "nurse1", witnessPin: "1111" }), "WITNESS_PIN_WRONG");
  assert.equal(docs.get(key).fields.pinAttempts, 1, "a wrong PIN counts against the witness, as at sign-in");
  const given = await mar(p, d, "administer", { witnessId: "nurse1", witnessPin: "2468" });
  assert.equal(given.__status, 200, JSON.stringify(given));
  const rec = await H.RECORD.latest("tenant-wsq", "MedicationAdministration", given.administrationId);
  assert.equal(rec.witnessedBy, "nurse1");
  assert.equal(docs.get(key).fields.pinAttempts, 0, "the right PIN resets the count");

  // Five wrong PINs lock the witness out, as a sign-in does.
  const two = await statDose(p, "Insulin glargine", 8, "unit", "SC");
  await ready(p, two.d);
  assert.equal((await wardScan(p, two.d, p.mrn, "Insulin glargine")).__status, 200);
  for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) await mar(p, two.d, "administer", { witnessId: "nurse1", witnessPin: "0000" });
  const locked = await mar(p, two.d, "administer", { witnessId: "nurse1", witnessPin: "2468" });
  assert.deepEqual(locked.reasons.map((x) => x.code), ["WITNESS_PIN_LOCKED"]);
  assert.match(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), /body\.witnessPin = /, "the ward screen sends the witness's PIN");
});

test("CLIN-11: a dose is charted only at a time the order schedules", async () => {
  seed();
  const p = await admittedPatient();
  const bd = await prescribe(p, "Pantoprazole", 40, "mg", "IV", "BD");
  const slot = (await schedule(p, 0, 30)).due.find((x) => x.orderId === bd.orderId);
  const off = await mar(p, { ...slot, dueAt: new Date(Date.parse(slot.dueAt) + 60000).toISOString() }, "verify");
  assert.equal(off.__status, 409, JSON.stringify(off));
  assert.equal(off.error, "not_a_scheduled_dose");
  assert.equal((await mar(p, slot, "verify")).__status, 200, "the round's own slot is accepted");
  const prn = await prescribe(p, "Ondansetron", 4, "mg", "IV", "PRN");
  const ahead = await mar(p, { orderId: prn.orderId, dueAt: new Date(Date.now() + 3 * 3600e3).toISOString() }, "verify");
  assert.equal(ahead.error, "not_a_scheduled_dose", "an as-needed dose is not charted hours ahead");
});

/* Codex F5 (2 Oct 2026): the check that could not run now REFUSES the scan; it continues only with the nurse's reason,
 * and the warning is still what the ward screen shows. */
test("CLIN-19: a bedside check that could not run refuses, continues with a reason as a warning, and the ward screen shows it", async () => {
  seed();
  const p = await admittedPatient();
  const { d } = await statDose(p, "Ceftriaxone", 1, "g", "IV");
  await ready(p, d);
  const real = H.RECORD.byPatient.bind(H.RECORD);
  H.RECORD.byPatient = async (tid, type, pid) => { if (type === "AllergyIntolerance") throw new Error("simulated D1 timeout"); return real(tid, type, pid); };
  let refused, s;
  try {
    refused = await wardScan(p, d, p.mrn, "Ceftriaxone");
    s = await mar(p, d, "scan", { uncheckedReason: "urgent first dose", scan: { patientBarcode: p.mrn, drugBarcode: "Ceftriaxone", dose: d.dose, route: d.route } });
  } finally { H.RECORD.byPatient = real; }
  assert.equal(refused.__status, 409);
  assert.ok(refused.reasons.some((r) => r.code === "SAFETY_CHECK_UNAVAILABLE" && r.checkNotRun));
  assert.equal(s.__status, 200);
  assert.ok(s.safetyWarnings.some((w) => w.code === "SAFETY_CHECK_UNAVAILABLE"));
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  assert.match(src, /st\.marWarn = r && r\.ok && \(r\.safetyWarnings \|\| \[\]\)\.length/, "the scan's warnings are kept");
  assert.match(src, /w\.code === "SAFETY_CHECK_UNAVAILABLE"/, "and a check that did not run is said in words");
});

test("CLIN-20: a pharmacist's query stops the dispense and is said at the bedside", async () => {
  seed();
  const p = await admittedPatient();
  const { o, d } = await statDose(p, "Vancomycin", 1, "g", "IV");
  const q = await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: o.orderId, outcome: "queried", reason: "dose too high for eGFR 20" });
  assert.equal(q.__status, 200, JSON.stringify(q));
  const disp = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: o.orderId, quantity: { value: 1, unit: "vial" } });
  assert.equal(disp.__status, 409, JSON.stringify(disp));
  assert.equal(disp.error, "verification_queried");
  await ready(p, d);
  const s = await wardScan(p, d, p.mrn, "Vancomycin");
  assert.equal(s.__status, 200, JSON.stringify(s));
  assert.ok(s.safetyWarnings.some((w) => w.code === "PHARMACY_QUERY_OPEN" && /eGFR 20/.test(w.message)));
});
