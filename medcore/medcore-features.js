/* medcore/medcore-features.js — the ONE feature implementation in this project. HAZ-ML-01.
 *
 * TWO JOBS, AND THE SECOND ONE IS THE SAFETY CONTROL.
 *
 * JOB ONE: turn a canonical state into a flat map of numbers. Dull on purpose. Current value,
 * deltas over 1, 4 and 24 hours, a least-squares slope, the window's min and max, a presence flag
 * and a capped recency, plus a few derived quantities a clinician would compute anyway.
 *
 * JOB TWO: refuse to compute the features that would make the model look good and be useless.
 *
 *   THE MEASUREMENT-FREQUENCY SHORTCUT. Sick patients are observed more often. Hand a model the
 *   number of observations, the interval between them, the count of labs ordered or anything
 *   derived from those, and it will learn HOW CLOSELY THIS PATIENT WAS WATCHED. That correlates
 *   beautifully with deterioration in retrospective data, because the nurse who was worried is in
 *   the timestamps. It carries no physiology, it cannot transfer to a ward with different staffing,
 *   and it collapses the moment it is deployed prospectively into the very workflow that produced
 *   it. It is the classic way a clinical model gets a wonderful AUROC and helps nobody.
 *
 *   So the banned list below is enforced HERE, at the only place features are built, and the
 *   assertion runs on every call rather than in a lint nobody runs. The single recency signal that
 *   survives is `<param>_age_min`, capped, because "this value is four hours old" is a property of
 *   the VALUE and the model must be able to discount a stale one. The cap is what stops it becoming
 *   a proxy for the interval.
 *
 *   The banned list is necessary and not sufficient. The plan also requires a frequency-only model
 *   to be trained and beaten by a stated margin before any model ships; a feature list alone cannot
 *   prove the shortcut was not learned some other way.
 *
 * TRAIN AND SERVE READ THE SAME CODE. backend/medcore/featurize.mjs calls this module with
 * asOf = t0 to build the training matrix. Python never implements a feature. That removes
 * train/serve skew as a class of bug rather than testing for it afterwards.
 *
 * PURE. No DOM, no I/O, no clock.
 *
 * node --test test/medcore-features.test.mjs test/medcore-shortcut.test.mjs
 */

export const FEATURE_SET = "medcore-features@1.0.0";

/** Minutes. Beyond this an observation is old, and HOW old stops being a physiological signal and
 *  starts being a description of the ward's staffing. */
export const AGE_CAP_MIN = 720;

/* Parameters that contribute features. Adding one here is a deliberate act: it changes the feature
 * set version, which invalidates every artifact trained on the old one. */
export const FEATURE_PARAMS = [
  "hr", "sbp", "dbp", "map", "spo2", "rr", "temp", "gcs", "uop",
  "lactate", "creat", "urea", "na", "k", "hco3", "plt", "wbc", "hb", "bili", "albumin",
  "inr", "crp", "glucose", "ph", "pao2", "paco2", "fio2"
];

/**
 * Feature ids that must never exist, with the reason each one is a shortcut rather than a signal.
 * Matched as substrings against every produced id, case-insensitively.
 */
export const BANNED_FEATURES = [
  { match: "obs_count", why: "how often a patient was observed is staffing, not physiology" },
  { match: "n_obs", why: "the same count under a shorter name" },
  { match: "observation_count", why: "the same count spelled out" },
  { match: "sample_count", why: "how many samples were taken is staffing, not physiology" },
  { match: "lab_count", why: "how many labs were ordered is a clinician's worry, leaked" },
  { match: "order_count", why: "how much was ordered is a clinician's worry, leaked" },
  { match: "interval", why: "the gap between observations is the same shortcut, differenced" },
  { match: "frequency", why: "explicitly the shortcut" },
  { match: "per_hour_obs", why: "the shortcut, rated" },
  { match: "charting", why: "charting behaviour is workflow, not the patient" },
  { match: "measured_times", why: "how many times it was measured is the same shortcut" },
  { match: "time_of_day", why: "ward routine, and it encodes the observation round" },
  { match: "nurse", why: "who was looking after the patient is staffing, not the patient" },
  { match: "ward_id", why: "identifies where, which stands in for case mix and staffing" }
];

/** Throws if any produced id is a banned shortcut. Runs on every build, not in a lint. */
export function assertNoBannedFeatures(ids) {
  const bad = [];
  for (const id of ids) {
    const low = String(id).toLowerCase();
    for (const b of BANNED_FEATURES) if (low.indexOf(b.match) !== -1) bad.push(id + " (" + b.why + ")");
  }
  if (bad.length) throw new Error("medcore-features: banned shortcut features: " + bad.join("; "));
  return true;
}

