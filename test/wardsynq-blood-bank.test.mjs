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
import { unitStatuses, donationTests, inventoryOf } from "../functions/_wardsynq/blood-bank.js";
import { screeningFailures, donorCriteriaFor, validateDonorCriteria, deferralFor, discretionary, legalMinimums, CRITERIA, DEFERRALS } from "../functions/_wardsynq/donor-criteria.js";

const NO = { illness: false, "infection-history": false, malaria: false, jaundice: false, tattoo: false, transfusion: false, surgery: false, pregnancy: false, "high-risk": false,
  "chronic-disease": false, vaccination: false, medication: false, harvest: false, "pre-donation": false, "foreign-resident": false };
/* Measured at every screening in India (Schedule F Part XII-B items 5, 6, 7). The harness hospital names no region: India. */
const V = { bp: "120/80", pulse: 72, pulseRegular: true, temperature: 36.8 };
const CLEAR = { hiv: "non-reactive", hbv: "non-reactive", hcv: "non-reactive", syphilis: "non-reactive", malaria: "non-reactive" };
/* The method of each test and the irregular antibody screen (Schedule F Part XII-B headings K and L). */
const LAB = { methods: { hiv: "elisa", hbv: "elisa", hcv: "elisa", syphilis: "vdrl", malaria: "rapid-antigen" }, antibodyScreen: "negative" };
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

