/* test/wardsynq-blood-bank.test.mjs - the blood bank through the real router: donor, screening (eligibility and
 * deferral), donation, the five mandatory tests with quarantine until non-reactive, components with their own expiry,
 * inventory by group and component, the crossmatch/issue gate on the existing transfusion workflow, discard, and who
 * may do each.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-blood-bank.test.mjs
 */
import { as, seedHospital, recordsOf, auditsOf, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { unitStatuses, screeningFailures, donationTests, inventoryOf } from "../functions/_wardsynq/blood-bank.js";

const NO = { illness: false, malaria: false, jaundice: false, tattoo: false, transfusion: false, surgery: false, pregnancy: false, "high-risk": false, "chronic-disease": false };
const CLEAR = { hiv: "non-reactive", hbv: "non-reactive", hcv: "non-reactive", syphilis: "non-reactive", malaria: "non-reactive" };
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

async function donate(bag, who = U.BLOOD) {
  const donor = await as(who, "/ward/blood-donor", "POST", { orgId: ORG, name: "Test Donor " + bag, sex: "male", dateOfBirth: "1990-05-01", phone: "9876500000" });
  assert.equal(donor.__status, 200, JSON.stringify(donor));
  const scr = await as(who, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, answers: NO, weightKg: 70, hbGdl: 14, outcome: "eligible" });
  assert.equal(scr.__status, 200, JSON.stringify(scr));
  const don = await as(who, "/ward/blood-donation", "POST", { orgId: ORG, screeningId: scr.screeningId, bagNumber: bag, volumeMl: 450, bagType: "triple" });
  assert.equal(don.__status, 200, JSON.stringify(don));
  const comp = await as(who, "/ward/blood-components", "POST", { orgId: ORG, donationId: don.donationId, components: [
    { component: "prbc", volumeMl: 280, expiresAt: inDays(42) }, { component: "ffp", volumeMl: 220, expiresAt: inDays(365) }, { component: "platelets", volumeMl: 50, expiresAt: inDays(2) }] });
  assert.equal(comp.__status, 200, JSON.stringify(comp));
  return { donor, scr, don, comp };
}

