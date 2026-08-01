// functions/_connect/maik/module-orchestrator.js — Part 4: Intelligent Module Orchestrator (MaiK).
//
// From an assembled clinical context (see ./clinical-context.js) + the derived alerts (see ./clinical-alerts.js),
// deterministically SUGGEST which StewardMD modules a clinician may find relevant for THIS patient. It is a
// HEURISTIC AID built from a small declarative rules table. DETERMINISTIC, PURE, NO SIDE EFFECTS, NO ML, NO LLM,
// NO NETWORK.
//
// CRITICAL SAFETY BOUNDARY (same as the rest of Part 4 / FollowCare): this SUGGESTS tools for the clinician to
// open; it does NOT auto-launch a module, does NOT diagnose, and does NOT make any clinical decision. Every
// suggestion is "you may find X useful because <evidence from the record>". No fabrication: every clinical string
// in a reason/evidence is copied FROM the context (or from an alert, which is itself context-derived). No
// directive/dosing language.
//
// THE MAPPING IS CONSERVATIVE AND NOT EXHAUSTIVE. It matches the strings/codes already in the record against a
// small keyword + ICD-prefix table. It is a decision aid, NOT a care pathway and NOT a completeness guarantee.
// It only names a specific tool (e.g. a renal-dosing calculator) when the signal is unambiguous, and never
// guesses an imaging module from an unrelated problem. research-mode is offered ONLY as a thin-context fallback.

const HARD_CAP = 5000; // ceiling on items scanned per list — bounds work on a hostile context
const DEFAULT_MAX_SUGGESTIONS = 12; // there are only 10 modules; a generous, stable ceiling
const DEFAULT_MAX_EVIDENCE = 20; // per-suggestion evidence ceiling
const DEFAULT_THIN_SIGNAL_MAX = 1; // <= this many clinical signals (with a clinical question) counts as "thin"

// moduleId -> human label. Fixed vocabulary (module descriptors, NOT clinical claims).
const MODULES = {
  "drug-database": "Drug interactions & monograph",
  "prescription-builder": "Prescription Builder",
  "clinical-calculators": "Clinical Calculators",
  "kardiox": "ECG / KardioQ X",
  "thorx": "Chest X-ray",
  "fundx": "Fundus / Retina",
  "scribe": "Medical Scribe",
  "protocol-library": "Protocol Library",
  "guideline-engine": "Guideline Engine",
  "research-mode": "Research Mode",
};

// priority vocabulary + rank (lower = higher priority = sorts first). Stable, no wall clock, no randomness.
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const RANK_NAME = { 0: "high", 1: "medium", 2: "low" };

// Conservative keyword tables (matched as normalized substrings of a problem's text). Multi-char, unambiguous
// terms only — no 2-letter abbreviations, to avoid spurious matches.
const CARDIAC_KW = ["myocardial infarction", "acute coronary", "coronary artery", "coronary syndrome", "angina",
  "arrhythmia", "atrial fibrillation", "atrial flutter", "supraventricular tachycardia", "ventricular tachycardia",
  "bradycardia", "heart failure", "cardiac arrest", "cardiomyopathy", "pericarditis", "myocarditis", "heart block",
  "long qt", "palpitation", "ischemic heart", "ischaemic heart", "chest pain", "stemi", "nstemi"];
const RESP_KW = ["pneumonia", "chronic obstructive", "copd", "asthma", "bronchitis", "bronchiectasis",
  "pulmonary embolism", "pulmonary edema", "pulmonary oedema", "pleural effusion", "pneumothorax",
  "respiratory failure", "tuberculosis", "interstitial lung", "lung mass", "lung nodule", "hemoptysis",
  "haemoptysis", "atelectasis"];
const DIABETES_RETINA_KW = ["diabet", "retinopathy", "retinal", "macular edema", "macular oedema", "glaucoma"];
const RENAL_LAB_KW = ["creatinine", "egfr", "gfr"];

// ICD-10 code-prefix tables (secondary to keywords). Distinctive letter prefixes only, so a numeric SNOMED code
// never collides. Conservative: hypertension (I10) is intentionally NOT treated as an ECG signal on its own.
const CARDIAC_ICD = ["I20", "I21", "I22", "I23", "I24", "I25", "I44", "I45", "I46", "I47", "I48", "I49", "I50"];
const RESP_ICD = ["J"]; // ICD-10 chapter J is the respiratory system
const DIABETES_ICD = ["E10", "E11", "E13", "H35", "H36"]; // diabetes + retinal disorders

// Lab flags that already encode a critical/panic result (mirror clinical-alerts.js).
const CRITICAL_LAB_FLAGS = new Set(["HH", "LL", "AA", "CC", "PANIC", "CRIT", "CRITICAL", "POS"]);

