/* backend/medcore/train.mjs — the run that decides whether a model is allowed to exist.
 *
 * ORDER, AND IT IS NOT NEGOTIABLE (plan Phase 4). A deterministic threshold baseline first, then
 * logistic regression, and a model is kept only if it beats the incumbent AT EQUAL ALERT BURDEN.
 * Comparing a model at its own most flattering operating point against a baseline at the baseline's
 * is how every clinical AI paper produces an improvement nobody can find on a ward.
 *
 * THE GATES, all of which must pass, computed on the held-out TEST split only:
 *   - missed events reduced by >= 25% relative to the baseline, at the baseline's alert count
 *   - ECE <= 0.05 and calibration slope in [0.9, 1.1]
 *   - no subgroup AUROC more than 0.10 below overall
 *   - selective risk falls as coverage falls
 *   - the model beats a FREQUENCY-ONLY probe by >= 0.05 AUROC (HAZ-ML-01, the empirical half)
 *
 * THE FREQUENCY PROBE IS THE POINT OF THIS SCRIPT. medcore-features.js cannot produce a count or an
 * interval; the probe is computed separately by featurize.mjs and trained on ALONE here. If the
 * probe scores as well as the model, the model has learned how closely the patient was watched and
 * the run FAILS, whatever its AUROC. A control that cannot be made to fire has not been tested, so
 * generate the cohort with --frequency-bias and watch this gate fail on purpose.
 *
 * USAGE: node backend/medcore/train.mjs --in backend/medcore/out/matrix.jsonl --outcome MC-3
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fitLogistic, scoreLogistic, fitCalibrator, applyCalibration, fitOod, oodDistance, selectFeatures, tuneL2 } from "./learn.mjs";
import { auroc, auprc, brier, ece, calibrationCurve, selectiveRisk, atThreshold, thresholdForAlertBudget, round4 } from "./metrics.mjs";
import { fitGbm, scoreGbm } from "./gbm.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/* A compact feature list. 254 features over a few hundred positives is not a model, it is a
 * memorisation exercise, so the baseline uses the value, the presence, one delta and one slope per
 * parameter plus the derived quantities. Widening this is a decision with an events-per-variable
 * argument attached, not a default. */
const CORE_PARAMS = ["map", "sbp", "dbp", "hr", "spo2", "rr", "temp", "gcs", "uop",
  "lactate", "creat", "k", "na", "wbc", "plt", "hb"];
export function coreFeatureIds() {
  const ids = [];
  for (const p of CORE_PARAMS) ids.push(p + "_value", p + "_present", p + "_d4h", p + "_slope_per_h");
  ids.push("shock_index", "pulse_pressure", "uop_ml_kg_h", "age_years", "sex_male", "weight_kg",
    "vaso_active", "vent_active", "rrt_active");
  return ids;
}
const PROBE_IDS = ["obs_count_24h", "distinct_rounds_24h", "mean_interval_min", "minutes_since_last"];

/* Monotone constraints: the direction in which a feature may move predicted risk. CLINICAL CONTENT,
 * unapproved, and owned by the critical-care lead rather than by this file. +1 means higher value
 * may only raise risk, -1 means higher value may only lower it, absent means unconstrained.
 *
 * They exist because a tree will otherwise fit a fold in which the sickest patients happened to be
 * rescued and emerge saying a lactate of 8 is reassuring. That is defensible as statistics and
 * indefensible at a bedside, and no amount of AUROC makes it safe. Parameters where BOTH directions
 * are dangerous (temperature, sodium, potassium) are deliberately left unconstrained. */
export const MONOTONE = {
  lactate_value: +1, lactate_d4h: +1, lactate_slope_per_h: +1,
  creat_value: +1, creat_d4h: +1,
  hr_value: +1, hr_d4h: +1,
  rr_value: +1, rr_d4h: +1,
  shock_index: +1,
  map_value: -1, map_d4h: -1, map_slope_per_h: -1,
  sbp_value: -1, sbp_d4h: -1,
  spo2_value: -1, spo2_d4h: -1,
  gcs_value: -1, gcs_d4h: -1,
  uop_value: -1, uop_ml_kg_h: -1
};

/* The incumbent: single-parameter thresholds, the crude screen a ward already applies by eye.
 * NAMED HONESTLY - this is NOT NEWS2. Real NEWS2 lives in wardsynq-deterioration.js with its own
 * refusals and its own charted inputs, and the comparison on REAL data must be against that. */
