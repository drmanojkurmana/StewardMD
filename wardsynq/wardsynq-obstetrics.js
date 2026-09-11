/* wardsynq/wardsynq-obstetrics.js — the patient who looks well until she does not.
 *
 * NEWS2 refuses pregnant patients, correctly, and then pointed at a module that did not exist. This
 * is that module. It exists because refusing to score a population and offering them nothing instead
 * is only half a control, and it is the same debt the paediatrics module paid off.
 *
 * THE CENTRAL PHYSIOLOGICAL FACT, and the reason a general early warning score is not merely
 * miscalibrated here but actively misleading: a healthy young pregnant woman COMPENSATES
 * EXTRAORDINARILY WELL. Blood volume is up by around 40 percent, resting pulse is up, and blood
 * pressure FALLS in the second trimester. She can lose a litre and a half of blood with a pulse of
 * 100 and a normal blood pressure, and then decompensate suddenly and late. Normal observations do
 * not mean a well patient in obstetrics. A score built to notice a gradual adult decline is looking
 * for a curve that this patient does not draw.
 *
 * WHY THIS IS NOT NEWS2 WITH DIFFERENT NUMBERS. MEOWS is TRIGGER-based, not additive. A single red
 * trigger, or two concurrent yellows, is the alert. That is a deliberately different shape: summing
 * gives a low total to a woman with one catastrophic parameter and several normal ones, which is
 * precisely the presentation that kills. This file therefore returns TRIGGERS, and there is no total
 * anywhere in it to be read as reassuring.
 *
 * PREGNANCY IS NOT A BOOLEAN. Most maternal deaths from haemorrhage are POSTPARTUM, and risk does
 * not end at delivery: pre-eclampsia can present for the first time days afterwards, and the
 * puerperium runs to six weeks. A `pregnant: true` flag that flips to false at delivery removes the
 * warning at the moment the danger peaks. State and day are carried explicitly.
 *
 * BLOOD LOSS IS MEASURED, NOT EYEBALLED. Visual estimation of obstetric blood loss is documented to
 * underestimate by roughly half, and the underestimate is worst at the volumes that matter. A visual
 * estimate is accepted as an OBSERVATION and refused as a MEASUREMENT, and a bundle target keyed to
 * a volume will not accept one.
 *
 * WHAT IT DOES NOT DO. No dosing, and in particular no magnesium sulphate regimen: magnesium is a
 * high-alert drug with a narrow window between anticonvulsant and respiratory arrest, and an
 * unapproved table in this file would be a direct route to a maternal death. It says magnesium is
 * indicated and due; the regimen belongs to an approved protocol and a human.
 *
 * NOT MODELLED: fetal monitoring and CTG interpretation of any kind, gestational diabetes, labour
 * progress, shoulder dystocia and other intrapartum emergencies, amniotic fluid embolism, sepsis
 * scoring specific to pregnancy, and any local MEOWS chart beyond the widely published trigger bands
 * seeded here.
 *
 * PROVENANCE: the trigger bands are the commonly published MEOWS parameters and the PPH and
 * eclampsia bundle elements are standard practice. THE EXACT CUT-OFFS VARY BETWEEN CHARTS AND
 * BETWEEN UNITS, and they are UNAPPROVED here. The obstetric lead owns them.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-obstetrics.test.mjs
 */

import { ageBandOf, BAND } from "./wardsynq-paediatrics.js";
import { gatherVitals } from "./wardsynq-vitals.js";

/**
 * Pregnancy state. `postpartum` carries a day count because the risk profile changes across the
 * puerperium and does not stop at the end of it.
 */
const PREG = Object.freeze({
  ANTENATAL: "antenatal",
  INTRAPARTUM: "intrapartum",
  POSTPARTUM: "postpartum",
  NOT_PREGNANT: "not-pregnant",
  UNKNOWN: "unknown",
});

/** The puerperium. Obstetric physiology and obstetric risk do not end at delivery. */
const PUERPERIUM_DAYS = 42;

const TRIGGER = Object.freeze({ RED: "red", YELLOW: "yellow", NONE: "none" });

/**
 * MEOWS trigger bands. UNAPPROVED: these vary between charts and units, and the obstetric lead owns
 * the local values. `red` is a single-parameter alert on its own; two concurrent `yellow`s are one.
 */