test("blood bank: POST /api/queue/ward/blood-donor, /ward/donor-screening - 401, 403 for a nurse, a doctor and another hospital, nothing written; eligibility is enforced and a deferral carries a reason and a period", async () => {
  seedHospital();
  const body = { orgId: ORG, name: "Asha", sex: "female", dateOfBirth: "1995-01-01" };
  assert.equal((await as(null, "/ward/blood-donor", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/blood-donor", "POST", body)).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/blood-donor", "POST", body)).__status, 403, "the doctor orders blood; the blood bank registers donors");
  assert.equal((await as(U.BLOOD, "/ward/blood-donor", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("BloodDonor")).length, 0);

  const donor = await as(U.BLOOD, "/ward/blood-donor", "POST", body);
  assert.equal(donor.__status, 200, JSON.stringify(donor));
  assert.ok(auditsOf("BloodDonor").length >= 1);
  const low = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, answers: NO, weightKg: 48, hbGdl: 11.8, outcome: "eligible" });
  assert.equal(low.__status, 422);
  assert.deepEqual(low.failures, ["haemoglobin"]);
  const q = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, answers: { ...NO, tattoo: true }, weightKg: 60, hbGdl: 13, outcome: "eligible" });
  assert.deepEqual(q.failures, ["questionnaire"]);
  const partial = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, answers: { illness: false }, weightKg: 60, hbGdl: 13, outcome: "eligible" });
  assert.equal(partial.error, "questionnaire_incomplete");
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, answers: NO, weightKg: 60, hbGdl: 11, outcome: "deferred", deferralReason: "Low haemoglobin" })).error, "deferral_period_required");
  const def = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, answers: NO, weightKg: 60, hbGdl: 11, outcome: "deferred", deferralReason: "Low haemoglobin", deferralDays: 90 });
  assert.equal(def.__status, 200, JSON.stringify(def));
  const blocked = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, answers: NO, weightKg: 60, hbGdl: 13.5, outcome: "eligible" });
  assert.equal(blocked.error, "donor_deferred", "a deferral in force is not screened away");
  const donation = await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, screeningId: def.screeningId, bagNumber: "B9", volumeMl: 350 });
  assert.equal(donation.error, "no_eligible_screening");
  const view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.equal(view.__status, 200);
  assert.equal(view.donors[0].deferral.reason, "Low haemoglobin");
  assert.equal((await as(U.NURSE, `/ward/blood-bank?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(null, `/ward/blood-bank?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG2}`)).__status, 403);
});

test("blood bank golden path: POST /api/queue/ward/blood-donation, /ward/blood-components, /ward/blood-test-result - quarantine until all five tests are non-reactive; a reactive donation is never available; POST /ward/blood-unit-event discards with a reason", async () => {
  seedHospital();
  const a = await donate("BAG-100");
  assert.equal((await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, screeningId: a.scr.screeningId, bagNumber: "BAG-101", volumeMl: 450 })).error, "screening_used");
  assert.equal((await as(U.NURSE, "/ward/blood-components", "POST", { orgId: ORG, donationId: a.don.donationId, components: [{ component: "cryo", volumeMl: 20, expiresAt: inDays(300) }] })).__status, 403);

  let view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.deepEqual(view.units.map((u) => u.status), ["quarantine", "quarantine", "quarantine"], "untested is quarantine, not available");
  assert.equal(view.inventory.length, 0);

  const incomplete = await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: { hiv: "non-reactive" }, abo: "O", rhD: "positive" });
  assert.equal(incomplete.error, "tti_incomplete");
  assert.equal((await as(U.NURSE, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: CLEAR, abo: "O", rhD: "positive" })).__status, 403);
  assert.equal((await recordsOf("BloodTestResult")).length, 0);
  const ok = await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: CLEAR, abo: "O", rhD: "positive" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.deepEqual(view.inventory.map((r) => [r.group, r.component, r.available]), [["O+", "ffp", 1], ["O+", "platelets", 1], ["O+", "prbc", 1]]);
  assert.ok(view.expiryAlerts.some((u) => u.component === "platelets"), "platelets expiring within three days are flagged");

  const b = await donate("BAG-200");
  const reactive = await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: b.don.donationId, tti: { ...CLEAR, hbv: "reactive" }, abo: "A", rhD: "negative" });
  assert.equal(reactive.state, "reactive");
  view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.ok(view.units.filter((u) => u.bagNumber === "BAG-200").every((u) => u.status === "reactive"));
  assert.ok(!view.inventory.some((r) => r.group === "A-"), "a reactive donation never reaches the inventory");
  const unit = view.units.find((u) => u.bagNumber === "BAG-200" && u.component === "prbc");
  assert.equal((await as(U.BLOOD, "/ward/blood-unit-event", "POST", { orgId: ORG, unitId: unit.unitId, kind: "discard" })).error, "reason_required");
  assert.equal((await as(U.NURSE, "/ward/blood-unit-event", "POST", { orgId: ORG, unitId: unit.unitId, kind: "discard", reason: "HBsAg reactive" })).__status, 403);
  const disc = await as(U.BLOOD, "/ward/blood-unit-event", "POST", { orgId: ORG, unitId: unit.unitId, kind: "discard", reason: "HBsAg reactive" });
  assert.equal(disc.__status, 200, JSON.stringify(disc));
  view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.equal(view.units.find((u) => u.unitId === unit.unitId).status, "discarded");
  const dup = await as(U.BLOOD, "/ward/blood-components", "POST", { orgId: ORG, donationId: b.don.donationId, components: [{ component: "prbc", volumeMl: 280, expiresAt: inDays(42) }] });
  assert.equal(dup.error, "unit_exists", "a unit is never written twice");
});

test("inventory gate on the existing workflow: POST /api/queue/ward/transfusion-crossmatch reserves an available registered unit with its recorded group, refuses a quarantined or mismatched one; POST /ward/transfusion-issue takes it off the shelf", async () => {
  seedHospital();
  const a = await donate("BAG-300");
  const units = (await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`)).units;
  const prbc = units.find((u) => u.component === "prbc");

  const reg = await as(U.DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Transfusion Patient", mobile: "9876522201", gender: "female", ageYears: 50 });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const adm = await as(U.DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "1" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const req = await as(U.DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, patientId: adm.patientId, mrn: reg.mrn, component: "red-cells", units: 1, aboGroup: "O", rhD: "positive" });
  assert.equal(req.__status, 200, JSON.stringify(req));

  const quarantined = await as(U.BLOOD, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req.episodeId, unitId: prbc.unitNumber, component: "red-cells" });
  assert.equal(quarantined.__status, 409, JSON.stringify(quarantined));
  assert.equal(quarantined.code, "UNIT_NOT_AVAILABLE");
  assert.equal((await recordsOf("TransfusionEpisode"))[0].phase, "requested", "nothing was crossmatched");

  assert.equal((await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: CLEAR, abo: "O", rhD: "positive" })).__status, 200);
  const wrongGroup = await as(U.BLOOD, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req.episodeId, unitId: prbc.unitNumber, aboGroup: "A", rhD: "positive", component: "red-cells" });
  assert.equal(wrongGroup.code, "GROUP_MISMATCH", "typed group never overrides the tested group");
  const plasma = units.find((u) => u.component === "ffp");
  assert.equal((await as(U.BLOOD, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req.episodeId, unitId: plasma.unitNumber, component: "red-cells" })).code, "COMPONENT_MISMATCH");

  const xm = await as(U.BLOOD, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req.episodeId, unitId: prbc.unitNumber.toLowerCase(), component: "red-cells" });
  assert.equal(xm.__status, 200, JSON.stringify(xm));
  assert.equal(xm.inventory, "tracked");
  assert.equal(xm.crossmatch.aboGroup, "O");
  assert.equal(xm.crossmatch.expiresAt, prbc.expiresAt, "the expiry comes from the unit's record");
  let view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.equal(view.units.find((u) => u.unitId === prbc.unitId).status, "reserved");
  assert.ok(!view.inventory.some((r) => r.component === "prbc"), "a reserved unit is not available to anyone else");
  assert.equal((await as(U.BLOOD, "/ward/blood-unit-event", "POST", { orgId: ORG, unitId: prbc.unitId, kind: "discard", reason: "x" })).error, "unit_reserved");

  const issue = await as(U.BLOOD, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId: req.episodeId });
  assert.equal(issue.__status, 200, JSON.stringify(issue));
  view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.equal(view.units.find((u) => u.unitId === prbc.unitId).status, "issued", "the issue on the episode decrements the inventory; no second record");

  // A unit from another blood centre is not in this inventory and passes as before.
  const req2 = await as(U.DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, patientId: adm.patientId, mrn: reg.mrn, component: "red-cells", units: 1, aboGroup: "O", rhD: "positive", at: new Date(Date.now() + 1000).toISOString() });
  assert.equal(req2.__status, 200, JSON.stringify(req2));
  const outside = await as(U.BLOOD, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req2.episodeId, unitId: "EXT-555", aboGroup: "O", rhD: "negative", component: "red-cells", expiresAt: inDays(10) });
  assert.equal(outside.__status, 200, JSON.stringify(outside));
  assert.equal(outside.inventory, "untracked");
});

