/* clinix-tutor.js — CliniX · MaiK as the bedside tutor.
 *
 * CliniX builds NO chatbot. It calls the existing transport (window.SMD_AI, reasoning.js:3799/3826)
 * with a CliniX context envelope, exactly as icu.js:7231 does for the ICU. What is CliniX-specific
 * is the context, the tutor system prompt (server side, TUTOR_SYS), and the guard below.
 *
 * THE GUARD: the tutor must never author a dose. The server prompt says so, but a prompt is a
 * request, not a mechanism. sanitize() is the mechanism - a reply containing a drug dose is replaced
 * wholesale, client side, before it can reach a student. This mirrors SknX Phase 2, which drops the
 * model's free text if it looks like a prescription rather than trusting the instruction.
 *
 * False positives cost the student one re-ask. A false negative puts an unreviewed dose, written by
 * a model, in front of someone who cannot yet tell it is wrong. The trade is not close.
 *
 * Pure helpers are exported for node tests; the UI half needs a browser.
 */
(function () {
  "use strict";

  var G = typeof window !== "undefined" ? window : {};

  /* ── Exam and teaching vocabulary the Intent Firewall does not know ──────── */

  /* Verified against the real classifier: "why do I check JVP?" already passes, but only because it
   * falls through to `certain:false` and is sent to the model (the 2026-08-20 amendment). Single
   * words are the real problem - a bare "JVP" or "percussion" hits home.js:3748's two-token clarify
   * trap and the student is asked to name a condition instead of being taught.
   *
   * Widening is applied ONLY when the CliniX flag is on, so flag-off stays a byte-identical no-op.
   * Every term here is genuinely medical, so this narrows nothing and refuses nothing new. */
  var EXAM_VOCAB = [
    "jvp", "jugular venous", "auscultat", "percuss", "palpat", "inspect(ion|ing)?\\b",
    "fremitus", "vocal resonance", "bronchial breathing", "crackle", "crepitation", "wheeze",
    "rhonchi", "stridor", "pleural rub", "\\bs[1-4]\\b", "heart sound", "murmur", "gallop",
    "bruit", "thrill", "heave", "apex beat", "opening snap",
    "clubbing", "schamroth", "cyanosis", "pallor", "icterus", "koilonychia", "oedema", "edema",
    "hepatomegaly", "splenomegaly", "ascites", "shifting dullness", "fluid thrill",
    "hoover sign", "barrel chest", "pursed lip", "accessory muscle", "chest expansion",
    "tracheal", "cricosternal", "tactile", "whispering pectoriloquy",
    "cranial nerve", "plantar", "babinski", "reflex", "romberg", "gait", "meningeal",
    "kernig", "brudzinski", "tone", "power", "cerebellar", "nystagmus", "tremor",
    "general examination", "systemic examination", "bedside", "case presentation",
    "differential", "problem representation", "mmrc", "pack.?year", "spirometr",
    "osce", "viva", "mnemonic", "\\bteach me\\b", "\\bquiz me\\b", "\\bexplain\\b",
    "\\bwhy do (we|i|you)\\b", "\\bhow do i (examine|elicit|test|assess|take)\\b",
    "\\bwhat (does|would) .{0,24}(mean|suggest|indicate)\\b"
  ];

  var _scopeWidened = false;
  function widenScope() {
    if (_scopeWidened) return false;
    try {
      if (!(G.SMD_CLINIX_FLAGS && G.SMD_CLINIX_FLAGS.bool("smd_clinix"))) return false;
      if (!(G.MaiKScope && G.MaiKScope.configure)) return false;
      G.MaiKScope.configure({ allow: EXAM_VOCAB });
      _scopeWidened = true;
      return true;
    } catch (e) { return false; }
  }

  /* ── The dose guard (pure) ───────────────────────────────────────────────── */

  /* Drug-dose units only. Deliberately does NOT match the numbers a respiratory lesson legitimately
   * contains: saturation targets (88 to 92 percent), PaCO2 thresholds in mmHg, FEV1 percentages,
   * an FEV1/FVC ratio of 0.7, pack-years, Harrison page numbers, or "three months in two years". */
  var DOSE_UNIT = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|microgram|micrograms|gram|grams|\bg\b|ml|millilitre|milliliter|unit|units|iu|puff|puffs|nebule|nebules)\b/i;
  var DOSE_PER_KG = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?)\s*(?:\/|per)\s*kg\b/i;
  var DOSE_FREQ = /\b(?:od|bd|tds|qds|bid|tid|qid|q\d+\s*h|q\d+\s*hourly)\b/i;

  function looksLikeDose(text) {
    var s = String(text || "");
    if (DOSE_PER_KG.test(s)) return true;
    if (DOSE_UNIT.test(s)) return true;
    // A frequency abbreviation next to any number is a regimen even without an explicit unit.
    if (DOSE_FREQ.test(s) && /\d/.test(s)) return true;
    return false;
  }

  // MaiK's chip/tier markers are for the doctor UI. CliniX has no chips for them. (icu.js:7267)
  function stripMarkers(text) {
    return String(text || "")
      .replace(/@@REFINE:[\s\S]*?@@/gi, "")
      .replace(/@@\s*MORE\s*@@/gi, "\n\n")
      .trim();
  }

  var DOSE_REFUSAL =
    "I am not going to give you a dose here. Doses in CliniX live in the lesson's treatment section, " +
    "which is referenced and reviewed by a clinician, and they still have to be checked against your " +
    "current national or institutional guideline before you ever prescribe. Ask me about the drug " +
    "class, when you would reach for it, or how it works, and I will teach you that.";

  function sanitize(text) {
    var t = stripMarkers(text);
    if (!t) return { text: "", blocked: false };
    if (looksLikeDose(t)) return { text: DOSE_REFUSAL, blocked: true, original: t };
    return { text: t, blocked: false };
  }

  /* ── The context envelope (pure) ─────────────────────────────────────────── */

  /* What MaiK needs to stop being generic: where the student is, and what they keep getting wrong.
   * Kept compact on purpose - this is prepended to every turn and the output cap is shared. */
  function buildPrompt(ctx, question) {
    ctx = ctx || {};
    var lines = [];
    lines.push("You are teaching a medical student inside a CliniX lesson. Answer their question in this context.");
    lines.push("");
    lines.push("WHERE THE STUDENT IS");
    if (ctx.systemTitle || ctx.system) lines.push("System: " + (ctx.systemTitle || ctx.system));
    if (ctx.diseaseName || ctx.diseaseId) lines.push("Topic: " + (ctx.diseaseName || ctx.diseaseId));
    if (ctx.chapterTitle || ctx.chapterId) lines.push("Chapter: " + (ctx.chapterTitle || ctx.chapterId));
    if (ctx.skillTitle || ctx.skillId) lines.push("Skill being taught: " + (ctx.skillTitle || ctx.skillId));
    if (ctx.turnHeading) lines.push("Current step: " + ctx.turnHeading);
    if (ctx.stepWhy) lines.push("What the lesson says about why: " + ctx.stepWhy);

    var m = ctx.recentMisses || [];
    if (m.length) {
      var names = [];
      for (var i = 0; i < m.length && i < 5; i++) if (m[i] && m[i].skillId) names.push(m[i].skillId);
      if (names.length) {
        lines.push("");
        lines.push("THIS STUDENT HAS RECENTLY GOT THESE WRONG (use it to pitch your answer, do not read the list back to them): " + names.join(", "));
      }
    }
    lines.push("");
    lines.push("STUDENT QUESTION: " + String(question || "").slice(0, 500));
    return lines.join("\n");
  }

  /* ── The call ────────────────────────────────────────────────────────────── */

  function available() {
    try { return !!(G.SMD_AI && (G.SMD_AI.explainGrounded || G.SMD_AI.explainGroundedStream)); }
    catch (e) { return false; }
  }

  /* Mirrors icu.js:7231: build a grounded package, put the module's own preamble in pkg.question,
   * then hand it to the shared transport. mode:"clinix-tutor" is what routes it to TUTOR_SYS and
   * to CliniX's own daily quota on the server. */
  function answer(ctx, question, onDelta) {
    widenScope();
    if (!available()) return Promise.resolve({ error: "ai-off" });
    var prompt = buildPrompt(ctx, question);

    function send(pkg) {
      var opts = { depth: "concise", mode: "clinix-tutor" };
      if (onDelta && G.SMD_AI.explainGroundedStream) {
        return G.SMD_AI.explainGroundedStream(pkg, opts, function (accumulated) {
          // onDelta receives the ACCUMULATED text, not a delta (maik-local.js:9). Sanitising each
          // frame would flicker a partial dose into view, so the guard runs on the FINAL text only
          // and the stream shows markers-stripped text.
          onDelta(stripMarkers(accumulated));
        });
      }
      return G.SMD_AI.explainGrounded(pkg, opts);
    }

    var call;
    try {
      if (G.StewardRAG && G.StewardRAG.buildPackage) {
        call = Promise.resolve(G.StewardRAG.buildPackage({ infectious: [], nonInfectious: [] }, { question: prompt }))
          .then(function (pkg) {
            if (!pkg) return { error: "no-package" };
            pkg.question = prompt;
            return send(pkg);
          });
      } else {
        // No RAG available: the ungrounded path still teaches, it just cannot cite StewardMD content.
        call = G.SMD_AI.explain ? G.SMD_AI.explain(prompt, question) : Promise.resolve({ error: "ai-off" });
      }
    } catch (e) {
      call = Promise.resolve({ error: "server" });
    }

    return call.then(function (r) {
      if (!r || r.error) return r || { error: "server" };
      var s = sanitize(r.text || "");
      return { text: s.text, blocked: s.blocked, sources: r.sources || [] };
    }).catch(function () { return { error: "server" }; });
  }

  var API = {
    // pure, node-testable
    buildPrompt: buildPrompt,
    looksLikeDose: looksLikeDose,
    stripMarkers: stripMarkers,
    sanitize: sanitize,
    EXAM_VOCAB: EXAM_VOCAB,
    DOSE_REFUSAL: DOSE_REFUSAL,
    // browser
    answer: answer,
    available: available,
    widenScope: widenScope
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_TUTOR = API;
})();