const MEOWS_BANDS = Object.freeze({
  respiratoryRate: { red: (v) => v < 10 || v > 30, yellow: (v) => v >= 21 && v <= 30, label: "Respiratory rate" },
  oxygenSaturation: { red: (v) => v < 95, yellow: () => false, label: "Oxygen saturation" },
  systolicBloodPressure: { red: (v) => v < 90 || v > 160, yellow: (v) => (v >= 90 && v <= 100) || (v >= 150 && v <= 160), label: "Systolic blood pressure" },
  diastolicBloodPressure: { red: (v) => v > 110, yellow: (v) => v >= 90 && v <= 110, label: "Diastolic blood pressure" },
  pulse: { red: (v) => v < 40 || v > 120, yellow: (v) => (v >= 100 && v <= 120) || (v >= 40 && v <= 50), label: "Pulse" },
  temperature: { red: (v) => v < 35 || v > 38, yellow: (v) => v >= 37.5 && v <= 38, label: "Temperature" },
  consciousness: {
    red: (v) => typeof v === "string" && v.trim().toUpperCase() !== "A",
    yellow: () => false, label: "Consciousness (ACVPU)", nonNumeric: true,
  },
  // Included because oliguria is an early and frequently missed sign of pre-eclampsia and of
  // concealed haemorrhage, and it is the parameter most often left blank.
  urineOutputMlPerHour: { red: (v) => v < 20, yellow: (v) => v >= 20 && v < 30, label: "Urine output" },
  proteinuria: {
    red: (v) => v === "3+" || v === "4+", yellow: (v) => v === "1+" || v === "2+",
    label: "Proteinuria", nonNumeric: true,
  },
});

const MEOWS_PARAMS = Object.freeze(Object.keys(MEOWS_BANDS));

/** LOINC codes for the MEOWS parameters, so a chart can be built from observations rather than a form. */
const MEOWS_LOINC = Object.freeze({
  "9279-1": "respiratoryRate",
  "2708-6": "oxygenSaturation",
  "59408-5": "oxygenSaturation",
  "8480-6": "systolicBloodPressure",
  "8462-4": "diastolicBloodPressure",
  "8867-4": "pulse",
  "8310-5": "temperature",
  "80339-5": "consciousness",
  "9187-6": "urineOutputMlPerHour",
  "2888-6": "proteinuria",
});

/**
 * MEOWS from observations rather than a hand-filled values object.
 *
 * This exists because the asymmetry was a hazard: NEWS2 gathered with a freshness window and the
 * IoMT artefact filter, and MEOWS took a plain object, so a chart could be built over a six-hour-old
 * blood pressure or a detached lead with nothing to stop it. Both now go through the same gatherer.
 */
function meowsFromObservations(observations, patient, opts = {}) {
  const gathered = gatherVitals(observations, { codeMap: MEOWS_LOINC, now: opts.now, freshnessMs: opts.freshnessMs });
  const result = meows(gathered.values, patient, opts.now);
  return { ...result, sources: gathered.sources, rejected: gathered.rejected };
}

class ObstetricError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ObstetricError";
    this.code = code || "OBSTETRIC_VIOLATION";
  }
}

/**
 * Resolves the obstetric state of a patient.
 *
 * A `pregnant: true` boolean is accepted but reported as imprecise, because it cannot say whether
 * she has delivered, and delivery is when haemorrhage risk peaks rather than ends.
 */
