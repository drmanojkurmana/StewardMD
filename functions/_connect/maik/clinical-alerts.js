// functions/_connect/maik/clinical-alerts.js — Part 4: Clinical Alert Framework (deterministic safety FLAGS).
//
// Turns the assembled clinical context (see ./clinical-context.js) into a bounded, deterministic list of
// possible safety issues for the clinician to REVIEW. DETERMINISTIC, PURE, NO SIDE EFFECTS, NO LLM, NO NETWORK.
//
// CRITICAL SAFETY BOUNDARY (mirrors FollowCare): this module SURFACES/FLAGS possible safety issues. It must
// NEVER diagnose definitively, NEVER recommend or change a dose, NEVER tell anyone to stop/start/hold a med.
// Every alert is a "possible ... review" flag whose evidence is copied FROM THE RECORD — it invents nothing.
//
// MATCHING IS CONSERVATIVE AND NOT EXHAUSTIVE. v1 has NO drug database: it compares the strings already in the
// record (name + code). A brand/generic or cross-reactive-class name mismatch (e.g. "amoxicillin" vs a
// "penicillin" allergy) WILL be missed — this is a decision aid, NOT a guarantee of completeness. Real
// drug-interaction and renal-dose alerts need the main app's engines and are a later integration (not v1).

const DEFAULT_MAX_PER_KIND = 50;
const DEFAULT_POLYPHARMACY_THRESHOLD = 5;
const MIN_SUBSTRING = 4; // a "clear" substring must be at least this long — avoids spurious short-token matches.

// Fixed severity vocabulary + rank (lower = more severe = sorts first). No wall clock, no randomness.
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
// Flags that already encode a critical/panic result on a lab (e.g. HH = critical-high, LL = critical-low).
const CRITICAL_LAB_FLAGS = new Set(["HH", "LL", "AA", "CC", "PANIC", "CRIT", "CRITICAL", "POS"]);

// ---- small pure helpers ------------------------------------------------------------------------------------

const asArray = (x) => (Array.isArray(x) ? x : []);
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
const numeric = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// Conservative "clinically looks like the same thing" test for two record strings (names OR codes):
// exact after normalization, or one clearly contains the other (contained token >= MIN_SUBSTRING chars).
function tokenMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [shortT, longT] = x.length <= y.length ? [x, y] : [y, x];
  return shortT.length >= MIN_SUBSTRING && longT.includes(shortT);
}

// A stable identifier for the record item, code preferred, else the (trimmed) name — for refs + tiebreak keys.
const refOf = (name, code) => {
  const c = code == null ? "" : String(code).trim();
  if (c) return c;
  const n = name == null ? "" : String(name).trim();
  return n || null;
};

// ---- severity helpers --------------------------------------------------------------------------------------

// Severity of an abnormal lab. "How far out of range if computable": if the record carries a numeric value with
// a reference range, a value more than one full range-width outside (or grossly past a one-sided bound) is
// critical. Otherwise fall back to the flag marker (HH/LL/panic => critical). Everything else => warning.
function labSeverity(lab) {
  const f = String(lab.flag == null ? "" : lab.flag).trim().toUpperCase();
  if (f && CRITICAL_LAB_FLAGS.has(f)) return "critical";

  const v = numeric(lab.value), lo = numeric(lab.low), hi = numeric(lab.high);
  if (v != null && (lo != null || hi != null)) {
    if (lo != null && hi != null && hi > lo) {
      const w = hi - lo;
      if (v < lo - w || v > hi + w) return "critical";
    } else if (lo != null && v < lo * 0.5) return "critical";
    else if (hi != null && v > hi * 2) return "critical";
  }
  return "warning";
}

// ---- alert builders (each returns an array, already bounded by the caller) ----------------------------------

// allergy-conflict: a current medication that matches (name OR code) a recorded allergy. High criticality is
// critical, everything else warning. Evidence carries BOTH source objects; no dose/decision is emitted.
function allergyConflicts(meds, allergies) {
  const out = [];
  for (const med of meds) {
    for (const al of allergies) {
      const hit = tokenMatch(med && med.drug, al && al.substance) || tokenMatch(med && med.code, al && al.code);
      if (!hit) continue;
      const crit = norm(al.criticality);
      const severity = crit === "high" ? "critical" : "warning";
      const medName = med.drug || med.code || "medication";
      const subName = al.substance || al.code || "recorded allergen";
      const critNote = al.criticality ? " (criticality " + al.criticality + ")" : "";
      out.push(mkAlert(
        "allergy-conflict", severity,
        "Possible allergy conflict: current medication " + medName + " may match a recorded allergy to " + subName + critNote + ". Please review.",
        { med, allergy: al },
        [refOf(med.drug, med.code), refOf(al.substance, al.code)]
      ));
    }
  }
  return out;
}

