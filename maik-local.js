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
      // Count anchors per passage. With two or more topic anchors, a passage matching two beats one
      // matching one ("community" alone let a typhoid epidemiology passage stand in for CAP); when
      // nothing matches two, one is enough.
      cited.forEach(function (c) { c.n = need.filter(function (a) { return c.hay.indexOf(a) !== -1; }).length; });
      var kept = need.length ? cited.filter(function (c) { return c.n > 0; }) : cited;
      if (!kept.length) return null;
      if (need.length > 1 && kept.some(function (c) { return c.n > 1; })) kept = kept.filter(function (c) { return c.n > 1; });
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

    // A greeting is not a question: no retrieval, so no "Source:" line on a hello (owner
    // screenshot, 2026-09-04).
    var groundingP = (images.length || (opts && (opts._retried || opts._ungrounded)) || isGreeting(pkg && pkg.question)) ? Promise.resolve(null)
      : retrieveGrounding(packId, pkg && pkg.question);

    return groundingP.then(function (grounding) {
    // Queued like every other local generation, and NOT background: the clinician is watching this
    // one, so it goes ahead of any queued Scribe drafting (it cannot interrupt one already running).
    return serial(function () {
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
                // A PERSONA mode (clinix-tutor, surgx-mentor): the cloud picks its prompt from
                // opts.mode server-side; the local engine used to ignore mode and teach a student
                // like a reference page. Text path only: an image question keeps the image prompts.
                : (!images.length && opts && opts.mode && MODE_SYS[opts.mode]) ? MODE_SYS[opts.mode]
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
            // Diagnostics only (never shown): what the gate rejected, for the live battery and the
            // feedback triage. Passage text is not stored.
            try { window.__smdLastGate = { q: pkg && pkg.question, nums: gate.nums, drugs: gate.drugs, anchors: grounding.anchors, heads: grounding.passages.map(function (p) { return String(p.heading || "").slice(0, 60); }) }; } catch (e) {}
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
    }, { reentrant: !!(opts && (opts._retried || opts._ungrounded)) });
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
  /* ── ONE GENERATION AT A TIME (owner bug report, 2026-09-11) ────────────────────────────────
   * The native engine is single-threaded and says so: LlamaEngine.swift generateSync throws
   * LlamaError(.busy, "a generation is already running"), and the Android JNI behaves the same.
   * Until the hard Local policy, only the MaiK sheet ever called it, so nothing collided. Now
   * Scribe, Ask MaiK Pro, ICD, assessment, the summary and the ICU advisories all share that one
   * engine, and Scribe refines on a timer (every refineEveryChunks windows AND again on Stop)
   * while the clinician taps other things. The second caller got `busy`, which surfaced as
   * "Could not draft the note from this dictation" with no reason. Reported from a real consult.
   *
   * So every local generation now queues here. A generation cannot be interrupted once it has
   * started (the native call owns the context), but a job the clinician is WATCHING goes ahead of
   * background drafting in the queue, because a 4B model can take tens of seconds per pass.
   *
   * ponytail: a plain FIFO with one priority tier. A real scheduler would need the engine to
   * support pre-emption, which it does not. */
  var _running = false, _waiting = [];
  var JOB_TIMEOUT_MS = 180000;   // a wedged native call must not stall every later one forever
  function serial(fn, opts) {
    opts = opts || {};
    /* RE-ENTRANCY. answer() calls ITSELF for the blank-answer retry (_retried) and the no-coverage
     * ungrounded retry (_ungrounded), from inside its own running job. Queueing that inner call
     * would wait for a job that cannot finish until the inner call returns: a deadlock, and on a
     * phone an answer that never arrives. The engine is already ours at that point, so run inline. */
    if (opts.reentrant && _running) return Promise.resolve().then(fn);
    var job = { fn: fn, bg: !!opts.background };
    job.promise = new Promise(function (resolve, reject) {
      job.resolve = resolve; job.reject = reject;
      // Interactive work jumps ahead of queued background drafting, never ahead of a running job.
      if (!job.bg) {
        var i = 0;
        while (i < _waiting.length && !_waiting[i].bg) i++;
        _waiting.splice(i, 0, job);
      } else _waiting.push(job);
      pump();
    });
    return job.promise;
  }
  function pump() {
    if (_running || !_waiting.length) return;
    var job = _waiting.shift();
    _running = true;
    var done = false, timer = null;
    function finish(ok, v) {
      if (done) return; done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      _running = false;
      if (ok) job.resolve(v); else job.reject(v);
      // Fire-and-forget callers (warm, a background refine whose screen has gone) attach no
      // handler; a queue failure must not become an unhandled rejection that takes down the page.
      try { job.promise.catch(function () {}); } catch (e) {}
      pump();
    }
    try {
      timer = setTimeout(function () {
        // Free the engine so the rest of the queue can run, and say which call gave up.
        try { var L = llama(); if (L && L.cancel) L.cancel(); } catch (e) {}
        finish(false, new Error("on-device generation timed out"));
      }, JOB_TIMEOUT_MS);
      // A pending timeout must never be a reason for the host to stay alive (it kept `node --test`
      // running for the full three minutes, then fired into a finished test). No-op in a WebView.
      if (timer && typeof timer.unref === "function") timer.unref();
    } catch (e) {}
    Promise.resolve().then(job.fn).then(function (r) { finish(true, r); }, function (e) { finish(false, e); });
  }
  /** Queue depth, for tests and diagnostics. */
  function queueState() { return { running: _running, waiting: _waiting.length }; }
  /** Test hook: shorten the per-job timeout (the real one is three minutes). */
  function setJobTimeoutMs(ms) { JOB_TIMEOUT_MS = Math.max(1, Number(ms) || 1); return JOB_TIMEOUT_MS; }

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
    return serial(function () {
      return ensureLoaded(packId).then(function () {
        return L.generate({ prompt: prompt, system: system, nPredict: nPredict,
                            temperature: (opts && typeof opts.temperature === "number") ? opts.temperature : 0.2,
                            stream: false, prefillEmptyThink: noThinkPack(packId) });
      }).then(function (r) {
        if (r && r.error) throw new Error(String(r.error));
        return stripReasoning((r && r.text) || "");
      });
    }, { background: !!(opts && opts.background) });
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
    return serial(function () {
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
    }, { background: !!(opts && opts.background) });
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

  /* ═══════════════════════════════════════════════════════════════════════════════════════════
   * LOCAL TASK LAYER (owner directive, 2026-09-11: "Local AI" is a hard policy; every feature that
   * can reasonably run on-device must, and a missing local implementation must never fall through
   * to the cloud). Before this, the engine had four task functions (answer, webAnswer, vivaJudge,
   * opdSuggest) and maik-engine.js sent everything else to Gemini regardless of the engine chosen.
   *
   * Every prompt below is ported from the server module that owns the same kind, so a caller sees
   * the same JSON shape whichever engine wrote it, and every output passes the same whitelist the
   * server applies (functions/api/ai/_assessment-extract.js, _opd-scribe.js, _surgx-note.js,
   * _icd-suggest.js, _maik-ask.js, and the IMAGING/CORRELATE prompts in [[path]].js). The model is
   * untrusted on both engines; the sanitizer is the contract.
   * ═══════════════════════════════════════════════════════════════════════════════════════════ */

  /* ── persona modes ──
   * TUTOR_SYS is the server's TUTOR_SYS minus the @@MORE@@ marker rule (this engine emits none).
   * SURG_SYS is new: the server's "surgx-mentor" mode only selects a quota bucket. */
  var TUTOR_SYS =
    "You are MaiK, teaching a MEDICAL STUDENT at the bedside inside StewardMD's CliniX module. " +
    "Talk like a good registrar on a ward round: warm, direct, and brief. You are a teacher, not a reference page.\n" +
    "CONTEXT: the student is part-way through a specific lesson; the lesson, the skill and the step they are on are given " +
    "in the question. Answer THEIR question in THAT context.\n" +
    "HOW TO TEACH:\n" +
    "- Keep it SHORT. Two to five sentences. This is a conversation inside a lesson, not an article.\n" +
    "- Answer the question first, then give the ONE mechanism or principle that makes it stick.\n" +
    "- Where it genuinely helps, end with ONE short question back to them. One question, never a quiz, and never when they asked something simple and factual.\n" +
    "- Prefer the concrete and the bedside: what you would see, feel, hear, and what it would mean.\n" +
    "- If they are wrong, say so plainly and kindly, then explain the correction.\n" +
    "- No markdown headings. Plain prose, or at most a few short bullets.\n" +
    "SAFETY - NON-NEGOTIABLE:\n" +
    "1. NEVER give a drug dose, a prescription, a regimen with numbers, or an oxygen prescription, even when asked directly. " +
    "Teach the PRINCIPLE and the drug CLASS, and say the dose is in the lesson's clinician-reviewed treatment section.\n" +
    "2. NEVER give advice about a real, identifiable patient. If the question is about someone they are treating, say so in one line and tell them to ask their supervising clinician.\n" +
    "3. Never invent a citation, a guideline number, a criterion or a threshold. If you are not sure, say so and say what IS established.\n" +
    "4. Do not mention the AI provider, model, retrieval or any internal detail.";
  var SURG_SYS =
    "You are MaiK in Senior Surgeon Mode inside StewardMD's SURGX module: a senior consultant surgeon mentoring a " +
    "surgical trainee through a case. Be direct, precise and Socratic: challenge their plan, ask what they would do next, " +
    "and correct errors plainly. Prefer operative and perioperative specifics: indications, contraindications, anatomy, " +
    "steps, complications and their recognition, when to convert or call for help.\n" +
    "RULES:\n" +
    "- Keep each turn short (three to six sentences). End most turns with ONE pointed question.\n" +
    "- Never invent a guideline number, trial result or threshold. Say when something is institution-dependent.\n" +
    "- Doses and regimens are the clinician's responsibility: name the drug class and principle, and point to the local protocol for numbers.\n" +
    "- Never give advice about a real, identifiable patient; this is teaching and decision support, not care.\n" +
    "- Do not mention the AI provider, model or any internal detail.";
  var MODE_SYS = { "clinix-tutor": TUTOR_SYS, "surgx-mentor": SURG_SYS };

  /* ── shared guards (deterministic, no model) ── */
  var INDIC_RE = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
  function stripIndic(s) {
    return String(s || "").replace(/[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/g, "")
      .replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:)\]])/g, "$1")
      .replace(/[\s,;:\-]+$/, "").replace(/^[\s,;:\-]+/, "").trim();
  }
  function tidy(s, max) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max || 2000); }
  function strList(a, max, each) { return (Array.isArray(a) ? a : []).map(function (x) { return tidy(x, each || 240); }).filter(Boolean).slice(0, max || 12); }
  /** Every digit-string in `text`, commas stripped ("1,500" -> "1500"). surgx-model.js numbersIn(),
   * with word boundaries so the digit inside a unit name (SpO2, HbA1c, FiO2) is not a clinical number.
   * Same rule as test/run-local-translate-eval.mjs, so the guard and the eval agree. */
  function numbersIn(text, loose) {
    // `loose` (the SOURCE side) takes every digit run, so "x3 days", "T101F", "BP120/80" all count
    // as said. The model side keeps the boundary (and accepts an ordinal suffix) so a fabricated
    // "3rd dose" is still caught while "SpO2" contributes nothing.
    var out = [], m, s = String(text || "");
    var re = loose ? /\d+(?:[.,]\d+)*/g : /\b\d+(?:[.,]\d+)*(?=\b|(?:st|nd|rd|th)\b)/g;
    while ((m = re.exec(s)) !== null) out.push(m[0].replace(/,/g, ""));
    return out;
  }
  /** "05" and "5", "3.0" and "3", ".5" and "0.5" are the same number. Review found zero-padded
   * dates (fmtClinicDate) killing every summary line the model wrote a date into. */
  function canonNum(n) { var f = parseFloat(String(n).replace(/,/g, "")); return isNaN(f) ? String(n) : String(f); }
  function numberPool(source) { var p = {}; numbersIn(source, true).forEach(function (n) { p[canonNum(n)] = 1; }); return p; }
  /** A number the model states that the source never did is a fabricated clinical fact. Drops the
   * offending LINE (or list item) rather than the whole answer; returns { text|items, dropped }. */
  function dropUnsupportedNumbers(out, source) {
    var pool = numberPool(source), dropped = 0;
    function okLine(l) { var ns = numbersIn(l); for (var i = 0; i < ns.length; i++) if (!pool[canonNum(ns[i])]) return false; return true; }
    if (Array.isArray(out)) { var kept = out.filter(function (l) { var k = okLine(l); if (!k) dropped++; return k; }); return { items: kept, dropped: dropped }; }
    var lines = String(out || "").split("\n").filter(function (l) { var k = okLine(l); if (!k) dropped++; return k; });
    return { text: lines.join("\n"), dropped: dropped };
  }

  /* ── LONG INPUT (Phase 6) ──
   * Every pack loads at 4096 tokens (llama_jni.cpp keeps n_ctx deliberately small), whatever the
   * model card says. A whole patient timeline or a 30-minute dictation does not fit, and silently
   * truncating it would drop the clinically important tail. So: split on entry, then sentence,
   * boundaries into windows that fit beside the system prompt and the output budget; process each;
   * carry the intermediate result forward. chars/3.6 is a deliberately pessimistic token estimate
   * for clinical English on these tokenizers (measured 3.5 to 4), so windows err on the small side. */
  function estTokens(s) {
    // Indic script tokenises at roughly one token per character on Qwen3 (worse on some), and a
    // prompt over n_ctx is a hard generation failure, so non-ASCII counts at 1.2 per character.
    s = String(s || ""); var non = (s.match(/[^\x00-\x7f]/g) || []).length;
    return Math.ceil((s.length - non) / 3.6 + non * 1.2);
  }
  function windowBudget(packId, systemText, nPredict) {
    var pk = (models() && models().PACKS[packId]) || {}; var ctx = pk.nCtx || 4096;
    return Math.max(400, ctx - estTokens(systemText) - (nPredict || 512) - 160);   // 160: chat template + margin
  }
  function splitWindows(text, tokenBudget) {
    var parts = String(text || "").split(/\n(?=\S)/), out = [], cur = "";
    for (var i = 0; i < parts.length; i++) {
      var units = estTokens(parts[i]) > tokenBudget ? (parts[i].match(/[^.!?\n]+[.!?]*\s*/g) || [parts[i]]) : [parts[i]];
      for (var j = 0; j < units.length; j++) {
        var u = units[j];
        if (estTokens(u) > tokenBudget) {   // one sentence longer than a window: hard-cut, never silently drop
          for (var k = 0; k < u.length; k += tokenBudget * 3) { if (cur) { out.push(cur); cur = ""; } out.push(u.slice(k, k + tokenBudget * 3)); }
          continue;
        }
        if (cur && estTokens(cur + "\n" + u) > tokenBudget) { out.push(cur); cur = u; }
        else cur = cur ? cur + (j ? " " : "\n") + u : u;
      }
    }
    if (cur) out.push(cur);
    return out;
  }
  /** Run `fn(window, index, total)` over the windows in order (one model at a time), collecting results.
   * If the runtime rejects a window as too long for the context (the token estimate is an estimate),
   * that window is split in half and both halves run; nothing is dropped. */
  var TOO_LONG_RE = /n_ctx|too long|GENERATION_FAILURE|prompt.*>=|exceeds/i;
  function eachWindow(wins, fn) {
    var results = [], chain = Promise.resolve();
    wins.forEach(function (w, i) {
      chain = chain.then(function () {
        return Promise.resolve().then(function () { return fn(w, i, wins.length); }).then(function (r) { results.push(r); }, function (e) {
          var tok = estTokens(w);
          if (!TOO_LONG_RE.test(String((e && e.message) || e)) || tok < 200) throw e;
          return eachWindow(splitWindows(w, Math.ceil(tok / 2)), fn).then(function (rs) { rs.forEach(function (r) { results.push(r); }); });
        });
      });
    });
    return chain.then(function () { return results; });
  }

  /* ── patient timeline summary (was a raw fetch("/summary") in opd-emr.js; no local path at all) ── */
  var SUMMARY_SYS =
    "You are MaiK, a clinical assistant. Summarise this patient's longitudinal record for the treating doctor, using " +
    "ONLY the entries provided. Do NOT invent any finding, diagnosis, drug, dose or date. Be concise. Structure with " +
    "short headed lines: Problems, Course, Current medications, Pending, Red flags. Keep every date, figure, drug and " +
    "dose exactly as written. No preamble.";
  function summarize(text, opts, origSrc) {
    var src = String(text || "").trim();
    if (!src) return Promise.resolve({ error: "no-text" });
    // The number guard always checks against the ORIGINAL record, never against an intermediate
    // summary (which is model output and could carry an invented figure into the pool).
    var orig = origSrc || src;
    var packId = (opts && opts.pack) || currentPack();
    var budget = windowBudget(packId, SUMMARY_SYS, 400);
    var wins = splitWindows(src, budget);
    var droppedTotal = 0;
    return eachWindow(wins, function (w, i, n) {
      var prompt = (n > 1 ? "PART " + (i + 1) + " of " + n + " of the record.\n" : "") + "=== ENTRIES ===\n" + w;
      return generateText(prompt, SUMMARY_SYS, 400, opts).then(function (t) { var g = dropUnsupportedNumbers(t, orig); droppedTotal += g.dropped; return g.text; });
    }).then(function (parts) {
      function finish(t, windows) {
        var g = dropUnsupportedNumbers(t, orig);
        // Plain text: opd-emr.js renders this escaped, so markdown emphasis would show as asterisks.
        return { text: g.text, mode: "summary", engine: "local", windows: windows, droppedLines: g.dropped + droppedTotal };
      }
      if (parts.length === 1) return finish(parts[0], 1);
      var joined = parts.map(function (t, i) { return "[Part " + (i + 1) + "]\n" + t; }).join("\n\n");
      var prompt = "These are summaries of consecutive parts of ONE patient's record. Merge them into a single concise " +
        "summary, keeping every dated finding, diagnosis, drug and dose exactly as written. Do NOT invent anything.\n\n" + joined;
      if (estTokens(prompt) > budget) {   // still too long: reduce the reductions, same original source
        return summarize(joined, opts, orig).then(function (r) { r.windows = wins.length; return r; });
      }
      return generateText(prompt, SUMMARY_SYS, 500, opts).then(function (t) { return finish(t, wins.length); });
    });
  }

  /* ── assessment extraction (kind "assessment"): _assessment-extract.js ── */
  var ASSESSMENT_FIELDS = ["cc", "presentHx", "pastHx", "provisionalDx", "managementPlan"];
  var ASSESS_SYS =
    "You are transcribing a clinician's spoken consultation into an initial-assessment note. " +
    "OUTPUT LANGUAGE - CRITICAL: write every value in clear clinical ENGLISH. The transcript may be Telugu, Hindi or " +
    "code-switched Indian English; translate the clinical meaning to English and never output Telugu or Devanagari script. " +
    "Keep drug names, doses, units, numbers and standard abbreviations exact.\n" +
    "Return ONLY JSON containing any of these keys, each a short plain-text string (in English): " +
    "{\"cc\": chief complaints and their duration, \"presentHx\": history of present illness, \"pastHx\": past medical / surgical history, " +
    "\"provisionalDx\": the clinician's explicitly stated provisional diagnosis, \"managementPlan\": the clinician's explicitly stated plan}\n" +
    "STRICT RULES:\n" +
    "- Use ONLY what is EXPLICITLY stated. Never infer, complete, summarise beyond what was said, or invent.\n" +
    "- NEVER generate a diagnosis, symptom, finding, drug, dose or investigation that was not spoken. Include provisionalDx and " +
    "managementPlan ONLY if the clinician clearly stated their own assessment or plan; otherwise OMIT those keys.\n" +
    "- Do NOT put vitals or physical-examination findings here (captured separately).\n" +
    "- Omit any key not clearly stated. No prose outside the JSON.";
  function sanitizeAssessment(parsed) {
    var out = {};
    if (!parsed || typeof parsed !== "object") return out;
    ASSESSMENT_FIELDS.forEach(function (k) {
      var v = parsed[k]; if (typeof v !== "string" && typeof v !== "number") return;
      var s = stripIndic(tidy(v, 2000)); if (s) out[k] = s;
    });
    return out;
  }
  /* Accumulate narrative across windows/refines without duplicating it. Substring containment
   * missed every rewording ("fever 3 days" vs "fever for 3 days") and grew the field forever
   * (review); token containment (four fifths of the new text's words already present) catches
   * those, and the field is capped like the server's. */
  function words(s) { return (String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []); }
  function mostlyContained(a, b) {
    var wb = words(b); if (!wb.length) return true;
    var have = {}; words(a).forEach(function (w) { have[w] = 1; });
    var hit = 0; wb.forEach(function (w) { if (have[w]) hit++; });
    return hit / wb.length >= 0.8;
  }
  function mergeText(a, b) { a = a || ""; b = b || ""; if (!a) return b; if (!b || mostlyContained(a, b)) return a; return (a + "; " + b).slice(0, 2000); }
  function assess(transcript, opts) {
    var t = String(transcript == null ? "" : transcript).trim();
    if (!t) return Promise.resolve({ error: "no-text" });
    var packId = (opts && opts.pack) || currentPack();
    var wins = splitWindows(t, windowBudget(packId, ASSESS_SYS, 400));
    // Ambient, like Scribe: queued behind anything the clinician is waiting on.
    var bg = { background: true, pack: packId };
    if (opts) { for (var ak in opts) if (Object.prototype.hasOwnProperty.call(opts, ak) && !(ak in bg)) bg[ak] = opts[ak]; }
    return eachWindow(wins, function (w) {
      return generateJSON("=== TRANSCRIPT ===\n" + w, ASSESS_SYS, 400, bg).then(sanitizeAssessment, function (e) { if (e && e.message === "parse") return {}; throw e; });
    }).then(function (parts) {
      var fields = {};
      // Narrative accumulates; the clinician's stated diagnosis and plan are single statements, so
      // the latest window that states one wins (never "viral fever; dengue" as one "stated" dx).
      parts.forEach(function (p) { ASSESSMENT_FIELDS.forEach(function (k) { if (p[k]) fields[k] = (k === "provisionalDx" || k === "managementPlan") ? p[k] : mergeText(fields[k], p[k]); }); });
      // The same guard the server leaves to the app: no figure the clinician did not say.
      ASSESSMENT_FIELDS.forEach(function (k) { if (fields[k] && !dropUnsupportedNumbers(fields[k], t).text) delete fields[k]; });
      return { kind: "assessment", fields: fields, mode: "assessment", engine: "local", windows: wins.length };
    });
  }

  /* ── OPD Scribe (kind "opd-scribe"): _opd-scribe.js, as a ROLLING WINDOW with running state ──
   * The cloud re-reads the whole transcript on every refine. That cannot fit here after a few
   * minutes of dictation, so the engine keeps what it has already captured and asks the model
   * only about the text it has not seen (plus a short overlap), merging deterministically. */
  var EMR_FIELD_KEYS = ["cc", "presentHx", "pastHx", "comorbidsNote", "dm", "htn", "cardiac", "asthma", "tb", "thyroid", "epilepsy",
    "habits", "alcohol", "smoking", "recDrug", "tobacco"];
  var YES_NO_KEYS = { dm: 1, htn: 1, cardiac: 1, asthma: 1, tb: 1, thyroid: 1, epilepsy: 1, habits: 1, alcohol: 1, smoking: 1, recDrug: 1, tobacco: 1 };
  var SCRIBE_SYS =
    "You are an OPD scribe turning a doctor-patient consultation transcript into a structured note. " +
    "Return ONLY JSON: {\"en\":\"\", \"emrFields\":{...}, \"suggestions\":{\"provisionalDx\":\"\",\"ddx\":[],\"investigations\":[]}}.\n" +
    "\"en\" = a FAITHFUL English translation of the NEW transcript text, keeping ALL spoken vitals/numbers/units exactly; do not summarise it.\n" +
    "OUTPUT LANGUAGE - CRITICAL: every emrFields value and every suggestion in clear clinical ENGLISH; never Telugu or Devanagari script. " +
    "Keep drug names, doses, units, numbers and abbreviations (BP, IV, BD, OD) exactly as stated.\n" +
    "ASR NOISE: the transcript is on-device speech recognition of possibly code-switched speech. De-duplicate repeats, drop filler, " +
    "normalise ONLY an unambiguous mis-recognition. If a garbled word could be more than one drug or finding, keep it verbatim or omit it. NEVER guess a dose.\n" +
    "emrFields keys allowed: cc, presentHx, pastHx, comorbidsNote (+ dm/htn/cardiac/asthma/tb/thyroid/epilepsy as 'Yes'/'No' only if clearly stated). " +
    "Habits: alcohol, smoking, recDrug, tobacco as 'Yes' only when explicitly affirmed, and habits='Yes' if any is; add top-level \"alcoholDetail\" with the exact amount and type stated.\n" +
    "If ALREADY CAPTURED fields are given, output ONLY additions or corrections from the NEW text; do not repeat captured content.\n" +
    "RULES: use ONLY what is explicitly said; NEVER invent a diagnosis, symptom, finding, drug, dose or investigation. provisionalDx ONLY if the clinician stated it. " +
    "ddx = a short reasonable differential FOR THE DOCTOR TO CONSIDER. investigations = tests a clinician would reasonably consider. No prose outside JSON.";
  function sanitizeScribe(parsed) {
    var out = { emrFields: {}, suggestions: { ddx: [], investigations: [] } };
    if (!parsed || typeof parsed !== "object") return out;
    if (typeof parsed.en === "string" && parsed.en.trim()) out.en = tidy(parsed.en, 6000);
    if (typeof parsed.alcoholDetail === "string" && parsed.alcoholDetail.trim()) out.alcoholDetail = tidy(parsed.alcoholDetail, 200);
    var ef = parsed.emrFields || {};
    EMR_FIELD_KEYS.forEach(function (k) {
      var v = ef[k]; if (typeof v !== "string" && typeof v !== "number") return;
      var s = stripIndic(tidy(v, 2000)); if (!s) return;
      if (YES_NO_KEYS[k]) { if (/^yes$/i.test(s)) out.emrFields[k] = "Yes"; else if (/^no$/i.test(s)) out.emrFields[k] = "No"; return; }
      out.emrFields[k] = s;
    });
    var sg = parsed.suggestions || {};
    if (typeof sg.provisionalDx === "string" && stripIndic(sg.provisionalDx)) out.suggestions.provisionalDx = stripIndic(sg.provisionalDx).slice(0, 300);
    var clean = function (a) { return (Array.isArray(a) ? a : []).map(function (x) { return stripIndic(tidy(x, 200)); }).filter(Boolean).slice(0, 12); };
    out.suggestions.ddx = clean(sg.ddx); out.suggestions.investigations = clean(sg.investigations);
    return out;
  }
  var SCRIBE_OVERLAP = 400;   // chars re-shown so a sentence split across two refines is not lost
  var _scribe = { prefix: "", covered: 0, acc: null };
  // A refine that has been overtaken by a newer transcript must not spend a generation drafting
  // from stale text: on a 4B model each pass costs tens of seconds, so a long consult would queue
  // one refine per window and never catch up.
  var _scribeSeq = 0;
  function scribeReset() { _scribe = { prefix: "", covered: 0, acc: null }; _scribeSeq++; }
  function unionList(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (x) { var k = String(x).toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(x); } });
    return out.slice(0, 12);
  }
  function scribeMerge(acc, nu) {
    acc = acc || { en: "", emrFields: {}, suggestions: { ddx: [], investigations: [] } };
    var out = { en: acc.en, emrFields: {}, suggestions: { ddx: [], investigations: [] }, alcoholDetail: acc.alcoholDetail };
    for (var k in acc.emrFields) if (Object.prototype.hasOwnProperty.call(acc.emrFields, k)) out.emrFields[k] = acc.emrFields[k];
    EMR_FIELD_KEYS.forEach(function (k) {
      var v = nu.emrFields[k]; if (!v) return;
      // Narrative fields accumulate. A yes/no: "Yes" is a positive history the patient stated and a
      // later window that never mentions the condition must not flip it to "No" (a small model
      // re-emitting every key is exactly how that happened in review). "No" -> "Yes" is accepted.
      if (YES_NO_KEYS[k]) { if (v === "No" && out.emrFields[k] === "Yes") return; out.emrFields[k] = v; return; }
      out.emrFields[k] = mergeText(out.emrFields[k], v);
    });
    if (nu.en && !mostlyContained(out.en, nu.en)) out.en = (out.en ? out.en + " " + nu.en : nu.en).slice(0, 6000);
    if (nu.alcoholDetail) out.alcoholDetail = nu.alcoholDetail;
    out.suggestions.provisionalDx = nu.suggestions.provisionalDx || acc.suggestions.provisionalDx;
    out.suggestions.ddx = unionList(acc.suggestions.ddx, nu.suggestions.ddx);
    out.suggestions.investigations = unionList(acc.suggestions.investigations, nu.suggestions.investigations);
    return out;
  }
  function scribeFill(transcript, opts) {
    var t = String(transcript == null ? "" : transcript);
    if (!t.trim()) return Promise.resolve({ error: "no-text" });
    // Continue the rolling state only if this transcript extends the one we have covered; a new
    // consult (or an edited transcript) starts clean.
    if (!_scribe.acc || t.indexOf(_scribe.prefix) !== 0) scribeReset();
    var from = Math.max(0, _scribe.covered - SCRIBE_OVERLAP);
    var fresh = t.slice(from);
    if (!fresh.trim() && _scribe.acc) return Promise.resolve(finishScribe(_scribe.acc, 0));
    var packId = (opts && opts.pack) || currentPack();
    var captured = _scribe.acc ? "=== ALREADY CAPTURED ===\n" + JSON.stringify({ emrFields: _scribe.acc.emrFields, suggestions: _scribe.acc.suggestions }).slice(0, 1500) + "\n\n" : "";
    var budget = windowBudget(packId, SCRIBE_SYS + captured, 600);
    var wins = splitWindows(fresh, budget);
    var acc = _scribe.acc;
    var mySeq = ++_scribeSeq;
    var bg = { background: true, pack: packId };
    if (opts) { for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k) && !(k in bg)) bg[k] = opts[k]; }
    // A model that answered in prose is not a model that captured nothing: count the misses so a
    // run that produced NO structure can say so instead of leaving the form silently empty (owner
    // report, 2026-09-11: "no autopopulation of drafting", with no message either way).
    var unparsed = 0, ran = 0;
    return eachWindow(wins, function (w) {
      if (mySeq !== _scribeSeq) return null;   // a newer refine arrived while this one waited its turn
      ran++;
      return generateJSON(captured + "=== NEW TRANSCRIPT ===\n" + w, SCRIBE_SYS, 600, bg)
        .then(sanitizeScribe, function (e) { if (e && e.message === "parse") { unparsed++; return sanitizeScribe(null); } throw e; })
        .then(function (nu) { acc = scribeMerge(acc, nu); });
    }).then(function () {
      if (ran && unparsed === ran && !hasScribeContent(acc)) {
        return { error: "draft-unparsed", unparsed: unparsed, engine: "local", mode: "opd-scribe",
                 message: "The on-device model answered in prose instead of a structured note, so nothing could be filled in. The transcript is kept. A larger pack (MAiK MxCore or Neural) is better at this, or use MaiK Cloud." };
      }
      return null;
    }).then(function (bail) {
      if (bail) return bail;
      return afterScribe();
    });
    function afterScribe() {
      // Superseded: leave the rolling state to the newer refine and report what we already have,
      // so the caller shows the fields captured so far rather than an error.
      if (mySeq !== _scribeSeq) return finishScribe(_scribe.acc || acc || { en: "", emrFields: {}, suggestions: { ddx: [], investigations: [] } }, 0);
      _scribe = { prefix: t, covered: t.length, acc: acc };
      return finishScribe(acc, wins.length);
    }
  }
  function finishScribe(acc, windows) {
    return { kind: "opd-scribe", en: acc.en, emrFields: acc.emrFields, suggestions: acc.suggestions, alcoholDetail: acc.alcoholDetail, mode: "opd-scribe", engine: "local", windows: windows };
  }
  /** Did this pass actually capture anything the form can use? */
  function hasScribeContent(acc) {
    if (!acc) return false;
    if (acc.en) return true;
    if (acc.emrFields && Object.keys(acc.emrFields).length) return true;
    var s = acc.suggestions || {};
    return !!(s.provisionalDx || (s.ddx && s.ddx.length) || (s.investigations && s.investigations.length));
  }

  /* ── SURGX note structuring (kind "surgx-note"): _surgx-note.js ── */
  var NEVER_AI_FILLABLE = ["counts", "specimens", "implants", "consent", "meds", "side", "cultureSent",
    "patientRef", "age", "sex", "date", "admitDate", "dischargeDate", "surgeon", "assistants", "anaesthetist", "doctor"];
  function surgxNoteSys(fieldList, noteType) {
    return "You are structuring a surgeon's own dictation into a " + tidy(noteType || "operative", 24) + " note. " +
      "Return ONLY JSON: {\"fields\":{\"<key>\":\"<text>\"}}. No prose outside the JSON.\n" +
      "YOUR ONLY JOB is to decide which field each thing the surgeon SAID belongs in, and to tidy the wording into clinical " +
      "English. You are a typist with anatomy knowledge, not a clinician.\n" +
      "ABSOLUTE RULES - a breach is a patient-safety event:\n" +
      "1. NEVER invent, infer, estimate, complete or 'make consistent' any clinical fact.\n" +
      "2. If the surgeon did not say it, OMIT THE FIELD ENTIRELY. Do NOT write 'nil', 'none', 'routine' or 'not stated' unless said.\n" +
      "3. NEVER write a number that is not spoken. No unit conversion, rounding, totals or inferred sizes.\n" +
      "4. Do not add a normal finding or a usual step because it is usually present or performed.\n" +
      "5. Use only these field keys; anything else is discarded:\n" + fieldList + "\n" +
      "6. Preserve the surgeon's own clinical terms, drug names, laterality and anatomical detail exactly.\n" +
      "DICTATION NOISE: de-duplicate repeats and drop filler. Normalise ONLY an unambiguous mis-recognition; if a garbled word " +
      "could be more than one structure, drug or instrument, keep it VERBATIM or omit it. Never guess a number.";
  }
  function sanitizeSurgxNote(parsed, allowedKeys) {
    var out = { fields: {}, dropped: [] }, allow = {};
    (Array.isArray(allowedKeys) ? allowedKeys : []).slice(0, 40).forEach(function (k) { var key = (k && typeof k === "object") ? String(k.k || "") : String(k || ""); if (key) allow[key] = 1; });
    NEVER_AI_FILLABLE.forEach(function (k) { delete allow[k]; });
    if (!parsed || typeof parsed !== "object") return out;
    var src = (parsed.fields && typeof parsed.fields === "object") ? parsed.fields : parsed;
    Object.keys(src).forEach(function (k) {
      if (!allow[k]) { out.dropped.push(k); return; }
      var v = src[k]; if (typeof v !== "string" && typeof v !== "number") { out.dropped.push(k); return; }
      var s = tidy(v, 4000); if (!s) { out.dropped.push(k); return; }
      if (/^(n\/?a|none stated|not stated|not mentioned|unknown|unspecified|-{1,3})$/i.test(s)) { out.dropped.push(k); return; }
      out.fields[k] = s;
    });
    return out;
  }
  function noteStructure(transcript, allowedFields, noteType, opts) {
    var t = String(transcript == null ? "" : transcript).trim();
    if (!t) return Promise.resolve({ error: "no-text" });
    var keys = (Array.isArray(allowedFields) ? allowedFields : []).map(function (f) { return (f && typeof f === "object") ? f : { k: String(f), label: String(f) }; }).slice(0, 40);
    if (!keys.length) return Promise.resolve({ error: "no allowedFields" });
    var fieldList = keys.map(function (f) { return "  - " + f.k + ": " + (f.label || f.k); }).join("\n");
    var sys = surgxNoteSys(fieldList, noteType);
    var packId = (opts && opts.pack) || currentPack();
    var wins = splitWindows(t, windowBudget(packId, sys, 700));
    var fields = {}, dropped = [];
    return eachWindow(wins, function (w) {
      return generateJSON("=== TRANSCRIPT ===\n" + w, sys, 700, opts)
        .then(function (p) { return sanitizeSurgxNote(p, keys); }, function (e) { if (e && e.message === "parse") return { fields: {}, dropped: [] }; throw e; })
        .then(function (c) {
          Object.keys(c.fields).forEach(function (k) { fields[k] = fields[k] ? fields[k] + " " + c.fields[k] : c.fields[k]; });
          c.dropped.forEach(function (k) { if (dropped.indexOf(k) < 0) dropped.push(k); });
        });
    }).then(function () {
      // surgx-model.js applyExtraction() runs numericGuard again on the client; this is the same
      // rule applied one step earlier so a fabricated number never leaves the engine at all.
      Object.keys(fields).forEach(function (k) { if (!dropUnsupportedNumbers(fields[k], t).text) { delete fields[k]; if (dropped.indexOf(k) < 0) dropped.push(k); } });
      return { kind: "surgx-note", fields: fields, dropped: dropped, mode: "surgx-note", engine: "local", windows: wins.length };
    });
  }

  /* ── ICD ranking (kind "icd-suggest"): _icd-suggest.js. The model ONLY orders candidates the
   * caller retrieved from the real ICD table; an id it did not copy exactly is dropped, never
   * corrected. No candidates, no suggestions: this engine never generates a code. ── */
  var ICD_SYS =
    "You are a clinical coder helping a doctor attach ICD-10/ICD-11 codes to a diagnosis. You are given the doctor's text " +
    "and a candidate list of REAL codes already retrieved from the ICD database. Select ONLY from the candidate list; never " +
    "invent, alter or guess a code or id.\n" +
    "Return ONLY JSON: {\"suggestions\":[{\"id\":\"\",\"confidence\":\"high|medium|low\",\"why\":\"\"}]}.\n" +
    "RULES: id MUST be copied EXACTLY from a candidate's id. Prefer one good ICD-10 AND one good ICD-11 match when both fit. " +
    "Order by relevance, most likely first, max 6. why = one short clinical justification. If nothing fits, return " +
    "{\"suggestions\":[]}. Output ONLY the JSON.";
  function sanitizeIcd(parsed, candidates) {
    var byId = {}; (candidates || []).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var out = [], seen = {}, list = (parsed && Array.isArray(parsed.suggestions)) ? parsed.suggestions : [];
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var s = list[i]; if (!s || typeof s !== "object") continue;
      var id = String(s.id || ""), cand = byId[id]; if (!cand || seen[id]) continue; seen[id] = 1;
      var conf = ["high", "medium", "low"].indexOf(String(s.confidence || "").toLowerCase()) >= 0 ? String(s.confidence).toLowerCase() : "medium";
      out.push({ id: cand.id, system: cand.system, code: cand.code, title: cand.title, confidence: conf, why: tidy(s.why, 200) });
    }
    return { suggestions: out };
  }
  function icdRank(text, candidates, opts) {
    var t = String(text == null ? "" : text).slice(0, 4000).trim();
    var cands = (Array.isArray(candidates) ? candidates : []).filter(function (c) { return c && c.id && c.code; }).slice(0, 30);
    if (!t) return Promise.resolve({ error: "no-text" });
    if (!cands.length) return Promise.resolve({ kind: "icd-suggest", suggestions: [], mode: "icd-suggest", engine: "local", candidates: 0 });
    var rows = cands.map(function (c) { return c.id + " | " + c.system + " | " + c.code + " | " + c.title; }).join("\n");
    var prompt = "=== DOCTOR'S TEXT ===\n" + t + "\n\n=== CANDIDATE CODES (id | system | code | title) ===\n" + rows;
    return generateJSON(prompt, ICD_SYS, 400, opts).then(function (p) {
      var r = sanitizeIcd(p, cands); r.kind = "icd-suggest"; r.mode = "icd-suggest"; r.engine = "local"; r.candidates = cands.length; return r;
    }, parseFailure);
  }

  /* ── Dx My Patient voice extract (kind "reasoning"): catalog-only findings ── */
  var REASON_SYS =
    "You are extracting structured clinical findings from a doctor's spoken description of ONE patient. Below is a CONTROLLED " +
    "FINDING CATALOG (key = human label). Map the transcript to findings using ONLY keys that appear in this catalog; NEVER invent, " +
    "guess or modify a key. Return ONLY JSON: {\"findings\":[\"<exact catalog key>\"], \"patient\":{\"age\":<number|null>,\"sex\":\"male\"|\"female\"|null}, " +
    "\"unmatched\":[\"<short phrase you heard but could not map>\"]}. Include a finding ONLY if the transcript clearly asserts it is PRESENT; " +
    "never one the clinician denies. No prose outside the JSON.";
  function sanitizeReasoning(parsed, catalog) {
    var valid = {}; (catalog || []).forEach(function (c) { if (c && c.key) valid[c.key] = 1; });
    var seen = {}, findings = [];
    (parsed && Array.isArray(parsed.findings) ? parsed.findings : []).forEach(function (k) { if (valid[k] && !seen[k]) { seen[k] = 1; findings.push(k); } });
    var unmatched = (parsed && Array.isArray(parsed.unmatched) ? parsed.unmatched : []).map(function (s) { return String(s).slice(0, 80); }).filter(Boolean).slice(0, 20);
    var patient;
    if (parsed && parsed.patient && typeof parsed.patient === "object") {
      var age = Number(parsed.patient.age), sex = String(parsed.patient.sex || "").toLowerCase();
      patient = {}; if (!isNaN(age) && age > 0 && age < 130) patient.age = age; if (sex === "male" || sex === "female") patient.sex = sex;
      if (!Object.keys(patient).length) patient = undefined;
    }
    return { findings: findings, patient: patient, unmatched: unmatched };
  }
  function reasoningExtract(transcript, catalog, opts) {
    var t = String(transcript == null ? "" : transcript).slice(0, 8000).trim();
    if (!t) return Promise.resolve({ error: "no-text" });
    var cat = (Array.isArray(catalog) ? catalog : []).filter(function (c) { return c && c.key; }).slice(0, 500);
    var packId = (opts && opts.pack) || currentPack();
    var budget = windowBudget(packId, REASON_SYS, 300);
    // The catalog can be larger than the window on its own (500 keys). Slice it so every pass sees
    // the whole transcript and a part of the catalog, and union the keys found.
    var tTok = estTokens(t), catBudget = Math.max(150, budget - tTok - 40);
    var slices = [], cur = [], curTok = 0;
    cat.forEach(function (c) { var line = c.key + " = " + (c.label || c.key); var n = estTokens(line) + 1; if (cur.length && curTok + n > catBudget) { slices.push(cur); cur = []; curTok = 0; } cur.push(line); curTok += n; });
    if (cur.length) slices.push(cur);
    if (!slices.length) slices.push([]);
    var findings = [], seen = {}, unmatched = [], patient;
    return eachWindow(slices, function (lines) {
      var prompt = "=== FINDING CATALOG (key = label) ===\n" + lines.join("\n") + "\n\n=== TRANSCRIPT ===\n" + t;
      return generateJSON(prompt, REASON_SYS, 300, opts).then(function (p) { return sanitizeReasoning(p, cat); }, function (e) { if (e && e.message === "parse") return sanitizeReasoning(null, cat); throw e; })
        .then(function (r) {
          r.findings.forEach(function (k) { if (!seen[k]) { seen[k] = 1; findings.push(k); } });
          r.unmatched.forEach(function (u) { if (unmatched.indexOf(u) < 0 && unmatched.length < 20) unmatched.push(u); });
          if (r.patient && !patient) patient = r.patient;
        });
    }).then(function () {
      // A phrase "unmatched" in one slice may have matched in another.
      var lower = {}; cat.forEach(function (c) { lower[String(c.label || c.key).toLowerCase()] = c.key; });
      unmatched = unmatched.filter(function (u) { var k = lower[u.toLowerCase()]; return !(k && seen[k]); });
      return { findings: findings, patient: patient, unmatched: unmatched, mode: "reasoning", engine: "local", passes: slices.length };
    });
  }

  /* ── MaiK Ask (kinds "maik-ask-next" / "maik-ask-extract"): _maik-ask.js ── */
  var ALLOWED_ACTIONS = { ask: 1, clarify: 1, finish: 1, alert_doctor: 1 }, ALLOWED_PRIORITY = { high: 1, normal: 1, low: 1 };
  function maikNextSys(ctx) {
    var known = (ctx.known && typeof ctx.known === "object") ? ctx.known : {};
    var lang = ctx.language ? String(ctx.language) : "en";
    return "You are MaiK, helping a doctor take a patient's history. You are NOT a doctor: you do NOT diagnose, prescribe, advise, " +
      "reassure, order tests, or tell the patient anything about their condition. You ONLY ask ONE short, natural history question.\n" +
      "Return ONLY JSON: {\"action\":\"ask\",\"question\":\"\",\"language\":\"\",\"targetField\":\"\",\"priority\":\"\",\"reason\":\"\"}.\n" +
      "action MUST be one of: ask | clarify | finish | alert_doctor.\n" +
      "Ask about EXACTLY this one missing piece of history: \"" + tidy(ctx.targetHint || ctx.targetField, 200) + "\" (targetField=\"" + tidy(ctx.targetField, 60) + "\"). ONE question only.\n" +
      "Complaint: " + tidy(ctx.complaint || ctx.pathwayLabel, 200) + ".\n" +
      "Already known, do NOT ask again: " + JSON.stringify(known).slice(0, 600) + ".\n" +
      "LANGUAGE - MANDATORY: ask in \"" + lang + "\" (en = plain English; te/te-en = Telugu or Telugu-English; hi/hi-en = Hindi or Hinglish), " +
      "phrased naturally the way an Indian clinician speaks to a patient.\n" +
      "Keep targetField = \"" + tidy(ctx.targetField, 60) + "\". Set language to the code you used. priority = high | normal | low. reason = one short phrase.";
  }
  function sanitizeMaikNext(parsed) {
    var out = { action: "finish", question: "", language: "", targetField: "", priority: "normal", reason: "" };
    if (!parsed || typeof parsed !== "object" || !ALLOWED_ACTIONS[parsed.action]) return out;
    out.action = parsed.action;
    if (typeof parsed.question === "string") out.question = tidy(parsed.question, 400);
    if (typeof parsed.language === "string") out.language = parsed.language.replace(/[^a-z\-]/gi, "").slice(0, 10);
    if (typeof parsed.targetField === "string") out.targetField = parsed.targetField.slice(0, 60);
    if (ALLOWED_PRIORITY[parsed.priority]) out.priority = parsed.priority;
    if (typeof parsed.reason === "string") out.reason = tidy(parsed.reason, 200);
    if ((out.action === "ask" || out.action === "clarify") && !out.question) out.action = "finish";
    return out;
  }
  function maikNext(ctx, opts) {
    ctx = (ctx && typeof ctx === "object") ? ctx : {};
    return generateJSON("Produce the next question now.", maikNextSys(ctx), 200, opts).then(function (p) {
      var r = sanitizeMaikNext(p); r.kind = "maik-ask-next"; r.mode = "maik-ask-next"; r.engine = "local"; return r;
    }, parseFailure);
  }
  function maikExtractSys(ctx) {
    var allowed = Array.isArray(ctx.allowedFields) ? ctx.allowedFields : [];
    return "You are MaiK, extracting ONLY explicitly-stated history from a patient's spoken answer. You do NOT infer, diagnose, or add " +
      "anything the patient did not clearly say.\nThe patient was just asked about: \"" + tidy(ctx.targetHint || ctx.targetField, 200) + "\".\n" +
      "Return ONLY JSON: {\"findings\":[{\"field\":\"\",\"value\":\"\",\"confidence\":0.0}]}.\n" +
      "field MUST be one of these allowed field names: " + JSON.stringify(allowed).slice(0, 500) + ".\n" +
      ((ctx.targetKind === "redflag" || ctx.targetKind === "associated")
        ? "This was a yes/no screening question: the value for \"" + tidy(ctx.targetField, 60) + "\" MUST be exactly \"present\" or \"absent\".\n" : "") +
      "value = a SHORT clinical value in ENGLISH. confidence = 0..1. Include a finding ONLY if the patient explicitly stated it; " +
      "if nothing was clearly stated return {\"findings\":[]}. The answer may be Telugu, Hindi, English or code-switched; output English values.";
  }
  function sanitizeMaikExtract(parsed, allowedFields) {
    var out = { findings: [] };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.findings)) return out;
    var allow = null; if (Array.isArray(allowedFields) && allowedFields.length) { allow = {}; allowedFields.forEach(function (f) { allow[String(f)] = 1; }); }
    parsed.findings.forEach(function (f) {
      if (!f || typeof f.field !== "string" || !f.field) return;
      var field = f.field.split(".").pop();
      if (allow && !allow[field]) return;
      if (f.value == null || String(f.value).trim() === "") return;
      var c = Number(f.confidence); if (!(c >= 0 && c <= 1)) c = 0.5;
      out.findings.push({ field: field, value: stripIndic(tidy(f.value, 200)), confidence: c });
    });
    out.findings = out.findings.filter(function (f) { return f.value; }).slice(0, 20);
    return out;
  }
  function maikExtract(ctx, transcript, opts) {
    ctx = (ctx && typeof ctx === "object") ? ctx : {};
    var t = String(transcript == null ? "" : transcript).slice(0, 4000).trim();
    if (!t) return Promise.resolve({ error: "no-text" });
    var prompt = "=== QUESTION ASKED ===\n" + tidy(ctx.question, 400) + "\n=== PATIENT ANSWER ===\n" + t;
    return generateJSON(prompt, maikExtractSys(ctx), 300, opts).then(function (p) {
      var r = sanitizeMaikExtract(p, ctx.allowedFields); r.kind = "maik-ask-extract"; r.mode = "maik-ask-extract"; r.engine = "local"; return r;
    }, parseFailure);
  }

  /* ── ICU imaging summary / clinical correlation: the IMAGING_* and CORRELATE_* prompts ── */
  var IMAGING_SYS =
    "You are a clinical decision-support assistant summarizing ONE radiology report for a doctor. You are NOT the diagnostic " +
    "authority: a deterministic engine owns the diagnosis; your output is an advisory DRAFT the clinician must verify. Reason ONLY " +
    "from the report text and the de-identified context provided. NEVER invent findings, values, measurements or history not in the " +
    "report. Use hedged wording only ('Imaging is suggestive of', 'Consider correlation with', 'Differential considerations include'). " +
    "NEVER write 'confirmed diagnosis', 'the patient definitely has', 'no emergency', 'rule out completely' or 'safe to discharge'.\n" +
    "Return ONLY JSON with EXACTLY these keys: {\"summary\":string, \"positives\":[string], \"negatives\":[string], \"significance\":[string], " +
    "\"differentials\":[string], \"correlateWith\":[string], \"redFlags\":[string], \"nextChecks\":[string]}. summary is ONE sentence. " +
    "Arrays hold short phrases ([] if none).";
  var IMAGING_KEYS = ["positives", "negatives", "significance", "differentials", "correlateWith", "redFlags", "nextChecks"];
  var CORRELATE_SYS =
    "You are a clinical decision-support assistant correlating a patient's imaging concepts, laboratory abnormalities and recorded " +
    "findings for a doctor. You are NOT the diagnostic authority; your output is advisory and must be verified. Reason ONLY from the " +
    "de-identified evidence provided; never invent findings, values or history. Use hedged wording only. NEVER write 'confirmed " +
    "diagnosis', 'definitely has', 'no emergency' or 'safe to discharge'. If the evidence is too sparse to correlate, say so plainly in " +
    "clinicalCorrelation and return empty arrays.\n" +
    "Return ONLY JSON with EXACTLY these keys: {\"clinicalCorrelation\":string, \"topConsiderations\":[string], \"whyFit\":[string], " +
    "\"alternatives\":[string], \"whatDoesntFit\":[string], \"missing\":[string], \"redFlags\":[string], \"nextChecks\":[string], " +
    "\"protocols\":[string]}. clinicalCorrelation is 1-2 sentences. Arrays hold short phrases ([] if none).";
  var CORRELATE_KEYS = ["topConsiderations", "whyFit", "alternatives", "whatDoesntFit", "missing", "redFlags", "nextChecks", "protocols"];
  var FORBIDDEN_RE = /confirmed diagnosis|definitely has|no emergency|rule out completely|safe to discharge/i;
  function sanitizeAdvisory(parsed, textKey, arrayKeys, source) {
    var out = {}; if (!parsed || typeof parsed !== "object") parsed = {};
    var s = tidy(parsed[textKey], 600); if (FORBIDDEN_RE.test(s)) s = "";
    out[textKey] = dropUnsupportedNumbers(s, source).text;
    arrayKeys.forEach(function (k) { out[k] = dropUnsupportedNumbers(strList(parsed[k], 12, 200).filter(function (x) { return !FORBIDDEN_RE.test(x); }), source).items; });
    return out;
  }
  function imagingSummary(packet, opts) {
    var pkt = packet || {}; var report = String(pkt.reportText || "").slice(0, 12000).trim();
    if (!report) return Promise.resolve({ error: "no-report" });
    var ctx = [];
    if (pkt.modality) ctx.push("Modality: " + tidy(pkt.modality, 80));
    if (pkt.studyName) ctx.push("Study: " + tidy(pkt.studyName, 160));
    if (pkt.indication) ctx.push("Indication: " + tidy(pkt.indication, 300));
    if (pkt.ageBand) ctx.push("Age band: " + tidy(pkt.ageBand, 20));
    if (pkt.sex) ctx.push("Sex: " + tidy(pkt.sex, 12));
    if (pkt.workingDx) ctx.push("Working diagnosis (clinician, not authoritative): " + tidy(pkt.workingDx, 160));
    if (Array.isArray(pkt.symptoms) && pkt.symptoms.length) ctx.push("Relevant clinical findings: " + tidy(pkt.symptoms.join("; "), 400));
    if (Array.isArray(pkt.labs) && pkt.labs.length) ctx.push("Relevant labs: " + tidy(pkt.labs.join(", "), 400));
    var head = "=== CONTEXT (de-identified) ===\n" + ctx.join("\n") + "\n\n=== RADIOLOGY REPORT TEXT ===\n";
    var source = ctx.join("\n") + "\n" + report;
    var packId = (opts && opts.pack) || currentPack();
    var wins = splitWindows(report, windowBudget(packId, IMAGING_SYS + head, 500));
    return eachWindow(wins, function (w) {
      return generateJSON(head + w, IMAGING_SYS, 500, opts).then(function (p) { return sanitizeAdvisory(p, "summary", IMAGING_KEYS, source); },
        function (e) { if (e && e.message === "parse") return null; throw e; });
    }).then(function (parts) {
      parts = parts.filter(Boolean); if (!parts.length) return { error: "parse", mode: "imaging", engine: "local" };
      var merged = { summary: parts.map(function (p) { return p.summary; }).filter(Boolean).join(" ") };
      IMAGING_KEYS.forEach(function (k) { merged[k] = []; parts.forEach(function (p) { merged[k] = unionList(merged[k], p[k]); }); });
      return { summary: merged, mode: "imaging", engine: "local", windows: wins.length };
    });
  }
  function correlate(packet, opts) {
    var pkt = packet || {};
    var img = (pkt.imaging && pkt.imaging.concepts) || [], labs = (pkt.labs && pkt.labs.abnormalities) || [];
    if (!img.length && !labs.length) return Promise.resolve({ error: "no-evidence" });
    var pc = pkt.patientContext || {};
    var flags = (pkt.imaging && pkt.imaging.criticalFlags) || [];
    var found = (pkt.clinical && pkt.clinical.approvedFindings) || [];
    var packId = (opts && opts.pack) || currentPack();
    var budget = windowBudget(packId, CORRELATE_SYS, 500);
    // Fit the evidence to the window by shortening the two LISTS from their tails, never the
    // clinician-recorded findings or the critical flags (review: a byte-level cut lost the last
    // section first, which was the clinician's own words). What was left out is reported by count.
    var imgN = img.length, labN = labs.length;
    function build() {
      var L = ["=== PATIENT (de-identified) ==="];
      if (pc.ageBand) L.push("Age band: " + tidy(pc.ageBand, 20));
      if (pc.sex) L.push("Sex: " + tidy(pc.sex, 12));
      if (pc.careSetting) L.push("Care setting: " + tidy(pc.careSetting, 24));
      L.push("\n=== IMAGING CONCEPTS ===\n" + (img.slice(0, imgN).map(function (x) { return "- " + tidy(x, 120); }).join("\n") || "none"));
      if (flags.length) L.push("Critical imaging flags: " + tidy(flags.join(", "), 300));
      L.push("\n=== LABORATORY ABNORMALITIES ===\n" + (labs.slice(0, labN).map(function (x) { return "- " + tidy(x, 120); }).join("\n") || "none"));
      if (found.length) L.push("\n=== CLINICIAN-RECORDED FINDINGS ===\n" + tidy(found.join("; "), 500));
      return L.join("\n");
    }
    var body = build();
    while (estTokens(body) > budget && (imgN > 3 || labN > 3)) {
      if (labN >= imgN && labN > 3) labN--; else imgN--;
      body = build();
    }
    var omitted = { imaging: img.length - imgN, labs: labs.length - labN };
    return generateJSON(body, CORRELATE_SYS, 500, opts).then(function (p) {
      var out = { correlation: sanitizeAdvisory(p, "clinicalCorrelation", CORRELATE_KEYS, body), mode: "correlate", engine: "local" };
      if (omitted.imaging || omitted.labs) { out.truncated = true; out.omitted = omitted; out.correlation.missing = unionList(out.correlation.missing, [(omitted.imaging ? omitted.imaging + " imaging concept(s)" : "") + (omitted.imaging && omitted.labs ? " and " : "") + (omitted.labs ? omitted.labs + " lab abnormality(ies)" : "") + " not reviewed (did not fit the on-device window)"]); }
      return out;
    }, function (e) { if (e && e.message === "parse") return { error: "parse", mode: "correlate", engine: "local" }; throw e; });
  }

  /* ── translate (kind "translate"). The prompt is the server's. The GUARD is what makes it safe
   * to run on a small model at all: no Indic script may survive, every number in the input must
   * survive, and no number may appear that was not in the input. Whether a language is offered
   * offline at all is decided by the registry's caps.lang (maik-engine.js), which is filled ONLY
   * from a passing test/run-local-translate-eval.mjs run. ── */
  var TRANSLATE_SYS =
    "Translate this clinical dictation to clear clinical ENGLISH. Keep drug names, doses, units, numbers and standard abbreviations " +
    "(BP, IV, BD, OD) exactly. If it is already English, return it unchanged. Output ONLY the translation, no preamble, labels or quotes.";
  function translate(text, opts) {
    var t = String(text == null ? "" : text).slice(0, 8000).trim();
    if (!t) return Promise.resolve({ error: "no-text" });
    return generateText("=== TEXT ===\n" + t, TRANSLATE_SYS, Math.min(1000, Math.max(120, estTokens(t) * 2)), opts).then(function (out) {
      out = tidy(out, 8000);
      if (!out) return { error: "no-answer" };
      if (INDIC_RE.test(out)) return { error: "translate-guard", reason: "native-script" };
      var inN = numbersIn(t, true).map(canonNum), outN = numbersIn(out).map(canonNum);
      for (var i = 0; i < inN.length; i++) if (outN.indexOf(inN[i]) < 0) return { error: "translate-guard", reason: "number-lost", number: inN[i] };
      for (var j = 0; j < outN.length; j++) if (inN.indexOf(outN[j]) < 0) return { error: "translate-guard", reason: "number-added", number: outN[j] };
      return { text: out, mode: "translate", engine: "local" };
    });
  }

  var API = {
    SYSTEM: SYSTEM, DEFAULT_PACK: DEFAULT_PACK, emphasize: emphasize,
    // local task layer (2026-09-11)
    TUTOR_SYS: TUTOR_SYS, SURG_SYS: SURG_SYS, MODE_SYS: MODE_SYS,
    estTokens: estTokens, splitWindows: splitWindows, windowBudget: windowBudget, numbersIn: numbersIn, canonNum: canonNum, dropUnsupportedNumbers: dropUnsupportedNumbers, stripIndic: stripIndic, mergeText: mergeText,
    queueState: queueState, setJobTimeoutMs: setJobTimeoutMs,
    summarize: tracked(summarize), assess: tracked(assess), scribeFill: tracked(scribeFill), scribeReset: scribeReset,
    noteStructure: tracked(noteStructure), icdRank: tracked(icdRank), reasoningExtract: tracked(reasoningExtract),
    maikNext: tracked(maikNext), maikExtract: tracked(maikExtract), imagingSummary: tracked(imagingSummary), correlate: tracked(correlate),
    translate: tracked(translate),
    sanitizeAssessment: sanitizeAssessment, sanitizeScribe: sanitizeScribe, scribeMerge: scribeMerge, sanitizeSurgxNote: sanitizeSurgxNote, NEVER_AI_FILLABLE: NEVER_AI_FILLABLE,
    sanitizeIcd: sanitizeIcd, sanitizeReasoning: sanitizeReasoning, sanitizeMaikNext: sanitizeMaikNext, sanitizeMaikExtract: sanitizeMaikExtract, sanitizeAdvisory: sanitizeAdvisory,
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
