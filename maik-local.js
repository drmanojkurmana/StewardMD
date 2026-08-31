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
     * family's own switch and costs three tokens, which is far cheaper than the reasoning it prevents.
     */
    if (packId && noThinkPack(packId)) {
      /* TWO switches, because from here we cannot tell which one the runtime will honour.
       *
       * "/no_think" is Qwen3's own switch, but it is read by the CHAT TEMPLATE - and this engine
       * sends a RAW completion prompt (generate({ prompt, system, ... }) below, no template). In a
       * raw prompt those three tokens can be treated as ordinary text and ignored, which produces
       * exactly the failure the switch exists to prevent: the model reasons anyway, stripReasoning()
       * bins every one of those tokens, and the doctor waits through generation they never see.
       * A 1.7B burning 400 tokens on reasoning loses to a 4B that answers in 120 - which is what
       * "Lite is SLOWER than the 4B" turned out to look like on a real phone.
       *
       * So we also CLOSE AN EMPTY THINKING BLOCK. The model resumes from a point where its reasoning
       * has already happened and yielded nothing, so it goes straight to the answer. That needs no
       * template support at all, which is the whole point.
       *
       * Both are kept: /no_think costs three tokens and still helps if a template IS applied, and
       * stripReasoning() removes a closed empty block either way, so neither can leak to the doctor.
       */
      L.push("/no_think");
      L.push("<think>\n\n</think>");
    }
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

    return ensureLoaded(packId).then(function () {
      var prompt = buildPrompt(pkg, packId);
      if (!prompt) return { error: "no-package" };
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
          temperature: (opts && typeof opts.temperature === "number") ? opts.temperature : 0,
          stream: typeof onDelta === "function"
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
        return {
          text: text,
          // ALWAYS empty: this answer used no StewardMD material, so attaching the package's
          // citations would credit sources the model never saw. That is a lie in a clinical UI.
          sources: [],
          grounded: false,
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

  var API = {
    SYSTEM: SYSTEM, DEFAULT_PACK: DEFAULT_PACK,
    HISTORY_TURNS: HISTORY_TURNS, buildPrompt: buildPrompt, answer: answer, available: available, currentPack: currentPack,
    isFollowUp: isFollowUp, isGreeting: isGreeting, SYSTEM_GREET: SYSTEM_GREET, stripReasoning: stripReasoning,
    visionReady: visionReady, visionPathFor: visionPathFor, MAX_IMAGES: MAX_IMAGES, SYSTEM_IMAGE: SYSTEM_IMAGE,
    SYSTEM_IMAGE_FOLLOWUP: SYSTEM_IMAGE_FOLLOWUP,
    warm: warm, isDebugBuild: isDebugBuild, debugProbed: debugProbed, cancel: cancel, release: release
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_MAIK_LOCAL = API;
})();
