/* test/wardsynq-blood-centre.test.mjs - a licensed blood centre after collection (legal opinion 2026-09-17, section G):
 * component shelf lives and storage by anticoagulant and additive, the 6-hour separation and freezing limits, pooling,
 * the mandatory tests with their methods, the irregular antibody screen and NAT, the label, the sample register with its
 * 7-day retention, the confidential notification of a reactive donor, look-back, records withheld from ward readers,
 * and a blood price refused on the tariff.
 *
 * Routes: POST /api/queue/ward/blood-donation, /ward/blood-components, /ward/blood-test-result, /ward/blood-pool,
 * /ward/blood-sample, /ward/blood-sample-discard, /ward/donor-notification, /ward/transfusion-crossmatch,
 * GET /ward/blood-bank, /ward/record-detail, POST /org/blood-centre-settings.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-blood-centre.test.mjs
 */
import { as, seedHospital, recordsOf, auditsOf, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { donationTests, unitTests, samplesOf, lookbackOf } from "../functions/_wardsynq/blood-bank.js";
import { shelfFor, storageText, validateBloodCentreSettings, bloodCentreSettings, sampleRetainUntil, COMPONENT_RULES, GROUP_COLOURS } from "../functions/_wardsynq/blood-centre-rules.js";
import { bloodCentreOnlyReadable, RecordService } from "../functions/_wardsynq/service.js";
import { makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { H, TENANT } from "./wardsynq-ops-harness.mjs";
import { validateTariff } from "../functions/_clinic_billing.js";

const H1 = 3600000, D1 = 24 * H1;
const NO = { illness: false, "infection-history": false, malaria: false, jaundice: false, tattoo: false, transfusion: false, surgery: false, pregnancy: false, "high-risk": false,
  "chronic-disease": false, vaccination: false, medication: false, harvest: false, "pre-donation": false, "foreign-resident": false };
const V = { bp: "120/80", pulse: 72, pulseRegular: true, temperature: 36.8 };
const CLEAR = { hiv: "non-reactive", hbv: "non-reactive", hcv: "non-reactive", syphilis: "non-reactive", malaria: "non-reactive" };
const LAB = { methods: { hiv: "elisa", hbv: "clia", hcv: "elisa", syphilis: "vdrl", malaria: "smear" }, antibodyScreen: "negative" };
const post = (who, path, body) => as(who, path, "POST", { orgId: ORG, ...body });
const bank = async () => as(U.BLOOD, `/ward/blood-bank?orgId=${ORG}`);

/* A donor screened eligible and bled: returns the donation record as stored. */
async function bleed(bag, extra, sex = "male") {
  const donor = await post(U.BLOOD, "/ward/blood-donor", { name: "Donor " + bag, sex, dateOfBirth: "1990-05-01" });
  const scr = await post(U.BLOOD, "/ward/donor-screening", { donorId: donor.donorId, ...V, answers: NO, weightKg: 70, hbGdl: 14, outcome: "eligible" });
  assert.equal(scr.__status, 200, JSON.stringify(scr));
  const don = await post(U.BLOOD, "/ward/blood-donation", { screeningId: scr.screeningId, bagNumber: bag, volumeMl: 450, donorKind: "voluntary", anticoagulant: "cpda", ...(extra || {}) });
  assert.equal(don.__status, 200, JSON.stringify(don));
  return { donorId: donor.donorId, screeningId: scr.screeningId, ...(await recordsOf("BloodDonation")).find((d) => d.id === don.donationId) };
}
const at = (iso, hours) => new Date(Date.parse(iso) + hours * H1).toISOString();

test("rules: shelf life by component, anticoagulant and additive; storage words; settings only stricter; retain-until; group colours; blood is not for sale", () => {
  assert.equal(shelfFor("whole-blood", { anticoagulant: "acd" }).hours, 21 * 24, "Schedule P item 7(a)");
  assert.equal(shelfFor("whole-blood", { anticoagulant: "cpda" }).hours, 35 * 24, "item 7(b)");
  assert.equal(shelfFor("whole-blood", {}).hours, 21 * 24, "an unrecorded anticoagulant is held to the shorter");
  assert.equal(shelfFor("prbc", { additive: "sagm", anticoagulant: "cpda" }).hours, 42 * 24);
  assert.deepEqual([shelfFor("prbc", { additive: "none", anticoagulant: "cpda" }).hours, shelfFor("prbc", { additive: "none", anticoagulant: "acd" }).hours], [35 * 24, 21 * 24], "no additive: never past the whole blood limit");
  assert.deepEqual(["platelets", "ffp", "cryo", "granulocytes"].map((c) => shelfFor(c, {}).hours), [120, 8760, 8760, 24]);
  assert.equal(shelfFor("platelets", { pooledOpen: true }).hours, 6);
  assert.deepEqual([shelfFor("platelets", {}, { platelets: 72 }).hours, shelfFor("platelets", {}, { platelets: 500 }).hours], [72, 120], "a hospital shortens, never lengthens");
  assert.equal(shelfFor("blood", {}), null);
  assert.equal(storageText(COMPONENT_RULES.platelets.storage), "20 to 24 C with continuous gentle agitation");
  assert.deepEqual([storageText(COMPONENT_RULES.ffp.storage), storageText(COMPONENT_RULES["whole-blood"].storage), storageText(COMPONENT_RULES.prbc.storage)], ["-30 C or colder", "4 to 6 C", "2 to 6 C"]);
  const v = validateBloodCentreSettings({ natRequired: "yes", sampleRetentionDays: 6, recordRetentionYears: 4, shelfHours: { ffp: 9000, platelets: 120 } });
  assert.deepEqual(Object.keys(v.errors).sort(), ["natRequired", "recordRetentionYears", "sampleRetentionDays", "shelfHours.ffp"]);
  assert.deepEqual(v.value, {}, "a value equal to the Rules is not stored");
  assert.deepEqual(bloodCentreSettings({ bloodCentre: { sampleRetentionDays: 3, recordRetentionYears: 2 } }), { natRequired: false, shelfHours: {}, sampleRetentionDays: 7, recordRetentionYears: 5, saved: {} }, "a looser value stored outside the screen is ignored");
  assert.equal(sampleRetainUntil(["2026-09-01T00:00:00.000Z", "2026-09-03T00:00:00.000Z"], 7), "2026-09-10T00:00:00.000Z");
  assert.equal(sampleRetainUntil(["2026-09-01T00:00:00.000Z", null], 7), null, "a unit still in the blood centre keeps the sample");
  assert.equal(sampleRetainUntil([], 7), null);
  assert.deepEqual(GROUP_COLOURS, { O: "blue", A: "yellow", B: "pink", AB: "white" });
  for (const n of ["Price of blood", "Blood unit price", "Cost of packed red cells", "Sale of plasma"]) assert.equal(validateTariff({ name: n, price: 100 }).error, "blood_not_for_sale", n);
  for (const n of ["Blood processing charge (NBTC)", "PRBC processing charge", "Platelet count", "Plasma glucose", "Complete blood count"]) assert.equal(validateTariff({ name: n, price: 100 }).ok, true, n);
});

test("tests, pools, samples and look-back, pure: a retest never clears a reactive donation; NAT when required; a pool is as its worst donation; a sample is kept while its units are here", () => {
  const r = (donationId, tti, extra, atIso) => ({ donationId, tti, abo: "O", rhD: "positive", at: atIso, ...LAB, ...(extra || {}) });
  assert.equal(donationTests("d", [r("d", { ...CLEAR, hiv: "reactive" }, null, "1"), r("d", CLEAR, null, "2")]).state, "reactive", "a retest is appended, never a clearance");
  assert.equal(donationTests("d", [r("d", CLEAR, null, "1")], { natRequired: true }).state, "incomplete");
  assert.equal(donationTests("d", [r("d", CLEAR, { nat: "non-reactive" }, "1")], { natRequired: true }).state, "cleared");
  assert.deepEqual(donationTests("d", [r("d", CLEAR, { nat: "reactive" }, "1")]).reactive, ["nat"], "a reactive NAT discards even where NAT is optional");
  assert.equal(donationTests("d", [r("d", { hiv: "non-reactive" }, null, "1")]).state, "incomplete");
  const res = [r("a", CLEAR, null, "1"), r("b", CLEAR, null, "1"), r("c", { ...CLEAR, malaria: "reactive" }, null, "1"), { ...r("e", CLEAR, null, "1"), abo: "A" }];
  assert.equal(unitTests({ donationIds: ["a", "b"] }, res).state, "cleared");
  assert.equal(unitTests({ donationIds: ["a", "c"] }, res).state, "reactive");
  assert.equal(unitTests({ donationIds: ["a", "e"] }, res).group, null, "a pool of two groups has no group, so it never clears");

  const units = [
    { unitId: "u1", donationIds: ["d1"], status: "issued", issuedAt: "2026-09-01T00:00:00.000Z" },
    { unitId: "u2", donationIds: ["d1"], status: "discarded", discardedAt: "2026-09-02T00:00:00.000Z" },
    { unitId: "u3", donationIds: ["d2"], status: "pooled", poolUnitId: "p1" },
    { unitId: "p1", donationIds: ["d2", "d3"], status: "issued", issuedAt: "2026-09-05T00:00:00.000Z" },
    { unitId: "u4", donationIds: ["d3"], status: "available" },
  ];
  const s = samplesOf([{ id: "s1", kind: "donor-pilot", donationId: "d1" }, { id: "s2", kind: "donor-pilot", donationId: "d2" }, { id: "s3", kind: "donor-pilot", donationId: "d3" },
    { id: "s4", kind: "recipient", episodeId: "e1" }, { id: "s5", kind: "recipient", episodeId: "e2" }], units,
  [{ id: "e1", phase: "completed", ledger: [{ event: "issued", at: "2026-09-04T00:00:00.000Z" }] }, { id: "e2", phase: "crossmatched", ledger: [] }], 7, "2026-09-10T00:00:00.000Z");
  assert.deepEqual(s.map((x) => [x.retainUntil, x.state]), [["2026-09-09T00:00:00.000Z", "may-discard"], ["2026-09-12T00:00:00.000Z", "retain"], [null, "retain"], ["2026-09-11T00:00:00.000Z", "retain"], [null, "retain"]]);

  const lb = lookbackOf([{ unitNumber: "BAG-1-PRBC", component: "prbc", donationIds: ["d1"], status: "issued", episodeId: "e1" }, { unitNumber: "BAG-2-PRBC", component: "prbc", donationIds: ["d2"], status: "quarantine" }],
    [{ id: "d1", bagNumber: "BAG-1", donorId: "dn", collectedAt: "2026-01-01" }, { id: "d2", bagNumber: "BAG-2", donorId: "dn", collectedAt: "2026-06-01" }], [{ id: "dn", donorNumber: "D-9" }],
    [{ id: "e1", patientMrn: "MRN-1", reaction: { at: "2026-01-05", detail: "Fever", unitId: "bag-1-prbc" } }], [r("d1", CLEAR, null, "1"), r("d2", { ...CLEAR, hcv: "reactive" }, null, "2")]);
  assert.deepEqual(lb.reactions.map((x) => [x.unitNumber, x.patientMrn, x.donations[0].donorNumber, x.detail]), [["BAG-1-PRBC", "MRN-1", "D-9", "Fever"]]);
  assert.deepEqual(lb.recall.map((x) => [x.bagNumber, x.reactive, x.earlier.map((e) => [e.bagNumber, e.units.map((u) => [u.unitNumber, u.status, u.patientMrn])])]), [["BAG-2", ["hcv"], [["BAG-1", [["BAG-1-PRBC", "issued", "MRN-1"]]]]]]);

  assert.equal(bloodCentreOnlyReadable({ scope: { read: null } }, "BloodTestResult"), false, "a role that reads every type does not read infection results");
  assert.equal(bloodCentreOnlyReadable({ scope: { read: ["BloodTestResult"] } }, "BloodTestResult"), true);
  assert.equal(bloodCentreOnlyReadable({ scope: { read: null } }, "BloodUnit"), true);
});

test("POST /api/queue/ward/blood-donation and /ward/blood-components: donor kind and anticoagulant recorded; expiry worked out from collection, anticoagulant and additive; never later than the Rules; storage from the Rules; the 6-hour limits", async (t) => {
  seedHospital();
  const donor = await post(U.BLOOD, "/ward/blood-donor", { name: "Kiran", sex: "male", dateOfBirth: "1991-01-01" });
  const scr = await post(U.BLOOD, "/ward/donor-screening", { donorId: donor.donorId, ...V, answers: NO, weightKg: 70, hbGdl: 14, outcome: "eligible" });
  assert.equal((await post(U.BLOOD, "/ward/blood-donation", { screeningId: scr.screeningId, bagNumber: "K1", volumeMl: 450, anticoagulant: "cpda" })).error, "donor_kind_required");
  assert.equal((await post(U.BLOOD, "/ward/blood-donation", { screeningId: scr.screeningId, bagNumber: "K1", volumeMl: 450, donorKind: "replacement" })).error, "anticoagulant_required");
  assert.equal((await recordsOf("BloodDonation")).length, 0);
  assert.equal((await post(U.BLOOD, "/ward/blood-donation", { screeningId: scr.screeningId, bagNumber: "K1", volumeMl: 450, donorKind: "replacement", anticoagulant: "acd" })).__status, 200);
  const acd = (await recordsOf("BloodDonation"))[0];
  assert.deepEqual([acd.donorKind, acd.anticoagulant], ["replacement", "acd"]);

  const wb = await post(U.BLOOD, "/ward/blood-components", { donationId: acd.id, components: [{ component: "whole-blood", volumeMl: 450 }] });
  assert.equal(wb.__status, 200, JSON.stringify(wb));
  let unit = (await recordsOf("BloodUnit")).find((u) => u.component === "whole-blood");
  assert.equal(unit.expiresAt, at(acd.collectedAt, 21 * 24), "ACD whole blood: 21 days from collection");
  assert.deepEqual([unit.storage, unit.storageRange, unit.shelfBasis], ["4 to 6 C", { minC: 4, maxC: 6 }, "anticoagulant-acd"]);

  const cpda = await bleed("C1");
  const refuse = async (components, error) => {
    const n = (await recordsOf("BloodUnit")).length, r = await post(U.BLOOD, "/ward/blood-components", { donationId: cpda.id, components });
    assert.equal(r.error, error, JSON.stringify(r)); assert.equal((await recordsOf("BloodUnit")).length, n, "nothing written");
  };
  await refuse([{ component: "prbc", volumeMl: 280 }], "additive_required");
  await refuse([{ component: "prbc", volumeMl: 280, additive: "sagm", expiresAt: at(cpda.collectedAt, 42 * 24 + 1) }], "expiry_beyond_shelf_life");
  await refuse([{ component: "platelets", volumeMl: 50, preparedAt: at(cpda.collectedAt, -1) }], "prepared_at_invalid");
  const ok = await post(U.BLOOD, "/ward/blood-components", { donationId: cpda.id, components: [
    { component: "prbc", volumeMl: 280, additive: "sagm" }, { component: "ffp", volumeMl: 220 }, { component: "platelets", volumeMl: 50, expiresAt: at(cpda.collectedAt, 48) }, { component: "cryo", volumeMl: 20 }] });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const by = Object.fromEntries((await recordsOf("BloodUnit")).filter((u) => u.donationId === cpda.id).map((u) => [u.component, u]));
  assert.equal(by.prbc.expiresAt, at(cpda.collectedAt, 42 * 24), "red cells in SAGM: 42 days");
  assert.deepEqual([by.ffp.expiresAt, by.ffp.storage], [at(cpda.collectedAt, 365 * 24), "-30 C or colder"]);
  assert.deepEqual([by.platelets.expiresAt, by.platelets.storage], [at(cpda.collectedAt, 48), "20 to 24 C with continuous gentle agitation"], "an earlier label expiry is kept");
  assert.equal(by.cryo.expiresAt, at(cpda.collectedAt, 365 * 24));
  const none = await bleed("C2");
  assert.equal((await post(U.BLOOD, "/ward/blood-components", { donationId: none.id, components: [{ component: "prbc", volumeMl: 300, additive: "none" }] })).__status, 200);
  assert.equal((await recordsOf("BloodUnit")).find((u) => u.donationId === none.id).expiresAt, at(none.collectedAt, 35 * 24), "no additive: the CPDA whole blood limit");

  // The hospital's shorter platelet shelf life reaches separation.
  assert.equal((await post(U.ADMIN, "/org/blood-centre-settings", { settings: { shelfHours: { platelets: 72 } } })).__status, 200);
  const short = await bleed("C3");
  assert.equal((await post(U.BLOOD, "/ward/blood-components", { donationId: short.id, components: [{ component: "platelets", volumeMl: 50 }, { component: "granulocytes", volumeMl: 200 }] })).__status, 200);
  const s3 = (await recordsOf("BloodUnit")).filter((u) => u.donationId === short.id);
  assert.equal(s3.find((u) => u.component === "platelets").expiresAt, at(short.collectedAt, 72));
  assert.equal(s3.find((u) => u.component === "granulocytes").expiresAt, at(short.collectedAt, 24));

  // Seven hours after collection: plasma is no longer fresh frozen, and platelets are not separated from whole blood.
  const late = await bleed("C4");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(late.collectedAt) + 7 * H1 });
  await (async () => {
    const r1 = await post(U.BLOOD, "/ward/blood-components", { donationId: late.id, components: [{ component: "ffp", volumeMl: 220 }] });
    assert.equal(r1.error, "prepared_too_late", JSON.stringify(r1));
    assert.equal((await post(U.BLOOD, "/ward/blood-components", { donationId: late.id, components: [{ component: "platelets", volumeMl: 50 }] })).error, "prepared_too_late");
    const r2 = await post(U.BLOOD, "/ward/blood-components", { donationId: late.id, components: [{ component: "ffp", volumeMl: 220, preparedAt: at(late.collectedAt, 5) }] });
    assert.equal(r2.__status, 200, "frozen within 6 hours, recorded later: " + JSON.stringify(r2));
  })();
  t.mock.timers.reset();
});

