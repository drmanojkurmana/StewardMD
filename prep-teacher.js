/* PrepNucleus offline teacher (LayerC Phase 6): "Why is B wrong?" answered on the phone. window.PREP_TEACHER. ES5.
   Plan: vault/plans/PrepNucleus-LayerC.md, roadmap row "6 Offline teacher".

   Model. The on-device MaiK pack the clinician selected (MaiK Lite or MxCore, llama.cpp through capacitor-llama, n_ctx
   4096), run through SMD_MAIK_LOCAL.answer() with a teacher system prompt and NO retrieval (opts._grounding = null:
   the question's own stored text is the grounding, not the Knowledge Base). Native only, and only when the selected
   pack is downloaded. There is no other path: no server AI, no SMD_AI, no fetch. Not available means the screen says
   so and offers nothing else.

   Grounding. The stem, the four options, the key, the stored explanation exp, the exam pearl kp, the per-option reasons
   r (Layer B/C items) and, for a student's own deck, the cited source sentences (PREP_DECKS prep-src, by src.sn). The
   model is told to explain only from it.

   Automatic check before anything is shown (same idea as gate 9b in functions/_prep-core.js): every number in the
   answer, and every drug name (the app's drug lexicon, drug-lexicon.js, plus the suffix rule kb/ai/maik-grounding.js
   uses; capitalised terms when no lexicon is loaded), must appear in the grounding text. A miss, an empty answer, a
   model error or "not covered" shows the stored explanation instead, with a short note. The answer is never streamed
   to the screen: unchecked text is never shown, not even while it is being written.

   Host. explain(item, chosenIndex, host) draws through PREP._host (push, paint, bar, esc, root); "back" is prep.js's
   own data-act. Pure helpers load under node for tests (module.exports when there is no window.document). */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var LETTERS = ["A", "B", "C", "D", "E"];
  // Prompt budget: MaiK Lite prefills at roughly 14 tokens a second on a Pixel 9, so about 800 tokens of grounding
  // keeps the answer near the plan's 10 to 20 s. Fields go in priority order and the total is capped.
  var LIM = { q: 900, o: 220, exp: 900, kp: 300, r: 350, sent: 350, sents: 6, total: 3200 };
  var SYSTEM =
    "You are MaiK, a medical exam teacher inside StewardMD PrepNucleus, helping a student who just answered a multiple choice question.\n" +
    "RULES:\n" +
    "- Explain using ONLY the facts in the GROUNDING block. Do not add any drug, dose, number, criterion, name or fact that is not written there.\n" +
    "- Refer to options by their letter.\n" +
    "- If the grounding does not say why an option is wrong or right, reply exactly: The stored explanation does not cover this.\n" +
    "- Plain prose, 3 to 5 short sentences. No headings, no lists, no preamble, no question back to the student.";
  var NOT_COVERED = /\b(?:stored explanation does not cover|(?:grounding|explanation|text)\s+(?:does not|doesn'?t)\s+(?:say|cover|state|mention|explain)|not\s+(?:covered|stated|mentioned)\s+in\s+the\s+(?:grounding|explanation|text))\b/i;

  function str(s) { return s == null ? "" : String(s); }
  function clip(s, n) { s = str(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 3).replace(/\s+\S*$/, "") + "..." : s; }
  function keyOf(item) { var a = item && item.a; return typeof a === "number" && a >= 0 && item.o && a < item.o.length ? a : -1; }
  function letter(k) { return LETTERS[k] || "?"; }
  function reasons(item) { return item && item.r && item.r.length ? item.r : null; }
  // Source sentences: an array of strings or of { n, tx } records (prep-src).
  function sentText(s) { return typeof s === "string" ? s : s && (s.tx || s.text) || ""; }

  /* groundParts(item, chosen, sents) -> [{ k, text }] in priority order, before the total cap. */
  function groundParts(item, chosen, sents) {
    var out = [], a = keyOf(item), r = reasons(item);
    if (!item) return out;
    out.push({ k: "q", text: "Question: " + clip(item.q, LIM.q) });
    (item.o || []).forEach(function (o, i) { out.push({ k: "o", text: letter(i) + ". " + clip(o, LIM.o) }); });
    if (a >= 0) out.push({ k: "key", text: "Correct answer: " + letter(a) + ". " + clip(item.o[a], LIM.o) });
    if (r && chosen >= 0 && chosen !== a && r[chosen]) out.push({ k: "r", text: "Why " + letter(chosen) + " is wrong: " + clip(r[chosen], LIM.r) });
    if (item.exp) out.push({ k: "exp", text: "Explanation: " + clip(item.exp, LIM.exp) });
    if (r && a >= 0 && r[a] && clip(r[a], LIM.r) !== clip(item.exp, LIM.r)) out.push({ k: "r", text: "Why " + letter(a) + " is right: " + clip(r[a], LIM.r) });
    if (item.kp) out.push({ k: "kp", text: "Exam pearl: " + clip(item.kp, LIM.kp) });
    if (r) r.forEach(function (x, i) { if (x && i !== a && i !== chosen) out.push({ k: "r", text: "About " + letter(i) + ": " + clip(x, LIM.r) }); });
    (sents || []).slice(0, LIM.sents).forEach(function (s) { var t = clip(sentText(s), LIM.sent); if (t) out.push({ k: "src", text: "Source: " + t }); });
    return out;
  }
  /* groundingText(item, chosen, sents) -> the exact text the model sees and the check reads (capped at LIM.total). */
  function groundingText(item, chosen, sents) {
    var lines = [], used = 0;
    // The stem, the options and the key always go in; the rest only while it fits.
    groundParts(item, chosen, sents).forEach(function (p) {
      var core = p.k === "q" || p.k === "o" || p.k === "key";
      if (!core && used + p.text.length + 1 > LIM.total) return;
      lines.push(p.text); used += p.text.length + 1;
    });
    return lines.join("\n");
  }
  // Something to teach from beyond the stem and the options.
  function teachable(item, sents) {
    if (!item || !item.o || keyOf(item) < 0) return false;
    var r = reasons(item);
    return !!(str(item.exp).trim() || str(item.kp).trim() || (r && r.some(function (x) { return str(x).trim(); })) || (sents && sents.length));
  }
  /* promptFor(item, chosen, ground) -> the user turn. chosen < 0 or the key: why the key is right. */
  function promptFor(item, chosen, ground) {
    var a = keyOf(item), wrong = chosen >= 0 && chosen !== a;
    var task = wrong ?
      "The student chose " + letter(chosen) + ". Explain why " + letter(chosen) + " is wrong and why " + letter(a) + " is the correct answer, using only the grounding." :
      "Explain why " + letter(a) + " is the correct answer and why the other options are not, using only the grounding.";
    return "GROUNDING:\n" + ground + "\n\nTASK: " + task;
  }

  /* ---- numbers: functions/_prep-core.js numbersIn / sourceNumbers / missingNumbers (gate 9b), in ES5 ---- */
  var NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000, single: 1, once: 1, twice: 2, double: 2, triple: 3, half: 0.5 };
  function canonNum(m) {
    var s = str(m).replace(/,/g, "");
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s.replace(/^0+(?=\d)/, "");
  }
  function numbersIn(s) {
    var out = [];
    str(s).replace(/\d+(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, function (m) { out.push(canonNum(m)); return m; });
    return out;
  }
  function normText(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function sourceNumbers(text) {
    var set = {};
    numbersIn(text).forEach(function (n) { set[n] = 1; });
    normText(text).split(" ").forEach(function (w) { if (Object.prototype.hasOwnProperty.call(NUM_WORDS, w)) set[String(NUM_WORDS[w])] = 1; });
    return set;
  }
  function missingNumbers(text, sourceText) {
    var src = sourceNumbers(sourceText), seen = {};
    return numbersIn(text).filter(function (n) { if (src[n] || seen[n]) return false; seen[n] = 1; return true; });
  }

  /* ---- drug names ---- */
  // The suffix rule of kb/ai/maik-grounding.js (catches what the lexicon lacks).
  var DRUG_SUFFIX = /\b(?:cef[a-z]{3,}|sulfa[a-z]{3,}|[a-z]{4,}(?:cillin|mycin|micin|cycline|azole|oxacin|floxacin|pril|sartan|statin|olol|dipine|parin|prazole|triptan|mab|nib|tinib|ciclovir|vir|navir|cept|gliptin|glitazone|barbital|azepam|zolam|caine|tidine|semide|thiazide|conazole|penem|oxetine|azosin|terol|profen|coxib|zosin|lukast|setron|dronate|afil|formin|glinide))\b/g;
  var NOT_DRUG = { intercept: 1, concept: 1, precept: 1, percept: 1, receptor: 1, except: 1, accept: 1, cholesterol: 1, ergosterol: 1 };
  // Lexicon entries that are lab analytes, everyday words or drug classes (maik-grounding.js LEX_SKIP).
  var LEX_SKIP = { cation: 1, dimethyl: 1, hydrogen: 1, alanine: 1, glycine: 1, glutamine: 1, phenylalanine: 1,
    thrombin: 1, secretin: 1, lactase: 1, barium: 1, vaccine: 1, "amino acids": 1, steroid: 1, laxative: 1, antiemetic: 1 };
  var LEX_MAX_WORDS = 4;
  function lexClean(x) { return str(x).toLowerCase().replace(/sulph/g, "sulf").replace(/-/g, " ").replace(/\s+/g, " ").trim(); }
  var _lexSrc = null, _lex = null;
  /* lexMap(lexicon) -> { name: canonical generic } from drug-lexicon.js ({ generics[], brands{brand: generic} }). */
  function lexMap(src) {
    if (!src) return null;
    if (src === _lexSrc) return _lex;
    var map = {}, gens = src.generics || (src.length ? src : []), i, k;
    for (i = 0; i < gens.length; i++) { var g = lexClean(gens[i]); if (g.length >= 4 && !LEX_SKIP[g] && !NOT_DRUG[g] && g.split(" ").length <= LEX_MAX_WORDS) map[g] = g; }
    for (k in map) { var w0 = k.split(" ")[0]; if (w0 !== k && map[w0]) map[k] = w0; }
    if (src.brands) for (k in src.brands) { var b = lexClean(k), gg = lexClean(src.brands[k]); if (b.length >= 4 && !LEX_SKIP[b] && gg) map[b] = map[gg] || gg; }
    _lexSrc = src; _lex = map;
    return map;
  }
  /* drugsIn(text, map) -> [{ name: canonical, surface }] : lexicon names (longest first, up to 4 words) and suffix-rule
     words. map null = the suffix rule alone. */
  function drugsIn(text, map) {
    var t = lexClean(text), out = [], seen = {}, m;
    function add(name, surface) { var k = name + "|" + surface; if (!seen[k]) { seen[k] = 1; out.push({ name: name, surface: surface }); } }
    if (map) {
      var tk = [], re = /[a-z][a-z0-9]*/g;
      while ((m = re.exec(t)) !== null) tk.push({ w: m[0], pos: m.index, end: m.index + m[0].length });
      for (var i = 0; i < tk.length; i++) {
        if (tk[i].w.length < 4) continue;
        for (var k = Math.min(LEX_MAX_WORDS, tk.length - i); k >= 1; k--) {
          var key = tk[i].w, ok = true;
          for (var j = 1; j < k; j++) { if (!/^\s+$/.test(t.slice(tk[i + j - 1].end, tk[i + j].pos))) { ok = false; break; } key += " " + tk[i + j].w; }
          if (!ok || !Object.prototype.hasOwnProperty.call(map, key)) continue;
          add(map[key], key); i += k - 1; break;
        }
      }
    }
    DRUG_SUFFIX.lastIndex = 0;
    while ((m = DRUG_SUFFIX.exec(t)) !== null) if (!NOT_DRUG[m[0]]) add(map && map[m[0]] ? map[m[0]] : m[0], m[0]);
    return out;
  }
  // No lexicon: capitalised words inside a sentence ("Vancomycin", "Kawasaki") are treated as names to check.
  var CAP_OK = { option: 1, options: 1, answer: 1, correct: 1, incorrect: 1, question: 1, explanation: 1, exam: 1, pearl: 1, grounding: 1, source: 1, maik: 1, stewardmd: 1, prepnucleus: 1, student: 1 };
  function capsTerms(text) {
    var out = [], seen = {}, re = /\b[A-Z][A-Za-z-]{3,}\b/g, m, s = str(text);
    while ((m = re.exec(s)) !== null) {
      var before = s.slice(0, m.index).replace(/[\s"'(]+$/, "");
      if (!before || /[.!?:]$/.test(before) || /\n\s*$/.test(s.slice(0, m.index))) continue;   // sentence or line start
      var w = m[0].toLowerCase();
      if (CAP_OK[w] || seen[w]) continue;
      seen[w] = 1; out.push(w);
    }
    return out;
  }
  // List markers ("1.", "2)") at the start of a line are layout, not figures.
  function forCheck(answer) { return str(answer).replace(/^\s*\d+[.)]\s+/gm, ""); }
  /* check(answer, ground, lexicon) -> { ok, numbers: [missing], drugs: [missing], terms: [missing] }. */
  function check(answer, ground, lexicon) {
    var a = forCheck(answer), map = lexMap(lexicon), g = " " + lexClean(ground).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ") + " ";
    var nums = missingNumbers(a, ground);
    var have = {}; drugsIn(ground, map).forEach(function (d) { have[d.name] = 1; });
    var drugs = [], dseen = {};
    drugsIn(a, map).forEach(function (d) {
      if (have[d.name] || g.indexOf(" " + d.surface.replace(/[^a-z0-9 ]+/g, " ") + " ") >= 0 || dseen[d.name]) return;
      dseen[d.name] = 1; drugs.push(d.surface);
    });
    var terms = map ? [] : capsTerms(a).filter(function (w) { return g.indexOf(" " + w.replace(/[^a-z0-9 ]+/g, " ") + " ") < 0; });
    return { ok: !nums.length && !drugs.length && !terms.length, numbers: nums, drugs: drugs, terms: terms };
  }
  // Model text for the screen: markdown bold dropped, blank runs collapsed.
  function cleanAnswer(t) { return str(t).replace(/\*\*/g, "").replace(/^#+\s*/gm, "").replace(/\n{3,}/g, "\n\n").trim(); }
  /* What the fallback shows: the stored text, as written. */
  function fallbackFor(item, chosen) {
    var a = keyOf(item), r = reasons(item);
    return { key: a >= 0 ? letter(a) + ". " + str(item.o[a]) : "", exp: str(item && item.exp), kp: str(item && item.kp),
      why: r && chosen >= 0 && chosen !== a && r[chosen] ? str(r[chosen]) : "", chosen: chosen >= 0 ? letter(chosen) : "" };
  }
  var NOTES = {
    check: "MaiK's answer named a drug or a number that is not in this question's explanation, so it is not shown. Here is the stored explanation.",
    "not-covered": "MaiK could not explain this from the stored explanation. Here it is as written.",
    empty: "MaiK gave no answer on this phone just now. Here is the stored explanation.",
    "model-error": "MaiK could not answer on this phone just now. Here is the stored explanation.",
    "no-grounding": "This question has no stored explanation for MaiK to teach from.",
    "no-model": "MaiK's on-device model is not ready on this phone."
  };
  function now() { return new Date().getTime(); }
  /* teach(item, chosen, deps) -> Promise<{ ok: true, text, check, ms, model } | { ok: false, reason, note, fallback, check? }>.
     deps: { generate(prompt, system) -> Promise<{ text } | { error } | string>, lexicon, sents }. Never rejects.
     The model is the ONLY thing called, and only with grounding to teach from. */
  function teach(item, chosen, deps) {
    deps = deps || {};
    var c = typeof chosen === "number" ? chosen : -1, t0 = now();
    function fail(reason, extra) {
      var o = { ok: false, reason: reason, note: NOTES[reason] || NOTES["model-error"], fallback: fallbackFor(item || {}, c), ms: now() - t0 };
      if (extra) o.check = extra;
      return o;
    }
    if (!teachable(item, deps.sents)) return Promise.resolve(fail("no-grounding"));
    if (typeof deps.generate !== "function") return Promise.resolve(fail("no-model"));
    var ground = groundingText(item, c, deps.sents), prompt = promptFor(item, c, ground);
    return Promise.resolve().then(function () { return deps.generate(prompt, SYSTEM); }).then(function (r) {
      if (r && typeof r === "object" && r.error) return fail("model-error");
      var text = cleanAnswer(r && typeof r === "object" ? r.text : r);
      if (!text) return fail("empty");
      if (NOT_COVERED.test(text)) return fail("not-covered");
      var ck = check(text, ground, deps.lexicon);
      if (!ck.ok) return fail("check", ck);
      return { ok: true, text: text, check: ck, ms: now() - t0, model: (r && typeof r === "object" && r.model) || "" };
    }, function () { return fail("model-error"); });
  }

  /* ---- lessons (prep-lessons.js): "Ask MaiK about this step" ---- */
  var STEP_SYSTEM =
    "You are MaiK, a medical exam teacher inside StewardMD PrepNucleus. A student is reading a short lesson step and asked you to explain it again.\n" +
    "RULES:\n" +
    "- Explain using ONLY the facts in the GROUNDING block. Do not add any drug, dose, number, criterion, name or fact that is not written there.\n" +
    "- Simpler words than the step, 3 to 5 short sentences, then one line that starts with: Remember:\n" +
    "- Plain prose. No headings, no lists, no preamble, no question back to the student.";
  /* stepGround(step, title) -> the lesson step as grounding: its text (bold marks dropped) and every string of its visual. */
  function stepGround(step, title) {
    var P = G && G.PREP_LESSONS ? G.PREP_LESSONS._pure : null, v = step && step.vis;
    var vis = P ? P.visText(v) : "";
    return clip("Lesson: " + str(title) + "\nStep: " + str(step && step.tx).replace(/\*\*/g, "") + (vis ? "\nVisual: " + vis.replace(/\s*\n\s*/g, "; ") : ""), LIM.total);
  }
  /* teachStep(step, title, deps) -> Promise<{ ok, text } | { ok: false, reason, note }>; the same check as teach(). */
  function teachStep(step, title, deps) {
    deps = deps || {};
    var ground = stepGround(step, title);
    if (!step || !str(step.tx).trim()) return Promise.resolve({ ok: false, reason: "no-grounding", note: "This step has nothing for MaiK to teach from." });
    if (typeof deps.generate !== "function") return Promise.resolve({ ok: false, reason: "no-model", note: NOTES["no-model"] });
    var prompt = "GROUNDING:\n" + ground + "\n\nTASK: Explain this step again in simpler words, using only the grounding.";
    return Promise.resolve().then(function () { return deps.generate(prompt, STEP_SYSTEM); }).then(function (r) {
      if (r && typeof r === "object" && r.error) return { ok: false, reason: "model-error", note: "MaiK could not answer on this phone just now." };
      var text = cleanAnswer(r && typeof r === "object" ? r.text : r);
      if (!text) return { ok: false, reason: "empty", note: "MaiK gave no answer on this phone just now." };
      var ck = check(text, ground, deps.lexicon);
      if (!ck.ok) return { ok: false, reason: "check", note: "MaiK's answer named a drug or a number that is not in this step, so it is not shown.", check: ck };
      return { ok: true, text: text, check: ck };
    }, function () { return { ok: false, reason: "model-error", note: "MaiK could not answer on this phone just now." }; });
  }

  var PURE = { SYSTEM: SYSTEM, LIM: LIM, NOTES: NOTES, groundParts: groundParts, groundingText: groundingText, promptFor: promptFor, teachable: teachable,
    numbersIn: numbersIn, sourceNumbers: sourceNumbers, missingNumbers: missingNumbers, lexMap: lexMap, drugsIn: drugsIn, capsTerms: capsTerms,
    check: check, cleanAnswer: cleanAnswer, fallbackFor: fallbackFor, teach: teach, stepGround: stepGround, teachStep: teachStep, STEP_SYSTEM: STEP_SYSTEM };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= app ================= */
  function local() { return G.SMD_MAIK_LOCAL || null; }
  function models() { return G.SMD_MAIK_MODELS || null; }
  function native() { try { var C = G.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; } }
  function packId() {
    var Lc = local(), M = models();
    try { if (Lc && Lc.currentPack) return Lc.currentPack(); } catch (e) {}
    try { if (M && M.activePack) return M.activePack(); } catch (e) {}
    return "maik-lite";
  }
  function packLabel() { try { var p = models().PACKS[packId()]; return (p && p.label) || "MaiK"; } catch (e) { return "MaiK"; } }
  // The runtime is there (native app with the llama plugin, MaiK's local engine loaded).
  function runtime() { var Lc = local(); try { return !!(native() && Lc && Lc.available && Lc.available() && typeof Lc.answer === "function" && models()); } catch (e) { return false; } }
  /* ready() -> bool, synchronous: runtime plus the selected pack marked downloaded (for showing the button). */
  function ready() { try { var M = models(); return runtime() && !!(M.installedCached && M.installedCached(packId())); } catch (e) { return false; } }
  /* available() -> Promise<bool>: runtime plus the selected pack verified on disk. */
  function available() {
    if (!runtime()) return Promise.resolve(false);
    var M = models();
    return Promise.resolve().then(function () { return M.installed ? M.installed(packId()) : ready(); })
      .then(function (ok) { return !!ok; }, function () { return false; });
  }
  // MaiK's local engine with the teacher prompt and NO Knowledge Base retrieval (_grounding null): queued with every
  // other local generation, on the selected pack, at temperature 0.
  function localGenerate(prompt, system) {
    return local().answer({ question: prompt }, { systemOverride: system, _grounding: null, temperature: 0 });
  }
  // A student's own deck item: its cited source sentences, read from the phone (prep-decks.js). Others: none.
  function sourceSentences(item) {
    var D = G.PREP_DECKS, sn = item && item.src && item.src.sn;
    if (item && item.sents && item.sents.length) return Promise.resolve(item.sents);
    if (!D || !D.getSrc || !item || !item.deckId || !sn || !sn.length) return Promise.resolve([]);
    return Promise.resolve().then(function () { return D.getSrc(item.deckId); }).then(function (rec) {
      var want = {}; sn.forEach(function (n) { want[n] = 1; });
      return ((rec && rec.sents) || []).filter(function (s) { return want[s.n]; });
    }, function () { return []; });
  }

  var busy = false, seq = 0;
  /* explain(item, chosenIndex, host): pushes the teacher screen. Waits for the model (never streams unchecked text),
     then shows the checked answer or the stored explanation with a note. */
  function explain(item, chosenIndex, host) {
    if (!item || !host || !host.push) return;
    var token = "pt" + (++seq), S = { phase: "wait", res: null, t0: 0 }, esc = host.esc;
    var a = keyOf(item), c = typeof chosenIndex === "number" ? chosenIndex : -1, wrong = c >= 0 && c !== a;
    var title = wrong ? "Why is " + letter(c) + " wrong?" : "Why is " + letter(a) + " right?";
    function para(t) { return str(t).split(/\n{2,}/).map(function (p) { return '<p class="pn-exp">' + esc(p.trim()) + "</p>"; }).join(""); }
    function stored(f) {
      return (f.why ? "<h3>Why " + esc(f.chosen) + " is wrong</h3>" + para(f.why) : "") +
        "<h3>Answer " + esc(f.key) + "</h3>" + (f.exp ? para(f.exp) : '<p class="pn-mut">No explanation is stored for this question yet.</p>') +
        (f.kp ? '<p class="pn-kp"><b>Exam pearl:</b> ' + esc(f.kp) + "</p>" : "");
    }
    function body() {
      var back = '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="back">Back to the question</button></div>';
      if (S.phase === "wait") return '<p class="pn-load" role="status">Checking for MaiK on this phone...</p>';
      if (S.phase === "none") return '<div class="pn-empty"><p><b>The offline teacher needs MaiK on this phone.</b></p><p class="pn-mut">It runs only on a downloaded on-device model (MaiK Lite or MxCore: Settings, MaiK) in the StewardMD app. Nothing is sent to a server.</p></div>' + back;
      if (S.phase === "busy") return '<p class="pn-load" role="status">MaiK is still working on another answer. Try again in a moment.</p>' + back;
      if (S.phase === "run") return '<p class="pn-q">' + esc(clip(item.q, 240)) + '</p><p class="pn-load" role="status">MaiK is working on your phone: <span id="ptSecs">0</span> s. This takes 10 to 40 seconds.</p>';
      var r = S.res || {};
      if (r.ok) return '<section class="pn-fb" role="status" tabindex="-1"><h3>MaiK explains</h3>' + para(r.text) +
        '<p class="pn-note">Written on this phone by ' + esc(packLabel()) + " from this question's stored explanation. Checked: every drug and number in it appears there.</p></section>" + back;
      return '<section class="pn-fb" role="status" tabindex="-1"><p class="pn-mut pn-small">' + esc(r.note || NOTES["model-error"]) + "</p>" + stored(r.fallback || fallbackFor(item, c)) + "</section>" + back;
    }
    function view() { host.paint(host.bar(esc(title), "MaiK offline teacher", "back") + '<div class="pn-body pn-run" data-pt="' + token + '">' + body() + "</div>", S.phase === "done" ? ".pn-fb" : null); }
    function alive() { try { var rt = host.root && host.root(); return !!(rt && rt.querySelector('[data-pt="' + token + '"]')); } catch (e) { return false; } }
    function update() { if (alive()) view(); }
    function tick() {
      if (S.phase !== "run") return;
      try { var el = host.root().querySelector('[data-pt="' + token + '"] #ptSecs'); if (el) el.textContent = String(Math.round((now() - S.t0) / 1000)); } catch (e) {}
      G.setTimeout(tick, 1000);
    }
    host.push(view);
    available().then(function (ok) {
      if (!ok) { S.phase = "none"; return update(); }
      if (busy) { S.phase = "busy"; return update(); }
      busy = true; S.phase = "run"; S.t0 = now(); update(); tick();
      return sourceSentences(item).then(function (sents) {
        return teach(item, c, { generate: localGenerate, lexicon: G.SMD_DRUG_LEXICON || null, sents: sents });
      }).then(function (res) { busy = false; S.res = res; S.phase = "done"; update(); },
        function () { busy = false; S.res = { ok: false, reason: "model-error", note: NOTES["model-error"], fallback: fallbackFor(item, c) }; S.phase = "done"; update(); });
    });
  }

  /* explainStep(step, title, host): a lesson step explained again by the phone's own model, checked like explain();
     on any failure the screen says why and the step's own text stays the answer. */
  function explainStep(step, title, host) {
    if (!step || !host || !host.push) return;
    var token = "ps" + (++seq), S = { phase: "wait", res: null }, esc = host.esc;
    function body() {
      var back = '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="back">Back to the lesson</button></div>';
      if (S.phase === "wait") return '<p class="pn-load" role="status">Checking for MaiK on this phone...</p>';
      if (S.phase === "none") return '<div class="pn-empty"><p><b>Ask MaiK needs MaiK on this phone.</b></p><p class="pn-mut">It runs only on a downloaded on-device model. Nothing is sent to a server.</p></div>' + back;
      if (S.phase === "busy") return '<p class="pn-load" role="status">MaiK is still working on another answer. Try again in a moment.</p>' + back;
      if (S.phase === "run") return '<p class="pn-load" role="status">MaiK is working on your phone. This takes 10 to 40 seconds.</p>';
      var r = S.res || {};
      if (r.ok) return '<section class="pn-fb" role="status" tabindex="-1"><h3>MaiK explains</h3>' + r.text.split(/\n{2,}|\n/).map(function (p) { return '<p class="pn-exp">' + esc(p) + "</p>"; }).join("") +
        '<p class="pn-note">Written on this phone by ' + esc(packLabel()) + " from this step. Checked: every drug and number in it appears in the step.</p></section>" + back;
      return '<section class="pn-fb" role="status" tabindex="-1"><p class="pn-mut pn-small">' + esc(r.note || "MaiK could not answer just now.") + '</p><p class="pn-exp">' + esc(str(step.tx).replace(/\*\*/g, "")) + "</p></section>" + back;
    }
    function view() { host.paint(host.bar("Ask MaiK", esc(title), "back") + '<div class="pn-body pn-run" data-pt="' + token + '">' + body() + "</div>", S.phase === "done" ? ".pn-fb" : null); }
    function update() { try { var rt = host.root && host.root(); if (rt && rt.querySelector('[data-pt="' + token + '"]')) view(); } catch (e) {} }
    host.push(view);
    available().then(function (ok) {
      if (!ok) { S.phase = "none"; return update(); }
      if (busy) { S.phase = "busy"; return update(); }
      busy = true; S.phase = "run"; update();
      return teachStep(step, title, { generate: localGenerate, lexicon: G.SMD_DRUG_LEXICON || null }).then(function (res) { busy = false; S.res = res; S.phase = "done"; update(); },
        function () { busy = false; S.res = { ok: false }; S.phase = "done"; update(); });
    });
  }

  G.PREP_TEACHER = { available: available, ready: ready, explain: explain, explainStep: explainStep, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
