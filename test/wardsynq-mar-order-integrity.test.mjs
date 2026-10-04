/* test/wardsynq-mar-order-integrity.test.mjs - the medication record findings of the Codex audit (2 Oct 2026),
 * each driven through the real routes (/ward/medication-order, /ward/schedule, /ward/mar, /ward/fhir):
 *   F2  an administration keeps the dose, unit, route and order version it was given under, and so does its FHIR export
 *   F3  a bedside scan done under one order version cannot be completed after a clinically material amendment
 *   F5  a safety check that did not run refuses by default; continuing needs a reason and is recorded as unchecked
 *   F6  missing renal and pregnancy/lactation coverage is said on the order, with the patient's measurements
 *       (and which eGFR LOINC codes are read, in what order: owner decision 2026-10-04)
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-mar-order-integrity.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE, H } = await import("./_wardsynq-alert-harness.mjs");
const { validateResource } = await import("../functions/_wardsynq/fhir-validate.js");

/* One OD round time ten minutes from now on the hospital's clock (+05:30), so the dose is inside the scan window
 * and keeps the same due time when the order is amended (a STAT dose is anchored on the order's own time). */
function seedWithSlotSoon() {
  const t = new Date(Date.now() + 10 * 60e3 + 330 * 60e3);
  const hhmm = String(t.getUTCHours()).padStart(2, "0") + ":" + String(t.getUTCMinutes()).padStart(2, "0");
  seedHospital({ marTimes: { OD: [hhmm] } });
}
const prescribe = (p, drug, value, unit, route, extra) => as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, ...(extra || {}),
  order: { patientId: p.patientId, encounterId: p.encounterId, drug, dose: { value, unit }, route, frequency: "OD", ...((extra && extra.order) || {}) } });
