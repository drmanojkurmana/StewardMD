/* medcore/medcore-state.js — the canonical Medical Core input, built as of a stated instant.
 *
 * WHY THIS FILE IS THE LEAKAGE CONTROL. A deterioration model is trained on the past and asked
 * about the present, and the single way to make that comparison dishonest is to let the builder see
 * one minute of the future. So `asOf` is an ARGUMENT, not a default, and nothing here reads a
 * clock. A training replay passes the historical instant and gets exactly what the bedside would
 * have had; the bedside passes now. There is no third behaviour, and no code path that calls
 * Date.now(), which is why the test for it greps this file.
 *
 * FIVE RULES THE STATE ENFORCES.
 *
 *  1. AN UNUSABLE VALUE IS NOT A VALUE. Stale, implausible, wrongly-united and artefactual
 *     observations carry `value: null` and a refusal reason. Nothing downstream may coerce a
 *     refusal into a number, and nothing may read a refusal as reassurance. This is the same rule
 *     wardsynq-deterioration.js applies to NEWS2, restated where the features are built.
 *  2. THE AGE OF AN OBSERVATION TRAVELS WITH IT. `ageMin` is minutes before `asOf`, and it is the
 *     ONLY recency signal that leaves this file. Observation counts, inter-observation intervals
 *     and charting frequency are deliberately absent: a model handed those learns how closely a
 *     patient was watched, which is a shortcut that scores well retrospectively and collapses in
 *     prospect (HAZ-ML-01, enforced in medcore-features.js).
 *  3. AGE COMES FROM `ageYears`, NEVER FROM A DATE OF BIRTH. GHIS sends age in years as a string
 *     and the adapter records `ageYears` while leaving `dob` as the sentinel `0000-00-00`, which
 *     deliberately does not parse. Age drives weight-based paediatric dosing and every paediatric
 *     refusal, so a `dob` parsed into the year 45 is a dosing hazard, not a display bug. This file
 *     contains no date-of-birth arithmetic at all (HAZ-ML-04).
 *  4. UNKNOWN IS NOT FALSE. An intervention nobody charted is `active: null`, not `active: false`.
 *     An outcome that needs to know whether the patient is already on a vasopressor must abstain
 *     rather than assume they are not, because assuming produces exactly the prevalent-case
 *     contamination HAZ-ML-02 is about.
 *  5. NO IDENTIFIERS. `subjectKey` is whatever opaque handle the caller supplies and is never
 *     derived here from an MRN, a name or a hospital number. Nothing in this state is a person.
 *
 * PURE. No I/O, no DOM, no network, no clock. The unit table and the freshness windows are
 * injected, as wardsynq-safety.js injects its rule pack.
 *
 * node --test test/medcore-state.test.mjs test/medcore-age.test.mjs
 */

import { createUnits } from "./medcore-units.js";

export const SOURCE_ICU = "icu-state";

/** Every reason a parameter can fail to be usable. STALE and the unit refusals are the common ones. */
export const UNUSABLE = { STALE: "STALE", NO_WINDOW: "NO_WINDOW", NEVER_RECORDED: "NEVER_RECORDED" };

/* ICU stores some labs under short keys. The mapping is explicit rather than fuzzy: a lab key this
 * table does not name is not read at all, which is safer than reading it into the wrong parameter. */
const ICU_LAB_KEYS = {
  k: "k", na: "na", cl: "cl", creat: "creat", urea: "urea", glu: "glucose", hb: "hb",
  plt: "plt", wbc: "wbc", alb: "albumin", bili: "bili", crp: "crp", inr: "inr", lactate: "lactate"
};
const ICU_VITAL_KEYS = {
  hr: "hr", sbp: "sbp", dbp: "dbp", map: "map", spo2: "spo2", rr: "rr",
  temp: "temp", gcs: "gcs", uop: "uop", lactate: "lactate"
};
const ICU_ABG_KEYS = { ph: "ph", pao2: "pao2", paco2: "paco2", hco3: "hco3", lactate: "lactate" };

/* One pressor detector, deliberately the same vocabulary icu.js uses in isPressor(). Drug naming is
 * clinical content; when the safety engine's approved pack covers it, this goes away. */
