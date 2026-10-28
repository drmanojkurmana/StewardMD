/* prep-import.js - PrepNucleus "Import MCQs": turn questions that already exist (a JSON file an LLM filled from a template,
   or a PDF laid out like the INI-SS recall documents) into a module, with no AI call and no MaiK Tokens.
   Students: a PRIVATE module stored on their phone (a prep-decks.js deck, same as a MaiK module). Owner: the questions go to
   the Author review list and are published with the existing publish op (prep-qgen.js).
   Pure parts (template, prompt, parseJson, parsePdfLines, toItems) have no DOM and are exported as PREP_IMPORT._pure and
   module.exports for tests. Server: none. Vault: PrepNucleus.md "Import MCQs". */
(function (G) {
  "use strict";
  var FORMAT = "stewardmd-mcq-v1", LETTERS = ["A", "B", "C", "D"], MAX_Q = 600, PAGE_STEP = 15, PAGE_MAX = 400;

  /* ---------------- template and prompt ---------------- */
  var TEMPLATE = {
    format: FORMAT,
    title: "Module name",
    exam: "NEET-PG",
    subject: "Subject",
    topic: "Topic",
    questions: [{
      q: "Question stem, ending in a question.",
      options: ["Option A text", "Option B text", "Option C text", "Option D text"],
      answer: "B",
      explanation: "Why the answer is right.",
      why_wrong: ["Why option A is wrong: what A really is and when it would be the answer", "", "Why option C is wrong: what C really is and when it would be the answer", "Why option D is wrong: what D really is and when it would be the answer"],
      topic_explanation: "The topic behind the question, 3 to 6 sentences: the concept, how to tell the options apart, one exam trap.",
      key_point: "One line to remember.",
      difficulty: 2,
      tags: ["topic"]
    }]
  };
  function template() { return JSON.stringify(TEMPLATE, null, 2); }
  function prompt() {
    return [
      "TASK: Convert the multiple choice questions in the attached file into the JSON format below, for the StewardMD PrepNucleus app.",
      "",
      "HOW TO REPLY (important): answer immediately with the finished JSON and nothing else. Do not ask me any question, do not write an introduction, notes or a closing line, and do not browse. Your whole reply is ONE code block holding ONE JSON object that starts with { and ends with }, so I can copy it with one tap. If you can attach a downloadable .json file, give the same JSON as the file instead.",
      "",
      "RULES:",
      "- Use ONLY the questions that are in the file. Do not invent, merge, skip or reword them. Keep each stem and option as written.",
      "- Exactly 4 options per question, in order. If a question has 5 or more, keep the correct one and the 3 most plausible others.",
      "- answer: one letter, A, B, C or D, the correct option as given in the file.",
      "- explanation: why the answer is right, the COMPLETE text from the file (do not shorten or drop sentences).",
      "- why_wrong: exactly 4 strings in option order. Every WRONG option gets its own specific reason, 1 to 2 sentences, written as why that option is not correct here and when it would be right (for example: \"Option B is wrong because ... It would be the answer if ...\"). Use the file's reason when it gives one; when it gives none, write it yourself, accurate and specific to that option. Never write a generic line such as \"not the best answer because it does not match the scenario\". Use \"\" only for the correct option.",
      "- topic_explanation: 3 to 6 sentences on the topic behind the question (the concept, how to tell the options apart, one exam trap), from the file where it has it, otherwise written by you. This is shown below the answer.",
      "- key_point: one short line. difficulty: 1 easy, 2 moderate, 3 hard. tags: 0 to 3 short words.",
      "- Plain text only inside the fields: no markdown, no line breaks, no em dash (use a hyphen or a comma).",
      "- If there are more than 40 questions, give the first 40 and stop. I will say 'continue' for the next 40, in the same format.",
      "",
      "FORMAT (the example shows one question; add every question to the \"questions\" array):",
      template(),
      "",
      "BEFORE YOU REPLY: check that the JSON is valid (double quotes, no trailing commas, no comments), that each answer letter matches the file, that no explanation lost a sentence, and that each of the 3 wrong options of every question has its own reason. Then output the JSON block only."
    ].join("\n");
  }

  /* ---------------- custom prompt: PrepNucleus asks, ChatGPT or Gemini writes ---------------- */
  var EXAMS = [["neet-pg", "NEET-PG"], ["ini-cet", "INI-CET"], ["fmge", "FMGE"], ["neet-ss", "NEET-SS"], ["ini-ss", "INI-SS"], ["usmle-step1", "USMLE Step 1"], ["usmle-step2-ck", "USMLE Step 2 CK"]];
  var DIFFS = [["mix", "Exam mix"], ["easy", "Easy"], ["moderate", "Moderate"], ["hard", "Hard"]];
  var COUNTS = [10, 20, 30, 40];
  var STYLE = {
    "neet-pg": "NEET-PG: single best answer, mostly short clinical vignettes, Indian context where it matters.",
    "ini-cet": "INI-CET: single best answer, application and next-best-step questions, a few direct recalls.",
    "neet-ss": "NEET-SS: super-speciality entrance, deeper clinical reasoning, current guidelines and landmark trials.",
    "ini-ss": "INI-SS: super-speciality entrance, deeper clinical reasoning, current guidelines and landmark trials.",
    "fmge": "FMGE: single best answer, core MBBS clinical subjects, direct and short vignettes.",
    "usmle-step1": "USMLE Step 1: clinical vignette testing the basic science mechanism behind the disease, no recall-only stems.",
    "usmle-step2-ck": "USMLE Step 2 CK: clinical vignette asking the next best step in diagnosis or management."
  };
  function examLabel(id) { for (var i = 0; i < EXAMS.length; i++) if (EXAMS[i][0] === id) return EXAMS[i][1]; return "NEET-PG"; }
  function diffLine(id) { return id === "easy" ? "All easy (direct recall of a core fact)." : id === "moderate" ? "All moderate (one reasoning step)." : id === "hard" ? "All hard (two-step reasoning, close distractors)." : "Mix: about 30% easy, 50% moderate, 20% hard."; }
  /* promptFor({ exam, subject, topic, n, diff }) -> the text a doctor pastes into ChatGPT or Gemini. */
  function promptFor(o) {
    o = o || {};
    var exam = EXAMS.some(function (x) { return x[0] === o.exam; }) ? o.exam : "neet-pg", n = Math.max(1, Math.min(40, parseInt(o.n, 10) || 10));
    var subject = clean(o.subject, 80) || "Medicine", topic = clean(o.topic, 160) || subject;
    var t = JSON.parse(JSON.stringify(TEMPLATE));
    t.title = topic; t.exam = examLabel(exam); t.subject = subject; t.topic = topic;
    return [
      "TASK: Write " + n + " " + examLabel(exam) + " multiple choice questions on \"" + topic + "\" (subject: " + subject + ").",
      "Exam style: " + STYLE[exam],
      "Difficulty: " + diffLine(o.diff),
      "",
      "HOW TO REPLY (important): answer immediately with the finished JSON and nothing else. Do not ask me any question, do not write an introduction, notes or a closing line, and do not browse or use tools. Your whole reply is ONE code block holding ONE JSON object that starts with { and ends with }, so I can copy it with one tap. If you can attach a downloadable .json file, give the same JSON as the file instead.",
      "",
      "QUESTIONS:",
      "- Single best answer, exactly 4 options in the order A, B, C, D, one defensible best answer. Distractors are plausible but clearly wrong for a stated reason.",
      "- Options are parallel in form and similar in length; the correct option is not the longest. Never use 'all of the above', 'none of the above' or 'both A and B'. Spread the correct letter across A to D.",
      "- Every question tests a different point. No duplicates or near-duplicates.",
      "- Facts must be current. Follow NICE where it covers the point; for Indian programmes name the body (NACO, ICMR, NTEP) when it matters. Give a dose or cut-off only if you are sure of it.",
      "- Never name a textbook, author, website or coaching brand, never say a question was asked in an exam, and never include a patient name or identifier.",
      "",
      "EXPLANATIONS (this is what the student learns from):",
      "- explanation: 2 to 4 sentences. Why the answer is right, the mechanism or the feature that separates it from the others, then the practical take-home.",
      "- why_wrong: exactly 4 strings in option order. EVERY wrong option gets its own specific reason, 1 to 2 sentences: why that option is not correct here and when it would be the right answer (for example: \"Option B is wrong because ... It would be the answer if ...\"). Never a generic line such as \"not the best answer because it does not match the scenario\". Use \"\" only for the correct option.",
      "- topic_explanation: 3 to 6 sentences on the topic behind the question: the concept, how to tell the options apart, one exam trap. It is shown below the answer.",
      "- key_point: one line to memorise. difficulty: 1 easy, 2 moderate, 3 hard. tags: 1 to 3 short words.",
      "",
      "FORMAT: copy this structure and these field names exactly. Put all " + n + " questions in the \"questions\" array (the example shows one). Plain text only inside the fields: no markdown, no line breaks, no em dash (use a hyphen or a comma).",
      JSON.stringify(t, null, 2),
      "",
      "BEFORE YOU REPLY: check that the JSON is valid (double quotes, no trailing commas, no comments), that there are exactly " + n + " questions, that each answer letter really is the correct option, and that each of the 3 wrong options of every question has its own reason. Then output the JSON block only."
    ].join("\n");
  }

  /* ---------------- text cleaning ---------------- */
  function clean(s, max) {
    s = String(s == null ? "" : s).replace(/[​‌‍﻿]/g, "").replace(/ /g, " ")
      .replace(/\s*—\s*/g, " - ").replace(/–/g, "-").replace(/\s+/g, " ").trim();
    return max && s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") : s;
  }
  /* Some PDFs (Google Docs exports) carry ( ) [ ] - : < > + ~ and the like as private-use glyphs that pdf.js returns as
     U+E0xx. Mapped from this layout by aligning pdf.js against poppler on the INI-SS recall PDF. Unknown ones are dropped and counted. */
  var PUA = { "\ue081": "(", "\ue082": ")", "\ue083": "[", "\ue084": "]", "\ue088": "-", "\ue089": "-", "\ue092": ":", "\ue097": "<", "\ue098": ">", "\ue09b": "=", "\ue09d": "+", "\ue0a3": "~" };
  function decodePua(s, count) {
    return String(s == null ? "" : s).replace(/\ue098\ue09b/g, "\u2265").replace(/\ue097\ue09b/g, "\u2264").replace(/[\ue000-\uf8ff]/g, function (c) {
      if (PUA[c] != null) return PUA[c];
      if (count) count.n++;
      return "";
    });
  }
  /* Template sentences an LLM writes when it has nothing to say about a wrong option ("X is not the best answer because it does
     not match the defining feature..."): they teach nothing, so they are dropped and counted, never shown. */
  var FILLER = /is not the best answer because it does not match|does not match the defining feature|^(?:this|that) (?:option )?is (?:incorrect|wrong|not correct)\.?$|^incorrect\.?$/i;
  /* cleanNotes: the topic explanation keeps its line breaks (bullets and short headings), nothing else. */
  function cleanNotes(s, max) {
    s = String(s == null ? "" : s).replace(/[\u200b\u200c\u200d\ufeff]/g, "").replace(/\r/g, "").replace(/\s*\u2014\s*/g, " - ").replace(/\u2013/g, "-")
      .replace(/[ \t\u00a0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return max && s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") : s;
  }
  function norm(s) { return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function letterOf(v) {
    if (typeof v === "number") return v === 0 ? 0 : v >= 1 && v <= 4 ? v - 1 : -1;
    var m = /^\s*(?:option|ans(?:wer)?|choice)?\s*[\(\[]?\s*([A-Da-d1-4])\s*[\)\].:]?(?:\s|$)/i.exec(String(v == null ? "" : v));
    if (!m) return -1;
    var c = m[1].toUpperCase();
    return c >= "A" && c <= "D" ? c.charCodeAt(0) - 65 : parseInt(c, 10) - 1;
  }
  function pick(o, names) { for (var i = 0; i < names.length; i++) if (o[names[i]] != null && o[names[i]] !== "") return o[names[i]]; return null; }

  /* ---------------- one question from a loose object ---------------- */
  /* normQ(obj, n) -> { it } or { problem } where it = { q, o[4], a, exp, r[4], kp, d, tags } */
  function normQ(x, n) {
    var tag = "Question " + n + ": ";
    if (!x || typeof x !== "object") return { problem: tag + "not a question." };
    var q = clean(pick(x, ["q", "question", "stem", "st"]), 1500);
    var opts = pick(x, ["options", "choices", "o", "opts"]);
    if (opts && !Array.isArray(opts) && typeof opts === "object") opts = LETTERS.map(function (L) { return opts[L] != null ? opts[L] : opts[L.toLowerCase()]; });
    if (!q) return { problem: tag + "no question text." };
    if (!Array.isArray(opts) || opts.length < 4) return { problem: tag + "needs 4 options." };
    opts = opts.slice(0, 5).map(function (t) { return clean(String(t == null ? "" : t).replace(/^\s*[\(\[]?[A-Ea-e][\)\].:]\s+/, ""), 400); });
    var ans = pick(x, ["answer", "correct", "correct_answer", "key", "a", "ans"]), a = letterOf(ans);
    if (opts.length > 4) {
      if (a < 0 || a > 3) return { problem: tag + "has " + opts.length + " options and the answer is not A to D." };
      opts = opts.slice(0, 4);
    }
    if (a < 0 || a > 3) return { problem: tag + "no correct answer (A to D)." };
    if (opts.some(function (t) { return !t; })) return { problem: tag + "an option is empty." };
    var seen = {}; for (var i = 0; i < 4; i++) { var k = norm(opts[i]); if (seen[k]) return { problem: tag + "two options are the same." }; seen[k] = 1; }
    var exp = clean(pick(x, ["explanation", "exp", "why_correct", "rationale"]) || "", 1500);
    var w = pick(x, ["why_wrong", "wrong", "r", "reasons"]), r = ["", "", "", ""], filler = 0;
    if (w && !Array.isArray(w) && typeof w === "object") w = LETTERS.map(function (L) { return w[L] != null ? w[L] : w[L.toLowerCase()]; });
    if (Array.isArray(w)) for (var j = 0; j < 4; j++) {
      r[j] = clean(w[j] || "", 700);
      if (r[j] && FILLER.test(r[j])) { r[j] = ""; if (j !== a) filler++; }
    }
    var gaps = 0; for (var g = 0; g < 4; g++) if (g !== a && !r[g]) gaps++;
    var nt = cleanNotes(pick(x, ["topic_explanation", "topic_notes", "topic_note", "notes", "concept", "background"]) || "", 3000);
    if (exp && !r[a]) r[a] = exp;
    if (!exp) exp = r[a] || "";
    var d = parseInt(pick(x, ["difficulty", "d", "level"]), 10);
    var tg = pick(x, ["tags", "tg", "topics"]);
    tg = Array.isArray(tg) ? tg : typeof tg === "string" ? tg.split(/[,;]/) : [];
    return { filler: filler, gaps: gaps, it: { q: q, o: opts, a: a, exp: exp, r: r, nt: nt, kp: clean(pick(x, ["key_point", "kp", "pearl"]) || "", 400), d: d >= 1 && d <= 3 ? d : 2,
      tags: tg.map(function (t) { return clean(t, 40).toLowerCase(); }).filter(Boolean).slice(0, 4) } };
  }
  function finishParse(title, list) {
    var items = [], problems = [], seen = {}, filler = 0, gapQ = 0, noNotes = 0;
    list.forEach(function (x, i) {
      var r = normQ(x, i + 1);
      if (r.problem) return problems.push(r.problem);
      var k = norm(r.it.q); if (seen[k]) return problems.push("Question " + (i + 1) + ": same as an earlier question.");
      seen[k] = 1; items.push(r.it); filler += r.filler; if (r.gaps) gapQ++; if (!r.it.nt) noNotes++;
    });
    if (items.length > MAX_Q) { problems.push("Only the first " + MAX_Q + " questions are used."); items = items.slice(0, MAX_Q); }
    var notes = [];
    if (filler) notes.push(filler + " generic wrong-option line" + (filler === 1 ? " was" : "s were") + " ignored (they said nothing about the option).");
    if (gapQ) notes.push(gapQ + " question" + (gapQ === 1 ? " has" : "s have") + " no reason for some wrong options. Use Copy the prompt so ChatGPT or Gemini writes one for every wrong option.");
    return { title: clean(title, 120), items: items, problems: problems, notes: notes, noTopic: !!items.length && noNotes === items.length };
  }

  /* ---------------- JSON ---------------- */
  /* parseJson(text) -> { title, items, problems }. Tolerates a code fence, text around the JSON, a bare array, or several
     JSON blocks pasted one after another (replies of 40 questions each). */
  function parseJson(text) {
    var s = String(text || "").replace(/[​﻿]/g, "").replace(/[“”]/g, '"');
    var blocks = [], re = /```(?:json)?\s*([\s\S]*?)```/gi, m;
    while ((m = re.exec(s))) blocks.push(m[1]);
    if (!blocks.length) blocks = [s];
    var title = "", list = [], bad = 0, meta = {};
    blocks.forEach(function (b) {
      var o = null, i = Math.min.apply(null, [b.indexOf("{"), b.indexOf("[")].map(function (v) { return v < 0 ? 1e9 : v; }));
      if (i < 1e9) {
        var open = b.charAt(i), close = open === "{" ? "}" : "]", j = b.lastIndexOf(close);
        if (j > i) { try { o = JSON.parse(b.slice(i, j + 1)); } catch (e) { o = null; } }
      }
      if (o == null) { bad++; return; }
      if (Array.isArray(o)) list = list.concat(o);
      else if (o && typeof o === "object") {
        if (!title && typeof o.title === "string") title = o.title;
        ["exam", "subject", "topic"].forEach(function (k) { if (!meta[k] && typeof o[k] === "string") meta[k] = clean(o[k], 160); });
        var qs = o.questions || o.items || o.mcqs || o.q;
        if (Array.isArray(qs)) list = list.concat(qs); else if (o.options || o.question) list.push(o);
      }
    });
    var res = finishParse(title || meta.topic || "", list);
    res.meta = meta;
    if (res.noTopic) res.notes.push("No topic explanation in this file; the answer screen will show only the explanation. Copy the prompt asks for one.");
    if (!list.length) res.problems.unshift(bad ? "That is not valid JSON. Copy the whole reply, from { to }." : "No questions found in that JSON.");
    return res;
  }

  /* ---------------- PDF in the recall layout ---------------- */
  /* Layout: "MCQ n: Title", then bullets "Topic Discussion:", "Question Stem:", "Options:" (A. to D.), "Correct Answer: Option B",
     "Why Correct:", "Why Other Options Are Wrong:" with "Option A (...):" or "Options B, C and D:" entries. Section headings end it. */
  var LEAD = /^[\s​‌‍﻿●○■▪•◦·◼◾‣\-*]+/;
  var MARK = [
    ["topic", /^Topic Discussion\s*:\s*(.*)$/i], ["stem", /^Question Stem\s*:\s*(.*)$/i], ["opts", /^Options\s*:\s*(.*)$/i],
    ["ans", /^Correct Answer\s*:\s*(.*)$/i], ["why", /^Why Correct\s*:\s*(.*)$/i], ["wrong", /^Why (?:the )?Other Options (?:Are|Is) Wrong\s*:\s*(.*)$/i]
  ];
  function looksLikePdf(lines) { var n = 0; (lines || []).forEach(function (l) { l = decodePua(l); if (/^\W*Question Stem\s*:/i.test(l) || /^\W*Correct Answer\s*:\s*Option/i.test(l)) n++; }); return n >= 2; }
  function parsePdfLines(lines, name) {
    var lost = { n: 0 };
    lines = (lines || []).map(function (l) { return decodePua(l, lost); });
    var cur = null, field = "", cards = [], title = "";
    function start(n, t) { cur = { n: n, title: t, topic: "", stem: "", opts: [], ans: "", why: "", wrong: [] }; cards.push(cur); field = "title"; }
    function add(txt) {
      if (!cur || !txt) return;
      if (field === "title") cur.title += " " + txt;
      else if (field === "opt") { if (cur.opts.length) cur.opts[cur.opts.length - 1] += " " + txt; }
      else if (field === "wrong") { if (cur.wrong.length) cur.wrong[cur.wrong.length - 1].tx += " " + txt; }
      else if (field) cur[field] += " " + txt;
    }
    (lines || []).forEach(function (raw) {
      var l = String(raw == null ? "" : raw).replace(LEAD, "").replace(/\s+/g, " ").trim();
      if (!l) return;
      if (/^Section\s+\d+\s*:/i.test(l) && cur && cur.stem) { cur = null; field = ""; return; }
      var mh = /^MCQ\s+(\d+)\b[^:]*:\s*(.*)$/i.exec(l);
      if (mh) return start(+mh[1], mh[2]);
      if (!cur) return;
      for (var i = 0; i < MARK.length; i++) {
        var mm = MARK[i][1].exec(l);
        if (!mm) continue;
        field = MARK[i][0] === "opts" ? "opt" : MARK[i][0];
        if (field === "opt" && mm[1]) { var o1 = /^\(?([A-Da-d])[\.\)]\s*(.*)$/.exec(mm[1]); if (o1) cur.opts.push(o1[2]); }
        else if (field !== "opt" && field !== "wrong") cur[field] = mm[1];
        return;
      }
      if (field === "opt") {
        var mo = /^\(?([A-Da-d])[\.\)]\s*(.*)$/.exec(l);
        if (mo) { cur.opts.push(mo[2]); return; }
      }
      if (field === "wrong") {
        var mw = /^Options?\s+([A-D](?:\s*(?:,\s*and|,|and|&|\/)\s*[A-D])*)\b[^:]{0,100}:\s*(.*)$/i.exec(l);
        if (mw) { cur.wrong.push({ L: mw[1].toUpperCase().match(/[A-D]/g), tx: mw[2] }); return; }
      }
      add(l);
    });
    var list = cards.map(function (c) {
      var ai = /Option\s*([A-D])|^\s*\(?([A-D])\b/i.exec(c.ans), a = ai ? (ai[1] || ai[2]).toUpperCase() : "";
      var r = ["", "", "", ""];
      c.wrong.forEach(function (w) { (w.L || []).forEach(function (L) { r[L.charCodeAt(0) - 65] = clean(w.tx, 500); }); });
      var kt = clean(c.topic, 400), ke = /[.!?]\s/.exec(kt), kp = ke ? kt.slice(0, ke.index + 1) : kt;
      return { q: c.stem, options: c.opts.slice(0, 5), answer: a, explanation: c.why, why_wrong: r, key_point: kp.length > 300 ? "" : kp, difficulty: 2, tags: [], _n: c.n };
    });
    var res = finishParse(name || "", list.map(function (x) { return x; }));
    // Name the problem by the document's own MCQ number, not the position.
    res.problems = res.problems.map(function (p) { var m = /^Question (\d+):/.exec(p); return m && list[+m[1] - 1] ? p.replace(/^Question \d+:/, "MCQ " + list[+m[1] - 1]._n + ":") : p; });
    if (lost.n) res.notes.unshift(lost.n + " symbol" + (lost.n === 1 ? "" : "s") + " in the PDF could not be read. Check the questions for a missing sign.");
    return res;
  }

  /* ---------------- stored items ---------------- */
  /* toItems(parsed, ctx) -> items in the app's stored schema (the shape prep-qgen.js saves), no qg block.
     ctx: { deckId, sha12 (function), exam, title, owner }. */
  function toItems(parsed, ctx) {
    var c = ctx || {}, sha = c.sha12 || function (s) { return String(s.length); };
    return (parsed.items || []).map(function (x) {
      var xk = x.nt ? { key: x.exp || x.r[x.a] || "", others: LETTERS.reduce(function (o, L, k) { if (k !== x.a && x.r[k]) o[L] = x.r[k]; return o; }, {}), notes: x.nt } : null;
      var it = { id: (c.owner ? "imp_" : "q_") + sha("import:" + (c.deckId || "") + ":" + norm(x.q)), q: x.q, o: x.o.slice(), a: x.a, exp: x.exp || x.r[x.a] || "", t: "gen", d: x.d,
        r: x.r.slice(), kp: x.kp, et: ["", "", "", ""], cog: "recall", tg: x.tags.slice(), fid: "imp", src: { name: c.title || "" }, prov: c.owner ? "SMD" : "USR", gen: "hand",
        ex: c.exam ? [String(c.exam)] : [], pv: "imp1", mv: "", rv: null, imp: 1 };
      if (xk && xk.key) it.x = xk;
      return it;
    });
  }

  var PURE = { promptFor: promptFor, EXAMS: EXAMS, DIFFS: DIFFS, COUNTS: COUNTS, decodePua: decodePua, FORMAT: FORMAT, template: template, prompt: prompt, parseJson: parseJson, parsePdfLines: parsePdfLines, looksLikePdf: looksLikePdf, toItems: toItems, normQ: normQ, clean: clean };
  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
  if (!G || !G.document) return;

  /* ================= UI ================= */
  var is = null;                       // the open import screen's state
  function DK() { return G.PREP_DECKS; }
  function SR() { return G.PREP_SRC; }
  function Q() { return G.PREP_QGEN; }
  function ON(el, ev, fn) { if (el && !el["_im" + ev]) { el["_im" + ev] = 1; el.addEventListener(ev, fn); } }
  function onTop(host) { var r = host.root(); return !!(r && r.querySelector("#imView")); }
  function chip(act, v, label, on) { return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + !!on + '" data-act="' + act + '" data-v="' + v + '">' + label + "</button>"; }
  function seg(label, id, html) { return '<p class="pc-lbl" id="' + id + '">' + label + '</p><div class="pn-wrap pc-seg" role="group" aria-labelledby="' + id + '">' + html + "</div>"; }
  function examFor(host) { var id = ""; try { id = host.exam().id; } catch (e) {} return EXAMS.some(function (x) { return x[0] === id; }) ? id : "neet-pg"; }
  function newState(mode, host) { return { mode: mode, text: "", title: "", parsed: null, busy: "", err: "", done: null, src: "", gen: { exam: examFor(host), subject: "", topic: "", n: 20, diff: "mix" } }; }
  function open(host, mode) {
    is = newState(mode === "owner" ? "owner" : "student", host);
    host.push(function () { render(host); });
  }
  function copy(host, text, what) {
    try { G.navigator.clipboard.writeText(text).then(function () { host.toast(what + " copied."); }, function () { host.toast("Copy did not work. Select the text and copy it."); }); }
    catch (e) { host.toast("Copy did not work. Select the text and copy it."); }
  }
  function subjectNames(host) {
    try { return (host.subjectsOf(/^(neet|ini)-ss$/.test(is.gen.exam) ? "neet-ss" : /^usmle/.test(is.gen.exam) ? "usmle" : "neet-pg") || []).map(function (x) { var n = x && x.name; return String(n && typeof n === "object" ? (n.en || "") : n || x.id || ""); }).filter(Boolean).slice(0, 60); }
    catch (e) { return []; }
  }
  function render(host) {
    var esc = host.esc, p = is.parsed, owner = is.mode === "owner", g = is.gen;
    var sum = "";
    if (p) {
      sum = '<section class="pn-panel" role="status" aria-live="polite"><p><b>' + p.items.length + " question" + (p.items.length === 1 ? "" : "s") + " ready</b>" + (p.problems.length ? " · " + p.problems.length + " skipped" : "") + "</p>" +
        (p.notes && p.notes.length ? '<p class="pn-mut pn-small">' + esc(p.notes.join(" ")) + "</p>" : "") +
        (p.problems.length ? '<ul class="pn-mut pn-small">' + p.problems.slice(0, 8).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + (p.problems.length > 8 ? "<li>and " + (p.problems.length - 8) + " more</li>" : "") + "</ul>" : "") + "</section>";
    }
    var subs = subjectNames(host);
    host.paint(host.bar("Import MCQs", owner ? "Owner: goes to Author review" : "Private module on this phone", "back") + '<div class="pn-body" id="imView">' +
      '<p class="pn-mut">No MaiK Tokens. PrepNucleus writes the prompt, ChatGPT or Gemini writes the questions and explanations, and you bring the reply back here.</p>' +
      '<h2 class="pn-sec">1. Make a prompt</h2>' +
      seg("Exam", "imEL", EXAMS.map(function (x) { return chip("g-imp-exam", x[0], x[1], g.exam === x[0]); }).join("")) +
      '<label class="pc-lbl" for="imSub">Subject</label><input id="imSub" name="subject" class="pc-in" maxlength="80" autocomplete="off" list="imSubList" placeholder="For example Medical Oncology" value="' + esc(g.subject) + '">' +
      '<datalist id="imSubList">' + subs.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join("") + "</datalist>" +
      '<label class="pc-lbl" for="imTop">Topic</label><input id="imTop" name="topic" class="pc-in" maxlength="160" autocomplete="off" placeholder="For example Soft tissue sarcoma" value="' + esc(g.topic) + '">' +
      seg("How many questions", "imNL", COUNTS.map(function (n) { return chip("g-imp-n", n, String(n), g.n === n); }).join("")) +
      seg("Difficulty", "imDL", DIFFS.map(function (d) { return chip("g-imp-diff", d[0], d[1], g.diff === d[0]); }).join("")) +
      '<button type="button" class="pn-btn pri" data-act="g-imp-copyg">Copy the prompt</button>' +
      '<div class="pn-wrap"><button type="button" class="pn-btn" data-act="g-imp-chatgpt">Open ChatGPT</button><button type="button" class="pn-btn" data-act="g-imp-gemini">Open Gemini</button>' +
      (G.navigator && G.navigator.share ? '<button type="button" class="pn-btn" data-act="g-imp-share">Share</button>' : "") + "</div>" +
      '<p class="pn-mut pn-small">Paste the prompt into ChatGPT or Gemini and send. It answers with one code block: tap its copy button, come back here and paste. A downloadable .json file works too.</p>' +
      '<h2 class="pn-sec">2. Bring the reply back</h2>' +
      '<label class="pc-lbl" for="imText">Paste the reply</label><textarea id="imText" name="json" class="pc-in pc-ta" rows="5" placeholder="{ &quot;format&quot;: &quot;' + FORMAT + '&quot; ... }">' + esc(is.text) + "</textarea>" +
      '<button type="button" class="pn-btn" data-act="g-imp-read"' + (is.busy ? " disabled" : "") + ">Read the pasted reply</button>" +
      '<button type="button" class="pc-drop" data-act="g-imp-pick"' + (is.busy ? " disabled" : "") + '><span class="pn-ic sm" style="--h:174" aria-hidden="true">' + host.ico("dl") + "</span><span><b>" + (is.src ? esc(is.src) : "Or choose a file") + "</b><small>The .json or .txt file ChatGPT or Gemini gave you, or a PDF in the INI-SS recall layout</small></span></button>" +
      '<input type="file" id="imFile" accept="application/pdf,.pdf,application/json,.json,.txt,text/plain" hidden aria-hidden="true" tabindex="-1">' +
      '<p class="pn-mut pn-small">Already have the questions in a PDF? <button type="button" class="pn-link" data-act="g-imp-copyp">Copy the convert prompt</button> and give it to ChatGPT or Gemini with the PDF.</p>' +
      (is.busy ? '<section class="pn-panel pc-readp" role="status" aria-live="polite"><span class="pc-spin" aria-hidden="true"></span><p class="pn-load">' + esc(is.busy) + "</p></section>" : "") +
      (is.err ? '<p class="pn-err" role="alert" id="imErr" tabindex="-1">' + esc(is.err) + "</p>" : "") + sum +
      (p && p.items.length && !owner ? '<label class="pc-lbl" for="imTitle">Module name</label><input id="imTitle" name="title" class="pc-in" maxlength="120" autocomplete="off" value="' + esc(is.title || p.title) + '">' +
        '<button type="button" class="pn-btn pri" data-act="g-imp-make"' + (is.busy ? " disabled" : "") + ">Make the module (" + p.items.length + " questions)</button>" : "") +
      (p && p.items.length && owner ? '<button type="button" class="pn-btn pri" data-act="g-imp-add">Add ' + p.items.length + " to the Author review list</button>" : "") +
      (is.done ? '<section class="pn-panel" role="status"><p><b>' + is.done.n + " questions saved.</b></p><button type=\"button\" class=\"pn-btn pri\" data-act=\"g-open\" data-d=\"" + esc(is.done.id) + '">Open the module</button></section>' : "") +
      "</div>", is.err ? "#imErr" : null);
    var r = host.root(); if (!r) return;
    ON(r.querySelector("#imText"), "input", function () { is.text = r.querySelector("#imText").value; });
    ON(r.querySelector("#imTitle"), "input", function () { is.title = r.querySelector("#imTitle").value; });
    ON(r.querySelector("#imSub"), "input", function () { is.gen.subject = r.querySelector("#imSub").value; });
    ON(r.querySelector("#imTop"), "input", function () { is.gen.topic = r.querySelector("#imTop").value; });
    ON(r.querySelector("#imFile"), "change", function () { var f = r.querySelector("#imFile"); if (f.files && f.files[0]) pickFile(f.files[0], host); });
  }
  function fail(host, m) { is.err = m; is.busy = ""; if (onTop(host)) host.rerender(); }
  function setParsed(host, res, name) {
    is.busy = ""; is.err = ""; is.done = null; is.parsed = res;
    if (!is.title) is.title = res.title || String(name || "").replace(/\.(pdf|json|txt)$/i, "").slice(0, 120);
    if (!res.items.length) is.err = res.problems[0] || "No questions were found.";
    if (onTop(host)) host.rerender();
  }
  function readJson(host) {
    var r = host.root(), ta = r && r.querySelector("#imText"); if (ta) is.text = ta.value;
    if (!is.text.trim()) return fail(host, "Paste the JSON first.");
    is.src = "";
    var res = parseJson(is.text);
    // A second paste adds to the first (replies of 40 questions each).
    if (is.parsed && is.parsed.items.length && res.items.length) {
      var seen = {}; is.parsed.items.forEach(function (x) { seen[norm(x.q)] = 1; });
      res.items = res.items.filter(function (x) { return !seen[norm(x.q)]; });
      res.items = is.parsed.items.concat(res.items); res.title = is.parsed.title || res.title;
    }
    setParsed(host, res, "");
    if (res.items.length) is.text = "";
  }
  function pickFile(file, host) {
    is.err = ""; is.parsed = null; is.done = null; is.src = file.name;
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return readPdf(file, host);
    is.busy = "Reading the file…"; host.rerender();
    var fr = new G.FileReader();
    fr.onload = function () { setParsed(host, parseJson(String(fr.result || "")), file.name); };
    fr.onerror = function () { fail(host, "That file could not be read."); };
    fr.readAsText(file);
  }
  /* The app's PDF reader scrubs hyphens, brackets and whole pages it calls garbled; questions need the text as written, so the
     lines come straight from pdf.js (hasEOL marks a line end). */
  function rawLines(doc, pages) {
    var out = [], i = 0;
    function next() {
      if (i >= pages.length) return Promise.resolve(out);
      return doc.getPage(pages[i++]).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
        var t = (tc.items || []).map(function (it) { return (it.str || "") + (it.hasEOL ? "\n" : ""); }).join("");
        t.split("\n").forEach(function (l) { out.push(l); });
        return next();
      });
    }
    return next();
  }
  function readPdf(file, host) {
    if (!SR()) return fail(host, "PDFs cannot be read here. Use the JSON route.");
    is.busy = "Opening the PDF…"; host.rerender();
    SR().openPdf(file).then(function (pdf) {
      var total = Math.min(pdf.pages, PAGE_MAX), lines = [], at = 1;
      function step() {
        if (at > total) return done();
        var pages = [], to = Math.min(total, at + PAGE_STEP - 1);
        for (var p = at; p <= to; p++) pages.push(p);
        is.busy = "Reading pages " + at + " to " + to + " of " + total + "…"; if (onTop(host)) host.rerender();
        return rawLines(pdf.doc, pages).then(function (got) { got.forEach(function (l) { lines.push(l); }); at = to + 1; return step(); });
      }
      function done() {
        if (!looksLikePdf(lines)) {
          return fail(host, "This PDF is not laid out like the recall documents (MCQ 1:, Question Stem, Options, Correct Answer). Copy the prompt, give the PDF to ChatGPT or Gemini, and paste the JSON it returns.");
        }
        setParsed(host, parsePdfLines(lines, file.name.replace(/\.pdf$/i, "")), file.name);
      }
      return step();
    }, function () { fail(host, "This PDF could not be opened. It may be protected by a password or damaged."); }).then(null, function () { fail(host, "This PDF could not be read."); });
  }
  function make(host) {
    var p = is.parsed, D = DK(); if (!p || !p.items.length || !D) return;
    var title = clean(is.title || p.title || "Imported module", 120) || "Imported module", now = Date.now();
    var id = "imp_" + D.sha12("import:" + now + ":" + Math.random() + ":" + title);
    var exam = is.gen.exam;
    var items = toItems(p, { deckId: id, sha12: D.sha12, exam: exam, title: title, owner: false });
    items.forEach(function (it) { it.deckId = id; it._s = "deck"; it._m = "deck-" + id; });
    var m = D.newManifest({ id: id, title: title, exam: exam, profileV: 1, pv: "imp1", model: "import", source: { type: "import", name: title, pages: null, sha: id }, now: now });
    m.prov = "hand"; m.stats.generated = items.length; m.stats.accepted = items.length;
    m.topics = D.topicsFor(id, items, [{ id: "gen", title: title }]);
    is.busy = "Saving…"; host.rerender();
    D.putItems(items).then(function () { return D.putDeck(m); }).then(function () {
      D.changed(id); is.busy = ""; is.done = { id: id, n: items.length }; is.parsed = null; is.src = "";
      if (onTop(host)) host.rerender(); host.toast(items.length + " questions saved.");
    }, function () { fail(host, "The questions could not be saved on this phone."); });
  }
  function addOwner(host) {
    var p = is.parsed, a = Q() && Q()._au && Q()._au(); if (!p || !p.items.length || !a) return;
    var D = DK(), items = toItems(p, { deckId: "own", sha12: D.sha12, exam: a.exam, title: is.title || p.title, owner: true });
    var have = {}; a.list.forEach(function (r) { have[r.it.id] = 1; });
    var n = 0; items.forEach(function (it) { if (!have[it.id]) { a.list.push({ it: it, st: "" }); n++; } });
    if (Q().saveAuthor) Q().saveAuthor();
    is.parsed = null; is.src = ""; is.title = "";
    host.back(); host.toast(n + " added to the review list.");
  }

  function openOut(host, url) { try { G.open(url, "_blank", "noopener"); } catch (e) { host.toast("Could not open the app. Paste the prompt there yourself."); } }
  function readGen(host) {
    var r = host.root(), sv = r && r.querySelector("#imSub"), tv = r && r.querySelector("#imTop");
    if (sv) is.gen.subject = sv.value; if (tv) is.gen.topic = tv.value;
    if (!clean(is.gen.topic) && !clean(is.gen.subject)) { host.toast("Type a subject or a topic first."); return null; }
    return promptFor(is.gen);
  }
  function act(a, el, host) {
    if (a === "g-imp") return open(host, "student");
    if (a === "g-imp-owner") return open(host, "owner");
    if (!is) return;
    var v = el && el.getAttribute("data-v");
    if (a === "g-imp-exam") { is.gen.exam = v; return host.rerender(); }
    if (a === "g-imp-n") { is.gen.n = +v || 20; return host.rerender(); }
    if (a === "g-imp-diff") { is.gen.diff = v; return host.rerender(); }
    if (a === "g-imp-copyg") { var t0 = readGen(host); return t0 && copy(host, t0, "Prompt"); }
    if (a === "g-imp-chatgpt") { var t1 = readGen(host); if (!t1) return; copy(host, t1, "Prompt"); return openOut(host, "https://chatgpt.com/?q=" + encodeURIComponent(t1)); }
    if (a === "g-imp-gemini") { var t2 = readGen(host); if (!t2) return; copy(host, t2, "Prompt"); return openOut(host, "https://gemini.google.com/app"); }
    if (a === "g-imp-share") { var t3 = readGen(host); if (!t3) return; try { return G.navigator.share({ text: t3 }); } catch (e) { return copy(host, t3, "Prompt"); } }
    if (a === "g-imp-copyp") return copy(host, prompt(), "Prompt");
    if (a === "g-imp-read") return readJson(host);
    if (a === "g-imp-pick") { var f = host.root() && host.root().querySelector("#imFile"); if (f) { f.value = ""; f.click(); } return; }
    if (a === "g-imp-make") return make(host);
    if (a === "g-imp-add") return addOwner(host);
  }
  G.PREP_IMPORT = { act: act, open: open, _pure: PURE, _state: function () { return is; } };
})(typeof window !== "undefined" ? window : this);
