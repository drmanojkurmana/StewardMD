/* wardsynq/wardsynq-paediatrics.js — age banding, and refusing to treat a child as a small adult.
 *
 * Two verified hazards in this build carry the same caveat: the critical-result thresholds and the
 * dose ceilings are ADULT values, so a paediatric result classified against them would be wrong.
 * That caveat has been honest and unaddressed. This file addresses it, and the way it does so is by
 * REFUSING rather than by inventing paediatric numbers.
 *
 * THE CENTRAL RULE. A threshold or ceiling that does not state which age band it belongs to must
 * never be applied to a child. Not "applied with a warning", not "applied because it is probably
 * close enough": refused, and reported as unclassified. A potassium of 6.0 is a critical value in an
 * adult and an ordinary one in a neonate, and a haemoglobin of 9 means something different at three
 * days old than at thirty years. Silently reusing an adult number on a child is a decimal-point
 * error with a smaller patient attached.
 *
 * WHY THIS IS MOSTLY MECHANISM AND ALMOST NO CONTENT. Real paediatric limits vary by band, assay,
 * gestational age and local policy, and getting them wrong is worse than not having them. So this
 * file supplies the banding, the matching and the refusal, and the numbers stay in a pack that a
 * paediatrician signs. The seed pack it ships with is tiny and marked, exactly like the others.
 *
 * NEONATES ARE NOT ONE GROUP. A 26-week preterm on day 2 and a term baby on day 27 are both
 * "neonates" and share almost no reference range. Where gestational age is unknown, a neonatal
 * result is refused rather than banded by chronological age alone.
 *
 * NOT MODELLED: growth percentiles and centile crossing, gestational-age-corrected dosing, neonatal
 * bilirubin nomograms, body-surface-area dosing, and any drug-specific paediatric protocol.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-paediatrics.test.mjs
 */

/**
 * Age bands. Boundaries are the conventional ones and are themselves a clinical choice a site may
 * disagree with, so they are exported and can be replaced.
 */
const BAND = Object.freeze({
  NEONATE: "neonate",         // 0 to 28 days
  INFANT: "infant",           // 29 days to 12 months
  TODDLER: "toddler",         // 1 to 2 years
  CHILD: "child",             // 3 to 11 years
  ADOLESCENT: "adolescent",   // 12 to 17 years
  ADULT: "adult",             // 18 and over
  UNKNOWN: "unknown",         // age not established
});

const BANDS_IN_ORDER = Object.freeze([
  BAND.NEONATE, BAND.INFANT, BAND.TODDLER, BAND.CHILD, BAND.ADOLESCENT, BAND.ADULT,
]);

/** Everything below adult. Used for the refusal rule, so it is stated once. */
const PAEDIATRIC_BANDS = Object.freeze([BAND.NEONATE, BAND.INFANT, BAND.TODDLER, BAND.CHILD, BAND.ADOLESCENT]);

class PaediatricError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PaediatricError";
    this.code = code || "PAEDIATRIC_VIOLATION";
  }
}

/**
 * Resolves a patient's age band.
 *
 * Prefers a date of birth, because `ageYears: 0` is true of both a two-day-old and an eleven-month-
 * old and those are different patients. Falls back to ageYears where that is all there is, and says
 * so in the result, so a caller can tell a precise band from an inferred one.
 *
 * @param {{dob?: string, ageYears?: number, ageDays?: number, gestationalAgeWeeks?: number}} patient
 * @param {string} [nowIso]
 * @returns {{band: string, ageDays: number|null, precise: boolean, reason: string,
 *   gestationalAgeWeeks: number|null}}
 */
function ageBandOf(patient, nowIso) {
  patient = patient || {};
  const now = Date.parse(nowIso || new Date().toISOString());
  const gest = typeof patient.gestationalAgeWeeks === "number" ? patient.gestationalAgeWeeks : null;

  let ageDays = null;
  let precise = false;

  if (typeof patient.ageDays === "number" && Number.isFinite(patient.ageDays)) {
    ageDays = patient.ageDays; precise = true;
  } else if (patient.dob && !/^0{4}-0{2}-0{2}$/.test(patient.dob)) {
    const born = Date.parse(patient.dob);
    if (Number.isFinite(born)) { ageDays = Math.floor((now - born) / 86_400_000); precise = true; }
  }
  if (ageDays === null && typeof patient.ageYears === "number" && Number.isFinite(patient.ageYears)) {
    // Inferred, and marked as such: a stated age in whole years cannot distinguish a neonate from
    // an eleven-month-old, and that is precisely the distinction that matters most.
    ageDays = Math.round(patient.ageYears * 365.25);
    precise = patient.ageYears >= 2; // whole years are good enough from toddler upwards
  }

  if (ageDays === null || ageDays < 0) {
    return { band: BAND.UNKNOWN, ageDays: null, precise: false, gestationalAgeWeeks: gest,
      reason: "the patient's age is not established" };
  }

  let band;
  if (ageDays <= 28) band = BAND.NEONATE;
  else if (ageDays <= 365) band = BAND.INFANT;
  else if (ageDays <= 365 * 3) band = BAND.TODDLER;
  else if (ageDays <= 365 * 12) band = BAND.CHILD;
  else if (ageDays <= 365 * 18) band = BAND.ADOLESCENT;
  else band = BAND.ADULT;

  // A stated age of "0 years" lands in NEONATE by arithmetic while the patient could be eleven
  // months old. That is not a band, it is a guess, so it is downgraded to unknown.
  if (band === BAND.NEONATE && !precise) {
    return { band: BAND.UNKNOWN, ageDays, precise: false, gestationalAgeWeeks: gest,
      reason: "an age given only in whole years cannot distinguish a neonate from an older infant" };
  }

  return { band, ageDays, precise, gestationalAgeWeeks: gest,
    reason: `${ageDays} days old` };
}