test("POST /api/queue/ward/blood-test-result: the method of each test, the antibody screen, NAT when the hospital requires it; the label carries results and the group colour; a reactive unit is only 'not available' at the ward's crossmatch; its records never leave the blood centre", async () => {
  seedHospital();
  const a = await bleed("T1");
  await post(U.BLOOD, "/ward/blood-components", { donationId: a.id, components: [{ component: "prbc", volumeMl: 280, additive: "sagm" }] });
  const send = (extra) => post(U.BLOOD, "/ward/blood-test-result", { donationId: a.id, tti: CLEAR, abo: "O", rhD: "positive", ...LAB, ...extra });
  assert.equal((await send({ methods: { ...LAB.methods, syphilis: "" } })).error, "method_required");
  assert.equal((await send({ methods: { ...LAB.methods, malaria: "guess" } })).error, "method_required");
  assert.equal((await send({ antibodyScreen: "" })).error, "antibody_screen_required");
  assert.equal((await send({ antibodyScreen: "positive" })).error, "antibody_identity_required");
  assert.equal((await send({ nat: "non-reactive" })).error, "method_required", "a NAT result names its method");
  assert.equal((await recordsOf("BloodTestResult")).length, 0, "every refusal wrote nothing");

  assert.equal((await post(U.ADMIN, "/org/blood-centre-settings", { settings: { natRequired: true } })).__status, 200);
  assert.equal((await send({})).error, "nat_required");
  const ok = await send({ nat: "non-reactive", methods: { ...LAB.methods, nat: "id-nat" }, antibodyScreen: "positive", antibodyIdentified: "anti-M" });
  assert.equal(ok.__status, 200, JSON.stringify(ok)); assert.equal(ok.state, "cleared");
  const view = await bank();
  const u = view.units.find((x) => x.donationIds.includes(a.id));
  assert.equal(u.status, "available");
  assert.equal(u.label.colour, "blue", "group O is blue");
  assert.deepEqual([u.label.tests[0].methods.syphilis, u.label.tests[0].nat, u.label.tests[0].antibodyIdentified, u.antibodyScreen], ["vdrl", "non-reactive", "anti-M", "positive"]);
  assert.equal(view.centre.natRequired, true);

  // NAT made optional again: an earlier donation tested without it is released; one tested with a reactive NAT is not.
  const b = await bleed("T2");
  await post(U.BLOOD, "/ward/blood-components", { donationId: b.id, components: [{ component: "prbc", volumeMl: 280, additive: "sagm" }] });
  const hbv = await post(U.BLOOD, "/ward/blood-test-result", { donationId: b.id, tti: { ...CLEAR, hbv: "reactive" }, abo: "B", rhD: "positive", ...LAB, nat: "reactive", methods: { ...LAB.methods, nat: "minipool-nat" } });
  assert.deepEqual([hbv.state, hbv.reactive], ["reactive", ["hbv", "nat"]]);
  const retest = await post(U.BLOOD, "/ward/blood-test-result", { donationId: b.id, tti: CLEAR, abo: "B", rhD: "positive", ...LAB, nat: "non-reactive", methods: { ...LAB.methods, nat: "id-nat" } });
  assert.equal(retest.state, "reactive", "a retest never clears a reactive donation");
  const rb = (await bank()).units.find((x) => x.donationIds.includes(b.id));
  assert.equal(rb.status, "reactive"); assert.equal(rb.label, undefined, "no label for a unit that may not be issued");

  const reg = await post(U.DOCTOR, "/patient/register", { name: "Ward Patient", mobile: "9876522299", gender: "male", ageYears: 40 });
  const adm = await post(U.DOCTOR, "/ward/admit", { mrn: reg.mrn, ward: "Medical A", bed: "2" });
  const req = await post(U.DOCTOR, "/ward/transfusion-request", { patientId: adm.patientId, mrn: reg.mrn, component: "red-cells", units: 1, aboGroup: "B", rhD: "positive" });
  assert.equal(req.__status, 200, JSON.stringify(req));
  const xm = await post(U.DOCTOR, "/ward/transfusion-crossmatch", { episodeId: req.episodeId, unitId: rb.unitNumber, component: "red-cells" });
  assert.equal(xm.__status, 409); assert.equal(xm.code, "UNIT_NOT_AVAILABLE"); assert.equal(xm.unitStatus, "not available");
  assert.doesNotMatch(JSON.stringify(xm), /reactive|hbv|hepatitis/i, "a ward never learns that a unit is reactive");

  const result = (await recordsOf("BloodTestResult"))[0], screening = (await recordsOf("DonorScreening"))[0], unitRec = (await recordsOf("BloodUnit"))[0];
  for (const [type, id] of [["BloodTestResult", result.id], ["DonorScreening", screening.id]]) {
    const r = await as(U.DOCTOR, `/ward/record-detail?orgId=${ORG}&type=${type}&id=${encodeURIComponent(id)}`);
    assert.equal(r.__status, 403, `${type}: ${JSON.stringify(r)}`); assert.equal(r.record, null);
  }
  assert.equal((await as(U.DOCTOR, `/ward/record-detail?orgId=${ORG}&type=BloodUnit&id=${encodeURIComponent(unitRec.id)}`)).__status, 200, "a unit's own record is not withheld");
});

