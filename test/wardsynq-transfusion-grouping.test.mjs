/* CLIN-09, CLIN-16, CLIN-21 (audit B:C1, B:C2, B:C3).
 * - The patient's ABO/RhD comes only from a recorded, concordant blood group result, never from the request.
 * - The first bedside checker is the signed-in user; the second is an active staff member; the wristband is
 *   the patient record's, not the request's.
 * - Red cells with no recorded unit RhD are not compatible with a D-negative patient.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-transfusion-grouping.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE, LAB, idFor } = await import("./_wardsynq-alert-harness.mjs");
const { checkCompatibility } = await import("../wardsynq/wardsynq-transfusion.js");
const { groupingFrom } = await import("../functions/_wardsynq/migrate-transfusion.js");

let seq = 0;
const at = () => new Date(Date.UTC(2026, 8, 26, 1, 0, ++seq)).toISOString();
const request = (p, extra) => as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, patientId: p.patientId, mrn: p.mrn, encounterId: p.encounterId, component: "prbc", units: 1, at: at(), ...(extra || {}) });
const crossmatch = (ep, unit) => as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: ep.episodeId, component: "prbc", ...unit });
async function recordGroup(p, value, name) {
  const test = name || "Blood Group";
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: p.encounterId, code: test, category: "laboratory" });
  await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: order.orderId, specimenType: "Whole blood" });
  const r = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: order.orderId, tests: [{ test, value }], status: "final" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  return r;
}

test("PURE: a unit with no RhD is not compatible red cells for a D-negative patient", () => {
  const v = checkCompatibility({ aboGroup: "A", rhD: "negative" }, { aboGroup: "A", component: "prbc" });
  assert.equal(v.compatible, false);
  assert.ok(v.reasons.some((r) => r.code === "UNIT_RHD_UNKNOWN"));
  // Plasma carries no red cells: its RhD is not asked for.
  assert.equal(checkCompatibility({ aboGroup: "A", rhD: "negative" }, { aboGroup: "A", component: "ffp" }).compatible, true);
});

test("PURE: the grouping is read from blood group results, concordant or not at all", () => {
  const obs = (code, value) => ({ code, codeSystem: "http://loinc.org", value });
  assert.deepEqual(groupingFrom([obs("882-1", "O Positive")]), { aboGroup: "O", rhD: "positive", results: 1 });
  assert.deepEqual(groupingFrom([obs("882-1", "AB -ve")]), { aboGroup: "AB", rhD: "negative", results: 1 });
  assert.deepEqual(groupingFrom([obs("883-9", "B"), obs("10331-7", "Neg")]), { aboGroup: "B", rhD: "negative", results: 2 });
  assert.equal(groupingFrom([]).reason, "none_recorded");
  assert.equal(groupingFrom([obs("882-1", "O+"), obs("882-1", "A+")]).reason, "discordant");
  assert.equal(groupingFrom([obs("882-1", "see report")]).reason, "unreadable");
  assert.equal(groupingFrom([obs("882-1", "O Positive"), { ...obs("882-1", "A Positive"), status: "entered-in-error" }]).aboGroup, "O");
});

test("a group typed into the request is ignored; with none recorded nothing is compatible", async () => {
  seedHospital();
  const p = await admittedPatient();
  const ep = await request(p, { aboGroup: "A", rhD: "negative" });
  assert.equal(ep.__status, 200, JSON.stringify(ep));
  const xm = await crossmatch(ep, { unitId: "U-A1", aboGroup: "A", rhD: "negative" });
  assert.equal(xm.__status, 409, JSON.stringify(xm));
  assert.equal(xm.error, "transfusion_refused");
  assert.match(xm.detail, /ABO group is not determined/);
  assert.equal(xm.grouping && xm.grouping.reason, "none_recorded");
});

test("the recorded group decides: O-negative patient refuses A cells and a unit with no RhD, accepts O-negative", async () => {
  seedHospital();
  const p = await admittedPatient();
  await recordGroup(p, "O Negative");
  const ep1 = await request(p, { aboGroup: "A", rhD: "positive" });
  const a = await crossmatch(ep1, { unitId: "U-A2", aboGroup: "A", rhD: "negative" });
  assert.equal(a.__status, 409, JSON.stringify(a));
  assert.equal(a.code, "INCOMPATIBLE");
  assert.match(a.detail, /group A must never be given to a group O patient/);
  const ep2 = await request(p);
  const noRh = await crossmatch(ep2, { unitId: "U-O1", aboGroup: "O" });
  assert.equal(noRh.__status, 409, JSON.stringify(noRh));
  assert.match(noRh.detail, /RhD/);
  const ep3 = await request(p);
  const ok = await crossmatch(ep3, { unitId: "U-O2", aboGroup: "O", rhD: "negative" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
});

test("two blood group results that disagree: nothing is compatible until it is resolved", async () => {
  seedHospital();
  const p = await admittedPatient();
  await recordGroup(p, "O Positive");
  await recordGroup(p, "A Positive", "ABO & Rh"); // a second sample, under the other name a lab uses
  const ep = await request(p);
  const xm = await crossmatch(ep, { unitId: "U-O3", aboGroup: "O", rhD: "negative" });
  assert.equal(xm.__status, 409, JSON.stringify(xm));
  assert.equal(xm.grouping && xm.grouping.reason, "discordant");
});

test("bedside check: the first checker is the signed-in user, the second a real colleague, the wristband the record's", async () => {
  seedHospital();
  const p = await admittedPatient();
  await recordGroup(p, "O Positive");
  const ep = await request(p);
  assert.equal((await crossmatch(ep, { unitId: "U-9", aboGroup: "O", rhD: "positive" })).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId: ep.episodeId })).__status, 200);
  const unitInHand = { unitId: "U-9", aboGroup: "O", rhD: "positive", component: "prbc" };
  const check = (extra) => as(DOCTOR, "/ward/transfusion-bedside-check", "POST", { orgId: ORG, episodeId: ep.episodeId,
    checkerId: "anyone", scannedPatientBarcode: p.mrn, scannedUnitId: "U-9", patient: { id: p.patientId, mrn: p.mrn, wristbandBarcode: p.mrn }, unitInHand, ...extra });

  const typed = await check({ secondCheckerId: "someone else" });
  assert.equal(typed.__status, 409, JSON.stringify(typed));
  assert.equal(typed.code, "SECOND_CHECKER_NOT_STAFF");
  const self = await check({ secondCheckerId: idFor(DOCTOR) });
  assert.equal(self.__status, 409, JSON.stringify(self));
  assert.equal(self.code, "SECOND_CHECKER_NOT_INDEPENDENT");
  const selfEmail = await check({ secondCheckerId: DOCTOR.toUpperCase() });
  assert.equal(selfEmail.code, "SECOND_CHECKER_NOT_INDEPENDENT", "their own email is still them");
  // A wristband and MRN supplied by the request are not the patient's: the record's MRN is what the scan must match.
  const fakeBand = await check({ secondCheckerId: idFor(NURSE), scannedPatientBarcode: "FAKE-BAND", patient: { id: p.patientId, mrn: "FAKE-BAND", wristbandBarcode: "FAKE-BAND" } });
  assert.equal(fakeBand.__status, 409, JSON.stringify(fakeBand));
  assert.equal(fakeBand.code, "PATIENT_IDENTITY");

  const ok = await check({ secondCheckerId: idFor(NURSE) });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.bedsideCheck.checkerId, idFor(DOCTOR), "the first checker is who is signed in, not a typed name");
  assert.equal(ok.bedsideCheck.secondCheckerId, idFor(NURSE));
});