function num(x) { return typeof x === "number" && isFinite(x) ? x : null; }
function r4(n) { return n === null ? null : Math.round(n * 10000) / 10000; }

/** Value at or before `ageMin` minutes ago, from an oldest-first series. Null if the series does
 *  not reach back that far: an absent comparison is not a zero change. */
function valueAtLeastOld(rows, ageMin) {
  let out = null;
  for (const r of rows) if (r.ageMin >= ageMin) out = r.v;   // rows are oldest first
  return num(out);
}

/** Least-squares slope in units per hour over the whole series. Null with fewer than three points:
 *  two points are a delta, which is already reported, and calling it a trend overstates it. */
function slopePerHour(rows) {
  if (!rows || rows.length < 3) return null;
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const r of rows) {
    const x = -r.ageMin / 60, y = num(r.v);
    if (y === null) continue;
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  if (n < 3) return null;
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  return (n * sxy - sx * sy) / denom;
}

/**
 * @param {object} state   a medcore-state/1 object
 * @param {{params?:string[]}} [opts]
 * @returns {{featureSet:string, ids:string[], values:object, asOf:string}}
 */
export function features(state, opts) {
  const o = opts || {};
  const use = Array.isArray(o.params) ? o.params : FEATURE_PARAMS;
  const P = (state && state.params) || {};
  const S = (state && state.series) || {};
  const v = {};

  for (const p of use) {
    const cur = P[p];
    const usable = !!(cur && cur.usable && typeof cur.value === "number");
    const rows = (S[p] || []).filter((r) => typeof r.v === "number");

    v[p + "_value"] = usable ? cur.value : null;
    v[p + "_present"] = usable ? 1 : 0;
    // The only recency signal, and it is capped. See the header.
    v[p + "_age_min"] = usable ? Math.min(cur.ageMin, AGE_CAP_MIN) : null;

    for (const h of [1, 4, 24]) {
      const was = usable ? valueAtLeastOld(rows, h * 60) : null;
      v[p + "_d" + h + "h"] = (usable && was !== null) ? r4(cur.value - was) : null;
    }
    v[p + "_slope_per_h"] = usable ? r4(slopePerHour(rows)) : null;
    v[p + "_min"] = rows.length ? Math.min.apply(null, rows.map((r) => r.v)) : null;
    v[p + "_max"] = rows.length ? Math.max.apply(null, rows.map((r) => r.v)) : null;
  }

  /* Derived quantities. Each is null unless BOTH inputs are usable: a shock index computed from a
   * stale systolic is a confident number about a patient who has since changed. */
  const val = (p) => (P[p] && P[p].usable && typeof P[p].value === "number" ? P[p].value : null);
  const hr = val("hr"), sbp = val("sbp"), dbp = val("dbp"), pao2 = val("pao2"), fio2 = val("fio2"),
    uop = val("uop");
  const wt = state && state.demographics ? num(state.demographics.weightKg) : null;

  v.shock_index = (hr !== null && sbp) ? r4(hr / sbp) : null;
  v.pulse_pressure = (sbp !== null && dbp !== null) ? r4(sbp - dbp) : null;
  v.pf_ratio = (pao2 !== null && fio2) ? r4(pao2 / fio2) : null;
  v.uop_ml_kg_h = (uop !== null && wt) ? r4(uop / wt) : null;

  const d = (state && state.demographics) || {};
  v.age_years = num(d.ageYears);
  v.sex_male = d.sex === "M" ? 1 : d.sex === "F" ? 0 : null;
  v.weight_kg = wt;

  /* Interventions. `active: null` means nobody charted it, and it stays null: a model told "not on
   * a pressor" about a patient nobody asked is being lied to, and that is how prevalent cases
   * become contaminated negatives (HAZ-ML-02). */
  const I = (state && state.interventions) || {};
  const flag = (x) => (x && x.active === true ? 1 : x && x.active === false ? 0 : null);
  v.vaso_active = flag(I.vasopressor);
  v.vent_active = flag(I.ventilation);
  v.rrt_active = flag(I.rrt);
  v.oxygen_active = flag(I.oxygen);

  const ids = Object.keys(v).sort();
  assertNoBannedFeatures(ids);
  return { featureSet: FEATURE_SET, asOf: (state && state.asOf) || null, ids: ids, values: v };
}