test("POST /api/queue/ward/blood-pool: 401, 403 for a nurse and another hospital with nothing written; one group only; a closed pool keeps the soonest expiry, an open one 6 hours; its units leave the shelf", async () => {
  seedHospital();
  const plt = [];
  for (const [bag, abo] of [["P1", "O"], ["P2", "O"], ["P3", "A"]]) {
    const d = await bleed(bag);
    await post(U.BLOOD, "/ward/blood-components", { donationId: d.id, components: [{ component: "platelets", volumeMl: 50, expiresAt: at(d.collectedAt, bag === "P2" ? 30 : 100) }, { component: "cryo", volumeMl: 20 }] });
    await post(U.BLOOD, "/ward/blood-test-result", { donationId: d.id, tti: CLEAR, abo, rhD: "positive", ...LAB });
  }
  const units = (await bank()).units, pick = (bag, c) => units.find((u) => u.bagNumber === bag && u.component === c).unitId;
  const body = { unitIds: [pick("P1", "platelets"), pick("P2", "platelets")], component: "platelets", openSystem: false };
  const count = async () => (await recordsOf("BloodUnit")).length, n = await count();
  assert.equal((await as(null, "/ward/blood-pool", "POST", { orgId: ORG, ...body })).__status, 401);
  assert.equal((await post(U.NURSE, "/ward/blood-pool", body)).__status, 403);
  assert.equal((await as(U.BLOOD, "/ward/blood-pool", "POST", { orgId: ORG2, ...body })).__status, 403);
  assert.equal((await post(U.BLOOD, "/ward/blood-pool", { ...body, unitIds: [pick("P1", "platelets"), pick("P3", "platelets")] })).error, "group_mixed");
  assert.equal((await post(U.BLOOD, "/ward/blood-pool", { ...body, unitIds: [pick("P1", "platelets")] })).error, "units_required");
  assert.equal((await post(U.BLOOD, "/ward/blood-pool", { ...body, openSystem: undefined })).error, "open_system_required");
  assert.equal((await post(U.BLOOD, "/ward/blood-pool", { ...body, unitIds: [pick("P1", "platelets"), pick("P2", "cryo")] })).error, "unit_not_poolable");
  assert.equal(await count(), n, "nothing written");

  const closed = await post(U.BLOOD, "/ward/blood-pool", body);
  assert.equal(closed.__status, 200, JSON.stringify(closed));
  assert.equal(closed.expiresAt, units.find((u) => u.unitId === pick("P2", "platelets")).expiresAt, "a closed pool keeps its soonest expiry");
  assert.ok(auditsOf("BloodUnit").length > 0);
  const before = Date.now();
  const openPool = await post(U.BLOOD, "/ward/blood-pool", { unitIds: [pick("P1", "cryo"), pick("P2", "cryo")], component: "cryo", openSystem: true });
  assert.equal(openPool.__status, 200, JSON.stringify(openPool));
  const hours = (Date.parse(openPool.expiresAt) - before) / H1;
  assert.ok(hours > 5.9 && hours <= 6.01, `open pool: 6 hours, got ${hours}`);

  const view = await bank();
  assert.deepEqual(view.units.filter((u) => ["P1", "P2"].includes(u.bagNumber)).map((u) => u.status), ["pooled", "pooled", "pooled", "pooled"]);
  const pool = view.units.find((u) => u.unitNumber === closed.unitNumber);
  assert.deepEqual([pool.status, pool.abo, pool.donationIds.length, pool.pooled, pool.label.colour], ["available", "O", 2, true, "blue"]);
  assert.equal((await post(U.BLOOD, "/ward/blood-unit-event", { unitId: pick("P1", "platelets"), kind: "discard", reason: "x" })).error, "unit_not_discardable", "a pooled unit is discarded as its pool");
  assert.equal((await post(U.BLOOD, "/ward/blood-pool", body)).error, "unit_not_poolable", "a unit is pooled once");
});

