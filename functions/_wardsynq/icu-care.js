/* functions/_wardsynq/icu-care.js - the ICU bedside record: blood gases, ventilator settings,
 * sedation, the daily round checklist, and what can honestly be worked out from them.
 *
 * THE CLINICAL LOGIC IS NOT NEW. StewardMD's own ICU calculator (icu.js and icu-autoscores.js at the
 * repository root) has carried the acid-base interpreter, the SOFA bands and the pressor tiers for
 * a long time, tested by test/test-icu-autoscores.mjs. Those files are browser IIFEs over a
 * localStorage state and cannot be imported into a Worker, so the pure pieces are PORTED here,
 * each one naming the function it came from. A threshold that is not in those files, or in
 * wardsynq/, is not in this file either.
 *
 * NOTHING COMPUTED HERE IS EVER A ZERO FOR "UNKNOWN". A dose that cannot be worked out is null with
 * the reason. A SOFA component with no data is "not scored" and the total says it is partial. A gas
 * with no pCO2 is "not interpretable", never read as normal.
 *
 * ADVISORY. The sepsis screen prompts a human; it starts nothing and pages nobody. The Code Sepsis
 * bundle is started by a clinician through migrate-resus.js, exactly as on the ED chart.
 *
 * APPEND-ONLY. Every entry is its own IcuRecord, versioned like everything else in the store. A
 * wrong gas is corrected by charting the right one, and the wrong one stays readable.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { screenSepsis } from "../../wardsynq/wardsynq-emergency.js";
import { gatherVitals, weightInKg, FRESHNESS_MS } from "../../wardsynq/wardsynq-vitals.js";
import { LOINC as NEWS2_LOINC } from "../../wardsynq/wardsynq-deterioration.js";
import { isRunning } from "./infusion.js";

const TYPE = "IcuRecord";
const KINDS = Object.freeze(["abg", "ventilator", "sedation", "round"]);
const ADVISORY = "Advisory only. This supports a clinician's judgement; it has not started, ordered or paged anything.";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** A plain number or nothing. "7.3 units" and "12/8" are not numbers and are not guessed at. */
function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/* ------------------------------------------------------------------ input shapes */

/* Plausibility bands are the ones icu.js already uses to refuse a mistyped import (SCORE_FIELD in
 * icu.js: pH 6.5-7.9, PaCO2 10-150, PaO2 20-700, FiO2 21-100 %, HCO3 2-60). They reject typing
 * errors; they are not clinical thresholds. */
const RANGE = Object.freeze({ ph: [6.5, 7.9], pco2: [10, 150], po2: [20, 700], hco3: [2, 60], fio2: [21, 100] });

/** PURE. FiO2 as a fraction. Accepts 0.21-1.0 or 21-100, the same normalisation icu-autoscores.js
 *  applies (`a.fio2 > 1 ? a.fio2 / 100 : a.fio2`). Anything else is refused. */
function fio2Fraction(v) {
  const n = num(v);
  if (n === null) return null;
  const pct = n > 1 ? n : n * 100;
  return pct >= RANGE.fio2[0] && pct <= RANGE.fio2[1] ? Math.round(pct) / 100 : null;
}

function ranged(field, v, problems) {
  if (v === undefined || v === null || str(v) === "") return null;
  const n = num(v);
  const r = RANGE[field];
  if (n === null || (r && (n < r[0] || n > r[1]))) { problems.push({ field, reason: r ? `not a plain number between ${r[0]} and ${r[1]}` : "not a plain number" }); return null; }
  return n;
}

/** PURE. An ABG entry. A missing value stays missing; a value out of range is refused by name. */
function abgFrom(input) {
  const i = input || {}, problems = [];
  const sampleType = str(i.sampleType).toLowerCase();
  if (sampleType !== "arterial" && sampleType !== "venous") problems.push({ field: "sampleType", reason: "say arterial or venous" });
  const fio2Given = !(i.fio2 === undefined || i.fio2 === null || str(i.fio2) === "");
  const fio2 = fio2Given ? fio2Fraction(i.fio2) : null;
  if (fio2Given && fio2 === null) problems.push({ field: "fio2", reason: "FiO2 must be 21 to 100 percent (or 0.21 to 1.0)" });
  const be = i.baseExcess === undefined || str(i.baseExcess) === "" ? null : num(i.baseExcess);
  if (be === null && !(i.baseExcess === undefined || str(i.baseExcess) === "")) problems.push({ field: "baseExcess", reason: "not a plain number" });
  const lactate = i.lactate === undefined || str(i.lactate) === "" ? null : num(i.lactate);
  if ((lactate === null && !(i.lactate === undefined || str(i.lactate) === "")) || (lactate !== null && lactate < 0)) problems.push({ field: "lactate", reason: "not a plain number of mmol/L" });
  const values = {
    sampleType: sampleType || null,
    ph: ranged("ph", i.ph, problems), pco2: ranged("pco2", i.pco2, problems), po2: ranged("po2", i.po2, problems),
    hco3: ranged("hco3", i.hco3, problems), baseExcess: be, lactate: lactate !== null && lactate >= 0 ? lactate : null, fio2,
  };
  const anything = ["ph", "pco2", "po2", "hco3", "baseExcess", "lactate"].some((k) => values[k] !== null);
  if (!anything && !problems.length) problems.push({ field: "values", reason: "nothing was entered" });
  return { values, problems };
}

