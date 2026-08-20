/* StewardMD — MaiK on-device answer engine (window.SMD_MAIK_LOCAL).
 * ===========================================================================
 * Runs the offline half of the answer-engine picker (maik-engine.js): when the clinician has
 * chosen "On-device" and the KB (Tier 0) had no answer, generate one HERE with llama.cpp via the
 * capacitor-llama plugin. No network, no AI tokens.
 *
 * Contract, so maik-engine.js can swap us in for SMD_AI.explainGrounded* transparently:
 *     answer(pkg, opts, onDelta) -> Promise<{ text, sources, engine:"local", ms }>
 * onDelta receives the ACCUMULATED text (not the delta) because that is what home.js's existing
 * replay()/typewriter render already expects — verified against reasoning.js replay(), which calls
 * onDelta(full.slice(0, i)). Getting this backwards would render "aababc..." on screen.
 *
 * CONTEXT BUDGET is the whole design constraint. The server prompt-builder can spend a huge context
 * on grounding; we have n_ctx 4096 total, shared between prompt and answer, because the KV cache is
 * what gets an 8 GB iPhone killed. So the package is clipped HARD (see PROMPT_CHAR_BUDGET) and the
 * most decision-relevant evidence goes first — grounding chunks are already page-cited and ranked,
 * retrieved chunks are already cross-encoder re-ranked by the caller.
 * ======================================================================== */
