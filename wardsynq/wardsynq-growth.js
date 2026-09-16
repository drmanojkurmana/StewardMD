/* wardsynq/wardsynq-growth.js — WHO growth z-scores and centiles, and corrected age for preterm infants.
 *
 * THE METHOD IS WHO'S OWN, NOT A RE-DERIVATION. Every rule below is read from WHO's official R code,
 * and each function names the file it follows:
 *   anthro (0 to 5 years, WHO Child Growth Standards 2006), github.com/WorldHealthOrganization/anthro
 *     R/z-score-helper.R       compute_zscore, compute_zscore_adjusted, round_up, adjust_lenhei,
 *                              apply_zscore_and_growthstandards, anthro_zscore_adjusted
 *     R/z-score.R              anthro_zscores: height measured under 9 months is implausible
 *     R/z-score-weight-for-age.R, -length-for-age.R, -bmi-for-age.R, -head-circumference-for-age.R
 *     R/z-score-weight-for-lenhei.R   0.1 cm interpolation, 45-110 cm lying / 65-120 cm standing
 *     R/utils.R, R/anthro-package.R   age in months = days / 30.4375
 *   anthroplus (5 to 19 years, WHO 2007 reference), github.com/WorldHealthOrganization/anthroplus
 *     R/zscores.R              zscore_indicator: month interpolation, 60 <= months < 121 (weight)
 *                              or < 229 (height, BMI)
 *
 * WHICH INDICATORS GET THE RESTRICTED ADJUSTMENT. WHO applies its |z| > 3 adjustment (distance
 * beyond the 3 SD line measured in units of the 2-to-3 SD gap) to weight-for-age, weight-for-length,
 * weight-for-height and BMI-for-age, because those distributions are skewed in the tails. It does
 * NOT apply it to length/height-for-age or head circumference-for-age. This file does exactly that.
 *
 * TABLE CHOICE. The 2006 standards for age under 60 months (days / 30.4375 < 60, anthro's
 * valid_age), the 2007 reference from 60 months (anthroplus's lower bound). WHO publishes no head
 * circumference or weight-for-length/height reference past 5 years, and no weight-for-age past
 * 121 months; those are refused, not extrapolated.
 *
 * WHAT A REFUSAL LOOKS LIKE. Unknown sex, an unknown or negative age, a value that is not a positive
 * number, or an age or length outside the table: the result is {ok: false, code, reason}, never a
 * number. A centile nobody can compute must not look like one.
 *
 * CORRECTED AGE. Conventional rule, stated here once: a baby born before 37 completed weeks is
 * plotted at corrected age = chronological age minus (40 weeks minus gestational age at birth),
 * until 24 months chronological age, then at chronological age. Gestational age unknown means NO
 * correction, and the result says so. A corrected age before term (below zero) is refused: the WHO
 * standards start at a term birth and are not a preterm chart.
 *
 * DATA AND LICENCE. The LMS tables are wardsynq/data/who-growth-2006.json and who-growth-2007.json,
 * built from WHO's data-raw/growthstandards/*.txt; the citation, source and licence text travel
 * inside each file and in wardsynq/data/WHO-GROWTH-NOTICE.txt. The licence for commercial use is an
 * open question (vault/decisions/Decisions.md).
 *
 * ROUNDING. z is rounded to 2 decimals as WHO does (round(z, 2)); JavaScript rounds an exact half
 * up where R rounds to even, a difference only at the third decimal's exact .5.
 *
 * STATUS: IMPLEMENTED and TESTED against published WHO values. NOT clinically validated.
 *
 * node --test test/wardsynq-growth.test.mjs
 */

import WHO2006 from "./data/who-growth-2006.json";
import WHO2007 from "./data/who-growth-2007.json";

const DAYS_PER_MONTH = 30.4375;                 // anthro R/anthro-package.R ANTHRO_DAYS_OF_MONTH
const INDICATORS = Object.freeze(["wfa", "lhfa", "wfl", "wfh", "bmi", "hcfa"]);
const ADJUSTED = Object.freeze({ wfa: true, wfl: true, wfh: true, bmi: true, lhfa: false, hcfa: false });
/* Implausibility flags, anthro R/z-score-*.R flag_threshold and anthroplus R/zscores.R flag_scores. */
const FLAG = Object.freeze({ wfa: [-6, 5], lhfa: [-6, 6], wfl: [-5, 5], wfh: [-5, 5], bmi: [-5, 5], hcfa: [-5, 5] });
const PRETERM_BELOW_WEEKS = 37;
const CORRECT_UNTIL_MONTHS = 24;
const CHART_CENTILES = Object.freeze([3, 15, 50, 85, 97]);

/** anthro R/utils.R round_up: halves round up. */
function roundUp(x) { const f = Math.floor(x); return x - f >= 0.5 ? f + 1 : f; }