export function thresholdBaseline(v) {
  let s = 0;
  const n = (x) => (typeof x === "number" && isFinite(x) ? x : null);
  const map = n(v.map_value), sbp = n(v.sbp_value), hr = n(v.hr_value), rr = n(v.rr_value),
    spo2 = n(v.spo2_value), gcs = n(v.gcs_value), lac = n(v.lactate_value);
  if (map !== null && map < 65) s += 3; else if (map !== null && map < 75) s += 1;
  if (sbp !== null && sbp < 90) s += 3; else if (sbp !== null && sbp < 100) s += 1;
  if (hr !== null && hr > 130) s += 2; else if (hr !== null && hr > 110) s += 1;
  if (rr !== null && rr > 24) s += 2; else if (rr !== null && rr > 20) s += 1;
  if (spo2 !== null && spo2 < 92) s += 2; else if (spo2 !== null && spo2 < 94) s += 1;
  if (gcs !== null && gcs < 13) s += 2;
  if (lac !== null && lac > 4) s += 3; else if (lac !== null && lac > 2) s += 1;
  return s / 17;                                          // 0..1, a score not a probability
}

function load(path) {
  return readFileSync(join(ROOT, path), "utf8").trim().split("\n").map((l) => JSON.parse(l));
}
const bySplit = (rows, s) => rows.filter((r) => r.split === s);
const pairs = (rows, score) => rows.map((r) => ({ y: r.label, p: score(r) }));

function subgroupAuroc(rows, score) {
  const out = {};
  for (const key of ["ageBand", "sex", "completeness", "site", "region"]) {
    for (const level of Array.from(new Set(rows.map((r) => r.strata[key])))) {
      if (level === undefined) continue;
      const sub = rows.filter((r) => r.strata[key] === level);
      const a = auroc(pairs(sub, score));
      if (a !== null && sub.length >= 30) out[key + "=" + level] = { n: sub.length, auroc: round4(a) };
    }
  }
  return out;
}

