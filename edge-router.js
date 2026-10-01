/* edge-router.js — StewardMD Edge, Wave 1: typed, read-only request router (window.SMD_EDGE).
 * ---------------------------------------------------------------------------
 * Flag smd_edge ("1" on, default OFF). Five read-only workflows (Edge-Master-Plan section 1):
 *   calculator (open, optionally prefilled) · tool/module · KB topic · drug · ICD search.
 *
 * How a request is handled:
 *   1. CANDIDATES (deterministic): existing matchers propose at most 5 options: MEDCALC.find and
 *      SMD_SEARCH.rank over calculators and tools (on the words left after attributed values are
 *      removed), MaiKKB.resolveTarget, SMD_DRUGLINK.drugsIn, and an ICD search when the text asks for
 *      a code. The right answer must be in this list; recall@5 is measured separately.
 *   2. LAYER 0: one exact calculator name and nothing else -> answered by rules, no model call.
 *   3. MODEL: the engine sees the request plus the numbered options and calls ONE fixed tool,
 *      choose_option(option 0..5). The schema never changes, so the engine never rebinds tools.
 *      0 means "none of these".
 *   4. VALIDATION: the option must exist; the model never supplies a number. Calculator values come
 *      from the shared parser (SMD_CPARAMS) and calc-prefill, with evidence records.
 *   5. Every non-answer (no candidates, skipped, timeout, stale, 0, invalid) returns null, and the
 *      caller continues on its normal path (rule S4: never a dead end).
 * The engine is pluggable: Needle (capacitor-needle), a grammar-capable llama pack, or a test mock.
 * window.SMD_EDGE + module.exports. ES5. No network calls.
 */