/**
 * PURE. Acid-base interpretation, ported from analyzeABG() in icu.js (primary disorder by pH, then
 * HCO3 < 22 / > 26 and PaCO2 > 45 / < 35; Winter's formula 1.5 x HCO3 + 8 +/- 2 for a metabolic
 * acidosis; 0.7 x HCO3 + 20 +/- 5 for a metabolic alkalosis; P/F = PaO2 / FiO2 with the same
 * 100/200/300 bands). The anion gap and delta ratio are not ported: they need a same-time sodium
 * and chloride, and pairing a gas with a lab from another hour is a guess.
 *
 * Changed from the source, deliberately: icu.js returns null when pH, pCO2 or HCO3 is missing, and
 * a null is easy to render as nothing. Here the answer is "not interpretable" with the missing
 * values named. P/F is refused on a venous sample, because a venous pO2 is not a PaO2.
 */
function interpretAbg(abg) {
  const g = abg || {};
  const missing = [];
  if (g.ph == null) missing.push("pH"); if (g.pco2 == null) missing.push("pCO2"); if (g.hco3 == null) missing.push("HCO3");
  const venous = g.sampleType === "venous";

  let pf = null, pfReason = null, pfBand = null;
  if (venous) pfReason = "P/F ratio needs an arterial sample; a venous pO2 is not a PaO2.";
  else if (g.po2 == null || g.fio2 == null) pfReason = "P/F ratio needs both pO2 and FiO2 on the same sample.";
  else {
    pf = Math.round(g.po2 / g.fio2);
    pfBand = pf < 100 ? "severe hypoxaemia" : pf < 200 ? "moderate hypoxaemia" : pf < 300 ? "mild hypoxaemia" : null;
  }
  const out = { pf, pfBand, pfReason, source: "analyzeABG() in icu.js" };
  if (missing.length) return { ...out, interpretable: false, primary: null, compensation: null, reason: `Not interpretable: ${missing.join(", ")} not recorded.`, missing };

  const { ph, pco2, hco3 } = g;
  let primary = "", comp = null;
  if (ph < 7.35) {
    if (hco3 < 22) primary = "Metabolic acidosis";
    if (pco2 > 45) primary = primary ? "Mixed metabolic and respiratory acidosis" : "Respiratory acidosis";
    if (!primary) primary = "Acidaemia";
  } else if (ph > 7.45) {
    if (hco3 > 26) primary = "Metabolic alkalosis";
    if (pco2 < 35) primary = primary ? "Mixed metabolic and respiratory alkalosis" : "Respiratory alkalosis";
    if (!primary) primary = "Alkalaemia";
  } else if (hco3 < 22 && pco2 < 35) primary = "Compensated or mixed (low HCO3 and low CO2)";
  else if (hco3 > 26 && pco2 > 45) primary = "Compensated or mixed (high HCO3 and high CO2)";
  else primary = "Normal acid-base";

  if (/^Metabolic acidosis/.test(primary)) {
    const exp = 1.5 * hco3 + 8;
    comp = (pco2 > exp + 2 ? "Inadequate respiratory compensation, added respiratory acidosis" : pco2 < exp - 2 ? "Over-compensation, added respiratory alkalosis" : "Appropriate respiratory compensation")
      + ` (expected pCO2 ${exp.toFixed(0)} +/- 2, actual ${pco2})`;
  } else if (/^Metabolic alkalosis/.test(primary)) {
    const exp = 0.7 * hco3 + 20;
    comp = (pco2 < exp - 5 ? "Added respiratory alkalosis" : pco2 > exp + 5 ? "Added respiratory acidosis" : "Appropriate respiratory compensation")
      + ` (expected pCO2 ${exp.toFixed(0)} +/- 5, actual ${pco2})`;
  } else if (/^Respiratory/.test(primary)) {
    comp = "Acute or chronic is judged by the HCO3 shift (about 1 mEq/L acute, 3.5 chronic, per 10 mmHg pCO2).";
  }
  return {
    ...out, interpretable: true, primary, compensation: comp,
    ...(venous ? { caution: "Venous sample: pH and HCO3 are close to arterial, pCO2 is not. Read the respiratory part with care." } : {}),
  };
}

