/* wardsynq/wardsynq-quality.js — core measures, and the denominator nobody looks at.
 *
 * Hospital quality measures are reported to regulators, published to the public, and used to decide
 * funding and careers. That makes them the most incentivised numbers in the building, and it means a
 * measure engine's real job is not arithmetic. Numerator over denominator is trivial. Everything
 * that decides whether the number means anything is elsewhere:
 *
 *   1. THE DENOMINATOR IS THE ATTACK SURFACE. Nobody improves a mortality rate by falsifying deaths;
 *      deaths are hard to hide. They improve it by removing patients from the denominator. Every
 *      exclusion here must carry a REASON, is COUNTED by reason, and is reported beside the rate,
 *      never quietly applied. A measure that reports a ratio and not its exclusions is not a
 *      measurement, it is a claim.
 *   2. A SMALL DENOMINATOR IS NOT A RATE. One death in three patients is not "33 percent mortality",
 *      it is three patients. Below a minimum denominator this refuses to express a rate at all,
 *      because a percentage printed on a dashboard will be compared with a percentage from a unit
 *      that had four hundred patients, and nothing on the screen will say they are different kinds
 *      of number.
 *   3. AN UNADJUSTED RATE CANNOT BE COMPARED. Two units' raw mortality differ mostly by case mix. No
 *      risk model is implemented here, so `compare()` REFUSES to rank rather than producing a league
 *      table that looks authoritative and is not.
 *   4. EVIDENCE QUALITY TRAVELS WITH THE NUMBER. A sepsis bundle compliance of 95 percent computed
 *      over elements a human attested is a fact about paperwork. wardsynq-bundle-binding.js already
 *      separates derived from attested, and that split is carried into the measure rather than
 *      averaged away.
 *   5. A DEFINITION CHANGE BREAKS A TREND. Every result carries the definition id and version it was
 *      computed with, and `trend()` refuses to draw a line across a version change.
 *
 * WHAT THIS IS NOT. It is not a regulatory submission and it computes no nationally specified
 * measure to its official definition. The measures here are structurally faithful and their exact
 * inclusion and exclusion criteria are UNAPPROVED. It also performs no risk adjustment of any kind.
 *
 * NOT MODELLED: risk adjustment and case-mix models, observed-over-expected ratios, standardised
 * infection ratios requiring national baselines, statistical process control, funnel plots and
 * confidence intervals beyond the crude small-denominator guard.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-quality.test.mjs
 */

/**
 * Below this many eligible cases, no rate is expressed. A local policy and a crude one: the right
 * answer is a confidence interval, which is not modelled, so the guard is deliberately blunt rather
 * than precise-looking.
 */
const MIN_DENOMINATOR = 20;

const EXCLUSION = Object.freeze({
  NOT_ELIGIBLE: "not-eligible",         // never met the measure's population definition
  CLINICAL: "clinical-exclusion",       // a documented clinical reason the measure itself allows
  DATA_MISSING: "data-missing",         // we cannot tell, which is NOT the same as not eligible
});

class QualityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "QualityError";
    this.code = code || "QUALITY_VIOLATION";
  }
}

/**
 * A measure definition.
 *
 * `population` decides eligibility, `exclude` returns a reason string or null, and `met` decides the
 * numerator. Splitting eligibility from exclusion is the point: "was never in this population" and
 * "was in it and we took them out" are different facts and get counted separately.
 */
function defineMeasure({ id, version, label, description, population, exclude, met, higherIsBetter = true, minDenominator = MIN_DENOMINATOR }) {
  if (!id || !version) throw new QualityError("a measure needs an id and a version; a trend across a definition change is not a trend", "NO_VERSION");
  if (typeof population !== "function" || typeof met !== "function") {
    throw new QualityError("a measure needs population() and met()", "INCOMPLETE_DEFINITION");
  }
  return Object.freeze({
    id, version, label: label || id, description: description || null,
    population, exclude: exclude || (() => null), met, higherIsBetter, minDenominator,
  });
}

/**
 * Computes a measure over a set of cases.
 *
 * Returns exclusions in full, and refuses to express a rate on a denominator too small to carry one.
 *
 * @param {object} measure from defineMeasure
 * @param {object[]} cases
 * @param {{period?: {from: string, to: string}, unit?: string}} [ctx]
 */