test("POST /api/queue/ward/blood-sample and /ward/blood-sample-discard: 401, 403 nurse and another hospital; the discard log refuses a sample still needed and accepts it 7 days after its units left", async (t) => {
  seedHospital();
  const d = await bleed("S1");
  await post(U.BLOOD, "/ward/blood-components", { donationId: d.id, components: [{ component: "prbc", volumeMl: 280, additive: "sagm" }] });
  const body = { kind: "donor-pilot", donationId: d.id, location: "Sample fridge 2, rack B" };
  assert.equal((await as(null, "/ward/blood-sample", "POST", { orgId: ORG, ...body })).__status, 401);
  assert.equal((await post(U.NURSE, "/ward/blood-sample", body)).__status, 403);
  assert.equal((await as(U.BLOOD, "/ward/blood-sample", "POST", { orgId: ORG2, ...body })).__status, 403);
  assert.equal((await post(U.BLOOD, "/ward/blood-sample", { ...body, location: "" })).error, "location_required");
  assert.equal((await post(U.BLOOD, "/ward/blood-sample", { ...body, donationId: "nope" })).__status, 404);
  assert.equal((await recordsOf("BloodSample")).length, 0);
  const reg = await post(U.BLOOD, "/ward/blood-sample", body);
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.equal((await post(U.BLOOD, "/ward/blood-sample", body)).error, "sample_exists");

  const discard = { sampleId: reg.sampleId };
  assert.equal((await as(null, "/ward/blood-sample-discard", "POST", { orgId: ORG, ...discard })).__status, 401);
  assert.equal((await post(U.NURSE, "/ward/blood-sample-discard", discard)).__status, 403);
  assert.equal((await as(U.BLOOD, "/ward/blood-sample-discard", "POST", { orgId: ORG2, ...discard })).__status, 403);
  const onShelf = await post(U.BLOOD, "/ward/blood-sample-discard", discard);
  assert.deepEqual([onShelf.__status, onShelf.error, onShelf.retainUntil], [409, "sample_retention_running", null], "its unit is still in quarantine");
  const unit = (await bank()).units.find((u) => u.bagNumber === "S1");
  assert.equal((await post(U.BLOOD, "/ward/blood-unit-event", { unitId: unit.unitId, kind: "discard", reason: "Leaking bag" })).__status, 200);
  const running = await post(U.BLOOD, "/ward/blood-sample-discard", discard);
  assert.equal(running.error, "sample_retention_running");
  assert.ok(Date.parse(running.retainUntil) > Date.now() + 6.9 * D1, running.retainUntil);
  assert.ok(!(await recordsOf("BloodSample"))[0].discardedAt, "nothing written");

  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(running.retainUntil) + H1 });
  const done = await post(U.BLOOD, "/ward/blood-sample-discard", discard);
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal((await post(U.BLOOD, "/ward/blood-sample-discard", discard)).error, "sample_discarded");
  const s = (await bank()).samples[0];
  t.mock.timers.reset();
  assert.deepEqual([s.state, s.location, s.retainUntil], ["discarded", "Sample fridge 2, rack B", running.retainUntil]);
  assert.ok(auditsOf("BloodSample").length >= 2);
});

