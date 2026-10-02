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
    need: 1, for: 1, of: 1, on: 1, in: 1, with: 1, and: 1, is: 1, what: 1, whats: 1, calculate: 1, calc: 1, check: 1, find: 1, get: 1, my: 1,
    this: 1, pull: 1, up: 1, work: 1, out: 1, see: 1, look: 1, bring: 1, launch: 1, run: 1, use: 1, screen: 1, page: 1, app: 1, where: 1,
    would: 1, like: 1, let: 1, lets: 1, do: 1, it: 1, there: 1, here: 1, now: 1, be: 1, at: 1, from: 1, by: 1, or: 1 };
  function content(s) { return lower(s).replace(/[^a-z0-9.\s-]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 2 && !STOP[w]; }); }
  // Navigation words in any of the three languages: never a search term on their own.
  var NAV = { search: 1, where: 1, khol: 1, kholo: 1, dikhao: 1, teruvu: 1, chupinchu: 1, cheyyi: 1, screen: 1, page: 1, lookup: 1, codes: 1, code: 1 };
  var GENERIC = { calculator: 1, calc: 1, score: 1, scores: 1, index: 1, criteria: 1, tool: 1 };
  function norm(s) { return lower(s).replace(/[^a-z0-9]+/g, " ").trim(); }
  // "don't open the ICU", "stop metformin": never act on a negated or stop request.
  var NEGATION = /\b(don'?t|do not|dont|never|no need to|not now|stop|cancel|hold|discontinue)\b/i;
  var ICD_CUE = /\b(icd(?:\s*-?\s*1[01])?|icd10|icd11|diagnosis code|code for)\b/i;
  function candidates(text) {
    var out = [], seen = {}, q = String(text || "");
    var P = G.SMD_CPARAMS, M = G.MEDCALC, S = G.SMD_SEARCH;
    var bare = P && P.stripValues ? P.stripValues(q) : q;
    function add(c) { var k = c.kind + ":" + c.id; if (seen[k] || out.length >= MAX_OPTIONS) return; seen[k] = 1; out.push(c); }

    // Words that are kept ("s/f", "r-ipi", "phq-2" keep their single letters and digits).
    var pw = norm(bare).split(" ").filter(function (w) { return w && !STOP[w]; });
    if (ICD_CUE.test(q)) {
      var term = bare.replace(ICD_CUE, " ").replace(/\b(what(?:'s| is)?|the|of|for|please|give|me)\b/gi, " ").replace(/\s+/g, " ").trim();
      // "search icd", "take me to icd search": the request is for the screen, not a code lookup.
      // Stop words only decide whether a term is left; they are never removed from it ("open
      // fracture of tibia" is not "fracture tibia": an open fracture has its own codes).
      term = term.split(/\s+/).filter(function (w) { return w && !NAV[lower(w)]; }).join(" ");
      if (!content(term).length) term = "";
      if (term) add({ kind: "icd", id: term, title: "ICD-10 codes for " + term, exact: true });
    }
    var hit = null, ranked = null, exactTool = null, calcItems = [], toolItems = [];
    try { hit = M && M.find ? (M.find(bare) || (pw.length ? M.find(pw.join(" ")) : null)) : null; } catch (e) {}
    // An exact title goes first; a near title competes in the ranked list below an own name.
    if (hit && hit.exact) add({ kind: "calculator", id: hit.id, title: hit.title, exact: true });
    if (S && S.rank && S.providers) {
      var provs = S.providers();
      provs.forEach(function (p) {
        try {
          if (p.cat === "calcs" && p.items) calcItems = p.items();
          if (p.cat === "tools" && p.items) toolItems = p.items();
        } catch (e) {}
      });
      // Search ranking needs EVERY term to hit, so a whole request ("show me the resistance patterns
      // antibiogram") finds nothing. Rank the content words; fall back to each word on its own.
      var words = content(bare);
      // Score every item by the content words it matches, each word ranked on its own and weighted by
      // rarity (a word that matches 20 items says little), plus a bonus when the whole phrase matches.
      // Calculators and tools compete on one scale, so the strongest options fill the five slots.
      var scored = function (items, kind) {
        var score = {}, byId = {};
        words.forEach(function (w) {
          var hits = []; try { hits = S.rank(w, items, { limit: 25 }); } catch (e) { hits = []; }
          if (!hits.length || hits.length > 20) return;
          var wgt = 1 / hits.length;
          hits.forEach(function (it, r) { byId[it.id] = it; score[it.id] = (score[it.id] || 0) + wgt + (25 - r) / 10000; });
        });
        if (words.length) { try { S.rank(words.join(" "), items, { limit: 5 }).forEach(function (it) { byId[it.id] = it; score[it.id] = (score[it.id] || 0) + 0.5; }); } catch (e) {} }
        return Object.keys(score).map(function (k) { return { kind: kind, it: byId[k], s: score[k] }; });
      };
      var ranked = scored(calcItems, "calculator").concat(scored(toolItems, "tool"));
      // A request that IS one of a calculator's own names ("s/f ratio", "egfr") outranks word overlap.
      // Single letters are kept here ("s/f" is "s f"), so it is compared over every calculator.
      var phrases = [pw.join(" "), pw.filter(function (w) { return !GENERIC[w]; }).join(" ")].filter(Boolean);
      if (phrases.length && M && M.get) calcItems.forEach(function (it) {
        var c = M.get(it.id), names = [it.id.replace(/_/g, " "), String(it.title || "").replace(/\s*\(.*$/, "")].concat((c && c.kw) || []);
        if (!names.some(function (k) { return phrases.indexOf(norm(k)) > -1; })) return;
        var x = null; ranked.forEach(function (r) { if (r.kind === "calculator" && r.it.id === it.id) x = r; });
        if (!x) { x = { kind: "calculator", it: it, s: 0 }; ranked.push(x); }
        x.s += 2;
      });
      if (hit && !hit.exact) {
        var hx = null; ranked.forEach(function (r) { if (r.kind === "calculator" && r.it.id === hit.id) hx = r; });
        if (!hx) { hx = { kind: "calculator", it: { id: hit.id, title: hit.title }, s: 0 }; ranked.push(hx); }
        hx.s += 1;
      }
      ranked.sort(function (x, y) { return y.s - x.s; });
    }
    // A drug the request names, and a reference topic, get their slots before the ranked list,
    // which would otherwise fill all five with weak word overlaps.
    // The request minus navigation words ("antibiogram kholo", "icu open cheyyi", "show me the icu"):
    // when what is left IS one tool's title or one drug's name, that option is exact (rules, no model).
    var named = pw.filter(function (w) { return !NAV[w] && !GENERIC[w]; }).join(" ");
    // Title and request are reduced the SAME way, so "dose calculator teruvu" matches "Dose calculator"
    // and "search icd teruvu" matches "Search ICD" (navigation and generic words dropped from both).
    function keys(str) {
      var w = norm(str).split(" ").filter(function (x) { return x && !STOP[x] && !NAV[x]; });
      return [w.join(" "), w.filter(function (x) { return !GENERIC[x]; }).join(" ")];
    }
    var reqKeys = keys(bare);
    if (reqKeys[0] && ranked) {
      var toolHits = toolItems.filter(function (it) {
        var tk = keys(it.title);
        return (tk[0] && tk[0] === reqKeys[0]) || (tk[1] && tk[1] === reqKeys[1]);
      });
      if (toolHits.length === 1) {
        ranked.forEach(function (r) { if (r.kind === "tool" && r.it.id === toolHits[0].id) r.s += 3; });
        if (!ranked.some(function (r) { return r.kind === "tool" && r.it.id === toolHits[0].id; })) ranked.push({ kind: "tool", it: toolHits[0], s: 3 });
        exactTool = toolHits[0].id;
      }
    }
    try {
      var DL = G.SMD_DRUGLINK;
      if (DL && DL.drugsIn) DL.drugsIn(q, { fuzzy: true }).slice(0, 2).forEach(function (d) {
        // Only the generic name is exact. A brand goes to the model or the doctor: drug-lexicon.js maps
        // some combination brands to one ingredient (Entresto -> valsartan, Combiflam -> ibuprofen),
        // so a brand must not open a drug card by rule until that lexicon is reviewed.
        var ex = !d.fuzzy && !!named && norm(d.generic) === named && norm(d.typed) === named;
        add({ kind: "drug", id: d.generic, title: d.name || d.generic, drug: d, exact: ex });
      });
    } catch (e) {}
    try {
      var KB = G.MaiKKB, R = G.SMD_REASON;
      var t = KB && KB.resolveTarget ? KB.resolveTarget(lower(bare), { question: lower(bare), grounding: [], topicMatch: { matched: false } }) : null;
      // Fails closed: no reference module to confirm the page, no KB option.
      if (t && t.id && R && R.hasDiseaseRef && R.hasDiseaseRef(t.id)) add({ kind: "kb", id: t.id, title: t.name || t.id });
    } catch (e) {}
    (ranked || []).forEach(function (x) { add({ kind: x.kind, id: x.it.id, title: x.it.title, exact: x.kind === "tool" && x.it.id === exactTool }); });
    // One name, two things ("insulin" is a drug AND a tool): nothing is exact, the model or doctor picks.
    var exacts = out.filter(function (c) { return c.exact && c.kind !== "icd"; });
    if (exacts.length > 1) out.forEach(function (c) { if (c.kind !== "icd") c.exact = false; });
    // Otherwise the one exactly named option goes first, unless an ICD request holds that place.
    for (var k = 1; k < out.length; k++) if (out[k].exact) {
      if (out[0].kind !== "icd") { var x0 = out.splice(k, 1)[0]; out.unshift(x0); } else out[k].exact = false;
      break;
    }
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

  /* Back-off (Edge-Master-Plan A0.5): skip Edge, so the rules answer, when memory is low
   * (lowMemory, or under 250 MB available), the phone is at thermal SEVERE or above (Android
   * THERMAL_STATUS_SEVERE = 3; the Needle plugin maps iOS .serious to 3), or MaiK is generating or
   * Whisper is decoding. The device numbers arrive asynchronously from Needle.available(), so the last
   * reading is kept and refreshed on every routed request; until one arrives, everything reads "ok".
   * SMD_EDGE_ENV, when set (tests, harnesses), replaces this whole object. */
  var device = { lowMemory: false, availMB: null, thermal: 0 };
  function refreshDevice() {
    var p = null;
    try { p = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Needle; } catch (e) {}
    if (!p || !p.available) return Promise.resolve(device);
    return Promise.resolve().then(function () { return p.available(); }).then(function (a) {
      if (a) {
        if (typeof a.lowMemory === "boolean") device.lowMemory = a.lowMemory;
        if (typeof a.availMB === "number") device.availMB = a.availMB;
        if (typeof a.thermal === "number") device.thermal = a.thermal;
      }
      return device;
    }, function () { return device; });
  }
  var DEFAULT_ENV = {
    memoryOk: function () { return !device.lowMemory && !(device.availMB != null && device.availMB < 250); },
    thermalOk: function () { return device.thermal < 3; },
    othersBusy: function () {
      var L = G.SMD_MAIK_LOCAL, N = G.SMD_NATIVE;
      var q = L && L.queueState ? L.queueState() : null;
      return !!((q && q.running) || (N && N.whisperBusy && N.whisperBusy()));
    }
  };
  function makeRuntime() {
    var RT = G.SMD_EDGE_RUNTIME || (typeof require !== "undefined" ? tryReq("./edge-runtime.js") : null);
    if (!RT || !engine) return null;
    return RT.create({ engine: engine, deadlineMs: 1200, coldMs: 8000, env: G.SMD_EDGE_ENV || DEFAULT_ENV });
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
  function layer0(cands) { var c = cands && cands[0]; return !!(c && (c.kind === "icd" || c.exact)); }
  function route(text, ctx) {
    stats.requests++;
    if (!flagOn()) return Promise.resolve(null);
    if (NEGATION.test(String(text || ""))) { stats.passed++; return Promise.resolve(null); }
    var cands;
    try { cands = candidates(text); } catch (e) { cands = []; }
    if (!cands.length) { stats.passed++; return Promise.resolve(null); }
    // Layer 0: the first option is exact (a calculator's or tool's own name, a named drug, an explicit
    // ICD request) -> rules answer, no model.
    if (layer0(cands)) { stats.rules++; return Promise.resolve(resultFor(cands[0], text, "rules", null)); }
    if (!available() || !runtime) { stats.passed++; return Promise.resolve(null); }
    if (ctx && ctx.patient_session_id != null) runtime.setSession(ctx.patient_session_id);
    refreshDevice();          // for the NEXT request: this one reads the last known state
    stats.model++;
    return runtime.run({ prompt: promptFor(text, cands), tools: TOOL_SCHEMA, system: SYSTEM, maxTokens: 48, nOptions: cands.length }).then(function (r) {
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
   *   load({ path? }) · configure({ system, tools }) · complete({ text, maxTokens }) -> { json } · reset() · kill()? · release()
   * ("configure", not "init": a Swift plugin cannot expose a method named init.) */
  // opts.weightsPath: a tuned .cact on the device (else the plugin's bundled weights).
  // opts.calibrated === false (a local LoRA build: its confidence head was not trained) drops the
  // confidence, as Needle's own Python binding does, so the floor is not judged on noise.
  function needleAdapter(plugin, opts) {
    var inited = false, o = opts || {};
    var loadArgs = o.weightsPath ? { path: o.weightsPath } : {};
    // Capacitor's plugin proxy answers ANY method name, so "plugin.kill exists" proves nothing. Only
    // Android runs Needle in its own process (":edge"), which is what makes a stuck call killable.
    var killable = o.killable != null ? !!o.killable : (function () {
      try { var C = G.Capacitor; return !!(C && C.getPlatform && C.getPlatform() === "android"); } catch (e) { return false; }
    })();
    return {
      name: "needle",
      available: function () { return !!plugin; },
      load: function () { inited = false; return Promise.resolve(plugin.load(loadArgs)).then(function () { return plugin.configure({ system: SYSTEM, tools: JSON.stringify(TOOL_SCHEMA) }); }).then(function () { inited = true; }); },
      complete: function (task) {
        return Promise.resolve(inited ? null : plugin.configure({ system: SYSTEM, tools: JSON.stringify(TOOL_SCHEMA) })).then(function () {
          inited = true; return plugin.complete({ text: task.prompt, maxTokens: task.maxTokens || 48 });
        }).then(function (r) {
          var out = r && typeof r.json === "string" ? JSON.parse(r.json) : r;
          if (out && o.calibrated === false) out.confidence = null;
          return out;
        });
      },
      reset: function () { return plugin.reset ? plugin.reset() : null; },
      kill: killable ? function () { inited = false; return plugin.kill(); } : undefined,
      release: function () { inited = false; return plugin.release ? plugin.release() : null; }
    };
  }
  /* A grammar-capable llama.cpp pack (capacitor-llama with the `grammar` option, gate A0.3), e.g. a
   * fine-tuned FunctionGemma GGUF. BAKE-OFF ONLY: the llama plugin holds ONE model per process, so
   * load() evicts MaiK's pack while maik-local still believes it is loaded. autoEngine() never picks
   * this; the bake-off harness builds it, and release() runs when the run ends. Relaunch the app after.
   * The grammar admits exactly {"option":n} for n in 0..number of options offered. */
  function grammarFor(n) {
    var k = Math.max(0, Math.min(MAX_OPTIONS, n | 0));
    return 'root ::= "{\\"option\\":" [0-' + k + '] "}"';
  }
  function llamaAdapter(plugin, opts) {
    var o = opts || {}, loaded = false;
    return {
      name: "llama",
      available: function () { return !!(plugin && o.modelPath); },
      load: function () {
        loaded = false;
        // Prompt threads = the plugin's own decode threads (4 on an 8-core phone). Its default prefills on
        // EVERY core, the efficiency cores too: 3.6-4.1 s per call on a Pixel 9 vs 1.1-1.4 s with 4
        // (Edge-Runbook A0.3 Android, 2026-10-02). iOS ignores the key (Metal).
        return Promise.resolve(plugin.load({ path: o.modelPath, nCtx: o.nCtx || 1024, nThreadsBatch: o.nThreadsBatch || 4 })).then(function () { loaded = true; });
      },
      complete: function (task) {
        return Promise.resolve(loaded ? null : this.load()).then(function () {
          return plugin.generate({ system: task.system || SYSTEM, prompt: task.prompt, nPredict: 8, temperature: 0, stream: false,
            grammar: grammarFor(task.nOptions == null ? MAX_OPTIONS : task.nOptions) });
        }).then(function (r) { var t = r && r.text; return typeof t === "string" ? JSON.parse(t) : r; });
      },
      reset: function () { return null; },
      kill: plugin.cancel ? function () { return plugin.cancel(); } : undefined,
      release: function () { loaded = false; return plugin.release ? plugin.release() : null; }
    };
  }

  /* Device bake-off (Edge-Master-Plan 7, Day 5): run the exported test prompts through an engine
   * under the SAME runtime contract as production (deadline, cold load), one at a time, and return
   * the {id, option, confidence, ms, status} lines scripts/edge/score.mjs --pred reads. A timeout or
   * error is recorded as no option, which the scorer counts as a pass to the safe path. */
  function bakeoff(rows, eng, opts) {
    var o = opts || {}, RT = G.SMD_EDGE_RUNTIME || (typeof require !== "undefined" ? tryReq("./edge-runtime.js") : null);
    if (!RT || !eng) return Promise.reject(new Error("no runtime or engine"));
    var rt = RT.create({ engine: eng, deadlineMs: o.deadlineMs || 1200, coldMs: o.coldMs || 8000, env: o.env || {} });
    var out = [], i = 0, list = rows || [];
    function next() {
      if (i >= list.length) return Promise.resolve(rt.release()).then(function () { return out; }, function () { return out; });
      var row = list[i++], t0 = Date.now();
      return rt.run({ prompt: row.prompt, tools: row.tools || TOOL_SCHEMA, system: row.system || SYSTEM, maxTokens: 48, nOptions: row.n_options }).then(function (r) {
        var line = { id: row.id, option: null, confidence: null, ms: Date.now() - t0, status: r && r.status };
        if (r && r.status === "ok") {
          var op = optionFrom(r.result);
          if (op.ok) { line.option = op.option; line.confidence = op.confidence; } else line.status = "invalid:" + op.reason;
        }
        out.push(line);
        if (o.onProgress) { try { o.onProgress(i, list.length, line); } catch (e) {} }
        // A timed-out call may still hold a non-killable engine; wait it out so one slow row does not
        // turn the rows after it into "busy" (production would simply pass those to the safe path).
        return settle(Date.now()).then(next);
      });
    }
    function settle(t0) {
      var st = rt.status();
      if (!(st.stuck || st.running) || Date.now() - t0 > (o.coldMs || 8000)) return Promise.resolve();
      return new Promise(function (r) { setTimeout(r, 25); }).then(function () { return settle(t0); });
    }
    return next();
  }

  function autoEngine() {
    try {
      var C = G.Capacitor, p = C && C.Plugins && C.Plugins.Needle;
      if (p && C.isNativePlatform && C.isNativePlatform()) return needleAdapter(p);
    } catch (e) {}
    return null;
  }

  var API = {
    route: route, candidates: candidates, layer0: layer0, negated: function (t) { return NEGATION.test(String(t || "")); }, enabled: flagOn, available: available, setEngine: setEngine,
    needleAdapter: needleAdapter, llamaAdapter: llamaAdapter, grammarFor: grammarFor, bakeoff: bakeoff, autoEngine: autoEngine, promptFor: promptFor, SYSTEM: SYSTEM, optionFrom: optionFrom,
    TOOL_SCHEMA: TOOL_SCHEMA, stats: function () { return JSON.parse(JSON.stringify(stats)); },
    session: function (id) { if (runtime) runtime.setSession(id); }, refreshDevice: refreshDevice,
    backoff: function () { return { memoryOk: DEFAULT_ENV.memoryOk(), thermalOk: DEFAULT_ENV.thermalOk(), othersBusy: DEFAULT_ENV.othersBusy(), device: JSON.parse(JSON.stringify(device)) }; },
    _version: "1.0"
  };
  if (root) {
    root.SMD_EDGE = API;
    try { if (flagOn()) { var a = autoEngine(); if (a) setEngine(a); } } catch (e) {}
  }
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
