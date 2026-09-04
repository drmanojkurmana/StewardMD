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
  var DEFAULT_PACK = "maik-lite";   // our own model: flagship, and the safest default (smallest, fastest)
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
  /* THE DOSE RULE IS CONDITIONAL ON PURPOSE.
   *
   * It used to read "For an adult drug dose, give the standard flat adult dose..." unconditionally,
   * and the model applied it to EVERY question. Asked for the SIDE EFFECTS of linagliptin it opened
   * "Linagliptin 100 mg orally once daily is the standard first-line treatment" - a dose nobody
   * asked for, wrong by 20x (5 mg), from a model that had itself said 5 mg two turns earlier. An
   * instruction a 4B applies out of context is worse than no instruction: it manufactures a
   * confident number to satisfy the format. So the rule now names the condition first.
   */
  var SYSTEM =
    "You are MaiK, clinical decision support for doctors. Answer in markdown.\n" +
    "Answer medical questions only. For anything else reply: \"I can only help with medical and " +
    "clinical questions.\"\n" +
    "Give the final answer only, never your reasoning.\n" +
    "Open with ONE plain sentence answering the question, then short bullets. Use no section labels " +
    "such as \"Bottom Line\", \"Answer\" or \"Summary\".\n" +
    "Answer exactly what was asked: for side effects, mechanism, monitoring or contraindications, " +
    "write about that alone.\n" +
    "When asked for a dose, give the standard flat adult dose with route and frequency, like " +
    "\"2 g IV over 20 min\". Use mg/kg only when adults are genuinely dosed by weight.\n" +
    "Name the first-line regimen most guidelines agree on. Where unsure of a figure, give the range " +
    "and say it varies.\n" +
    "End with one line: \"Verify against local protocol.\"";

  /* A PURE greeting: the whole message is hello-ish with no clinical substance. Deliberately TIGHT -
   * "hi rx of uti" must NOT match. test/maik-greeting-route.test.mjs guards exactly that: a greeting
   * carrying a real question routes clinical, and a narrow keyword allow-list once broke it. */
  var GREET_HEAD = /^(hi+|hey+|hello+|helo|yo|hiya|namaste|namaskar|salaam|salam|greetings|good|morning|evening)$/;
  var GREET_TAIL = /^(morning|afternoon|evening|day|there|maik|doctor|doc|sir|madam|mate|again)$/;
  function isGreeting(q) {
    var toks = String(q == null ? "" : q).toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
    if (!toks.length || toks.length > 3) return false;
    if (!GREET_HEAD.test(toks[0])) return false;
    for (var i = 1; i < toks.length; i++) if (!GREET_TAIL.test(toks[i])) return false;
    return true;
  }

  /* Greetings get their OWN system prompt rather than an extra rule bolted onto SYSTEM.
   *
   * "hi" came back as an answer about vancomycin on a real phone. SYSTEM gives the model no way to
   * NOT answer clinically - it must open with a sentence answering the question and end with the
   * verify line - so with no question to answer, it invents a topic.
   *
   * Adding a rule to SYSTEM was the obvious fix and the wrong one: SYSTEM is PREFILL on every single
   * answer, prefill is the whole latency story on-device, and the suite pins it under 900 chars for
   * that reason. A separate short prompt costs nothing on clinical answers and makes the greeting
   * itself faster. Still no canned app-side text: the model writes the reply, which is what was
   * asked for ("WHY IS HI NOT BEING DIRECTED DIRECTLY TO GEMMA TO RESPOND"). */
  var SYSTEM_GREET =
    "You are MaiK, clinical decision support for doctors. Reply to this greeting in one short, " +
    "friendly sentence and ask what they would like to know. Nothing clinical.";

  /* Reasoning leak guard.
   *
   * Observed on device: an answer that began "thought The user wants me to act as MaiK, a clinical
   * decision support system..." and then recited this very system prompt back at the doctor before
   * answering. The SYSTEM line above asks for the final answer only; this is the backstop for when a
   * 4B ignores it, because the leak exposes the prompt and reads as a malfunction.
   */
  var THINK_TAG = /<\s*(think|thinking|thought|reason|reasoning|scratchpad)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
  var THINK_OPEN = /<\s*(think|thinking|thought|reason|reasoning|scratchpad)\s*>[\s\S]*$/i;   // unterminated
  var GEMMA_CTRL = /<\s*(start_of_turn|end_of_turn|unused\d+|eos|bos|pad)\s*>/gi;
  var LEAD_THOUGHT = /^\s*(thought|thinking|reasoning|analysis|plan)\b\s*[:\-]?\s*/i;

  // Bracket citation markers like [1] or [2,3]. MaiK Lite was trained to cite numbered evidence
  // passages; on-device there is no evidence list for the numbers to point at, and the owner's rule
  // is that answers never show per-source references - so the markers are stripped, not rendered.
  var CITE_MARK = /\s*\[\d+(?:\s*,\s*\d+)*\]/g;
  // Shown when the model spent its whole token budget inside a reasoning block and produced no
  // answer (measured on MaiK Lite v2: rare but real). An explicit message beats an empty bubble.
  var EMPTY_ANSWER = "The on-device model did not produce an answer this time. Ask again, or switch to MaiK Cloud.";
  // The model reporting that the retrieved passages do not cover the question. That is a retrieval
  // verdict, not an answer; see the no-coverage fallback in answer().
  var NO_COVERAGE = /\b(not|isn't|is not|aren't|are not|no)\b[^.]{0,60}\b(addressed|covered|found|included|mentioned|discussed|available|present|information|evidence|guidelines?)\b[^.]{0,50}\b(reference|retrieved|provided|source|sources|material|evidence|knowledge base)\b|\b(reference|retrieved) (material|passages?|sources?) (does not|do not|doesn't|don't|did not)\b/i;

  function stripReasoning(t) {
    var out = String(t == null ? "" : t);
    out = out.replace(THINK_TAG, "").replace(GEMMA_CTRL, "").replace(CITE_MARK, "");
    // An unterminated <think> means the budget ran out mid-reasoning: there is no answer after it,
    // so keep whatever came BEFORE rather than shipping raw reasoning.
    out = out.replace(THINK_OPEN, "");
    // Bare "thought ..." preamble with no tags (what actually shipped on device). Drop only up to the
    // first paragraph break, so a genuine answer that merely starts with the word is not eaten.
    if (LEAD_THOUGHT.test(out)) {
      var brk = out.search(/\n\s*\n/);
      out = brk > -1 ? out.slice(brk) : out.replace(LEAD_THOUGHT, "");
    }
    return out.replace(/^\s+/, "").replace(/\s+$/, "");
  }

  /* IMAGE ANSWERS.
   *
   * MedGemma 1.5 and Gemma 4 can see, but only with their projector (mmproj) downloaded alongside the
   * weights. Apex is Qwen3-based and text-only, so it has no projector and must never be offered an
   * image button.
   *
   * MAX_IMAGES is 2, not unbounded: each image costs hundreds of prompt tokens through the vision
   * encoder, and prefill is the whole latency story on-device (measured flat ~14 tok/s). Three photos
   * would push a 4096 context to the edge and leave no room for an answer.
   */
  var MAX_IMAGES = 2;

  /* A SEPARATE system prompt for image questions.
   *
   * The text prompt tells the model to answer from its own knowledge; here it must describe what is
   * ACTUALLY VISIBLE and say so when the picture is unreadable. Without that a 4B narrates a
   * plausible label it cannot see, which on a drug box or a lab report is the most dangerous thing
   * this feature could do.
   */
  /* INTERPRET, DO NOT TRANSCRIBE.
   *
   * The first version of this prompt said "Describe only what is actually visible" and "read the
   * values as printed". Both are transcription instructions, and the model obeyed them exactly. Shown
   * a cortisol report it produced eighteen lines of "The lab ID is 60812702855. The ref id is not
   * visible. The uhid is not visible. The collection time is not visible." - a worse OCR than the OCR
   * engine, with no clinical content and the patient's name echoed back for no reason.
   *
   * ChatGPT, same photo: two salient values, then an Interpretation heading saying 6.2 ug/dL is
   * borderline-low for an 8 AM cortisol and NOT sufficient to diagnose or exclude adrenal
   * insufficiency. That is the difference between reading a report and reading a patient.
   *
   * So the instruction is now inverted: pull only the values that carry meaning, then commit to what
   * they mean. "Not visible" fields are dropped entirely - a doctor holding the document does not need
   * to be told which boxes are empty. Identifiers are skipped on purpose: they add nothing clinically
   * and keep PHI out of an answer that may be screenshotted or logged.
   *
   * The closing line still tells them to check the original, because a 4B reading a phone photo of a
   * printout can misread a digit, and a misread digit is the whole answer.
   *
   * WHY A WORKED EXAMPLE, AND WHY IT REPLACED THE DESCRIPTION RATHER THAN JOINING IT.
   *
   * A 4B copies a demonstrated format far more reliably than it follows a described one, and the
   * described version demonstrably did not work. But prefill is the whole latency story here - the
   * prompt was already 13 s of prefill before the image's own encode cost - so bolting an example on
   * top of the rules would have made a slow feature slower.
   *
   * So the example now CARRIES the format and the sentences that merely described it are gone: the
   * bullet with value and range, the Interpretation heading, committing with a threshold, saying what
   * it does not establish, the next step, and the closing verify line are all shown rather than
   * explained. Net length is roughly unchanged.
   *
   * The rules that SURVIVE are the ones an example cannot enforce: skip the noise, never write out
   * identifiers, name an unreadable number instead of guessing, and no reasoning. Those are safety and
   * privacy constraints, not formatting.
   *
   * CONTENT BLEED is the real hazard of few-shot on a small model - it will happily answer
   * "potassium 6.1" for a sodium report. Hence the explicit "never reuse its test, its numbers or its
   * conclusion", and a deliberately distinctive example (hyperkalaemia) so that if bleed does happen
   * it is obvious on sight rather than a plausible wrong number.
   */
  var SYSTEM_IMAGE =
    "You are MaiK, clinical decision support for doctors reading a clinical image. Answer in markdown.\n" +
    "Report only the findings that carry clinical meaning. Skip empty fields, headers and barcodes, and " +
    "do not list what is missing.\n" +
    "Never write out patient names, hospital IDs, UHIDs or accession numbers even when they are legible.\n" +
    "When a number is genuinely unreadable, say which one; do not guess it and do not abandon the rest.\n" +
    "Give the final answer only, never your reasoning.\n" +
    "Match the SHAPE of this example exactly. It is a format example only: never reuse its test, its " +
    "numbers or its conclusion.\n" +
    "---\n" +
    "- Serum potassium: 6.1 mmol/L (lab range 3.5 to 5.1)\n" +
    "\n" +
    "**Interpretation**\n" +
    "\n" +
    "6.1 mmol/L is clearly raised. Above 6.0 is where arrhythmia risk begins, so this needs treating " +
    "now rather than a repeat sample alone. It does not establish the cause: sample haemolysis, renal " +
    "impairment and potassium-sparing drugs all produce this.\n" +
    "\n" +
    "Next: an ECG, and a repeat sample drawn without a tourniquet to exclude a spurious result.\n" +
    "\n" +
    "Verify against the original document.\n" +
    "---";

  /* A follow-up about an image already on screen.
   *
   * Without this the model re-reads the picture from scratch and repeats the whole summary, so "is
   * this normal?" produced another transcription instead of an answer. Here the image is context and
   * the QUESTION leads.
   */
  var SYSTEM_IMAGE_FOLLOWUP =
    "You are MaiK, clinical decision support for doctors. The image is the one already being " +
    "discussed. Answer in markdown.\n" +
    "Answer the doctor's question about it DIRECTLY, in one or two sentences, then only the detail " +
    "that supports the answer. Do not re-list the report or repeat the earlier summary.\n" +
    "When the question asks whether something is normal, commit: say normal, borderline or abnormal, " +
    "give the threshold you are using, and say what it does and does not establish.\n" +
    "Never write out patient names or hospital identifiers.\n" +
    "Give the final answer only, never your reasoning.";

  /** Can this pack see at all, and is its projector on disk? */
  function visionReady(packId) {
    var M = models();
    if (!M || !M.hasVision || !M.hasVision(packId)) return false;
    try { return !!M.installedCached(M.visionIdOf(packId)); } catch (e) { return false; }
  }

  /** Absolute path of the projector for this pack, or "" when it is not downloaded. */
  function visionPathFor(packId) {
    var M = models();
    if (!M || !visionReady(packId)) return Promise.resolve("");
    return M.pathFor(M.visionIdOf(packId)).then(function (p) { return p || ""; }, function () { return ""; });
  }

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
  /* HISTORY IS OPT-IN, NOT ALWAYS-ON.
   *
   * It used to be prepended to every prompt. Observed on device: after "Treatment of Fever" was
   * answered, the next question "Polycystic Kidney Disease" came back as "the standard first-line
   * regimen for fever in adults with renal impairment... acetaminophen 650 mg". The 4B read the fever
   * answer sitting above the new question and fused the two topics. A doctor asked about one disease
   * and was given the treatment for another - the worst failure this engine can produce.
   *
   * A follow-up needs history ("Side effects?" is meaningless alone). A question that carries its own
   * subject does not. So history goes in ONLY for an aspect-only question, and the default is none:
   * losing continuity yields a generic answer, while bleeding topics yields a confidently wrong one.
   */
  var FILLER = /^(what|whats|what's|how|why|and|but|so|about|of|for|the|a|an|in|on|to|is|are|it|its|it's|this|that|them|those|these|same|any|other|more|also|then|ok|okay|please|tell|me|us|give|show)$/;
  var ASPECT = /^(dose|doses|dosage|dosing|side|effect|effects|adverse|reaction|reactions|contraindication|contraindications|interaction|interactions|mechanism|action|moa|duration|monitoring|monitor|complication|complications|prognosis|alternative|alternatives|children|child|paediatric|pediatric|kids|pregnancy|pregnant|lactation|breastfeeding|renal|hepatic|liver|kidney|elderly|adult|adults|neonate|neonates|safety|cost|route|frequency|dilution|infusion|oral|iv|im|maximum|max|minimum|min|onset|half|life|failure|impairment|insufficiency|disease)$/;

  /** An aspect-only question: every token is filler or an aspect word, so it has no subject of its
   *  own and is only answerable against the previous turn. "Side effects?" yes; "Polycystic Kidney
   *  Disease" no; "Side effects of Linagliptin" no (it names its own subject). */
  function isFollowUp(q) {
    var toks = String(q == null ? "" : q).toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean);
    if (!toks.length || toks.length > 6) return false;
    for (var i = 0; i < toks.length; i++) {
      if (!FILLER.test(toks[i]) && !ASPECT.test(toks[i])) return false;
    }
    return true;
  }

  function buildPrompt(pkg, packId) {
    if (!pkg) return "";
    var question = pkg.question || (pkg.topicMatch && pkg.topicMatch.topic) || "";
    var L = [];
    var hist = pkg.history || [];
    if (hist.length && isFollowUp(question)) {
      L.push("Recent conversation:");
      hist.slice(-HISTORY_TURNS * 2).forEach(function (h) {
        L.push((h.role === "assistant" ? "MaiK: " : "Doctor: ") + clip(h.text || h.content, HISTORY_CLIP));
      });
      L.push("");
    }
    L.push(question || "Give a brief clinical overview.");
    /* Suppress the base model's thinking mode when the pack asks for it.
     *
     * A Qwen3-family pack emits <think> blocks by default. At nPredict 768 a long reasoning trace can
     * consume the entire budget, so the doctor gets a truncated thought and NO answer - and
     * stripReasoning() then correctly returns "", which reads as the app failing. "/no_think" is the
     * family's own switch, read by the CHAT TEMPLATE if one applies - cheap, so kept as a hint even
     * though it is not what actually fixes this (see below).
     *
     * WRONG FIX, KEPT AS A RECORD: this used to also push "<think>\n\n</think>" into the QUESTION
     * text here, on the theory that the engine sends a raw completion prompt with no chat template.
     * It does not - LlamaEngine.swift/.java DOES apply the model's own chat template, which wraps
     * this whole string (empty-think tag included) inside the USER turn. The "closed" block landed
     * as noise inside the doctor's question while the real assistant turn still opened blank, fixing
     * nothing - and arguably making the noise-in-the-question worse than sending nothing at all.
     * That misdiagnosis is why MaiK Lite kept blanking/looping on freshly re-verified v4 weights
     * after every other cause had been ruled out (2026-09-03).
     *
     * REAL FIX: prefillEmptyThink, passed to L.generate() in answer() below. Only the NATIVE side
     * can close the think block from the ASSISTANT's turn, because only it knows where
     * "<|im_start|>assistant\n" actually is after applying the template.
     */
    if (packId && noThinkPack(packId)) L.push("/no_think");
    return L.join("\n");
  }

  /** Does this pack's base model need its thinking mode switched off? Registry-driven, not hardcoded. */
  function noThinkPack(id) {
    try { var m = models(); return !!(m && m.PACKS[id] && m.PACKS[id].noThink); } catch (e) { return false; }
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
    /* PRE-FLIGHT: is there room to map this model at all?
     *
     * Measured on a Pixel 9 (12 GB total) with a 2.83 GB model selected: MemAvailable had fallen to
     * 176 MB. The model loaded to 3.4 GB resident, the kernel evicted it, it reloaded, and the answer
     * never arrived - a load/evict cycle that presents to the clinician as the app hanging forever.
     * On iOS the same situation ends in a jetsam kill, which looks like a crash.
     *
     * So ask first and refuse with a reason. A refusal a doctor can act on ("close some apps") beats
     * a spinner that never resolves. 0 means the platform could not tell us, and that carries NO
     * opinion - never block on it.
     *
     * BUT THE NUMBER MEANS DIFFERENT THINGS ON THE TWO PLATFORMS, and treating them alike would
     * refuse loads that work. iOS reports os_proc_available_memory(): bytes left before jetsam kills
     * us, a HARD ceiling, so needing 1.15x the weights (KV cache + runtime on top) is right. Android
     * reports availMem, which is free + reclaimable, and llama.cpp mmaps the GGUF - clean pages get
     * evicted and re-faulted, so a 2.5 GB model genuinely runs with well under 2.5 GB "available",
     * just slower. Blocking there at 1.15x would have refused the Pixel in front of me at 2.1 GB
     * free. So the plugin declares which kind of number it is and the soft case only refuses the
     * region where thrashing is certain rather than possible.
     */
    return Promise.resolve()
      .then(function () { return L.available(); })
      // A plugin that cannot answer the question has no opinion on memory. Failing to MEASURE must
      // never become a reason not to ANSWER.
      .then(function (a) { return a; }, function () { return null; })
      .then(function (a) {
        var avail = 0, need = 0;
        try {
          avail = (a && Number(a.availableMemory)) || 0;
          need = M.totalBytes(packId) || 0;
        } catch (e) { return null; }
        // ponytail: 0.35 is calibrated against two real measurements, not theory - 176 MB free
        // against a 2.83 GB model (0.06) hung forever, 2.1 GB against 2.49 GB (0.85) runs. Retune
        // with device data, do not compute it.
        var ratio = (a && a.memoryIsHardLimit) ? 1.15 : 0.35;
        if (avail > 0 && need > 0 && avail < need * ratio) {
          var err = new Error("not-enough-memory:" + Math.round(avail / 1e6) + "MB free, " +
                              (need / 1e9).toFixed(1) + "GB needed");
          err.code = "low-memory";
          throw err;
        }
        return null;
      })
      .then(function () { return M.pathFor(packId); }).then(function (path) {
      return L.load({ path: path, nCtx: pk.nCtx || 4096 });
    }).then(function () { _loadedPack = packId; return null; }, function (err) {
      /* A CORRUPT MODEL IS A DEAD END UNLESS WE CLEAR IT.
       *
       * llama.cpp rejects a structurally bad file and the plugin reports "model-corrupted". Nothing
       * used to act on that, so the pack stayed marked installed, every question failed, and there was
       * no way out from inside the app - the clinician just saw "MaiK is unavailable" forever.
       *
       * Integrity here is byte-length + GGUF magic, deliberately not a full SHA of 2.5 GB read back
       * through the bridge. A download RESUMED from the wrong offset can land on the exact expected
       * length with corrupt bytes inside, pass that check, and be marked installed. This file's own
       * header records that happening before ("resumed after a timeout and was not intact").
       *
       * So delete it. A file the loader will not accept has no value, keeping it wastes 2.5 GB, and
       * leaving the marker alone would not help: installed() re-checks the SIZE, still matches, and
       * marks it installed again. Removing it is what makes re-downloading possible.
       */
      var code = String((err && (err.code || err.message)) || "");
      if (/model-corrupted|corrupt|failed to load/i.test(code)) {
        _loadedPack = null;
        try { if (M.remove) M.remove(packId); } catch (e) {}
        var e2 = new Error("model-corrupted");
        e2.code = "model-corrupted";
        throw e2;
      }
      throw err;
    });
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

  /* On-device RAG for MaiK Lite: grounds the answer in the actual book text instead of the
   * model's own recollection, and a post-hoc gate catches any dose/drug it still invents.
   *
   * WHY THIS EXISTS: on-device probes (2026-09-03) showed MaiK Lite confidently stating a WRONG
   * penicillin-allergy alternative (amoxicillin-clavulanate - itself a penicillin) for
   * "Treatment of Pneumonia?". The blank-answer/thinking-loop bug was real and is fixed
   * (prefillEmptyThink), but that does nothing for CONTENT accuracy - an ungrounded 1.7B states a
   * wrong regimen with total confidence. Doctors expect textbook/guideline-accurate specifics,
   * which only comes from retrieval + a check against it, same architecture as the server.
   *
   * Scoped to maik-lite only tonight, not every noThink pack - that is what was asked for
   * ("the model we trained"), and widening it needs its own verification pass.
   */
  // Owner decision 2026-09-03: MaiK Lite ONLY. The Bonsai packs answer from their own weights.
  function ragEligible(packId) { return packId === "maik-lite"; }

  /** Resolves {evidenceText, passages, RAG} from the on-device book index, or null if ungrounded
   * (no KB yet, no hit, or anything failed) - grounding is a strict improvement when available,
   * never a hard requirement that can break an answer that would otherwise have worked. */
  /* RETRIEVAL DRIFT GUARD (owner battery, 2026-09-04). Two live failures with the same root cause:
   * "first-line treatment of uncomplicated UTI" retrieved a DEFINITIONS chapter, and the follow-up
   * "what if she is pregnant" retrieved a hepatitis-in-pregnancy passage, so the model answered
   * lamivudine for a UTI and the gate PASSED it (lamivudine was in the evidence). BM25 ranks by term
   * overlap; a modifier like "pregnancy" or a generic like "management" can out-vote the actual topic.
   * So a passage must now contain one of the question's ANCHORS - its rarest words that are neither
   * generic clinical filler nor a population modifier - or it is not evidence for this question.
   * Zero anchored passages means "not grounded", never "grounded in the wrong chapter". Same model,
   * same speed: this is a filter after search, and it SHRINKS the prompt (700-char passages, a weak
   * third passage dropped), which is where on-device latency actually goes. */
  var GENERIC_Q = /^(management|treatment|treat|therapy|regimen|regimens|dose|dosing|dosage|doses|route|duration|first|line|drug|drugs|agent|agents|class|choice|adult|patient|patients|clinical|answer|complete|detailed|provide|considerations|principles|verify|locally|empiric|severity|host|adjustment|culture|directed|escalation|steps|monitoring|ongoing|next|approach|options|guideline|guidelines|what|when|which|how|should|give|use|used|with|without|versus|compare|comparison|prefer|each|non|woman|women|man|men|male|female|young|old|older|year|years|uncomplicated|complicated|simple|case|cases|standard|usual|typical|common)$/;
  var MODIFIER_Q = /^(pregnancy|pregnant|lactation|lactating|breastfeeding|renal|hepatic|liver|kidney|paediatric|pediatric|child|children|neonate|neonatal|elderly|geriatric|dialysis|ckd|impairment|failure|obese|obesity)$/;
  var INTRO_HEAD = /definition|glossary|introduction|epidemiolog|etiolog|pathogenesis|classification|history|overview/i;
  var TREAT_Q = /\b(treat|treatment|therapy|manage|management|dose|dosing|regimen|first.?line|drug|antibiotic|prescri)/i;
  function cleanPassage(s) { return String(s || "").replace(/[■□▪▫●○◆◇◼◻•·]+/g, " ").replace(/\s+/g, " ").trim(); }
  function anchorsFor(bk, RAG, question) {
    // No tokenizer available (an older RAG build or a test stub) means no anchoring, never a
    // thrown error that would silently turn every answer ungrounded.
    if (!RAG || typeof RAG.toks !== "function") return [];
    // Asked form AND expanded form: "UTI" expands to "urinary tract infection", but the book's own
    // chapters say "UTI" (IDF 5.0) more than the long form (3.8); losing the abbreviation lost the
    // strongest anchor. Three kinds come back: TOPIC words (the disease), DRUG names, and population
    // MODIFIER stems. The disease is what a passage must be about; a drug name alone is not (the
    // live CAP comparison pulled typhoid-resistance passages that merely named both drugs).
    var q = question;
    try { var ex = RAG.expand(question); q = question + " " + ex[0] + " " + ex[1]; } catch (e) {}
    var seen = {}, topic = [], drugs = [], mods = [], tokens = [], drugSet = null;
    try { tokens = RAG.toks(q) || []; } catch (e) { tokens = []; }
    try { drugSet = RAG.drugsOf ? RAG.drugsOf(q) : null; } catch (e) { drugSet = null; }
    var prev = "";
    tokens.forEach(function (w) {
      var before = prev; prev = w;
      try { if (bk.us) w = bk.us(w); } catch (e) {}
      if (seen[w] || w.length < 3) return;
      seen[w] = 1;
      // "non-pregnant" is not a request for pregnancy material.
      if (MODIFIER_Q.test(w)) { if (before !== "non" && before !== "not") mods.push(w.slice(0, 5)); return; }
      if (GENERIC_Q.test(w)) return;
      var idf = bk.idfOf ? bk.idfOf(w) : 1;
      if (idf === undefined) return;   // unknown to the book: cannot anchor on it
      if (drugSet && drugSet.has(w)) drugs.push(w); else topic.push([idf, w]);
    });
    topic.sort(function (a, b) { return b[0] - a[0]; });
    // Rarest topic words only, relative to the rarest one, so "infection" (IDF 2.0) does not let a
    // urethritis passage stand in for a UTI one.
    var floor = topic.length ? 0.6 * topic[0][0] : 0;
    return { topic: topic.filter(function (e) { return e[0] >= floor; }).slice(0, 3).map(function (e) { return e[1]; }), drugs: drugs, mods: mods };
  }
  function retrieveGrounding(packId, question) {
    if (!ragEligible(packId) || !question) return Promise.resolve(null);
    var RAG = (typeof window !== "undefined") && window.SMD_MAIK_RAG;
    var KB = (typeof window !== "undefined") && window.SMD_MAIK_KB_STORE;
    if (!RAG || !KB) return Promise.resolve(null);
    return KB.loadBook(RAG).then(function (bk) {
      // Search wider than we keep: the anchored passages are often ranks 2-6 behind a glossary
      // chapter that matches every word. Same BM25 pass, only the sort tail is longer.
      var hits = bk.search(question, RAG.TOPK * 3);
      if (!hits.length || hits[0][0] < RAG.MIN_SCORE) return null;
      var A = anchorsFor(bk, RAG, question);
      if (!A || !A.topic) A = { topic: A || [], drugs: [], mods: [] };
      var need = A.topic.length ? A.topic : A.drugs;
      var anchors = A.topic.concat(A.drugs);
      var cited = hits.map(function (h) { var p = bk.cite(h[1]); return { score: h[0], p: p, hay: ((p.heading || "") + " " + (p.text || "")).toLowerCase() }; });
      var kept = need.length ? cited.filter(function (c) { return need.some(function (a) { return c.hay.indexOf(a) !== -1; }); }) : cited;
      if (!kept.length) return null;
      // "…in pregnancy": among the on-topic passages, the ones that mention the modifier win when any
      // do; when none do, the topic passages stay and the model says so, instead of a passage about
      // a different disease in pregnancy.
      if (A.mods.length) {
        var wm = kept.filter(function (c) { return A.mods.some(function (m) { return c.hay.indexOf(m) !== -1; }); });
        if (wm.length) kept = wm;
      }
      // A definitions / introduction chapter is not the answer to a treatment question when anything
      // else survived (the live "■■ DEFINITIONS" fallback for a UTI treatment ask).
      if (TREAT_Q.test(question) && kept.length > 1) {
        var nd = kept.filter(function (c) { return !INTRO_HEAD.test(c.p.heading || ""); });
        if (nd.length) kept = nd;
      }
      kept = kept.filter(function (c) { return c.score >= 0.4 * kept[0].score; }).slice(0, RAG.TOPK);
      if (kept.length > 2 && kept[2].score < 0.6 * kept[0].score) kept = kept.slice(0, 2);
      var passages = kept.map(function (c) { c.p.text = cleanPassage(c.p.text); return c.p; });
      var evidenceText = passages.map(function (p, n) { return "[" + (n + 1) + "] " + p.text.slice(0, 700); }).join("\n\n");
      return { evidenceText: evidenceText, passages: passages, RAG: RAG, anchors: anchors };
    }).catch(function () { return null; });
  }

  function answer(pkg, opts, onDelta) {
    var L = llama();
    if (!L) return Promise.resolve({ error: "on-device inference needs the native app" });
    var packId = (opts && opts.pack) || currentPack();
    // opts.images = local file paths. Empty for the ordinary text path.
    var images = (opts && opts.images && opts.images.length) ? opts.images.slice(0, MAX_IMAGES) : [];
    if (images.length && !visionReady(packId)) {
      return Promise.resolve({ error: "vision-not-downloaded" });
    }
    var t0 = Date.now();
    var acc = "";
    var sub = null;

    var groundingP = (images.length || (opts && (opts._retried || opts._ungrounded))) ? Promise.resolve(null)
      : retrieveGrounding(packId, pkg && pkg.question);

    return groundingP.then(function (grounding) {
    return ensureLoaded(packId).then(function () {
      var prompt = buildPrompt(pkg, packId);
      if (!prompt) return { error: "no-package" };
      if (grounding) {
        prompt = "Reference material from the StewardMD Knowledge Base:\n" + grounding.evidenceText +
          "\n\nUsing the reference material above where it applies, answer:\n" + prompt;
      }
      // Retry-after-blank: nudge the model out of the deliberation attractor it fell into.
      if (opts && opts.nudge) prompt += "\nGive the final answer directly, no deliberation.";

      // Stream tokens into the caller's typewriter. Accumulate: onDelta wants the full text so far.
      var attach = (typeof onDelta === "function" && L.addListener)
        ? Promise.resolve(L.addListener("llamaToken", function (ev) {
            acc += (ev && ev.text) || "";
            // Strip on the way out too, not just at the end: onDelta feeds the live typewriter, so a
            // leaked reasoning preamble would be read on screen even though the final text is clean.
            // While the model is inside an unterminated reasoning block this yields "", which is the
            // honest thing to show - nothing has been answered yet.
            try { onDelta(stripReasoning(acc)); } catch (e) {}
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
        var common = {
          prompt: prompt,
          /* Which prompt runs is the whole difference between a useful answer and a useless one.
           *
           *   systemOverride  a caller doing STRUCTURED EXTRACTION (ICU autofill wants JSON fields).
           *                   The interpretive prompt below would fight that request and return prose.
           *   imageFollowUp   a question about an image already on screen. Without this the model
           *                   re-reads the picture and repeats the whole summary, so "is this normal?"
           *                   came back as another transcription instead of an answer.
           *   SYSTEM_IMAGE    a first look at an image: findings, then interpretation.
           */
          system: (opts && opts.systemOverride) ? opts.systemOverride
                // A greeting with no image: answer it as a greeting, not as a clinical question.
                : (!images.length && isGreeting(pkg && pkg.question)) ? SYSTEM_GREET
                // A pack can carry its own system prompt (registry-driven, like noThink).
                // MaiK Lite was TRAINED with its prompt, so the shared one would be a
                // distribution shift - and its dose example was parroted as a real dose.
                : !images.length ? (pk.system || SYSTEM)
                : (opts && opts.imageFollowUp) ? SYSTEM_IMAGE_FOLLOWUP
                : SYSTEM_IMAGE,
          nPredict: pk.nPredict || 512,
          // Regenerate (owner, 2026-09-04): a second attempt at temperature 0 is the same answer
          // byte for byte, so a regenerate request gets a little sampling jitter.
          temperature: (opts && typeof opts.temperature === "number") ? opts.temperature : ((opts && opts.regen) ? 0.4 : 0),
          stream: typeof onDelta === "function",
          // The actual think-suppression fix (see buildPrompt's comment for why the old
          // in-question-text approach never worked). Vision packs are never noThink today, so this
          // only needs wiring on the text path.
          prefillEmptyThink: !images.length && noThinkPack(packId)
        };
        if (!images.length) return L.generate(common);
        // IMAGE PATH. mtmd reads the file itself, so paths cross the bridge, never base64 - a phone
        // photo is several MB and marshalling that as a string is what made the old downloader
        // unusable. mmproj must come from the SAME pack as the loaded model; nothing native can
        // detect a mismatched pair, it just answers confident nonsense.
        return visionPathFor(packId).then(function (mm) {
          if (!mm) return { error: "vision-not-downloaded" };
          common.images = images;
          common.mmproj = mm;
          return L.generateWithImage(common);
        });
      }).then(function (r) {
        if (r && r.error) return r;
        var text = stripReasoning((r && r.text) || acc || "");
        // Everything the model produced was reasoning (unterminated think block ate the
        // budget). Measured on-device 2026-08-31: a second pass with sampling jitter and a
        // directness nudge recovers most of these, so retry ONCE before surfacing an error.
        // Text path only: an image answer costs a full vision prefill and is not think-prone.
        if (!text && !images.length && !(opts && opts._retried)) {
          var ro = { _retried: true, temperature: 0.35, nudge: true, pack: packId };
          if (opts) { for (var k in opts) { if (!(k in ro)) ro[k] = opts[k]; } }
          return answer(pkg, ro, onDelta);
        }
        if (!text) return { error: EMPTY_ANSWER };
        // NO-COVERAGE FALLBACK (owner, 2026-09-04, from a live screenshot). Retrieval can miss: a
        // misspelt "Spleenomegaly with fever DD and Rx" pulled diverticulitis and dd-cfDNA passages
        // that still cleared the score floor, and the model obediently reported "not addressed in
        // the provided reference material". The doctor got nothing. That reply is a verdict on the
        // retrieval, not an answer, so re-ask ONCE with no reference material: the model answers
        // from its own weights, marked ungrounded, no gate, no source line (the banner already says
        // "AI-generated, no sources").
        if (grounding && !images.length && !(opts && opts._ungrounded) && NO_COVERAGE.test(text)) {
          var uo = { _ungrounded: true, pack: packId };
          if (opts) { for (var k2 in opts) { if (!(k2 in uo)) uo[k2] = opts[k2]; } }
          return answer(pkg, uo, onDelta);
        }
        // RAG safety net: every number/drug the answer states must be backed by the retrieved
        // book text or the question itself. A doctor-supplied figure ("glucose 32 mg/dL") is not
        // a hallucination; anything else the model adds without support is exactly the failure
        // this was built to catch (the live penicillin-allergy contradiction). A gate failure does
        // NOT surface as an error - it shows the real book passages instead of a wrong paraphrase,
        // which is strictly more useful to a doctor than either a blank screen or a wrong answer.
        var quotedPassage = false;   // a verbatim book passage is shown as written, never re-emphasized
        if (grounding) {
          var gate = grounding.RAG.evidenceGate(text, grounding.evidenceText, pkg && pkg.question);
          if (!gate.ok) {
            var pass = grounding.passages[0]; quotedPassage = true;
            var shown = cleanPassage(pass.text);
            if (shown.length > 700) shown = shown.slice(0, 700).replace(/\s+\S*$/, "") + "…";
            text = "The on-device model's answer could not be verified against the StewardMD Knowledge Base " +
              "(it stated a figure or drug not found there). Here is the reference passage on this topic instead:\n\n" + shown;
          } else {
            // NEVER a page number, on owner order - matches the standing attribution used
            // everywhere else in the app (maik-models.js GUIDE_INTRO / guide.why).
            text = text + "\n\nSource: StewardMD Knowledge Base - based on standard medical resources.";
          }
        }
        if (!quotedPassage) text = emphasize(text);
        return {
          text: text,
          // sources stays [] regardless: the citation UI's own contract (SMD_MaiK.sourceList)
          // recomputes from pkg.grounding/retrieved/treatment, which this engine does not
          // populate. A plain "Source: ..." line is appended to the text itself above instead,
          // which needs no UI change and cannot be silently dropped by a different code path.
          sources: [],
          grounded: !!grounding,
          engine: "local",
          images: images.length,
          model: (models() && models().PACKS[packId] && models().PACKS[packId].label) || packId,
          ms: (r && r.ms) || (Date.now() - t0)
        };
      });
    }).catch(function (e) {
      var msg = String((e && e.message) || "");
      /* The memory case gets a SENTENCE, not a code. "low-memory" on screen tells a clinician
       * nothing they can act on; "close some apps" does, and the numbers make it checkable. */
      var mm = /^not-enough-memory:(\d+)MB free, ([\d.]+)GB needed$/.exec(msg);
      if (mm) {
        return { error: "Not enough free memory to load the on-device model right now (" + mm[1] +
                        " MB free, " + mm[2] + " GB needed). Close some apps and try again, or use MaiK Cloud." };
      }
      // Otherwise surface the plugin's stable error code; the UI maps it to copy.
      return { error: String((e && (e.code || e.message)) || e || "local-failed") };
    }).then(function (out) {
      if (sub && sub.remove) { try { sub.remove(); } catch (e) {} }
      return out;
    });
    });
  }

  /**
   * Is on-device inference actually possible here? The MODULE always loads (it ships in the web
   * bundle too), so maik-engine.js must not treat "SMD_MAIK_LOCAL exists" as "the runtime exists" —
   * on the web PWA there is no capacitor-llama plugin at all.
   */
  function available() { return !!llama(); }

  /* Is this a DEVELOPMENT build? Cached, because the engine picker needs the answer synchronously.
   * Used only to open the experimental gate on a dev build - a release build reports false and still
   * requires an access code.
   *
   * BUGFIX (2026-08-24): this probe used to be ONE SHOT -
   *     var L = llama(); if (!L || !L.available) return;
   * Capacitor registers its plugins asynchronously, so when this module loaded first the plugin was
   * not there yet, the probe gave up FOREVER, and _debugBuild stayed false for the whole session.
   * gateActive() then read false, effective() silently downgraded "local" to "rag", and a clinician
   * who had downloaded 2.5 GB got KB-only answers with no explanation. Now it retries until the
   * bridge is up, and re-probes on demand so a caller is never stuck with a stale "no".
   */
  var _debugBuild = false, _debugProbed = false;
  function isDebugBuild() { if (!_debugProbed) probeDebug(0); return _debugBuild; }
  function debugProbed() { return _debugProbed; }
  function probeDebug(tries) {
    tries = (tries == null) ? PROBE_TRIES : tries;
    try {
      var L = llama();
      if (!L || !L.available) {
        if (tries > 0) setTimeout(function () { probeDebug(tries - 1); }, PROBE_DELAY_MS);
        return;
      }
      L.available().then(function (a) {
        _debugBuild = !!(a && a.debugBuild); _debugProbed = true;
      }).catch(function () {
        if (tries > 0) setTimeout(function () { probeDebug(tries - 1); }, PROBE_DELAY_MS);
      });
    } catch (e) {
      if (tries > 0) setTimeout(function () { probeDebug(tries - 1); }, PROBE_DELAY_MS);
    }
  }
  // ~6 s of retries: the bridge is normally up in well under a second, and giving up quietly is the
  // exact failure this replaces.
  var PROBE_TRIES = 24, PROBE_DELAY_MS = 250;
  probeDebug();

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

  /* IDLE UNLOAD (owner, 2026-09-04): a 1 to 4 GB model must not sit resident, warming the phone and
   * starving every other module, once its work is done. Rules:
   *   - every tracked call (answer, warm) cancels any pending release and counts itself in flight;
   *   - when the last in-flight call settles, a release is scheduled: IDLE_MS while the MaiK sheet is
   *     open (a doctor reading the answer before the follow-up), CLOSE_GRACE_MS once it is closed;
   *   - sheetClosed() never cuts a running generation: home.js close() deliberately lets an in-flight
   *     answer finish and persist, so the release waits for it and then applies the close grace;
   *   - sheetOpened() cancels a pending release, and home.js re-warms there instead of at app start.
   * The next question after a release simply reloads (ensureLoaded), a few seconds on the 1.1 GB
   * MaiK Lite, longer on the Bonsai packs; that cost is the price of not holding the memory. */
  var IDLE_MS = 3 * 60 * 1000, CLOSE_GRACE_MS = 20 * 1000;
  var _idleT = null, _inflight = 0, _sheetOpen = null, _idleMs = IDLE_MS, _closeMs = CLOSE_GRACE_MS;
  function clearIdle() { if (_idleT) { clearTimeout(_idleT); _idleT = null; } }
  function scheduleRelease(ms) {
    clearIdle();
    _idleT = setTimeout(function () { _idleT = null; if (_inflight === 0) release(); }, ms);
    // unref() only exists on Node's Timeout (this file also runs, unit-tested, under plain node); in
    // the WebView setTimeout returns a number and this is a no-op. Without it, any Node script that
    // calls answer()/vivaJudge()/opdSuggest()/webAnswer() - test files included - hangs for up to
    // IDLE_MS after its last assertion, because a real pending timer keeps the process alive even
    // though nothing is left to do (found live in CI: the unit-tests job stalled ~3 minutes on
    // maik-local.test.mjs alone, 2026-09-04). A timer this file starts must never block a caller's exit.
    try { if (_idleT && typeof _idleT.unref === "function") _idleT.unref(); } catch (e) {}
  }
  function settle() { if (_inflight === 0) scheduleRelease(_sheetOpen === false ? _closeMs : _idleMs); }
  function tracked(fn) {
    return function () {
      clearIdle(); _inflight++;
      var p;
      try { p = Promise.resolve(fn.apply(null, arguments)); } catch (e) { p = Promise.reject(e); }
      return p.then(function (r) { _inflight--; settle(); return r; }, function (e) { _inflight--; settle(); throw e; });
    };
  }
  function sheetOpened() { _sheetOpen = true; clearIdle(); }
  function sheetClosed() { _sheetOpen = false; settle(); }
  /** Test hook: shorten the timers. */
  function setIdleMs(idle, close) { _idleMs = idle; _closeMs = (close == null) ? idle : close; }

  /* STRUCTURED on-device calls (owner, 2026-09-04): the CliniX viva judge and the OPD "Ask MaiK Pro"
   * differential were cloud-only because nobody had written a local version, not because they need
   * the cloud. Prompts and output whitelisting are copied from the server (functions/api/ai/[[path]].js
   * "viva-judge" and _opd-suggest.js) so the callers see the same shapes. Run with `system` set to
   * the task prompt so the interpretive MaiK prompt cannot turn the JSON into prose. */
  function parseJsonLoose(t) {
    if (!t) return null;
    var m = String(t).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }
  var VIVA_SYS =
    "You are a strict but fair clinical viva examiner. You are given the QUESTION, the KEY POINTS a " +
    "complete answer should cover, and the STUDENT'S ANSWER. Judge the answer ONLY - do not ask a new " +
    "question, do not have a conversation, do not repeat the question back.\n" +
    "Output ONLY this JSON, nothing else: " +
    '{"verdict":"correct|partial|incorrect","feedback":"<one sentence, at most 25 words, examiner tone>"}\n' +
    "correct = covers the key points accurately, in the student's own words is fine. partial = the right " +
    "idea but incomplete, imprecise, or missing a key point. incorrect = wrong, or does not answer the " +
    "question. Be direct in feedback, the way a real examiner would be, but never unkind.\n" +
    "NEVER state a drug dose, route, or frequency in your feedback, even if the student's answer contains " +
    "one - that is out of scope for this judgement.";
  var OPD_SYS =
    "You are a senior physician giving OPD decision support. From the clinical assessment below " +
    "(what the doctor has already entered), produce a focused, safe differential.\n" +
    "Return ONLY JSON: {\"provisionalDx\":\"\",\"ddx\":[{\"dx\":\"\",\"why\":\"\"}],\"investigations\":[\"\"],\"treatment\":[\"\"],\"redFlags\":[\"\"]}.\n" +
    "RULES:\n" +
    "- Base EVERYTHING only on the findings stated; NEVER invent a symptom, finding, or history.\n" +
    "- provisionalDx = the single most likely working diagnosis for this picture.\n" +
    "- ddx = the differential, MOST LIKELY FIRST (max 6), each with a one-line 'why' tied to the findings. " +
    "Include must-not-miss diagnoses even if less likely.\n" +
    "- investigations = the workup you would order for this picture (max 10).\n" +
    "- treatment = first-line management, with drug/dose/route/frequency where standard (max 10). This is a " +
    "SUGGESTION for the doctor to verify, never an order; note where dosing depends on weight/renal function.\n" +
    "- redFlags = must-not-miss features to watch for (max 6).\n" +
    "- Write everything in clear clinical ENGLISH. Keep drug names, doses, units and standard abbreviations exact.\n" +
    "- Output ONLY the JSON. No prose, no markdown, no code fences.";
  // Port of sanitizeOpdSuggest: bounded plain text only, nothing the app trusts blindly.
  function sanitizeOpd(parsed) {
    var out = { provisionalDx: "", ddx: [], investigations: [], treatment: [], redFlags: [] };
    if (!parsed || typeof parsed !== "object") return out;
    var str = function (x, n) { return String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n || 200); };
    var list = function (a, n, map) { return (Array.isArray(a) ? a : []).map(map).filter(Boolean).slice(0, n); };
    if (typeof parsed.provisionalDx === "string") out.provisionalDx = str(parsed.provisionalDx, 300);
    out.ddx = list(parsed.ddx, 6, function (x) {
      if (!x) return null;
      if (typeof x === "string") { var d0 = str(x, 160); return d0 ? { dx: d0, why: "" } : null; }
      var d = str(x.dx || x.name, 160); return d ? { dx: d, why: str(x.why || x.reason, 300) } : null;
    });
    out.investigations = list(parsed.investigations, 10, function (x) { return str(x, 160); });
    out.treatment = list(parsed.treatment, 10, function (x) { return str(x, 240); });
    out.redFlags = list(parsed.redFlags, 6, function (x) { return str(x, 220); });
    return out;
  }
  /* WEB RESEARCH (owner, 2026-09-04): "Research on the web" pays Gemini to turn TinyFish's search
   * snippets into prose only when MaiK Cloud is the selected engine - "we can't charge them for
   * snippet conversion into clean language" for the local/offline engine. The search itself
   * (TinyFish, see functions/_search.js) already costs nothing; maik-engine.js's routing fetches the
   * raw snippets via SMD_AI.researchSnippets and hands them here, so the on-device model does the
   * writing for free. Prompt ported verbatim from RESEARCH_SYS_SNIPPETS / MEDICAL_ONLY in
   * functions/api/ai/[[path]].js so a web-research answer reads the same regardless of which engine
   * wrote it. */
  var MEDICAL_ONLY_LOCAL =
    "\nSCOPE - NON-NEGOTIABLE: answer MEDICAL and CLINICAL questions only. That includes everything a " +
    "doctor legitimately asks: diseases, drugs and drug classes, doses, mechanisms of action, " +
    "investigations, procedures, guidelines, physiology, pathology, public health and medical education. " +
    "If the question is NOT medical, do not answer it. Reply with exactly this line and nothing else: " +
    "\"I can only help with medical and clinical questions.\"";
  var WEB_SYS =
    "You are MaiK, a knowledgeable clinical AI assistant for qualified doctors. Answer the clinician's question directly, thoroughly and naturally - the way a sharp, warm senior colleague would explain it, and the way a modern medical AI answers. " +
    "Draw on solid, widely-accepted medical knowledge for the substance of the answer; the numbered WEB RESULTS below are recent supporting sources - use them to ground specifics (agents, doses, current guidance) and cite the relevant ones inline as [n] matching the list, but do NOT merely summarise the snippets or limit yourself to what they happen to mention. " +
    "Lead with the direct answer, then give enough well-organised detail to be genuinely useful at the bedside: flowing prose, with short bullets only for real lists (drugs, doses, steps, differentials) and a brief markdown heading only when it truly helps. Bold key terms sparingly. Give standard adult doses/routes/durations where relevant. " +
    "Be honest in one line if evidence is weak or sources disagree. Never fabricate a specific figure or a citation. Do not describe your sources or process, and do NOT append any disclaimer." + MEDICAL_ONLY_LOCAL;
  var WEB_MAX = 900;
  function generateText(prompt, system, nPredict, opts) {
    var L = llama();
    if (!L) return Promise.reject(new Error("on-device inference needs the native app"));
    var packId = (opts && opts.pack) || currentPack();
    return ensureLoaded(packId).then(function () {
      return L.generate({ prompt: prompt, system: system, nPredict: nPredict,
                          temperature: (opts && typeof opts.temperature === "number") ? opts.temperature : 0.2,
                          stream: false, prefillEmptyThink: noThinkPack(packId) });
    }).then(function (r) {
      if (r && r.error) throw new Error(String(r.error));
      return stripReasoning((r && r.text) || "");
    });
  }
  /** Turn TinyFish's raw sources into a web-research answer on device. sources:
   * [{title,url,site,snippet}] (the exact shape SMD_AI.researchSnippets resolves). No sources -> the
   * honest "no-results" the caller already renders as a retry, never a hallucinated web answer. */
  function webAnswer(question, sources, opts) {
    var q = String(question || "").slice(0, 500).trim();
    if (!q) return Promise.resolve({ error: "no-question" });
    var list = (Array.isArray(sources) ? sources : []).slice(0, 8).filter(function (s) { return s && (s.title || s.snippet); });
    if (!list.length) return Promise.resolve({ error: "no-results" });
    var ctx = list.map(function (s, i) {
      return "[" + (i + 1) + "] " + String(s.title || "").slice(0, 200) + (s.site ? " (" + s.site + ")" : "") +
        "\n" + String(s.snippet || "").slice(0, 400) + "\n" + String(s.url || "");
    }).join("\n\n");
    var evidenceText = list.map(function (s, i) { return "[" + (i + 1) + "] " + String(s.title || "") + ". " + String(s.snippet || ""); }).join("\n");
    var prompt = "Question: " + q + "\n\nWeb results:\n" + ctx;
    return generateText(prompt, WEB_SYS, WEB_MAX, opts).then(function (text) {
      if (!text) return { error: "no-answer" };
      var srcOut = list.map(function (s) { return { title: s.title, url: s.url, site: s.site }; });
      try {
        var RAG = (typeof window !== "undefined") && window.SMD_MAIK_RAG;
        if (RAG && RAG.evidenceGate) {
          var gate = RAG.evidenceGate(text, evidenceText, q);
          if (!gate.ok) {
            var top = list[0];
            var shown = String(top.title || "") + (top.snippet ? "\n" + top.snippet : "") + (top.url ? "\n" + top.url : "");
            return {
              text: "The on-device model's answer could not be verified against the web results it found " +
                "(it stated a figure or drug not in them). Showing the top result instead:\n\n" + shown,
              sources: srcOut, engine: "local", mode: "web-local"
            };
          }
        }
      } catch (e) {}
      return { text: emphasize(text), sources: srcOut, engine: "local", mode: "web-local" };
    });
  }
  function generateJSON(prompt, system, nPredict, opts) {
    var L = llama();
    if (!L) return Promise.reject(new Error("on-device inference needs the native app"));
    var packId = (opts && opts.pack) || currentPack();
    // Small packs (MaiK Lite was fine-tuned for prose) drift into sections before the JSON; the
    // closing nudge in the user turn is what keeps a 1.7B on the object. Harmless for the larger ones.
    prompt += "\n\nReply with the JSON object only. Start your reply with {";
    function once(p, temp) {
      return L.generate({ prompt: p, system: system, nPredict: nPredict, temperature: temp, stream: false,
                          prefillEmptyThink: noThinkPack(packId) }).then(function (r) {
        if (r && r.error) throw new Error(String(r.error));
        var text = stripReasoning((r && r.text) || "");
        return { parsed: parseJsonLoose(text), text: text };
      });
    }
    return ensureLoaded(packId).then(function () { return once(prompt, 0); }).then(function (a) {
      if (a.parsed) return a.parsed;
      // A 1.7B answers the same prompt as JSON one minute and as prose the next (seen live on MaiK
      // Lite). One retry with a blunter instruction and a little sampling jitter recovers most of
      // those; a second miss is reported honestly, never turned into an invented verdict.
      return once(prompt + "\n\nYour previous reply was prose. Output ONLY the JSON object now, nothing before it and nothing after it.", 0.3).then(function (b) {
        if (b.parsed) return b.parsed;
        // Carry a short sample of what the model said so a device probe can see WHY (callers only
        // look at .error). Model output, never book text.
        var e = new Error("parse"); e.sample = b.text.slice(0, 240); throw e;
      });
    });
  }
  function parseFailure(err) {
    if (err && err.message === "parse") return { error: "parse", sample: err.sample || "" };
    throw err;
  }
  /** CliniX viva examiner, same contract as /viva-judge: {verdict, feedback} or {error}. */
  function vivaJudge(question, keyPoints, given, opts) {
    var q = String(question || "").slice(0, 400).trim(), key = String(keyPoints || "").slice(0, 600).trim(), g = String(given || "").slice(0, 800).trim();
    if (!q || !g) return Promise.resolve({ error: "no-input" });
    var prompt = "QUESTION: " + q + (key ? ("\nKEY POINTS: " + key) : "") + "\nSTUDENT'S ANSWER: " + g;
    return generateJSON(prompt, VIVA_SYS, 160, opts).then(function (p) {
      var v = (p && ["correct", "partial", "incorrect"].indexOf(p.verdict) >= 0) ? p.verdict : null;
      if (!v) return { error: "parse", sample: JSON.stringify(p).slice(0, 240) };
      return { verdict: v, feedback: String(p.feedback || "").slice(0, 300), mode: "viva-judge", engine: "local" };
    }, function (err) {
      // MaiK Lite (prose fine-tune) judges in a sentence about half the time even after the retry:
      // "The student's answer is incorrect because it omits adrenaline." That IS a verdict, stated by
      // the model in its own words, so accept it - but only when the opening sentence names exactly
      // one verdict. Anything vaguer stays an honest parse error; nothing is inferred.
      var pf = parseFailure(err), v = verdictFromProse(pf.sample);
      if (!v) return pf;
      return { verdict: v.verdict, feedback: v.feedback, mode: "viva-judge", engine: "local" };
    });
  }
  function verdictFromProse(text) {
    var first = (String(text || "").trim().match(/^[^.!?]*[.!?]?/) || [""])[0];
    if (first.length > 300) return null;
    var found = {}, m, re = /\b(correct|partially correct|partial|incomplete|incorrect|wrong)\b/gi;
    while ((m = re.exec(first)) !== null) {
      var w = m[1].toLowerCase();
      found[w === "wrong" ? "incorrect" : (w === "partially correct" || w === "incomplete") ? "partial" : w] = 1;
    }
    var keys = Object.keys(found);
    if (keys.length !== 1) return null;
    if (keys[0] === "correct" && /\b(not|n't)\s+(entirely\s+|fully\s+|completely\s+)?correct\b/i.test(first)) return null;
    return { verdict: keys[0], feedback: first.slice(0, 300) };
  }
  /** OPD "Ask MaiK Pro" differential, same contract as /extract kind "opd-suggest". */
  function opdSuggest(assessment, opts) {
    var a = String(assessment == null ? "" : assessment).slice(0, 8000).trim();
    if (!a) return Promise.resolve({ error: "no-text" });
    return generateJSON("=== ASSESSMENT ===\n" + a, OPD_SYS, 900, opts).then(function (p) {
      var out = sanitizeOpd(p);
      out.kind = "opd-suggest"; out.mode = "opd-suggest"; out.engine = "local";
      return out;
    }, parseFailure);
  }

  /* READABLE EMPHASIS for on-device answers (owner, 2026-09-04: "Answer can show Bold Italic etc
   * formats to make it more appealing and reading"). The renderer (reasoning.js maikMarkdown) already
   * turns **x** into <b> and *x* into <i>; the gap is that MaiK Lite, a prose fine-tune, emits plain
   * text. Its system prompt is the exact one it was trained with and is deliberately not touched, so
   * the emphasis is added deterministically here instead: drug names (the same suffix regex the
   * evidence gate uses, via SMD_MAIK_RAG.drugsOf when loaded), doses and durations are bolded, the
   * way a doctor's eye scans an answer. Applied ONLY when the model produced no ** of its own (the
   * larger packs follow "Answer in markdown" already), AFTER the evidence gate (it changes no figure),
   * and never to the Source line. Pure, exported for tests. */
  var DOSE_RE = /\b(\d+(?:\.\d+)?(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*(?:mg|g|mcg|µg|ml|mL|IU|units?|mmol|mEq)(?:\/(?:kg|day|d|dose|h|hr|m2))?)(?![\w*])/gi;
  var DURATION_RE = /\b(\d+(?:\s*(?:-|to)\s*\d+)?\s*(?:days?|weeks?|months?|hours?|hrs?))\b(?!\*)/gi;
  var DRUG_FALLBACK_RE = /\b[a-z]{4,}(?:cillin|mycin|micin|cycline|azole|oxacin|floxacin|pril|sartan|statin|olol|dipine|parin|prazole|triptan|mab|nib|tinib|ciclovir|vir|navir|cept|gliptin|glitazone|barbital|azepam|zolam|caine|tidine|semide|thiazide)\b/gi;
  function emphasize(text) {
    var t = String(text == null ? "" : text);
    if (!t || t.indexOf("**") !== -1) return t;
    var RAG = (typeof window !== "undefined") && window.SMD_MAIK_RAG;
    var drugs = [];
    try { if (RAG && RAG.drugsOf) drugs = Array.from(RAG.drugsOf(t)); } catch (e) { drugs = []; }
    if (!drugs.length) { var seen = {}, m; DRUG_FALLBACK_RE.lastIndex = 0; while ((m = DRUG_FALLBACK_RE.exec(t)) !== null) { var w = m[0].toLowerCase(); if (!seen[w]) { seen[w] = 1; drugs.push(w); } } }
    return t.split("\n").map(function (line) {
      if (/^\s*Source:/i.test(line) || /^\s*Verify against/i.test(line)) return line;
      var out = line.replace(DOSE_RE, "**$1**").replace(DURATION_RE, "**$1**");
      drugs.forEach(function (d) {
        var re = new RegExp("(^|[^\\w*])(" + d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")(?![\\w*])", "gi");
        out = out.replace(re, "$1**$2**");
      });
      return out;
    }).join("\n");
  }

  var API = {
    SYSTEM: SYSTEM, DEFAULT_PACK: DEFAULT_PACK, emphasize: emphasize,
    HISTORY_TURNS: HISTORY_TURNS, buildPrompt: buildPrompt, answer: tracked(answer), available: available, currentPack: currentPack,
    isFollowUp: isFollowUp, isGreeting: isGreeting, SYSTEM_GREET: SYSTEM_GREET, stripReasoning: stripReasoning,
    visionReady: visionReady, visionPathFor: visionPathFor, MAX_IMAGES: MAX_IMAGES, SYSTEM_IMAGE: SYSTEM_IMAGE,
    SYSTEM_IMAGE_FOLLOWUP: SYSTEM_IMAGE_FOLLOWUP,
    warm: tracked(warm), isDebugBuild: isDebugBuild, debugProbed: debugProbed, cancel: cancel, release: release,
    sheetOpened: sheetOpened, sheetClosed: sheetClosed, setIdleMs: setIdleMs,
    vivaJudge: tracked(vivaJudge), opdSuggest: tracked(opdSuggest), parseJsonLoose: parseJsonLoose,
    VIVA_SYS: VIVA_SYS, OPD_SYS: OPD_SYS, webAnswer: tracked(webAnswer), WEB_SYS: WEB_SYS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_MAIK_LOCAL = API;
})();
