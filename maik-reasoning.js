/* maik-reasoning.js — MaiK Ask reasoning provider abstraction (Phase A).
 * ===========================================================================
 * window.SMD_MAIK_REASON — the ONLY seam the MaiK Ask engine/UI use to reach an LLM, so the clinical
 * pathway engine and UI never depend on Gemini directly (a future QwenLocalProvider drops in behind the
 * same interface). Spec: docs/superpowers/specs/2026-08-14-maik-ask-design.md.
 *
 *   generateNextQuestion(ctx)            -> Promise<{action,question,language,targetField,priority,reason}>
 *   extractPatientAnswer(ctx, transcript)-> Promise<{findings:[{field,value,confidence}]}>
 *   detectLanguage(transcript)           -> {primary,secondary,style,confidence}   (local, sync)
 *   setProvider(p)                        -> swap the transport (real LLM in Phase D, mock in tests)
 *
 * SAFETY (why the validators live here, not in the caller): the app must NEVER execute raw LLM text as
 * a clinical action. Every provider response is validated against the pathway BEFORE the caller sees it;
 * an invalid response is retried once, then falls back to the predefined pathway-template question. The
 * only allowed actions are ask | clarify | finish | alert_doctor. Findings must be explicitly-stated,
 * typed, and belong to the pathway — never inferred.
 *
 * Phase A ships the interface + validators + local language detect + a DEFAULT (unwired) provider that
 * always falls back to the pathway template, so the whole seam is exercisable with zero LLM/network and
 * zero change to MaiK Scribe. Phase D injects a transport that calls the server (SMD_AI, new kinds).
 * Node-testable via module.exports.
 * ======================================================================== */