const VENT_MODES = Object.freeze(["VC-AC", "PC-AC", "SIMV", "PSV", "CPAP", "PRVC", "APRV", "NIV-BiPAP", "HFNC", "other"]);
/** PURE. A ventilator setting entry. Every number is what was SET (or, for pressures, what the
 *  machine showed); nothing is derived. */
function ventFrom(input) {
  const i = input || {}, problems = [];
  const mode = str(i.mode);
  if (!VENT_MODES.includes(mode)) problems.push({ field: "mode", reason: `choose one of ${VENT_MODES.join(", ")}` });
  const pos = (field, v, max) => {
    if (v === undefined || v === null || str(v) === "") return null;
    const n = num(v);
    if (n === null || n < 0 || n > max) { problems.push({ field, reason: `not a plain number from 0 to ${max}` }); return null; }
    return n;
  };
  const fio2Given = !(i.fio2 === undefined || i.fio2 === null || str(i.fio2) === "");
  const fio2 = fio2Given ? fio2Fraction(i.fio2) : null;
  if (fio2Given && fio2 === null) problems.push({ field: "fio2", reason: "FiO2 must be 21 to 100 percent (or 0.21 to 1.0)" });
  const values = {
    mode: mode || null,
    tidalVolumeMl: pos("tidalVolumeMl", i.tidalVolumeMl, 2000), rate: pos("rate", i.rate, 80), peep: pos("peep", i.peep, 40),
    fio2, peakPressure: pos("peakPressure", i.peakPressure, 100), plateauPressure: pos("plateauPressure", i.plateauPressure, 100),
  };
  return { values, problems };
}

/** PURE. RASS (Richmond Agitation-Sedation Scale, -5 to +4) with an optional target range and GCS. */
function sedationFrom(input) {
  const i = input || {}, problems = [];
  const rass = num(i.rass);
  if (rass === null || !Number.isInteger(rass) || rass < -5 || rass > 4) problems.push({ field: "rass", reason: "RASS is a whole number from -5 to +4" });
  const opt = (field, v, lo, hi) => {
    if (v === undefined || v === null || str(v) === "") return null;
    const n = num(v);
    if (n === null || !Number.isInteger(n) || n < lo || n > hi) { problems.push({ field, reason: `a whole number from ${lo} to ${hi}` }); return null; }
    return n;
  };
  const targetLow = opt("targetLow", i.targetLow, -5, 4), targetHigh = opt("targetHigh", i.targetHigh, -5, 4);
  if ((targetLow === null) !== (targetHigh === null) && !problems.some((p) => /^target/.test(p.field))) problems.push({ field: "target", reason: "give both ends of the target, or neither" });
  if (targetLow !== null && targetHigh !== null && targetLow > targetHigh) problems.push({ field: "target", reason: "the low end of the target is above the high end" });
  const gcs = opt("gcs", i.gcs, 3, 15);
  return { values: { rass: rass !== null && Number.isInteger(rass) ? rass : null, targetLow, targetHigh, gcs }, problems };
}

/** PURE. Current RASS against its target. No target is its own answer, never "on target". */
function sedationStatus(s) {
  if (!s || s.rass == null) return { onTarget: null, say: "No RASS recorded." };
  if (s.targetLow == null || s.targetHigh == null) return { onTarget: null, say: `RASS ${s.rass}. No sedation target has been set.` };
  const on = s.rass >= s.targetLow && s.rass <= s.targetHigh;
  const range = s.targetLow === s.targetHigh ? `${s.targetLow}` : `${s.targetLow} to ${s.targetHigh}`;
  return { onTarget: on, say: `RASS ${s.rass}, target ${range}: ${on ? "on target" : s.rass > s.targetHigh ? "lighter than target" : "deeper than target"}.` };
}

/* FAST HUGS BID (Vincent 2005, extended): the checklist StewardMD's ICU round already names its
 * items after (icu.js round sections). The words are prompts, not orders. */
