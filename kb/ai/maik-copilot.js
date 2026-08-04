/* MaiK Clinical Copilot & Ecosystem Orchestrator (Part 3).
 *
 * window.MaiKCopilot turns MaiK from a Q&A assistant into a copilot that anticipates the next
 * clinical step and orchestrates StewardMD's tools. Deterministic + token-free — it decides
 * WHICH module/tool/next-step to surface; it never itself calls Gemini. Escalation, multi-agent
 * evidence, and token governance already live in MaiKBrain (planner/execute) + MaiKEvidence.
 *
 * Modules: workflow (Stage 2 — ordered clinical chains), orchestrate (Stage 1/10 — launchable
 * StewardMD tools), safetyScan (Stage 7 — proactive safety), gapLog/gapReport (Stage 9 —
 * anonymous knowledge-gap analytics, NOT LLM training). NOT wired into the app until the
 * flag-gated render augmentation (smd_maik_brain).
 */
(function (root) {
  "use strict";
  var VERSION = "1.0.0";
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim(); }
  function G(n) { try { return root[n]; } catch (e) { return null; } }

  // ── Stage 2 — clinical WORKFLOW chains (what a consultant does next, in order) ──
  // Each step is a re-askable MaiK query, so tapping it continues the workflow with full context.
  var WORKFLOW = [
    { kw: /\b(cap|community acquired pneumonia|pneumonia)\b/, steps: ["CURB-65 severity", "admission criteria", "empirical antibiotics", "renal dose adjustment", "when to switch IV to oral", "follow-up"] },
    { kw: /\bstroke\b|\bcva\b|infarct/, steps: ["NIHSS severity", "CT/thrombolysis checklist", "thrombolysis eligibility", "blood pressure target", "antiplatelet vs anticoagulation", "secondary prevention"] },
    { kw: /atrial fibrillation|\baf\b|\bafib\b/, steps: ["CHA₂DS₂-VASc", "HAS-BLED", "anticoagulation choice", "DOAC dose", "rate vs rhythm control", "monitoring"] },
    { kw: /pulmonary embolism/, steps: ["Wells score", "D-dimer vs CTPA", "PESI severity", "anticoagulation", "pregnancy pathway", "duration of therapy"] },
    { kw: /diabetic ketoacidosis|\bdka\b/, steps: ["fluid resuscitation", "insulin infusion", "potassium replacement", "monitoring & anion gap", "transition to subcutaneous insulin", "precipitant workup"] },
    { kw: /\bsepsis\b|septic shock/, steps: ["qSOFA / SOFA", "sepsis-6 bundle", "empirical antibiotics", "fluid & vasopressors", "source control", "lactate clearance"] },
    { kw: /upper gi bleed|variceal|haematemesis|melena/, steps: ["Glasgow-Blatchford", "resuscitation & transfusion threshold", "endoscopy timing", "PPI / terlipressin", "Rockall rebleed risk"] },
    { kw: /\backs\b|myocardial infarction|nstemi|stemi/, steps: ["ECG interpretation", "TIMI/GRACE risk", "antiplatelet loading", "anticoagulation", "reperfusion strategy", "secondary prevention"] }
  ];
  function workflow(resolved) {
    var hay = norm((resolved && resolved.query && resolved.query.raw) || "") + " " + norm((resolved && resolved.primary && resolved.primary.canonicalName) || "");
    for (var i = 0; i < WORKFLOW.length; i++) if (WORKFLOW[i].kw.test(hay)) return { condition: WORKFLOW[i].kw.source, steps: WORKFLOW[i].steps.slice() };
    return null;
  }

  // ── Stage 1/10 — TOOL ORCHESTRATOR (surface launchable StewardMD modules) ──────
  // Each tool: kind, label, a probe() that confirms the launcher exists, and an open() thunk.
  // Only tools whose launcher is present are surfaced (never dangle a dead chip).
  var TOOLS = {
    calculator: { label: "Open calculator", probe: function () { return !!(G("MEDCALC") && G("MEDCALC").open); }, open: function (id) { try { G("MEDCALC").open(id); } catch (e) {} } },
    drug: { label: "Drug database", probe: function () { return !!(G("MEDDRUGS") && G("MEDDRUGS").openList); }, open: function () { try { G("MEDDRUGS").openList(); } catch (e) {} } },
    ecg: { label: "KardiQ X (ECG)", probe: function () { return !!(G("SMD_KARDIOX") || G("KARDIOX")); }, open: function () { var m = G("SMD_KARDIOX") || G("KARDIOX"); try { (m.open || m.launch || function () {})(); } catch (e) {} } },
    cxr: { label: "ThoreX (chest X-ray)", probe: function () { return !!(G("SMD_THOREX") || G("THOREX")); }, open: function () { var m = G("SMD_THOREX") || G("THOREX"); try { (m.open || m.launch || function () {})(); } catch (e) {} } },
    fundus: { label: "FundX (fundus)", probe: function () { return !!G("FUNDX"); }, open: function () { var m = G("FUNDX"); try { (m.open || m.launch || function () {})(); } catch (e) {} } },
    scribe: { label: "MaiK Scribe (voice)", probe: function () { return !!(G("SMD_VOICE") && G("SMD_VOICE").openDialog); }, open: function () { try { G("SMD_VOICE").openDialog({ target: "text" }); } catch (e) {} } },
    rx: { label: "Prescription builder", probe: function () { return !!(G("SMD_RX")); }, open: function () { var m = G("SMD_RX"); try { (m.open || m.openPad || function () {})(); } catch (e) {} } }
  };
  function orchestrate(resolved) {
    var q = norm((resolved && resolved.query && resolved.query.raw) || ""), out = [];
    var add = function (kind, arg, why, labelOverride) { var t = TOOLS[kind]; if (t && t.probe()) out.push({ kind: kind, label: labelOverride || t.label, arg: arg || null, why: why || "" }); };
    // calculators: whatever the brain proactively suggested (Stage 6 relevance). Label each chip with
    // its OWN name (e.g. "CURB-65", "CRB-65") — not the generic "Open calculator" — so a topic that maps
    // to two scores no longer renders two identical "Open calculator" chips.
    var calcs = (G("MaiKBrain") && G("MaiKBrain").suggestCalcs) ? G("MaiKBrain").suggestCalcs(q, resolved && resolved.primary) : [];
    var _mc = G("MEDCALC"), _cseen = {};
    calcs.slice(0, 3).forEach(function (c) { if (!c || _cseen[c.id]) return; _cseen[c.id] = 1; var nm = (_mc && _mc.get && _mc.get(c.id) && _mc.get(c.id).title) || String(c.id || "").toUpperCase(); add("calculator", c.id, c.why, nm); });
    // modality intents
    if (/\becg\b|electrocardiogram|arrhythmia|\bst elevation\b/.test(q)) add("ecg", null, "interpret an ECG");
    if (/chest x.?ray|\bcxr\b|cxr\b/.test(q)) add("cxr", null, "interpret a chest X-ray");
    if (/fundus|retina|retinal|diabetic retinopathy/.test(q)) add("fundus", null, "fundus assessment");
    if (/prescri|\brx\b/.test(q) || (resolved && resolved.intent === "dose")) add("rx", null, "build a prescription");
    if (resolved && resolved.primary && resolved.primary.type === "drug") add("drug", null, "drug monograph / interactions");
    return out;
  }

  // ── Stage 7 — PROACTIVE SAFETY (never wait for the user to ask) ────────────────
  var HIGH_RISK = /\b(warfarin|heparin|enoxaparin|insulin|digoxin|methotrexate|lithium|amiodarone|morphine|fentanyl|oxycodone|vancomycin|gentamicin|amikacin|colchicine|clozapine|carbamazepine|phenytoin|theophylline)\b/;
  var DRUG_MORPH = /\b([a-z]{4,}(?:cillin|mycin|pril|sartan|statin|azole|parin|dipine|olol|prazole|floxacin|penem|cycline|conazole|tinib|mab|vir|pram|zepam|caine|dronate))\b/g;
  var HIGH_RISK_G = new RegExp(HIGH_RISK.source, "gi");   // global clone for extraction (HIGH_RISK stays non-global for .test)
  function drugsIn(text) { var t = norm(text), s = {}; (t.match(DRUG_MORPH) || []).forEach(function (d) { s[d] = 1; }); (t.match(HIGH_RISK_G) || []).forEach(function (d) { s[d] = 1; }); return Object.keys(s); }
  function safetyScan(resolved, ctx) {
    ctx = ctx || {};
    var raw = (resolved && resolved.query && resolved.query.raw) || "", q = norm(raw), alerts = [];
    var drugs = drugsIn(raw); (ctx.drugs || []).forEach(function (d) { if (drugs.indexOf(norm(d)) < 0) drugs.push(norm(d)); });
    // interactions — ≥2 drugs ALWAYS prompts a check; upgraded to a specific warning if the engine finds one
    if (drugs.length >= 2) {
      var found = null, INTX = G("INTERACTIONS");
      if (INTX && INTX.checkInteractions) { try { found = INTX.checkInteractions(drugs); } catch (e) {} }
      var has = !!(found && (found.length || (found.pairs && found.pairs.length)));
      alerts.push({ level: has ? "warn" : "info", kind: "interaction", msg: has ? ("Interaction flagged between " + drugs.join(" + ") + " — review before prescribing.") : ("Multiple drugs (" + drugs.join(", ") + ") — verify interactions.") });
    }
    // high-risk medication
    if (HIGH_RISK.test(q)) alerts.push({ level: "warn", kind: "high_risk", msg: "High-risk medication — confirm indication, dose and monitoring." });
    // renal / pregnancy context
    if (ctx.renal || /\b(ckd|aki|renal impairment|dialysis|egfr|creatinine clearance)\b/.test(q)) alerts.push({ level: "info", kind: "renal", msg: "Adjust dosing for renal function." });
    if (ctx.pregnant || /\b(pregnan|lactat|breastfeed)\w*/.test(q)) alerts.push({ level: "warn", kind: "pregnancy", msg: "Confirm pregnancy/lactation safety category before prescribing." });
    // red flags from the KB for the primary concept
    try {
      var KE = G("KB_ENRICHMENT"), id = resolved && resolved.primary && resolved.primary.canonicalId;
      if (KE && KE.byId && id && KE.byId[id] && KE.byId[id].redFlags && KE.byId[id].redFlags.length) alerts.push({ level: "warn", kind: "redflag", msg: "Red flags: " + KE.byId[id].redFlags.slice(0, 3).join("; ") + ".", source: "StewardMD KB" });
    } catch (e) {}
    return alerts;
  }

  // ── Stage 9 — anonymous knowledge-gap analytics (NEVER trains the LLM) ──────────
  var GAP_KEY = "smd_maik_gaps", GAP_CAP = 200;
  function gapLog(kind, query) {
    try {
      var arr = JSON.parse(root.localStorage.getItem(GAP_KEY) || "[]");
      arr.push({ k: kind, q: String(query || "").slice(0, 80) });   // no PHI; the query text a clinician typed
      if (arr.length > GAP_CAP) arr = arr.slice(arr.length - GAP_CAP);
      root.localStorage.setItem(GAP_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  function gapReport() {
    try {
      var arr = JSON.parse(root.localStorage.getItem(GAP_KEY) || "[]"), byKind = {}, byQuery = {};
      arr.forEach(function (e) { byKind[e.k] = (byKind[e.k] || 0) + 1; byQuery[e.q] = (byQuery[e.q] || 0) + 1; });
      var repeated = Object.keys(byQuery).filter(function (q) { return byQuery[q] >= 2; }).sort(function (a, b) { return byQuery[b] - byQuery[a]; });
      return { total: arr.length, byKind: byKind, repeated: repeated.slice(0, 20) };
    } catch (e) { return { total: 0, byKind: {}, repeated: [] }; }
  }

  var api = { version: VERSION, workflow: workflow, orchestrate: orchestrate, safetyScan: safetyScan, gapLog: gapLog, gapReport: gapReport, TOOLS: TOOLS, _drugsIn: drugsIn };
  try { root.MaiKCopilot = api; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
