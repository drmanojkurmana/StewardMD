// functions/_connect/maik/clinical-context.js — Part 4: Clinical Context Assembler (Unified Clinical Context Engine, foundation).
//
// Turns a normalized SCCM bundle into the structured clinical context MaiK consumes when a doctor opens a
// patient. DETERMINISTIC, PURE, NO SIDE EFFECTS, NO LLM, NO NETWORK. It only STRUCTURES what is already in the
// record: it never makes a clinical decision, never recommends, and never fabricates a diagnosis/dose. Every
// value it emits is copied from a source field or is a faithful derivation of one (age from birthDate, an
// abnormal flag from an interpretation/reference-range, and counts in the summary). Output aligns with the
// downstream MaiK-egress shape (maik-context.js) so this result can feed that path later.
//
// Consumes the SCCM shapes in ../canonical/model.js (Patient, Condition, MedicationStatement,
// AllergyIntolerance, Observation, DiagnosticReport, Encounter). Missing/empty/partial/hostile bundles must
// NOT throw: they return empty arrays + a safe summary, and every list is bounded.

const HARD_CAP = 5000; // ceiling on raw resources scanned per type — bounds work on a hostile bundle
const DEFAULT_MAX_LABS = 20;
const DEFAULT_MAX_ENCOUNTERS = 10;
const DEFAULT_MAX_PROCEDURES = 20;
const DEFAULT_MAX_REPORTS = 20;
const DEFAULT_MAX_PROBLEMS = 100;
const DEFAULT_MAX_MEDS = 100;
const DEFAULT_MAX_ALLERGIES = 100;

// Conditions that count as an ACTIVE problem. Absent/unknown falls back to shown (do not hide a possibly-active
// problem); explicitly resolved/inactive/remission are excluded.
const CONDITION_ACTIVE = new Set(["active", "recurrence", "relapse"]);
// Medication statuses that are NOT current. Anything else (incl. absent/unknown) is treated as current so a
// possibly-current med is never hidden; only these are dropped.
const MED_NOT_CURRENT = new Set(["completed", "stopped", "entered-in-error", "not-taken", "cancelled"]);
// Allergy clinicalStatus values that suppress the entry.
const ALLERGY_INACTIVE = new Set(["resolved", "inactive"]);

// ---- small pure helpers ------------------------------------------------------------------------------------

const asArray = (x) => (Array.isArray(x) ? x : []);
const capArray = (x) => asArray(x).slice(0, HARD_CAP);
const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();

const ccText = (c) => (c && typeof c.text === "string" && c.text.trim() ? c.text : null);
const ccCode = (c) => (c && Array.isArray(c.coding) && c.coding[0] && c.coding[0].code) || null;
const ccSystem = (c) => (c && Array.isArray(c.coding) && c.coding[0] && c.coding[0].system) || null;

// Extract a comparable epoch-ms from the several date shapes SCCM uses (ISO string, Period {start,end}, quantity-ish).
function dateKey(x) {
  if (!x) return null;
  if (typeof x === "string") { const t = Date.parse(x); return Number.isNaN(t) ? null : t; }
  if (typeof x === "object") {
    const s = x.start || x.end || x.dateTime || (typeof x.value === "string" ? x.value : null);
    if (typeof s === "string") { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  }
  return null;
}
const dateStr = (x) => {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object") return x.start || x.end || x.dateTime || (typeof x.value === "string" ? x.value : null) || null;
  return null;
};

// Stable descending-by-recency sort (items without a date go last, original order preserved on ties).
function byRecencyDesc(items, keyFn) {
  return items
    .map((it, i) => ({ it, i, k: keyFn(it) }))
    .sort((a, b) => {
      if (a.k == null && b.k == null) return a.i - b.i;
      if (a.k == null) return 1;
      if (b.k == null) return -1;
      if (b.k !== a.k) return b.k - a.k;
      return a.i - b.i;
    })
    .map((x) => x.it);
}

// Deterministic whole-years age from birthDate as-of a reference instant (UTC, so it never depends on the host
// timezone or wall clock). Returns null when either date is missing/invalid — never invents an age.
function computeAge(birthDate, asOf) {
  if (!birthDate || !asOf) return null;
  const b = new Date(birthDate), a = new Date(asOf);
  if (Number.isNaN(b.getTime()) || Number.isNaN(a.getTime())) return null;
  let age = a.getUTCFullYear() - b.getUTCFullYear();
  const m = a.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && a.getUTCDate() < b.getUTCDate())) age -= 1;
  return age >= 0 && age < 200 ? age : null;
}