function computeMeasure(measure, cases, ctx = {}) {
  if (!measure) throw new QualityError("no measure", "NO_MEASURE");
  cases = cases || [];

  const eligible = [];
  const excluded = [];
  const notInPopulation = [];

  for (const c of cases) {
    if (!measure.population(c)) { notInPopulation.push(c); continue; }
    const reason = measure.exclude(c);
    if (reason) {
      excluded.push({ caseId: c.id || null, reason: typeof reason === "string" ? reason : reason.reason, kind: (reason && reason.kind) || EXCLUSION.CLINICAL });
      continue;
    }
    eligible.push(c);
  }

  const numerator = eligible.filter((c) => measure.met(c) === true).length;
  const denominator = eligible.length;

  // Every exclusion, grouped. A single count of "42 excluded" tells nobody anything; 41 of them for
  // one reason is the interesting shape and is the shape denominator manipulation makes.
  const byReason = {};
  for (const e of excluded) byReason[e.reason] = (byReason[e.reason] || 0) + 1;

  const tooSmall = denominator < measure.minDenominator;
  const rate = denominator === 0 || tooSmall ? null : numerator / denominator;

  return {
    measureId: measure.id,
    // Carried so a consumer can tell whether two results are the same measure. A trend drawn across
    // a version change is a picture of a definition changing, not of care changing.
    version: measure.version,
    label: measure.label,
    period: ctx.period || null,
    unit: ctx.unit || null,
    numerator,
    denominator,
    rate,
    ratePercent: rate === null ? null : Math.round(rate * 1000) / 10,
    // The three populations, kept apart on purpose.
    consideredCases: cases.length,
    notInPopulation: notInPopulation.length,
    excluded: excluded.length,
    exclusionsByReason: byReason,
    exclusionDetail: excluded,
    // The proportion of the eligible-or-excluded population that was excluded. This is the number an
    // auditor should look at first and the one a dashboard never shows.
    exclusionRate: (denominator + excluded.length) === 0 ? null : excluded.length / (denominator + excluded.length),
    suppressed: tooSmall,
    suppressionReason: tooSmall
      ? `${denominator} eligible cases is below the minimum of ${measure.minDenominator}; a percentage here would be compared with percentages from far larger populations and nothing would say they are different kinds of number`
      : null,
    reading: denominator === 0
      ? "No eligible cases."
      : tooSmall
        ? `${numerator} of ${denominator}. Reported as counts, deliberately, not as a rate.`
        : `${numerator} of ${denominator} (${Math.round((numerator / denominator) * 1000) / 10} percent), with ${excluded.length} excluded from a possible ${denominator + excluded.length}.`,
  };
}

/**
 * Folds bundle provenance into a compliance measure, so the number cannot be read without the
 * evidence quality behind it.
 *
 * @param {object} result from computeMeasure
 * @param {object} provenance from wardsynq-bundle-binding.js provenanceReport()
 */
function withEvidence(result, provenance) {
  if (!provenance) return { ...result, evidence: null };
  const derivedPercent = provenance.derivedPercent;
  return {
    ...result,
    evidence: {
      derivedPercent,
      derivedElements: provenance.derivedElements,
      attestedElements: provenance.attestedElements,
      // Not folded into the rate. Two numbers that mean different things should not be averaged into
      // one that means neither; they are shown together and the reader does the thinking.
      caution: derivedPercent !== null && derivedPercent < 50
        ? `This measure is computed over bundles whose elements are only ${derivedPercent} percent evidenced by another system's record. The rest rest on attestation, so this is substantially a measure of documentation.`
        : null,
    },
  };
}

/**
 * Refuses to rank units on unadjusted rates.
 *
 * This function exists to be a refusal. Writing `compare()` and having it return a sorted list is
 * the single easiest way for this file to do harm: a league table of raw mortality is a picture of
 * case mix, and it will be read as a picture of quality by people who will act on it.
 */
function compare(results, { riskAdjusted = false } = {}) {
  const rows = (results || []).map((r) => ({
    unit: r.unit, measureId: r.measureId, version: r.version,
    numerator: r.numerator, denominator: r.denominator,
    ratePercent: r.ratePercent, suppressed: r.suppressed,
  }));

  const versions = new Set(rows.map((r) => `${r.measureId}@${r.version}`));
  if (versions.size > 1) {
    return {
      comparable: false, rows, ranked: null,
      reason: `these results were computed with different measure definitions (${[...versions].join(", ")}); they are not the same measurement and cannot be placed side by side`,
    };
  }

  if (!riskAdjusted) {
    return {
      comparable: false, rows, ranked: null,
      reason: "these rates are NOT risk adjusted. Differences between units in an unadjusted rate are dominated by case mix, so a ranking would be a picture of which unit takes the sicker patients. No risk model is implemented in this build, so no ranking is produced.",
    };
  }

  // Reachable only when a caller asserts an adjustment this file did not perform. It is still not
  // ranked, because the assertion is the caller's and this file cannot verify it.
  return {
    comparable: true, rows, ranked: null,
    reason: "the caller asserts these rates are risk adjusted. This module performed no adjustment and cannot verify the claim, so it reports the rows and still declines to rank them.",
  };
}