(function (root) {
  "use strict";

  var ALLOWED_ACTIONS = { ask: 1, clarify: 1, finish: 1, alert_doctor: 1 };
  var ALLOWED_PRIORITY = { high: 1, normal: 1, low: 1 };

  // "headache.location" -> "location"; a field is valid only if the pathway declares it.
  function leaf(field) { return String(field == null ? "" : field).split(".").pop(); }
  function pathwayHasField(pathway, field) {
    if (!pathway) return true;   // no pathway supplied -> can't constrain (validators still enforce shape)
    var f = leaf(field);
    return !!((pathway.fields && pathway.fields[f]) ||
              (pathway.associated && pathway.associated[f]) ||
              (pathway.redFlags && pathway.redFlags[f]));
  }

  // Returns a validated question object, or null if the response is unusable (caller retries/falls back).
  function validateNextQuestion(o, pathway) {
    if (!o || typeof o !== "object") return null;
    if (!ALLOWED_ACTIONS[o.action]) return null;                       // unknown action -> reject
    var out = { action: o.action, question: "", language: "", targetField: "", priority: "normal", reason: "" };
    if (o.action === "ask" || o.action === "clarify") {
      if (typeof o.question !== "string" || !o.question.trim()) return null;   // must carry a question
      if (o.targetField != null && String(o.targetField) !== "" && !pathwayHasField(pathway, o.targetField)) return null;   // field must be in the pathway
      out.question = o.question.trim().slice(0, 400);
      out.targetField = String(o.targetField || "");
    }
    out.language = String(o.language || "");
    out.priority = ALLOWED_PRIORITY[o.priority] ? o.priority : "normal";
    out.reason = String(o.reason == null ? "" : o.reason).slice(0, 200);
    return out;
  }

  // Returns {findings:[...]} keeping ONLY explicitly-stated, typed, in-pathway findings. Never throws.
  function validateExtract(o, pathway) {
    var out = { findings: [] };
    if (!o || typeof o !== "object" || !Array.isArray(o.findings)) return out;
    o.findings.forEach(function (f) {
      if (!f || typeof f.field !== "string" || !f.field) return;
      if (!pathwayHasField(pathway, f.field)) return;                  // only pathway fields
      if (f.value == null || String(f.value).trim() === "") return;    // explicit only, never inferred blanks
      var c = Number(f.confidence); if (!(c >= 0 && c <= 1)) c = 0.5;
      out.findings.push({ field: leaf(f.field), value: String(f.value).replace(/\s+/g, " ").trim().slice(0, 200), confidence: c });
    });
    return out;
  }

  // Local-first language detection. Native script (Telugu/Devanagari) is definitive; for LATIN text we
  // also catch ROMANIZED Telugu/Hindi cues ("lo/undi", "hai/nahi") since patients routinely code-switch
  // in Latin script. No LLM — the LLM detectLanguage refines only when this is unsure (Phase D).
  var TE_ROMAN = ["lo", "undi", "unnai", "unnayi", "unnadi", "ledu", "kuda", "nundi", "avunu", "enti", "ela", "cheppandi", "vastundi", "vachindi", "tagutara", "vunna", "ayindi"];
  var HI_ROMAN = ["hai", "hain", "nahi", "kya", "mein", "raha", "rahi", "bukhar", "dard", "kaise", "kab", "mujhe", " hai "];
  var EN_WORD = /\b(the|a|an|is|are|have|has|and|or|no|yes|not|pain|side|left|right|both|headache|fever|cough|cold|body|day|days|week|weeks|since|feeling|vomiting|nausea|chest|stomach|back|breath|breathing|dizzy|weakness|swelling)\b/;
  function hasCue(low, cues) { for (var i = 0; i < cues.length; i++) { if (new RegExp("\\b" + cues[i].trim() + "\\b").test(low)) return true; } return false; }
  function detectLanguage(transcript) {
    var t = String(transcript == null ? "" : transcript), low = " " + t.toLowerCase() + " ";
    var teScript = /[ఀ-౿]/.test(t), hiScript = /[ऀ-ॿ]/.test(t), latin = /[a-z]/i.test(t);
    var te = teScript || hasCue(low, TE_ROMAN), hi = hiScript || hasCue(low, HI_ROMAN);
    var primary = te ? "telugu" : hi ? "hindi" : latin ? "english" : "unknown";
    var mixed = !!((te || hi) && EN_WORD.test(low) && latin);   // a non-English language AND real English words = code-switch
    var conf = (primary === "unknown") ? 0.3 : (mixed ? 0.9 : (teScript || hiScript) ? 0.85 : 0.75);
    return { primary: primary, secondary: mixed ? "english" : null, style: mixed ? "mixed" : "single", confidence: conf };
  }

  // The predefined pathway-template question — the safety fallback when the LLM is unusable/unwired.
  function fallbackQuestion(ctx) {
    ctx = ctx || {};
    var p = ctx.pathway, tf = leaf(ctx.targetField), tmpl = "";
    try {
      var d = p && ((p.fields && p.fields[tf]) || (p.associated && p.associated[tf]) || (p.redFlags && p.redFlags[tf]));
      tmpl = (d && d.ask) ? String(d.ask) : "";
    } catch (e) {}
    if (!tf) return { action: "finish", question: "", language: ctx.language || "", targetField: "", priority: "normal", reason: "no target field" };
    // NEVER emit a blank question: synthesize a plain phrase from the field name when the pathway has
    // no `ask` template (e.g. associated symptoms). A real provider replaces this wording; this is the
    // safety net when the LLM is unusable so the patient never faces an empty "…" prompt.
    var q = tmpl ? ("Please tell me: " + tmpl + ".") : ("Do you also have " + tf.replace(/_/g, " ") + "?");
    return {
      action: "ask",
      question: q,
      language: ctx.language || "",
      targetField: ctx.targetField || tf,
      priority: "normal",
      reason: "fallback: predefined pathway template"
    };
  }

  // ---- provider interface -------------------------------------------------
  // A provider exposes next(ctx, opts) and extract(ctx, transcript, opts), each returning a raw object
  // (or a Promise of one) that the SMD_MAIK_REASON wrapper then VALIDATES. The default provider is
  // unwired (returns null) so the seam falls back to the pathway template until Phase D injects a real
  // transport (which will call the server via SMD_AI with the new maik-ask-next / maik-ask-extract kinds).
  function GeminiVertexProvider(transport) {
    this.name = "gemini-vertex";
    this._transport = (typeof transport === "function") ? transport : function () { return null; };
  }
  GeminiVertexProvider.prototype.next = function (ctx, opts) { return this._transport("next", ctx, opts || {}); };
  GeminiVertexProvider.prototype.extract = function (ctx, transcript, opts) { return this._transport("extract", { ctx: ctx, transcript: transcript }, opts || {}); };

  // Default transport → the server (SMD_AI.maik). Resolved LAZILY so load order doesn't matter, and so
  // that in Node/tests (no SMD_AI) it returns null → the seam falls back to the pathway template. A
  // server response carrying {error} also returns null → fallback (never a broken/blank question).
  function serverTransport(op, payload) {
    var AI = root && root.SMD_AI;
    if (!AI || typeof AI.maik !== "function") return null;
    var p = (op === "next") ? AI.maik("maik-ask-next", payload, "")
          : (op === "extract") ? AI.maik("maik-ask-extract", payload.ctx, payload.transcript)
          : null;
    if (!p) return null;
    return p.then(function (r) { return (r && r.error) ? null : r; });
  }

  var _provider = new GeminiVertexProvider(serverTransport);

  // Call a provider method inside a promise so a SYNCHRONOUS throw becomes a catchable rejection.
  function call(fn) { return Promise.resolve().then(fn); }

  var API = {
    _version: "phaseA",
    setProvider: function (p) { if (p && typeof p.next === "function" && typeof p.extract === "function") _provider = p; },
    getProvider: function () { return _provider; },
    detectLanguage: detectLanguage,

    // Validate -> retry once (constrained) -> fall back to the predefined pathway question. Never rejects.
    generateNextQuestion: function (ctx) {
      ctx = ctx || {};
      return call(function () { return _provider.next(ctx); }).then(function (raw) {
        var v = validateNextQuestion(raw, ctx.pathway);
        if (v) return v;
        return call(function () { return _provider.next(ctx, { constrained: true }); }).then(function (raw2) {
          return validateNextQuestion(raw2, ctx.pathway) || fallbackQuestion(ctx);
        });
      }).catch(function () { return fallbackQuestion(ctx); });
    },

    // Validate -> retry once -> empty findings (the engine's deterministic layer already ran first).
    extractPatientAnswer: function (ctx, transcript) {
      ctx = ctx || {};
      var pathway = ctx.pathway;
      return call(function () { return _provider.extract(ctx, transcript); }).then(function (raw) {
        var v = validateExtract(raw, pathway);
        if (v.findings.length) return v;
        return call(function () { return _provider.extract(ctx, transcript, { constrained: true }); })
          .then(function (raw2) { return validateExtract(raw2, pathway); });
      }).catch(function () { return { findings: [] }; });
    },

    // exposed for tests + downstream phases
    _validateNextQuestion: validateNextQuestion,
    _validateExtract: validateExtract,
    _fallbackQuestion: fallbackQuestion,
    _pathwayHasField: pathwayHasField,
    GeminiVertexProvider: GeminiVertexProvider
  };

  if (root) root.SMD_MAIK_REASON = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
