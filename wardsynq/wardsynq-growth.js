/* wardsynq/wardsynq-growth.js — growth z-scores and centiles by the LMS method, and corrected age for preterm infants.
 *
 * WHICH REFERENCE. By default the CDC 2000 growth charts, wardsynq/data/cdc-growth-2000.json: a United States Government
 * work in the public domain, with its citation, sources, CDC's attribution and non-endorsement statement inside the file
 * (owner decision 2026-09-17, vault/decisions/Decisions.md). A hospital that holds its own licence for other tables (WHO,
 * IAP) loads them on Admin > FHIR > Growth charts (functions/_wardsynq/growth-tables.js), and hospitalReference() turns
 * those rows into the same shape, so the chart uses them. The WHO Child Growth Standards tables shipped before 2026-09-17
 * were removed from the repository: CC BY-NC-SA 3.0 IGO does not permit commercial use.
 *
 * THE METHOD IS CDC'S, as its data page states it (https://www.cdc.gov/growthcharts/cdc-data-files.htm, read 2026-09-17):
 *   z = ((X/M)^L - 1) / (L S) when L is not 0, z = ln(X/M) / S when L is 0; the value at z is M (1 + L S z)^(1/L), or
 *   M exp(S z). "Age is listed at the half month point for the entire month ... To obtain L, M, and S values at finer age
 *   or length/stature intervals interpolation could be used." This file interpolates linearly between table rows.
 *   There is NO restricted |z| > 3 adjustment in CDC's method: that is WHO's (anthro), applied here only to a hospital's
 *   own tables loaded with the method "who-restricted", on the same four indicators WHO applies it to.
 * CDC's SAS program page (https://www.cdc.gov/growth-chart-training/hcp/computer-programs/sas.html, read 2026-09-17):
 *   age in months is days / 30.4375; height is recumbent length under 24 months and standing height from 24 months, and
 *   "If standing height was measured for children under 24 months of age, you should add 0.8 cm ... If recumbent length
 *   was measured for children >= 24 months, subtract 0.8 cm"; extreme values are flagged on the modified z-score (half the
 *   distance between 0 and +2, or 0 and -2, z-scores as the unit): weight-for-age below -5 or above 8, height-for-age
 *   below -5 or above 4, weight-for-height below -4 or above 8, BMI below -4 or above 8, head circumference below -5 or
 *   above 5. BMI above the 95th centile: CDC's extended BMI-for-age method (2022) is not implemented, and the result says so.
 *
 * TABLES. Under 24 months the birth-to-36-months tables (recumbent length), from 24 months the 2-to-20-years tables
 * (stature); head circumference to 36 months; weight-for-length (45 to 103.5 cm) under 24 months and weight-for-stature
 * (77 to 121.5 cm) from 24 months. Outside a table the answer is a refusal, never an extrapolation.
 *
 * WHAT A REFUSAL LOOKS LIKE. Unknown sex, an unknown or negative age, a value that is not a positive number, or an age or
 * length outside the table: {ok: false, code, reason}, never a number. A centile nobody can compute must not look like one.
 *
 * CORRECTED AGE. Conventional rule, stated here once: a baby born before 37 completed weeks is plotted at corrected age =
 * chronological age minus (40 weeks minus gestational age at birth), until 24 months chronological age, then at
 * chronological age. Gestational age unknown means NO correction, and the result says so. A corrected age before term
 * (below zero) is refused: these references start at a term birth and are not a preterm chart.
 *
 * STATUS: IMPLEMENTED and TESTED against values CDC publishes. NOT clinically validated.
 *
 * node --test test/wardsynq-growth.test.mjs
 */

import CDC_DATA from "./data/cdc-growth-2000.json";