const PRESSOR_RE = /nor|adrenaline|epinephrine|vasopressin|dopamine|dobutamine|phenylephrine|pressor/i;

const DEFAULT_WINDOWS = { lookbackHours: 24, seriesCapPerParam: 48 };
const MS_MIN = 60000;

/**
 * Milliseconds for a timestamp that may be epoch ms (ICU), an ISO string (WardSynQ) or a Date.
 * Returns null for anything that is not a real instant, including the `0000-00-00` sentinel.
 */
export function toMs(t) {
  if (t === null || t === undefined || t === "") return null;
  if (t instanceof Date) { const n = t.getTime(); return isFinite(n) ? n : null; }
  if (typeof t === "number") return isFinite(t) ? t : null;
  if (typeof t === "string") {
    if (/^0{4}-0{2}-0{2}/.test(t)) return null;         // the adapter's deliberate non-date
    if (/^\d+$/.test(t)) return Number(t);
    const n = Date.parse(t);
    return isFinite(n) ? n : null;
  }
  return null;
}

function iso(ms) { return ms === null || ms === undefined ? null : new Date(ms).toISOString(); }

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * Age in whole years, read ONLY from a reported age. HAZ-ML-04: there is no dob arithmetic here and
 * there must never be one. A value outside 0 to 120 is not an age.
 * @returns {{ageYears:number|null, ageSource:string}}
 */
export function readAge(patient) {
  const p = patient || {};
  const raw = p.ageYears !== undefined && p.ageYears !== null && p.ageYears !== "" ? p.ageYears
    : (p.age !== undefined && p.age !== null && p.age !== "" ? p.age : null);
  if (raw === null) return { ageYears: null, ageSource: "unknown" };
  // Number([]) is 0 and Number([7]) is 7. An array is not an age, and a container that coerces to a
  // plausible number is exactly how a wrong field becomes a patient's age.
  if (typeof raw !== "number" && typeof raw !== "string") return { ageYears: null, ageSource: "unknown" };
  const n = Number(raw);
  if (!isFinite(n) || n < 0 || n > 120) return { ageYears: null, ageSource: "unknown" };
  return { ageYears: Math.floor(n), ageSource: "reported" };
}

function readSex(patient) {
  const s = String((patient && patient.sex) || "").trim().toLowerCase();
  if (s === "m" || s === "male") return "M";
  if (s === "f" || s === "female") return "F";
  if (s === "other") return "other";
  return "unknown";
}

/**
 * Builds the canonical state from an already-collected list of observations.
 *
 * @param {object} deps            { unitTable, freshness } - injected clinical packs.
 * @param {object} input
 *   observations  [{param, value, unit, at, source}]  raw, unordered, may contain junk
 *   patient       {ageYears|age, sex, weightKg}
 *   interventions {vasopressor, ventilation, oxygen, rrt} each {active:boolean|null, ...}
 *   asOf          required instant; nothing later is read
 *   subjectKey    opaque, optional
 *   windows       {lookbackHours, seriesCapPerParam}
 *   provenance    {sources:[], unitNormalised:boolean, builtBy}
 */
