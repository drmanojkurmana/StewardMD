/* medcore/medcore-missing.js — what a clinician would have to go and get.
 *
 * WHY THIS IS THE MOST USEFUL THING IN PHASE 1. The app already knows, per score, which inputs it
 * lacks: every adapter in icu-autoscores.js returns `{__missing:[...]}` so the UI can grey a card
 * out. That knowledge is currently spent on greying out cards. Nobody is ever told, in one place,
 * "this patient has no recent urine output and no current mental status", which is the sentence
 * that actually changes what happens on the round.
 *
 * SO THIS IS A UNION, NOT A NEW IDEA. It merges two sources that already exist:
 *   - what the enabled Medical Core outcomes need, from the canonical state, and
 *   - what every deterministic score already says it is missing, verbatim from `__missing`.
 * and answers per parameter rather than per score, because a clinician chases a test, not a card.
 *
 * FOUR DISTINCTIONS THAT MUST SURVIVE, because they lead to different actions.
 *   NEVER_RECORDED  nobody has charted it. Go and measure it.
 *   STALE           it exists and is too old to describe the patient now. Repeat it - and the old
 *                   value is carried, because "lactate was 4.1 six hours ago" is a different
 *                   conversation from "there is no lactate".
 *   REFUSED         it was charted and could not be read: an unlisted unit, an implausible
 *                   magnitude. This one is a DATA problem, not a clinical one, and sending a
 *                   clinician to repeat a test that was already done is its own harm.
 *   NO_WINDOW       nobody declared how fresh this parameter has to be. That is our bug, and it is
 *                   reported as ours rather than blamed on the ward.
 *
 * NOTHING IS SILENTLY DROPPED. A `__missing` label this file cannot map to a canonical parameter
 * keeps its original text and is still reported, the same contract every adapter in the repo meets.
 *
 * PURE. No DOM, no I/O, no clock: it reads a state that was already built as of a stated instant.
 *
 * node --test test/medcore-missing.test.mjs
 */

export const MISSING = {
  NEVER_RECORDED: "NEVER_RECORDED",
  STALE: "STALE",
  REFUSED: "REFUSED",
  NO_WINDOW: "NO_WINDOW"
};

/* The core observation set: what any deterioration question needs before it can be asked at all.
 * It is the NEWS2 parameter set plus consciousness, which is the set the ward already charts. */
export const CORE_NEEDS = ["rr", "spo2", "hr", "sbp", "temp", "gcs"];

/* `__missing` labels are display text from icu-autoscores.js. Mapping them back to canonical
 * parameters is what lets one line say "GCS - needed by qSOFA, NEWS2 and SOFA" instead of three.
 * A label absent from this table is still reported, under its own name. */
const LABEL_TO_PARAM = {
  "rr": "rr", "sbp": "sbp", "map": "map", "hr": "hr", "temp": "temp", "gcs": "gcs",
  "k": "k", "na": "na", "wbc": "wbc", "inr": "inr", "ph": "ph",
  "pao2": "pao2", "paco2": "paco2", "fio2": "fio2",
  "creatinine": "creat", "urea": "urea", "bilirubin": "bili", "albumin": "albumin",
  "platelets": "plt", "glucose": "glucose", "age": null
};

/* Presentation only: the label a clinician reads. Never used to decide anything. */
const PARAM_LABEL = {
  rr: "Respiratory rate", spo2: "SpO2", hr: "Heart rate", sbp: "Systolic BP", dbp: "Diastolic BP",
  map: "MAP", temp: "Temperature", gcs: "Conscious level (GCS)", uop: "Urine output",
  lactate: "Lactate", creat: "Creatinine", urea: "Urea", k: "Potassium", na: "Sodium",
  cl: "Chloride", hco3: "Bicarbonate", plt: "Platelets", wbc: "White cells", hb: "Haemoglobin",
  bili: "Bilirubin", albumin: "Albumin", inr: "INR", crp: "CRP", glucose: "Glucose",
  ph: "pH", pao2: "PaO2", paco2: "PaCO2", fio2: "FiO2", weight: "Weight"
};