function obstetricState(patient, nowIso) {
  patient = patient || {};
  const now = nowIso || new Date().toISOString();

  if (patient.deliveredAt) {
    const days = Math.floor((Date.parse(now) - Date.parse(patient.deliveredAt)) / 86_400_000);
    if (!Number.isFinite(days) || days < 0) {
      return { state: PREG.UNKNOWN, precise: false, postpartumDay: null,
        reason: "the delivery time does not parse, so the postpartum day cannot be established" };
    }
    if (days <= PUERPERIUM_DAYS) {
      return { state: PREG.POSTPARTUM, precise: true, postpartumDay: days,
        gestationWeeks: patient.gestationWeeks ?? null,
        reason: `day ${days} postpartum; obstetric risk runs to ${PUERPERIUM_DAYS} days and haemorrhage risk is highest now` };
    }
    return { state: PREG.NOT_PREGNANT, precise: true, postpartumDay: days,
      reason: `${days} days postpartum, beyond the puerperium` };
  }

  if (patient.inLabour === true) {
    return { state: PREG.INTRAPARTUM, precise: true, postpartumDay: null,
      gestationWeeks: patient.gestationWeeks ?? null, reason: "in labour" };
  }
  if (typeof patient.gestationWeeks === "number") {
    return { state: PREG.ANTENATAL, precise: true, postpartumDay: null,
      gestationWeeks: patient.gestationWeeks, reason: `${patient.gestationWeeks} weeks gestation` };
  }
  if (patient.pregnant === true) {
    // Accepted, but this flag cannot say whether she has delivered, and a flag that flips to false
    // at delivery would remove the warning exactly when the danger peaks.
    return { state: PREG.ANTENATAL, precise: false, postpartumDay: null, gestationWeeks: null,
      reason: "recorded as pregnant with no gestation, and a boolean cannot say whether she has delivered" };
  }
  if (patient.pregnant === false) {
    return { state: PREG.NOT_PREGNANT, precise: true, postpartumDay: null, reason: "recorded as not pregnant" };
  }
  return { state: PREG.UNKNOWN, precise: false, postpartumDay: null, reason: "pregnancy status is not recorded" };
}

const isObstetric = (state) => state === PREG.ANTENATAL || state === PREG.INTRAPARTUM || state === PREG.POSTPARTUM;

/**
 * MEOWS. Returns triggers, never a total.
 *
 * There is deliberately no score in the return value. A sum lets a woman with one catastrophic
 * parameter and six normal ones read as low risk, and that is the presentation this chart exists to
 * catch.
 *
 * @returns {{applicable: boolean, alert: boolean, red: object[], yellow: object[], missing: string[],
 *   state: string, reason: string, advice: string}}
 */
function meows(values, patient, nowIso) {
  values = values || {};
  const os = obstetricState(patient, nowIso);
  const base = { red: [], yellow: [], missing: [], state: os.state, postpartumDay: os.postpartumDay };

  if (!isObstetric(os.state)) {
    return {
      ...base, applicable: false, alert: false,
      reason: os.state === PREG.UNKNOWN
        ? "pregnancy status is not established, so neither MEOWS nor NEWS2 can be selected; this is a question somebody has to answer, not a default"
        : "this patient is not pregnant or postpartum; MEOWS does not apply and NEWS2 does",
      advice: os.state === PREG.UNKNOWN ? "Establish pregnancy status." : "Use NEWS2.",
    };
  }

  if (patient) {
    const b = ageBandOf(patient, nowIso);
    // A pregnant adolescent is a real and higher-risk patient. MEOWS is an adult obstetric chart and
    // is not validated for her, so she is flagged rather than silently scored or silently refused.
    if (b.band !== BAND.ADULT && b.band !== BAND.UNKNOWN) {
      base.ageCaution = `this patient bands as ${b.band}; MEOWS is an adult obstetric chart and adolescent pregnancy carries higher risk, so senior obstetric review is indicated regardless of what these triggers show`;
    }
  }

  const red = [];
  const yellow = [];
  const missing = [];

  for (const key of MEOWS_PARAMS) {
    const spec = MEOWS_BANDS[key];
    const v = values[key];
    const present = spec.nonNumeric
      ? (typeof v === "string" && v.trim() !== "")
      : (typeof v === "number" && Number.isFinite(v));
    if (!present) { missing.push(key); continue; }
    if (spec.red(v)) red.push({ parameter: key, label: spec.label, value: v, trigger: TRIGGER.RED });
    else if (spec.yellow(v)) yellow.push({ parameter: key, label: spec.label, value: v, trigger: TRIGGER.YELLOW });
  }

  const alert = red.length >= 1 || yellow.length >= 2;

  // The sentence that carries the actual clinical content of this file. It is attached to EVERY
  // result, including the ones with no triggers at all, because the reassuring result is the
  // dangerous one: she compensates, and then she does not.
  const compensation = "A pregnant or recently delivered woman compensates well and decompensates late. She can lose 1.5 litres with a normal blood pressure. Absence of triggers is not evidence that she is well; clinical concern overrides this chart.";

  return {
    ...base, applicable: true, alert, red, yellow, missing,
    reason: alert
      ? (red.length ? `${red.length} red trigger${red.length > 1 ? "s" : ""}: ${red.map((r) => r.label).join(", ")}`
        : `${yellow.length} concurrent yellow triggers: ${yellow.map((y) => y.label).join(", ")}`)
      : "no MEOWS trigger",
    // Missing parameters are reported but do NOT suppress an alert, because a red trigger is a red
    // trigger whether or not somebody also wrote down the urine output.
    incomplete: missing.length > 0,
    advice: compensation,
    escalation: alert
      ? (red.length ? "Immediate obstetric and anaesthetic review." : "Urgent obstetric review and repeat observations.")
      : (missing.length ? "Complete the observation set." : "Continue routine observations."),
  };
}

