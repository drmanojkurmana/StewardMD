/* wardsynq/wardsynq-pews.js — the third population this build refused and then owed something to.
 *
 * NEWS2 refuses children and points at PEWS. Paediatrics closed the threshold half of that debt and
 * obstetrics closed the obstetric one; this closes the last of it. A refusal with nothing behind it
 * leaves the refused population LESS protected than before, because it also removes whatever crude
 * signal they were getting.
 *
 * THE FACT THIS FILE IS SHAPED BY. A child's normal is not a number, it is a curve. A heart rate of
 * 150 is unremarkable in a two-month-old and a peri-arrest finding in a twelve-year-old, and a
 * respiratory rate of 20 is normal at eight and ominous at three months. There is no single set of
 * bands that works, which is exactly why applying an adult chart to a child is not slightly wrong
 * but categorically wrong, and why wardsynq-paediatrics.js refuses to do it.
 *
 *   1. EVERY BAND IS PER AGE BAND. Nothing here has a value that applies to all children. The
 *      bands come from wardsynq-paediatrics.js, and a patient whose band cannot be established is
 *      REFUSED rather than scored against the nearest guess.
 *   2. THE PARENT IS A PARAMETER. "The parent is worried" is one of the better-performing single
 *      predictors of paediatric deterioration in the literature and is absent from most charts
 *      because it is not a number. It scores here, and it can escalate on its own.
 *   3. RESPIRATORY EFFORT IS NOT RESPIRATORY RATE. A tiring child's rate FALLS as they decompensate,
 *      so rate alone inverts at exactly the wrong moment. Effort, recession and grunting carry what
 *      the rate stops carrying, and a normal rate with severe effort is scored as severe.
 *   4. A MISSING PARAMETER IS NOT ZERO, the same rule as NEWS2 and for the same reason.
 *   5. NEONATES ARE OUT OF SCOPE. A neonatal chart is a different instrument with different
 *      parameters, and the neonatal population is where a wrong score does the most harm. They are
 *      refused and told where to go, rather than approximated.
 *
 * PROVENANCE: the parameter set and the trigger structure follow the widely published paediatric
 * early warning charts. THE EXACT BANDS ARE UNAPPROVED and vary between every unit that uses one.
 * The paediatric lead owns them. This matters more here than for adults, because a child's normal
 * range is narrow and the cost of a wrong band is a false alarm on every well child or silence on
 * a sick one.
 *
 * NOT MODELLED: neonatal early warning, PICU-specific scoring, gestational-age correction, growth
 * centiles, and any local escalation policy.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-pews.test.mjs
 */

import { ageBandOf, BAND, isPaediatric } from "./wardsynq-paediatrics.js";
import { gatherVitals } from "./wardsynq-vitals.js";

/**
 * Age-banded normal ranges. UNAPPROVED.
 *
 * Read the shape rather than the numbers: every parameter is a different range in every band, and
 * that is the whole argument for why an adult chart cannot be reused.
 */
const BANDS = Object.freeze({
  [BAND.INFANT]: {      // 29 days to 12 months
    respiratoryRate: { low: 25, high: 60 },
    pulse: { low: 100, high: 160 },
    systolicBloodPressure: { low: 70, high: 100 },
  },
  [BAND.TODDLER]: {     // 1 to 2 years
    respiratoryRate: { low: 20, high: 40 },
    pulse: { low: 90, high: 150 },
    systolicBloodPressure: { low: 75, high: 105 },
  },
  [BAND.CHILD]: {       // 3 to 11
    respiratoryRate: { low: 16, high: 30 },
    pulse: { low: 70, high: 130 },
    systolicBloodPressure: { low: 80, high: 115 },
  },
  [BAND.ADOLESCENT]: {  // 12 to 17
    respiratoryRate: { low: 12, high: 24 },
    pulse: { low: 55, high: 110 },
    systolicBloodPressure: { low: 90, high: 130 },
  },
});