async function donate(bag, who = U.BLOOD) {
  const donor = await as(who, "/ward/blood-donor", "POST", { orgId: ORG, name: "Test Donor " + bag, sex: "male", dateOfBirth: "1990-05-01", phone: "9876500000" });
  assert.equal(donor.__status, 200, JSON.stringify(donor));
  const scr = await as(who, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, ...V, answers: NO, weightKg: 70, hbGdl: 14, outcome: "eligible" });
  assert.equal(scr.__status, 200, JSON.stringify(scr));
  const don = await as(who, "/ward/blood-donation", "POST", { orgId: ORG, donorKind: "voluntary", anticoagulant: "cpda", screeningId: scr.screeningId, bagNumber: bag, volumeMl: 450, bagType: "triple" });
  assert.equal(don.__status, 200, JSON.stringify(don));
  const comp = await as(who, "/ward/blood-components", "POST", { orgId: ORG, donationId: don.donationId, components: [
    { component: "prbc", volumeMl: 280, additive: "sagm" }, { component: "ffp", volumeMl: 220 }, { component: "platelets", volumeMl: 50, expiresAt: inDays(2) }] });
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
  const low = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, ...V, answers: NO, weightKg: 48, hbGdl: 11.8, outcome: "eligible" });
  assert.equal(low.__status, 422);
  assert.deepEqual(low.failures, ["haemoglobin"]);
  const q = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, ...V, answers: { ...NO, tattoo: true }, weightKg: 60, hbGdl: 13, outcome: "eligible" });
  assert.deepEqual(q.failures, ["questionnaire"]);
  const partial = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, ...V, answers: { illness: false }, weightKg: 60, hbGdl: 13, outcome: "eligible" });
  assert.equal(partial.error, "questionnaire_incomplete");
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, ...V, answers: NO, weightKg: 60, hbGdl: 11, outcome: "deferred", deferralReason: "Low haemoglobin" })).error, "deferral_period_required");
  const def = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, ...V, answers: NO, weightKg: 60, hbGdl: 11, outcome: "deferred", deferralReason: "Low haemoglobin", deferralDays: 90 });
  assert.equal(def.__status, 200, JSON.stringify(def));
  const blocked = await as(U.BLOOD, "/ward/donor-screening", "POST", { orgId: ORG, donorId: donor.donorId, ...V, answers: NO, weightKg: 60, hbGdl: 13.5, outcome: "eligible" });
  assert.equal(blocked.error, "donor_deferred", "a deferral in force is not screened away");
  const donation = await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, donorKind: "voluntary", anticoagulant: "cpda", screeningId: def.screeningId, bagNumber: "B9", volumeMl: 350 });
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
  assert.equal((await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, donorKind: "voluntary", anticoagulant: "cpda", screeningId: a.scr.screeningId, bagNumber: "BAG-101", volumeMl: 450 })).error, "screening_used");
  assert.equal((await as(U.NURSE, "/ward/blood-components", "POST", { orgId: ORG, donationId: a.don.donationId, components: [{ component: "cryo", volumeMl: 20, expiresAt: inDays(300) }] })).__status, 403);

  let view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.deepEqual(view.units.map((u) => u.status), ["quarantine", "quarantine", "quarantine"], "untested is quarantine, not available");
  assert.equal(view.inventory.length, 0);

  const incomplete = await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: { hiv: "non-reactive" }, abo: "O", rhD: "positive" });
  assert.equal(incomplete.error, "tti_incomplete");
  assert.equal((await as(U.NURSE, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: CLEAR, ...LAB, abo: "O", rhD: "positive" })).__status, 403);
  assert.equal((await recordsOf("BloodTestResult")).length, 0);
  const ok = await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: CLEAR, ...LAB, abo: "O", rhD: "positive" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.deepEqual(view.inventory.map((r) => [r.group, r.component, r.available]), [["O+", "ffp", 1], ["O+", "platelets", 1], ["O+", "prbc", 1]]);
  assert.ok(view.expiryAlerts.some((u) => u.component === "platelets"), "platelets expiring within three days are flagged");

  const b = await donate("BAG-200");
  const reactive = await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: b.don.donationId, tti: { ...CLEAR, hbv: "reactive" }, ...LAB, abo: "A", rhD: "negative" });
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
  const dup = await as(U.BLOOD, "/ward/blood-components", "POST", { orgId: ORG, donationId: b.don.donationId, components: [{ component: "prbc", volumeMl: 280, additive: "sagm" }] });
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

  assert.equal((await as(U.BLOOD, "/ward/blood-test-result", "POST", { orgId: ORG, donationId: a.don.donationId, tti: CLEAR, ...LAB, abo: "O", rhD: "positive" })).__status, 200);
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
  const res = [{ donationId: "d", tti: CLEAR, ...LAB, abo: "B", rhD: "negative", at: "1" }];
  assert.equal(unitStatuses([base], [], [], [], [], now)[0].status, "quarantine");
  assert.equal(unitStatuses([base], [], res, [], [], now)[0].status, "available");
  assert.equal(unitStatuses([{ ...base, expiresAt: "2026-09-15T00:00:00.000Z" }], [], res, [], [], now)[0].status, "expired");
  const ep = { id: "e", phase: "crossmatched", crossmatch: { unitId: "x-prbc" } };
  assert.equal(unitStatuses([base], [], res, [], [ep], now)[0].status, "reserved");
  assert.equal(unitStatuses([base], [], res, [{ unitId: "u", kind: "release", episodeId: "e", at: "2" }], [ep], now)[0].status, "available", "a released reservation is back on the shelf");
  assert.equal(unitStatuses([base], [], res, [], [{ ...ep, phase: "stopped", ledger: [{ event: "issued" }] }], now)[0].status, "issued");
  assert.deepEqual(inventoryOf(unitStatuses([base], [], res, [], [], now)).map((r) => r.group), ["B-"]);
  const donor = { dateOfBirth: "2010-01-01", sex: "female" };
  assert.deepEqual(screeningFailures(donor, { weightKg: 44, hbGdl: 12.5, answers: NO }, [{ at: "2026-07-01T00:00:00.000Z" }], now), ["age", "weight", "interval"]);
});

/* DONOR CRITERIA (functions/_wardsynq/donor-criteria.js): the stricter of WHO 2012 and the law of the hospital's region,
 * a hospital setting only when stricter still. India's values are Schedule F Part XII-B (G.S.R. 166(E), 2020). */
const NOW = "2026-09-17T00:00:00.000Z", ago = (d) => new Date(Date.parse(NOW) - d * 86400000).toISOString();