const ROUND_ITEMS = Object.freeze([
  ["feeding", "Feeding"], ["analgesia", "Analgesia"], ["sedation", "Sedation"],
  ["thromboprophylaxis", "Thromboprophylaxis"], ["headOfBed", "Head of bed elevated"],
  ["ulcerProphylaxis", "Stress ulcer prophylaxis"], ["glucose", "Glucose control"],
  ["bowels", "Bowels"], ["lines", "Indwelling lines and catheters reviewed"], ["deescalation", "Antibiotic de-escalation reviewed"],
]);
const ANSWERS = Object.freeze(["yes", "no", "not-applicable"]);
/** PURE. A round. An item nobody answered is "not-assessed", stored as such, never as "no". */
function roundFrom(input) {
  const given = (input && input.items && typeof input.items === "object") ? input.items : {};
  const problems = [];
  const items = ROUND_ITEMS.map(([key, label]) => {
    const raw = given[key];
    const answer = str(raw && typeof raw === "object" ? raw.answer : raw).toLowerCase();
    const note = str(raw && typeof raw === "object" ? raw.note : "").slice(0, 300) || null;
    if (answer && !ANSWERS.includes(answer)) problems.push({ field: key, reason: "answer yes, no or not-applicable, or leave it" });
    return { key, label, answer: ANSWERS.includes(answer) ? answer : "not-assessed", note };
  });
  if (!items.some((i) => i.answer !== "not-assessed")) problems.push({ field: "items", reason: "no item was answered" });
  return { values: { items, assessed: items.filter((i) => i.answer !== "not-assessed").length, of: items.length }, problems };
}

/* ------------------------------------------------------------------ vasopressors */

/* The vasoactive names from isPressor() in icu.js, without its bare "nor" and "pressor" fragments,
 * which also match "norfloxacin" and anything with "pressor" in a free-text name. */
const VASOACTIVE = /noradrenaline|norepinephrine|adrenaline|epinephrine|vasopressin|dopamine|dobutamine|phenylephrine/i;
const isVasoactive = (drug) => VASOACTIVE.test(str(drug));
const MCG_PER = Object.freeze({ mcg: 1, ug: 1, "µg": 1, "μg": 1, mg: 1000, g: 1000000 });

/**
 * PURE. mcg/kg/min from a pump rate, the bag's stated concentration and a weight.
 *
 * The arithmetic is weightBasedRate() in wardsynq/wardsynq-flowsheet.js run the other way:
 * that file does mcg/kg/min x kg x 60 / 1000 / mg per mL = mL/h, so this does
 * mL/h x mcg per mL / kg / 60. It refuses, with the reason, rather than assume anything.
 */
function vasopressorDose({ ratePerHour, concentration, weightKg } = {}) {
  const rate = typeof ratePerHour === "number" && Number.isFinite(ratePerHour) ? ratePerHour : null;
  if (rate === null) return { value: null, reason: "No pump rate has been charted." };
  const c = concentration || null;
  if (!c || num(c.amount) === null || !(num(c.amount) > 0) || num(c.volumeMl) === null || !(num(c.volumeMl) > 0)) {
    return { value: null, reason: "The bag's concentration has not been recorded. It is never assumed." };
  }
  const factor = MCG_PER[str(c.unit).toLowerCase()];
  if (!factor) return { value: null, reason: `The concentration is in ${str(c.unit) || "no unit"}, which does not convert to mcg/kg/min.` };
  if (!(typeof weightKg === "number" && weightKg > 0)) return { value: null, reason: "No body weight is recorded. A weight-based dose is not worked out without one." };
  const mcgPerMl = (num(c.amount) * factor) / num(c.volumeMl);
  const value = (rate * mcgPerMl) / weightKg / 60;
  return {
    value: Math.round(value * 1000) / 1000, unit: "mcg/kg/min", reason: null,
    workings: `${rate} mL/h x ${Math.round(mcgPerMl * 100) / 100} mcg/mL / ${Math.round(weightKg * 10) / 10} kg / 60`,
  };
}

/* ------------------------------------------------------------------ SOFA */

/* Band functions ported verbatim from icu-autoscores.js (sofaPlt, sofaBili, sofaCreat, sofaGcs,
 * sofaResp, sofaCardio). Units are those that file states: platelets x10^9/L, bilirubin and
 * creatinine mg/dL, PaO2 mmHg. */
const sofaPlt = (p) => (p >= 150 ? 0 : p >= 100 ? 1 : p >= 50 ? 2 : p >= 20 ? 3 : 4);
const sofaBili = (b) => (b < 1.2 ? 0 : b < 2.0 ? 1 : b < 6.0 ? 2 : b < 12.0 ? 3 : 4);
const sofaCreat = (c) => (c < 1.2 ? 0 : c < 2.0 ? 1 : c < 3.5 ? 2 : c < 5.0 ? 3 : 4);
const sofaGcs = (g) => (g >= 15 ? 0 : g >= 13 ? 1 : g >= 10 ? 2 : g >= 6 ? 3 : 4);
function sofaResp(pf, vent) {
  if (pf >= 400) return 0; if (pf >= 300) return 1;
  if (pf >= 200) return 2; if (pf >= 100) return vent ? 3 : 2; return vent ? 4 : 2;
}
/** sofaCardio() from icu-autoscores.js: an interpretable dose decides the tier; a running pressor
 *  whose dose could not be worked out floors at its "present" tier and never jumps to the top one. */
