/* MaiK Clinical Decision Engine — the "brain" orchestrator.
 *
 * window.MaiKBrain runs the 12-stage deterministic, KB-first, safety-first reasoning pipeline
 * (spec: docs/superpowers/specs/2026-07-30-maik-clinical-decision-engine-design.md).
 * Deterministic-local-first: every stage here is local + zero-token. The LLM router (/refine)
 * and Gemini (/explain) are invoked ONLY by the planner/executor (Phase 2+), and only when
 * local confidence is insufficient. NOT wired into the app until the full path is proven;
 * flag smd_maik_brain (default OFF).
 *
 * PHASE 1 (this file): deterministic FRONT HALF (stages 1-8) — language, scope, intent,
 * context (follow-ups), entity recognition, ontology mapping, ambiguity (lexical + clinical),
 * dialogue. Reuses MaiKScope + MaiKKB + MEDDRUGS. Never guesses between clinically different
 * conditions: ambiguous acronyms (MS, DM, PE…) → ask; broad concepts → overview + chips.
 *
 * ── Contracts ──────────────────────────────────────────────────────────────
 * @typedef {Object} Query      {raw, norm, lang}
 * @typedef {Object} Entity     {surface, canonicalId, canonicalName, type, parentId?,
 *                               subtypes?, confidence, match?}
 * @typedef {Object} Ambiguity  {kind:'none'|'lexical'|'clinical', options:Array, decision}
 * @typedef {Object} Resolved   {query, scope, intent, entities, primary, context, ambiguity,
 *                               decision:'answer'|'overview'|'ask'|'refuse'}
 * @typedef {Object} Plan       {steps, needsGemini, estCost}          // Phase 2
 * @typedef {Object} Answer     {intent, entities, sections, doses, citations, safetyFlags,
 *                               refinements, followups, mode, confidence}   // Phase 3
 */