export function run(opts) {
  const rows = opts.rows;
  const train = bySplit(rows, "train"), val = bySplit(rows, "val"), test = bySplit(rows, "test");
  if (!train.length || !val.length || !test.length) throw new Error("train: every split must be non-empty");

  const synthetic = rows.some((r) => r.synthetic);

  // 1. incumbent
  const basePairs = pairs(test, (r) => thresholdBaseline(r.values));
  const baseAlerts = Math.max(1, Math.round(test.length * (opts.alertRate || 0.15)));
  const baseThr = thresholdForAlertBudget(basePairs, baseAlerts);
  const baseAt = atThreshold(basePairs, baseThr);

  // 2. logistic regression, on as many features as the positives can support, calibrated on
  //    VALIDATION only with the calibrator CHOSEN by cross-validated log loss inside that split.
  const selection = selectFeatures(train, coreFeatureIds(), { targetEpv: opts.targetEpv || 10 });
  const tuned = opts.l2 === undefined
    ? tuneL2(train, selection.featureIds, {})
    : { l2: opts.l2, tried: [], reason: "FIXED_BY_CALLER" };
  const lrModel = fitLogistic(train, { featureIds: selection.featureIds, l2: tuned.l2 });

  /* Stage 3: the GBM. It replaces the logistic baseline only if it BEATS it, and the comparison is
   * made on VALIDATION, never on test - picking a learner by its test score is how a pipeline
   * launders model selection into a headline number. */
  const gbmModel = opts.skipGbm ? null : fitGbm(train, {
    featureIds: selection.featureIds, valid: val, monotone: MONOTONE,
    rounds: opts.gbmRounds || 400, lr: opts.gbmLr || 0.06, depth: opts.gbmDepth || 3
  });
  const valAuprc = (sc) => auprc(pairs(val, sc));
  const lrValAuprc = valAuprc((r) => scoreLogistic(lrModel, r.values));
  const gbmValAuprc = gbmModel ? valAuprc((r) => scoreGbm(gbmModel, r.values)) : null;
  const margin = opts.gbmMargin === undefined ? 0.02 : opts.gbmMargin;
  const useGbm = gbmModel !== null && gbmValAuprc !== null && (gbmValAuprc - lrValAuprc) >= margin;
  const model = useGbm ? gbmModel : lrModel;
  const rawScore = useGbm ? (v) => scoreGbm(gbmModel, v) : (v) => scoreLogistic(lrModel, v);
  const stageChoice = {
    chosen: useGbm ? "gbm" : "logistic",
    validAuprc: { logistic: round4(lrValAuprc), gbm: round4(gbmValAuprc) },
    requiredMargin: margin,
    gbmStopped: gbmModel ? gbmModel.stopped : null
  };

  const rawVal = pairs(val, (r) => rawScore(r.values));
  const calibration = fitCalibrator(rawVal);
  const ood = fitOod(lrModel, train);      // the OOD distance stays on the standardised linear space
  const score = (r) => applyCalibration(calibration, rawScore(r.values));
  const modelPairs = pairs(test, score);
  const modelThr = thresholdForAlertBudget(modelPairs, baseAt.alerts);
  const modelAt = atThreshold(modelPairs, modelThr);

  // 3. the adversarial frequency-only probe (HAZ-ML-01)
  const probeModel = fitLogistic(train.map((r) => ({ values: r.probe, label: r.label })), { featureIds: PROBE_IDS, l2: 3 });
  const probePairs = pairs(test, (r) => scoreLogistic(probeModel, r.probe));

  const cal = ece(modelPairs, 10);
  const curve = calibrationCurve(modelPairs, { bootstrap: opts.bootstrap === undefined ? 200 : opts.bootstrap });
  const epv = model.featureIds.length ? train.filter((r) => r.label === 1).length / model.featureIds.length : 0;
  const sub = subgroupAuroc(test, score);
  const sel = selectiveRisk(modelPairs);
  const overall = auroc(modelPairs);

  const worstSub = Object.entries(sub).sort((a, b) => a[1].auroc - b[1].auroc)[0];
  const missedReduction = baseAt.missed ? (baseAt.missed - modelAt.missed) / baseAt.missed : null;
  const probeAuroc = auroc(probePairs);

  const gates = {
    missedEventsReduced25: { pass: missedReduction !== null && missedReduction >= 0.25, value: round4(missedReduction) },
    ece: { pass: cal.ece !== null && cal.ece <= 0.05, value: cal.ece },
    /* A refused slope FAILS. A measurement that declined to be made is not a pass, and the
     * refusal reason travels so the next person sees why rather than a bare null. */
    calibrationSlope: {
      pass: curve.usable === true && curve.slope >= 0.9 && curve.slope <= 1.1,
      value: curve.usable ? curve.slope : { refusal: curve.refusal, excludedFraction: curve.excludedFraction }
    },
    /* Added after the first real run: at 2.4 events per variable the model memorised the training
     * set and the calibration gate caught it only afterwards, as overconfidence. This catches the
     * precondition directly, before the result has to be interpreted. */
    eventsPerVariable: { pass: epv >= 10, value: round4(epv) },
    noSubgroupCollapse: {
      pass: !worstSub || (overall - worstSub[1].auroc) <= 0.10,
      value: worstSub ? { subgroup: worstSub[0], auroc: worstSub[1].auroc, overall: round4(overall) } : null
    },
    selectiveRiskFalls: {
      pass: sel[sel.length - 1].error <= sel[0].error,
      value: { at100: sel[0].error, at50: sel[sel.length - 1].error }
    },
    beatsFrequencyProbe: {
      pass: probeAuroc !== null && (overall - probeAuroc) >= 0.05,
      value: { model: round4(overall), probe: round4(probeAuroc), margin: round4(overall - probeAuroc) }
    }
  };
  const allPass = Object.values(gates).every((g) => g.pass);

  return {
    outcome: opts.outcome, synthetic,
    counts: {
      train: train.length, val: val.length, test: test.length,
      trainPositives: train.filter((r) => r.label === 1).length,
      testPositives: test.filter((r) => r.label === 1).length,
      eventsPerVariable: round4(epv)
    },
    baseline: { kind: "threshold-baseline", auroc: round4(auroc(basePairs)), at: baseAt },
    model: {
      kind: (useGbm ? "gbm" : "logistic") + "+" + (calibration.kind || "isotonic"),
      auroc: round4(overall), auprc: round4(auprc(modelPairs)), brier: round4(brier(modelPairs)),
      ece: cal.ece, calibration: curve, at: modelAt,
      droppedFeatures: lrModel.droppedFeatures, featureCount: model.featureIds.length,
      stage: stageChoice,
      calibrator: calibration.selection || null,
      l2: { chosen: tuned.l2, tried: tuned.tried, reason: tuned.reason }
    },
    featureSelection: {
      offered: coreFeatureIds().length, budget: selection.budget, positives: selection.positives,
      kept: selection.featureIds.length, droppedForEpv: selection.dropped.length,
      topRanked: selection.ranked ? selection.ranked.slice(0, 8) : null
    },
    probe: { kind: "frequency-only", auroc: round4(probeAuroc) },
    subgroups: sub, selectiveRisk: sel, reliability: cal.table,
    gates, allPass,
    artifact: { model, calibration, ood, linear: lrModel }
  };
}

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const rows = load(String(arg("in", "backend/medcore/out/matrix.jsonl")));
  const res = run({ rows, outcome: String(arg("outcome", "MC-3")), alertRate: Number(arg("alert-rate", 0.15)) });
  const outDir = String(arg("out-dir", "backend/medcore/out"));
  mkdirSync(join(ROOT, outDir), { recursive: true });
  writeFileSync(join(ROOT, outDir, "report.json"), JSON.stringify(res, null, 2));

  console.log(`\n=== Medical Core ${res.outcome} ===`);
  if (res.synthetic) console.log("*** SYNTHETIC DATA. Every number below is a statement about the PIPELINE, not about patients. ***");
  console.log(`points train ${res.counts.train} / val ${res.counts.val} / test ${res.counts.test}`);
  console.log(`positives train ${res.counts.trainPositives}, test ${res.counts.testPositives}, events per variable ${res.counts.eventsPerVariable}`);
  console.log(`features  offered ${res.featureSelection.offered}, budget ${res.featureSelection.budget} (${res.featureSelection.positives} positives / 10 per variable), kept ${res.featureSelection.kept}`);
  console.log(`dropped (zero variance inside the risk set): ${res.model.droppedFeatures.join(", ") || "none"}`);
  if (res.model.stage) {
    const st = res.model.stage;
    console.log(`stage     ${st.chosen.toUpperCase()} (validation AUPRC logistic ${st.validAuprc.logistic} vs gbm ${st.validAuprc.gbm}, margin required ${st.requiredMargin})${st.gbmStopped ? " gbm kept " + st.gbmStopped.keptTrees + " trees" : ""}`);
  }
  if (res.model.l2) console.log(`L2        chosen ${res.model.l2.chosen} by held-out log loss inside train${res.model.l2.tried.length ? " (" + res.model.l2.tried.map((t) => t.l2 + ":" + t.logLoss).join(" ") + ")" : ""}`);
  if (res.model.calibrator) {
    const c = res.model.calibrator;
    console.log(`calibrator chosen ${c.chosen} by ${c.folds}-fold log loss on validation (platt ${c.logLoss.platt} vs isotonic ${c.logLoss.isotonic})`);
  }
  console.log(`\nbaseline  AUROC ${res.baseline.auroc}  alerts ${res.baseline.at.alerts}  missed ${res.baseline.at.missed}  sens ${res.baseline.at.sensitivity}`);
  const ci = res.model.calibration.slopeCI;
  console.log(`model     AUROC ${res.model.auroc}  AUPRC ${res.model.auprc}  Brier ${res.model.brier}  ECE ${res.model.ece}  slope ${res.model.calibration.slope}${ci ? " (95% CI " + ci.lo + " to " + ci.hi + ")" : ""}`);
  console.log(`          at the SAME alert budget: alerts ${res.model.at.alerts}  missed ${res.model.at.missed}  sens ${res.model.at.sensitivity}  PPV ${res.model.at.ppv}`);
  console.log(`probe     AUROC ${res.probe.auroc}  (frequency only - if this is close, the model learned the ward's staffing)`);
  console.log("\ngates:");
  for (const [k, g] of Object.entries(res.gates)) {
    console.log(`  ${g.pass ? "PASS" : "FAIL"}  ${k}  ${JSON.stringify(g.value)}`);
  }
  console.log(`\n${res.allPass ? "ALL GATES PASS" : "GATED: this model does not ship"}`);
  console.log(`report -> ${outDir}/report.json`);
}
