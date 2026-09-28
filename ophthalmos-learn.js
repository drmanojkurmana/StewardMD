/* Ophthalmós Learn: the beginner's side of the module (owner decisions 2026-09-28). ES5.
   Two tabs, Learn | Test, chosen on a first-run screen with the language (English / Hindi). Learn = lessons
   (ophthalmos/learn/, one idea per screen), a Revise set of FSRS cards (deck key "learn"), Reference (the notes and
   calculators registries) and a Glossary. MBBS lessons are free; Resident lessons are Pro with one trial
   (learn.resident). Pure logic (D.t, glossParts, validateLesson, nextLesson, finishLesson, learnDue) is in
   ophthalmos-data.js. Loaded after the other feature files. */
(function (G) {
  "use strict";
  var O = G.OPHTHALMOS;
  if (!O || !O._internal) return;
  var I = O._internal, st = O._st, C = G.OPHTHALMOS_CORE, D = G.OPHTHALMOS_DATA, S = G.OPHTHALMOS_STAGE, A = I.ACTIONS, K = I.KEYS;
  var ico = I.ico, esc = I.esc, fmt = I.fmt;
  var BASE = G.SMD_OPHTHALMOS_BASE || "/ophthalmos/";

  /* ---------- Learn chrome, English and Hindi ---------- */
  var STR = {
    learn: { en: "Learn", hi: "सीखें" }, test: { en: "Test", hi: "टेस्ट" }, mode: { en: "Learn or test", hi: "सीखें या टेस्ट" },
    close: { en: "Close Ophthalmós", hi: "Ophthalmós बंद करें" }, back: { en: "Back", hi: "वापस" },
    homeSub: { en: "One idea at a time", hi: "एक समय में एक बात" },
    langSwitch: { en: "Switch to Hindi", hi: "अंग्रेज़ी में बदलें" }, language: { en: "Language", hi: "भाषा" },
    welcome: { en: "Welcome to Ophthalmós", hi: "Ophthalmós में आपका स्वागत है" },
    choose: { en: "Where would you like to begin?", hi: "आप कहाँ से शुरू करना चाहेंगे?" },
    learnLine: { en: "Short lessons with real images. Start here if you are new.", hi: "असली images के साथ छोटे पाठ। नए हैं तो यहीं से शुरू करें।" },
    testLine: { en: "Clinics, questions, cases and simulators to practise on.", hi: "अभ्यास के लिए clinics, प्रश्न, cases और simulators।" },
    switchLater: { en: "You can switch between Learn and Test at the top of the screen at any time.", hi: "सीखें और टेस्ट के बीच आप कभी भी स्क्रीन के ऊपर से बदल सकते हैं।" },
    startHere: { en: "Start here", hi: "यहाँ से शुरू करें" }, upNext: { en: "Up next", hi: "अगला पाठ" },
    cont: { en: "Continue", hi: "जारी रखें" },
    min: { en: "{n} min", hi: "{n} मिनट" }, ofDone: { en: "{d} of {n} done", hi: "{n} में से {d} पूरे" },
    done: { en: "Done", hi: "पूरा" }, toDo: { en: "to do", hi: "बाकी" },
    mbbs: { en: "MBBS", hi: "MBBS" }, resident: { en: "Resident", hi: "Resident" },
    mbbsDone: { en: "You have finished every MBBS lesson.", hi: "आपने MBBS के सभी पाठ पूरे कर लिए हैं।" },
    residentNudge: { en: "Ready for more? The Resident lessons go deeper, into imaging and treatment.", hi: "और आगे? Resident पाठ imaging और इलाज की गहराई में जाते हैं।" },
    allDoneH: { en: "Every lesson done", hi: "सभी पाठ पूरे" },
    allDone: { en: "Revise what is due, or test yourself on real patients.", hi: "जो दोहराना है उसे दोहराएँ, या असली मरीज़ों की images पर खुद को परखें।" },
    goTest: { en: "Go to Test", hi: "टेस्ट पर जाएँ" },
    revise: { en: "Revise", hi: "दोहराएँ" }, reviseDue: { en: "{n} due today", hi: "आज {n} दोहराने हैं" },
    reference: { en: "Reference", hi: "संदर्भ" }, glossary: { en: "Glossary", hi: "शब्दावली" }, nTerms: { en: "{n} terms", hi: "{n} शब्द" },
    glossSub: { en: "Words used in the lessons", hi: "पाठों में आए शब्द" },
    calc: { en: "Clinical calculators", hi: "Clinical calculators" }, nTools: { en: "{n} tools", hi: "{n} tools" },
    loading: { en: "Loading lessons…", hi: "पाठ लोड हो रहे हैं…" },
    ixErr: { en: "The lessons did not load. Check the connection and try again. Reference below still works.", hi: "पाठ लोड नहीं हुए। इंटरनेट कनेक्शन देखकर फिर कोशिश करें। नीचे Reference अभी भी काम करता है।" },
    retry: { en: "Try again", hi: "फिर कोशिश करें" },
    none: { en: "No lessons yet. They are being written; Reference below and the Test tab are ready now.", hi: "अभी कोई पाठ नहीं है। पाठ लिखे जा रहे हैं; नीचे Reference और Test tab अभी तैयार हैं।" },
    lessonErr: { en: "This lesson did not load.", hi: "यह पाठ लोड नहीं हुआ।" },
    lessonErrHint: { en: "Check the connection and try again.", hi: "इंटरनेट कनेक्शन देखकर फिर कोशिश करें।" },
    loadingLesson: { en: "Loading the lesson…", hi: "पाठ लोड हो रहा है…" },
    stepOf: { en: "Step {i} of {n}", hi: "चरण {i} / {n}" }, next: { en: "Next", hi: "आगे" }, prev: { en: "Previous", hi: "पीछे" },
    closeLesson: { en: "Close lesson", hi: "पाठ बंद करें" },
    idea: { en: "The idea", hi: "मूल बात" }, see: { en: "See it", hi: "देखें" }, why: { en: "Why it happens", hi: "ऐसा क्यों होता है" },
    spot: { en: "Spot it", hi: "पहचानें" }, todo: { en: "What to do", hi: "क्या करें" }, remember: { en: "Remember it", hi: "याद रखें" },
    check: { en: "Check yourself", hi: "खुद को जाँचें" }, qOf: { en: "Question {i} of {n}", hi: "प्रश्न {i} / {n}" },
    analogy: { en: "Think of it like this", hi: "ऐसे समझें" },
    tapPoints: { en: "Tap each numbered point to name it. Tap the picture to enlarge it.", hi: "हर नंबर वाले बिंदु को छूकर उसका नाम देखें। बड़ा देखने के लिए तस्वीर को छुएँ।" },
    showAll: { en: "Show all names", hi: "सभी नाम दिखाएँ" }, point: { en: "Point {n}", hi: "बिंदु {n}" },
    enlarge: { en: "Enlarge: {x}", hi: "बड़ा करें: {x}" }, enlarged: { en: "Enlarged picture", hi: "बड़ी तस्वीर" },
    zoomHint: { en: "Pinch, double-tap or + and -", hi: "Pinch, double-tap या + और -" }, closeImg: { en: "Close picture", hi: "तस्वीर बंद करें" },
    zoomIn: { en: "Zoom in", hi: "Zoom in" }, fit: { en: "Fit picture", hi: "पूरी तस्वीर" },
    imgErr: { en: "The picture did not load. Its labelled points are listed below.", hi: "तस्वीर लोड नहीं हुई। उसके सभी बिंदु नीचे लिखे हैं।" },
    right: { en: "Right", hi: "सही" }, wrong: { en: "Not quite. The answer is {x}.", hi: "सही नहीं। सही उत्तर: {x}।" },
    answerFirst: { en: "Choose an answer to go on.", hi: "आगे बढ़ने के लिए एक उत्तर चुनें।" },
    lessonDone: { en: "Lesson done", hi: "पाठ पूरा हुआ" },
    comesBack: { en: "The line above comes back in Revise in a few days, just before you would forget it.", hi: "ऊपर वाली बात कुछ दिनों में दोहराएँ में फिर आएगी, ठीक भूलने से पहले।" },
    testYourself: { en: "Test yourself", hi: "खुद को परखें" },
    testClinic: { en: "{c}: real images of this", hi: "{c}: इसकी असली images" }, testBank: { en: "Question bank: questions on this topic", hi: "Question bank: इस विषय के प्रश्न" },
    trySim: { en: "Try the simulator", hi: "Simulator पर अभ्यास करें" }, simLine: { en: "Simulator: {t}", hi: "Simulator: {t}" },
    goDeeper: { en: "Go deeper", hi: "और गहराई से" }, deeperNote: { en: "Study note: {t}", hi: "अध्ययन नोट: {t}" },
    nextLesson: { en: "Next lesson", hi: "अगला पाठ" }, backLearn: { en: "Back to Learn", hi: "सीखें पर वापस" },
    recall: { en: "Say the one thing to remember from this lesson, then check.", hi: "इस पाठ की ज़रूरी बात मन में बोलें, फिर जाँचें।" },
    showAnswer: { en: "Show answer", hi: "उत्तर देखें" }, again: { en: "Again", hi: "फिर से" }, gotIt: { en: "Got it", hi: "याद था" },
    xOfY: { en: "{i} of {n}", hi: "{n} में से {i}" }, reviseDone: { en: "All revised for today.", hi: "आज का दोहराना पूरा हुआ।" },
    reviseEmpty: { en: "Nothing to revise today. Finished lessons come back here when they are due.", hi: "आज दोहराने को कुछ नहीं है। पूरे किए पाठ समय आने पर यहाँ लौटेंगे।" },
    closeSheet: { en: "Close", hi: "बंद करें" },
    trial1: { en: "1 free trial", hi: "1 मुफ़्त trial" }, trialUsed: { en: "Trial used", hi: "Trial हो चुका" },
    notes: { en: "Study notes", hi: "अध्ययन नोट्स" }, notesSub: { en: "Signs, grading, next steps (in English)", hi: "लक्षण, grading, आगे क्या करें (अंग्रेज़ी में)" },
    backLesson: { en: "Back to lesson", hi: "पाठ पर वापस" }, backTest: { en: "Back to Test", hi: "टेस्ट पर वापस" }, prevStep: { en: "Previous step", hi: "पिछला चरण" },
    more: { en: "More pictures", hi: "और तस्वीरें" }, pause: { en: "Pause", hi: "रोकें" }, play: { en: "Play", hi: "चलाएँ" },
    pauseA: { en: "Pause animation: {x}", hi: "एनिमेशन रोकें: {x}" }, playA: { en: "Play animation: {x}", hi: "एनिमेशन चलाएँ: {x}" },
    mediaErr: { en: "This picture did not load.", hi: "यह तस्वीर लोड नहीं हुई।" }
  };
  function L() { return I.lang(); }
  // Chrome string, HTML-safe; {n}-style values are escaped.
  function s(k, v) {
    return esc(D.t(STR[k], L())).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; });
  }
  function fell(obj) { return L() === "hi" && obj && typeof obj === "object" && !obj.hi; }
  // Content text in the current language, escaped. A missing Hindi string falls back to English, marked lang="en".
  function tx(obj) { var h = esc(D.t(obj, L())); return fell(obj) ? '<span lang="en">' + h + "</span>" : h; }
  function plain(obj) {
    return D.glossParts(D.t(obj, L())).map(function (p) { return p.text != null ? p.text : p.shown || termText(p.term); }).join("");
  }
  function termText(id) { var g = W.gloss && W.gloss[id]; return g ? D.t(g.term, L()) : id; }
  // Rich text: escaped, [[term]] links open the glossary sheet. Each is an inline span with button semantics, not a
  // <button>: a button is an atomic box, so a long term ("corneal light reflex test (Hirschberg test)") jumped to its
  // own centred lines instead of wrapping with the sentence. Enter and Space open it (termKey).
  function rich(obj) {
    var h = D.glossParts(D.t(obj, L())).map(function (p) {
      if (p.text != null) return esc(p.text);
      var label = esc(p.shown || termText(p.term));
      return W.gloss && W.gloss[p.term] ? '<span class="ln-term" role="button" tabindex="0" data-act="lngloss" data-g="' + esc(p.term) + '" aria-haspopup="dialog">' + label + "</span>" : label;
    }).join("");
    return fell(obj) ? '<span lang="en">' + h + "</span>" : h;
  }

  /* ---------- data ---------- */
  // media: the image library by id (learn/media/credits.json); svg: fetched animation sources by id; n: SVG instance count.
  var W = { ix: null, err: null, loading: null, lessons: {}, bad: {}, inflight: {}, gloss: null, media: null, svg: {}, n: 0, paused: {},
    les: null, step: 0, picks: {}, hot: {}, sheet: null, zoom: null, rev: null, again: null };
  // A lesson file loads when it is opened (the lists render from index.json's summaries) and stays cached in
  // W.lessons. Never rejects: a failed or invalid lesson is W.bad[id]. It waits for load(): validation needs the
  // glossary and the image library.
  function fetchLesson(id) {
    if (W.lessons[id]) return Promise.resolve();
    if (W.inflight[id]) return W.inflight[id];
    return (W.inflight[id] = Promise.resolve(W.loading).then(function () { return I.getJSON("learn/lessons/" + id + ".json"); }).then(function (l) {
      var e = D.validateLesson(l, W.gloss, W.media);
      if (l && l.id !== id) e.push("id does not match the file name");
      if (e.length) { W.bad[id] = 1; try { G.console.warn("Ophthalmós Learn: lesson " + id + " is invalid", e); } catch (x) {} return; }
      W.lessons[id] = l; delete W.bad[id];
    }, function () { W.bad[id] = 1; }).then(function () { delete W.inflight[id]; }));
  }
  // Never rejects: a failed index is W.err (the Learn home offers a retry). Loads the glossary, the image library
  // and index.json only; no lesson file.
  function load() {
    if (W.loading) return W.loading;
    W.err = null;
    W.loading = I.getJSON("learn/glossary.json").then(function (g) { W.gloss = (g && g.terms) || {}; }, function () { W.gloss = null; })
      .then(function () { return I.getJSON("learn/media/credits.json"); })
      .then(function (c) { W.media = {}; ((c && c.items) || []).forEach(function (m) { W.media[m.id] = m; }); }, function () { W.media = null; }) // no library: lessons keep their main picture
      .then(function () { return I.getJSON("learn/index.json"); })
      .then(function (ix) {
        var e = D.validateIndex(ix);
        if (e.length) throw new Error(e[0]);
        W.ix = ix;
      })
      .then(function () { W.loading = null; }, function (e) { W.err = e; W.ix = null; W.loading = null; });
    return W.loading;
  }
  function unitOf(id) {
    var u = (W.ix && W.ix.units) || [];
    for (var i = 0; i < u.length; i++) if (u[i].lessons.indexOf(id) >= 0) return u[i];
    return null;
  }
  // A lesson's summary in index.json (dev/learn-index.mjs): title, minutes, idea, see {img | diagram}, test {clinic, classes}?.
  function meta(id) { return (W.ix && W.ix.lessons && W.ix.lessons[id]) || null; }
  function allIds() { var out = []; D.learnUnits(W.ix).forEach(function (u) { out = out.concat(u.lessons); }); return out; }
  function doneCount(ids) { return ids.filter(function (id) { return D.lessonDone(st.store, id); }).length; }
  function imgSrc(see) { return see.img ? I.imgUrl(see.img) : BASE + "learn/" + see.diagram; }
  function deckSize(see) {
    var d = see.deckItem && st.decks[see.deckItem.deck];
    if (d) for (var i = 0; i < d.items.length; i++) if (String(d.items[i].id) === String(see.deckItem.id)) return { w: d.items[i].w, h: d.items[i].h };
    return null;
  }
  // The picture's size before it loads: the deck item's, else the lesson's w and h (a diagram's viewBox).
  function picSize(see) { return deckSize(see) || (see.w > 0 && see.h > 0 ? { w: see.w, h: see.h } : null); }
  // Image library: files under learn/media/, beside the lessons (so the host's base URL covers them).
  function mediaUrl(m) { return BASE + "learn/media/" + m.file; }
  function moreIds(l) { return ((l && l.see.more) || []).filter(function (id) { return W.media && W.media[id]; }); }
  // An animation's SVG source, fetched once. It is inlined (scoped per instance by D.scopeSvg) so it can be paused
  // and so its own reduced-motion rule applies; photos and still illustrations stay <img>.
  function svgSrc(id) {
    var c = W.svg[id];
    if (c) return c.p;
    c = W.svg[id] = { t: null };
    c.p = G.fetch(mediaUrl(W.media[id])).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (t) { c.t = t; return t; }, function (e) { delete W.svg[id]; throw e; });
    return c.p;
  }
  function prefetchSvgs(l) { moreIds(l).forEach(function (id) { if (W.media[id].kind === "animation") svgSrc(id).then(null, function () {}); }); }

  /* ---------- painting ---------- */
  function root() { return G.document.getElementById("smdOphthalmos"); }
  function paint(html, focusSel) {
    W.sheet = null; W.zoom = null; // painting replaces every layer
    I.paint(html, focusSel);
    if (L() === "hi") root().setAttribute("lang", "hi");
  }
  function langBtn() {
    var hi = L() === "hi";
    return '<button class="ln-lang" data-act="lnlang" aria-label="' + s("langSwitch") + '"><span lang="' + (hi ? "en" : "hi") + '">' + (hi ? "English" : "हिन्दी") + "</span></button>";
  }
  function tabs(active) {
    return '<div class="oph-seg ln-tabs" role="group" aria-label="' + s("mode") + '" lang="' + L() + '">' + ["learn", "test"].map(function (k) {
      return '<button data-act="lntab" data-t="' + k + '" aria-pressed="' + (k === active) + '">' + ico(k === "learn" ? "book" : "target") + s(k) + "</button>";
    }).join("") + "</div>";
  }
  function markTop(sub) {
    return '<div class="oph-top"><button class="oph-back" data-act="back" aria-label="' + s("close") + '">‹</button>' +
      '<div class="oph-title"><b class="oph-mark" translate="no">Ophthalmós</b>' + (sub ? "<span>" + sub + "</span>" : "") + "</div>" + langBtn() + "</div>";
  }
  function row(act, attrs, lead, title, sub, line) {
    return '<li><button class="oph-clinic" data-act="' + act + '"' + attrs + '><span class="oph-strip" aria-hidden="true">' + lead + "</span>" +
      '<span class="oph-clinic-b"><b>' + title + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + (line ? '<span class="oph-small">' + line + "</span>" : "") + "</span>" +
      '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
  }
  function tile(n) { return '<span class="oph-tile">' + ico(n) + "</span>"; }
  // I.lockBadge in the Learn language.
  function badge(id) { var t = I.trial(id); return t === "open" ? "" : '<span class="oph-pro' + (t === "used" ? " used" : "") + '">' + ico("lock") + s(t === "trial" ? "trial1" : "trialUsed") + "</span>"; }

  /* ---------- first run: Learn or Test, and the language ---------- */
  function firstRun() {
    st.view = "hub"; st.onBack = null; W.again = firstRun;
    var first = W.ix && D.nextLesson(W.ix, st.store), fl = first && meta(first.id);
    var lthumb = fl && fl.see.img ? '<img src="' + esc(I.imgUrl(fl.see.img)) + '" alt="" loading="lazy" decoding="async">' : tile("book");
    var tthumb = (st.cfg.tracks || []).slice(0, 3).map(function (t) {
      var d = st.decks[t.id], x = d && d.thumbs && d.thumbs[0];
      return x ? '<img src="' + esc(I.imgUrl(x.img)) + '" alt="" loading="lazy" decoding="async">' : "";
    }).join("") || tile("target");
    paint(markTop("") +
      '<div class="oph-scroll oph-pad ln-first"><div class="ln-col">' +
      '<h1 class="ln-h1">' + s("welcome") + "</h1>" +
      '<div class="ln-langrow"><span class="oph-small" id="lnLangL">' + s("language") + '</span><div class="oph-seg" role="group" aria-labelledby="lnLangL">' +
      '<button data-act="lnsetlang" data-l="en" lang="en" aria-pressed="' + (L() === "en") + '">English</button>' +
      '<button data-act="lnsetlang" data-l="hi" lang="hi" aria-pressed="' + (L() === "hi") + '">हिन्दी</button></div></div>' +
      '<p class="ln-lede">' + s("choose") + "</p>" +
      '<ul class="ln-choices">' +
      '<li><button class="ln-choice" data-act="lnpick" data-t="learn"><span class="oph-strip" aria-hidden="true">' + lthumb + '</span><span class="ln-choice-b"><b>' + s("learn") + "</b><span>" + s("learnLine") + '</span></span><span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>" +
      '<li><button class="ln-choice" data-act="lnpick" data-t="test"><span class="oph-strip" aria-hidden="true">' + tthumb + '</span><span class="ln-choice-b"><b>' + s("test") + "</b><span>" + s("testLine") + '</span></span><span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>" +
      "</ul>" +
      '<p class="oph-small ln-later">' + s("switchLater") + "</p></div></div>", ".ln-choice");
  }

  /* ---------- Learn home ---------- */
  function home(focusSel) {
    st.view = "hub"; st.onBack = null; W.again = home;
    var body;
    if (W.loading && !W.ix) {
      body = '<p class="oph-mut" role="status">' + s("loading") + "</p>";
      W.loading.then(function () { if (st.view === "hub" && st.prefs.tab === "learn") home(); });
    } else if (!W.ix) body = '<section class="oph-today"><p class="oph-today-line">' + s("ixErr") + '</p><button class="oph-btn pri" data-act="lnretryix">' + ico("refresh") + " " + s("retry") + "</button></section>";
    else if (!allIds().length) body = '<section class="oph-today"><p class="oph-today-line">' + s("none") + "</p></section>";
    else body = startCard() + reviseRow() + unitsHtml();
    paint(markTop(s("homeSub")) +
      '<div class="oph-scroll oph-pad ln-home"><div class="ln-col">' + tabs("learn") + body + (O._explore ? O._explore.homeHtml() : "") + referenceHtml() +
      "</div></div>", focusSel);
    wireUnits();
  }

  function startCard() {
    var nx = D.nextLesson(W.ix, st.store), anyDone = doneCount(allIds()) > 0;
    if (!nx) {
      return '<section class="ln-start"><div class="ln-start-b"><h2 class="ln-start-t ln-alldone">' + ico("check") + s("allDoneH") + "</h2>" +
        '<p class="ln-start-idea">' + s("allDone") + "</p>" +
        '<button class="oph-btn pri oph-wide" data-act="lntab" data-t="test">' + ico("target") + " " + s("goTest") + "</button></div></section>";
    }
    var l = meta(nx.id), res = nx.level === "resident";
    var head = res ? '<p class="ln-start-idea">' + s("mbbsDone") + " " + s("residentNudge") + "</p>" : "";
    var see = l.see, u = unitOf(nx.id);
    return '<section class="ln-start" aria-label="' + (anyDone ? s("upNext") : s("startHere")) + '">' +
      '<div class="ln-start-img' + (see.img ? "" : " diagram") + '" aria-hidden="true"><img src="' + esc(imgSrc(see)) + '" alt="" decoding="async"></div>' +
      '<div class="ln-start-b">' + head +
      '<h2 class="ln-start-t" id="lnStartH">' + tx(l.title) + "</h2>" +
      '<p class="ln-start-idea">' + esc(plain(l.idea)) + "</p>" +
      '<p class="oph-small">' + s("min", { n: l.minutes }) + (u ? " · " + tx(u.title) : "") + (res ? " " + badge("learn.resident") : "") + "</p>" +
      '<button class="oph-btn pri oph-wide" data-act="lesson" data-l="' + esc(nx.id) + '">' + ico("play") + " " + (anyDone ? s("cont") : s("startHere")) + "</button></div></section>";
  }

  function reviseRow() {
    var n = D.learnDue(st.store, I.today()).filter(meta).length;
    if (!n) return "";
    return '<ul class="oph-clinics ln-revise">' + row("lnrevise", "", tile("refresh"), s("revise"), s("reviseDue", { n: fmt(n) }), "") + "</ul>";
  }

  // The unit holding the learner's next lesson opens by default (a brand new user: the first unit,
  // since nextLesson's first unfinished lesson is that unit's first). null once every lesson is done.
  function defaultUnitId() {
    var nx = D.nextLesson(W.ix, st.store), u = nx && unitOf(nx.id);
    return u ? u.id : null;
  }
  // Open state: the learner's own toggle (st.prefs.units, remembered like the tab and language), else the default.
  function unitOpen(u, defId) {
    var pu = st.prefs.units;
    if (pu && Object.prototype.hasOwnProperty.call(pu, u.id)) return !!pu[u.id];
    return u.id === defId;
  }
  function setUnitOpen(id, open) {
    if (!st.prefs.units) st.prefs.units = {};
    st.prefs.units[id] = !!open;
    D.savePrefs(I.ls(), st.prefs);
  }
  // <details>/<summary>: native disclosure semantics and keyboard support, no custom aria-expanded wiring needed.
  function wireUnits() {
    Array.prototype.forEach.call(G.document.querySelectorAll(".ln-unit[data-u]"), function (d) {
      d.addEventListener("toggle", function () { setUnitOpen(d.getAttribute("data-u"), d.open); });
    });
  }
  function unitsHtml() {
    var out = "", defId = defaultUnitId();
    ["mbbs", "resident"].forEach(function (lv) {
      var us = W.ix.units.filter(function (u) { return u.level === lv; });
      if (!us.length) return;
      out += '<h2 class="oph-h2">' + s(lv) + "</h2>";
      us.forEach(function (u) {
        var hmeta = s(lv) + " · " + s("ofDone", { d: fmt(doneCount(u.lessons)), n: fmt(u.lessons.length) }) + (lv === "resident" ? " " + badge("learn.resident") : "");
        out += '<details class="ln-unit" data-u="' + esc(u.id) + '"' + (unitOpen(u, defId) ? " open" : "") + '>' +
          '<summary class="ln-unit-sum"><span class="ln-unit-b"><h3>' + tx(u.title) + '</h3><span class="oph-small">' + hmeta + "</span></span>" +
          '<span class="oph-chev" aria-hidden="true">' + ico("chev") + '</span></summary><ol class="ln-lessons">' +
          u.lessons.map(function (id, i) {
            var l = meta(id), dn = D.lessonDone(st.store, id);
            var title = tx(l.title), line = s("min", { n: l.minutes }) + (dn ? " · " + s("done") : "");
            return '<li><button class="ln-row" data-act="lesson" data-l="' + esc(id) + '" data-done="' + dn + '">' +
              '<span class="ln-num" aria-hidden="true">' + (dn ? ico("check") : i + 1) + "</span>" +
              '<span class="ln-row-b"><b>' + title + '</b><span class="oph-small">' + line + (lv === "resident" ? " " + badge("learn.resident") : "") + "</span></span>" +
              '<span class="oph-chev" aria-hidden="true">' + ico("chev") + '</span><span class="oph-sr">' + (dn ? s("done") : s("toDo")) + "</span></button></li>";
          }).join("") + "</ol></details>";
      });
    });
    return out;
  }

  // Reference: the notes (O._reads) and calculators (O._tools) moved here from the Test hub, plus the glossary.
  function referenceHtml() {
    var rows = (O._reads || []).map(function (r) {
      var th = (r.thumbs ? r.thumbs() : []).slice(0, 3).map(function (p) { return '<img src="' + esc(I.imgUrl(p)) + '" alt="" loading="lazy" decoding="async">'; }).join("") || tile(r.icon);
      if (r.id === "notes") return row("read", ' data-r="notes"', th, s("notes"), s("notesSub"), '<span lang="en">' + r.line() + "</span>");
      return row("read", ' data-r="' + esc(r.id) + '" lang="en"', th, esc(r.title), esc(r.sub), r.line());
    }).join("");
    var tools = O._tools || [];
    if (tools.length) rows += row("tools", "", tile("calc"), s("calc"), '<span lang="en">' + esc(tools.map(function (t) { return t.title; }).join(", ")) + "</span>", s("nTools", { n: fmt(tools.length) }));
    var n = W.gloss ? Object.keys(W.gloss).length : 0;
    if (n) rows += row("lnglossary", "", tile("list"), s("glossary"), s("glossSub"), s("nTerms", { n: fmt(n) }));
    return rows ? '<h2 class="oph-h2">' + s("reference") + '</h2><ul class="oph-clinics">' + rows + "</ul>" : "";
  }

  /* ---------- lesson player: one step per screen ---------- */
  function stepKeys(l) {
    var a = ["idea", "see", "why", "spot", "todo", "remember"];
    l.check.forEach(function (q, i) { a.push("check" + i); });
    a.push("done");
    return a;
  }
  function openLesson(id) {
    var l = W.lessons[id], u = unitOf(id), res = u ? u.level === "resident" : l && l.level === "resident";
    if (res && I.trial("learn.resident") === "used") return I.gate("learn.resident", function () {}); // the paywall; nothing to fetch
    if (!l) return fetchOpen(id);
    var go = function () { I.leave(); st.session = null; W.les = l; W.picks = {}; W.hot = {}; W.act = null; prefetchSvgs(l); renderStep(0, true); };
    if (res) return I.gate("learn.resident", go);
    go();
  }
  // The lesson file is fetched on open: the loading line, then the lesson, or "did not load" with Try again.
  function fetchOpen(id) {
    I.leave();
    st.view = "lesson-load"; st.onBack = null; W.again = function () { fetchOpen(id); };
    var top = function () { var m = meta(id); return I.top(st.prefs.tab === "test" ? s("backTest") : s("backLearn"), m ? tx(m.title) : s("learn"), "", langBtn()); };
    paint(top() + '<div class="oph-scroll oph-pad"><div class="ln-col"><p role="status" class="oph-mut">' + s("loadingLesson") + "</p></div></div>");
    delete W.bad[id];
    fetchLesson(id).then(function () {
      if (st.view !== "lesson-load") return;
      if (W.lessons[id]) return openLesson(id);
      paint(top() + '<div class="oph-scroll oph-pad"><div class="ln-col"><p role="alert">' + s("lessonErr") + " " + s("lessonErrHint") + "</p>" +
        '<button class="oph-btn pri" data-act="lesson" data-l="' + esc(id) + '">' + ico("refresh") + " " + s("retry") + "</button></div></div>", ".oph-btn");
    });
  }

  function sheetBack() {
    if (W.sheet) { closeSheet(); return true; }
    if (W.zoom) { closeZoom(); return true; }
    return false;
  }

  function renderStep(i, noAnim, focusSel) {
    var l = W.les, keys = stepKeys(l), k = keys[i], n = keys.length;
    W.step = i; st.view = "lesson";
    W.again = function (f) { renderStep(W.step, true, f); };
    st.onBack = function () { if (sheetBack()) return true; if (W.step > 0) { renderStep(W.step - 1); return true; } return false; };
    st.onLeave = function () { W.les = null; };
    var body = "", foot = true, answered = true;
    if (k === "idea") {
      body = '<div class="ln-banner' + (l.see.img ? "" : " diagram") + '" aria-hidden="true"><img src="' + esc(imgSrc(l.see)) + '" alt="" decoding="async"></div>' +
        '<h1 class="ln-title">' + tx(l.title) + "</h1>" +
        '<p class="ln-meta">' + s("min", { n: l.minutes }) + " · " + s(l.level) + "</p>" +
        '<p class="ln-idea">' + rich(l.idea) + "</p>";
    } else if (k === "see") body = seeHtml(l);
    else if (k === "why") {
      body = '<h2 class="ln-h">' + s("why") + '</h2><ol class="ln-steps">' + l.why.steps.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ol>" +
        '<div class="ln-analogy"><b>' + s("analogy") + "</b><p>" + rich(l.why.analogy) + "</p></div>";
    } else if (k === "spot" || k === "todo") {
      body = '<h2 class="ln-h">' + s(k) + '</h2><ul class="ln-list">' + l[k].map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul>";
    } else if (k === "remember") {
      body = '<h2 class="ln-h">' + s("remember") + '</h2><p class="ln-remember">' + rich(l.remember) + "</p>";
    } else if (k.indexOf("check") === 0) {
      var qi = +k.slice(5), q = l.check[qi], pick = W.picks[qi];
      answered = pick != null;
      body = '<h2 class="ln-h">' + s("check") + "</h2>" + (l.check.length > 1 ? '<p class="oph-small ln-qof">' + s("qOf", { i: qi + 1, n: l.check.length }) + "</p>" : "") +
        '<p class="ln-q" id="lnQ">' + rich(q.q) + "</p>" +
        '<div class="oph-answers' + (answered ? " done" : "") + '" role="group" aria-labelledby="lnQ">' + q.o.map(function (o, j) {
          var stt = !answered ? "" : j === q.a ? "right" : j === pick ? "wrong" : "dim";
          var mk = stt === "right" ? ico("check") || "✓" : stt === "wrong" ? ico("close") || "x" : j + 1;
          return '<button class="oph-ans" data-act="lnans" data-k="' + j + '"' + (stt ? ' data-state="' + stt + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + mk + "</span>" + tx(o) + "</button>";
        }).join("") + "</div>" +
        '<div id="lnFb" aria-live="polite">' + (answered ? feedback(q, pick) : '<p class="oph-small ln-hint">' + s("answerFirst") + "</p>") + "</div>";
    } else {
      body = doneHtml(l); foot = false;
    }
    var pct = Math.round((i + 1) * 100 / n);
    // back: the previous step, or from the first step the tab the lesson was opened from
    paint(I.top(i > 0 ? s("prevStep") : st.prefs.tab === "test" ? s("backTest") : s("backLearn"), tx(l.title), s("stepOf", { i: i + 1, n: n }),
        '<button class="oph-icon" data-act="lnexit" aria-label="' + s("closeLesson") + '">' + ico("close") + "</button>" + langBtn()) +
      '<div class="ln-prog" role="progressbar" aria-label="' + s("stepOf", { i: i + 1, n: n }) + '" aria-valuemin="1" aria-valuemax="' + n + '" aria-valuenow="' + (i + 1) + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="oph-scroll oph-pad" id="lnScroll"><article class="ln-art" id="lnArt" data-step="' + k + '">' + body + "</article></div>" +
      (foot ? '<div class="oph-foot ln-foot">' + (i > 0 ? '<button class="oph-btn sec" data-act="lnprev">' + s("prev") + "</button>" : "<span></span>") +
        '<button class="oph-btn pri" data-act="lnnext" id="lnNext"' + (answered ? "" : " disabled") + ">" + s("next") + "</button></div>" : ""),
      focusSel || (k.indexOf("check") === 0 && !answered ? ".oph-ans" : foot ? "#lnNext" : ".ln-done-act .oph-btn"));
    // Each step rises in once (motion grammar: 6 px, 200 ms); keyboard steps and reduced motion skip the rise.
    var art = G.document.getElementById("lnArt");
    if (!noAnim && art) { art.classList.add("oph-reveal", "pre"); G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { art.classList.remove("pre"); }); }); }
    if (k === "see") { wireSee(l); fillSvgs(); }
    var ban = G.document.querySelector(".ln-banner img");
    if (ban) ban.addEventListener("error", function () { ban.parentNode.hidden = true; });
  }

  function feedback(q, pick) {
    var ok = pick === q.a;
    return '<div class="ln-fb"><p class="oph-verdict ' + (ok ? "ok" : "bad") + '">' + ico(ok ? "check" : "close") + "<span>" +
      (ok ? s("right") : s("wrong", { x: plain(q.o[q.a]) })) + '</span></p><p class="ln-why">' + rich(q.why) + "</p></div>";
  }

  function answer(k, viaKey) {
    var l = W.les, key = stepKeys(l)[W.step];
    if (!l || key.indexOf("check") !== 0) return;
    var qi = +key.slice(5), q = l.check[qi];
    if (W.picks[qi] != null || !q.o[k]) return;
    W.picks[qi] = k;
    I.haptic(k === q.a ? "success" : "error");
    var all = l.check.every(function (x, j) { return W.picks[j] != null; });
    if (all && D.finishLesson(st.store, l.id, I.today())) I.save();
    var wrap = G.document.querySelector("#lnArt .oph-answers");
    wrap.classList.add("done");
    Array.prototype.forEach.call(wrap.querySelectorAll(".oph-ans"), function (b) {
      var j = +b.getAttribute("data-k"), mk = b.querySelector(".k");
      if (j === q.a) { b.setAttribute("data-state", "right"); mk.innerHTML = ico("check") || "✓"; }
      else if (j === k) { b.setAttribute("data-state", "wrong"); mk.innerHTML = ico("close") || "x"; }
      else b.setAttribute("data-state", "dim");
      b.setAttribute("aria-disabled", "true");
    });
    var fb = G.document.getElementById("lnFb");
    fb.innerHTML = feedback(q, k);
    if (!viaKey) { var blk = fb.firstChild; blk.classList.add("oph-reveal", "pre"); G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { blk.classList.remove("pre"); }); }); }
    var nx = G.document.getElementById("lnNext");
    nx.disabled = false;
    try { nx.focus({ preventScroll: true }); } catch (e) {}
    var sc = G.document.getElementById("lnScroll");
    var calm = viaKey || !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try { sc.scrollTo({ top: sc.scrollHeight, behavior: calm ? "auto" : "smooth" }); } catch (e) { sc.scrollTop = sc.scrollHeight; }
  }

  function doneHtml(l) {
    var t = l.test || {}, tr = t.clinic && st.cfg && I.track(t.clinic), bank = bankFor(t);
    var test = tr && st.decks[t.clinic]
      ? '<button class="oph-btn pri oph-wide" data-act="lntest">' + ico("target") + " " + s("testYourself") + '</button><p class="oph-small">' + s("testClinic", { c: tr.clinic }) + "</p>"
      : bank ? '<button class="oph-btn pri oph-wide" data-act="lntest">' + ico("target") + " " + s("testYourself") + '</button><p class="oph-small">' + s("testBank") + "</p>" : "";
    var sm = null; (O._sims || []).forEach(function (x) { if (t.sim && x.id === t.sim) sm = x; });
    var sim = sm ? '<button class="oph-btn sec oph-wide" data-act="lnsim" data-s="' + esc(sm.id) + '">' + ico("target") + " " + s("trySim") + '</button><p class="oph-small" lang="en">' + s("simLine", { t: sm.title }) + "</p>" : "";
    var note = l.deeper && noteFor(l.deeper.note);
    var deeper = note ? '<button class="oph-btn sec oph-wide" data-act="lndeeper" data-n="' + esc(l.deeper.note) + '">' + ico("book") + " " + s("goDeeper") + '</button><p class="oph-small" lang="en">' + s("deeperNote", { t: note.title }) + "</p>" : "";
    var nx = D.nextLesson(W.ix, st.store), nl = nx && meta(nx.id);
    var more = nl ? '<button class="oph-nextnote" data-act="lesson" data-l="' + esc(nx.id) + '"><span class="oph-small">' + s("nextLesson") +
      (nx.level === "resident" ? " " + badge("learn.resident") : "") + "</span><b>" + tx(nl.title) + '</b><span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button>" : "";
    return '<div class="ln-done"><p class="oph-verdict ok">' + ico("check") + "<span>" + s("lessonDone") + "</span></p>" +
      '<h1 class="ln-title">' + tx(l.title) + '</h1><p class="ln-remember">' + rich(l.remember) + '</p><p class="oph-small">' + s("comesBack") + "</p></div>" +
      '<div class="ln-done-act">' + test + sim + deeper + more +
      '<button class="oph-btn sec oph-wide ln-backlearn" data-act="lnexit">' + s("backLearn") + "</button></div>";
  }
  function bankFor(t) { var b = null; if (t && t.mcqTopic) (O._banks || []).forEach(function (x) { if (x.topic) b = x; }); return b; }
  function noteFor(id) { var n = null; (O._reads || []).forEach(function (r) { if (!n && r.find) n = r.find(id); }); return n; }

  /* ---------- See it: the picture with tap-to-reveal hotspots ---------- */
  function seeHtml(l) {
    var see = l.see, sz = picSize(see), hs = see.hotspots;
    var style = sz ? ' style="aspect-ratio:' + sz.w + " / " + sz.h + ";width:min(100%, calc(52vh * " + (sz.w / sz.h).toFixed(4) + '))"' : "";
    var hots = hs.map(function (h, i) {
      var on = !!W.hot[i], side = h.x < 0.34 ? "l" : h.x > 0.66 ? "r" : "c";
      return '<button class="ln-hot" data-act="lnhot" data-k="' + i + '" data-side="' + side + '"' + (h.y > 0.72 ? ' data-up=""' : "") + (i === W.act ? " data-named" : "") + ' style="left:' + (h.x * 100).toFixed(2) + "%;top:" + (h.y * 100).toFixed(2) + '%"' +
        ' aria-expanded="' + on + '" aria-label="' + s("point", { n: i + 1 }) + (on ? ": " + esc(plain(h.label)) : "") + '"><span class="ln-dot" aria-hidden="true">' + (i + 1) + "</span>" +
        '<span class="ln-chip" aria-hidden="true"' + (i === W.act ? "" : " hidden") + ">" + tx(h.label) + "</span></button>";
    }).join("");
    return '<h2 class="ln-h">' + s("see") + "</h2>" +
      '<figure class="ln-fig"><div class="ln-pic' + (see.img ? "" : " diagram") + '" id="lnPic"' + style + ">" +
      '<button class="ln-pic-b" data-act="lnzoom" aria-label="' + s("enlarge", { x: plain(see.alt) }) + '"><img id="lnImg" src="' + esc(imgSrc(see)) + '" alt="' + esc(plain(see.alt)) + '"' +
      (sz ? ' width="' + sz.w + '" height="' + sz.h + '"' : "") + ' decoding="async"></button>' + hots + "</div>" +
      "<figcaption>" + tx(see.caption) + (see.credit ? ' <span class="oph-credit" lang="en">' + esc(see.credit) + "</span>" : "") + "</figcaption></figure>" +
      '<p class="oph-small ln-tap" id="lnTap">' + s("tapPoints") + "</p>" +
      '<ol class="ln-hotlist" id="lnHotList">' + hotList(l) + "</ol>" +
      (hs.length && hs.some(function (h, i) { return !W.hot[i]; }) ? '<button class="oph-btn sec ln-showall" data-act="lnshowall">' + s("showAll") + "</button>" : "") +
      moreHtml(l);
  }
  /* ---------- More pictures: image-library items under the main one, each with its caption and credit ---------- */
  function moreHtml(l) {
    var ids = moreIds(l);
    return ids.length ? '<h3 class="ln-moreh">' + s("more") + '</h3><div class="ln-more">' + ids.map(mediaFig).join("") + "</div>" : "";
  }
  function mediaFig(id) {
    var m = W.media[id], alt = esc(plain(m.alt)), ar = ' style="aspect-ratio:' + m.w + " / " + m.h + '"', pic;
    if (m.kind === "animation") {
      var c = W.svg[id], on = !W.paused[id];
      pic = '<div class="ln-anim' + (on ? "" : " paused") + '" data-m="' + esc(id) + '" role="img" aria-label="' + alt + '"' + ar + ">" +
        (c && c.t ? D.scopeSvg(c.t, "lnm" + (++W.n)) : "") + "</div>";
      return '<figure class="ln-mfig">' + pic + '<figcaption class="ln-mcap"><span>' + tx(m.caption) + " " + creditHtml(m) + "</span>" +
        '<button class="ln-play" data-act="lnplay" data-m="' + esc(id) + '" aria-label="' + s(on ? "pauseA" : "playA", { x: plain(m.alt).split(/[.:]/)[0] }) + '">' +
        s(on ? "pause" : "play") + "</button></figcaption></figure>";
    }
    pic = '<button class="ln-mpic" data-act="lnzoom" data-m="' + esc(id) + '" aria-label="' + s("enlarge", { x: plain(m.alt) }) + '"' + ar + ">" +
      '<img src="' + esc(mediaUrl(m)) + '" alt="' + alt + '" width="' + m.w + '" height="' + m.h + '" loading="lazy" decoding="async"></button>';
    return '<figure class="ln-mfig">' + pic + "<figcaption>" + tx(m.caption) + " " + creditHtml(m) + "</figcaption></figure>";
  }
  // Credit as the licence asks: author, licence (linked), source link, "adapted" when changed; originals name MAIKNOWLEDGE LLP.
  function creditHtml(m) {
    var c = D.mediaCredit(m), parts = [];
    function a(u, t) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>"; }
    if (c.by) parts.push(esc(c.by));
    parts.push(c.licenceUrl ? a(c.licenceUrl, c.licence) : esc(c.licence));
    if (c.source) parts.push(a(c.source, /commons\.wikimedia\.org/.test(c.source) ? "Wikimedia Commons" : "Source") + (c.adapted ? ", adapted" : ""));
    return '<span class="oph-credit" lang="en">' + parts.join(" · ") + "</span>";
  }
  // Fill each animation frame painted before its SVG arrived.
  function fillSvgs() {
    Array.prototype.forEach.call(G.document.querySelectorAll(".ln-anim[data-m]:empty"), function (el) {
      var id = el.getAttribute("data-m");
      svgSrc(id).then(function (t) { if (el.isConnected && !el.firstChild) el.innerHTML = D.scopeSvg(t, "lnm" + (++W.n)); },
        function () { if (el.isConnected) { el.classList.add("err"); el.innerHTML = '<p class="ln-imgerr">' + s("mediaErr") + "</p>"; } });
    });
  }
  function togglePlay(b) {
    var id = b.getAttribute("data-m"), m = W.media && W.media[id], el = G.document.querySelector('.ln-anim[data-m="' + id + '"]');
    if (!m || !el) return;
    W.paused[id] = !W.paused[id];
    var on = !W.paused[id];
    el.classList.toggle("paused", !on);
    b.setAttribute("aria-label", D.t(STR[on ? "pauseA" : "playA"], L()).replace("{x}", plain(m.alt).split(/[.:]/)[0]));
    b.textContent = D.t(STR[on ? "pause" : "play"], L()); // the host icon set has no pause glyph: words for both
  }
  function hotList(l) {
    return l.see.hotspots.map(function (h, i) {
      return W.hot[i] ? '<li value="' + (i + 1) + '"><b>' + tx(h.label) + "</b> " + rich(h.note) + "</li>" : "";
    }).join("");
  }
  // Size the frame to the picture once it loads, so hotspot fractions land on the picture (not on letterboxing).
  function wireSee(l) {
    var img = G.document.getElementById("lnImg"), pic = G.document.getElementById("lnPic");
    if (!img) return;
    function fitFrame() {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return;
      pic.style.aspectRatio = w + " / " + h;
      pic.style.width = "min(100%, calc(52vh * " + (w / h).toFixed(4) + "))";
      pic._w = w; pic._h = h;
    }
    img.addEventListener("load", fitFrame);
    img.addEventListener("error", function () {
      pic.classList.add("err");
      pic.innerHTML = '<p class="ln-imgerr">' + s("imgErr") + "</p>";
      l.see.hotspots.forEach(function (h, i) { W.hot[i] = 1; });
      var list = G.document.getElementById("lnHotList"); if (list) list.innerHTML = hotList(l);
      var sa = G.document.querySelector(".ln-showall"); if (sa) sa.remove();
      var tp = G.document.getElementById("lnTap"); if (tp) tp.remove();
    });
    if (img.complete && img.naturalWidth) fitFrame();
  }
  function toggleHot(i, quiet) {
    var l = W.les, h = l && l.see.hotspots[i];
    if (!h) return;
    W.hot[i] = W.hot[i] ? 0 : 1;
    // One name on the picture at a time (the last point opened), so labels never pile up; the list keeps them all.
    W.act = !quiet && W.hot[i] ? i : null;
    Array.prototype.forEach.call(G.document.querySelectorAll(".ln-hot"), function (b) {
      var on = +b.getAttribute("data-k") === W.act;
      b.querySelector(".ln-chip").hidden = !on;
      b.toggleAttribute("data-named", on); // the named point sits above its neighbours, so its name is never under a dot
    });
    var b = G.document.querySelector('.ln-hot[data-k="' + i + '"]');
    if (b) {
      b.setAttribute("aria-expanded", String(!!W.hot[i]));
      b.setAttribute("aria-label", D.t(STR.point, L()).replace("{n}", i + 1) + (W.hot[i] ? ": " + plain(h.label) : ""));
    }
    G.document.getElementById("lnHotList").innerHTML = hotList(l);
    if (l.see.hotspots.every(function (x, j) { return W.hot[j]; })) { var sa = G.document.querySelector(".ln-showall"); if (sa) sa.remove(); }
    I.haptic("tap");
  }

  /* ---------- enlarged picture: the clinic stage over the lesson (same as the notes reader) ---------- */
  // b: the button tapped; a data-m button enlarges that library picture, else the lesson's main picture.
  function zoom(b) {
    var l = W.les, mid = b && b.getAttribute && b.getAttribute("data-m"), m = mid && W.media && W.media[mid], r = root();
    var pic = G.document.getElementById("lnPic"), see, sz;
    if (!l || W.zoom) return;
    if (m) { see = { img: m.kind === "photo", alt: m.alt, caption: m.caption, src: mediaUrl(m) }; sz = { w: m.w, h: m.h }; }
    else {
      see = l.see;
      if (!pic || pic.classList.contains("err")) return;
      sz = picSize(see) || { w: pic._w || 800, h: pic._h || 600 };
    }
    var z = G.document.createElement("div");
    z.className = "oph-zoom pre";
    z.setAttribute("role", "dialog");
    z.setAttribute("aria-modal", "true");
    z.setAttribute("aria-label", D.t(STR.enlarged, L()));
    z.innerHTML = I.top(s("closeImg"), s("enlarged"), s("zoomHint"),
        '<button class="oph-icon" data-act="lnzin" aria-label="' + s("zoomIn") + '">' + ico("plus") + "</button>" +
        '<button class="oph-icon" data-act="lnzfit" aria-label="' + s("fit") + '">' + ico("target") + "</button>") +
      '<div class="oph-stage' + (see.img ? "" : " ln-zdiag") + '" id="lnZStage"><img id="lnZImg" src="' + esc(see.src || imgSrc(see)) + '" alt="' + esc(plain(see.alt)) + '" width="' + sz.w + '" height="' + sz.h + '" decoding="async"></div>' +
      '<p class="oph-zcap">' + tx(see.caption) + "</p>";
    Array.prototype.forEach.call(r.children, function (c) { c.inert = true; });
    r.appendChild(z);
    W.zoom = z; W.zoomFrom = b && b.nodeType === 1 ? b : null;
    z._z = S.attach(G.document.getElementById("lnZStage"), G.document.getElementById("lnZImg"));
    G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { z.classList.remove("pre"); }); });
    try { z.querySelector(".oph-back").focus({ preventScroll: true }); } catch (e) {}
  }
  function closeZoom() {
    var z = W.zoom;
    W.zoom = null;
    Array.prototype.forEach.call(z.parentNode.children, function (c) { if (c !== z) c.inert = false; });
    z.classList.add("pre", "out");
    G.setTimeout(function () { z.remove(); }, 150);
    var b = W.zoomFrom && W.zoomFrom.isConnected ? W.zoomFrom : G.document.querySelector("[data-act=lnzoom]");
    W.zoomFrom = null;
    try { if (b) b.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- glossary: bottom sheet, and the alphabetical list ---------- */
  function openSheet(id, from) {
    var g = W.gloss && W.gloss[id], r = root();
    if (!g || W.sheet) return;
    var el = G.document.createElement("div");
    el.className = "ln-sheetwrap pre";
    if (L() === "hi") el.setAttribute("lang", "hi");
    el.innerHTML = '<div class="ln-scrim" data-act="lnsheetclose" aria-hidden="true"></div>' +
      '<div class="ln-sheet" role="dialog" aria-modal="true" aria-labelledby="lnSheetH"><div class="ln-grab" aria-hidden="true"></div>' +
      '<h2 id="lnSheetH">' + tx(g.term) + "</h2><p>" + tx(g.def) + "</p>" +
      '<button class="oph-btn sec oph-wide" data-act="lnsheetclose">' + s("closeSheet") + "</button></div>";
    Array.prototype.forEach.call(r.children, function (c) { c.inert = true; });
    r.appendChild(el);
    W.sheet = { el: el, from: from };
    G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { el.classList.remove("pre"); }); });
    try { el.querySelector(".ln-sheet .oph-btn").focus({ preventScroll: true }); } catch (e) {}
  }
  function closeSheet() {
    var sh = W.sheet;
    if (!sh) return;
    W.sheet = null;
    Array.prototype.forEach.call(sh.el.parentNode.children, function (c) { if (c !== sh.el) c.inert = false; });
    sh.el.classList.add("pre", "out");
    G.setTimeout(function () { sh.el.remove(); }, 180);
    try { if (sh.from && sh.from.isConnected) sh.from.focus({ preventScroll: true }); } catch (e) {}
  }
  function glossList(focusSel) {
    st.view = "lngloss"; st.onBack = sheetBack; W.again = glossList;
    var g = W.gloss || {}, lang = L();
    var ids = Object.keys(g).sort(function (a, b) { return D.t(g[a].term, lang).localeCompare(D.t(g[b].term, lang), lang); });
    paint(I.top(s("backLearn"), s("glossary"), s("nTerms", { n: fmt(ids.length) }), langBtn()) +
      '<div class="oph-scroll oph-pad"><div class="ln-col"><ul class="ln-gloss">' + ids.map(function (id) {
        return '<li><button class="ln-grow" data-act="lngloss" data-g="' + esc(id) + '" aria-haspopup="dialog"><b>' + tx(g[id].term) + "</b><span>" + tx(g[id].def) + "</span></button></li>";
      }).join("") + "</ul></div></div>", focusSel);
  }

  /* ---------- Revise: each finished lesson's remember line as a recall card (deck key "learn") ---------- */
  function revise() {
    var ids = D.learnDue(st.store, I.today()).filter(meta);
    W.rev = { ids: ids, i: 0, shown: false };
    renderRevise();
  }
  function renderRevise(focusSel) {
    var r = W.rev;
    st.view = "lnrevise"; st.onBack = sheetBack; W.again = renderRevise;
    if (r.i >= r.ids.length) {
      return paint(I.top(s("backLearn"), s("revise"), "", langBtn()) +
        '<div class="oph-scroll oph-pad"><div class="ln-col ln-art"><p class="oph-verdict ok">' + ico("check") + "<span>" + (r.ids.length ? s("reviseDone") : s("reviseEmpty")) + "</span></p>" +
        '<button class="oph-btn pri oph-wide" data-act="back">' + s("backLearn") + "</button></div></div>", focusSel || ".oph-btn.pri");
    }
    var id = r.ids[r.i], l = W.lessons[id], ans = "";
    if (!l && !W.bad[id]) fetchLesson(id).then(function () { if (st.view === "lnrevise" && W.rev === r && r.ids[r.i] === id && r.shown) renderRevise(); });
    if (r.shown) {
      ans = l ? '<p class="ln-remember">' + rich(l.remember) + "</p>"
        : W.bad[id] ? '<p role="alert">' + s("lessonErr") + " " + s("lessonErrHint") + '</p><button class="oph-btn sec" data-act="lnshow">' + ico("refresh") + " " + s("retry") + "</button>"
        : '<p role="status" class="oph-mut">' + s("loadingLesson") + "</p>";
    }
    paint(I.top(s("backLearn"), s("revise"), s("xOfY", { i: r.i + 1, n: r.ids.length }), langBtn()) +
      '<div class="oph-scroll oph-pad"><article class="ln-art"><p class="oph-small">' + s("recall") + '</p><h1 class="ln-title">' + tx(meta(id).title) + "</h1>" +
      ans + "</article></div>" +
      '<div class="oph-foot ln-rfoot">' + (r.shown
        ? '<div class="ln-rate"><button class="oph-btn sec" data-act="lnrate" data-g="1">' + s("again") + '</button><button class="oph-btn pri" data-act="lnrate" data-g="3">' + s("gotIt") + "</button></div>"
        : '<button class="oph-btn pri oph-wide" data-act="lnshow">' + s("showAnswer") + "</button>") + "</div>",
      focusSel || (r.shown ? '[data-act=lnrate][data-g="3"]' : "[data-act=lnshow]"));
  }
  function rate(g) {
    var r = W.rev;
    if (!r || !r.shown || r.i >= r.ids.length) return;
    C.review(st.store, "learn", r.ids[r.i], g, I.today());
    I.save();
    r.i++; r.shown = false;
    renderRevise();
  }

  /* ---------- Test-side hooks ---------- */
  // Today's plan (MBBS): the next lesson, or Revise when every lesson is done. English, like the rest of the Test tab.
  function planItem() {
    if (!W.ix) return null;
    var d = I.today(), today = null, id;
    for (id in st.store.learn) if (st.store.learn[id].day === d && meta(id)) today = id;
    var nx = D.nextLesson(W.ix, st.store), nl = nx && nx.level === "mbbs" && meta(nx.id);
    if (today) return { act: "lesson", key: nl ? nx.id : today, title: "Lesson", done: true, line: "Done today: " + esc(D.t(meta(today).title, "en")) };
    if (nl) return { act: "lesson", key: nx.id, title: "Lesson", done: false, line: esc(D.t(nl.title, "en")) + " · " + nl.minutes + " min" };
    var due = D.learnDue(st.store, d).filter(meta).length;
    return due ? { act: "lnrevise", title: "Revise", done: false, line: fmt(due) + (due === 1 ? " lesson" : " lessons") + " to revise" } : null;
  }
  // "Learn this" after a wrong clinic answer: the first lesson (study order) whose test covers the image's class.
  function lessonFor(trackId, cls) {
    var ids = W.ix ? allIds() : [];
    for (var i = 0; i < ids.length; i++) {
      var l = meta(ids[i]), t = l && l.test;
      if (t && t.clinic === trackId && (!t.classes || t.classes.indexOf(cls) >= 0)) return { id: ids[i], title: plain(l.title) };
    }
    return null;
  }

  /* ---------- wiring ---------- */
  function setPrefs(k, v) { st.prefs[k] = v; D.savePrefs(I.ls(), st.prefs); }
  A.lnpick = function (b) { setPrefs("tab", b.getAttribute("data-t")); O._renderHub(); };
  A.lntab = function (b) {
    I.leave(); st.session = null;
    setPrefs("tab", b.getAttribute("data-t"));
    O._renderHub();
    var f = G.document.querySelector('[data-act=lntab][data-t="' + b.getAttribute("data-t") + '"]');
    try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
  };
  A.lnsetlang = function (b) { setPrefs("lang", b.getAttribute("data-l")); firstRun(); var f = G.document.querySelector('[data-act=lnsetlang][data-l="' + L() + '"]'); try { f.focus({ preventScroll: true }); } catch (e) {} };
  A.lnlang = function () { setPrefs("lang", L() === "hi" ? "en" : "hi"); if (W.again) W.again(".ln-lang"); };
  A.lnretryix = function () { load(); home(); };
  A.lesson = function (b) { openLesson(b.getAttribute("data-l") || b.getAttribute("data-k")); };
  A.lnexit = function () { I.leave(); O._renderHub(); };
  A.lnnext = function () { if (W.les && W.step < stepKeys(W.les).length - 1) renderStep(W.step + 1); };
  A.lnprev = function () { if (W.les && W.step > 0) renderStep(W.step - 1); };
  A.lnans = function (b) { answer(+b.getAttribute("data-k"), false); };
  A.lnhot = function (b) { toggleHot(+b.getAttribute("data-k")); };
  A.lnshowall = function () { var l = W.les; l.see.hotspots.forEach(function (h, i) { if (!W.hot[i]) toggleHot(i, true); }); var t = G.document.querySelector(".ln-pic-b"); try { t.focus({ preventScroll: true }); } catch (e) {} };
  A.lnzoom = zoom;
  A.lnplay = togglePlay;
  A.lnzin = function () { if (W.zoom) W.zoom._z.zoomBy(1.5); };
  A.lnzfit = function () { if (W.zoom) W.zoom._z.reset(); };
  A.lngloss = function (b) { openSheet(b.getAttribute("data-g"), b); };
  A.lnsheetclose = closeSheet;
  A.lnglossary = function () { glossList(); };
  A.lnrevise = function () { revise(); };
  A.lnshow = function () { var r = W.rev; if (r) { if (r.ids[r.i]) delete W.bad[r.ids[r.i]]; r.shown = true; renderRevise(); } }; // again: retries a failed load
  A.lnrate = function (b) { rate(+b.getAttribute("data-g")); };
  // Back from Test yourself / Go deeper returns to the lesson step it left (st.ret, read by O.back).
  function lessonRet() {
    var l = W.les, i = W.step, p = W.picks;
    return function () { W.les = l; W.picks = p; W.hot = {}; W.act = null; renderStep(i, true); };
  }
  A.lntest = function () {
    var l = W.les, t = l && l.test, ret = lessonRet(), b = bankFor(t);
    if (!t) return;
    I.leave();
    if (t.clinic && I.track(t.clinic) && st.decks[t.clinic]) O._startClinic(t.clinic, t.classes);
    else if (b) b.topic(t.mcqTopic);
    // The paywall (a spent Resident trial) leaves the lesson on screen: repaint it. An empty clinic falls back to the hub.
    if (st.view === "lesson") ret(); else if (st.view !== "hub") I.setRet(ret, D.t(STR.backLesson, L()), L());
  };
  A.lnsim = function (b) {
    var ret = lessonRet(), id = b.getAttribute("data-s");
    I.leave();
    (O._sims || []).forEach(function (x) { if (x.id === id) x.open(); });
    if (st.view !== "hub") I.setRet(ret, D.t(STR.backLesson, L()), L());
  };
  A.lndeeper = function (b) { var ret = lessonRet(); A.note(b); I.setRet(ret, D.t(STR.backLesson, L()), L()); };

  function typing(e) { var n = e.target && e.target.tagName; return n === "INPUT" || n === "TEXTAREA"; }
  function termKey(e) {
    var el = e.target;
    if ((e.key !== "Enter" && e.key !== " ") || !el || !el.classList || !el.classList.contains("ln-term")) return false;
    e.preventDefault(); A.lngloss(el); return true;
  }
  K.lesson = function (e) {
    if (W.sheet || typing(e) || termKey(e)) return;
    if (W.zoom) {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); W.zoom._z.zoomBy(1.25); }
      else if (e.key === "-") { e.preventDefault(); W.zoom._z.zoomBy(0.8); }
      else if (e.key === "0") { e.preventDefault(); W.zoom._z.reset(); }
      return;
    }
    var key = W.les && stepKeys(W.les)[W.step];
    if (e.key === "ArrowRight") { var nx = G.document.getElementById("lnNext"); if (nx && !nx.disabled) { e.preventDefault(); renderStep(W.step + 1, true); } }
    else if (e.key === "ArrowLeft" && W.step > 0) { e.preventDefault(); renderStep(W.step - 1, true); }
    else if (key && key.indexOf("check") === 0 && /^[1-9]$/.test(e.key)) { e.preventDefault(); answer(+e.key - 1, true); }
  };
  K.lnrevise = function (e) {
    var r = W.rev;
    if (W.sheet || !r || r.i >= r.ids.length || termKey(e)) return;
    if (!r.shown && e.key === " " && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); A.lnshow(); }
    else if (r.shown && (e.key === "1" || e.key === "2")) { e.preventDefault(); rate(e.key === "1" ? C.AGAIN : C.GOOD); }
  };

  O._learn = { load: load, home: home, firstRun: firstRun, tabs: tabs, planItem: planItem, lessonFor: lessonFor, meta: meta, _w: W };
})(typeof window !== "undefined" ? window : this);
