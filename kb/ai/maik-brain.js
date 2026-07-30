/* MaiK Clinical Decision Engine — the "brain" orchestrator (Part 1).
 *
 * window.MaiKBrain runs the 12-stage deterministic, KB-first, safety-first reasoning
 * pipeline described in docs/superpowers/specs/2026-07-30-maik-clinical-decision-engine-design.md.
 *
 * PHASE 0 (this file): the CONTRACTS + a thin deterministic `resolve()` that composes the
 * modules that already exist (MaiKScope + MaiKKB) into a single structured `Resolved`
 * object, plus a `run()` skeleton that DEFERS execution to the legacy flow. It is NOT wired
 * into the app yet (no index.html script tag, flag smd_maik_brain default OFF) — it exists to
 * lock the interfaces and give the benchmark (test/run-maik-brain-bench.mjs) a baseline to
 * measure. Phases 1-3 strengthen each stage (unified intent, ontology/NER, ambiguity policy,
 * planner, execution wiring, validation, structured composer) behind the same interfaces.
 *
 * Deterministic-local-first: every stage here runs locally with zero tokens. The server LLM
 * router (/refine) and Gemini (/explain) are invoked ONLY by the planner/executor in later
 * phases, and only when local confidence is insufficient.
 *
 * ── Contracts ──────────────────────────────────────────────────────────────
 * @typedef {Object} Query      {raw:string, norm:string, lang:string}
 * @typedef {Object} Entity     {surface:string, canonicalId:string, canonicalName:string,
 *                               type:'disease'|'drug'|'investigation'|'score'|'procedure'|
 *                               'organism'|'lab'|'unit'|'abbrev', parentId?:string,
 *                               subtypes?:string[], confidence:number, match?:string}
 * @typedef {Object} Ambiguity  {kind:'none'|'lexical'|'clinical', options:Array,
 *                               decision:'answer'|'overview'|'ask'|'refuse'}
 * @typedef {Object} Resolved   {query:Query, scope:{medical:boolean,category:string},
 *                               intent:string|null, entities:Entity[], primary:Entity|null,
 *                               context:Object, ambiguity:Ambiguity, decision:string}
 * @typedef {Object} PlanStep   {source:'kb'|'drugdb'|'treatment'|'guideline'|'calculator'|
 *                               'protocol'|'context'|'router'|'research'|'gemini',
 *                               op:string, args:Object, why:string}
 * @typedef {Object} Plan       {steps:PlanStep[], needsGemini:boolean, estCost:number}
 * @typedef {Object} Answer     {intent:string, entities:Entity[],
 *                               sections:Array<{kind:string,title:string,md:string}>,
 *                               doses:Array, citations:Array, safetyFlags:Array,
 *                               refinements:Array, followups:Array, mode:string,
 *                               confidence:number}
 */
(function (root) {
  "use strict";
  var VERSION = "0.1.0-phase0";

  function G(name) { try { return root[name]; } catch (e) { return null; } }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim(); }

  // Stage 1 — language detection (light; the app + KB are English-first).
  // Detects the dominant non-Latin script so later phases can translate/route; English default.
  var SCRIPTS = [
    ["hi", /[ऀ-ॿ]/], ["bn", /[ঀ-৿]/], ["te", /[ఀ-౿]/],
    ["ta", /[஀-௿]/], ["kn", /[ಀ-೿]/], ["ml", /[ഀ-ൿ]/],
    ["gu", /[઀-૿]/], ["pa", /[਀-੿]/], ["ar", /[؀-ۿ]/]
  ];
  function detectLang(raw) {
    var s = String(raw || "");
    for (var i = 0; i < SCRIPTS.length; i++) { if (SCRIPTS[i][1].test(s)) return SCRIPTS[i][0]; }
    return "en";
  }

  // Stage 2 — medical vs non-medical (reuse the allow-list Intent Firewall).
  function scopeOf(raw) {
    var S = G("MaiKScope");
    if (S && typeof S.classify === "function") { try { return S.classify(raw); } catch (e) {} }
    return { medical: true, category: "medical" };  // fail-open (never wrongly refuse a real clinician)
  }

  // Stage 3 — intent (Phase 0: reuse MaiKKB.classifyIntent; Phase 1 unifies the 3 impls).
  function intentOf(raw) {
    var KB = G("MaiKKB");
    if (KB && typeof KB.classifyIntent === "function") { try { return KB.classifyIntent(raw); } catch (e) {} }
    return null;
  }

  // Stages 5/6 — entity recognition + ontology mapping of the PRIMARY concept.
  // Phase 0: reuse MaiKKB.resolveTarget (lexical + fuzzy). Phase 1 replaces with the
  // deterministic ontology entity-linker (maik-ontology) + full NER.
  function primaryEntity(raw, pkg) {
    var KB = G("MaiKKB");
    if (!(KB && typeof KB.resolveTarget === "function")) return null;
    var t; try { t = KB.resolveTarget(raw, pkg || null); } catch (e) { return null; }
    if (!t || !t.id) return null;
    return {
      surface: raw, canonicalId: t.id, canonicalName: t.name || String(t.id).replace(/_/g, " "),
      type: "disease", confidence: t.confident ? 0.9 : 0.5, match: t.match || null
    };
  }

  // Stages 7/8 — ambiguity + dialogue decision.
  // Phase 0: reuse MaiKKB.clinicalDialogue (broad-concept → overview/ask). Phase 1 adds the
  // general confidence-gated policy + lexical (2-letter acronym) ambiguity.
  function ambiguityOf(raw) {
    var KB = G("MaiKKB");
    if (KB && typeof KB.clinicalDialogue === "function") {
      try {
        var cd = KB.clinicalDialogue(raw);
        if (cd && cd.mode === "ask") return { kind: "clinical", options: cd.subtypes || [], decision: "ask" };
        if (cd && cd.mode === "overview") return { kind: "clinical", options: cd.subtypes || [], decision: "overview" };
      } catch (e) {}
    }
    return { kind: "none", options: [], decision: "answer" };
  }

  /**
   * Resolve a raw query through the deterministic front half (stages 1-8).
   * @returns {Resolved}
   */
  function resolve(raw, context) {
    context = context || {};
    var query = { raw: String(raw == null ? "" : raw), norm: norm(raw), lang: detectLang(raw) };
    var scope = scopeOf(query.raw);
    if (!scope || scope.medical === false) {
      return { query: query, scope: scope || { medical: false, category: "non_medical" }, intent: null,
        entities: [], primary: null, context: context, ambiguity: { kind: "none", options: [], decision: "refuse" }, decision: "refuse" };
    }
    var intent = intentOf(query.raw);
    var primary = primaryEntity(query.raw, context.pkg);
    var ambiguity = ambiguityOf(query.raw);
    var decision = ambiguity.decision;
    return {
      query: query, scope: scope, intent: intent,
      entities: primary ? [primary] : [], primary: primary,
      context: context, ambiguity: ambiguity, decision: decision
    };
  }

  /**
   * Full pipeline entry. Phase 0: resolves the front half, then DEFERS execution/composition
   * to the legacy flow (defer:true) — so wiring this in (later) with the flag off is a no-op.
   * Phases 2-3 return a real {plan, answer}.
   * @returns {{resolved:Resolved, plan:Plan|null, answer:Answer|null, defer:boolean}}
   */
  function run(raw, context) {
    var resolved = resolve(raw, context);
    return { resolved: resolved, plan: null, answer: null, defer: true };
  }

  var api = { version: VERSION, run: run, resolve: resolve, detectLang: detectLang, _norm: norm };
  try { root.MaiKBrain = api; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