test("stricter of WHO and India: each value in force and its source (WHO section, Schedule F item, or both)", () => {
  const IN = donorCriteriaFor(null, "IN"), WHO = donorCriteriaFor(null, "US");
  const pick = (c, k) => [c.values[k], c.sources[k].source];
  assert.deepEqual(pick(IN, "minHbFemale"), [12.5, "law"], "India 12.5 (item 9) is stricter than WHO 12.0 (4.6.1)");
  assert.deepEqual(pick(IN, "minHbMale"), [13, "who"], "WHO 13.0 is stricter than India 12.5");
  assert.deepEqual(pick(IN, "intervalDaysMale"), [90, "law"]); assert.deepEqual(pick(IN, "intervalDaysFemale"), [120, "law"]);
  assert.deepEqual(pick(IN, "minAge"), [18, "both"]); assert.deepEqual(pick(IN, "maxAge"), [65, "both"]); assert.deepEqual(pick(IN, "firstTimeMaxAge"), [60, "both"]);
  assert.deepEqual(pick(IN, "apheresisMaxAge"), [60, "law"]);
  assert.deepEqual(IN.limits.minWeightKg450, { value: 55, exclusive: true }, "item 3: more than 55 kg, stricter than WHO 50 kg");
  assert.deepEqual(pick(IN, "minWeightKg350"), [45, "both"]);
  assert.deepEqual(pick(IN, "apheresisIntervalDaysPlatelets"), [28, "who"], "WHO 4 weeks is stricter than India's 48 hours");
  assert.deepEqual(pick(IN, "apheresisMaxPerYear"), [24, "law"]);
  assert.deepEqual([IN.values.systolicMin, IN.values.systolicMax, IN.values.diastolicMin, IN.values.diastolicMax, IN.values.pulseMin, IN.values.pulseMax], [100, 140, 60, 90, 60, 100]);
  assert.equal(IN.sources.systolicMax.law.item, "5");
  assert.deepEqual(IN.measure, { bp: "5", pulse: "6", temperature: "7" });
  assert.equal(IN.ageDiscretion, false, "item 2 states the age limits without a physician's discretion");
  assert.deepEqual([IN.deferrals.malaria.days, IN.deferrals.malaria.source], [183, "who"], "WHO 6 months over India's 3 months (item 58)");
  assert.deepEqual([IN.deferrals.delivery.days, IN.deferrals.delivery.source], [366, "law"], "India 12 months (item 15) over WHO 6 months");
  assert.equal(IN.deferrals["hepatitis-b-c-unknown"].days, "permanent");
  assert.equal(IN.deferrals["high-risk-behaviour"].law.item, "52");
  assert.ok(IN.questions.includes("foreign-resident"));
  // Another country: WHO alone, the Council of Europe yearly maximum, nothing measured by law, WHO's physician discretion.
  assert.deepEqual([WHO.values.minHbFemale, WHO.values.minWeightKg450, WHO.values.intervalDaysMale, WHO.values.systolicMax], [12, 50, 84, null]);
  assert.deepEqual(pick(WHO, "maxPerYearFemale"), [4, "coe"]);
  assert.equal(WHO.ageDiscretion, true); assert.deepEqual(WHO.measure, {});
  assert.equal(WHO.questions.includes("foreign-resident"), false);
  assert.equal(donorCriteriaFor(null, null).jurisdiction, "IN", "a hospital with no region is India, as the rest of WardSynQ reads it");
  assert.equal(Object.keys(legalMinimums.IN.criteria).length, 24);
  assert.equal(CRITERIA.minHbFemale.who.ref, "4.6.1"); assert.equal(DEFERRALS.tattoo.who.ref, "7.9.5");
});