const DAYS_PER_MONTH = 30.4375;                 // CDC SAS program page: days / 30.4375
const INDICATORS = Object.freeze(["wfa", "lhfa", "wfl", "wfh", "bmi", "hcfa"]);
/* WHO's restricted adjustment, for a hospital's tables loaded as "who-restricted" only (anthro R/z-score-helper.R). */
const ADJUSTED = Object.freeze({ wfa: true, wfl: true, wfh: true, bmi: true, lhfa: false, hcfa: false });
/* CDC's extreme-value cut-offs on the modified z-score (SAS program page, Table 2). */
const CDC_EXTREME = Object.freeze({ wfa: [-5, 8], lhfa: [-5, 4], wfl: [-4, 8], wfh: [-4, 8], bmi: [-4, 8], hcfa: [-5, 5] });
/* WHO's implausibility flags on z (anthro R/z-score-*.R), for a hospital's "who-restricted" tables. */
const WHO_FLAG = Object.freeze({ wfa: [-6, 5], lhfa: [-6, 6], wfl: [-5, 5], wfh: [-5, 5], bmi: [-5, 5], hcfa: [-5, 5] });
const PRETERM_BELOW_WEEKS = 37;
const CORRECT_UNTIL_MONTHS = 24;
const LENGTH_UNTIL_MONTHS = 24;
const CHART_CENTILES = Object.freeze([3, 10, 25, 50, 75, 90, 97]);   // the smoothed percentiles CDC tabulates, 5 and 95 aside
const METHODS = Object.freeze(["lms", "who-restricted"]);

/** CDC data page: the LMS z-score. */
function zscoreLms(y, l, m, s) { return l === 0 ? Math.log(y / m) / s : (Math.pow(y / m, l) - 1) / (s * l); }

/** CDC data page: the measurement at a given z (the inverse LMS transform), for centile lines. */
function valueAtZ(z, l, m, s) { return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l); }

/** WHO anthro R/z-score-helper.R compute_zscore_adjusted: beyond |z| 3, distance in units of the 2-to-3 SD gap. */
function zscoreAdjusted(y, l, m, s) {
  const sd = (z) => valueAtZ(z, l, m, s);
  const z = zscoreLms(y, l, m, s);
  if (z > 3) return 3 + (y - sd(3)) / (sd(3) - sd(2));
  if (z < -3) return -3 + (y - sd(-3)) / (sd(-2) - sd(-3));
  return z;
}

/** CDC SAS program page: the modified z-score, half the distance from 0 to +/-2 z as the unit. */
function modifiedZ(y, l, m, s) {
  return y >= m ? (y - m) / ((valueAtZ(2, l, m, s) - m) / 2) : (y - m) / ((m - valueAtZ(-2, l, m, s)) / 2);
}

/* Standard normal CDF and its inverse. erf by Abramowitz and Stegun 7.1.26 (error below 1.5e-7),
 * ample for a centile shown to one decimal. */
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const e = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + e) / 2 : (1 - e) / 2;
}
function zForCentile(c) {                      // bisection on normalCdf; only used for the chart lines
  let lo = -8, hi = 8;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (normalCdf(mid) * 100 < c) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

const refuse = (code, reason) => ({ ok: false, code, reason });

/* A reference: { id, name, method, positionOffsetCm, info, tables: { indicator: [segment] } }; a segment is
 * { x: "months" | "cm", ageFromMonths, ageToMonths, male: [[x, L, M, S]], female: [...] } with rows sorted by x. */
const CDC2000 = Object.freeze({
  id: "cdc2000", name: CDC_DATA.name, method: "lms", positionOffsetCm: 0.8,
  info: Object.freeze({ id: "cdc2000", name: CDC_DATA.name, citation: CDC_DATA.citation, source: CDC_DATA.source, licence: CDC_DATA.licence, attribution: CDC_DATA.attribution, method: "lms" }),
  tables: CDC_DATA.indicators,
});

/**
 * A hospital's own tables as a reference. rows: [[indicator, "male"|"female", x, L, M, S]] (x in months, or cm for wfl
 * and wfh). No length/height conversion is assumed for another publisher's tables: the position is flagged as recorded.
 */
function hospitalReference({ name, method, rows, info }) {
  const tables = {};
  for (const [ind, sex, x, l, m, s] of rows || []) {
    const seg = tables[ind] || (tables[ind] = [{ x: ind === "wfl" || ind === "wfh" ? "cm" : "months", male: [], female: [] }]);
    seg[0][sex].push([x, l, m, s]);
  }
  for (const [ind, [seg]] of Object.entries(tables)) {
    for (const sex of ["male", "female"]) seg[sex].sort((a, b) => a[0] - b[0]);
    if (ind === "wfl") { seg.ageFromMonths = 0; seg.ageToMonths = LENGTH_UNTIL_MONTHS; }
    else if (ind === "wfh") { seg.ageFromMonths = LENGTH_UNTIL_MONTHS; seg.ageToMonths = Infinity; }
    else {
      const xs = seg.male.concat(seg.female).map((r) => r[0]);
      seg.ageFromMonths = Math.min(...xs); seg.ageToMonths = Math.max(...xs);
    }
  }
  const m = METHODS.includes(method) ? method : "lms";
  return { id: "hospital", name, method: m, positionOffsetCm: 0, info: { ...(info || {}), id: "hospital", name, method: m }, tables };
}

/** L, M, S at x by linear interpolation between the rows either side; null outside the table. */
function interpolate(rows, x) {
  if (!rows || !rows.length || !(x >= rows[0][0] && x <= rows[rows.length - 1][0])) return null;
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= x) lo = mid; else hi = mid; }
  const a = rows[lo], b = rows[hi];
  if (x === a[0] || a === b) return { l: a[1], m: a[2], s: a[3] };
  if (x === b[0]) return { l: b[1], m: b[2], s: b[3] };
  const f = (x - a[0]) / (b[0] - a[0]);
  return { l: a[1] + f * (b[1] - a[1]), m: a[2] + f * (b[2] - a[2]), s: a[3] + f * (b[3] - a[3]) };
}

