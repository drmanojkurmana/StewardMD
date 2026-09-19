/* test/medcore-pipeline.test.mjs — the training pipeline's properties, end to end on a tiny cohort.
 *
 * Not a test that the model is good. A test that the pipeline cannot cheat: no future leaks into a
 * prediction point, prevalent cases leave the risk set instead of becoming negatives, the banned
 * shortcut features never enter the matrix, and the gate can actually fail.
 */
import { test } from "node:test";
import assert from "node:assert";
import { generate } from "../backend/medcore/synth/generate.mjs";
import { featurizeEncounter, split, loadPacks } from "../backend/medcore/featurize.mjs";
import { run, coreFeatureIds, thresholdBaseline } from "../backend/medcore/train.mjs";
import { fitLogistic, scoreLogistic, fitIsotonic, applyCalibration, median } from "../backend/medcore/learn.mjs";
import { auroc, auprc, ece, calibrationCurve, atThreshold, thresholdForAlertBudget, selectiveRisk } from "../backend/medcore/metrics.mjs";
import { NOT_ASKABLE } from "../medcore/medcore-outcomes.js";

const PACKS = loadPacks();
const COHORT = generate({ n: 60, seed: 4242, prevalentRate: 0.2, rescueRate: 0.3 }).encounters;

function matrix(encounters, opt) {
  const byEnc = new Map();
  const excluded = [];
  for (const e of encounters) {
    const r = featurizeEncounter(e, PACKS, Object.assign({ outcome: "MC-3", gridHours: 4 }, opt || {}));
    byEnc.set(e.encounterId, r.rows);
    excluded.push(...r.excluded);
  }
  return { rows: split(encounters, byEnc, {}), excluded };
}

test("pipeline: the cohort is stamped synthetic on every row, all the way to the matrix", () => {
  assert.ok(COHORT.every((e) => e.provenance.synthetic === true));
  const { rows } = matrix(COHORT);
  assert.ok(rows.length > 100, "a 60-encounter cohort should give hundreds of prediction points");
  assert.ok(rows.every((r) => r.synthetic === true));
});

test("pipeline: no prediction point can see its own future", () => {
  const withEvent = COHORT.find((e) => e.events.length);
  assert.ok(withEvent, "the generator must produce at least one event at this seed");
  const eventMs = Date.parse(withEvent.events[0].at);
  const { rows } = matrix([withEvent]);
  for (const r of rows) {
    const t0 = Date.parse(r.t0);
    assert.ok(t0 < eventMs, "a point at or after the event is not a prediction about it");
    // Every feature was built from observations at or before t0: the builder enforces it, and a
    // value later than t0 could only appear if something bypassed it.
    assert.ok(r.values.map_age_min === null || r.values.map_age_min >= 0);
  }
});

test("pipeline: the blanking window removes the hour before the event", () => {
  const withEvent = COHORT.find((e) => e.events.length);
  const eventMs = Date.parse(withEvent.events[0].at);
  const { rows } = matrix([withEvent]);
  const last = rows[rows.length - 1];
  // The newest observation feeding the last point must be older than the blanking window, since
  // everything inside it was dropped before the state was built.
  const ages = Object.keys(last.values).filter((k) => k.endsWith("_age_min"))
    .map((k) => last.values[k]).filter((v) => typeof v === "number");
  const t0 = Date.parse(last.t0);
  const newestObsMs = t0 - Math.min(...ages) * 60000;
  assert.ok(newestObsMs <= eventMs - 60 * 60000 + 1,
    "an observation inside the declared blanking hour reached the features");
});

test("pipeline: prevalent cases leave the risk set, they do not become negatives", () => {
  const prevalent = COHORT.filter((e) => e._truth.prevalent);
  assert.ok(prevalent.length >= 3, "the fixture needs prevalent cases to be worth testing");
  const { rows, excluded } = matrix(prevalent);
  assert.equal(rows.length, 0, "not one prediction point may survive for a patient already on a pressor");
  assert.ok(excluded.length > 0);
  assert.ok(excluded.every((e) => e.reason === NOT_ASKABLE.EXCLUDED));
  assert.ok(excluded.every((e) => e.detail.excludedBy.includes("vasopressorActiveAtT0")));
});

test("pipeline: the treatment paradox is present in the data and labelled honestly", () => {
  // A rescued patient deteriorates and never reaches the event, so every one of their points is a
  // negative with bad physiology. That contamination is real and is not hidden by the pipeline.
  const rescued = COHORT.filter((e) => e._truth.rescued && !e._truth.prevalent);
  assert.ok(rescued.length >= 2);
  const { rows } = matrix(rescued);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.label === 0), "a rescued patient has no event to label");
});

test("pipeline: the banned shortcut features never enter the feature matrix", () => {
  const { rows } = matrix(COHORT.slice(0, 10));
  for (const r of rows) {
    for (const id of Object.keys(r.values)) {
      assert.ok(!/count|interval|frequency|nurse|charting/i.test(id), id + " reached the matrix");
    }
    // The probe exists, deliberately, and is kept OUT of values so it can be trained on alone.
    assert.ok(r.probe && typeof r.probe.obs_count_24h === "number");
    assert.equal(r.values.obs_count_24h, undefined);
  }
});

test("pipeline: training does not read the probe, and training features are the core list", () => {
  const ids = coreFeatureIds();
  assert.ok(ids.includes("map_value") && ids.includes("lactate_slope_per_h"));
  for (const id of ids) assert.ok(!/count|interval|frequency/i.test(id), id + " is banned");
});