/* ------------------------------------------------------------------ blood loss */

const LOSS_METHOD = Object.freeze({
  WEIGHED: "weighed",             // swabs and drapes weighed; the only quantitative method here
  CALIBRATED_DRAPE: "calibrated-drape",
  SUCTION: "suction-volume",
  VISUAL: "visual-estimate",      // an observation, never a measurement
});

const QUANTITATIVE = Object.freeze([LOSS_METHOD.WEIGHED, LOSS_METHOD.CALIBRATED_DRAPE, LOSS_METHOD.SUCTION]);

/** PPH thresholds. Widely published; the local definition is the obstetric lead's. */
const PPH_ML = Object.freeze({ MINOR: 500, MAJOR: 1000, MASSIVE: 2000 });

/**
 * Records blood loss, and refuses to let a guess be treated as a measurement.
 *
 * Visual estimation underestimates obstetric blood loss by roughly half, and the underestimate is
 * worst at the volumes where the decision actually changes. So a visual figure is kept, flagged, and
 * explicitly marked as not quantitative, and any threshold keyed to a volume will not accept it.
 *
 * @returns {{ml: number, method: string, quantitative: boolean, category: string, caution: string|null}}
 */
function recordBloodLoss({ ml, method, at, by } = {}) {
  if (typeof ml !== "number" || !(ml >= 0)) throw new ObstetricError("blood loss must be a number of millilitres", "NO_VOLUME");
  if (!method || !Object.values(LOSS_METHOD).includes(method)) {
    throw new ObstetricError(`how the loss was established must be recorded; one of ${Object.values(LOSS_METHOD).join(", ")}`, "NO_METHOD");
  }
  if (!by || !at) throw new ObstetricError("recording blood loss needs who measured it and when", "NO_ACTOR");

  const quantitative = QUANTITATIVE.includes(method);
  const category = ml >= PPH_ML.MASSIVE ? "massive" : ml >= PPH_ML.MAJOR ? "major" : ml >= PPH_ML.MINOR ? "minor" : "below-threshold";

  return {
    ml, method, at, by, quantitative, category,
    caution: quantitative ? null
      : "VISUAL ESTIMATE. Visual estimation underestimates obstetric blood loss by roughly half, and the true loss may be far higher than this figure. Weigh swabs and drapes.",
    // The honest reading of a visual figure, offered so nobody has to do the arithmetic under
    // pressure. Not a correction factor to be applied silently: both numbers are shown.
    plausibleActualMl: quantitative ? null : ml * 2,
  };
}

/**
 * Whether a PPH threshold has been reached, refusing to answer on a visual estimate alone.
 *
 * @returns {{reached: boolean|null, category: string, quantitative: boolean, reason: string}}
 */
function pphThresholdReached(loss, threshold = PPH_ML.MAJOR) {
  if (!loss) throw new ObstetricError("no blood loss record", "NO_LOSS");
  if (!loss.quantitative) {
    return {
      reached: null, category: loss.category, quantitative: false,
      reason: `a ${threshold} ml threshold cannot be decided on a visual estimate; the recorded ${loss.ml} ml may represent roughly ${loss.ml * 2} ml. Weigh, and treat on clinical state meanwhile`,
    };
  }
  return {
    reached: loss.ml >= threshold, category: loss.category, quantitative: true,
    reason: `${loss.ml} ml measured by ${loss.method}`,
  };
}

/* ------------------------------------------------------------------ obstetric bundles */

/**
 * Bundle definitions for the emergency module. Passed as `definition` to EmergencyBundle, so these
 * inherit every timing guarantee already built and tested there rather than growing a second clock.
 *
 * Note what is absent: no magnesium dose. Magnesium sulphate has a narrow window between
 * anticonvulsant effect and respiratory arrest, and an unapproved regimen in this file would be a
 * direct route to a maternal death. The element says it is due; the protocol says how much.
 */