test("blood bank pure functions: tests, statuses and eligibility", () => {
  assert.equal(donationTests("d", []).state, "untested");
  assert.equal(donationTests("d", [{ donationId: "d", tti: { ...CLEAR, malaria: "reactive" }, abo: "B", rhD: "positive", at: "1" }]).state, "reactive");
  const now = "2026-09-16T00:00:00.000Z";
  const base = { id: "u", unitNumber: "X-PRBC", donationId: "d", component: "prbc", expiresAt: "2026-10-01T00:00:00.000Z" };
  const res = [{ donationId: "d", tti: CLEAR, abo: "B", rhD: "negative", at: "1" }];
  assert.equal(unitStatuses([base], [], [], [], [], now)[0].status, "quarantine");
  assert.equal(unitStatuses([base], [], res, [], [], now)[0].status, "available");
  assert.equal(unitStatuses([{ ...base, expiresAt: "2026-09-15T00:00:00.000Z" }], [], res, [], [], now)[0].status, "expired");
  const ep = { id: "e", phase: "crossmatched", crossmatch: { unitId: "x-prbc" } };
  assert.equal(unitStatuses([base], [], res, [], [ep], now)[0].status, "reserved");
  assert.equal(unitStatuses([base], [], res, [{ unitId: "u", kind: "release", episodeId: "e", at: "2" }], [ep], now)[0].status, "available", "a released reservation is back on the shelf");
  assert.equal(unitStatuses([base], [], res, [], [{ ...ep, phase: "stopped", ledger: [{ event: "issued" }] }], now)[0].status, "issued");
  assert.deepEqual(inventoryOf(unitStatuses([base], [], res, [], [], now)).map((r) => r.group), ["B-"]);
  const donor = { dateOfBirth: "2010-01-01", sex: "female" };
  assert.deepEqual(screeningFailures(donor, { weightKg: 44, hbGdl: 12.5, answers: NO }, "2026-07-01T00:00:00.000Z", now), ["age", "weight", "interval"]);
});