/** Respiratory effort, which carries what the rate stops carrying in a tiring child. */
const EFFORT = Object.freeze({ NORMAL: "normal", MILD: "mild", MODERATE: "moderate", SEVERE: "severe" });
const EFFORT_SCORE = Object.freeze({ [EFFORT.NORMAL]: 0, [EFFORT.MILD]: 1, [EFFORT.MODERATE]: 2, [EFFORT.SEVERE]: 3 });

/** AVPU. As in the adult charts, anything but Alert is significant. */
const AVPU = Object.freeze(["A", "V", "P", "U"]);

const RISK = Object.freeze({ LOW: "low", MEDIUM: "medium", HIGH: "high" });

/** LOINC, so a feed can build a chart without the caller mapping by hand. */
const PEWS_LOINC = Object.freeze({
  "9279-1": "respiratoryRate",
  "8867-4": "pulse",
  "8480-6": "systolicBloodPressure",
  "2708-6": "oxygenSaturation",
  "59408-5": "oxygenSaturation",
  "80339-5": "consciousness",
  "8310-5": "temperature",
});

const REQUIRED = Object.freeze([
  "respiratoryRate", "respiratoryEffort", "oxygenSaturation",
  "pulse", "capillaryRefillSeconds", "consciousness",
]);

class PewsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PewsError";
    this.code = code || "PEWS_VIOLATION";
  }
}

/** Distance outside a band, scored 0 to 3. Below is scored harder: a low rate in a child is late. */
function scoreAgainst(value, range, { lowIsWorse = false } = {}) {
  if (!range || typeof value !== "number" || !Number.isFinite(value)) return null;
  const span = range.high - range.low;
  if (value >= range.low && value <= range.high) return 0;

  const out = value < range.low ? (range.low - value) / span : (value - range.high) / span;
  const base = out > 0.5 ? 3 : out > 0.25 ? 2 : 1;
  // A falling rate or pressure in a child is a late sign, not a mild one: it is scored up.
  return lowIsWorse && value < range.low ? Math.min(3, base + 1) : base;
}

/**
 * PEWS for one child.
 *
 * @param {object} values
 * @param {object} patient
 * @param {string} [nowIso]
 */