// Faithful normalization of an interpretation label into a short flag. Returns null for a normal marker.
function flagFromInterpretation(interp) {
  const raw = ccText(interp) || ccCode(interp);
  if (!raw) return { known: false, flag: null };
  const t = lc(raw);
  if (t === "n" || t === "normal") return { known: true, flag: null }; // explicitly normal
  if (t.includes("high") || t === "h") return { known: true, flag: "H" };
  if (t.includes("low") || t === "l") return { known: true, flag: "L" };
  if (String(raw).trim().length <= 3) return { known: true, flag: String(raw).trim().toUpperCase() }; // HH/LL/AA/POS...
  return { known: true, flag: "A" }; // some other abnormal statement
}

// Is a laboratory Observation abnormal? Two independent mechanisms:
//  1) an explicit interpretation flag that is not "normal"; and/or
//  2) a numeric value outside its reference range.
// Returns { abnormal, flag } where flag prefers the explicit interpretation, else the derived range direction.
function labAbnormality(o) {
  let abnormal = false, flag = null;
  const fi = flagFromInterpretation(o.interpretation);
  if (fi.known) { if (fi.flag) { abnormal = true; flag = fi.flag; } } // "normal" => known but not abnormal
  const v = o.value && typeof o.value.value === "number" ? o.value.value : null;
  const rr = o.referenceRange;
  if (v != null && rr) {
    const lo = rr.low && typeof rr.low.value === "number" ? rr.low.value : null;
    const hi = rr.high && typeof rr.high.value === "number" ? rr.high.value : null;
    if (lo != null && v < lo) { abnormal = true; if (!flag) flag = "L"; }
    else if (hi != null && v > hi) { abnormal = true; if (!flag) flag = "H"; }
  }
  return { abnormal, flag };
}

function labValue(v) {
  if (v == null) return { value: null, unit: null };
  if (typeof v.value === "number") return { value: v.value, unit: v.unit != null ? v.unit : null };
  if (typeof v.text === "string") return { value: v.text, unit: null };
  return { value: null, unit: null };
}

// Attach an optional field only when the source actually carries a value (never emit a fabricated placeholder).
function put(obj, key, val) { if (val != null && val !== "") obj[key] = val; return obj; }

// ---- the assembler -----------------------------------------------------------------------------------------