/**
 * A series over time, refusing to draw a line across a definition change.
 */
function trend(results) {
  const rows = (results || []).slice().sort((a, b) => Date.parse((a.period || {}).from || 0) - Date.parse((b.period || {}).from || 0));
  const versions = [...new Set(rows.map((r) => `${r.measureId}@${r.version}`))];

  if (versions.length > 1) {
    return {
      continuous: false, rows, direction: null,
      reason: `the definition changed during this series (${versions.join(" then ")}). A line across that break shows a definition changing, not care changing. Plot the segments separately.`,
    };
  }

  const usable = rows.filter((r) => r.rate !== null);
  if (usable.length < 2) {
    return { continuous: true, rows, direction: null, reason: "fewer than two periods carry an expressible rate" };
  }

  const first = usable[0].rate;
  const last = usable[usable.length - 1].rate;
  const delta = last - first;
  const higherIsBetter = rows[0].higherIsBetter !== false;
  return {
    continuous: true, rows,
    direction: delta === 0 ? "flat" : delta > 0 ? "up" : "down",
    improving: delta === 0 ? null : (delta > 0) === higherIsBetter,
    deltaPercentagePoints: Math.round(delta * 1000) / 10,
    // No statistical claim. Two points and a subtraction is not a signal, and saying so is the whole
    // reason this field exists.
    reason: "a difference between two periods is not a trend and is not tested for significance here; statistical process control is not modelled",
  };
}

/* ------------------------------------------------------------------ the seeded measures */

const isDischarged = (c) => c.dischargedAt != null;

/**
 * The seed measures. UNAPPROVED and structurally faithful rather than officially specified: real
 * core measures carry pages of inclusion and exclusion criteria owned by a national body.
 */
const MEASURES = Object.freeze({
  INPATIENT_MORTALITY: defineMeasure({
    id: "inpatient-mortality", version: "0.1.0-unapproved",
    label: "Inpatient mortality",
    description: "Deaths among discharged inpatient episodes. UNAPPROVED seed definition, unadjusted.",
    higherIsBetter: false,
    population: (c) => c.encounterClass === "IPD" && isDischarged(c),
    exclude: (c) => {
      // The one exclusion real mortality measures universally allow, and the one most open to abuse:
      // a patient admitted for end-of-life care is not a failure of the admission. It is recorded by
      // reason and counted, so a unit whose palliative exclusions rise from 2 to 40 percent is visible.
      if (c.palliativeOnAdmission === true) return { reason: "admitted for palliative care", kind: EXCLUSION.CLINICAL };
      if (c.died === undefined || c.died === null) return { reason: "outcome not recorded", kind: EXCLUSION.DATA_MISSING };
      return null;
    },
    met: (c) => c.died === true,
  }),

  READMISSION_30D: defineMeasure({
    id: "readmission-30-day", version: "0.1.0-unapproved",
    label: "Unplanned readmission within 30 days",
    description: "UNAPPROVED seed definition. Planned readmissions are excluded and counted.",
    higherIsBetter: false,
    population: (c) => c.encounterClass === "IPD" && isDischarged(c),
    exclude: (c) => {
      if (c.died === true) return { reason: "died during the index admission", kind: EXCLUSION.NOT_ELIGIBLE };
      if (c.readmittedWithin30Days === undefined) return { reason: "follow-up window not complete", kind: EXCLUSION.DATA_MISSING };
      return null;
    },
    met: (c) => c.readmittedWithin30Days === true && c.readmissionPlanned !== true,
  }),

  SEPSIS_BUNDLE: defineMeasure({
    id: "sepsis-bundle-compliance", version: "0.1.0-unapproved",
    label: "Sepsis bundle completed within one hour",
    description: "Read the evidence block with this one: a compliant bundle may be compliant on attestation.",
    population: (c) => c.sepsisBundle != null,
    exclude: (c) => (c.sepsisBundle.state === "voided" ? { reason: "bundle voided", kind: EXCLUSION.NOT_ELIGIBLE } : null),
    met: (c) => c.sepsisBundle.compliant === true,
  }),
});

export {
  MIN_DENOMINATOR, EXCLUSION, MEASURES, QualityError,
  defineMeasure, computeMeasure, withEvidence, compare, trend,
};