// ---- small pure helpers ------------------------------------------------------------------------------------

const asArray = (x) => (Array.isArray(x) ? x : []);
const capArray = (x) => asArray(x).slice(0, HARD_CAP);
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
const nn = (x) => (x == null ? null : x); // pass through, normalizing undefined -> null for stable evidence

const matchesKw = (haystack, kws) => { const h = norm(haystack); return !!h && kws.some((kw) => h.includes(kw)); };
const matchesIcd = (code, prefixes) => { const c = String(code == null ? "" : code).trim().toUpperCase(); return !!c && prefixes.some((p) => c.startsWith(p)); };

// Does an active problem match a category by keyword (on its text) OR ICD-prefix (on its code)?
const problemMatches = (p, kws, icd) => matchesKw(p && p.text, kws) || matchesIcd(p && p.code, icd);

// Compact, source-faithful evidence rows (spread only fields that are present in the record).
const problemEv = (p) => ({ from: "problem", text: nn(p.text), code: nn(p.code), system: nn(p.system) });
const medEv = (m) => ({ from: "medication", drug: nn(m.drug), code: nn(m.code) });
const labEv = (l) => ({ from: "lab", text: nn(l.text), code: nn(l.code), value: nn(l.value), unit: nn(l.unit), flag: nn(l.flag) });
const alertEv = (a) => ({ from: "alert", kind: nn(a.kind), severity: nn(a.severity) });
const encEv = (e) => ({ from: "encounter", type: nn(e.type), date: nn(e.date), reason: nn(e.reason) });

// Names for a reason string — always drawn from the record (text preferred, else code); nothing invented.
function namePhrase(items) {
  const names = items.map((x) => x.text || x.code).filter((s) => s != null && String(s).trim() !== "");
  return names.length ? " (" + names.join(", ") + ")" : "";
}

// ---- accumulator (dedupe + merge) --------------------------------------------------------------------------

// One entry per moduleId. Multiple signals merge their reasons + evidence; the highest priority wins.
function add(map, moduleId, reason, evidence, priority) {
  let s = map.get(moduleId);
  if (!s) { s = { moduleId, label: MODULES[moduleId], reasons: [], evidence: [], seen: new Set(), rank: 99 }; map.set(moduleId, s); }
  if (reason && !s.reasons.includes(reason)) s.reasons.push(reason);
  for (const e of asArray(evidence)) {
    const key = JSON.stringify(e);
    if (!s.seen.has(key)) { s.seen.add(key); s.evidence.push(e); }
  }
  const r = PRIORITY_RANK[priority];
  if (r != null && r < s.rank) s.rank = r;
  return s;
}

// ---- public API --------------------------------------------------------------------------------------------