/** Which table applies, and the L, M, S for this age (and length or height, for weight-for-length/height). */
function lmsFor(indicator, sex, ageDays, lenheiCm, ref = CDC2000) {
  if (!INDICATORS.includes(indicator)) return refuse("UNKNOWN_INDICATOR", `unknown growth indicator ${indicator}`);
  if (sex !== "male" && sex !== "female") return refuse("SEX_UNKNOWN", "sex is not recorded as male or female, so no growth reference can be chosen");
  if (typeof ageDays !== "number" || !Number.isFinite(ageDays) || ageDays < 0) return refuse("AGE_UNKNOWN", "the age is not established");
  const months = ageDays / DAYS_PER_MONTH;
  const byLength = indicator === "wfl" || indicator === "wfh";
  const ind = byLength ? (months < LENGTH_UNTIL_MONTHS ? "wfl" : "wfh") : indicator;
  const segs = (ref.tables && ref.tables[ind]) || [];
  const seg = segs.find((s, i) => months >= s.ageFromMonths && (months < s.ageToMonths || (i === segs.length - 1 && months <= s.ageToMonths)));
  if (!seg) return refuse("OUT_OF_RANGE", `${ref.name} has no ${ind} table for this age`);
  if (byLength && !(typeof lenheiCm === "number" && lenheiCm > 0)) return refuse("VALUE_INVALID", "a length or height is needed");
  const lms = interpolate(seg[sex], byLength ? lenheiCm : months);
  if (!lms) return refuse("OUT_OF_RANGE", byLength ? `${ref.name} ${ind} covers other lengths or heights` : `${ref.name} ${ind} does not cover this age`);
  return { ok: true, reference: ref.id, indicator: ind, ...lms };
}

/**
 * CDC SAS program page: length under 24 months, height from 24 months, so a standing height under 24 months gains the
 * reference's offset (0.8 cm for CDC) and a recumbent length from 24 months loses it. position: "lying" | "standing" |
 * null (not recorded, stated as assumed).
 */
function standardLenhei(lenheiCm, ageDays, position, ref = CDC2000) {
  const under = ageDays / DAYS_PER_MONTH < LENGTH_UNTIL_MONTHS, off = ref.positionOffsetCm || 0;
  if (position === "standing" && under) return { cm: lenheiCm + off, positionAssumed: false };
  if (position === "lying" && !under) return { cm: lenheiCm - off, positionAssumed: false };
  return { cm: lenheiCm, positionAssumed: position !== "lying" && position !== "standing" };
}

/**
 * One measurement's z-score and centile against a reference (CDC 2000 unless a hospital's).
 * @param {{indicator: string, sex: string, ageDays: number, value: number, lenheiCm?: number, position?: string}} p
 *   value: kg (wfa, wfl, wfh), cm (lhfa, hcfa) or kg/m2 (bmi); lenheiCm for weight-for-length/height.
 */