function sofaCardio(map, pressors) {
  let dop = 0, dob = 0, epi = 0, nor = 0, dopOn = false, dobOn = false, epiOn = false, norOn = false, floored = false;
  for (const p of pressors || []) {
    const n = str(p.drug).toLowerCase(); const on = p.running && (p.ratePerHour || 0) > 0; if (!on) continue;
    const d = p.dose && p.dose.value != null ? p.dose.value : null;
    if (/dopamine/.test(n)) { dopOn = true; if (d != null) dop = Math.max(dop, d); else floored = true; }
    else if (/dobutamine/.test(n)) { dobOn = true; if (d != null) dob = Math.max(dob, d); }
    else if (/(epinephrine|adrenaline)/.test(n) && !/nor/.test(n)) { epiOn = true; if (d != null) epi = Math.max(epi, d); else floored = true; }
    else if (/(norepinephrine|noradrenaline)/.test(n)) { norOn = true; if (d != null) nor = Math.max(nor, d); else floored = true; }
  }
  if (dop > 15 || epi > 0.1 || nor > 0.1) return { score: 4 };
  if (dop > 5 || epiOn || norOn) return { score: 3, floored };
  if (dopOn || dobOn) return { score: 2, floored };
  if (map == null) return { score: null };
  return { score: map < 70 ? 1 : 0 };
}
/** mapCalc() from icu.js: (SBP + 2 x DBP) / 3. */
const mapFrom = (sbp, dbp) => (sbp != null && dbp != null ? Math.round((sbp + 2 * dbp) / 3) : null);

const PLT_UNITS = new Set(["10*3/ul", "10^3/ul", "10*9/l", "10^9/l", "x10^9/l", "x10*9/l", "x10⁹/l"]);
const MGDL = new Set(["mg/dl"]);

/**
 * PURE. SOFA from whatever is on the record. A component with no usable data is listed as not
 * scored with the reason, the total counts only what was scored, and `partial` says so.
 */
function sofaScore({ platelets, bilirubin, creatinine, gcs, abg, vent, map, pressors } = {}) {
  const comps = [];
  const add = (key, label, score, reason, extra) => comps.push({ key, label, score: score == null ? null : score, reason: score == null ? reason : null, ...(extra || {}) });

  if (abg && abg.sampleType === "arterial" && abg.po2 != null && abg.fio2 != null) {
    const pf = abg.po2 / abg.fio2;
    const onVent = !!(vent && ((vent.peep || 0) > 0 || (vent.fio2 || 0) > 0.21));
    add("resp", "Respiration", sofaResp(pf, onVent), null, { from: `P/F ${Math.round(pf)}${onVent ? ", on ventilatory support" : ""}` });
  } else add("resp", "Respiration", null, "No arterial gas with both PaO2 and FiO2.");

  const lab = (key, label, o, units, band, unitWord) => {
    if (!o) return add(key, label, null, `No ${label.toLowerCase()} result.`);
    if (typeof o.value !== "number") return add(key, label, null, `The ${label.toLowerCase()} result is not a number.`);
    if (!units.has(str(o.unit).toLowerCase())) return add(key, label, null, `The ${label.toLowerCase()} result is in ${str(o.unit) || "no unit"}, not ${unitWord}; it is not converted.`);
    add(key, label, band(o.value), null, { from: `${o.value} ${o.unit}` });
  };
  lab("coag", "Platelets", platelets, PLT_UNITS, sofaPlt, "x10^9/L");
  lab("liver", "Bilirubin", bilirubin, MGDL, sofaBili, "mg/dL");

  const cardio = sofaCardio(map, pressors);
  if (cardio.score == null) add("cardio", "Cardiovascular", null, "No blood pressure pair to work out a MAP, and no vasopressor running.");
  else add("cardio", "Cardiovascular", cardio.score, null, {
    from: map != null ? `MAP ${map}` : "vasopressor running",
    ...(cardio.floored ? { caution: "A running vasopressor's dose could not be worked out, so this is the lowest tier that drug allows. It may be higher." } : {}),
  });

  if (gcs != null) add("cns", "Nervous system (GCS)", sofaGcs(gcs), null, { from: `GCS ${gcs}` });
  else add("cns", "Nervous system (GCS)", null, "No GCS recorded.");
  lab("renal", "Renal (creatinine)", creatinine, MGDL, sofaCreat, "mg/dL");

  const scored = comps.filter((c) => c.score != null);
  const notScored = comps.filter((c) => c.score == null).map((c) => c.label);
  return {
    total: scored.length ? scored.reduce((a, c) => a + c.score, 0) : null,
    scoredComponents: scored.length, of: comps.length,
    partial: notScored.length > 0, notScored, components: comps,
    say: !scored.length ? "SOFA not scored: nothing on the record to score."
      : notScored.length ? `Partial SOFA ${scored.reduce((a, c) => a + c.score, 0)} from ${scored.length} of ${comps.length} systems. Not scored: ${notScored.join(", ")}. The real total may be higher.`
      : `SOFA ${scored.reduce((a, c) => a + c.score, 0)} of 24.`,
    source: "SOFA bands from icu-autoscores.js",
    advisory: ADVISORY,
  };
}

