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
  var VERSION = "3.0.0-phase3";
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

  // ════════════════════════════════════════════════════════════════════════
  // Stages 9-10 — PLANNER + EXECUTION + VALIDATION (deterministic; no Gemini here)
  // ════════════════════════════════════════════════════════════════════════

  // Proactive calculator relevance (spec Part-2 Stage 6). A clinical-knowledge asset mapping
  // conditions → the scores a clinician reaches for. Only IDs that exist in MEDCALC are used
  // (MEDCALC.run returns null otherwise, so a stale mapping degrades gracefully).
  var CALC_FOR = [
    { kw: /\b(cap|pneumonia)\b/, calcs: [{ id: "curb65", why: "CAP severity / disposition" }, { id: "crb65", why: "CAP severity (no labs)" }] },
    { kw: /atrial fibrillation|\baf\b|\bafib\b/, calcs: [{ id: "chadsvasc", why: "stroke risk" }, { id: "hasbled", why: "bleeding risk" }] },
    { kw: /pulmonary embolism|\bpe\b/, calcs: [{ id: "wells_pe", why: "PE pretest probability" }, { id: "pesi", why: "PE severity" }] },
    { kw: /\bdvt\b|deep vein/, calcs: [{ id: "wells_dvt", why: "DVT pretest probability" }] },
    { kw: /\bstroke\b|\bcva\b/, calcs: [{ id: "nihss", why: "stroke severity" }] },
    { kw: /\bsepsis\b|septic/, calcs: [{ id: "qsofa", why: "bedside sepsis risk" }, { id: "sofa", why: "organ dysfunction" }] },
    { kw: /cirrhosis|hepatic failure|chronic liver/, calcs: [{ id: "childpugh", why: "cirrhosis severity" }, { id: "meld3", why: "transplant / mortality" }] },
    { kw: /\bckd\b|chronic kidney|renal function|\baki\b/, calcs: [{ id: "ckdepi", why: "eGFR" }, { id: "crcl", why: "creatinine clearance" }] },
    { kw: /pancreatitis/, calcs: [{ id: "ranson", why: "severity" }, { id: "bisap", why: "mortality" }] },
    { kw: /\bacs\b|myocardial infarction|nstemi|chest pain/, calcs: [{ id: "timi_nstemi", why: "NSTE-ACS risk" }, { id: "timistemi", why: "STEMI mortality" }] },
    { kw: /gi bleed|upper gi|variceal|melena|haematemesis/, calcs: [{ id: "gbs", why: "Glasgow-Blatchford" }, { id: "rockall", why: "rebleed / mortality" }] },
    { kw: /\bcopd\b/, calcs: [{ id: "cat_copd", why: "symptom burden" }, { id: "decaf", why: "exacerbation mortality" }] }
  ];
  function suggestCalcs(q, primary) {
    var hay = (q + " " + (primary && primary.canonicalName ? norm(primary.canonicalName) : "")).trim();
    var out = [], seen = {};
    for (var i = 0; i < CALC_FOR.length; i++) {
      if (CALC_FOR[i].kw.test(hay)) {
        CALC_FOR[i].calcs.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); } });
      }
    }
    return out;
  }

  function step(source, op, args, why) { return { source: source, op: op, args: args || {}, why: why || "" }; }
  function drugLikely(q) { return /(cillin|pril|sartan|olol|statin|azole|mycin|parin|dipine|prazole|floxacin|tinib|mab|vir|penem|cef|dose of|dosing of)/.test(q); }

  /**
   * Stage 9 — build the cheapest safe execution plan. Deterministic. Gemini is flagged ONLY
   * when synthesis / reasoning / conflict-resolution genuinely adds value (spec Stage 13).
   * @returns {Plan}
   */
  function plan(resolved) {
    if (!resolved || resolved.decision !== "answer") return { steps: [], needsGemini: false, estCost: 0 };
    var q = resolved.query.norm, raw = resolved.query.raw, p = resolved.primary, intent = resolved.intent;
    var steps = [];
    var isInteraction = /\binteract/.test(q);
    var isDose = intent === "dose" || /\b(dose|dosing|dosage)\b/.test(q);
    var wantsCalc = /\b(score|curb\W?65|chads|wells|nihss|has\W?bled|calculat|risk score|qsofa)\b/.test(q);
    var isMgmt = /\b(treat|treatment|manage|management|regimen|first[- ]line|guideline|protocol|empiric)\b/.test(q);
    var comparison = /\b(vs|versus|compare|difference between)\b/.test(q) || (/\b(nice|esc|aha|acc|idsa|kdigo|ada|gold|gina|who|cdc|icmr)\b/.test(q) && isMgmt);
    var complex = false; try { complex = !!(root.MaiKKB && root.MaiKKB.isComplex && root.MaiKKB.isComplex(raw)); } catch (e) {}
    var calcs = suggestCalcs(q, p);

    if (isInteraction) steps.push(step("interactions", "check", {}, "interaction significance from the interactions engine"));
    if (isDose && (p && p.type === "drug" || drugLikely(q))) steps.push(step("drugdb", "lookup", { name: p && p.type === "drug" ? p.canonicalName : null }, "dose / renal / hepatic / pregnancy / interactions from the drug DB"));
    if (p && p.type === "disease") steps.push(step("kb", "compose", { id: p.canonicalId, intent: intent }, "StewardMD KB: " + (intent || "overview")));
    if (calcs.length) steps.push(step("calculator", wantsCalc ? "run" : "suggest", { calcs: calcs }, "relevant clinical score(s)"));
    if (isMgmt && p) steps.push(step("guideline", "lookup", { id: p.canonicalId }, "guideline recommendation + year + society"));

    // Token optimization (Stage 13): Gemini ONLY when it adds value.
    var substantive = steps.filter(function (s) { return ["kb", "guideline", "drugdb", "interactions"].indexOf(s.source) >= 0; });
    var needsGemini = complex || comparison || substantive.length === 0 || substantive.length >= 2;
    if (steps.length === 1 && steps[0].source === "calculator") needsGemini = false;   // pure score → compute, no Gemini
    if (isDose && p && p.type === "drug" && !isInteraction && substantive.length <= 1) needsGemini = false; // pure dose lookup
    return { steps: steps, needsGemini: needsGemini, estCost: needsGemini ? 1 : 0 };
  }

  /**
   * Stage 10 — execute the LOCAL (deterministic, zero-token) steps and gather evidence.
   * Steps that need the network/Gemini are returned in `deferred` for the caller (home.js).
   * @returns {{evidence:Array, deferred:Array, needsGemini:boolean}}
   */
  function execute(planObj, resolved) {
    planObj = planObj || { steps: [], needsGemini: false };
    var evidence = [], deferred = [];
    var MK = root.MaiKKB, CALC = root.MEDCALC, DRUGS = root.MEDDRUGS, INTX = root.INTERACTIONS;
    (planObj.steps || []).forEach(function (s) {
      try {
        if (s.source === "kb" && MK && MK.compose) {
          var pkg = (resolved && resolved.context && resolved.context.pkg) || null;
          var out = pkg ? MK.compose(resolved.query.raw, pkg, { intent: (s.args && s.args.intent) || null }) : null;
          if (out && out.text) evidence.push({ source: "kb", data: out, weight: 100 }); else deferred.push(s);
        } else if (s.source === "calculator" && CALC) {
          var got = (s.args.calcs || []).map(function (c) { var def = CALC.get ? CALC.get(c.id) : null; return def ? { id: c.id, title: def.title, why: c.why, inputs: (def.inputs || []).map(function (x) { return { id: x.id, label: x.label, type: x.type }; }), computed: (s.op === "run" && s.args.inputs ? CALC.run(c.id, s.args.inputs) : null) } : null; }).filter(Boolean);
          if (got.length) evidence.push({ source: "calculator", data: got, weight: 90 });
        } else if (s.source === "drugdb" && DRUGS) {
          var hit = null; if (s.args.name && DRUGS.findByName) hit = DRUGS.findByName(s.args.name);
          if (hit) evidence.push({ source: "drugdb", data: hit, weight: 95 }); else deferred.push(s); // full DB is server-side
        } else if (s.source === "interactions" && INTX && INTX.checkInteractions) {
          deferred.push(s); // needs the active drug list from context
        } else {
          deferred.push(s); // guideline / router / research / gemini → caller resolves
        }
      } catch (e) { deferred.push(s); }
    });
    return { evidence: evidence, deferred: deferred, needsGemini: !!planObj.needsGemini || deferred.some(function (s) { return ["kb", "guideline"].indexOf(s.source) >= 0; }) };
  }

  /**
   * Stage 10/11 — validate gathered evidence. Deterministic safety checks; returns flags,
   * never silently drops. (Full dose/interaction validation deepens in Part 2.)
   * @returns {{ok:boolean, flags:Array}}
   */
  function validate(exec, resolved) {
    var flags = [];
    var ev = (exec && exec.evidence) || [];
    var hasSubstantive = ev.some(function (e) { return ["kb", "drugdb", "guideline"].indexOf(e.source) >= 0; });
    if (!hasSubstantive && !(exec && exec.needsGemini)) flags.push({ level: "warn", msg: "no substantive evidence and no synthesis planned" });
    // dose safety: a dose must come from a source, never be invented (KB already enforces; re-assert)
    ev.forEach(function (e) { if (e.source === "kb" && e.data && /\bdose\b/i.test(resolved && resolved.query.raw || "") && !e.data.text) flags.push({ level: "warn", msg: "dose intent but KB returned no dose text" }); });
    return { ok: flags.every(function (f) { return f.level !== "error"; }), flags: flags };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Stages 11-12 — COMPOSER (structured, intent-adaptive) + ADAPTIVE FOLLOW-UP
  // ════════════════════════════════════════════════════════════════════════

  // Full section templates per entity kind (spec Stage 4). A specific intent focuses the
  // template to the sections that matter (so "dose" doesn't dump the whole drug monograph).
  var TEMPLATES = {
    disease: ["overview", "etiology", "pathophysiology", "features", "diagnosis", "differential", "investigation", "treatment", "complications", "prognosis", "followup"],
    drug: ["mechanism", "indications", "dose", "renal", "hepatic", "pregnancy", "contraindications", "interactions", "monitoring", "adverse"],
    investigation: ["purpose", "indications", "normal", "interpretation", "limitations", "significance", "next"],
    guideline: ["recommendation", "evidence", "differences", "updates", "application"],
    emergency: ["stabilization", "abc", "redflags", "doses", "monitoring", "disposition"],
    procedure: ["indications", "contraindications", "equipment", "steps", "complications", "aftercare"]
  };
  // intent → the focused section subset (empty = full template)
  var INTENT_FOCUS = {
    dose: ["dose", "renal", "hepatic", "interactions", "monitoring"],
    treatment: ["treatment", "complications", "monitoring", "followup"],
    emergency: null,   // uses the emergency template wholesale
    investigation: ["investigation", "interpretation", "next"],
    differential: ["differential", "investigation"],
    features: ["overview", "features"],
    definition: ["overview"],
    pathophysiology: ["pathophysiology"],
    prognosis: ["prognosis", "followup"],
    redflags: ["redflags", "features"],
    contraindication: ["contraindications", "interactions"],
    monitoring: ["monitoring"]
  };
  function templateFor(resolved) {
    var t = (resolved.primary && resolved.primary.type === "drug") ? "drug" : "disease";
    if (resolved.intent === "emergency") t = "emergency";
    var base = TEMPLATES[t] || TEMPLATES.disease;
    var focus = INTENT_FOCUS[resolved.intent];
    if (focus) base = focus.filter(function (k) { return base.indexOf(k) >= 0; }).concat(focus.filter(function (k) { return base.indexOf(k) < 0; }));
    return { kind: t, sections: base };
  }

  // Deterministic adaptive follow-ups (Stage 12) — predicted next actions, NO Gemini call:
  // relevant clinical scores (CALC_FOR) + intent-adaptive next steps + KB refine chips.
  var NEXT_BY_INTENT = {
    treatment: ["Dose", "Renal adjustment", "Monitoring", "Contraindications", "Differentials"],
    diagnosis: ["Investigations", "Differentials", "Red flags"],
    differential: ["Investigations", "Treatment"],
    investigation: ["Interpretation", "Next steps", "Treatment"],
    dose: ["Renal adjustment", "Interactions", "Monitoring"],
    emergency: ["Drug doses", "Red flags", "Disposition", "Monitoring"],
    features: ["Investigations", "Treatment"],
    definition: ["Clinical features", "Treatment"]
  };
  function composeFollowups(resolved, execution) {
    var out = [], seen = {};
    var add = function (label, kind) { var k = norm(label); if (label && !seen[k]) { seen[k] = 1; out.push({ label: label, kind: kind || "followup" }); } };
    // 1) relevant scores
    suggestCalcs(resolved.query.norm, resolved.primary).forEach(function (c) { add((root.MEDCALC && root.MEDCALC.get && root.MEDCALC.get(c.id) ? root.MEDCALC.get(c.id).title : c.id), "calculator"); });
    // 2) intent-adaptive next steps
    (NEXT_BY_INTENT[resolved.intent] || ["Treatment", "Investigations", "Differentials"]).forEach(function (l) { add(l, "intent"); });
    // 3) KB's own refine chips (parsed from @@REFINE:…@@ if the KB composed)
    (execution && execution.evidence || []).forEach(function (e) {
      if (e.source === "kb" && e.data && e.data.text) { var m = String(e.data.text).match(/@@REFINE:([^@]+)@@/); if (m) m[1].split("|").forEach(function (c) { add(c.trim(), "refine"); }); }
    });
    return out.slice(0, 8);
  }

  /**
   * Stage 11 — compose the single structured Answer. Deterministic sections are filled from
   * gathered evidence; sections needing prose synthesis are marked {needsSynthesis:true} for
   * the caller to fill via Gemini (this keeps compose zero-token). Doses/citations flow as
   * structured slots so validation and the renderer can use them.
   * @returns {Answer}
   */
  function compose(resolved, execution) {
    execution = execution || { evidence: [], deferred: [], needsGemini: false };
    var tpl = templateFor(resolved);
    var ev = execution.evidence || [];
    var kb = ev.filter(function (e) { return e.source === "kb"; })[0];
    var calc = ev.filter(function (e) { return e.source === "calculator"; })[0];
    var drug = ev.filter(function (e) { return e.source === "drugdb"; })[0];

    var sections = [];
    if (kb && kb.data && kb.data.text) sections.push({ kind: "kb", title: null, md: String(kb.data.text).replace(/@@REFINE:[^@]+@@/g, "").trim() });
    else sections.push({ kind: tpl.kind, title: null, md: null, needsSynthesis: true, template: tpl.sections });
    if (calc && calc.data && calc.data.length) sections.push({ kind: "calculator", title: "Relevant scores", calcs: calc.data });
    if (drug && drug.data) sections.push({ kind: "drug", title: "Drug", data: drug.data });

    // structured slots
    var doses = [], citations = [];
    if (kb && kb.data) {
      if (kb.data.evidence) (Array.isArray(kb.data.evidence) ? kb.data.evidence : [kb.data.evidence]).forEach(function (c) { citations.push(c); });
      if (kb.data.disease) citations.push({ source: "StewardMD KB", ref: kb.data.disease });
    }
    var conf = kb && kb.data ? (kb.data.confidence || 0.85) : (execution.needsGemini ? 0.7 : 0.6);

    return {
      intent: resolved.intent || "overview",
      entities: resolved.entities || [],
      template: tpl,
      sections: sections,
      doses: doses,
      citations: citations,
      safetyFlags: [],
      refinements: [],
      followups: composeFollowups(resolved, execution),
      mode: kb ? "kb" : (execution.needsGemini ? "synthesis" : "deferred"),
      needsSynthesis: sections.some(function (s) { return s.needsSynthesis; }),
      confidence: conf
    };
  }

  function run(raw, context) {
    var resolved = resolve(raw, context);
    if (resolved.decision !== "answer") return { resolved: resolved, plan: null, answer: null, defer: true };
    var p = plan(resolved), ex = execute(p, resolved), v = validate(ex, resolved), ans = compose(resolved, ex);
    ans.safetyFlags = (v.flags || []).slice();
    return { resolved: resolved, plan: p, execution: ex, validation: v, answer: ans, defer: ans.needsSynthesis };
  }

  var api = { version: VERSION, run: run, resolve: resolve, plan: plan, execute: execute, validate: validate, compose: compose, composeFollowups: composeFollowups, suggestCalcs: suggestCalcs, detectLang: detectLang, _norm: norm, _AMBIG: AMBIG };
  try { root.MaiKBrain = api; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