function labelKey(s) {
  return String(s || "")
    .replace(/₂/g, "2").replace(/₁/g, "1")        // subscript digits in PaO2, FiO2
    .replace(/[^A-Za-z0-9/]/g, "")
    .toLowerCase();
}

/** The clinician-facing name for a canonical parameter. */
export function labelFor(param) { return PARAM_LABEL[param] || param; }

/**
 * @param {object} state            a medcore-state/1 object
 * @param {object} [opts]
 *   needs        string[]          canonical parameters the enabled outcomes require
 *   scores       array             ICU_AUTOSCORES.compute() output, or anything shaped
 *                                  [{id,label,__missing:[...]}] / [{id,label,result:{__missing}}]
 * @returns {Array<{param:string|null, label:string, reason:string, ageMin:number|null,
 *                  staleValue:number|null, neededBy:string[], detail:string|null}>}
 */
export function missing(state, opts) {
  const o = opts || {};
  const needs = Array.isArray(o.needs) ? o.needs : CORE_NEEDS;
  const params = (state && state.params) || {};
  const byParam = new Map();
  const unmapped = new Map();

  function note(param, reason, neededBy, extra) {
    const cur = byParam.get(param);
    if (cur) {
      if (neededBy && cur.neededBy.indexOf(neededBy) === -1) cur.neededBy.push(neededBy);
      return cur;
    }
    const row = Object.assign({
      param: param, label: labelFor(param), reason: reason,
      ageMin: null, staleValue: null, staleUnit: null, detail: null,
      neededBy: neededBy ? [neededBy] : []
    }, extra || {});
    byParam.set(param, row);
    return row;
  }

  function assess(param, neededBy) {
    const p = params[param];
    if (!p) return note(param, MISSING.NEVER_RECORDED, neededBy);
    if (p.usable) return null;
    if (p.refusal === "STALE") {
      return note(param, MISSING.STALE, neededBy, {
        ageMin: p.ageMin, staleValue: p.staleValue === undefined ? null : p.staleValue,
        staleUnit: p.staleUnit === undefined ? null : p.staleUnit,
        detail: p.windowMin ? "older than " + p.windowMin + " min" : null
      });
    }
    if (p.refusal === "NO_WINDOW") {
      return note(param, MISSING.NO_WINDOW, neededBy, { detail: "no freshness window declared" });
    }
    // Everything else is a unit or plausibility refusal: charted, unreadable, and OUR problem.
    return note(param, MISSING.REFUSED, neededBy, {
      ageMin: p.ageMin === undefined ? null : p.ageMin,
      detail: p.refusal + (p.sourceUnit ? " (reported as " + p.sourceUnit + ")" : "")
    });
  }

  for (const n of needs) assess(n, "Medical Core");

  for (const s of (o.scores || [])) {
    if (!s) continue;
    const miss = (s.__missing) || (s.result && s.result.__missing) || null;
    if (!Array.isArray(miss)) continue;
    const who = s.label || s.id || "a score";
    for (const label of miss) {
      const key = labelKey(label);
      const mapped = Object.prototype.hasOwnProperty.call(LABEL_TO_PARAM, key) ? LABEL_TO_PARAM[key] : undefined;
      if (mapped === null) continue;                      // known and deliberately not a parameter (age)
      if (mapped === undefined) {                         // unknown label: keep it, never drop it
        const row = unmapped.get(key) || { param: null, label: String(label), reason: MISSING.NEVER_RECORDED,
          ageMin: null, staleValue: null, staleUnit: null, detail: "not a Medical Core parameter", neededBy: [] };
        if (row.neededBy.indexOf(who) === -1) row.neededBy.push(who);
        unmapped.set(key, row);
        continue;
      }
      assess(mapped, who);
    }
  }

  const rows = Array.from(byParam.values()).concat(Array.from(unmapped.values()));
  // Order: what the most consumers are waiting on, then the core observation set, then by name.
  // Nothing is truncated here - a caller that needs a short list decides how short.
  rows.sort((a, b) => {
    if (b.neededBy.length !== a.neededBy.length) return b.neededBy.length - a.neededBy.length;
    const ai = CORE_NEEDS.indexOf(a.param), bi = CORE_NEEDS.indexOf(b.param);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return String(a.label).localeCompare(String(b.label));
  });
  return rows;
}