const roundRow = async (p, orderId) => (await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${p.patientId}&from=${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3600e3).toISOString())}`))
  .due.find((x) => x.orderId === orderId);
const mar = (p, d, action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: d.orderId, dueAt: d.dueAt, patient: { id: p.patientId }, ...(extra || {}) });
const scan = (p, d, extra) => mar(p, d, "scan", { expectedOrderVersion: d.orderVersion, scan: { patientBarcode: p.mrn, drugBarcode: d.drug, dose: d.dose, route: d.route }, ...(extra || {}) });
const ok = (r, what) => assert.equal(r.__status, 200, `${what}: ${JSON.stringify(r)}`);

async function scannedUnderV1() {
  seedWithSlotSoon();
  const p = await admittedPatient();
  const o = await prescribe(p, "Ceftriaxone", 1, "g", "IV");
  ok(o, "prescribe v1");
  const d1 = await roundRow(p, o.orderId);
  assert.ok(d1, "the dose is on the round");
  for (const a of ["verify", "dispense"]) ok(await mar(p, d1, a, { expectedOrderVersion: d1.orderVersion }), a);
  ok(await scan(p, d1), "scan under v1");
  return { p, o, d1 };
}

test("F3: a scan done under v1 is not completed after the dose is amended to v2 and the round reloaded", async () => {
  const { p, o, d1 } = await scannedUnderV1();
  ok(await prescribe(p, "Ceftriaxone", 2, "g", "IV"), "amend to v2");
  const d2 = await roundRow(p, o.orderId);
  assert.equal(d2.orderVersion, d1.orderVersion + 1, "the reloaded round carries the new version");
  assert.equal(d2.status, "scanned", "and the dose record scanned under v1");

  // The audit's trigger: the reloaded round's version, sent back.
  const withV2 = await mar(p, d2, "administer", { expectedOrderVersion: d2.orderVersion });
  assert.equal(withV2.__status, 409, JSON.stringify(withV2));
  assert.equal(withV2.error, "order_changed_recheck");
  assert.deepEqual(withV2.changed, ["dose"]);
  // And the same with no version at all.
  const noVersion = await mar(p, d2, "administer");
  assert.equal(noVersion.__status, 409, JSON.stringify(noVersion));
  assert.equal(noVersion.error, "order_changed_recheck");
  // Nor can the v1 dispense be scanned against v2.
  assert.equal((await scan(p, d2)).error, "order_changed_recheck");
  const still = await H.RECORD.latest("tenant-wsq", "MedicationAdministration", d2.administrationId);
  assert.equal(still.status, "scanned", "nothing was written");

  // Re-checking under v2 starts again from verification, and the old preparation cannot be scanned.
  const rv = await mar(p, d2, "verify", { expectedOrderVersion: d2.orderVersion });
  ok(rv, "re-verify under v2");
  assert.equal(rv.from, "scanned"); assert.equal(rv.to, "verified");
  ok(await mar(p, d2, "dispense", { expectedOrderVersion: d2.orderVersion }), "dispense v2");
  const oldDose = await mar(p, d2, "scan", { expectedOrderVersion: d2.orderVersion, scan: { patientBarcode: p.mrn, drugBarcode: d2.drug, dose: d1.dose, route: d2.route } });
  assert.deepEqual(oldDose.reasons.map((r) => r.code), ["FIVE_RIGHTS_DOSE"]);
  ok(await scan(p, d2), "scan v2");
  ok(await mar(p, d2, "administer", { expectedOrderVersion: d2.orderVersion }), "administer v2");
  const rec = await H.RECORD.latest("tenant-wsq", "MedicationAdministration", d2.administrationId);
  assert.deepEqual(rec.dose, { value: 2, unit: "g" });
  assert.equal(rec.orderVersion, d2.orderVersion);
  assert.ok(rec.audit.some((a) => a.to === "ordered" && /amended/.test(a.reason || "")), "the reset is in the record's own audit");
});

test("F3: an amendment that changes nothing clinical does not void the checks", async () => {
  const { p, o, d1 } = await scannedUnderV1();
  ok(await prescribe(p, "Ceftriaxone", 1, "g", "IV", { order: { durationDays: 5 } }), "v2 adds a course length only");
  const d2 = await roundRow(p, o.orderId);
  assert.equal(d2.orderVersion, d1.orderVersion + 1);
  ok(await mar(p, d2, "administer", { expectedOrderVersion: d2.orderVersion }), "administer");
});

test("F2: the administration keeps what was given and under which order version; a later amendment leaves it and its FHIR export unchanged", async () => {
  const { p, o, d1 } = await scannedUnderV1();
  const given = await mar(p, d1, "administer", { expectedOrderVersion: d1.orderVersion });
  ok(given, "administer v1");
  const before = await H.RECORD.latest("tenant-wsq", "MedicationAdministration", given.administrationId);
  assert.deepEqual(before.dose, { value: 1, unit: "g" });
  assert.equal(before.route, "IV");
  assert.equal(before.orderVersion, d1.orderVersion);
  assert.deepEqual(before.orderSnapshot, { version: d1.orderVersion, drug: "Ceftriaxone", drugCode: null, dose: { value: 1, unit: "g" }, route: "IV", frequency: "OD" });
  const fhirBefore = await as(NURSE, `/ward/fhir/MedicationAdministration/${encodeURIComponent(given.administrationId)}?orgId=${ORG}`);
  assert.equal(fhirBefore.__status, 200, JSON.stringify(fhirBefore));

  ok(await prescribe(p, "Ceftriaxone", 2, "g", "IM"), "amend to v2: dose and route");
  const after = await H.RECORD.latest("tenant-wsq", "MedicationAdministration", given.administrationId);
  assert.equal(after.version, before.version, "the administration was not rewritten");
  assert.deepEqual(after.dose, { value: 1, unit: "g" });
  assert.equal(after.route, "IV");
  const fhir = await as(NURSE, `/ward/fhir/MedicationAdministration/${encodeURIComponent(given.administrationId)}?orgId=${ORG}`);
  assert.equal(fhir.__status, 200, JSON.stringify(fhir));
  const { __status: _a, ...fb } = fhirBefore; const { __status: _b, ...fa } = fhir;
  assert.deepEqual(fa, fb, "the export is the same after the amendment");
  assert.equal(fa.dosage.dose.value, 1);
  assert.equal(fa.dosage.dose.unit, "g");
  assert.equal(fa.dosage.route.text, "IV");
  assert.match(fa.request.reference, new RegExp(`^MedicationRequest/.+/_history/${d1.orderVersion}$`));
  assert.deepEqual(validateResource(fa).issues, [], "a valid R4 MedicationAdministration");
  // The versioned reference still finds the dose by its order.
  const orderRef = fa.request.reference.replace(/\/_history\/.*$/, "");
  const found = await as(NURSE, `/ward/fhir/MedicationAdministration?orgId=${ORG}&patient=${encodeURIComponent(p.patientId)}&request=${encodeURIComponent(orderRef)}`);
  assert.equal(found.__status, 200, JSON.stringify(found));
  assert.ok((found.entry || []).some((e) => e.resource && e.resource.id === fa.id), JSON.stringify(found));
  assert.equal(o.version, d1.orderVersion);
});

/* F5: the allergy list cannot be read. */
function breakAllergyRead() {
  const real = H.RECORD.byPatient.bind(H.RECORD);
  H.RECORD.byPatient = async (tid, type, pid) => { if (type === "AllergyIntolerance") throw new Error("simulated D1 timeout"); return real(tid, type, pid); };
  return () => { H.RECORD.byPatient = real; };
}

test("F5: order entry with an unreadable allergy list is refused; continuing needs a reason and is recorded as unchecked", async () => {
  seedWithSlotSoon();
  const p = await admittedPatient();
  const restore = breakAllergyRead();
  try {
    const refused = await prescribe(p, "Amoxicillin", 500, "mg", "PO");
    assert.equal(refused.__status, 409, JSON.stringify(refused));
    assert.equal(refused.error, "safety_check_not_run");
    assert.equal(refused.written, 0);
    assert.equal(refused.safety.checked, false);
    const placed = await prescribe(p, "Amoxicillin", 500, "mg", "PO", { uncheckedReason: "sepsis, first dose cannot wait for the allergy service" });
    ok(placed, "continued with a reason");
    const stored = await H.RECORD.latest("tenant-wsq", "MedicationOrder", placed.orderId);
    assert.equal(stored.safetyAtOrder.checked, false);
    assert.equal(stored.safetyAtOrder.code, "SAFETY_CHECK_UNAVAILABLE");
    assert.equal(stored.safetyAtOrder.continuedWithoutCheck.reason, "sepsis, first dose cannot wait for the allergy service");
    assert.ok(stored.safetyAtOrder.continuedWithoutCheck.by, "attributed");
  } finally { restore(); }
});

test("F5: a bedside scan with an unreadable allergy list is refused; continuing needs a reason and shows on the round", async () => {
  seedWithSlotSoon();
  const p = await admittedPatient();
  const o = await prescribe(p, "Ceftriaxone", 1, "g", "IV");
  ok(o, "prescribe");
  const d = await roundRow(p, o.orderId);
  for (const a of ["verify", "dispense"]) ok(await mar(p, d, a), a);
  const restore = breakAllergyRead();
  let refused, continued;
  try {
    refused = await scan(p, d);
    continued = await scan(p, d, { uncheckedReason: "anaphylaxis kit at the bedside, doctor present" });
  } finally { restore(); }
  assert.equal(refused.__status, 409, JSON.stringify(refused));
  assert.ok(refused.reasons.some((r) => r.code === "SAFETY_CHECK_UNAVAILABLE"), JSON.stringify(refused.reasons));
  ok(continued, "scan continued with a reason");
  assert.ok(continued.safetyWarnings.some((w) => w.code === "SAFETY_CHECK_UNAVAILABLE"));
  const rec = await H.RECORD.latest("tenant-wsq", "MedicationAdministration", d.administrationId);
  assert.equal(rec.safetyNotRun.code, "SAFETY_CHECK_UNAVAILABLE");
  assert.equal(rec.safetyNotRun.reason, "anaphylaxis kit at the bedside, doctor present");
  assert.ok(rec.safetyNotRun.by && rec.safetyNotRun.at);
  const row = await roundRow(p, o.orderId);
  assert.equal(row.safetyNotRun.code, "SAFETY_CHECK_UNAVAILABLE", "the round says the check did not run");
});

test("F6: order entry says renal and pregnancy/lactation coverage is missing, with the patient's latest eGFR and creatinine", async () => {
  seedWithSlotSoon();
  const p = await admittedPatient();
  const none = await prescribe(p, "Ceftriaxone", 1, "g", "IV", { checkOnly: true });
  ok(none, "check");
  const codes = (r) => r.safety.coverage.map((w) => w.code);
  assert.ok(codes(none).includes("RENAL_CHECK_NOT_AVAILABLE"), JSON.stringify(none.safety));
  assert.ok(codes(none).includes("RENAL_FUNCTION_NOT_RECORDED"));
  assert.equal(none.safety.renal.egfr, null);
  assert.ok(!codes(none).includes("PREGNANCY_LACTATION_CHECK_NOT_AVAILABLE"), "a male patient is not told about pregnancy");
  // A woman with nothing recorded on the maternity record: the missing pregnancy and lactation rules are said.
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Coverage Testpatient", mobile: "9876512777", gender: "female", ageYears: 29 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "8" });
  ok(adm, "admit");
  const her = await prescribe({ patientId: adm.patientId, encounterId: adm.encounterId }, "Ceftriaxone", 1, "g", "IV", { checkOnly: true });
  assert.ok(codes(her).includes("PREGNANCY_LACTATION_CHECK_NOT_AVAILABLE"), JSON.stringify(her.safety.coverage));
  assert.equal(her.safety.pregnancyLactation.rulesLoaded, 0);

  const at = new Date(Date.now() - 3600e3).toISOString();
  const meta = { recordedAt: at, effectiveAt: at, amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: at }, derivedFrom: [] };
  await H.RECORD.append("tenant-wsq", [
    { resourceType: "Observation", id: "obs-egfr-1", version: 1, patientId: p.patientId, encounterId: p.encounterId, code: "62238-1", codeSystem: "LOINC", category: "laboratory", value: 28, unit: "mL/min/1.73m2", meta },
    { resourceType: "Observation", id: "obs-creat-1", version: 1, patientId: p.patientId, encounterId: p.encounterId, code: "2160-0", codeSystem: "LOINC", category: "laboratory", value: 2.4, unit: "mg/dL", meta },
  ]);
  const withLabs = await prescribe(p, "Ceftriaxone", 1, "g", "IV", { checkOnly: true });
  assert.deepEqual(withLabs.safety.renal.egfr, { value: 28, unit: "mL/min/1.73m2", at, code: "62238-1", ageDays: 0, stale: false });
  assert.equal(withLabs.safety.renal.creatinine.value, 2.4);
  assert.equal(withLabs.safety.renal.tableLoaded, 0);
  assert.ok(codes(withLabs).includes("RENAL_CHECK_NOT_AVAILABLE"));
  assert.ok(!codes(withLabs).includes("RENAL_FUNCTION_NOT_RECORDED"));
  assert.ok(withLabs.safety.coverage.find((w) => w.code === "RENAL_CHECK_NOT_AVAILABLE").message.includes("eGFR 28"), "the clinician sees the value the check could not use");
  assert.ok(!withLabs.safety.findings.some((f) => /^RENAL_|^PREGNANCY_LACTATION_CHECK/.test(f.code)), "not counted as a rule that fired");

  // Placed, the order itself carries what was not covered, for the pharmacist and the nurse.
  const placed = await prescribe(p, "Ceftriaxone", 1, "g", "IV");
  ok(placed, "placed");
  const stored = await H.RECORD.latest("tenant-wsq", "MedicationOrder", placed.orderId);
  assert.ok(stored.safetyAtOrder.coverage.some((f) => f.code === "RENAL_CHECK_NOT_AVAILABLE"));
  assert.equal(stored.safetyAtOrder.renal.egfr.value, 28);
});

test("F3, the machine itself: administer() refuses a dose scanned under an order that has since changed, whatever the caller", async () => {
  const { MedicationAdministrationRecord, materialOrderChanges } = await import("../wardsynq/wardsynq-meds.js");
  const emar = new MedicationAdministrationRecord({ safetyCheck: () => ({ allowed: true, blocks: [], warnings: [] }) });
  const v1 = { id: "rx-1", version: 1, patientId: "p1", drug: "Ceftriaxone", drugBarcode: "CEF", dose: { value: 1, unit: "g" }, route: "IV", frequency: "OD", prescriberId: "dr" };
  const rec = emar.open(v1);
  await emar.verify(rec, "ph"); await emar.dispense(rec, "ph");
  await emar.scan(rec, { order: v1, patient: { id: "p1", mrn: "M1" }, nurseId: "rn", scan: { patientBarcode: "M1", drugBarcode: "CEF", dose: { value: 1, unit: "g" }, route: "IV" } });
  const v2 = { ...v1, version: 2, route: "IM" };
  assert.deepEqual(materialOrderChanges(rec.orderSnapshot, v2), ["route"]);
  assert.deepEqual(materialOrderChanges(rec.orderSnapshot, { ...v1, version: 3, stopAt: "2026-10-09T00:00:00Z" }), [], "a non-clinical change is not material");
  await assert.rejects(() => emar.administer(rec, { order: v2, nurseId: "rn" }), (e) => e.reasons[0].code === "ORDER_CHANGED_SINCE_CHECKS");
  await assert.rejects(() => emar.administer(rec, { nurseId: "rn" }), (e) => e.reasons[0].code === "ORDER_REQUIRED");
  assert.equal(rec.status, "scanned");
  await emar.administer(rec, { order: v1, nurseId: "rn" });
  assert.equal(rec.status, "administered");
  assert.deepEqual([rec.dose, rec.route, rec.orderVersion], [{ value: 1, unit: "g" }, "IV", 1]);
  assert.deepEqual(emar.invalidateForAmendedOrder(rec, v2, "rn"), [], "an administered dose is history: never reset");
});

/* F6, owner decision 2026-10-04: which eGFR codes the renal check reads. Newest result wins by time; the code preference
 * (98979-8 first, legacy group last) only breaks a tie within one draw; 33914-3 is read as 77147-7. */
const EGFR_NOW = Date.parse("2026-10-04T12:00:00Z");
const EGFR_T1 = "2026-10-04T08:00:00Z", EGFR_T0 = "2026-10-03T08:00:00Z";
const egfrObs = (code, value, at) => ({ resourceType: "Observation", code, value, unit: "mL/min/1.73m2", meta: { effectiveAt: at } });
const egfrOf = async (...o) => (await import("../functions/_wardsynq/migrate-emar.js")).renalFrom(o, EGFR_NOW).egfr;

test("F6 eGFR codes: 98979-8 is preferred over 62238-1 for the same draw, in either arrival order", async () => {
  assert.equal((await egfrOf(egfrObs("62238-1", 40, EGFR_T1), egfrObs("98979-8", 44, EGFR_T1))).code, "98979-8");
  assert.equal((await egfrOf(egfrObs("98979-8", 44, EGFR_T1), egfrObs("62238-1", 40, EGFR_T1))).value, 44);
  assert.equal((await egfrOf(egfrObs("48642-3", 50, EGFR_T1), egfrObs("69405-9", 46, EGFR_T1))).code, "69405-9", "a legacy code never beats an active one from the same draw");
});

test("F6 eGFR codes: a newer 62238-1 beats an older 98979-8 (time first, code only breaks a tie)", async () => {
  const r = await egfrOf(egfrObs("98979-8", 70, EGFR_T0), egfrObs("62238-1", 30, EGFR_T1));
  assert.deepEqual([r.code, r.value], ["62238-1", 30]);
  assert.equal((await egfrOf(egfrObs("98979-8", 70, EGFR_T0), egfrObs("48642-3", 30, EGFR_T1))).value, 30, "even a legacy code, when it is the newer result");
});

test("F6 eGFR codes: 33914-3 is accepted and reported as 77147-7", async () => {
  const r = await egfrOf(egfrObs("33914-3", 52, EGFR_T1));
  assert.deepEqual([r.code, r.value, r.legacy], ["77147-7", 52, undefined]);
  assert.equal((await egfrOf(egfrObs("33914-3", 52, EGFR_T1), egfrObs("62238-1", 51, EGFR_T1))).code, "62238-1", "the alias takes 77147-7's rank, below 62238-1");
});

test("F6 eGFR codes: 77147-7 is accepted", async () => {
  assert.equal((await egfrOf(egfrObs("77147-7", 53, EGFR_T1))).code, "77147-7");
  assert.equal((await egfrOf(egfrObs("77147-7", 53, EGFR_T1), egfrObs("69405-9", 54, EGFR_T1))).code, "77147-7", "ranked above 69405-9");
});

test("F6 eGFR codes: a lone race-specific or population-specific result is used with legacy: true and a coverage note", async () => {
  const { renalFrom, coverageFindings } = await import("../functions/_wardsynq/migrate-emar.js");
  for (const code of ["48642-3", "48643-1", "50044-7", "88293-6", "88294-4"]) {
    const renal = renalFrom([egfrObs(code, 33, EGFR_T1)], EGFR_NOW);
    assert.deepEqual([renal.egfr.code, renal.egfr.value, renal.egfr.legacy], [code, 33, true], code);
    const note = coverageFindings({ drug: "Ceftriaxone" }, renal, 0, 0, {}).find((f) => f.code === "RENAL_EGFR_LEGACY_EQUATION");
    assert.ok(note && /legacy race-specific or population-specific equation/.test(note.message), code);
  }
  const modern = renalFrom([egfrObs("98979-8", 44, EGFR_T1)], EGFR_NOW);
  assert.equal(modern.egfr.legacy, undefined);
  assert.ok(!coverageFindings({ drug: "Ceftriaxone" }, modern, 0, 0, {}).some((f) => f.code === "RENAL_EGFR_LEGACY_EQUATION"));
});

test("F6 eGFR codes: an unknown code is ignored, even when it is the newest result", async () => {
  assert.equal(await egfrOf(egfrObs("99999-9", 10, EGFR_T1)), null);
  assert.equal((await egfrOf(egfrObs("99999-9", 10, EGFR_T1), egfrObs("98979-8", 44, EGFR_T0))).value, 44);
});