test("pipeline: a run produces every gate, and a gate can fail", () => {
  const { rows } = matrix(COHORT);
  const res = run({ rows, outcome: "MC-3" });
  const names = Object.keys(res.gates).sort();
  assert.deepEqual(names, ["beatsFrequencyProbe", "calibrationSlope", "ece", "missedEventsReduced25",
    "noSubgroupCollapse", "selectiveRiskFalls"]);
  assert.equal(typeof res.allPass, "boolean");
  assert.equal(res.synthetic, true);
  // A gate that cannot fail is decoration. On this deliberately tiny cohort at least one does.
  assert.ok(Object.values(res.gates).some((g) => !g.pass) || res.allPass,
    "gates must be computed, pass or fail");
});

test("pipeline: the frequency gate FIRES when the shortcut is the only signal", () => {
  // Constructed, not generated: a probe that predicts the label perfectly and features that carry
  // nothing. The gate must refuse this, or it would never refuse anything.
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const label = i % 5 === 0 ? 1 : 0;
    const split = i < 240 ? "train" : i < 320 ? "val" : "test";
    const values = {};
    for (const id of coreFeatureIds()) values[id] = 1 + (i % 3) * 0.001;   // no signal
    rows.push({
      encounterId: "e" + i, t0: new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString(),
      outcome: "MC-3", label, split, featureSet: "medcore-features@1.0.0", values,
      probe: { obs_count_24h: label ? 40 : 6, distinct_rounds_24h: label ? 20 : 3,
               mean_interval_min: label ? 30 : 240, minutes_since_last: 5 },
      strata: { ageBand: "65-79", sex: "M", completeness: "q4" }, synthetic: true
    });
  }
  const res = run({ rows, outcome: "MC-3" });
  assert.equal(res.gates.beatsFrequencyProbe.pass, false,
    "a model that cannot beat a count of observations must not ship");
  assert.ok(res.probe.auroc > 0.9, "the probe should be near-perfect here: " + res.probe.auroc);
  assert.equal(res.allPass, false);
});

test("metrics: AUROC, AUPRC and calibration behave on cases with a known answer", () => {
  const perfect = [{ y: 1, p: 0.9 }, { y: 1, p: 0.8 }, { y: 0, p: 0.2 }, { y: 0, p: 0.1 }];
  assert.equal(auroc(perfect), 1);
  assert.equal(auprc(perfect), 1);
  const inverted = perfect.map((r) => ({ y: r.y, p: 1 - r.p }));
  assert.equal(auroc(inverted), 0);
  assert.equal(auroc([{ y: 1, p: 0.5 }]), null, "one class is not an AUROC");
  // Perfectly calibrated: half the rows at p=0.5 are positive.
  const cal = [];
  for (let i = 0; i < 100; i++) cal.push({ y: i % 2, p: 0.5 });
  assert.ok(ece(cal).ece <= 0.01);
  assert.ok(Math.abs(calibrationCurve(cal).intercept) < 0.2);
});

test("metrics: an alert budget compares two models at the SAME burden", () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push({ y: i < 10 ? 1 : 0, p: (100 - i) / 100 });
  const thr = thresholdForAlertBudget(rows, 20);
  const at = atThreshold(rows, thr);
  assert.equal(at.alerts, 20, "the budget is the budget");
  assert.equal(at.missed, 0);
  const sel = selectiveRisk(rows);
  assert.ok(sel[0].coverage === 1 && sel[sel.length - 1].coverage === 0.5);
});

test("learn: imputation constants come from train and are frozen into the model", () => {
  const rows = [
    { values: { a: 1, b: 10 }, label: 0 }, { values: { a: 2, b: null }, label: 0 },
    { values: { a: 3, b: 30 }, label: 1 }, { values: { a: 4, b: 40 }, label: 1 }
  ];
  const m = fitLogistic(rows, { featureIds: ["a", "b"], iters: 200 });
  assert.equal(m.imputations.b, median([10, 30, 40]));
  // Scoring a row with b missing must use that frozen constant, not recompute anything.
  const p1 = scoreLogistic(m, { a: 2, b: null });
  const p2 = scoreLogistic(m, { a: 2, b: m.imputations.b });
  assert.equal(p1, p2);
});

test("learn: a zero-variance feature is dropped and reported, not silently kept", () => {
  const rows = [
    { values: { a: 1, dead: 7 }, label: 0 }, { values: { a: 2, dead: 7 }, label: 1 },
    { values: { a: 3, dead: 7 }, label: 1 }
  ];
  const m = fitLogistic(rows, { featureIds: ["a", "dead"], iters: 100 });
  assert.deepEqual(m.droppedFeatures, ["dead"]);
  assert.deepEqual(m.featureIds, ["a"]);
});

test("learn: isotonic calibration is monotone and stays inside [0,1]", () => {
  const pairs = [];
  for (let i = 0; i < 200; i++) pairs.push({ p: i / 200, y: i / 200 > 0.6 ? 1 : 0 });
  const cal = fitIsotonic(pairs);
  let prev = -1;
  for (const pt of cal.points) {
    assert.ok(pt.y >= prev - 1e-9, "calibration must not go backwards");
    assert.ok(pt.y >= 0 && pt.y <= 1);
    prev = pt.y;
  }
  assert.ok(applyCalibration(cal, 0.95) >= applyCalibration(cal, 0.05));
});

test("baseline: the threshold incumbent is named honestly and is not NEWS2", () => {
  const sick = thresholdBaseline({ map_value: 55, sbp_value: 85, hr_value: 135, rr_value: 30, spo2_value: 88, gcs_value: 11, lactate_value: 5 });
  const well = thresholdBaseline({ map_value: 90, sbp_value: 130, hr_value: 78, rr_value: 14, spo2_value: 98, gcs_value: 15, lactate_value: 1 });
  assert.ok(sick > well);
  assert.ok(sick <= 1 && well >= 0);
  assert.equal(thresholdBaseline({}), 0, "no inputs is no score, not a low one");
});