(function (root) {
  "use strict";
  var G = root || {};
  var MAX_OPTIONS = 5;
  var TOOL_SCHEMA = [{
    name: "choose_option",
    description: "Pick the numbered StewardMD option that does what the clinician asked. Use 0 when none of the options fits.",
    parameters: { type: "object", properties: { option: { type: "integer", minimum: 0, maximum: MAX_OPTIONS, description: "number of the chosen option, 0 if none fits" } }, required: ["option"] }
  }];
  var SYSTEM = "user: clinician; assistant: StewardMD app router";

  function flagOn() { try { return !!(G.localStorage && G.localStorage.getItem("smd_edge") === "1"); } catch (e) { return false; } }
  function lower(s) { return String(s == null ? "" : s).toLowerCase(); }

  // ---- 1. candidates -----------------------------------------------------------------------
  var STOP = { open: 1, show: 1, me: 1, the: 1, a: 1, an: 1, go: 1, to: 1, take: 1, please: 1, pls: 1, can: 1, you: 1, i: 1, want: 1,
    need: 1, for: 1, of: 1, on: 1, in: 1, with: 1, and: 1, is: 1, what: 1, whats: 1, calculate: 1, calc: 1, check: 1, find: 1, get: 1, my: 1, this: 1, patient: 1 };
  function content(s) { return lower(s).replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 3 && !STOP[w]; }); }
  var ICD_CUE = /\b(icd(?:\s*-?\s*1[01])?|icd10|icd11|diagnosis code|code for)\b/i;
  function candidates(text) {
    var out = [], seen = {}, q = String(text || "");
    var P = G.SMD_CPARAMS, M = G.MEDCALC, S = G.SMD_SEARCH;
    var bare = P && P.stripValues ? P.stripValues(q) : q;
    function add(c) { var k = c.kind + ":" + c.id; if (seen[k] || out.length >= MAX_OPTIONS) return; seen[k] = 1; out.push(c); }

    if (ICD_CUE.test(q)) {
      var term = bare.replace(ICD_CUE, " ").replace(/\b(what(?:'s| is)?|the|of|for|please|give|me)\b/gi, " ").replace(/\s+/g, " ").trim();
      if (term) add({ kind: "icd", id: term, title: "ICD-10 codes for " + term, exact: true });
    }
    var hit = null;
    try { hit = M && M.find ? M.find(bare) : null; } catch (e) {}
    if (hit) add({ kind: "calculator", id: hit.id, title: hit.title, exact: !!hit.exact });
    if (S && S.rank && S.providers) {
      var provs = S.providers(), calcItems = [], toolItems = [];
      provs.forEach(function (p) {
        try {
          if (p.cat === "calcs" && p.items) calcItems = p.items();
          if (p.cat === "tools" && p.items) toolItems = p.items();
        } catch (e) {}
      });
      // Search ranking needs EVERY term to hit, so a whole request ("show me the resistance patterns
      // antibiogram") finds nothing. Rank the content words; fall back to each word on its own.
      var words = content(bare);
      var rankAny = function (items, lim) {
        var got = []; try { got = S.rank(words.join(" "), items, { limit: lim }); } catch (e) { got = []; }
        if (!got.length) words.forEach(function (w) { try { got = got.concat(S.rank(w, items, { limit: lim })); } catch (e) {} });
        return got.slice(0, lim);
      };
      rankAny(calcItems, 3).forEach(function (it) { add({ kind: "calculator", id: it.id, title: it.title }); });
      rankAny(toolItems, 2).forEach(function (it) { add({ kind: "tool", id: it.id, title: it.title }); });
    }
    try {
      var KB = G.MaiKKB, R = G.SMD_REASON;
      var t = KB && KB.resolveTarget ? KB.resolveTarget(lower(bare), { question: lower(bare), grounding: [], topicMatch: { matched: false } }) : null;
      if (t && t.id && (!R || !R.hasDiseaseRef || R.hasDiseaseRef(t.id))) add({ kind: "kb", id: t.id, title: t.name || t.id });
    } catch (e) {}
    try {
      var DL = G.SMD_DRUGLINK;
      if (DL && DL.drugsIn) DL.drugsIn(q, { fuzzy: true }).slice(0, 2).forEach(function (d) { add({ kind: "drug", id: d.generic, title: d.name || d.generic, drug: d }); });
    } catch (e) {}
    return out;
  }

  // ---- 3. prompt for the fixed tool --------------------------------------------------------
  var KIND_LABEL = { calculator: "calculator", tool: "open", kb: "reference", drug: "drug", icd: "ICD codes" };
  function promptFor(text, cands) {
    var lines = cands.map(function (c, i) { return (i + 1) + ". " + KIND_LABEL[c.kind] + ": " + c.title; });
    return String(text || "").slice(0, 300) + "\nOptions:\n" + lines.join("\n") + "\n0. none of these";
  }

  // Engine replies come in two shapes: Needle's { function_calls:[{name, arguments}], confidence }
  // and a grammar-constrained JSON { option } from a llama pack. Anything else is invalid.
  function optionFrom(res) {
    if (!res) return { ok: false, reason: "empty" };
    var calls = res.function_calls || [];
    if (calls.length) {
      var c = calls[0];
      if (c.name !== "choose_option" || !c.arguments) return { ok: false, reason: "wrong tool" };
      return { ok: true, option: c.arguments.option, confidence: res.confidence == null ? null : res.confidence };
    }
    if (typeof res.option === "number") return { ok: true, option: res.option, confidence: res.confidence == null ? null : res.confidence };
    if (res.type === "call" || res.suppressed_calls) return { ok: true, option: 0, confidence: res.confidence == null ? null : res.confidence };
    return { ok: false, reason: "unparseable" };
  }

  // ---- state ---------------------------------------------------------------------------------
  var engine = null, runtime = null, minConfidence = 0.5;
  var stats = { requests: 0, rules: 0, model: 0, chosen: 0, none: 0, passed: 0 };

  function makeRuntime() {
    var RT = G.SMD_EDGE_RUNTIME || (typeof require !== "undefined" ? tryReq("./edge-runtime.js") : null);
    if (!RT || !engine) return null;
    return RT.create({ engine: engine, deadlineMs: 1200, coldMs: 8000, env: G.SMD_EDGE_ENV || {} });
  }
  function tryReq(p) { try { return require(p); } catch (e) { return null; } }

  function setEngine(eng, opts) {
    if (runtime && runtime.release) runtime.release();
    engine = eng || null; runtime = makeRuntime();
    if (opts && typeof opts.minConfidence === "number") minConfidence = opts.minConfidence;
  }
  function available() { return !!(flagOn() && engine && engine.available && engine.available()); }

  function resultFor(c, text, source, conf, ms) {
    var r = { kind: c.kind, id: c.id, title: c.title, source: source, confidence: conf, ms: ms || 0 };
    if (c.kind === "calculator") {
      var F = G.SMD_CALC_PREFILL;
      try { r.prefill = F && F.forText ? F.forText(c.id, text) : null; } catch (e) { r.prefill = null; }
    }
    if (c.drug) r.drug = c.drug;
    return r;
  }

  /* route(text, { patient_session_id }) -> Promise<result | null>. Never rejects. */
  function route(text, ctx) {
    stats.requests++;
    if (!flagOn()) return Promise.resolve(null);
    var cands;
    try { cands = candidates(text); } catch (e) { cands = []; }
    if (!cands.length) { stats.passed++; return Promise.resolve(null); }
    // Layer 0: an exact calculator name and no competing option -> rules answer, no model.
    // An exact calculator title from MEDCALC.find, or an explicit ICD request, needs no model.
    if (cands[0].kind === "calculator" && cands[0].exact) { stats.rules++; return Promise.resolve(resultFor(cands[0], text, "rules", null)); }
    if (cands[0].kind === "icd") { stats.rules++; return Promise.resolve(resultFor(cands[0], text, "rules", null)); }
    if (!available() || !runtime) { stats.passed++; return Promise.resolve(null); }
    if (ctx && ctx.patient_session_id != null) runtime.setSession(ctx.patient_session_id);
    stats.model++;
    return runtime.run({ prompt: promptFor(text, cands), tools: TOOL_SCHEMA, system: SYSTEM, maxTokens: 48 }).then(function (r) {
      if (!r || r.status !== "ok") { stats.passed++; return null; }
      var o = optionFrom(r.result);
      if (!o.ok || typeof o.option !== "number" || o.option !== Math.floor(o.option)) { stats.passed++; return null; }
      if (o.option === 0) { stats.none++; return null; }
      if (o.option < 1 || o.option > cands.length) { stats.passed++; return null; }
      if (o.confidence != null && o.confidence < minConfidence) { stats.passed++; return null; }
      stats.chosen++;
      return resultFor(cands[o.option - 1], text, "edge", o.confidence, r.ms);
    }, function () { stats.passed++; return null; });
  }

  // ---- engine adapters -----------------------------------------------------------------------
  /* Needle through the native capacitor-needle plugin (local-plugins/capacitor-needle). The tool
   * list is fixed, so init happens once per load. Expected plugin API (see the plugin's README):
   *   load() · init({ system, tools }) · complete({ text, maxTokens }) -> { json } · reset() · kill()? · release() */
  function needleAdapter(plugin) {
    var inited = false;
    return {
      name: "needle",
      available: function () { return !!plugin; },
      load: function () { inited = false; return Promise.resolve(plugin.load({})).then(function () { return plugin.init({ system: SYSTEM, tools: JSON.stringify(TOOL_SCHEMA) }); }).then(function () { inited = true; }); },
      complete: function (task) {
        return Promise.resolve(inited ? null : plugin.init({ system: SYSTEM, tools: JSON.stringify(TOOL_SCHEMA) })).then(function () {
          inited = true; return plugin.complete({ text: task.prompt, maxTokens: task.maxTokens || 48 });
        }).then(function (r) { return r && typeof r.json === "string" ? JSON.parse(r.json) : r; });
      },
      reset: function () { return plugin.reset ? plugin.reset() : null; },
      kill: plugin.kill ? function () { inited = false; return plugin.kill(); } : undefined,
      release: function () { inited = false; return plugin.release ? plugin.release() : null; }
    };
  }
  function autoEngine() {
    try {
      var C = G.Capacitor, p = C && C.Plugins && C.Plugins.Needle;
      if (p && C.isNativePlatform && C.isNativePlatform()) return needleAdapter(p);
    } catch (e) {}
    return null;
  }

  var API = {
    route: route, candidates: candidates, enabled: flagOn, available: available, setEngine: setEngine,
    needleAdapter: needleAdapter, autoEngine: autoEngine, promptFor: promptFor, optionFrom: optionFrom,
    TOOL_SCHEMA: TOOL_SCHEMA, stats: function () { return JSON.parse(JSON.stringify(stats)); },
    session: function (id) { if (runtime) runtime.setSession(id); }, _version: "1.0"
  };
  if (root) {
    root.SMD_EDGE = API;
    try { if (flagOn()) { var a = autoEngine(); if (a) setEngine(a); } } catch (e) {}
  }
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
