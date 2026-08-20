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

  /* UNGROUNDED BY DESIGN.
   *
   * The on-device engine answers from MedGemma's OWN weights and touches no StewardMD data. That is
   * the product decision, and it is what makes it fast: grounding was 94% of time-to-first-word on a
   * Pixel 9 (1799 prompt tokens -> 130 s of prefill at a flat ~14 tok/s). A question-only prompt is
   * ~100 tokens, so first token lands in seconds rather than a minute.
   *
   * It also removes a failure mode rather than adding one. When retrieval missed - "pyogenic liver
   * abscess" resolves to LIVER_ABSCESS by FALLBACK while AMOEBIC_LIVER_ABSCESS is an exact match -
   * the model was handed amoebic chunks labelled "primary source" and dutifully answered
   * metronidazole for a pyogenic abscess. Grounding is only a safety net when retrieval is right;
   * when it is wrong it is an amplifier pointed the wrong way.
   *
   * The division of labour is now explicit:
   *   KB only    - StewardMD knowledge base, grounded, cited
   *   MaiK Cloud - Gemini, grounded with the same KB package
   *   On-device  - the model's own knowledge, fast, offline, CAN BE WRONG (accepted tradeoff)
   *
   * Conversation history IS kept: it is the clinician's own turns, not a StewardMD resource, and
   * without it a bare follow-up ("and the dose?") is meaningless. Two turns, tightly clipped.
   */
  var DEFAULT_PACK = "maik-local-v1";
  var HISTORY_TURNS = 2;
  var HISTORY_CLIP = 180;

  // Every token here is prefill on the critical path, so this is deliberately terse. No mention of
  // retrieved knowledge - there is none.
  /* PHRASED POSITIVELY ON PURPOSE.
   *
   * The previous version said "for weight-based drugs give the principle and range, NOT a made-up
   * figure" - and the model answered "20 mg/kg" for adult IV magnesium, where the standard is a flat
   * 2 g. A 4B follows what you tell it to DO far better than what you tell it not to do: negations
   * mostly just put the forbidden concept in context. So every rule here is an instruction, not a
   * prohibition.
   */
  var SYSTEM =
    "You are MaiK, clinical decision support for doctors. Answer in markdown: one-line bottom line, " +
    "then short bullets. No preamble.\n" +
    "For an adult drug dose, give the standard flat adult dose with route and frequency, like " +
    "\"2 g IV over 20 min\" or \"1 g IV every 24 h\". Use mg/kg only when the drug is genuinely dosed " +
    "by weight in adults.\n" +
    "Name the first-line regimen most guidelines agree on. Where you are unsure of a figure, give " +
    "the range and say it varies.\n" +
    "End with one line: \"Verify against local protocol.\"";

  function cap() { try { return (typeof window !== "undefined" && window.Capacitor) || null; } catch (e) { return null; } }
  function llama() { var c = cap(); return (c && c.Plugins && c.Plugins.Llama) || null; }
  function models() { try { return window.SMD_MAIK_MODELS || null; } catch (e) { return null; } }

  function clip(s, n) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
  }

  /**
   * Question (plus a little conversation) only. The grounded package is deliberately IGNORED apart
   * from its question and history - see the note above.
   */
  function buildPrompt(pkg) {
    if (!pkg) return "";
    var question = pkg.question || (pkg.topicMatch && pkg.topicMatch.topic) || "";
    var L = [];
    var hist = pkg.history || [];
    if (hist.length) {
      L.push("Recent conversation:");
      hist.slice(-HISTORY_TURNS * 2).forEach(function (h) {
        L.push((h.role === "assistant" ? "MaiK: " : "Doctor: ") + clip(h.text || h.content, HISTORY_CLIP));
      });
      L.push("");
    }
    L.push(question || "Give a brief clinical overview.");
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

      /* STRIP the citation-bearing fields off the package before the answer renders.
       *
       * Returning sources:[] is not enough: home.js renders citations with
       * SMD_MaiK.sourceList(pkg), which recomputes them from pkg.grounding / pkg.retrieved /
       * pkg.treatment and ignores the result. So an ungrounded answer displayed "3 sources" from a
       * KB it never read. In a clinical UI that is worse than a weak drug choice - it lends
       * borrowed authority to the model's own guess. This engine read none of it, so none of it may
       * be shown.
       */
      try {
        if (pkg) { pkg.grounding = []; pkg.retrieved = []; pkg.sources = []; delete pkg.treatment; }
      } catch (e) {}

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
          // ALWAYS empty: this answer used no StewardMD material, so attaching the package's
          // citations would credit sources the model never saw. That is a lie in a clinical UI.
          sources: [],
          grounded: false,
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
    SYSTEM: SYSTEM, DEFAULT_PACK: DEFAULT_PACK,
    HISTORY_TURNS: HISTORY_TURNS, buildPrompt: buildPrompt, answer: answer, available: available, currentPack: currentPack,
    warm: warm, cancel: cancel, release: release
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_MAIK_LOCAL = API;
})();