/* ------------------------------------------------------------------ sepsis screen */

const LACTATE_CODE = "2524-7";
/**
 * PURE. The advisory sepsis screen.
 *
 * qSOFA is screenSepsis() in wardsynq/wardsynq-emergency.js, unchanged: two criteria is positive,
 * an incomplete screen below two cannot be called anything, and the adult-only refusal stands.
 * The lactate and fever rule is icu.js recompute()'s: one qSOFA criterion WITH lactate > 2 mmol/L
 * or temperature >= 38.3 C is a prompt to assess for sepsis. Lactate above 2 is also the Surviving
 * Sepsis re-measure threshold quoted in icu.js PROTOCOLS.
 *
 * "Not screen positive" never reads as negative: wardsynq-emergency.js explains why at length.
 */
function sepsisScreen({ observations, patient, lactate, now } = {}) {
  const nowIso = now || new Date().toISOString();
  const g = gatherVitals((observations || []).filter((o) => o && o.category === "vital-signs"), { codeMap: NEWS2_LOINC, now: nowIso });
  const v = g.values;
  const q = screenSepsis({
    respiratoryRate: typeof v.respiratoryRate === "number" ? v.respiratoryRate : undefined,
    consciousness: typeof v.consciousness === "string" ? v.consciousness : undefined,
    systolicBloodPressure: typeof v.systolicBloodPressure === "number" ? v.systolicBloodPressure : undefined,
    patient,
  });
  const missing = [];
  if (q.criteria && q.criteria.respiratoryRate == null) missing.push("respiratory rate in the last 4 hours");
  if (q.criteria && q.criteria.alteredMentation == null) missing.push("level of consciousness (ACVPU) in the last 4 hours");
  if (q.criteria && q.criteria.hypotension == null) missing.push("systolic blood pressure in the last 4 hours");

  const tempC = typeof v.temperature === "number" && (g.units.temperature === "Cel" || str(g.units.temperature).toUpperCase() === "C") ? v.temperature : null;
  const lac = lactate && typeof lactate.value === "number" ? lactate : null;
  const lacRaised = lac && lac.value > 2;
  const fever = tempC !== null && tempC >= 38.3;

  let result, say;
  // screenSepsis refuses a patient who is not an adult (or whose age is unknown) with no criteria at all.
  const adultRefusal = q.result === "unscreenable" && Object.keys(q.criteria || {}).length === 0;
  if (q.result === "screen-positive") {
    result = "screen-positive"; say = `Screen positive: ${q.score} qSOFA criteria met. Assess for sepsis. This is a prompt, not a diagnosis.`;
  } else if (!adultRefusal && q.score === 1 && (lacRaised || fever)) {
    result = "screen-positive";
    say = `Screen positive: 1 qSOFA criterion with ${lacRaised ? `lactate ${lac.value} mmol/L (above 2)` : ""}${lacRaised && fever ? " and " : ""}${fever ? `temperature ${tempC} C` : ""}. Assess for sepsis. This is a prompt, not a diagnosis.`;
  } else if (q.result === "unscreenable") {
    result = "cannot-screen";
    say = adultRefusal ? `Cannot screen: ${q.reason}.` : `Cannot screen: missing ${missing.join(", ")}.`;
  } else {
    result = "not-screen-positive";
    say = "Not screen positive. This does not exclude sepsis: qSOFA misses many septic patients, and clinical suspicion overrides it.";
  }
  return {
    result, say, missing: result === "cannot-screen" && !adultRefusal ? missing : [],
    qsofa: { score: q.score, criteria: q.criteria || {} },
    lactate: lac ? { value: lac.value, at: lac.at, from: lac.from, raised: !!lacRaised } : null,
    lactateNote: lac ? null : "No lactate in the last 4 hours, so it did not contribute.",
    temperatureC: tempC,
    rejected: g.rejected.length,
    excludesSepsis: false,
    source: "qSOFA: screenSepsis() in wardsynq-emergency.js. Lactate and fever: recompute() in icu.js.",
    advisory: ADVISORY,
  };
}