export function buildState(deps, input) {
  const unitTable = deps && deps.unitTable;
  const freshness = (deps && deps.freshness && deps.freshness.windows) || null;
  if (!unitTable) throw new Error("medcore-state: a unit table is required");
  if (!freshness) throw new Error("medcore-state: freshness windows are required");
  const U = createUnits(unitTable);

  const asOfMs = toMs(input && input.asOf);
  if (asOfMs === null) throw new Error("medcore-state: asOf is required and must be a real instant");

  const windows = Object.assign({}, DEFAULT_WINDOWS, (input && input.windows) || {});
  const lookbackMs = windows.lookbackHours * 3600000;
  const obs = (input && input.observations) || [];

  const series = {};
  const older = {};          // newest observation per parameter from BEFORE the lookback window
  const rejected = [];

  for (const o of obs) {
    if (!o || !o.param) continue;
    const at = toMs(o.at);
    // Rule: asOf is the only clock. An observation with no time cannot be aged, and one recorded
    // after asOf is the future. Both are dropped, and the drop is counted rather than hidden.
    if (at === null) { rejected.push({ param: o.param, reason: "NO_TIMESTAMP" }); continue; }
    if (at > asOfMs) { rejected.push({ param: o.param, reason: "AFTER_ASOF" }); continue; }

    const n = U.normalise({ param: o.param, value: o.value, unit: o.unit, source: o.source });
    const ageMin = Math.round((asOfMs - at) / MS_MIN);
    const entry = {
      param: o.param, at: at, ageMin: ageMin,
      value: n.ok ? n.value : null, unit: n.ok ? n.unit : null,
      usable: n.ok, refusal: n.refusal, unitAssumed: !!n.unitAssumed,
      sourceValue: n.sourceValue, sourceUnit: n.sourceUnit
    };

    // Outside the lookback the observation is not evidence about the patient now, but it IS the
    // answer to "when was this last done", and those are different sentences. Dropping it entirely
    // would make a creatinine from yesterday afternoon read as NEVER_RECORDED, which sends a
    // clinician to order a test that already exists rather than to look at the old one.
    if (at < asOfMs - lookbackMs) {
      if (!older[o.param] || at > older[o.param].at) older[o.param] = entry;
      continue;
    }
    (series[o.param] = series[o.param] || []).push(entry);
  }

  const params = {};
  const seriesOut = {};
  const allParams = Object.keys(series).concat(Object.keys(older).filter((p) => !series[p]));
  for (const p of allParams) {
    const rows = (series[p] || [older[p]]).slice().sort((a, b) => a.at - b.at);
    const window = Object.prototype.hasOwnProperty.call(freshness, p) ? freshness[p] : null;
    const usableRows = rows.filter((r) => r.usable);
    const newest = usableRows.length ? usableRows[usableRows.length - 1] : null;
    const newestAny = rows[rows.length - 1];

    if (!newest) {
      // Something was charted and none of it survived. Say which refusal killed it, not "missing".
      params[p] = {
        value: null, unit: null, at: iso(newestAny.at), ageMin: newestAny.ageMin,
        usable: false, refusal: newestAny.refusal, unitAssumed: false,
        sourceValue: newestAny.sourceValue, sourceUnit: newestAny.sourceUnit
      };
      seriesOut[p] = [];
      continue;
    }
    if (window === null) {
      // Fail closed: a parameter with no declared window is not fresh, it is undeclared.
      params[p] = {
        value: null, unit: null, at: iso(newest.at), ageMin: newest.ageMin,
        usable: false, refusal: UNUSABLE.NO_WINDOW,
        staleValue: newest.value, staleUnit: newest.unit
      };
      seriesOut[p] = [];
      continue;
    }
    if (newest.ageMin > window) {
      params[p] = {
        value: null, unit: null, at: iso(newest.at), ageMin: newest.ageMin,
        usable: false, refusal: UNUSABLE.STALE, windowMin: window,
        staleValue: newest.value, staleUnit: newest.unit
      };
      seriesOut[p] = [];
      continue;
    }
    params[p] = {
      value: newest.value, unit: newest.unit, at: iso(newest.at), ageMin: newest.ageMin,
      usable: true, refusal: null, unitAssumed: newest.unitAssumed, windowMin: window
    };
    const fresh = usableRows.slice(-windows.seriesCapPerParam);
    seriesOut[p] = fresh.map((r) => ({ v: r.value, at: iso(r.at), ageMin: r.ageMin }));
  }

  const age = readAge(input && input.patient);
  const wt = U.normalise({ param: "weight", value: (input && input.patient || {}).weightKg, source: SOURCE_ICU });

  return deepFreeze({
    schema: "medcore-state/1",
    asOf: iso(asOfMs),
    subjectKey: (input && input.subjectKey) || null,
    demographics: {
      ageYears: age.ageYears,
      ageSource: age.ageSource,
      sex: readSex(input && input.patient),
      weightKg: wt.ok ? wt.value : null
    },
    params: params,
    series: seriesOut,
    interventions: normaliseInterventions(input && input.interventions),
    windows: windows,
    provenance: Object.assign(
      { sources: [], unitNormalised: false, builtBy: "medcore-state@1.0.0", rejected: rejected },
      (input && input.provenance) || {}
    )
  });
}