const OBSTETRIC_BUNDLES = Object.freeze({
  "code-pph": {
    label: "Postpartum Haemorrhage",
    elements: [
      { key: "call", label: "Obstetric emergency call: senior obstetrician, anaesthetist, midwife coordinator", targetMinutes: 2, doneOn: "acknowledged" },
      { key: "uterotonic", label: "Uterotonic given (agent and dose per approved protocol)", targetMinutes: 10, doneOn: "administered" },
      { key: "access", label: "Two large-bore cannulae and bloods including crossmatch", targetMinutes: 10, doneOn: "done" },
      { key: "quantify", label: "Blood loss QUANTIFIED by weighing, not estimated", targetMinutes: 15, doneOn: "measured" },
      { key: "tranexamic", label: "Tranexamic acid (per approved protocol)", targetMinutes: 60, doneOn: "administered" },
      { key: "cause", label: "Cause addressed: tone, tissue, trauma, thrombin", targetMinutes: 30, doneOn: "done" },
      { key: "blood", label: "Blood products activated if major", targetMinutes: 30, doneOn: "acknowledged", conditional: true },
    ],
  },
  "code-eclampsia": {
    label: "Eclampsia / severe pre-eclampsia",
    elements: [
      { key: "call", label: "Obstetric emergency call and anaesthetic attendance", targetMinutes: 2, doneOn: "acknowledged" },
      { key: "airway", label: "Airway, left lateral position, oxygen", targetMinutes: 5, doneOn: "done" },
      { key: "magnesium", label: "Magnesium sulphate started (regimen per approved protocol; this system does not prescribe it)", targetMinutes: 20, doneOn: "administered" },
      { key: "antihypertensive", label: "Antihypertensive for systolic >= 160 or diastolic >= 110", targetMinutes: 30, doneOn: "administered", conditional: true },
      { key: "monitoring", label: "Reflexes, respiratory rate and urine output charted for magnesium toxicity", targetMinutes: 60, doneOn: "done" },
      { key: "delivery", label: "Delivery plan documented by senior obstetrician", targetMinutes: 120, doneOn: "done" },
    ],
  },
});

/**
 * Whether the picture in front of you warrants prompting an obstetric emergency. Like the sepsis
 * recogniser, this PROMPTS and never opens anything: it produces the same assessment shape the
 * recognition queue consumes.
 */
function assessObstetricRecognition({ meowsResult, loss, at } = {}) {
  const reasons = [];
  let strength = null;
  let code = null;

  if (loss) {
    // A visual estimate near the threshold is treated as a reason to prompt precisely because it
    // cannot be trusted: the true loss is plausibly double, and waiting for certainty is the error.
    const effective = loss.quantitative ? loss.ml : loss.ml * 2;
    if (effective >= PPH_ML.MAJOR) {
      reasons.push(loss.quantitative
        ? `${loss.ml} ml measured blood loss`
        : `${loss.ml} ml estimated visually, plausibly ${effective} ml`);
      strength = "high";
      code = "code-pph";
    } else if (effective >= PPH_ML.MINOR) {
      reasons.push(`${loss.ml} ml blood loss by ${loss.method}`);
      strength = strength || "medium";
      code = code || "code-pph";
    }
  }

  if (meowsResult && meowsResult.applicable && meowsResult.alert) {
    reasons.push(meowsResult.reason);
    const hypertensive = meowsResult.red.concat(meowsResult.yellow)
      .some((t) => t.parameter === "systolicBloodPressure" || t.parameter === "diastolicBloodPressure" || t.parameter === "proteinuria");
    if (meowsResult.red.length) strength = "high";
    else strength = strength || "medium";
    if (!code) code = hypertensive ? "code-eclampsia" : null;
  }

  return { prompt: reasons.length > 0, strength: strength || null, reasons, code, evidenceAt: at || null };
}

export {
  PREG, PUERPERIUM_DAYS, TRIGGER, MEOWS_BANDS, MEOWS_PARAMS,
  LOSS_METHOD, QUANTITATIVE, PPH_ML, OBSTETRIC_BUNDLES,
  ObstetricError,
  MEOWS_LOINC,
  obstetricState, isObstetric, meows, meowsFromObservations,
  recordBloodLoss, pphThresholdReached, assessObstetricRecognition,
};