function pews(values, patient, nowIso) {
  values = values || {};
  const banding = ageBandOf(patient || {}, nowIso);
  const refuse = (reason, code) => ({
    scorable: false, total: null, risk: null, band: banding.band,
    parameters: {}, missing: [], reason, code,
    // Attached to every refusal, because a refusal that reads as reassurance is the failure this
    // whole family of modules exists to avoid.
    note: "A refusal is not a reassurance. This child has not been assessed by this chart.",
  });

  if (banding.band === BAND.UNKNOWN) {
    return refuse("this patient's age band is not established, and a child's normal range is a curve rather than a number, so there is no band to score against", "NO_BAND");
  }
  if (banding.band === BAND.NEONATE) {
    return refuse(
      "PEWS does not cover neonates. A neonatal chart is a different instrument with different parameters, and the neonatal population is where a wrong score does the most harm, so this refuses rather than approximating",
      "NEONATE");
  }
  if (banding.band === BAND.ADULT) {
    return refuse("this patient bands as an adult; use NEWS2 (wardsynq-deterioration.js)", "NOT_PAEDIATRIC");
  }
  if (!isPaediatric(banding.band)) return refuse(`no PEWS bands for ${banding.band}`, "NO_BAND");

  const ranges = BANDS[banding.band];
  if (!ranges) return refuse(`this chart has no bands for ${banding.band}`, "NO_BAND");

  const parameters = {};
  const missing = [];
  const put = (name, raw, points) => {
    if (points === null || points === undefined) { missing.push(name); return; }
    parameters[name] = { value: raw, points };
  };

  put("respiratoryRate", values.respiratoryRate,
    scoreAgainst(values.respiratoryRate, ranges.respiratoryRate, { lowIsWorse: true }));

  const effort = values.respiratoryEffort;
  put("respiratoryEffort", effort, EFFORT_SCORE[effort] ?? null);

  const spo2 = values.oxygenSaturation;
  put("oxygenSaturation", spo2,
    typeof spo2 !== "number" ? null : spo2 >= 95 ? 0 : spo2 >= 92 ? 1 : spo2 >= 90 ? 2 : 3);

  put("pulse", values.pulse, scoreAgainst(values.pulse, ranges.pulse, { lowIsWorse: true }));

  // Optional: blood pressure is not measured on every paediatric observation round, and demanding
  // it would make every routine set incomplete, which trains people to ignore incompleteness.
  if (typeof values.systolicBloodPressure === "number") {
    parameters.systolicBloodPressure = {
      value: values.systolicBloodPressure,
      points: scoreAgainst(values.systolicBloodPressure, ranges.systolicBloodPressure, { lowIsWorse: true }),
    };
  }

  const crt = values.capillaryRefillSeconds;
  put("capillaryRefillSeconds", crt,
    typeof crt !== "number" ? null : crt <= 2 ? 0 : crt <= 3 ? 1 : crt <= 4 ? 2 : 3);

  const avpu = typeof values.consciousness === "string" ? values.consciousness.trim().toUpperCase() : null;
  put("consciousness", values.consciousness, avpu && AVPU.includes(avpu) ? (avpu === "A" ? 0 : 3) : null);

  // The parameter most charts leave out. It is one of the better single predictors of paediatric
  // deterioration and it is absent from most instruments because it is not a number.
  const worried = values.parentConcerned === true;
  if (values.parentConcerned !== undefined) parameters.parentConcerned = { value: worried, points: worried ? 2 : 0 };

  const total = Object.values(parameters).reduce((n, p) => n + p.points, 0);
  const singleThree = Object.keys(parameters).filter((k) => parameters[k].points === 3);

  if (missing.length) {
    return {
      scorable: false, partial: true, total, risk: null, band: banding.band,
      parameters, missing, singleParameterThree: singleThree,
      code: "INCOMPLETE",
      reason: `incomplete: ${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} not recorded, so the partial total of ${total} is not a risk assessment`,
      note: "A refusal is not a reassurance. This child has not been assessed by this chart.",
    };
  }

  let risk;
  if (total >= 7 || singleThree.length >= 2) risk = RISK.HIGH;
  else if (total >= 4 || singleThree.length === 1) risk = RISK.MEDIUM;
  else risk = RISK.LOW;

  // Parental concern can escalate on its own, whatever the numbers say. This is the point of
  // including it: the numbers were normal in most of the cases that generated the literature.
  const parentEscalates = worried && risk === RISK.LOW;
  if (parentEscalates) risk = RISK.MEDIUM;

  return {
    scorable: true, partial: false, total, risk, band: banding.band,
    parameters, missing: [], singleParameterThree: singleThree,
    reason: null, code: null,
    parentEscalated: parentEscalates,
    escalation: risk === RISK.HIGH ? "Immediate paediatric review, and consider the paediatric emergency team."
      : risk === RISK.MEDIUM ? "Urgent paediatric review and repeat observations within the hour."
        : "Continue routine observations.",
    advice: worried
      ? "The parent is concerned. That is a recorded clinical finding here, not a courtesy: it is one of the better single predictors of paediatric deterioration and it outperforms several of the numbers on this chart."
      : "A child compensates until they do not. A normal blood pressure in a sick child is a late reassurance, not an early one.",
  };
}

/** PEWS from observations, through the same gatherer as NEWS2 and MEOWS. */
function pewsFromObservations(observations, patient, opts = {}) {
  const gathered = gatherVitals(observations, { codeMap: PEWS_LOINC, now: opts.now, freshnessMs: opts.freshnessMs });
  const merged = { ...gathered.values, ...(opts.values || {}) };
  const result = pews(merged, patient, opts.now);
  return { ...result, sources: gathered.sources, rejected: gathered.rejected };
}

export {
  BANDS, EFFORT, EFFORT_SCORE, AVPU, RISK, PEWS_LOINC, REQUIRED, PewsError,
  scoreAgainst, pews, pewsFromObservations,
};