test("screening boundaries: more than 55 kg for 450 mL in India, haemoglobin and intervals by sex, age limits hard in India, apheresis rules, vitals", () => {
  const IN = donorCriteriaFor(null, "IN"), US = donorCriteriaFor(null, "US");
  const f = (sex, dob, s, hist, cr) => screeningFailures({ sex, dateOfBirth: dob }, { weightKg: 70, hbGdl: 14, answers: NO, ...s }, hist || [], NOW, cr || IN);
  const { meets } = { meets: (x, lim) => (lim.exclusive ? x > lim.value : x >= lim.value) };
  assert.equal(meets(55, IN.limits.minWeightKg450), false, "exactly 55 kg is not more than 55");
  assert.equal(meets(55.1, IN.limits.minWeightKg450), true);
  assert.deepEqual(f("female", "1990-01-01", { hbGdl: 12.4 }), ["haemoglobin"]);
  assert.deepEqual(f("female", "1990-01-01", { hbGdl: 12.5 }), []);
  assert.deepEqual(f("male", "1990-01-01", { hbGdl: 12.9 }), ["haemoglobin"], "WHO's 13.0 for men is kept in India");
  assert.deepEqual(f("female", "1990-01-01", { hbGdl: 12.2 }, [], US), [], "12.2 is enough under WHO alone");
  assert.deepEqual(f("male", "1990-01-01", {}, [{ at: ago(89) }]), ["interval"]); assert.deepEqual(f("male", "1990-01-01", {}, [{ at: ago(90) }]), []);
  assert.deepEqual(f("female", "1990-01-01", {}, [{ at: ago(119) }]), ["interval"]); assert.deepEqual(f("female", "1990-01-01", {}, [{ at: ago(120) }]), []);
  assert.deepEqual(f("male", "1990-01-01", {}, [{ at: ago(84) }], US), [], "WHO alone: 12 weeks");
  assert.deepEqual(f("male", "2009-09-18", {}), ["age"]);
  assert.deepEqual(f("male", "1965-09-16", {}), ["first-time-age"], "61, never donated here");
  assert.deepEqual(f("male", "1965-09-16", {}, [{ at: ago(400) }]), []);
  assert.deepEqual(f("male", "1960-09-16", {}, [{ at: ago(400) }]), ["age-over-limit"]);
  assert.deepEqual(discretionary(IN), [], "in India an age failure is a deferral, never a physician's discretion");
  assert.deepEqual(discretionary(US), ["age-over-limit", "first-time-age"]);
  // Apheresis: age 18 to 60, 50 kg, WHO 28 days between platelet collections, 2 in 7 days, 24 in a year, 28 days after whole blood,
  // and whole blood 28 days after apheresis, 90 when the red cells were not all returned.
  const plt = (s, hist) => f("male", "1990-01-01", { donationType: "apheresis-platelets", plateletCount: 200, ...s }, hist);
  assert.deepEqual(plt({}), []);
  assert.deepEqual(f("male", "1964-01-01", { donationType: "apheresis-platelets", plateletCount: 200 }, [{ at: ago(400) }]), ["apheresis-age"], "62, a regular donor, past India's 60 for apheresis");
  assert.deepEqual(plt({ weightKg: 49 }), ["weight"]);
  assert.deepEqual(plt({ plateletCount: 150 }), ["platelet-count"], "WHO 4.10: above 150");
  assert.deepEqual(plt({}, [{ at: ago(27), type: "apheresis-platelets" }]), ["apheresis-interval"]);
  assert.deepEqual(plt({}, [{ at: ago(20), type: "whole-blood" }]), ["after-whole-blood"]);
  assert.deepEqual(f("male", "1990-01-01", { donationType: "apheresis-plasma", totalProteinGL: 65 }, Array.from({ length: 24 }, (_, i) => ({ at: ago(20 + i * 14), type: "apheresis-plasma" }))), ["apheresis-annual-limit"]);
  assert.deepEqual(f("male", "1990-01-01", {}, [{ at: ago(30), type: "apheresis-platelets", reinfusionComplete: true }]), []);
  assert.deepEqual(f("male", "1990-01-01", {}, [{ at: ago(30), type: "apheresis-platelets", reinfusionComplete: false }]), ["after-apheresis"], "item 4: 90 days after incomplete red cell return");
  assert.deepEqual(f("male", "1990-01-01", { temperatureC: 37.7, systolic: 141, diastolic: 80, pulse: 72, pulseRegular: false }), ["temperature", "blood-pressure", "pulse"]);
  assert.deepEqual(f("male", "1990-01-01", { systolic: 150, diastolic: 95 }, [], US), [], "WHO alone checks no blood pressure");
});

test("deferral table: the period is worked out from the condition and its date; permanent conditions; a condition without a fixed period needs days", () => {
  const IN = donorCriteriaFor(null, "IN");
  const t = deferralFor([{ condition: "tattoo", since: "2026-09-01" }, { condition: "malaria", since: "2026-08-01" }], IN, NOW);
  assert.equal(t.ok, true); assert.equal(t.permanent, false);
  assert.equal(t.until, new Date(Date.parse("2026-09-01") + 366 * 86400000).toISOString());
  assert.equal(deferralFor([{ condition: "hepatitis-b-c-unknown" }], IN, NOW).permanent, true);
  assert.deepEqual(deferralFor([{ condition: "breastfeeding" }], IN, NOW).undated, ["breastfeeding"]);
  assert.equal(deferralFor([{ condition: "tattoo" }], IN, NOW).error, "deferral_date_required");
  assert.equal(deferralFor([{ condition: "tattoo", since: "2027-01-01" }], IN, NOW).error, "deferral_date_required", "not in the future");
  assert.equal(deferralFor([{ condition: "made-up" }], IN, NOW).error, "deferral_condition_invalid");
});