/* ------------------------------------------------------------------ record I/O */

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

const PARSE = { abg: abgFrom, ventilator: ventFrom, sedation: sedationFrom, round: roundFrom };

/** ctx: { migration, kind, patientId, encounterId, at?, values, actorDeps, recordDeps } */
async function recordIcu(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const kind = str(ctx.kind);
  if (!KINDS.includes(kind)) return { ...base, ok: false, status: 400, error: "unknown_kind", detail: `kind must be one of ${KINDS.join(", ")}`, written: 0 };
  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  if (!patientId || !encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  const at = str(ctx.at) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) return { ...base, ok: false, status: 422, error: "bad_time", detail: "the time is not a date", written: 0 };
  if (Date.parse(at) > Date.now() + 5 * 60000) return { ...base, ok: false, status: 422, error: "future_time", detail: "this cannot be charted in the future", written: 0 };

  const { values, problems } = PARSE[kind](ctx.values);
  if (problems.length) return { ...base, ok: false, status: 422, error: "invalid_values", problems, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  // The same wrong-encounter guard recordWardVitals keeps: an encounter id from another patient
  // must not let a gas be charted against the wrong person.
  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", written: 0 };
  if (encounter.patientId !== patientId) return { ...base, ok: false, status: 409, error: "encounter_patient_mismatch", detail: "this encounter does not belong to the given patient", written: 0 };

  const id = `wsq-icu-${kind}-${slug(encounterId)}-${slug(at)}`;
  const record = {
    resourceType: TYPE, id, patientId, encounterId, kind, at, values,
    recordedBy: resolved.actor.id,
    source: { system: "wardsynq-native", sourceId: `icu:${id}` },
  };
  try {
    const current = await svc.get(TYPE, id);
    if (current) return { ...base, ok: true, written: 0, skipped: "already_charted", id };
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, id, kind, version: out.record.version, actor: resolved.actor.id,
      ...(kind === "abg" ? { interpretation: interpretAbg(values) } : {}),
      ...(kind === "sedation" ? { status: sedationStatus(values) } : {}),
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { id, written: 0, actor: resolved.actor.id }) };
  }
}

const byAtDesc = (a, b) => String(b.at).localeCompare(String(a.at));
const obsTime = (o) => str(o.effectiveAt || (o.meta && (o.meta.effectiveAt || o.meta.recordedAt)));
function latestObs(observations, code, { withinMs, nowMs } = {}) {
  const rows = (observations || []).filter((o) => o && o.code === code && Number.isFinite(Date.parse(obsTime(o))))
    .filter((o) => !withinMs || (nowMs - Date.parse(obsTime(o)) <= withinMs && Date.parse(obsTime(o)) <= nowMs))
    .sort((a, b) => Date.parse(obsTime(b)) - Date.parse(obsTime(a)));
  return rows[0] ? { value: rows[0].value, unit: rows[0].unit || null, at: obsTime(rows[0]) } : null;
}