// duplicate-therapy: >= 2 current meds that share a normalized name OR a code (union-find grouping so a chain of
// matches collapses into one alert). Surfaces a possible duplication for review; asserts nothing about intent.
function duplicateTherapy(meds) {
  const n = meds.length;
  const parent = meds.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sameName = norm(meds[i].drug) && norm(meds[i].drug) === norm(meds[j].drug);
      const codeI = norm(meds[i].code), codeJ = norm(meds[j].code);
      const sameCode = codeI && codeI === codeJ;
      if (sameName || sameCode) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(meds[i]); }
  const out = [];
  for (const drugs of groups.values()) {
    if (drugs.length < 2) continue;
    const names = drugs.map((d) => d.drug || d.code || "medication");
    out.push(mkAlert(
      "duplicate-therapy", "warning",
      "Possible duplicate therapy: " + names.join(", ") + " appear to be the same medication on the current list. Please review.",
      { drugs },
      drugs.map((d) => refOf(d.drug, d.code)).filter(Boolean)
    ));
  }
  return out;
}

// abnormal-lab: one flag per already-abnormal lab in the context. Names the lab + value + flag; severity from
// labSeverity(). It restates the record's own abnormal finding for review — it does not interpret or diagnose.
function abnormalLabs(labs) {
  const out = [];
  for (const lab of labs) {
    const name = lab.text || lab.code || "lab result";
    const val = lab.value == null ? "" : String(lab.value);
    const unit = lab.unit ? " " + lab.unit : "";
    const flag = lab.flag ? " (" + lab.flag + ")" : "";
    const valPart = val ? " " + val + unit : "";
    out.push(mkAlert(
      "abnormal-lab", labSeverity(lab),
      "Abnormal lab on record: " + name + valPart + flag + ". Possible clinical significance; please review.",
      lab,
      [refOf(lab.text, lab.code)].filter(Boolean)
    ));
  }
  return out;
}

// polypharmacy: a plain count-based flag when the current-med list reaches the threshold. Count is a faithful
// derivation of the list length (like the assembler's summary counts) — no clinical string is invented.
function polypharmacy(meds, threshold) {
  if (meds.length < threshold) return [];
  return [mkAlert(
    "polypharmacy", "info",
    "Polypharmacy: " + meds.length + " current medications on record. Consider reviewing for interactions and appropriateness.",
    { count: meds.length },
    []
  )];
}

function mkAlert(kind, severity, message, evidence, refs) {
  return { kind, severity, message, evidence, refs: asArray(refs).filter((r) => r != null && r !== "") };
}

// ---- public API --------------------------------------------------------------------------------------------

export function deriveClinicalAlerts(clinicalContext, opts = {}) {
  try {
    const o = opts || {};
    const maxPerKind = Number.isInteger(o.maxPerKind) && o.maxPerKind >= 0 ? o.maxPerKind : DEFAULT_MAX_PER_KIND;
    const polyThreshold = Number.isInteger(o.polypharmacyThreshold) && o.polypharmacyThreshold > 0
      ? o.polypharmacyThreshold : DEFAULT_POLYPHARMACY_THRESHOLD;

    const ctx = clinicalContext && typeof clinicalContext === "object" ? clinicalContext : {};
    const meds = asArray(ctx.currentMedications);
    const allergies = asArray(ctx.allergies);
    const labs = asArray(ctx.recentAbnormalLabs);

    // Build per kind, then cap each kind independently so no single kind can flood the surface.
    const byKind = [
      allergyConflicts(meds, allergies),
      duplicateTherapy(meds),
      abnormalLabs(labs),
      polypharmacy(meds, polyThreshold),
    ];
    let alerts = [];
    for (const group of byKind) alerts = alerts.concat(group.slice(0, maxPerKind));

    // STABLE deterministic ordering: severity desc, then kind, then a stable evidence signature.
    alerts.sort((a, b) => {
      const sr = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
      if (sr !== 0) return sr;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      const ea = JSON.stringify(a.evidence), eb = JSON.stringify(b.evidence);
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });

    const counts = {};
    for (const a of alerts) counts[a.kind] = (counts[a.kind] || 0) + 1;
    return { alerts, counts };
  } catch {
    // A malformed/hostile context must never throw — return the safe empty result.
    return { alerts: [], counts: {} };
  }
}