(function (root) {
  "use strict";
  var VERSION = "1.0.0-phase1";
  function G(n) { try { return root[n]; } catch (e) { return null; } }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim(); }

  // ── Stage 1 — language (light; EN-first clinician app) ─────────────────────
  var SCRIPTS = [["hi", /[ऀ-ॿ]/], ["bn", /[ঀ-৿]/], ["te", /[ఀ-౿]/], ["ta", /[஀-௿]/], ["kn", /[ಀ-೿]/], ["ml", /[ഀ-ൿ]/], ["gu", /[઀-૿]/], ["pa", /[਀-੿]/], ["ar", /[؀-ۿ]/]];
  function detectLang(raw) { var s = String(raw || ""); for (var i = 0; i < SCRIPTS.length; i++) if (SCRIPTS[i][1].test(s)) return SCRIPTS[i][0]; return "en"; }

  // ── Stage 2 — medical vs non-medical (reuse the allow-list firewall) ───────
  function scopeOf(raw) { var S = G("MaiKScope"); if (S && S.classify) { try { return S.classify(raw); } catch (e) {} } return { medical: true, category: "medical" }; }

  // ── Ontology asset: genuinely AMBIGUOUS clinical acronyms → candidate expansions.
  // An abbreviation-disambiguation table (a sibling of MaiKKB's ABBREV), NOT per-disease
  // logic. When one of these is the dominant content of a query, MaiK must ASK, never guess.
  var AMBIG = {
    ms: ["Multiple Sclerosis", "Mitral Stenosis"],
    ra: ["Rheumatoid Arthritis", "Right Atrium"],
    pe: ["Pulmonary Embolism", "Pleural Effusion"],
    as: ["Aortic Stenosis", "Ankylosing Spondylitis"],
    mi: ["Myocardial Infarction", "Mitral Incompetence"],
    af: ["Atrial Fibrillation", "Atrial Flutter"],
    pa: ["Pernicious Anaemia", "Pulmonary Artery", "Primary Aldosteronism"],
    dm: ["Diabetes Mellitus", "Dermatomyositis"],
    mr: ["Mitral Regurgitation", "Measles-Rubella"],
    ar: ["Aortic Regurgitation", "Allergic Rhinitis"],
    cp: ["Chest Pain", "Cerebral Palsy"],
    ca: ["Cancer / Carcinoma", "Cardiac Arrest"],
    tb: null   // sentinel: NOT ambiguous (tuberculosis) — expandAbbrev handles it
  };
  // words that carry intent/qualifiers but do NOT disambiguate a bare acronym
  var STOP = new Set("the a an of for in to is are what whats how do i you me tell explain about treatment treat manage management dose dosing dosage cause causes differential differentials symptom symptoms feature features sign signs investigation investigations workup ix rx mx prognosis pathophysiology overview definition define approach red flags flag severity monitoring prevention follow up followup guideline protocol please kindly ok okay".split(" "));

  // ── Stage 4 — conversation follow-up detection (needs context) ─────────────
  var FU = [
    { re: /\b(full|loading|maintenance|max|maximum|paediatric|pediatric|adult|the)?\s*dose(s|ing)?\b/, intent: "dose" },
    { re: /\b(renal|kidney|ckd|dialysis)\b/, intent: "renal" },
    { re: /\b(pregnan|lactat|breastfeed)\w*/, intent: "pregnancy" },
    { re: /\b(what|whats)\s+(next|now|after)\b/, intent: "next" },
    { re: /\b(contraindic|caution|avoid)\w*/, intent: "contraindication" },
    { re: /\b(monitor|monitoring|follow ?up)\b/, intent: "monitoring" },
    { re: /\b(alternativ|second line|other option)\w*/, intent: "alternatives" }
  ];
  function resolveFollowup(q, context) {
    if (!context || !context.disease) return null;
    var content = q.split(" ").filter(function (t) { return t && !STOP.has(t); });
    // a follow-up is a SHORT phrase (no new disease token) that matches a FU pattern
    if (content.length > 3) return null;
    for (var i = 0; i < FU.length; i++) {
      if (FU[i].re.test(q)) return { intent: FU[i].intent, disease: context.disease, lastDrug: context.lastDrug || null };
    }
    // bare affirmative / "and X" continuations also resolve against context
    if (/^(yes|yeah|ok|sure|go on|continue|and|also)\b/.test(q)) return { intent: context.intent || "treatment", disease: context.disease };
    return null;
  }

  // ── Stage 3 — intent (unified; reuse MaiKKB, normalise) ────────────────────
  function intentOf(raw) { var KB = G("MaiKKB"); if (KB && KB.classifyIntent) { try { return KB.classifyIntent(raw); } catch (e) {} } return null; }

  // ── Stage 5 — is the primary content a DRUG? (deterministic, exact-ish) ────
  function drugEntity(raw) {
    var D = G("MEDDRUGS"); if (!D) return null;
    // try each meaningful token as a generic/brand
    var toks = norm(raw).split(" ").filter(function (t) { return t.length >= 4 && !STOP.has(t); });
    for (var i = 0; i < toks.length; i++) {
      var hit = null;
      try { hit = D.findByName ? D.findByName(toks[i]) : null; } catch (e) {}
      if (!hit) { try { hit = D.match ? D.match(toks[i]) : null; } catch (e) {} }
      if (hit && (hit.generic || hit.name)) return { surface: toks[i], canonicalId: (hit.generic || hit.name), canonicalName: (hit.generic || hit.name), type: "drug", confidence: 0.9 };
    }
    return null;
  }

  // ── Stages 5/6 — disease entity + ontology mapping (reuse resolveTarget) ───
  function diseaseEntity(raw, pkg) {
    var KB = G("MaiKKB"); if (!(KB && KB.resolveTarget)) return null;
    var t; try { t = KB.resolveTarget(raw, pkg || null); } catch (e) { return null; }
    if (!t || !t.id) return null;
    return { surface: raw, canonicalId: t.id, canonicalName: t.name || String(t.id).replace(/_/g, " "), type: "disease", confidence: t.confident ? 0.9 : 0.5, match: t.match || null };
  }

  // ── Stage 7 — lexical ambiguity: a bare ambiguous acronym dominating the query
  function lexicalAmbiguity(q) {
    var toks = q.split(" ");
    var content = toks.filter(function (t) { return t && !STOP.has(t); });
    // find an ambiguous acronym token
    for (var i = 0; i < toks.length; i++) {
      var opts = AMBIG[toks[i]];
      if (opts && opts.length >= 2) {
        // ambiguous ONLY if no other disease-bearing content disambiguates it
        var others = content.filter(function (t) { return t !== toks[i] && !(t in AMBIG); });
        if (others.length === 0) return { kind: "lexical", options: opts, decision: "ask" };
      }
    }
    return null;
  }

  // ── Stage 8 — clinical (broad-concept) ambiguity via the dialogue manager ──
  function clinicalAmbiguity(raw) {
    var KB = G("MaiKKB"); if (!(KB && KB.clinicalDialogue)) return null;
    try {
      var cd = KB.clinicalDialogue(raw);
      if (cd && cd.mode === "ask") return { kind: "clinical", options: cd.subtypes || [], decision: "ask" };
      if (cd && cd.mode === "overview") return { kind: "clinical", options: cd.subtypes || [], decision: "overview" };
    } catch (e) {}
    return null;
  }

  /**
   * Resolve a raw query through the deterministic front half (stages 1-8).
   * @returns {Resolved}
   */
  function resolve(raw, context) {
    context = context || {};
    var query = { raw: String(raw == null ? "" : raw), norm: norm(raw), lang: detectLang(raw) };
    var q = query.norm;
    var none = { kind: "none", options: [], decision: "answer" };

    // Stage 2 — scope
    var scope = scopeOf(query.raw);
    if (!scope || scope.medical === false) {
      return { query: query, scope: scope || { medical: false, category: "non_medical" }, intent: null, entities: [], primary: null, context: context, ambiguity: { kind: "none", options: [], decision: "refuse" }, decision: "refuse" };
    }

    // Stage 4 — conversation follow-up wins early (resolve against context, don't re-ask)
    var fu = resolveFollowup(q, context);
    if (fu) {
      var pctx = { surface: fu.disease, canonicalId: fu.disease, canonicalName: fu.disease, type: "disease", confidence: 0.85, match: "context" };
      return { query: query, scope: scope, intent: fu.intent, entities: [pctx], primary: pctx, context: context, ambiguity: none, decision: "answer" };
    }

    // Stage 7 — lexical ambiguity (bare ambiguous acronym) → never guess
    var lex = lexicalAmbiguity(q);
    if (lex) return { query: query, scope: scope, intent: intentOf(query.raw), entities: [], primary: null, context: context, ambiguity: lex, decision: "ask" };

    // Stages 5/6 — entity recognition + ontology mapping
    var intent = intentOf(query.raw);
    var drug = drugEntity(query.raw);                    // best-effort (local list is a subset)
    var disease = diseaseEntity(query.raw, context.pkg);
    var confidentDisease = disease && disease.confidence >= 0.9 && disease.match !== "fallback" ? disease : null;
    var answerWith = function (p) { return { query: query, scope: scope, intent: intent, entities: p ? [p] : [], primary: p || null, context: context, ambiguity: none, decision: "answer" }; };

    // Stage 8 — clinical broad-concept ambiguity. If the user NARROWED to a subtype (a
    // distinctive subtype token is present), answer it; otherwise overview + chips / ask.
    var clin = clinicalAmbiguity(query.raw);
    if (clin) {
      // Answer (don't re-clarify) when the user NARROWED to a subtype, OR named the full
      // multi-word concept exactly (e.g. "nephrotic syndrome", "bacterial meningitis"). A bare
      // broad head ("meningitis", "diabetes") does neither → safe parent overview + chips.
      if (_queryNarrows(q, clin) || _queryNamesConcept(q, confidentDisease)) return answerWith(confidentDisease || drug || null);
      return { query: query, scope: scope, intent: intent, entities: confidentDisease ? [confidentDisease] : [], primary: confidentDisease || null, context: context, ambiguity: clin, decision: clin.decision };
    }

    // Specific concept → answer. Drug query, or confident KB disease → answer with the entity.
    if (drug) return answerWith(drug);
    if (confidentDisease) return answerWith(confidentDisease);

    // Specific medical query with a real content noun but no confident LOCAL KB hit (e.g. a
    // drug not in the 71-item local list): ANSWER — route to the drug DB / Gemini in execution —
    // rather than guess a low-confidence KB entity or needlessly re-ask.
    var content = q.split(" ").filter(function (t) { return t.length >= 3 && !STOP.has(t) && !(t in AMBIG); });
    if (content.length >= 1) return answerWith(null);

    // Truly vague (only intent/stop words, e.g. bare "dose") → one clarification.
    return { query: query, scope: scope, intent: intent, entities: [], primary: null, context: context, ambiguity: { kind: "clinical", options: [], decision: "ask" }, decision: "ask" };
  }

  // The query "narrows" a broad concept when it contains a DISTINCTIVE subtype token — a token
  // from a subtype label that is NOT shared by all subtypes (so the shared broad head, e.g.
  // "meningitis", never counts). Uses the dialogue manager's own subtype list (ontology-driven).
  function _queryNarrows(q, clin) {
    var opts = (clin && clin.options || []).map(function (o) {
      var lbl = (typeof o === "string") ? o : (o && (o.label || o.name || o.text || o.title)) || "";
      return norm(lbl).split(" ").filter(function (t) { return t.length >= 4 && !STOP.has(t); });
    }).filter(function (a) { return a.length; });
    if (opts.length < 2) return false;
    var shared = opts[0].filter(function (t) { return opts.every(function (a) { return a.indexOf(t) >= 0; }); });
    var sharedSet = new Set(shared);
    var qset = new Set(q.split(" "));
    for (var i = 0; i < opts.length; i++) for (var j = 0; j < opts[i].length; j++) {
      var t = opts[i][j]; if (!sharedSet.has(t) && qset.has(t)) return true;
    }
    return false;
  }

  // The query "names the concept" when every significant token of a MULTI-word canonical name
  // is present (the user typed the full specific concept). ≥2 significant tokens required, so a
  // single-word broad head ("meningitis") never trivially matches.
  function _queryNamesConcept(q, disease) {
    if (!disease) return false;
    var toks = norm(disease.canonicalName).split(" ").filter(function (t) { return t.length >= 4 && !STOP.has(t); });
    if (toks.length < 2) return false;
    var qset = new Set(q.split(" "));
    return toks.every(function (t) { return qset.has(t); });
  }

  function run(raw, context) { return { resolved: resolve(raw, context), plan: null, answer: null, defer: true }; }

  var api = { version: VERSION, run: run, resolve: resolve, detectLang: detectLang, _norm: norm, _AMBIG: AMBIG };
  try { root.MaiKBrain = api; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