test("POST /api/queue/ward/donor-notification: 401, 403 nurse and another hospital; only for a reactive donation; each step recorded for the blood centre; look-back names the donor's earlier units and where they went", async (t) => {
  seedHospital();
  const first = await bleed("N1");
  await post(U.BLOOD, "/ward/blood-components", { donationId: first.id, components: [{ component: "prbc", volumeMl: 280, additive: "sagm" }] });
  await post(U.BLOOD, "/ward/blood-test-result", { donationId: first.id, tti: CLEAR, abo: "O", rhD: "negative", ...LAB });
  const unit = (await bank()).units.find((u) => u.bagNumber === "N1");
  const reg = await post(U.DOCTOR, "/patient/register", { name: "Recipient One", mobile: "9876522288", gender: "female", ageYears: 30 });
  const adm = await post(U.DOCTOR, "/ward/admit", { mrn: reg.mrn, ward: "Medical A", bed: "3" });
  const req = await post(U.DOCTOR, "/ward/transfusion-request", { patientId: adm.patientId, mrn: reg.mrn, component: "red-cells", units: 1, aboGroup: "O", rhD: "negative" });
  assert.equal((await post(U.BLOOD, "/ward/transfusion-crossmatch", { episodeId: req.episodeId, unitId: unit.unitNumber, component: "red-cells" })).__status, 200);
  assert.equal((await post(U.BLOOD, "/ward/transfusion-issue", { episodeId: req.episodeId })).__status, 200);
  assert.equal((await post(U.BLOOD, "/ward/blood-sample", { kind: "recipient", episodeId: req.episodeId, location: "Rack C" })).__status, 200);
  assert.equal((await post(U.BLOOD, "/ward/donor-notification", { donationId: first.id, step: "notified", method: "phone" })).error, "donation_not_reactive");

  // The same donor 100 days later tests HCV reactive.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 * D1 });
  const scr = await post(U.BLOOD, "/ward/donor-screening", { donorId: first.donorId, ...V, answers: NO, weightKg: 70, hbGdl: 14, outcome: "eligible" });
  assert.equal(scr.__status, 200, JSON.stringify(scr));
  const second = await post(U.BLOOD, "/ward/blood-donation", { screeningId: scr.screeningId, bagNumber: "N2", volumeMl: 450, donorKind: "voluntary", anticoagulant: "cpda" });
  assert.equal((await post(U.BLOOD, "/ward/blood-test-result", { donationId: second.donationId, tti: { ...CLEAR, hcv: "reactive" }, abo: "O", rhD: "negative", ...LAB })).state, "reactive");

  const step = { donationId: second.donationId, step: "notified", method: "in-person" };
  assert.equal((await as(null, "/ward/donor-notification", "POST", { orgId: ORG, ...step })).__status, 401);
  assert.equal((await post(U.NURSE, "/ward/donor-notification", step)).__status, 403);
  assert.equal((await post(U.DOCTOR, "/ward/donor-notification", step)).__status, 403, "a ward doctor is not part of the confidential workflow");
  assert.equal((await as(U.BLOOD, "/ward/donor-notification", "POST", { orgId: ORG2, ...step })).__status, 403);
  assert.equal((await post(U.BLOOD, "/ward/donor-notification", { ...step, method: "" })).error, "method_required");
  assert.equal((await post(U.BLOOD, "/ward/donor-notification", { donationId: second.donationId, step: "referred" })).error, "referral_required");
  assert.equal((await recordsOf("DonorNotification")).length, 0);
  assert.equal((await post(U.BLOOD, "/ward/donor-notification", step)).__status, 200);
  t.mock.timers.tick(60000); // the mocked clock stands still; the steps are a minute apart
  assert.equal((await post(U.BLOOD, "/ward/donor-notification", { donationId: second.donationId, step: "referred", referredTo: "ICTC, District Hospital" })).__status, 200);
  const view = await bank();
  t.mock.timers.reset();
  assert.deepEqual(view.notifications.map((n) => [n.bagNumber, n.reactive, n.steps.map((s) => [s.step, s.method, s.referredTo])]), [["N2", ["hcv"], [["notified", "in-person", null], ["referred", null, "ICTC, District Hospital"]]]]);
  assert.deepEqual(view.lookback.recall.map((r) => [r.bagNumber, r.earlier.map((e) => [e.bagNumber, e.units.map((u) => [u.unitNumber, u.status, u.patientMrn])])]), [["N2", [["N1", [["N1-PRBC", "issued", reg.mrn]]]]]]);
  const recipient = view.samples.find((s) => s.kind === "recipient");
  assert.ok(recipient.retainUntil && recipient.state === "may-discard", "100 days after issue the recipient sample may be discarded: " + JSON.stringify(recipient));
  assert.equal((await as(U.NURSE, `/ward/blood-bank?orgId=${ORG}`)).__status, 403, "the register stays with the blood centre");
});