export function suggestRelevantModules(clinicalContext, alerts = [], opts = {}) {
  try {
    const o = opts || {};
    const maxSuggestions = Number.isInteger(o.maxSuggestions) && o.maxSuggestions >= 0 ? o.maxSuggestions : DEFAULT_MAX_SUGGESTIONS;
    const maxEvidence = Number.isInteger(o.maxEvidence) && o.maxEvidence >= 0 ? o.maxEvidence : DEFAULT_MAX_EVIDENCE;
    const thinMax = Number.isInteger(o.thinSignalMax) && o.thinSignalMax >= 0 ? o.thinSignalMax : DEFAULT_THIN_SIGNAL_MAX;

    const ctx = clinicalContext && typeof clinicalContext === "object" ? clinicalContext : {};
    const problems = capArray(ctx.activeProblems);
    const meds = capArray(ctx.currentMedications);
    const labs = capArray(ctx.recentAbnormalLabs);
    const encounters = capArray(ctx.recentEncounters);
    const reports = capArray(ctx.diagnosticReports);
    const procedures = capArray(ctx.keyProcedures);
    // Accept either the alerts array or the full { alerts, counts } result object.
    const al = capArray(Array.isArray(alerts) ? alerts : (alerts && alerts.alerts));

    const map = new Map();

    // Rule: current medications on record -> drug interaction/monograph check + prescription builder.
    //   A flagged medication-safety alert (allergy-conflict / duplicate-therapy) raises drug-database to HIGH.
    if (meds.length) {
      const mev = meds.map(medEv);
      const safety = al.filter((a) => a && (a.kind === "allergy-conflict" || a.kind === "duplicate-therapy"));
      let ddReason = "Current medications are on record; a drug interaction and monograph check may be relevant.";
      let ddEvidence = mev;
      let ddPriority = "medium";
      if (safety.length) {
        ddPriority = "high";
        const kinds = Array.from(new Set(safety.map((a) => a.kind))).join(", ");
        ddReason += " A possible medication-safety issue was flagged (" + kinds + "), which may be worth reviewing first.";
        ddEvidence = mev.concat(safety.map(alertEv));
      }
      add(map, "drug-database", ddReason, ddEvidence, ddPriority);
      add(map, "prescription-builder",
        "Current medications are on record; the Prescription Builder may be useful when reviewing the current medication list.",
        mev, "medium");
    }

    // Rule: abnormal labs -> clinical calculators. Name a specific calculator class only when unambiguous
    //   (renal creatinine/eGFR -> renal-dosing calculator); otherwise stay generic (no over-claim).
    if (labs.length) {
      const renal = labs.filter((l) => matchesKw((l.text || "") + " " + (l.code || ""), RENAL_LAB_KW));
      if (renal.length) {
        const critical = renal.some((l) => CRITICAL_LAB_FLAGS.has(String(l.flag == null ? "" : l.flag).trim().toUpperCase()));
        add(map, "clinical-calculators",
          "Abnormal renal results are on record" + namePhrase(renal) + "; the renal-dosing calculator may be relevant.",
          renal.map(labEv), critical ? "high" : "medium");
      } else {
        add(map, "clinical-calculators",
          "Abnormal laboratory results are on record; clinical calculators may be relevant.",
          labs.map(labEv), "medium");
      }
    }

    // Rule: a cardiac / respiratory / diabetes-retinal active problem -> the matching imaging module.
    const cardiac = problems.filter((p) => problemMatches(p, CARDIAC_KW, CARDIAC_ICD));
    if (cardiac.length) add(map, "kardiox",
      "A cardiac-related problem is on the active list" + namePhrase(cardiac) + "; ECG / KardioQ X may be relevant for review.",
      cardiac.map(problemEv), "medium");
    const resp = problems.filter((p) => problemMatches(p, RESP_KW, RESP_ICD));
    if (resp.length) add(map, "thorx",
      "A respiratory-related problem is on the active list" + namePhrase(resp) + "; chest X-ray review (ThorX) may be relevant.",
      resp.map(problemEv), "medium");
    const dia = problems.filter((p) => problemMatches(p, DIABETES_RETINA_KW, DIABETES_ICD));
    if (dia.length) add(map, "fundx",
      "A diabetes or retinal problem is on the active list" + namePhrase(dia) + "; fundus / retina imaging (FundX) may be relevant.",
      dia.map(problemEv), "medium");

    // Rule: any active problems -> protocol library + guideline engine (general management references).
    if (problems.length) {
      const pev = problems.map(problemEv);
      add(map, "protocol-library",
        "Active problems are on record" + namePhrase(problems.slice(0, 3)) + (problems.length > 3 ? " and others" : "") + "; the Protocol Library may be relevant.",
        pev, "medium");
      add(map, "guideline-engine",
        "Active problems are on record; the Guideline Engine may be relevant to current management.",
        pev, "medium");
    }

    // Rule: a recent encounter -> the Medical Scribe (documentation aid). Low priority (workflow, not clinical).
    if (encounters.length) {
      add(map, "scribe",
        "A recent encounter is on record; the Medical Scribe may be useful for documenting the visit.",
        [encEv(encounters[0])], "low");
    }

    // Rule (FALLBACK ONLY): thin context. v1 has no internal guideline-coverage database, so research-mode is
    //   offered only when there is a clinical question (a problem or an encounter) but the record is thin.
    const signalCount = problems.length + meds.length + labs.length + reports.length + procedures.length;
    const hasClinicalQuestion = problems.length > 0 || encounters.length > 0;
    if (hasClinicalQuestion && signalCount <= thinMax) {
      const ev = problems.length ? problems.map(problemEv) : encounters.length ? [encEv(encounters[0])] : [];
      add(map, "research-mode",
        "The record is thin (limited internal coverage signal); Research Mode may be a useful fallback for looking into the presentation.",
        ev, "low");
    }

    // Finalize: STABLE ordering (priority desc -> moduleId asc), dedupe already done, bounded.
    const suggestions = Array.from(map.values())
      .sort((a, b) => (a.rank - b.rank) || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0))
      .slice(0, maxSuggestions)
      .map((s) => ({
        moduleId: s.moduleId,
        label: s.label,
        reason: s.reasons.join(" "),
        evidence: s.evidence.slice(0, maxEvidence),
        priority: RANK_NAME[s.rank] || "low",
      }));

    const counts = {};
    for (const s of suggestions) counts[s.priority] = (counts[s.priority] || 0) + 1;
    return { suggestions, counts };
  } catch {
    // A malformed/hostile context must never throw — return the safe empty result.
    return { suggestions: [], counts: {} };
  }
}