export function assembleClinicalContext(sccmBundle, opts = {}) {
  const o = opts || {};
  const maxLabs = Number.isInteger(o.maxLabs) && o.maxLabs >= 0 ? o.maxLabs : DEFAULT_MAX_LABS;
  const maxEncounters = Number.isInteger(o.maxEncounters) && o.maxEncounters >= 0 ? o.maxEncounters : DEFAULT_MAX_ENCOUNTERS;
  const maxProcedures = Number.isInteger(o.maxProcedures) && o.maxProcedures >= 0 ? o.maxProcedures : DEFAULT_MAX_PROCEDURES;
  const maxReports = Number.isInteger(o.maxReports) && o.maxReports >= 0 ? o.maxReports : DEFAULT_MAX_REPORTS;

  try {
    const b = sccmBundle && typeof sccmBundle === "object" ? sccmBundle : {};
    const asOf = o.asOf || (b.meta && b.meta.generatedAt) || null;

    // patient — minimal demographics; carry only what SCCM has, invent nothing.
    let patientOut = null;
    if (b.patient && typeof b.patient === "object") {
      const p = b.patient;
      patientOut = { id: p.id != null ? p.id : null, sex: p.gender || "unknown", age: computeAge(p.birthDate, asOf) };
      put(patientOut, "birthDate", p.birthDate);
    }

    // activeProblems — active/recurrence Conditions, most-recent first.
    const activeProblems = byRecencyDesc(
      capArray(b.conditions).filter((c) => {
        const s = lc(c && c.clinicalStatus);
        if (!s || s === "unknown") return true; // sensible fallback: absent status -> shown
        return CONDITION_ACTIVE.has(s);
      }),
      (c) => dateKey(c.recordedDate) != null ? dateKey(c.recordedDate) : dateKey(c.onset)
    ).slice(0, DEFAULT_MAX_PROBLEMS).map((c) => {
      const row = { code: ccCode(c.code), system: ccSystem(c.code), text: ccText(c.code) };
      put(row, "onset", dateStr(c.onset));
      return row;
    });

    // currentMedications — active/current MedicationStatements.
    const currentMedications = byRecencyDesc(
      capArray(b.medications).filter((m) => !MED_NOT_CURRENT.has(lc(m && m.status))),
      (m) => dateKey(m.effectivePeriod)
    ).slice(0, DEFAULT_MAX_MEDS).map((m) => {
      const row = { drug: ccText(m.medication), code: ccCode(m.medication) };
      put(row, "dose", m.dosage && m.dosage.text);
      put(row, "route", m.dosage && m.dosage.route);
      return row;
    });

    // allergies — AllergyIntolerance entries (resolved/inactive suppressed).
    const allergies = capArray(b.allergies)
      .filter((a) => !ALLERGY_INACTIVE.has(lc(a && a.clinicalStatus)))
      .slice(0, DEFAULT_MAX_ALLERGIES)
      .map((a) => {
        const row = { substance: ccText(a.code), code: ccCode(a.code) };
        const reactions = asArray(a.reactions)
          .map((r) => (r && r.manifestation && ccText(r.manifestation)) || ccText(r) || (typeof r === "string" ? r : null))
          .filter(Boolean);
        if (reactions.length) row.reaction = reactions;
        put(row, "criticality", a.criticality);
        return row;
      });

    // recentAbnormalLabs — laboratory Observations flagged abnormal OR out-of-range, most-recent first, capped.
    const recentAbnormalLabs = byRecencyDesc(
      capArray(b.observations)
        .filter((ob) => ob && ob.category === "laboratory")
        .map((ob) => ({ ob, ab: labAbnormality(ob) }))
        .filter((x) => x.ab.abnormal),
      (x) => dateKey(x.ob.effectiveDateTime)
    ).slice(0, maxLabs).map(({ ob, ab }) => {
      const lv = labValue(ob.value);
      return { code: ccCode(ob.code), text: ccText(ob.code), value: lv.value, unit: lv.unit, flag: ab.flag, effective: ob.effectiveDateTime || null };
    });

    // recentEncounters — last N encounters, most-recent first.
    const recentEncounters = byRecencyDesc(capArray(b.encounters), (e) => dateKey(e.period))
      .slice(0, maxEncounters)
      .map((e) => {
        const row = { type: e.class || e.status || null, date: dateStr(e.period) };
        put(row, "reason", typeof e.reason === "string" ? e.reason : (e.reason && ccText(e.reason)));
        return row;
      });

    // keyProcedures — SCCM v1 has no Procedure resource; pass through defensively if a bundle carries them.
    const keyProcedures = byRecencyDesc(capArray(b.procedures), (p) => dateKey(p.performedDateTime) != null ? dateKey(p.performedDateTime) : dateKey(p.date))
      .slice(0, maxProcedures)
      .map((p) => {
        const row = { code: ccCode(p.code), text: ccText(p.code) };
        put(row, "system", ccSystem(p.code));
        put(row, "date", dateStr(p.performedDateTime) || dateStr(p.date));
        return row;
      });

    // diagnosticReports — pass through when present, most-recent first.
    const diagnosticReports = byRecencyDesc(capArray(b.diagnosticReports), (d) => dateKey(d.effectiveDateTime))
      .slice(0, maxReports)
      .map((d) => {
        const row = { code: ccCode(d.code), text: ccText(d.code), status: d.status || null, effective: d.effectiveDateTime || null };
        put(row, "conclusion", d.conclusion);
        return row;
      });

    const summary = buildSummary(patientOut, activeProblems.length, currentMedications.length, allergies.length, recentAbnormalLabs.length);

    return { patient: patientOut, activeProblems, currentMedications, allergies, recentAbnormalLabs, recentEncounters, keyProcedures, diagnosticReports, summary };
  } catch {
    // Belt-and-suspenders: a malformed/hostile bundle must never throw. Return the safe empty shape.
    return { patient: null, activeProblems: [], currentMedications: [], allergies: [], recentAbnormalLabs: [], recentEncounters: [], keyProcedures: [], diagnosticReports: [], summary: buildSummary(null, 0, 0, 0, 0) };
  }
}

// Deterministic one-line summary — COUNTS ONLY, plus demographics. No LLM, no clinical judgement, no findings.
function buildSummary(patientOut, nProblems, nMeds, nAllergies, nLabs) {
  let prefix;
  if (!patientOut) prefix = "Patient";
  else {
    const sc = { female: "F", male: "M", other: "O", unknown: "U" }[patientOut.sex] || "U";
    if (patientOut.age != null) prefix = String(patientOut.age) + sc;
    else if (patientOut.sex && patientOut.sex !== "unknown") prefix = patientOut.sex.charAt(0).toUpperCase() + patientOut.sex.slice(1);
    else prefix = "Patient";
  }
  return prefix + ". " + nProblems + " active problems, " + nMeds + " current meds, " + nAllergies + " allergies, " + nLabs + " abnormal labs.";
}