test("the change feed withholds donors, deferral reasons, infection results and donor notifications from a reader whose scope admits every type; the blood bank's own grant names them", async () => {
  seedHospital();
  const d = await bleed("F1");
  await post(U.BLOOD, "/ward/blood-test-result", { donationId: d.id, tti: { ...CLEAR, hiv: "reactive" }, abo: "O", rhD: "positive", ...LAB });
  assert.equal((await post(U.BLOOD, "/ward/donor-notification", { donationId: d.id, step: "notified", method: "in-person" })).__status, 200);
  const types = async (read) => {
    const svc = new RecordService({ repository: H.RECORD, tenant: { id: TENANT }, actor: makeActor({ id: "reader", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "R1", scope: { read, write: [] } }) });
    return new Set((await svc.changes(0, 500)).records.map((r) => r.resourceType));
  };
  const everyType = await types(null);
  assert.ok(everyType.has("BloodDonation"), "operational records still sync");
  for (const t of ["BloodDonor", "DonorScreening", "BloodTestResult", "DonorNotification"]) assert.equal(everyType.has(t), false, t);
  const bank = await types(["BloodDonor", "DonorScreening", "BloodDonation", "BloodTestResult", "DonorNotification"]);
  for (const t of ["BloodDonor", "DonorScreening", "BloodTestResult", "DonorNotification"]) assert.equal(bank.has(t), true, t);
});