test("hospital settings: only stricter than the value in force, so never looser than WHO or India; a looser value is refused by name", () => {
  const ok = validateDonorCriteria({ minHbMale: 13.5, minWeightKg450: 56, deferrals: { malaria: 400 }, maxAge: "" }, "IN");
  assert.deepEqual(ok, { value: { minHbMale: 13.5, minWeightKg450: 56, deferrals: { malaria: 400 } }, errors: {} });
  const bad = validateDonorCriteria({ minWeightKg450: 55, minHbFemale: 12.0, minHbMale: 12.5, intervalDaysMale: 84, minAge: 17, "deferrals.malaria": 92, "deferrals.hepatitis-b-c-unknown": 999, systolicMin: 90, systolicMax: 130 }, "IN");
  assert.match(bad.errors.minWeightKg450, /stricter than the law: more than 55/, "55 inclusive is looser than more than 55");
  assert.match(bad.errors.minHbFemale, /at least 12.5/); assert.match(bad.errors.minHbMale, /at least 13/);
  assert.match(bad.errors.intervalDaysMale, /at least 90/); assert.match(bad.errors.minAge, /at least 18/);
  assert.match(bad.errors["deferrals.malaria"], /at least 183 days/);
  assert.match(bad.errors["deferrals.hepatitis-b-c-unknown"], /already a permanent deferral/);
  assert.match(bad.errors.systolicMin, /at least 100/);
  assert.equal(validateDonorCriteria({ minHbFemale: 12.2 }, "US").errors.minHbFemale, undefined, "WHO alone allows 12.2 as stricter than 12.0");
  assert.match(validateDonorCriteria({ systolicMin: 150, systolicMax: 140 }, "US").errors.systolicMax, /above systolicMin/);
  assert.equal(validateDonorCriteria([]).errors.criteria, "Send the criteria as an object.");
  assert.equal(donorCriteriaFor({ bloodDonorCriteria: { minHbFemale: 12.0 } }, "IN").values.minHbFemale, 12.5, "a looser value stored outside the screen is ignored");
  const mine = donorCriteriaFor({ bloodDonorCriteria: { minHbMale: 13.5, deferrals: { malaria: 400 } } }, "IN");
  assert.deepEqual([mine.values.minHbMale, mine.sources.minHbMale.source, mine.deferrals.malaria.days, mine.deferrals.malaria.source], [13.5, "hospital", 400, "hospital"]);
});

