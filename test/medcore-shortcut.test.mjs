/* test/medcore-shortcut.test.mjs — HAZ-ML-01. The measurement-frequency shortcut.
 *
 * Sick patients are observed more often, so the number of observations and the gaps between them
 * predict deterioration in retrospective data better than most physiology does. What that predicts
 * is the nurse who was worried, recorded in the timestamps. It carries no physiology, does not
 * transfer to a ward with different staffing, and collapses when deployed prospectively into the
 * workflow that produced it.
 *
 * This file is the enforcement half of the control. The other half is in the plan and cannot be a
 * unit test: a frequency-only model must be trained and beaten by a stated margin before anything
 * ships. A feature list alone cannot prove the shortcut was not learned some other way.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState } from "../medcore/medcore-state.js";
import { features, assertNoBannedFeatures, BANNED_FEATURES, AGE_CAP_MIN } from "../medcore/medcore-features.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = {
  unitTable: JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8")),
  freshness: JSON.parse(readFileSync(join(ROOT, "medcore/data/freshness.json"), "utf8"))
};
const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;

/** Same patient, same values, charted four times versus forty. */
function chartedNTimes(n) {
  const obs = [];
  for (let i = 0; i < n; i++) {
    obs.push({ param: "hr", value: 100 + (i % 2), at: min(240 - i * (240 / n)), source: "icu-state" });
  }
  return buildState(DEPS, { asOf: NOW, patient: { ageYears: 65 }, observations: obs });
}

test("shortcut: no produced feature is a count, an interval or a frequency", () => {
  const f = features(chartedNTimes(12));
  assertNoBannedFeatures(f.ids);                 // runs inside features() too, on every call
  for (const id of f.ids) {
    assert.ok(!/count|interval|frequency|nurse|charting|time_of_day|n_obs/i.test(id),
      id + " looks like the measurement-frequency shortcut");
  }
});

test("shortcut: the enforcement is a throw, not a lint nobody runs", () => {
  assert.throws(() => assertNoBannedFeatures(["hr_value", "hr_obs_count"]), /banned shortcut features/);
  assert.throws(() => assertNoBannedFeatures(["obs_interval_min"]), /banned shortcut features/);
  assert.throws(() => assertNoBannedFeatures(["charting_rate"]), /banned shortcut features/);
  assert.ok(BANNED_FEATURES.every((b) => b.match && b.why && b.why.length > 10),
    "every ban carries the reason it is a shortcut rather than a signal");
});

test("shortcut: charting the SAME patient more often must not change the feature vector much", () => {
  const sparse = features(chartedNTimes(4)).values;
  const dense = features(chartedNTimes(40)).values;
  // The value, its presence and its extremes are physiology and are identical. Only the slope and
  // the deltas may differ, and only because the series is sampled differently - never because a
  // count of observations entered the vector.
  for (const k of ["hr_value", "hr_present", "hr_min", "hr_max"]) {
    assert.equal(sparse[k], dense[k], k + " must not depend on how often the patient was charted");
  }
  const ids = Object.keys(sparse);
  const differing = ids.filter((k) => sparse[k] !== dense[k]);
  assert.ok(differing.every((k) => /_slope_per_h$|_d\d+h$|_age_min$/.test(k)),
    "only sampling-sensitive features may differ: " + differing.join(", "));
});

test("shortcut: recency is capped, so it cannot stand in for the observation interval", () => {
  const old = buildState(DEPS, {
    asOf: NOW, patient: {},
    observations: [{ param: "crp", value: 50, at: min(2000), source: "icu-state" }]
  });
  assert.equal(features(old).values.crp_age_min, AGE_CAP_MIN);
  const older = buildState(DEPS, {
    asOf: NOW, patient: {},
    observations: [{ param: "crp", value: 50, at: min(2800), source: "icu-state" }]
  });
  assert.equal(features(older).values.crp_age_min, AGE_CAP_MIN,
    "a CRP 33 hours old and one 47 hours old look the same to the model; both are simply old");
});

test("shortcut: no Medical Core module counts observations for a feature", () => {
  const dir = join(ROOT, "medcore");
  const offenders = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const code = readFileSync(join(dir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    // A feature named after a length or a count. Reading rows.length to iterate is fine; naming a
    // FEATURE after it is not, which is what this looks for.
    if (/["'][a-z0-9_]*(count|n_obs|interval|frequency)[a-z0-9_]*["']\s*\]?\s*=/.test(code)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], "a count reached the feature map in: " + offenders.join(", "));
});