function growthZ(p, ref = CDC2000) {
  p = p || {};
  if (!(typeof p.value === "number" && Number.isFinite(p.value) && p.value > 0)) return refuse("VALUE_INVALID", "the measurement is not a positive number");
  let value = p.value, lenhei = p.lenheiCm, position = null;
  if (["lhfa", "wfl", "wfh"].includes(p.indicator) && typeof p.ageDays === "number" && p.ageDays >= 0) {
    const raw = p.indicator === "lhfa" ? p.value : p.lenheiCm;
    if (typeof raw === "number" && raw > 0) {
      position = standardLenhei(raw, p.ageDays, p.position || null, ref);
      if (p.indicator === "lhfa") value = position.cm; else lenhei = position.cm;
    }
  }
  const lms = lmsFor(p.indicator, p.sex, p.ageDays, lenhei, ref);
  if (!lms.ok) return lms;
  const raw = ref.method === "who-restricted" && ADJUSTED[lms.indicator] ? zscoreAdjusted(value, lms.l, lms.m, lms.s) : zscoreLms(value, lms.l, lms.m, lms.s);
  if (!Number.isFinite(raw)) return refuse("OUT_OF_RANGE", "no z-score can be computed for this value");
  const z = Math.round(raw * 100) / 100;
  let implausible = false;
  if (ref.id === "cdc2000") { const mz = modifiedZ(value, lms.l, lms.m, lms.s), [lo, hi] = CDC_EXTREME[lms.indicator]; implausible = mz < lo || mz > hi; }
  else if (ref.method === "who-restricted") { const [lo, hi] = WHO_FLAG[lms.indicator]; implausible = z < lo || z > hi; }
  return {
    ok: true, reference: lms.reference, indicator: lms.indicator, z,
    centile: Math.round(normalCdf(raw) * 1000) / 10,
    implausible, positionAssumed: !!(position && position.positionAssumed),
    ...(ref.id === "cdc2000" && lms.indicator === "bmi" && raw > zForCentile(95) ? { extendedBmiNotApplied: true } : {}),
  };
}

/**
 * Corrected age, conventional rule (see the header). gestationalAgeDays at birth, whole days.
 * @returns {{corrected: boolean, ageDays: number|null, reason: string}}
 *   ageDays is the age to plot at; null means do not plot (a corrected age before term).
 */
function correctedAge(chronologicalDays, gestationalAgeDays) {
  if (typeof chronologicalDays !== "number" || !Number.isFinite(chronologicalDays) || chronologicalDays < 0) {
    return { corrected: false, ageDays: null, reason: "AGE_UNKNOWN" };
  }
  if (typeof gestationalAgeDays !== "number" || !Number.isFinite(gestationalAgeDays) || gestationalAgeDays <= 0) {
    return { corrected: false, ageDays: chronologicalDays, reason: "GA_UNKNOWN" };
  }
  if (gestationalAgeDays >= PRETERM_BELOW_WEEKS * 7) return { corrected: false, ageDays: chronologicalDays, reason: "TERM" };
  if (chronologicalDays / DAYS_PER_MONTH >= CORRECT_UNTIL_MONTHS) return { corrected: false, ageDays: chronologicalDays, reason: "PAST_24_MONTHS" };
  const ageDays = chronologicalDays - (280 - gestationalAgeDays);
  if (ageDays < 0) return { corrected: true, ageDays: null, reason: "BEFORE_TERM" };
  return { corrected: true, ageDays, reason: "PRETERM" };
}

/**
 * The centile lines for an age-based indicator between two ages, sampled at `points` ages. A point with no reference
 * row is left out, never extrapolated.
 */
function centileLines(indicator, sex, fromDays, toDays, points, ref = CDC2000) {
  const n = Math.max(2, points || 40), out = [];
  for (const c of CHART_CENTILES) {
    const z = zForCentile(c), pts = [];
    for (let i = 0; i < n; i++) {
      const d = fromDays + ((toDays - fromDays) * i) / (n - 1);
      const lms = lmsFor(indicator, sex, d, undefined, ref);
      if (lms.ok) pts.push([Math.round(d * 10) / 10, Math.round(valueAtZ(z, lms.l, lms.m, lms.s) * 1000) / 1000]);
    }
    out.push({ centile: c, points: pts });
  }
  return out;
}

export {
  DAYS_PER_MONTH, INDICATORS, ADJUSTED, CDC_EXTREME, CHART_CENTILES, PRETERM_BELOW_WEEKS, CORRECT_UNTIL_MONTHS, METHODS, CDC2000,
  zscoreLms, zscoreAdjusted, valueAtZ, modifiedZ, normalCdf, zForCentile, interpolate, lmsFor, standardLenhei,
  growthZ, correctedAge, centileLines, hospitalReference,
};
