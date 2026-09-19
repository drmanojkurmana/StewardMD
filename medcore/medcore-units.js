/* medcore/medcore-units.js — the only place a clinical value changes units. HAZ-ML-03.
 *
 * THE HAZARD IS NOT "A UNIT WAS WRONG". It is "a value was silently made into a different number
 * and then scored". The repository already carries the scar: `wardToSI` in icu.js converts an
 * SI-labelled ward result BACK to conventional units despite its name, and the GHIS adapter
 * therefore refuses to normalise at all, keeping `sourceValue` and `sourceUnit` verbatim with
 * `unitNormalised: false`. That refusal was right for an adapter and it pushes the problem here,
 * which is the first place with a table a clinician can read.
 *
 * FOUR RULES, each of which is a way this could go wrong.
 *
 *  1. AN UNLISTED UNIT IS NOT A UNIT. There is no heuristic, no string similarity, no fallback and
 *     no "probably mmol/L". A pair that is not in the injected table yields UNIT_UNKNOWN and a null
 *     value. A missing value is a visible gap; a wrongly converted one is a confident lie.
 *  2. AN UNLABELLED VALUE IS ONLY READABLE FROM A SOURCE WHOSE CONVENTION IS WRITTEN DOWN. The ICU
 *     store has one, stated in the icu-autoscores.js header, so `assumedFrom` names it and the
 *     result is flagged `unitAssumed: true` so nothing downstream can pretend it was labelled. Any
 *     other source, an adapter above all, must say what the unit is.
 *  3. PLAUSIBILITY IS THE SECOND NET. A creatinine reported in umol/L but LABELLED mg/dL passes
 *     rule 1, because the label is in the table. It does not pass 0.1 to 25 mg/dL. These bounds are
 *     engineering limits for catching a unit error or a detached lead, not clinical limits, and are
 *     deliberately far wider than any critical threshold (the wardsynq-iomt.js convention).
 *  4. THE RAW SURVIVES. Every refusal carries `sourceValue` and `sourceUnit`, so a mapping error is
 *     recoverable from the record without the source system being reachable. Same contract the
 *     adapters already meet.
 *
 * PURE AND INJECTED. No table of its own, no I/O, no DOM, no clock, exactly as wardsynq-safety.js
 * is pure over an injected rule pack. The table is medcore/data/units.json and carries its own
 * approval status; this file is arithmetic and refusal.
 *
 * node --test test/medcore-units.test.mjs
 */

/** Why a value was refused. A refusal is never a number and never a zero. */
export const REFUSAL = {
  UNKNOWN_PARAM: "UNKNOWN_PARAM",
  NOT_A_NUMBER: "NOT_A_NUMBER",
  UNIT_REQUIRED: "UNIT_REQUIRED",
  UNIT_UNKNOWN: "UNIT_UNKNOWN",
  IMPLAUSIBLE: "IMPLAUSIBLE"
};

/**
 * Lookup key for a reported unit. Case, spacing and the micro sign are presentation; they must not
 * decide whether a value is usable. Nothing else about the string is interpreted.
 * @param {*} unit
 * @returns {string}
 */
export function normaliseKey(unit) {
  if (unit === null || unit === undefined) return "";
  return String(unit)
    .replace(/µ|μ/g, "u")   // micro sign and Greek mu both mean u
    .replace(/°/g, "deg")        // degree sign
    .replace(/\s+/g, "")
    .toLowerCase();
}

function conversionOf(entry) {
  if (typeof entry === "number") return { factor: entry, offset: 0 };
  if (entry && typeof entry === "object" && typeof entry.factor === "number") {
    return { factor: entry.factor, offset: typeof entry.offset === "number" ? entry.offset : 0 };
  }
  return null;
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

/**
 * Builds a normaliser over an injected unit table (medcore/data/units.json).
 * @param {object} table
 */
export function createUnits(table) {
  if (!table || !table.params) throw new Error("medcore-units: a unit table is required");
  const PARAMS = table.params;

  function refuse(param, code, value, unit, extra) {
    return Object.assign({
      param: param,
      value: null,
      unit: null,
      ok: false,
      refusal: code,
      unitAssumed: false,
      sourceValue: value === undefined ? null : value,
      sourceUnit: unit === undefined ? null : unit
    }, extra || {});
  }

  /**
   * Converts one reported value into its canonical unit, or refuses it with a reason.
   * @param {{param:string, value:*, unit?:*, source?:string}} input
   * @returns {{param:string, value:number|null, unit:string|null, ok:boolean, refusal:string|null,
   *            unitAssumed:boolean, sourceValue:*, sourceUnit:*}}
   */
  function normalise(input) {
    const param = input && input.param;
    const def = param ? PARAMS[param] : null;
    const rawValue = input ? input.value : undefined;
    const rawUnit = input ? input.unit : undefined;
    if (!def) return refuse(param || null, REFUSAL.UNKNOWN_PARAM, rawValue, rawUnit);

    // "" and null are absence, not zero. Number("") is 0, which is how a blank field becomes a
    // clinical value in a system that trusts Number() alone.
    if (rawValue === null || rawValue === undefined || rawValue === "" ||
        (typeof rawValue === "string" && rawValue.trim() === "")) {
      return refuse(param, REFUSAL.NOT_A_NUMBER, rawValue, rawUnit);
    }
    const n = Number(rawValue);
    if (!isFinite(n)) return refuse(param, REFUSAL.NOT_A_NUMBER, rawValue, rawUnit);

    const key = normaliseKey(rawUnit);
    let conv = null;
    let assumed = false;

    if (key === "") {
      if (Object.prototype.hasOwnProperty.call(def.units, "")) {
        conv = conversionOf(def.units[""]);           // genuinely unitless (GCS, pH, INR)
      } else if ((def.assumedFrom || []).indexOf(input.source) !== -1) {
        conv = { factor: 1, offset: 0 };              // documented convention, flagged below
        assumed = true;
      } else {
        return refuse(param, REFUSAL.UNIT_REQUIRED, rawValue, rawUnit);
      }
    } else {
      if (!Object.prototype.hasOwnProperty.call(def.units, key)) {
        return refuse(param, REFUSAL.UNIT_UNKNOWN, rawValue, rawUnit);
      }
      conv = conversionOf(def.units[key]);
    }
    if (!conv) return refuse(param, REFUSAL.UNIT_UNKNOWN, rawValue, rawUnit);

    const out = round6(n * conv.factor + conv.offset);
    const lo = def.plausible ? def.plausible[0] : -Infinity;
    const hi = def.plausible ? def.plausible[1] : Infinity;
    if (out < lo || out > hi) {
      return refuse(param, REFUSAL.IMPLAUSIBLE, rawValue, rawUnit, { plausible: def.plausible, converted: out });
    }

    return {
      param: param,
      value: out,
      unit: def.canonical,
      ok: true,
      refusal: null,
      unitAssumed: assumed,
      sourceValue: rawValue,
      sourceUnit: rawUnit === undefined ? null : rawUnit
    };
  }

  return {
    version: table.version || null,
    approvalStatus: table.approvalStatus || "unapproved",
    params: function () { return Object.keys(PARAMS); },
    has: function (p) { return Object.prototype.hasOwnProperty.call(PARAMS, p); },
    canonicalUnit: function (p) { return PARAMS[p] ? PARAMS[p].canonical : null; },
    plausible: function (p) { return PARAMS[p] ? PARAMS[p].plausible : null; },
    normalise: normalise
  };
}