/** anthro R/z-score-helper.R compute_zscore. L = 0 is the log limit (no WHO table row has it). */
function zscoreLms(y, l, m, s) { return l === 0 ? Math.log(y / m) / s : (Math.pow(y / m, l) - 1) / (s * l); }

/** anthro R/z-score-helper.R compute_zscore_adjusted. */
function zscoreAdjusted(y, l, m, s) {
  const sd = (z) => valueAtZ(z, l, m, s);
  const z = zscoreLms(y, l, m, s);
  if (z > 3) return 3 + (y - sd(3)) / (sd(3) - sd(2));
  if (z < -3) return -3 + (y - sd(-3)) / (sd(-2) - sd(-3));
  return z;
}

/** The measurement at a given z (the inverse LMS transform), for drawing centile lines. */
function valueAtZ(z, l, m, s) { return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l); }

/* Standard normal CDF and its inverse. erf by Abramowitz and Stegun 7.1.26 (error below 1.5e-7),
 * ample for a centile shown to one decimal. */
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const e = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + e) / 2 : (1 - e) / 2;
}
function zForCentile(c) {                      // bisection on normalCdf; only used for the five chart lines
  let lo = -8, hi = 8;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (normalCdf(mid) * 100 < c) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

const index = new Map();
/** Rows keyed by integer age (days or months) or by length in tenths of a cm. */
function rowsOf(ref, indicator, sex) {
  const key = `${ref}:${indicator}:${sex}`;
  if (!index.has(key)) {
    const t = (ref === "who2006" ? WHO2006 : WHO2007).indicators[indicator];
    const m = new Map();
    if (t) for (const r of t[sex]) m.set(Math.round(r[0] * (t.unit_x === "cm" ? 10 : 1)), r);
    index.set(key, m);
  }
  return index.get(key);
}

const refuse = (code, reason) => ({ ok: false, code, reason });

/** Which reference applies, and the L, M, S for this age (and length, for weight-for-length). */
function lmsFor(indicator, sex, ageDays, lenheiCm) {
  if (!INDICATORS.includes(indicator)) return refuse("UNKNOWN_INDICATOR", `unknown growth indicator ${indicator}`);
  if (sex !== "male" && sex !== "female") return refuse("SEX_UNKNOWN", "sex is not recorded as male or female, so no WHO reference can be chosen");
  if (typeof ageDays !== "number" || !Number.isFinite(ageDays) || ageDays < 0) return refuse("AGE_UNKNOWN", "the age is not established");
  const months = ageDays / DAYS_PER_MONTH;

  if (months < 60) {
    // anthro: 0 to 5 years, WHO Child Growth Standards 2006.
    const day = roundUp(ageDays);
    if (indicator === "wfl" || indicator === "wfh") {
      // anthro R/z-score-weight-for-lenhei.R: the table follows the age (lying under 731 days), and the
      // L, M, S are interpolated between the two 0.1 cm rows either side.
      const lying = day < 731;
      const ind = lying ? "wfl" : "wfh";
      const [min, max] = lying ? [45, 110] : [65, 120];
      if (!(typeof lenheiCm === "number" && lenheiCm >= min && lenheiCm <= max)) {
        return refuse("OUT_OF_RANGE", `weight-for-${lying ? "length" : "height"} covers ${min} to ${max} cm`);
      }
      const low = Math.trunc(lenheiCm * 10), upp = Math.trunc(lenheiCm * 10 + 1);
      const diff = (lenheiCm - low / 10) / 0.1;
      const rows = rowsOf("who2006", ind, sex), a = rows.get(low), b = rows.get(upp);
      if (!a) return refuse("OUT_OF_RANGE", "no WHO row for this length");
      if (diff > 0 && !b) return refuse("OUT_OF_RANGE", "no WHO row for this length");
      const lerp = (i) => (diff > 0 ? a[i] + diff * (b[i] - a[i]) : a[i]);
      return { ok: true, reference: "who2006", indicator: ind, l: lerp(1), m: lerp(2), s: lerp(3) };
    }
    const r = rowsOf("who2006", indicator, sex).get(day);
    if (!r) return refuse("OUT_OF_RANGE", "no WHO row for this age");
    return { ok: true, reference: "who2006", indicator, l: r[1], m: r[2], s: r[3] };
  }

  // anthroplus: 5 to 19 years, WHO 2007 reference, R/zscores.R zscore_indicator.
  if (indicator === "hcfa" || indicator === "wfl" || indicator === "wfh") {
    return refuse("OUT_OF_RANGE", "WHO publishes this indicator for children under 5 years only");
  }
  const upper = indicator === "wfa" ? 121 : 229;
  if (!(months >= 60 && months < upper)) {
    return refuse("OUT_OF_RANGE", indicator === "wfa" ? "WHO weight-for-age stops at 10 years" : "the WHO reference stops at 19 years");
  }
  const low = Math.trunc(months), upp = Math.trunc(months + 1), diff = months - low;
  const rows = rowsOf("who2007", indicator, sex), a = rows.get(low), b = rows.get(upp);
  if (!a || (diff > 0 && !b)) return refuse("OUT_OF_RANGE", "no WHO row for this age");
  const lerp = (i) => (diff > 0 ? a[i] + diff * (b[i] - a[i]) : a[i]);
  return { ok: true, reference: "who2007", indicator, l: lerp(1), m: lerp(2), s: lerp(3) };
}

/**
 * anthro R/z-score-helper.R adjust_lenhei and R/z-score.R: all z-scores are length-based under 731
 * days and height-based from 731 days, so a standing height under 731 days gains 0.7 cm and a lying
 * length from 731 days loses 0.7 cm. A standing height under 9 months is implausible and is not
 * converted (WHO sets the position to missing). position: "lying" | "standing" | null (not recorded).
 */
function standardLenhei(lenheiCm, ageDays, position) {
  const day = roundUp(ageDays);
  if (position === "standing" && ageDays / DAYS_PER_MONTH < 9) return { cm: lenheiCm, positionImplausible: true, positionAssumed: false };
  if (position === "standing" && day < 731) return { cm: lenheiCm + 0.7, positionImplausible: false, positionAssumed: false };
  if (position === "lying" && day >= 731) return { cm: lenheiCm - 0.7, positionImplausible: false, positionAssumed: false };
  return { cm: lenheiCm, positionImplausible: false, positionAssumed: position !== "lying" && position !== "standing" };
}

/**
 * One measurement's z-score and centile.
 * @param {{indicator: string, sex: string, ageDays: number, value: number, lenheiCm?: number, position?: string}} p
 *   value: kg (wfa, wfl, wfh), cm (lhfa, hcfa) or kg/m2 (bmi); lenheiCm for weight-for-length/height.
 */
function growthZ(p) {
  p = p || {};
  if (!(typeof p.value === "number" && Number.isFinite(p.value) && p.value > 0)) return refuse("VALUE_INVALID", "the measurement is not a positive number");
  let value = p.value, lenhei = p.lenheiCm, positionNote = null;
  if (p.indicator === "lhfa" || p.indicator === "wfl" || p.indicator === "wfh") {
    const raw = p.indicator === "lhfa" ? p.value : p.lenheiCm;
    if (!(typeof raw === "number" && raw > 0) || !(typeof p.ageDays === "number" && p.ageDays >= 0)) {
      if (p.indicator !== "lhfa") return refuse("VALUE_INVALID", "a length or height is needed");
    } else {
      positionNote = standardLenhei(raw, p.ageDays, p.position || null);
      if (p.indicator === "lhfa") value = positionNote.cm; else lenhei = positionNote.cm;
    }
  }
  const lms = lmsFor(p.indicator, p.sex, p.ageDays, lenhei);
  if (!lms.ok) return lms;
  const raw = ADJUSTED[p.indicator] ? zscoreAdjusted(value, lms.l, lms.m, lms.s) : zscoreLms(value, lms.l, lms.m, lms.s);
  if (!Number.isFinite(raw)) return refuse("OUT_OF_RANGE", "no z-score can be computed for this value");
  const z = Math.round(raw * 100) / 100;
  const [lo, hi] = FLAG[p.indicator];
  return {
    ok: true, reference: lms.reference, indicator: lms.indicator, z,
    centile: Math.round(normalCdf(raw) * 1000) / 10,
    implausible: z < lo || z > hi,
    positionAssumed: !!(positionNote && positionNote.positionAssumed),
    positionImplausible: !!(positionNote && positionNote.positionImplausible),
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
 * The centile lines (3, 15, 50, 85, 97) for an age-based indicator between two ages, sampled at
 * `points` ages. A point with no reference is left out, never extrapolated.
 */
function centileLines(indicator, sex, fromDays, toDays, points) {
  const n = Math.max(2, points || 40), out = [];
  for (const c of CHART_CENTILES) {
    const z = zForCentile(c), pts = [];
    for (let i = 0; i < n; i++) {
      const d = fromDays + ((toDays - fromDays) * i) / (n - 1);
      const lms = lmsFor(indicator, sex, d);
      if (lms.ok) pts.push([Math.round(d * 10) / 10, Math.round(valueAtZ(z, lms.l, lms.m, lms.s) * 1000) / 1000]);
    }
    out.push({ centile: c, points: pts });
  }
  return out;
}

const REFERENCES = Object.freeze({
  who2006: { citation: WHO2006.citation, source: WHO2006.source, licence: WHO2006.licence },
  who2007: { citation: WHO2007.citation, source: WHO2007.source, licence: WHO2007.licence },
});

export {
  DAYS_PER_MONTH, INDICATORS, ADJUSTED, CHART_CENTILES, PRETERM_BELOW_WEEKS, CORRECT_UNTIL_MONTHS, REFERENCES,
  roundUp, zscoreLms, zscoreAdjusted, valueAtZ, normalCdf, zForCentile, lmsFor, standardLenhei,
  growthZ, correctedAge, centileLines,
};