/** Everything the ICU cards show, from the record. ctx: { migration, patientId, now?, actorDeps, recordDeps } */
async function icuChart(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required" };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  let records, observations, infusions, orders, patient;
  try {
    [records, observations, infusions, orders, patient] = await Promise.all([
      svc.byPatient(TYPE, patientId), svc.byPatient("Observation", patientId),
      /* R6-1, 2026-09-18: these two carried their own catches. An unreadable MedicationOrder list
       * left every running infusion without its drug name, so isVasoactive() dropped it and the
       * pressor simply vanished off the ICU card; an unreadable Patient turned the sepsis screen
       * into "cannot screen: age unknown", which blames the record rather than the store. Both are
       * the outer refusal's business now. */
      svc.byPatient("InfusionRate", patientId), svc.byPatient("MedicationOrder", patientId),
      svc.get("Patient", patientId),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) };
  }

  const nowIso = str(ctx.now) || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const of = (kind) => (records || []).filter((r) => r && r.kind === kind).sort(byAtDesc)
    .map((r) => ({ id: r.id, at: r.at, by: r.recordedBy || null, ...r.values }));

  const abgs = of("abg").map((a) => ({ ...a, interpretation: interpretAbg(a) }));
  const vents = of("ventilator"), seds = of("sedation"), rounds = of("round");

  // Weight: the latest recorded, in kg. Not held to the vitals freshness window - an admission
  // weight stays the weight - but its date travels with every dose worked out from it.
  const w = latestObs(observations, "29463-7");
  const weightKg = w && typeof w.value === "number" ? weightInKg(w.value, w.unit) : null;

  const byOrder = new Map();
  for (const r of (infusions || []).filter(Boolean)) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) || []), r]);
  const orderDrug = new Map((orders || []).filter(Boolean).map((o) => [o.id, o.drug]));
  const pressors = [];
  for (const [orderId, hist] of byOrder) {
    hist.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const last = hist[hist.length - 1];
    const drug = last.drug || orderDrug.get(orderId) || null;
    if (!isVasoactive(drug)) continue;
    const conc = [...hist].reverse().find((h) => h.concentration) || null;
    const running = isRunning(hist);
    const dose = running
      ? vasopressorDose({ ratePerHour: last.ratePerHour, concentration: conc && conc.concentration, weightKg })
      : { value: null, reason: "Stopped." };
    pressors.push({
      orderId, drug, running, ratePerHour: last.ratePerHour, lastChartedAt: last.at,
      concentration: conc ? conc.concentration : null, weightKg: weightKg == null ? null : Math.round(weightKg * 10) / 10,
      weightRecordedAt: w ? w.at : null, dose,
    });
  }

  // MAP from the most recent systolic and diastolic charted at the same moment.
  const sbps = (observations || []).filter((o) => o && o.code === "8480-6" && typeof o.value === "number");
  let map = null, mapAt = null;
  for (const s of sbps.sort((a, b) => Date.parse(obsTime(b)) - Date.parse(obsTime(a)))) {
    const d = (observations || []).find((o) => o && o.code === "8462-4" && typeof o.value === "number" && obsTime(o) === obsTime(s));
    if (d && nowMs - Date.parse(obsTime(s)) <= FRESHNESS_MS) { map = mapFrom(s.value, d.value); mapAt = obsTime(s); }
    break;
  }

  const latestArterial = abgs.find((a) => a.sampleType === "arterial") || null;
  const sofa = sofaScore({
    platelets: latestObs(observations, "777-3"), bilirubin: latestObs(observations, "1975-2"), creatinine: latestObs(observations, "2160-0"),
    gcs: seds.length && seds[0].gcs != null ? seds[0].gcs : null,
    abg: latestArterial, vent: vents[0] || null, map, pressors,
  });

  // Lactate: the worst of the latest gas and the latest laboratory value in the last 4 hours, as
  // icu.js recompute() takes the worst across sources so a stale normal cannot mask a high one.
  const lacCands = [];
  const gasLac = abgs.find((a) => a.lactate != null && nowMs - Date.parse(a.at) <= FRESHNESS_MS && Date.parse(a.at) <= nowMs);
  if (gasLac) lacCands.push({ value: gasLac.lactate, at: gasLac.at, from: "blood gas" });
  const labLac = latestObs(observations, LACTATE_CODE, { withinMs: FRESHNESS_MS, nowMs });
  if (labLac && typeof labLac.value === "number" && str(labLac.unit).toLowerCase() === "mmol/l") lacCands.push({ ...labLac, from: "laboratory" });
  const lactate = lacCands.sort((a, b) => b.value - a.value)[0] || null;

  const sepsis = sepsisScreen({ observations, patient, lactate, now: nowIso });

  return {
    ...base, ok: true, patientId, advisory: ADVISORY,
    abg: { current: abgs[0] || null, history: abgs.slice(0, 20) },
    ventilator: { current: vents[0] || null, history: vents.slice(0, 20) },
    sedation: { current: seds[0] || null, status: sedationStatus(seds[0]), history: seds.slice(0, 20) },
    rounds: { latest: rounds[0] || null, history: rounds.slice(0, 10) },
    vasopressors: pressors, map: map == null ? null : { value: map, at: mapAt },
    sofa, sepsis,
    roundItems: ROUND_ITEMS.map(([key, label]) => ({ key, label })), ventModes: VENT_MODES,
  };
}

export {
  TYPE, KINDS, ROUND_ITEMS, VENT_MODES, ADVISORY,
  fio2Fraction, abgFrom, interpretAbg, ventFrom, sedationFrom, sedationStatus, roundFrom,
  isVasoactive, vasopressorDose, sofaPlt, sofaBili, sofaCreat, sofaGcs, sofaResp, sofaCardio, mapFrom, sofaScore, sepsisScreen,
  recordIcu, icuChart,
};