/** Rule 4: unknown is null, never false. */
function normaliseInterventions(given) {
  const g = given || {};
  function one(x, extra) {
    const o = x || {};
    const base = { active: o.active === true ? true : o.active === false ? false : null,
                   startedAt: iso(toMs(o.startedAt)) };
    return Object.assign(base, extra ? extra(o) : {});
  }
  return {
    vasopressor: one(g.vasopressor, (o) => ({ agents: Array.isArray(o.agents) ? o.agents.slice() : [] })),
    ventilation: one(g.ventilation, (o) => ({ mode: o.mode || null, invasive: o.invasive === true ? true : o.invasive === false ? false : null })),
    oxygen: one(g.oxygen, (o) => ({ device: o.device || null, flowLpm: typeof o.flowLpm === "number" ? o.flowLpm : null, fio2: typeof o.fio2 === "number" ? o.fio2 : null })),
    rrt: one(g.rrt)
  };
}

/**
 * Adapter: today's ICU dashboard state (ICU_STATE / _raw in icu.js).
 *
 * Reads vitals through the whole series rather than the newest row, which is the forward-fill
 * mergedVitals() exists for: ingestMonitor() pushes a NEW ROW per save containing only the fields
 * just entered, so the newest-timestamp row alone drops every field that was charted separately.
 * Here each parameter simply carries its own newest observation and its own age, which is the same
 * property expressed per parameter.
 *
 * @param {object} deps    { unitTable, freshness }
 * @param {object} icuState
 * @param {{asOf:*, subjectKey?:string, windows?:object}} opts
 */
export function fromIcuState(deps, icuState, opts) {
  const s = icuState || {};
  const o = opts || {};
  const observations = [];

  const vitals = Array.isArray(s.vitals) ? s.vitals : [];
  for (const row of vitals) {
    if (!row) continue;
    for (const key of Object.keys(ICU_VITAL_KEYS)) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
      observations.push({ param: ICU_VITAL_KEYS[key], value: row[key], unit: null, at: row.ts, source: SOURCE_ICU });
    }
  }

  // Labs carry their time in STATE.src[key] = {source, ts}; a lab with no recorded time cannot be
  // aged and is therefore dropped by buildState rather than treated as current.
  const labs = (s.labs && s.labs.recent) || {};
  const src = s.src || {};
  for (const key of Object.keys(labs)) {
    const param = ICU_LAB_KEYS[key];
    if (!param) continue;
    observations.push({ param: param, value: labs[key], unit: null, at: (src[key] || {}).ts, source: SOURCE_ICU });
  }

  // The ABG slip is a single timestamped set.
  const abg = s.abg || {};
  const abgTs = abg.ts !== undefined ? abg.ts : (src.abg || {}).ts;
  for (const key of Object.keys(ICU_ABG_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(abg, key)) continue;
    observations.push({ param: ICU_ABG_KEYS[key], value: abg[key], unit: null, at: abgTs, source: SOURCE_ICU });
  }

  const vent = s.ventilator || {};
  const infusions = Array.isArray(s.infusions) ? s.infusions : [];
  const pressors = infusions.filter((i) => i && PRESSOR_RE.test(i.drug || ""));

  return buildState(deps, {
    observations: observations,
    patient: s.patient || {},
    // A charted infusion list is evidence both ways: something was charted, so "no pressor running"
    // is a real answer. A ventilator tab nobody filled is not evidence of an unventilated patient.
    interventions: {
      vasopressor: { active: infusions.length ? pressors.length > 0 : null,
                     agents: pressors.map((p) => p.drug), startedAt: (pressors[0] || {}).startedAt },
      ventilation: vent.mode ? { active: true, mode: vent.mode } : { active: null, mode: null },
      oxygen: (vent.fio2 != null) ? { active: true, fio2: Number(vent.fio2) > 1 ? Number(vent.fio2) / 100 : Number(vent.fio2) } : { active: null },
      rrt: { active: null }
    },
    asOf: o.asOf,
    subjectKey: o.subjectKey || null,
    windows: o.windows,
    provenance: { sources: [SOURCE_ICU], unitNormalised: false, builtBy: "medcore-state@1.0.0/icu" }
  });
}