test("routes: POST /api/queue/org/blood-donor-criteria settings reach POST /ward/donor-screening and /ward/blood-donation; India's measurements, the deferral table, apheresis and the 55 kg boundary are enforced; nothing is written on a refusal", async () => {
  seedHospital();
  assert.equal((await as(U.BLOOD, "/org/blood-donor-criteria", "POST", { orgId: ORG, criteria: { minHbMale: 13.5 } })).__status, 403, "the blood bank screens; hospital administration sets the criteria");
  assert.equal((await as(U.ADMIN, "/org/blood-donor-criteria", "POST", { orgId: ORG, criteria: { minHbFemale: 12.0 } })).__status, 422, "never looser than India");
  const saved = await as(U.ADMIN, "/org/blood-donor-criteria", "POST", { orgId: ORG, criteria: { minHbFemale: 13, deferrals: { tattoo: 400 } } });
  assert.equal(saved.__status, 200, JSON.stringify(saved));

  const donor = await as(U.BLOOD, "/ward/blood-donor", "POST", { orgId: ORG, name: "Meena", sex: "female", dateOfBirth: "1992-02-02" });
  const base = { orgId: ORG, donorId: donor.donorId, ...V, answers: NO, weightKg: 55, hbGdl: 13.2, outcome: "eligible" };
  const low = await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, hbGdl: 12.8 });
  assert.deepEqual(low.failures, ["haemoglobin"], "12.8 meets India's 12.5 but not this hospital's 13");
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, bp: "" })).error, "bp_required");
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, pulseRegular: null })).error, "pulse_required");
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, temperature: "" })).error, "temperature_required");
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, donationType: "apheresis-platelets" })).error, "apheresis_lab_required");
  const tattoo = { ...base, answers: { ...NO, tattoo: true }, outcome: "deferred" };
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { ...tattoo, deferralReason: "Tattoo", deferralDays: 30 })).error, "deferral_condition_required", "a yes is deferred against its condition, not a typed number");
  assert.equal((await as(U.BLOOD, "/ward/donor-screening", "POST", { ...tattoo, deferralConditions: [{ condition: "other" }], deferralDays: 30 })).error, "deferral_condition_required");
  assert.equal((await recordsOf("DonorScreening")).length, 0, "every refusal wrote nothing");
  const def = await as(U.BLOOD, "/ward/donor-screening", "POST", { ...tattoo, deferralConditions: [{ condition: "tattoo", since: ago(10).slice(0, 10) }], deferralDays: 30 });
  assert.equal(def.__status, 200, JSON.stringify(def));
  assert.equal(def.deferredUntil, new Date(Date.parse(ago(10).slice(0, 10)) + 400 * 86400000).toISOString(), "this hospital's 400 days, not the 30 typed");
  assert.equal(def.deferralConditions[0].days, 400);

  const other = await as(U.BLOOD, "/ward/blood-donor", "POST", { orgId: ORG, name: "Ravi", sex: "male", dateOfBirth: "1990-03-03" });
  const ok = await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, donorId: other.donorId, hbGdl: 14, hbMethod: "venous-analyser" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal((await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, donorKind: "voluntary", anticoagulant: "cpda", screeningId: ok.screeningId, bagNumber: "BAG-55", volumeMl: 450 })).error, "weight_below_450", "55 kg is not more than 55 kg");
  assert.equal((await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, donorKind: "voluntary", anticoagulant: "cpda", screeningId: ok.screeningId, bagNumber: "BAG-35", volumeMl: 350 })).__status, 200);
  const rec = (await recordsOf("DonorScreening")).find((s) => s.id === ok.screeningId);
  assert.equal(rec.criteriaInForce.jurisdiction, "IN"); assert.equal(rec.criteriaInForce.values.minHbFemale, 13); assert.equal(rec.hbMethod, "venous-analyser");

  const aph = await as(U.BLOOD, "/ward/blood-donor", "POST", { orgId: ORG, name: "Arun", sex: "male", dateOfBirth: "1988-04-04" });
  const plt = await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, donorId: aph.donorId, weightKg: 60, hbGdl: 14, donationType: "apheresis-platelets", plateletCount: 220 });
  assert.equal(plt.__status, 200, JSON.stringify(plt));
  assert.equal((await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, donorKind: "voluntary", anticoagulant: "cpda", screeningId: plt.screeningId, bagNumber: "APH-1", volumeMl: 300 })).error, "reinfusion_required");
  assert.equal((await as(U.BLOOD, "/ward/blood-donation", "POST", { orgId: ORG, donorKind: "voluntary", anticoagulant: "cpda", screeningId: plt.screeningId, bagNumber: "APH-1", volumeMl: 300, reinfusionComplete: false })).__status, 200);
  const again = await as(U.BLOOD, "/ward/donor-screening", "POST", { ...base, donorId: aph.donorId, weightKg: 60, hbGdl: 14 });
  assert.deepEqual(again.failures, ["after-apheresis"], "whole blood waits 90 days after red cells were not all returned");
  const view = await as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);
  assert.equal(view.criteria.sources.minHbFemale.source, "hospital");
  assert.equal(view.criteria.deferrals.tattoo.days, 400);
  assert.equal(view.donations.find((x) => x.bagNumber === "APH-1").donationType, "apheresis-platelets");
});

test("a physician's discretion past the age limit is WHO's and only where no law states the limit: POST /ward/donor-screening in a hospital outside India", async () => {
  seedHospital();
  const upd = await as(U.ADMIN, "/org/update", "POST", { orgId: ORG, name: "WSQ Ward Hospital", region: "US" });
  assert.equal(upd.__status, 200, JSON.stringify(upd));
  const older = await as(U.BLOOD, "/ward/blood-donor", "POST", { orgId: ORG, name: "Ramesh", sex: "male", dateOfBirth: "1963-01-01" });
  const { "foreign-resident": _skip, ...answers } = NO;
  const first = { orgId: ORG, donorId: older.donorId, answers, weightKg: 70, hbGdl: 14, outcome: "eligible" };
  const refused = await as(U.BLOOD, "/ward/donor-screening", "POST", first);
  assert.equal(refused.error, "physician_discretion_required", JSON.stringify(refused)); assert.deepEqual(refused.failures, ["first-time-age"]);
  const accepted = await as(U.BLOOD, "/ward/donor-screening", "POST", { ...first, physicianName: "Dr Rao", physicianReason: "Fit, regular donor elsewhere" });
  assert.equal(accepted.__status, 200, JSON.stringify(accepted));
  const r2 = (await recordsOf("DonorScreening")).find((s) => s.id === accepted.screeningId);
  assert.deepEqual(r2.physicianDiscretion, { name: "Dr Rao", reason: "Fit, regular donor elsewhere", failures: ["first-time-age"] });
});

