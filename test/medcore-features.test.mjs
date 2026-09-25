/* test/medcore-features.test.mjs — the numbers, and what they refuse to say. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState, fromIcuState } from "../medcore/medcore-state.js";
import { features, FEATURE_SET, FEATURE_PARAMS, AGE_CAP_MIN } from "../medcore/medcore-features.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = {
  unitTable: JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8")),
  freshness: JSON.parse(readFileSync(join(ROOT, "medcore/data/freshness.json"), "utf8"))
};
const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;
const icu = (over) => fromIcuState(DEPS, Object.assign({
  patient: { age: 65, sex: "M", weightKg: 72 },
  vitals: [
    { ts: min(300), map: 90, hr: 80 },
    { ts: min(180), map: 78, hr: 98 },
    { ts: min(60), map: 62, hr: 119 },
    { ts: min(10), map: 55, hr: 128, sbp: 84, dbp: 50, uop: 18 }
  ]
}, over || {}), { asOf: NOW });

test("features: the set is versioned, sorted and stable", () => {
  const f = features(icu());
  assert.equal(f.featureSet, FEATURE_SET);
  assert.deepEqual(f.ids, f.ids.slice().sort());
  assert.deepEqual(features(icu()).ids, f.ids, "the same state gives the same ids");
  assert.equal(f.asOf, new Date(NOW).toISOString());
});

test("features: an absent comparison is null, never a zero change", () => {
  const f = features(icu()).values;
  assert.equal(f.map_value, 55);
  assert.equal(f.map_d1h, -7, "against the 62 charted an hour ago");
  assert.equal(f.map_d4h, -35, "against the newest point that is at least four hours old, the 90 at five hours");
  assert.equal(f.map_d24h, null, "the series does not reach back a day, so there is no 24h delta");
  assert.equal(f.gcs_value, null);
  assert.equal(f.gcs_present, 0);
  assert.equal(f.gcs_d1h, null, "an absent parameter has no deltas at all");
});

test("features: a slope needs three points, because two points are a delta", () => {
  const two = buildState(DEPS, {
    asOf: NOW, patient: {},
    observations: [{ param: "hr", value: 80, at: min(120), source: "icu-state" },
                   { param: "hr", value: 120, at: min(10), source: "icu-state" }]
  });
  assert.equal(features(two).values.hr_slope_per_h, null);
  assert.ok(features(icu()).values.map_slope_per_h < 0, "four falling points do have a slope");
});

test("features: recency is the only time signal and it is capped", () => {
  const f = features(icu()).values;
  assert.equal(f.map_age_min, 10);
  const old = buildState(DEPS, {
    asOf: NOW, patient: {},
    observations: [{ param: "crp", value: 200, at: min(2000), source: "icu-state" }]
  });
  assert.equal(old.params.crp.ageMin, 2000);
  assert.equal(features(old).values.crp_age_min, AGE_CAP_MIN, "capped, so it cannot proxy an interval");
});

test("features: a derived quantity needs BOTH inputs usable", () => {
  const f = features(icu()).values;
  assert.equal(f.shock_index, 1.5238);
  assert.equal(f.pulse_pressure, 34);
  assert.equal(f.uop_ml_kg_h, 0.25);
  assert.equal(f.pf_ratio, null, "no PaO2 and no FiO2 charted");

  // A stale systolic must not produce a confident shock index.
  const stale = buildState(DEPS, {
    asOf: NOW, patient: {},
    observations: [{ param: "hr", value: 120, at: min(10), source: "icu-state" },
                   { param: "sbp", value: 80, at: min(600), source: "icu-state" }]
  });
  assert.equal(stale.params.sbp.usable, false);
  assert.equal(features(stale).values.shock_index, null);
});

test("features: an uncharted intervention stays null, it never becomes a zero", () => {
  const f = features(icu()).values;
  assert.equal(f.vaso_active, null, "no infusion list was charted at all");
  assert.equal(f.vent_active, null);
  assert.equal(features(icu({ infusions: [{ drug: "Fentanyl" }] })).values.vaso_active, 0,
    "a charted list without a pressor is a real zero");
  assert.equal(features(icu({ infusions: [{ drug: "Noradrenaline" }] })).values.vaso_active, 1);
});

test("features: demographics carry through, and an unknown sex is null not a guess", () => {
  const f = features(icu()).values;
  assert.equal(f.age_years, 65);
  assert.equal(f.sex_male, 1);
  assert.equal(f.weight_kg, 72);
  assert.equal(features(icu({ patient: { age: 65 } })).values.sex_male, null);
});

test("features: every feature parameter is a real Medical Core parameter", () => {
  for (const p of FEATURE_PARAMS) assert.ok(DEPS.unitTable.params[p], p + " is not in the unit table");
});
