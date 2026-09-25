/* medcore/medcore-calibration.js — confidence, out-of-distribution, and the policy for saying no.
 *
 * The model produces a number. This file decides what that number is worth and, more often than is
 * comfortable, that it is worth nothing and must not be shown.
 *
 * FOUR RULES.
 *
 *  1. ABSTENTION IS CHECKED BEFORE THE MODEL RUNS, NOT AFTER. Whether the minimum inputs exist is a
 *     deterministic question about the state, answered by medcore-outcomes.js, and answering it
 *     first means no probability is ever computed for a patient we cannot assess. A number computed
 *     and then discarded has a way of turning up in a log, a debug panel or a later refactor.
 *  2. INSUFFICIENT INFORMATION AND ABSTAIN ARE DIFFERENT ANSWERS. "Nobody has charted a MAP" sends
 *     a clinician to measure one. "This patient looks unlike anything in training" sends them to
 *     ignore the model. Collapsing both into a shrug loses the action.
 *  3. CONFIDENCE IS A PROPERTY OF THE VALIDATION DATA, NOT AN OPINION. The band at a probability is
 *     the Wilson interval on the observed rate in that decile of validation: "of the validation
 *     patients who scored around here, this fraction had the event". It is NOT a posterior over
 *     this patient and must never be rendered as one. A wide band means the split held few patients
 *     at that score, which is a fact about us, not about them.
 *  4. A BAND NOBODY MEASURED IS NOT A NARROW BAND. A decile with no validation rows returns null
 *     confidence, and a decision carrying null confidence is downgraded to ABSTAIN rather than
 *     shown with a bare number.
 *
 * PURE. No DOM, no I/O, no clock, no model of its own.
 *
 * node --test test/medcore-decide.test.mjs
 */

export const STATUS = {
  OK: "OK",
  INSUFFICIENT_INFORMATION: "INSUFFICIENT_INFORMATION",
  ABSTAIN: "ABSTAIN"
};

export const ABSTAIN_REASON = {
  OUT_OF_DISTRIBUTION: "OUT_OF_DISTRIBUTION",
  NO_CONFIDENCE_BAND: "NO_CONFIDENCE_BAND",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  EXCLUDED_FROM_RISK_SET: "EXCLUDED_FROM_RISK_SET",
  UNKNOWN_STATUS: "UNKNOWN_STATUS"
};

/**
 * The confidence band for a calibrated probability: the Wilson interval on the observed rate in
 * that decile of validation. Null when that decile held no validation rows (rule 4).
 */
export function confidenceFor(artifact, p) {
  const bands = artifact && artifact.confidenceBands;
  if (!Array.isArray(bands) || !bands.length) return null;
  for (const b of bands) {
    const inBand = (b.hi >= 1) ? (p >= b.lo && p <= b.hi) : (p >= b.lo && p < b.hi);
    if (!inBand) continue;
    if (!b.n || !b.ci) return null;                 // measured nothing here
    return { lo: b.ci.lo, hi: b.ci.hi, n: b.n, observed: b.observed, basis: "validation-decile" };
  }
  return null;
}

/**
 * Is this patient inside the distribution the model was fitted on?
 * @returns {{ood:boolean, distance:number|null, threshold:number|null}}
 */
export function oodVerdict(artifact, distance) {
  const threshold = artifact && artifact.ood ? artifact.ood.threshold : null;
  if (distance === null || distance === undefined || threshold === null) {
    return { ood: false, distance: distance === undefined ? null : distance, threshold, unmeasured: true };
  }
  return { ood: distance > threshold, distance, threshold, unmeasured: false };
}

/**
 * The whole policy in one place: given what the deterministic layer already decided and what the
 * model produced, what is the status of this decision?
 *
 * @param {{ask:object, artifact:object|null, probability:number|null, distance:number|null}} input
 * @returns {{status:string, reason:string[]|null, confidence:object|null, ood:object|null}}
 */
export function verdict(input) {
  const ask = input.ask || {};

  // Rule 1 and 2: the deterministic answers come first and keep their own names.
  if (!ask.askable) {
    if (ask.reason === "INSUFFICIENT_INFORMATION") {
      return { status: STATUS.INSUFFICIENT_INFORMATION, reason: null, missing: ask.detail && ask.detail.missing, confidence: null, ood: null };
    }
    const reason = ask.reason === "EXCLUDED_FROM_RISK_SET" ? ABSTAIN_REASON.EXCLUDED_FROM_RISK_SET
      : ask.reason === "UNKNOWN_STATUS" ? ABSTAIN_REASON.UNKNOWN_STATUS
        : ask.reason || ABSTAIN_REASON.MODEL_UNAVAILABLE;
    return { status: STATUS.ABSTAIN, reason: [reason], detail: ask.detail || null, confidence: null, ood: null };
  }

  if (!input.artifact || input.probability === null || input.probability === undefined) {
    return { status: STATUS.ABSTAIN, reason: [ABSTAIN_REASON.MODEL_UNAVAILABLE], confidence: null, ood: null };
  }

  const ood = oodVerdict(input.artifact, input.distance);
  if (ood.ood) {
    return { status: STATUS.ABSTAIN, reason: [ABSTAIN_REASON.OUT_OF_DISTRIBUTION], confidence: null, ood };
  }

  const confidence = confidenceFor(input.artifact, input.probability);
  if (!confidence) {                                 // rule 4
    return { status: STATUS.ABSTAIN, reason: [ABSTAIN_REASON.NO_CONFIDENCE_BAND], confidence: null, ood };
  }

  return { status: STATUS.OK, reason: null, confidence, ood };
}