(function () {
  "use strict";

  /* PROMPT SIZE IS THE LATENCY. Measured on a Pixel 9: an 8000-char package tokenised to 1799
   * tokens and prefill alone took 130.5 s of a 138.5 s answer - 94% of the wait, before a single
   * word appears. Prefill is linear in prompt tokens, so this budget IS the first-token latency.
   *
   * 3000 chars keeps the top-ranked grounding (which is what stops the model inventing regimens)
   * while cutting prefill roughly 2.7x. CHUNK_CLIP drops too, so the budget buys more DISTINCT
   * sources rather than more words from the same one - breadth matters more than verbosity for
   * grounding, and it is cheaper per token.
   */
  var PROMPT_CHAR_BUDGET = 3000;
  var CHUNK_CLIP = 150;          // per-chunk characters
  var DEFAULT_PACK = "maik-local-v1";

  // Short cousin of the server's SYSTEM prompt (functions/api/ai/[[path]].js). Deliberately terse:
  // every token here is a token not available for evidence or answer at n_ctx 4096.
  // Every token here is prefill on the critical path, so this is deliberately terse. Trimmed from
  // ~175 tokens after measuring that prefill is 94% of time-to-first-word on a Pixel 9.
  var SYSTEM =
    "You are MaiK, clinical decision support for doctors. Answer the question directly in markdown: " +
    "one-line bottom line, then short bullets. No preamble.\n" +
    "Ground specifics in the RETRIEVED KNOWLEDGE where it applies; otherwise use established medicine.\n" +
    "Ignore retrieved text about a different condition. Never invent a guideline number or citation.\n" +
    "Give standard adult doses; for weight-based, paediatric or high-alert drugs give the principle " +
    "and range, not a made-up figure.";

  function cap() { try { return (typeof window !== "undefined" && window.Capacitor) || null; } catch (e) { return null; } }
  function llama() { var c = cap(); return (c && c.Plugins && c.Plugins.Llama) || null; }
  function models() { try { return window.SMD_MAIK_MODELS || null; } catch (e) { return null; } }

  function clip(s, n) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  /**
   * Serialise the grounded package into a compact prompt. Mirrors the server's ordering (grounding
   * first, then re-ranked retrieved, then treatment) with the same de-duplication, but on a budget.
   */
  function buildPrompt(pkg) {
    if (!pkg) return "";
    var L = [], used = 0, seen = {};
    function push(line) {
      if (used + line.length > PROMPT_CHAR_BUDGET) return false;
      L.push(line); used += line.length + 1; return true;
    }
    // De-dup the same chunk appearing in both grounding and retrieved (pure budget savings).
    function fresh(t) {
      var k = String(t == null ? "" : t).slice(0, 90).toLowerCase().replace(/\s+/g, " ").trim();
      if (!k || seen[k]) return false;
      seen[k] = 1; return true;
    }

    var question = pkg.question || (pkg.topicMatch && pkg.topicMatch.topic) || "";

    // Recent conversation, if the caller supplied it — a bare follow-up ("and the dose?") is
    // meaningless without it, and MaiK's follow-up continuity depends on this.
    if (pkg.history && pkg.history.length) {
      push("=== RECENT CONVERSATION ===");
      pkg.history.slice(-4).forEach(function (h) {
        push((h.role === "assistant" ? "MaiK: " : "Doctor: ") + clip(h.text || h.content, 260));
      });
      push("");
    }

    /* Grounding header depends on how CONFIDENT the KB match was.
     *
     * Measured on a Pixel 9: asking for "pyogenic liver abscess" resolves to LIVER_ABSCESS with
     * match:"fallback", confident:false, while "amoebic liver abscess" is an exact match. So the
     * retrieved chunks were about the WRONG disease, and this header called them "primary source".
     * A 4B model obeys that label - it answered "metronidazole ... for amoebic liver abscess" to a
     * pyogenic question. Labelling low-confidence retrieval honestly is the difference between
     * grounding and misleading.
     */
    var tm = pkg.topicMatch || {};
    var weak = tm.confident === false || tm.match === "fallback" || tm.matched === false;
    if (weak) {
      push("=== POSSIBLY RELATED REFERENCE (the knowledge base had no confident match for this " +
           "question - it may describe a DIFFERENT condition; ignore it unless it clearly applies, " +
           "and answer from established medicine instead) ===");
    } else {
      push("=== RETRIEVED STEWARDMD KNOWLEDGE (primary source) ===");
    }
    (pkg.grounding || []).forEach(function (g) {
      var lines = [];
      (g.knowledge || []).forEach(function (c) {
        if (!c || !c.text || !fresh(c.text)) return;
        lines.push("  [" + (c.section || "kb") + "] " + clip(c.text, CHUNK_CLIP) +
          (c.source && c.source.ref ? " (" + clip(c.source.ref, 60) + ")" : ""));
      });
      if (lines.length) {
        push("* " + (g.name || g.diseaseId || "topic") + ":");
        lines.forEach(push);
      }
    });
    (pkg.retrieved || []).forEach(function (c) {
      if (!c || !c.text || !fresh(c.text)) return;
      push("  [" + (c.section || "kb") + "] " + (c.diseaseId ? c.diseaseId + ": " : "") + clip(c.text, CHUNK_CLIP));
    });

    var t = pkg.treatment;
    if (t && t.default) {
      push("");
      push("=== TREATMENT RESOLUTION ===");
      push("Default [" + (t.default.tier || "?") + "]: " + clip(t.default.line, 220) +
        (t.default.source ? " (" + clip(t.default.source, 60) + ")" : ""));
      (t.default.steps || []).slice(0, 5).forEach(function (s) { push("  - " + clip(s, 160)); });
    }

    push("");
    push("=== QUESTION ===");
    push(question || "Summarise the retrieved knowledge above for a clinician.");
    return L.join("\n");
  }

  // ── model lifecycle ─────────────────────────────────────────────────────
  var _loadedPack = null;
  function ensureLoaded(packId) {
    var L = llama(), M = models();
    if (!L) return Promise.reject(new Error("on-device inference needs the native app"));
    if (!M) return Promise.reject(new Error("model manager unavailable"));
    if (_loadedPack === packId) {
      // The plugin drops the model on app pause, so confirm it is still resident before answering.
      return L.available().then(function (a) {
        if (a && a.loaded) return null;
        _loadedPack = null;
        return ensureLoaded(packId);
      });
    }
    var pk = M.PACKS[packId];
    if (!pk) return Promise.reject(new Error("unknown model pack"));
    return M.pathFor(packId).then(function (path) {
      return L.load({ path: path, nCtx: pk.nCtx || 4096 });
    }).then(function () { _loadedPack = packId; return null; });
  }

  /**
   * Generate an answer for a grounded package.
   * opts.pack selects a pack (defaults to the primary); opts.temperature defaults to greedy.
   */
  /** The pack the clinician picked in Settings, falling back to the primary. */
  function currentPack() {
    var M = models();
    try { if (M && M.activePack) return M.activePack(); } catch (e) {}
    return DEFAULT_PACK;
  }

  function answer(pkg, opts, onDelta) {
    var L = llama();
    if (!L) return Promise.resolve({ error: "on-device inference needs the native app" });
    var packId = (opts && opts.pack) || currentPack();
    var t0 = Date.now();
    var acc = "";
    var sub = null;

    return ensureLoaded(packId).then(function () {
      var prompt = buildPrompt(pkg);
      if (!prompt) return { error: "no-package" };

      // Stream tokens into the caller's typewriter. Accumulate: onDelta wants the full text so far.
      var attach = (typeof onDelta === "function" && L.addListener)
        ? Promise.resolve(L.addListener("llamaToken", function (ev) {
            acc += (ev && ev.text) || "";
            try { onDelta(acc); } catch (e) {}
          }))
        : Promise.resolve(null);

      return attach.then(function (handle) {
        sub = handle;
        var pk = (models() && models().PACKS[packId]) || {};
        return L.generate({
          prompt: prompt,
          system: SYSTEM,
          nPredict: pk.nPredict || 512,
          temperature: (opts && typeof opts.temperature === "number") ? opts.temperature : 0,
          stream: typeof onDelta === "function"
        });
      }).then(function (r) {
        var text = (r && r.text) || acc || "";
        return {
          text: text,
          sources: (pkg && pkg.sources) || [],
          engine: "local",
          model: (models() && models().PACKS[packId] && models().PACKS[packId].label) || packId,
          ms: (r && r.ms) || (Date.now() - t0)
        };
      });
    }).catch(function (e) {
      // Surface the plugin's stable error code when we have one; the UI maps it to copy.
      return { error: String((e && (e.code || e.message)) || e || "local-failed") };
    }).then(function (out) {
      if (sub && sub.remove) { try { sub.remove(); } catch (e) {} }
      return out;
    });
  }

  /**
   * Is on-device inference actually possible here? The MODULE always loads (it ships in the web
   * bundle too), so maik-engine.js must not treat "SMD_MAIK_LOCAL exists" as "the runtime exists" —
   * on the web PWA there is no capacitor-llama plugin at all.
   */
  function available() { return !!llama(); }

  /**
   * Load the model AND fault its pages in, ahead of any question.
   *
   * The weights are mmap'd from flash, so the first prefill after a load has to fault ~2.5 GB in:
   * measured 130 s of page-fault-bound prefill on a Pixel 9 (94% of a 138 s answer). That cost is
   * unavoidable, but it does NOT have to sit between pressing send and the first word. Called when
   * the on-device model is SELECTED, and at startup if it is already the choice, so the expensive
   * part happens while the clinician is still typing.
   *
   * Fire-and-forget: never rejects, and never blocks a real answer.
   */
  var _warmed = null;
  function warm(packId) {
    var L = llama();
    if (!L) return Promise.resolve(false);
    packId = packId || currentPack();
    if (_warmed === packId) return Promise.resolve(true);
    return ensureLoaded(packId)
      .then(function () {
        // One token is enough to walk the whole graph and fault the weights in.
        return L.generate({ prompt: "ok", system: "", nPredict: 1, temperature: 0, stream: false });
      })
      .then(function () { _warmed = packId; return true; })
      .catch(function () { return false; });
  }

  function cancel() { var L = llama(); if (L && L.cancel) { try { return L.cancel(); } catch (e) {} } }

  function release() {
    var L = llama();
    _loadedPack = null;
    _warmed = null;
    _warmed = null;
    if (L && L.release) { try { return L.release(); } catch (e) {} }
  }

  var API = {
    SYSTEM: SYSTEM, PROMPT_CHAR_BUDGET: PROMPT_CHAR_BUDGET, DEFAULT_PACK: DEFAULT_PACK,
    buildPrompt: buildPrompt, answer: answer, available: available, currentPack: currentPack,
    warm: warm, cancel: cancel, release: release
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_MAIK_LOCAL = API;
})();