const isPaediatric = (band) => PAEDIATRIC_BANDS.includes(band);

/**
 * Selects the entry from a pack that applies to this patient's band.
 *
 * This is the refusal. A pack entry with no `band` is treated as ADULT-ONLY, because that is what
 * every unbanded reference range in circulation actually is, and applying it to a child is the
 * error this file exists to prevent.
 *
 * @param {object|object[]} entry a single threshold or an array of banded variants
 * @param {string} band
 * @returns {{applies: boolean, entry: object|null, reason: string}}
 */
function forBand(entry, band) {
  if (!entry) return { applies: false, entry: null, reason: "no entry" };

  const variants = Array.isArray(entry) ? entry : [entry];
  const banded = variants.filter((v) => v && v.band);
  const unbanded = variants.filter((v) => v && !v.band);

  const match = banded.find((v) => v.band === band);
  if (match) return { applies: true, entry: match, reason: `banded entry for ${band}` };

  if (band === BAND.ADULT && unbanded.length) {
    return { applies: true, entry: unbanded[0], reason: "unbanded entry, applied to an adult" };
  }
  if (band === BAND.UNKNOWN) {
    return { applies: false, entry: null,
      reason: "the patient's age band is not established, so no reference range can be selected" };
  }
  if (isPaediatric(band)) {
    return {
      applies: false, entry: null,
      reason: banded.length
        ? `this pack has no ${band} entry; the available bands are ${banded.map((v) => v.band).join(", ")}`
        : `this entry is unbanded, which means adult, and must not be applied to a ${band}`,
    };
  }
  return { applies: false, entry: null, reason: "no entry applies to this patient" };
}

/**
 * Neonatal results need gestational age. A 26-week preterm on day 2 and a term baby on day 27 are
 * both neonates and share almost no reference range, so a neonatal result with no gestational age
 * is refused rather than banded on chronological age alone.
 */
function neonatalReady(banding) {
  if (banding.band !== BAND.NEONATE) return { ready: true, reason: null };
  if (typeof banding.gestationalAgeWeeks !== "number") {
    return { ready: false, reason: "a neonatal result needs gestational age; a 26 week preterm and a term baby share almost no reference range" };
  }
  return { ready: true, reason: null };
}

/**
 * Weight-based dose ceiling for a child, with the adult maximum as a hard cap.
 *
 * The adult cap is the part that matters. mg/kg alone lets a 90 kg adolescent exceed an adult dose,
 * and that is the classic paediatric overdose: the arithmetic is right and the answer is dangerous.
 *
 * @returns {{ceiling: number|null, cappedByAdult: boolean, reasons: {code, message}[]}}
 */
function paediatricCeiling({ mgPerKg, weightKg, adultMaxMg, band }) {
  const reasons = [];
  if (typeof mgPerKg !== "number") return { ceiling: null, cappedByAdult: false, reasons: [{ code: "NO_MG_PER_KG", message: "no weight-based rule is defined for this drug" }] };
  if (typeof weightKg !== "number" || !(weightKg > 0)) {
    return { ceiling: null, cappedByAdult: false,
      reasons: [{ code: "NO_WEIGHT", message: `a ${band || "paediatric"} dose cannot be calculated without a recorded weight` }] };
  }
  const byWeight = mgPerKg * weightKg;
  const cap = typeof adultMaxMg === "number" ? adultMaxMg : Infinity;
  const ceiling = Math.min(byWeight, cap);
  const cappedByAdult = ceiling === cap && cap < byWeight;
  if (cappedByAdult) {
    reasons.push({ code: "ADULT_CAP", message: `weight-based ${byWeight} mg exceeds the adult maximum ${cap} mg, so the adult maximum applies` });
  }
  return { ceiling, cappedByAdult, reasons };
}

/**
 * A plausibility check on the weight itself, because a mistyped weight is the most common way a
 * paediatric dose goes wrong and it is invisible once it is arithmetic.
 *
 * Bounds are deliberately generous: this catches a decimal point or a pounds/kilograms mix-up, not
 * an unusual child.
 */
const WEIGHT_SANITY = Object.freeze({
  [BAND.NEONATE]: { min: 0.4, max: 6 },
  [BAND.INFANT]: { min: 2, max: 15 },
  [BAND.TODDLER]: { min: 6, max: 25 },
  [BAND.CHILD]: { min: 10, max: 70 },
  [BAND.ADOLESCENT]: { min: 25, max: 150 },
  [BAND.ADULT]: { min: 25, max: 300 },
});

function weightLooksWrong(weightKg, band) {
  const b = WEIGHT_SANITY[band];
  if (!b || typeof weightKg !== "number") return null;
  if (weightKg < b.min) return { code: "WEIGHT_TOO_LOW", message: `${weightKg} kg is below the plausible range for a ${band} (${b.min} to ${b.max} kg); check for a decimal point error` };
  if (weightKg > b.max) return { code: "WEIGHT_TOO_HIGH", message: `${weightKg} kg is above the plausible range for a ${band} (${b.min} to ${b.max} kg); check whether pounds were entered as kilograms` };
  return null;
}

export {
  BAND, BANDS_IN_ORDER, PAEDIATRIC_BANDS, WEIGHT_SANITY,
  PaediatricError,
  ageBandOf, isPaediatric, forBand, neonatalReady, paediatricCeiling, weightLooksWrong,
};
