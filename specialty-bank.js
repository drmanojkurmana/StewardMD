/* Specialty engine question bank. ES5. SPECIALTY.features.bank(host, opts).
   Deck format (split for phone performance): <base>decks/mcq/index.json = {id, v, source, licence, sourceCommit, citation,
   modifications, counts, flagLegend?, topics: [{id, title:{en,hi}, group?, count, file: "mcq/<topic>.json"}]} and one file
   per topic {topic, items: [{id, q, o:[4], a, exp, t, d: 1|2|3, flags?}]}. The index loads with the module; a topic file
   loads the first time a set needs it (study by topic: one file; mixed sets, search, flagged and the timed exam load
   what they need and show progress). A single-file deck (items in the index, explanation "x", topics as an id -> label map)
   still reads. MBBS sets draw d 1 and 2; Resident draws all (Pro, one trial: bank.resident); the timed exam is Pro
   with one trial (exam). Every answer is an FSRS review under the bank's deck key, so each question comes back just
   before it would be forgotten. Questions are English (MedMCQA); the chrome follows the module language.
   Pure helpers (validate, topics, search, exam picks, due topics) load under node for tests. */
(function (G) {
  "use strict";
  var EXAM_N = 30, EXAM_SEC = 90;

  /* ================= pure ================= */
  function isBi(v) { return v && typeof v === "object" && typeof v.en === "string" && v.en.trim(); }
  // Topics as [{id, title:{en,hi}, group?, count, file}], from the contract's list or the older id -> label map.
  function topics(deck) {
    var t = deck && deck.topics;
    if (!t) return [];
    if (Array.isArray(t)) return t.map(function (x) { return { id: x.id, title: typeof x.title === "string" ? { en: x.title } : x.title, group: x.group, count: x.count == null ? null : x.count, file: x.file || null }; });
    return Object.keys(t).map(function (id) { return { id: id, title: typeof t[id] === "string" ? { en: t[id] } : t[id], count: null, file: null }; });
  }
  function explanation(it) { return (it && (it.exp != null ? it.exp : it.x)) || ""; }
  function validateIndex(ix) {
    if (!ix || !ix.topics) return ["index: needs {topics: [...]}"];
    var e = [], seen = {};
    if (!ix.licence && !ix.license) e.push("licence: missing");
    if (!ix.citation) e.push("citation: missing");
    topics(ix).forEach(function (t, i) {
      var w = "topics[" + i + "]";
      if (typeof t.id !== "string" || !/^[a-z0-9-]+$/.test(t.id)) e.push(w + ".id: lowercase letters, digits and hyphens");
      else if (seen[t.id]) e.push(w + ".id: duplicate " + t.id);
      seen[t.id] = 1;
      if (!isBi(t.title)) e.push(w + ".title: needs {en, hi}");
      if (!ix.items && !(typeof t.file === "string" && /^mcq\/[a-z0-9-]+\.json$/.test(t.file))) e.push(w + ".file: mcq/<topic>.json");
      if (!ix.items && !(t.count >= 0)) e.push(w + ".count: a number");
    });
    return e;
  }
  // Items of one or more topics. An empty explanation is allowed (the source has none); the bank says so.
  function validateItems(items, topicIds) {
    var e = [], seen = {};
    (items || []).forEach(function (it, i) {
      var w = it && it.id != null ? String(it.id) : "items[" + i + "]";
      if (seen[w]) e.push("duplicate id " + w);
      seen[w] = 1;
      if (!it || typeof it.q !== "string" || !it.q.trim()) e.push(w + ": question text");
      var o = it && it.o;
      if (!Array.isArray(o) || o.length !== 4 || o.some(function (x) { return typeof x !== "string" || !x.trim(); }) ||
        o.map(function (x) { return String(x).toLowerCase().trim(); }).filter(function (x, j, a) { return a.indexOf(x) === j; }).length !== 4) e.push(w + ": 4 distinct options");
      if (!(it && it.a === (it.a | 0) && it.a >= 0 && it.a <= 3)) e.push(w + ": answer index 0 to 3");
      if (topicIds && topicIds.indexOf(it && it.t) < 0) e.push(w + ": unknown topic " + (it && it.t));
      if (it && it.d != null && [1, 2, 3].indexOf(it.d) < 0) e.push(w + ": d must be 1, 2 or 3");
      if (it && it.flags != null && !Array.isArray(it.flags)) e.push(w + ": flags a list");
      if (it && typeof explanation(it) !== "string") e.push(w + ": explanation text");
    });
    return e;
  }
  function byTopic(items) { var m = {}; (items || []).forEach(function (it) { (m[it.t] || (m[it.t] = [])).push(it); }); return m; }
  function hay(it) { return it._hay || (it._hay = (it.q + " " + it.o.join(" ")).toLowerCase()); }
  function search(items, term, max) {
    term = String(term || "").trim().toLowerCase();
    if (term.length < 3) return [];
    var out = [], cap = max || 25;
    for (var i = 0; i < items.length && out.length < cap; i++) if (hay(items[i]).indexOf(term) !== -1) out.push(items[i]);
    return out;
  }
  function examPick(items, n, rnd) {
    var all = items.slice(), out = [];
    rnd = rnd || Math.random;
    while (out.length < n && all.length) out.push(all.splice(Math.floor(rnd() * all.length), 1)[0]);
    return out;
  }
  // Topics for a timed exam: n distinct topics with questions, chosen with chance by size.
  function examTopics(ts, n, rnd) {
    var pool = ts.filter(function (t) { return t.count == null || t.count > 0; }).slice(), out = [];
    rnd = rnd || Math.random;
    while (out.length < n && pool.length) {
      var tot = 0, i, r;
      pool.forEach(function (t) { tot += t.count == null ? 1 : t.count; });
      r = rnd() * tot;
      for (i = 0; i < pool.length - 1; i++) { r -= pool[i].count == null ? 1 : pool[i].count; if (r < 0) break; }
      out.push(pool.splice(i, 1)[0].id);
    }
    return out;
  }
  // Topics of the cards due by day, from store.mcqT (the topic recorded when each question was answered).
  function dueTopics(store, deckKey, day) {
    var pre = deckKey + ":", out = [], key, t;
    for (key in store.cards) {
      if (key.indexOf(pre) !== 0 || store.cards[key][3] > day) continue;
      t = store.mcqT && store.mcqT[key.slice(pre.length)];
      if (t && out.indexOf(t) < 0) out.push(t);
    }
    return out;
  }

  var PURE = { EXAM_N: EXAM_N, EXAM_SEC: EXAM_SEC, topics: topics, explanation: explanation, validateIndex: validateIndex, validateItems: validateItems,
    byTopic: byTopic, search: search, examPick: examPick, examTopics: examTopics, dueTopics: dueTopics };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  var SP = G.SPECIALTY || (G.SPECIALTY = {});
  if (!SP.features) SP.features = {};
  SP.BANK = PURE;

  /* ================= UI (browser) ================= */
  SP.features.bank = function (host, opts) {
    opts = opts || {};
    var I = host._internal, st = host._st, cfg = host.cfg, C = G.SPECIALTY_CORE, D = G.SPECIALTY_DATA, A = I.ACTIONS, K = I.KEYS;
    var ico = I.ico, esc = I.esc, fmt = I.fmt;
    var DECK = opts.id || "mcq", INDEX = opts.index || "decks/mcq/index.json", SIZE = 20, NEW_CAP = 20, MIX_TOPICS = 3;
    var LETTERS = ["A", "B", "C", "D"];
    function T(en, hi) { return { en: en, hi: hi }; }
    var STR = {
      title: T("Question bank", "प्रश्न बैंक"), sub: T("Explained answers", "व्याख्या सहित उत्तर"),
      rowNew: T("Study sets, topics, timed exam", "अभ्यास सेट, विषय, टाइम्ड परीक्षा"), rowSeen: T("{n} answered", "{n} उत्तर दिए"), rowDue: T("{n} due", "{n} बाकी"),
      nQ: T("{n} questions", "{n} प्रश्न"), loading: T("Loading questions…", "प्रश्न लोड हो रहे हैं…"), loadingN: T("Loading questions: {d} of {n} topics", "प्रश्न लोड हो रहे हैं: {n} में से {d} विषय"),
      loadErr: T("The questions did not load. Check the connection and try again.", "प्रश्न लोड नहीं हुए। कनेक्शन जांचें और फिर कोशिश करें।"), retry: T("Try again", "फिर कोशिश करें"),
      none: T("The question bank is being prepared. It will appear here soon.", "प्रश्न बैंक तैयार हो रहा है। यह जल्द ही यहाँ दिखेगा।"),
      back: T("Back to Test", "टेस्ट पर वापस"), backBank: T("Back to question bank", "प्रश्न बैंक पर वापस"),
      mode: T("Mode", "मोड"), study: T("Study", "अभ्यास"), exam: T("Exam", "परीक्षा"),
      studyLine: T("Each answer is marked at once, with its explanation.", "हर उत्तर तुरंत जाँचा जाता है, व्याख्या के साथ।"),
      examLine: T("{n} questions, {m} minutes, marked at the end.", "{n} प्रश्न, {m} मिनट, अंत में जाँच।"),
      mbbsLine: T("MBBS: easy and medium questions. Switch to Resident on the Test tab for hard ones.", "MBBS: आसान और मध्यम प्रश्न। कठिन प्रश्नों के लिए टेस्ट टैब पर Resident चुनें।"),
      resLine: T("Resident: every question, hard clinical vignettes included.", "Resident: सभी प्रश्न, कठिन क्लिनिकल केस भी।"),
      due: T("{n} due for review", "{n} दोहराने बाकी"), noDue: T("No reviews due. Carry on with new questions.", "कोई दोहराना बाकी नहीं। नए प्रश्नों से जारी रखें।"),
      fresh: T("Start with a mixed set.", "एक मिश्रित सेट से शुरू करें।"), startQ: T("Start questions", "प्रश्न शुरू करें"), startExam: T("Start exam", "परीक्षा शुरू करें"),
      topics: T("Topics", "विषय"), obstetrics: T("Obstetrics", "प्रसूति"), gynaecology: T("Gynaecology", "स्त्री रोग"),
      topicLine: T("{n} questions", "{n} प्रश्न"), topicAns: T("{a} answered · {p}% right", "{a} उत्तर · {p}% सही"),
      search: T("Search", "खोजें"), searchPh: T("Word or phrase, for example eclampsia", "शब्द या वाक्यांश, जैसे eclampsia"),
      searching: T("Searching: {d} of {n} topics loaded", "खोज: {n} में से {d} विषय लोड हुए"), noHit: T("No question mentions that.", "किसी प्रश्न में यह नहीं मिला।"),
      flagged: T("{n} flagged.", "{n} चिह्नित।"), reviewFlagged: T("Review flagged", "चिह्नित देखें"),
      qOf: T("Question {i} of {n}", "प्रश्न {i} / {n}"), left: T("{t} left", "{t} बाकी"),
      flag: T("Flag this answer key", "इस उत्तर-कुंजी को चिह्नित करें"), unflag: T("Remove flag", "चिह्न हटाएँ"),
      flaggedT: T("Flagged for review", "समीक्षा के लिए चिह्नित"), unflaggedT: T("Flag removed", "चिह्न हटाया"),
      nextQ: T("Next question", "अगला प्रश्न"), finish: T("Finish", "समाप्त"), finishMark: T("Finish and mark", "समाप्त करें और जाँचें"),
      right: T("Right", "सही"), wrong: T("Not this one", "यह नहीं"), answer: T("Answer {k}. {o}", "उत्तर {k}. {o}"), chose: T("; you chose {k}.", "; आपने {k} चुना।"),
      expl: T("Explanation", "व्याख्या"), noExpl: T("The source gives no explanation for this question.", "स्रोत में इस प्रश्न की व्याख्या नहीं है।"),
      doubt: T("The answer key may be wrong:", "उत्तर-कुंजी गलत हो सकती है:"), doubtAny: T("The source marks this key as doubtful.", "स्रोत में यह उत्तर-कुंजी संदिग्ध है।"),
      examDone: T("Exam marked", "परीक्षा जाँची गई"), setDone: T("Set finished", "सेट पूरा"), sumSub: T("{n} questions · {m} min", "{n} प्रश्न · {m} मिनट"),
      score: T("{ok} of {n} right · {p}%", "{n} में से {ok} सही · {p}%"), byTopic: T("By topic", "विषय अनुसार"), missed: T("Missed", "गलत"),
      retryMissed: T("Retry the missed", "गलत वाले फिर करें"), nextSet: T("Next set", "अगला सेट"),
      comeBack: T("{n} questions come back for review by tomorrow.", "कल तक {n} प्रश्न दोहराने के लिए लौटेंगे।"), comeBack0: T("Nothing comes back tomorrow.", "कल कुछ नहीं लौटेगा।"),
      srcLine: T("Questions and explanations: {c} Licence {l}. {m} Answer keys are crowd-sourced: flag any that look wrong.", "प्रश्न और व्याख्या: {c} लाइसेंस {l}। {m} उत्तर-कुंजियाँ crowd-sourced हैं: जो गलत लगे उसे चिह्नित करें।"),
      nothing: T("Nothing waiting here today", "आज यहाँ कुछ बाकी नहीं"), qEnglish: T("Questions are in English.", "प्रश्न अंग्रेज़ी में हैं।")
    };
    var own = (cfg.strings && cfg.strings.bank) || {}, k;
    for (k in own) if (Object.prototype.hasOwnProperty.call(own, k)) STR[k] = own[k];
    function L() { return I.lang(); }
    function s(key, v) { return esc(D.t(STR[key], L())).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; }); }
    function rawS(key) { return D.t(STR[key], L()); }
    function en(text) { return L() === "hi" ? '<span lang="en">' + esc(text) + "</span>" : esc(text); }

    var Q = { ix: null, missing: false, err: null, loading: null, items: {}, inflight: {}, run: null, mode: "study", timer: 0, searchId: 0 };
    function $(id) { return G.document.getElementById(id); }
    function flags() { return st.store.flags || (st.store.flags = {}); }
    function topicList() { return Q.ix ? topics(Q.ix) : []; }
    function topicOf(id) { var r = null; topicList().forEach(function (t) { if (t.id === id) r = t; }); return r; }
    function topicLabel(id) { var t = topicOf(id); return t ? I.tx(t.title) : esc(id); }
    function pool(items) { return D.mcqPool(items, I.level()); }
    function levelGate(run) { return I.level() === "resident" ? I.gate("bank.resident", run) : run(); }

    /* ---------- data ---------- */
    // Never rejects: a missing index (404) is "being prepared"; any other failure is Q.err.
    function load() {
      if (Q.ix) return Promise.resolve(Q.ix);
      if (Q.loading) return Q.loading;
      Q.err = null;
      Q.loading = I.getJSON(INDEX).then(function (ix) {
        Q.ix = ix; Q.missing = false;
        if (ix.items) { var m = byTopic(ix.items); topics(ix).forEach(function (t) { Q.items[t.id] = m[t.id] || []; }); }
      }, function (e) { if (e && e.status === 404) Q.missing = true; else Q.err = e; }).then(function () { Q.loading = null; return Q.ix; });
      return Q.loading;
    }
    function loadTopic(id) {
      if (Q.items[id]) return Promise.resolve(Q.items[id]);
      if (Q.inflight[id]) return Q.inflight[id];
      var t = topicOf(id);
      if (!t || !t.file) return Promise.reject(new Error("no topic " + id));
      return (Q.inflight[id] = I.getJSON("decks/" + t.file).then(function (f) {
        delete Q.inflight[id];
        Q.items[id] = (f.items || []).filter(function (it) { return it.t === id || it.t == null; });
        Q.items[id].forEach(function (it) { if (it.t == null) it.t = id; });
        return Q.items[id];
      }, function (e) { delete Q.inflight[id]; throw e; }));
    }
    // Load several topics, calling back with progress; resolves with their items.
    function loadTopics(ids, progress) {
      var n = 0;
      if (progress) progress(ids.filter(function (id) { return Q.items[id]; }).length, ids.length);
      return Promise.all(ids.map(function (id) {
        return loadTopic(id).then(function (x) { n++; if (progress) progress(ids.filter(function (y) { return Q.items[y]; }).length, ids.length); return x; });
      })).then(function (lists) { var out = []; lists.forEach(function (l) { out = out.concat(l); }); return out; });
    }
    function itemById(id) { var r = null, t; for (t in Q.items) Q.items[t].forEach(function (it) { if (!r && String(it.id) === String(id)) r = it; }); return r; }
    function stats() {
      var d = I.today(), seen = 0, due = 0, key;
      for (key in st.store.cards) if (key.indexOf(DECK + ":") === 0) { seen++; if (st.store.cards[key][3] <= d) due++; }
      return { seen: seen, due: due };
    }
    function levelCount() {
      var c = Q.ix && Q.ix.counts;
      if (!c) return topicList().reduce(function (a, t) { return a + (t.count || 0); }, 0);
      return I.level() === "resident" ? c.total : (c.d1 || 0) + (c.d2 || 0);
    }

    /* ---------- screens ---------- */
    function wait(line) {
      st.view = "mcq-load"; st.again = null; st.onBack = function () { renderBank(); return true; };
      I.paint(I.top(rawS("backBank"), s("title"), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="sp-mut" role="status" id="mcqWait">' + line + "</p></div></div>");
    }
    function progressLine(d, n) { var el = $("mcqWait"); if (el) el.textContent = D.t(STR.loadingN, L()).replace("{d}", d).replace("{n}", n); }
    function failed() {
      if (st.view !== "mcq-load") return;
      I.paint(I.top(rawS("backBank"), s("title"), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col"><p role="alert">' + s("loadErr") + "</p>" +
        '<button type="button" class="sp-btn pri" data-act="mcqbank">' + ico("refresh") + " " + s("retry") + "</button></div></div>", ".sp-btn");
    }
    function open() {
      stopTimer();
      I.leave();
      if (Q.mode === "exam" && I.trial("exam") === "used") Q.mode = "study";
      if (!Q.ix && !Q.missing) {
        st.view = "mcq-bank"; st.again = null;
        I.paint(I.top(rawS("back"), s("title"), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="sp-mut" role="status">' + s("loading") + "</p></div></div>");
        load().then(function () { if (st.view === "mcq-bank") renderBank(); });
        return;
      }
      renderBank();
    }

    function renderBank(focusSel) {
      stopTimer();
      st.view = "mcq-bank"; st.onBack = null; st.again = renderBank; st.onLeave = stopTimer;
      if (!Q.ix) {
        return I.paint(I.top(rawS("back"), s("title"), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col"><section class="sp-today" role="' + (Q.err ? "alert" : "status") + '"><p class="sp-today-line">' +
          (Q.err ? s("loadErr") : s("none")) + "</p>" + (Q.err ? '<button type="button" class="sp-btn pri" data-act="mcqretry">' + ico("refresh") + " " + s("retry") + "</button>" : "") + "</section></div></div>", focusSel);
      }
      var sx = stats(), ex = I.trial("exam"), conf = st.store.conf[DECK] || {}, groups = {}, order = [];
      if (Q.mode === "exam" && ex === "used") Q.mode = "study";
      topicList().forEach(function (t) { var g = t.group || "_"; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(t); });
      var rows = order.map(function (g) {
        return (g !== "_" && STR[g] ? '<h3 class="sp-h3 mcq-group">' + s(g) + "</h3>" : "") + '<ul class="mcq-topics">' + groups[g].map(function (t) {
          var row = conf[t.id] || {}, ans = 0, right = row[t.id] || 0, x;
          for (x in row) ans += row[x];
          var line = (t.count != null ? s("topicLine", { n: fmt(t.count) }) : "") + (ans ? " · " + s("topicAns", { a: fmt(ans), p: Math.round(right * 100 / ans) }) : "");
          return '<li><button type="button" class="mcq-topic" data-act="mcqtopic" data-t="' + esc(t.id) + '"><span class="mcq-topic-b"><b>' + I.tx(t.title) + '</b><span class="sp-small">' + line + "</span></span>" +
            '<span class="sp-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
        }).join("") + "</ul>";
      }).join("");
      var nf = Object.keys(flags()).length, lv = I.level();
      var seg = '<div class="sp-seg" role="group" aria-label="' + s("mode") + '">' +
        '<button type="button" data-act="mcqmode" data-m="study" aria-pressed="' + (Q.mode === "study") + '">' + s("study") + "</button>" +
        '<button type="button" data-act="mcqmode" data-m="exam" aria-pressed="' + (Q.mode === "exam") + '">' + s("exam") + (ex === "open" ? "" : " " + I.lockBadge("exam")) + "</button></div>";
      var src = Q.ix;
      I.paint(I.top(rawS("back"), s("title"), s("nQ", { n: fmt(levelCount()) }), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col">' +
        '<div class="sp-levelrow">' + seg + '<span class="sp-small">' + (Q.mode === "exam" ? s("examLine", { n: EXAM_N, m: EXAM_N * EXAM_SEC / 60 }) : s("studyLine")) + "</span></div>" +
        '<section class="sp-today" aria-label="' + s("title") + '"><p class="sp-small mcq-level">' + (lv === "resident" ? s("resLine") + (I.trial("bank.resident") === "open" ? "" : " " + I.lockBadge("bank.resident")) : s("mbbsLine")) +
        (L() === "hi" ? " " + s("qEnglish") : "") + '</p><p class="sp-today-line">' +
        (sx.due ? "<b>" + s("due", { n: fmt(sx.due) }) + "</b>" : sx.seen ? s("noDue") : s("fresh")) + "</p>" +
        '<button type="button" class="sp-btn pri sp-wide" data-act="mcqstart">' + ico("play") + " " + (Q.mode === "exam" ? s("startExam") : s("startQ")) + "</button></section>" +
        '<h2 class="sp-h2">' + s("topics") + "</h2>" + rows +
        '<h2 class="sp-h2" id="mcqSearchH">' + s("search") + '</h2><div class="mcq-search"><input type="search" id="mcqSearch" placeholder="' + s("searchPh") + '" aria-labelledby="mcqSearchH" aria-describedby="mcqSearchS" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>' +
        '<p class="sp-small" id="mcqSearchS" role="status"></p><ul class="mcq-results" id="mcqResults"></ul>' +
        (nf ? '<p class="sp-small">' + s("flagged", { n: fmt(nf) }) + ' <button type="button" class="sp-link" data-act="mcqflagged">' + s("reviewFlagged") + "</button></p>" : "") +
        '<p class="sp-note">' + s("srcLine", { c: src.citation || src.source || "", l: src.licence || src.license || "", m: src.modifications || "" }) + "</p></div></div>", focusSel);
      var inp = $("mcqSearch"), tm = 0;
      if (inp) inp.addEventListener("input", function () { G.clearTimeout(tm); tm = G.setTimeout(function () { runSearch(inp.value); }, 200); });
    }

    // Search loads the topic files it has not seen yet, one by one, and lists hits as they arrive.
    function runSearch(term) {
      var out = $("mcqResults"), stat = $("mcqSearchS"), id = ++Q.searchId, ids = topicList().map(function (t) { return t.id; });
      if (!out) return;
      function paintHits() {
        if (id !== Q.searchId || !$("mcqResults")) return;
        var have = [], x;
        for (x in Q.items) have = have.concat(Q.items[x]);
        var hits = search(have, term);
        out.innerHTML = hits.length ? hits.map(function (it) {
          return '<li><button type="button" class="mcq-hit" data-act="mcqone" data-id="' + esc(it.id) + '"><span>' + en(it.q) + '</span><span class="sp-small">' + topicLabel(it.t) + "</span></button></li>";
        }).join("") : "";
        var d = ids.filter(function (y) { return Q.items[y]; }).length;
        stat.textContent = d < ids.length ? D.t(STR.searching, L()).replace("{d}", d).replace("{n}", ids.length) : hits.length ? "" : D.t(STR.noHit, L());
      }
      if (String(term || "").trim().length < 3) { out.innerHTML = ""; stat.textContent = ""; return; }
      paintHits();
      ids.reduce(function (p, tid) { return p.then(function () { if (id !== Q.searchId) return; return loadTopic(tid).then(paintHits, function () {}); }); }, Promise.resolve()).then(paintHits);
    }

    /* ---------- a run of questions ---------- */
    function start(items, exam) {
      if (!items.length) { I.toast(rawS("nothing")); renderBank(); return; }
      Q.run = { items: items, i: 0, exam: !!exam, picks: [], done: false, t0: Date.now(), limit: exam ? items.length * EXAM_SEC : 0 };
      renderQ();
      if (exam) startTimer();
    }
    function view(items) { return { id: DECK, items: items.map(function (it) { return { id: it.id, a: it.t, x: it }; }) }; }
    function session(items, size, cap) { return C.buildSession(view(items), st.store, I.today(), { size: size, newCap: cap }).map(function (v) { return v.x; }); }
    function startMixed(n) {
      if (Q.mode === "exam") {
        // The timed exam is a Resident (Pro) feature: every difficulty, one free trial. The gate runs before any fetch.
        return I.gate("exam", function () {
          var ids = examTopics(topicList(), 6);
          wait(s("loading"));
          loadTopics(ids, progressLine).then(function (all) { if (st.view === "mcq-load") start(examPick(all, EXAM_N), true); }, failed);
        });
      }
      n = n > 0 ? n : SIZE;
      levelGate(function () {
        var due = dueTopics(st.store, DECK, I.today()), rest = topicList().filter(function (t) { return due.indexOf(t.id) < 0; });
        var ids = due.slice(0, MIX_TOPICS).concat(examTopics(rest, Math.max(1, MIX_TOPICS - Math.min(due.length, MIX_TOPICS))));
        wait(s("loading"));
        loadTopics(ids, progressLine).then(function (all) { if (st.view === "mcq-load") start(session(pool(all), n, Math.min(n, NEW_CAP)), false); }, failed);
      });
    }
    function startTopic(t) {
      levelGate(function () {
        wait(s("loading"));
        loadTopic(t).then(function (items) { if (st.view === "mcq-load") start(session(pool(items), SIZE, SIZE), false); }, failed);
      });
    }

    function renderQ() {
      var r = Q.run, it = r.items[r.i], picked = r.picks[r.i];
      st.view = "mcq-q"; st.again = renderQ;
      st.onBack = function () { stopTimer(); renderBank(); return true; };
      st.onLeave = stopTimer;
      var fl = !!flags()[it.id];
      var o = it.o.map(function (x, j) {
        return '<button type="button" class="sp-ans" data-act="mcqans" data-k="' + j + '"' + (r.exam && picked === j ? ' data-state="picked"' : "") + '><span class="k" aria-hidden="true">' + LETTERS[j] + "</span>" + en(x) + "</button>";
      }).join("");
      I.paint(I.top(rawS("backBank"), s("qOf", { i: r.i + 1, n: r.items.length }),
          r.exam ? '<span id="mcqClock">' + esc(clock()) + "</span>" : topicLabel(it.t) + (it.d ? " · d" + it.d : ""), // an exam does not name the topic
          '<button type="button" class="sp-icon" data-act="mcqflag" aria-pressed="' + fl + '" aria-label="' + s(fl ? "unflag" : "flag") + '">' + (ico("flag") || "⚑") + "</button>") +
        '<div class="sp-scroll sp-pad mcq-q" id="mcqPanel"><div class="sp-col"><p class="mcq-stem" id="mcqStem">' + en(it.q) + "</p>" +
        '<div class="sp-answers" role="group" aria-labelledby="mcqStem">' + o + "</div>" +
        '<div id="mcqNote" aria-live="polite"></div></div></div>' +
        '<div class="sp-foot"><button type="button" class="sp-btn pri sp-wide" data-act="mcqnext" id="mcqNext"' + (r.exam ? "" : " hidden") + ">" +
        (r.i + 1 < r.items.length ? s("nextQ") : r.exam ? s("finishMark") : s("finish")) + "</button></div>", ".sp-ans");
    }

    function answer(key) {
      var r = Q.run;
      if (!r || r.done) return;
      var it = r.items[r.i];
      if (r.exam) {
        r.picks[r.i] = key;
        [].forEach.call(G.document.querySelectorAll("#mcqPanel .sp-ans"), function (b) {
          if (+b.getAttribute("data-k") === key) b.setAttribute("data-state", "picked"); else b.removeAttribute("data-state");
        });
        I.haptic("tap");
        return;
      }
      r.done = true; r.picks[r.i] = key;
      var right = key === it.a;
      mark(it, right);
      var box = G.document.querySelector("#mcqPanel .sp-answers");
      if (box) box.classList.add("done");
      [].forEach.call(G.document.querySelectorAll("#mcqPanel .sp-ans"), function (b) {
        var j = +b.getAttribute("data-k");
        b.setAttribute("data-state", j === it.a ? "right" : j === key ? "wrong" : "dim");
        b.setAttribute("aria-disabled", "true");
        if (j === it.a) b.querySelector(".k").innerHTML = ico("check") || LETTERS[j];
      });
      I.haptic(right ? "success" : "error");
      $("mcqNote").innerHTML = explain(it, right, key);
      var nx = $("mcqNext"); nx.hidden = false;
      try { nx.focus({ preventScroll: true }); } catch (e) {}
    }
    function doubtHtml(it) {
      if (!it.flags || !it.flags.length) return "";
      var leg = (Q.ix && Q.ix.flagLegend) || {};
      var lines = it.flags.map(function (f) { return leg[f] ? "<li>" + I.tx(leg[f]) + "</li>" : ""; }).join("");
      return '<div class="mcq-doubt" role="note">' + (ico("info") || "") + "<div><b>" + s("doubt") + "</b>" + (lines ? "<ul>" + lines + "</ul>" : "<p>" + s("doubtAny") + "</p>") + "</div></div>";
    }
    function explain(it, right, key) {
      var x = explanation(it);
      return '<div class="mcq-x sp-reveal"><p class="sp-verdict ' + (right ? "ok" : "bad") + '">' + (ico(right ? "check" : "close") || "") + "<span>" + s(right ? "right" : "wrong") + "</span></p>" +
        (right ? "" : '<p class="mcq-key">' + D.t(STR.answer, L()).replace("{k}", LETTERS[it.a]).replace("{o}", "") + "<b>" + en(it.o[it.a]) + "</b>" + (key != null ? esc(D.t(STR.chose, L()).replace("{k}", LETTERS[key])) : ".") + "</p>") +
        doubtHtml(it) +
        '<h3 class="sp-h3">' + s("expl") + "</h3>" + (x ? '<p class="mcq-xt">' + en(x) + "</p>" : '<p class="mcq-xt sp-mut">' + s("noExpl") + "</p>") +
        I.maikBtn("Question: " + it.q + " Options: " + it.o.map(function (o2, j) { return LETTERS[j] + ") " + o2; }).join("; ") +
          ". The keyed answer is " + LETTERS[it.a] + ") " + it.o[it.a] + ". Explain why it is correct and why the others are not.") + "</div>";
    }
    function mark(it, right) {
      C.recordAnswer(st.store, DECK, it.t, right ? it.t : "x");
      C.review(st.store, DECK, it.id, C.gradeFor(right), I.today());
      (st.store.mcqT || (st.store.mcqT = {}))[it.id] = it.t;
      I.save();
    }
    function next() {
      var r = Q.run;
      if (!r || (!r.exam && !r.done)) return;
      if (r.i + 1 < r.items.length) { r.i++; r.done = false; renderQ(); return; }
      finish();
    }
    function finish() {
      var r = Q.run;
      stopTimer();
      if (r.exam && !r.marked) { r.marked = true; r.items.forEach(function (it, i) { mark(it, r.picks[i] === it.a); }); }
      renderSummary();
    }

    /* ---------- summary ---------- */
    function renderSummary() {
      var r = Q.run, ok = 0, by = {}, wrong = [];
      r.items.forEach(function (it, i) {
        var right = r.picks[i] === it.a, b = by[it.t] || (by[it.t] = { n: 0, ok: 0 });
        b.n++; if (right) { ok++; b.ok++; } else wrong.push(i);
      });
      st.view = "mcq-sum"; st.again = renderSummary;
      st.onBack = function () { renderBank(); return true; };
      var mins = Math.max(1, Math.round((Date.now() - r.t0) / 60000));
      var tps = Object.keys(by).sort(function (a, b) { return by[a].ok / by[a].n - by[b].ok / by[b].n; }).map(function (t) {
        var pct = Math.round(by[t].ok * 100 / by[t].n);
        return '<li class="sp-srow"><div class="sp-srow-h"><span>' + topicLabel(t) + "</span><b>" + by[t].ok + " / " + by[t].n + "</b></div>" +
          '<div class="sp-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></li>';
      }).join("");
      var misses = wrong.map(function (i) {
        var it = r.items[i];
        return '<li><details class="mcq-miss"><summary><span>' + en(it.q) + "</span></summary>" + explain(it, false, r.picks[i] == null ? null : r.picks[i]) + "</details></li>";
      }).join("");
      I.paint(I.top(rawS("backBank"), s(r.exam ? "examDone" : "setDone"), s("sumSub", { n: fmt(r.items.length), m: mins }), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="mcq-score" id="mcqScore" tabindex="-1">' + s("score", { ok: ok, n: r.items.length, p: Math.round(ok * 100 / r.items.length) }) + "</p>" +
        '<p class="sp-small">' + nextDueLine() + "</p>" +
        '<h2 class="sp-h2">' + s("byTopic") + '</h2><ul class="sp-slist">' + tps + "</ul>" +
        (wrong.length ? '<h2 class="sp-h2">' + s("missed") + '</h2><ul class="mcq-misses">' + misses + "</ul>" : "") + "</div></div>" +
        '<div class="sp-foot"><div class="mcq-foot2">' +
        (wrong.length ? '<button type="button" class="sp-btn sec" data-act="mcqredo">' + s("retryMissed") + "</button>" : '<button type="button" class="sp-btn sec" data-act="mcqbank">' + s("title") + "</button>") +
        '<button type="button" class="sp-btn pri" data-act="mcqstart">' + s("nextSet") + "</button></div></div>", "#mcqScore");
    }
    function nextDueLine() {
      var n = D.dueOn(st.store, DECK + ":", I.today() + 1);
      return n ? s("comeBack", { n: fmt(n) }) : s("comeBack0");
    }

    /* ---------- exam clock ---------- */
    function clock() {
      var r = Q.run, left = Math.max(0, r.limit - Math.floor((Date.now() - r.t0) / 1000));
      return D.t(STR.left, L()).replace("{t}", Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2));
    }
    function startTimer() {
      stopTimer();
      Q.timer = G.setInterval(function () {
        var r = Q.run, el = $("mcqClock");
        if (!r || !r.exam) return stopTimer();
        if (el) el.textContent = clock();
        if (Date.now() - r.t0 >= r.limit * 1000) finish();
      }, 1000);
    }
    function stopTimer() { if (Q.timer) { G.clearInterval(Q.timer); Q.timer = 0; } }

    /* ---------- actions ---------- */
    A.mcqretry = function () { Q.err = null; open(); };
    A.mcqbank = function () { renderBank(); };
    A.mcqmode = function (b) {
      var m = b.getAttribute("data-m");
      if (m === "exam" && I.trial("exam") === "used") { I.showPro(); return; }
      Q.mode = m; renderBank("[data-act=mcqmode][data-m=" + m + "]");
    };
    A.mcqstart = function () { startMixed(); };
    A.mcqtopic = function (b) { startTopic(b.getAttribute("data-t")); };
    A.mcqone = function (b) { var it = itemById(b.getAttribute("data-id")); if (it) start([it], false); };
    A.mcqflagged = function () {
      var f = flags(), ids = [], x;
      for (x in f) if (typeof f[x] === "string" && ids.indexOf(f[x]) < 0 && topicOf(f[x])) ids.push(f[x]);
      wait(s("loading"));
      loadTopics(ids, progressLine).then(function () {
        if (st.view !== "mcq-load") return;
        start(Object.keys(f).map(itemById).filter(Boolean), false);
      }, failed);
    };
    A.mcqredo = function () {
      var r = Q.run, items = [];
      r.items.forEach(function (it, i) { if (r.picks[i] !== it.a) items.push(it); });
      start(items, false);
    };
    A.mcqans = function (b) { answer(+b.getAttribute("data-k")); };
    A.mcqnext = next;
    A.mcqflag = function (b) {
      var it = Q.run.items[Q.run.i], f = flags(), on = !f[it.id];
      if (on) f[it.id] = it.t; else delete f[it.id];
      I.save();
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", rawS(on ? "unflag" : "flag"));
      I.toast(rawS(on ? "flaggedT" : "unflaggedT"));
    };
    K["mcq-q"] = function (e) {
      if (e.target && e.target.tagName === "INPUT") return;
      var x = "1234".indexOf(e.key);
      if (x < 0) x = "abcd".indexOf((e.key || "").toLowerCase());
      if (x >= 0 && e.key.length === 1) { e.preventDefault(); answer(x); return; }
      // Enter or Space on a focused button is that button's own click (an option or Next), so only act elsewhere.
      if ((e.key === "Enter" || e.key === " ") && Q.run && (Q.run.done || Q.run.exam) && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); next(); }
    };

    var bank = {
      id: DECK, title: STR.title, sub: STR.sub, icon: "list", load: load, open: open,
      line: function () {
        if (!Q.ix) return Q.missing ? s("none") : s("rowNew");
        var x = stats();
        return x.seen ? s("rowSeen", { n: fmt(x.seen) }) + (x.due ? " · <b>" + s("rowDue", { n: fmt(x.due) }) + "</b>" : "") : s("nQ", { n: fmt(levelCount()) });
      },
      ready: function () { return !!Q.ix; },
      hasTopic: function (t) { return !Q.ix || !!topicOf(t); },
      start: function (n) { Q.mode = "study"; open(); load().then(function () { if (Q.ix) startMixed(n); }); }, // Today's plan
      topic: function (t) { Q.mode = "study"; open(); load().then(function () { if (topicOf(t)) startTopic(t); }); }, // a lesson's "Test yourself"
      sourceInfo: function () {
        return Q.ix ? { name: STR.title, license: Q.ix.licence || Q.ix.license, cite: (Q.ix.citation || "") + (Q.ix.modifications ? " " + Q.ix.modifications : ""), url: Q.ix.sourceRepo || "" } : null;
      }
    };
    host._banks.push(bank);
    host._mcq = Q; // read-only hook for the headless UI test
    return bank;
  };
})(typeof window !== "undefined" ? window : this);
