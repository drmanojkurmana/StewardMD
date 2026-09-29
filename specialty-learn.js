/* Specialty engine Learn: the beginner's side of a specialty module. ES5. SPECIALTY.features.learn(host).
   Two tabs, Learn | Test, chosen on a first-run screen with the language (English / Hindi). Learn = lessons
   (<base>/learn/, one idea per screen), a Revise set of FSRS cards (deck key "learn"), Explore (registered explorers),
   Reference (notes, calculators, glossary). MBBS lessons are free; Resident lessons are Pro with one trial
   (learn.resident). Lessons load on open: opening the module fetches learn/glossary.json, learn/media/credits.json
   and learn/index.json only. A missing index (404) is "no lessons yet", not an error. Pure logic (t, glossParts,
   validateLesson, nextLesson, finishLesson, learnDue) is in specialty-data.js. */
(function (G) {
  "use strict";
  var SP = G.SPECIALTY || (G.SPECIALTY = {});
  if (!SP.features) SP.features = {};

  SP.features.learn = function (host) {
    var I = host._internal, st = host._st, cfg = host.cfg, C = G.SPECIALTY_CORE, D = G.SPECIALTY_DATA, S = G.SPECIALTY_STAGE, A = I.ACTIONS, K = I.KEYS;
    var ico = I.ico, esc = I.esc, fmt = I.fmt, BASE = I.BASE;
    function T(en, hi) { return { en: en, hi: hi }; }

    /* ---------- Learn chrome, English and Hindi ({h} is the module's name) ---------- */
    var STR = {
      learn: T("Learn", "सीखें"), test: T("Test", "टेस्ट"), mode: T("Learn or test", "सीखें या टेस्ट"),
      homeSub: T("One idea at a time", "एक समय में एक बात"), language: T("Language", "भाषा"),
      welcome: T("Welcome to {h}", "{h} में आपका स्वागत है"),
      choose: T("Where would you like to begin?", "आप कहाँ से शुरू करना चाहेंगे?"),
      learnLine: T("Short lessons with pictures. Start here if you are new.", "तस्वीरों के साथ छोटे पाठ। नए हैं तो यहीं से शुरू करें।"),
      testLine: T("Clinics, questions and drills to practise on.", "अभ्यास के लिए क्लिनिक, प्रश्न और ड्रिल।"),
      switchLater: T("You can switch between Learn and Test at the top of the screen at any time.", "सीखें और टेस्ट के बीच आप कभी भी स्क्रीन के ऊपर से बदल सकते हैं।"),
      startHere: T("Start here", "यहाँ से शुरू करें"), upNext: T("Up next", "अगला पाठ"), cont: T("Continue", "जारी रखें"),
      min: T("{n} min", "{n} मिनट"), ofDone: T("{d} of {n} done", "{n} में से {d} पूरे"),
      done: T("Done", "पूरा"), toDo: T("to do", "बाकी"), mbbs: T("MBBS", "MBBS"), resident: T("Resident", "Resident"),
      mbbsDone: T("You have finished every MBBS lesson.", "आपने MBBS के सभी पाठ पूरे कर लिए हैं।"),
      residentNudge: T("Ready for more? The Resident lessons go deeper.", "और आगे? Resident पाठ और गहराई में जाते हैं।"),
      allDoneH: T("Every lesson done", "सभी पाठ पूरे"),
      allDone: T("Revise what is due, or test yourself.", "जो दोहराना है उसे दोहराएँ, या खुद को परखें।"),
      goTest: T("Go to Test", "टेस्ट पर जाएँ"),
      revise: T("Revise", "दोहराएँ"), reviseDue: T("{n} due today", "आज {n} दोहराने हैं"),
      reference: T("Reference", "संदर्भ"), glossary: T("Glossary", "शब्दावली"), nTerms: T("{n} terms", "{n} शब्द"),
      glossSub: T("Words used in the lessons", "पाठों में आए शब्द"),
      calc: T("Calculators", "कैलकुलेटर"), nTools: T("{n} tools", "{n} टूल"),
      loading: T("Loading lessons…", "पाठ लोड हो रहे हैं…"),
      ixErr: T("The lessons did not load. Check the connection and try again. Test still works.", "पाठ लोड नहीं हुए। इंटरनेट कनेक्शन देखकर फिर कोशिश करें। टेस्ट अभी भी काम करता है।"),
      retry: T("Try again", "फिर कोशिश करें"),
      none: T("No lessons yet. They are being written; the Test tab is ready now.", "अभी कोई पाठ नहीं है। पाठ लिखे जा रहे हैं; टेस्ट टैब अभी तैयार है।"),
      lessonErr: T("This lesson did not load.", "यह पाठ लोड नहीं हुआ।"),
      lessonErrHint: T("Check the connection and try again.", "इंटरनेट कनेक्शन देखकर फिर कोशिश करें।"),
      loadingLesson: T("Loading the lesson…", "पाठ लोड हो रहा है…"),
      stepOf: T("Step {i} of {n}", "चरण {i} / {n}"), next: T("Next", "आगे"), prev: T("Previous", "पीछे"),
      closeLesson: T("Close lesson", "पाठ बंद करें"),
      idea: T("The idea", "मूल बात"), see: T("See it", "देखें"), why: T("Why it happens", "ऐसा क्यों होता है"),
      spot: T("Spot it", "पहचानें"), todo: T("What to do", "क्या करें"), remember: T("Remember it", "याद रखें"),
      check: T("Check yourself", "खुद को जाँचें"), qOf: T("Question {i} of {n}", "प्रश्न {i} / {n}"),
      analogy: T("Think of it like this", "ऐसे समझें"),
      tapPoints: T("Tap each numbered point to name it. Tap the picture to enlarge it.", "हर नंबर वाले बिंदु को छूकर उसका नाम देखें। बड़ा देखने के लिए तस्वीर को छुएँ।"),
      showAll: T("Show all names", "सभी नाम दिखाएँ"), point: T("Point {n}", "बिंदु {n}"),
      enlarge: T("Enlarge: {x}", "बड़ा करें: {x}"), enlarged: T("Enlarged picture", "बड़ी तस्वीर"),
      zoomHint: T("Pinch, double-tap or + and -", "पिंच, डबल-टैप या + और -"), closeImg: T("Close picture", "तस्वीर बंद करें"),
      zoomIn: T("Zoom in", "ज़ूम करें"), fit: T("Fit picture", "पूरी तस्वीर"),
      imgErr: T("The picture did not load. Its labelled points are listed below.", "तस्वीर लोड नहीं हुई। उसके सभी बिंदु नीचे लिखे हैं।"),
      right: T("Right", "सही"), wrong: T("Not quite. The answer is {x}.", "सही नहीं। सही उत्तर: {x}।"),
      answerFirst: T("Choose an answer to go on.", "आगे बढ़ने के लिए एक उत्तर चुनें।"),
      lessonDone: T("Lesson done", "पाठ पूरा हुआ"),
      comesBack: T("The line above comes back in Revise in a few days, just before you would forget it.", "ऊपर वाली बात कुछ दिनों में दोहराएँ में फिर आएगी, ठीक भूलने से पहले।"),
      testYourself: T("Test yourself", "खुद को परखें"),
      testClinic: T("{c}: real cases of this", "{c}: इसके असली केस"), testBank: T("Question bank: questions on this topic", "प्रश्न बैंक: इस विषय के प्रश्न"),
      trySim: T("Try the drill", "ड्रिल पर अभ्यास करें"), simLine: T("Drill: {t}", "ड्रिल: {t}"),
      tryTool: T("Try the calculator", "कैलकुलेटर आज़माएँ"), toolLine: T("Calculator: {t}", "कैलकुलेटर: {t}"),
      goDeeper: T("Go deeper", "और गहराई से"), tryExplorer: T("Explore it", "इसे खोजें"), explorerLine: T("Explorer: {t}", "एक्सप्लोरर: {t}"), deeperNote: T("Study note: {t}", "अध्ययन नोट: {t}"),
      nextLesson: T("Next lesson", "अगला पाठ"), backLearn: T("Back to Learn", "सीखें पर वापस"),
      recall: T("Say the one thing to remember from this lesson, then check.", "इस पाठ की ज़रूरी बात मन में बोलें, फिर जाँचें।"),
      showAnswer: T("Show answer", "उत्तर देखें"), again: T("Again", "फिर से"), gotIt: T("Got it", "याद था"),
      xOfY: T("{i} of {n}", "{n} में से {i}"), reviseDone: T("All revised for today.", "आज का दोहराना पूरा हुआ।"),
      reviseEmpty: T("Nothing to revise today. Finished lessons come back here when they are due.", "आज दोहराने को कुछ नहीं है। पूरे किए पाठ समय आने पर यहाँ लौटेंगे।"),
      closeSheet: T("Close", "बंद करें"),
      trial1: T("1 free try", "1 मुफ़्त प्रयास"), trialUsed: T("Trial used", "प्रयास हो चुका"),
      backLesson: T("Back to lesson", "पाठ पर वापस"), backTest: T("Back to Test", "टेस्ट पर वापस"), prevStep: T("Previous step", "पिछला चरण"),
      more: T("More pictures", "और तस्वीरें"), pause: T("Pause", "रोकें"), play: T("Play", "चलाएँ"),
      pauseA: T("Pause animation: {x}", "एनिमेशन रोकें: {x}"), playA: T("Play animation: {x}", "एनिमेशन चलाएँ: {x}"),
      mediaErr: T("This picture did not load.", "यह तस्वीर लोड नहीं हुई।"), draftMark: T("Draft, pending specialist review", "ड्राफ़्ट, विशेषज्ञ समीक्षा बाकी")
    };
    var own = (cfg.strings && cfg.strings.learn) || {}, k;
    for (k in own) if (Object.prototype.hasOwnProperty.call(own, k)) STR[k] = own[k];
    function L() { return I.lang(); }
    function hname() { return D.t(cfg.title, L()); }
    // Chrome string, HTML-safe; {n}-style values are escaped.
    function s(key, v) {
      return esc(D.t(STR[key], L())).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : x === "h" ? esc(hname()) : m; });
    }
    function rawS(key) { return D.t(STR[key], L()); }
    function fell(obj) { return L() === "hi" && obj && typeof obj === "object" && !obj.hi; }
    // Content text in the current language, escaped. A missing Hindi string falls back to English, marked lang="en".
    function tx(obj) { var h = esc(D.t(obj, L())); return fell(obj) ? '<span lang="en">' + h + "</span>" : h; }
    function plain(obj) {
      return D.glossParts(D.t(obj, L())).map(function (p) { return p.text != null ? p.text : p.shown || termText(p.term); }).join("");
    }
    function termText(id) { var g = W.gloss && W.gloss[id]; return g ? D.t(g.term, L()) : id; }
    // Rich text: escaped, [[term]] links open the glossary sheet. Each is an inline span with button semantics, not a
    // <button>: a button is an atomic box, so a long term jumped to its own line instead of wrapping with the
    // sentence. Enter and Space open it (termKey).
    function rich(obj) {
      var h = D.glossParts(D.t(obj, L())).map(function (p) {
        if (p.text != null) return esc(p.text);
        var label = esc(p.shown || termText(p.term));
        return W.gloss && W.gloss[p.term] ? '<span class="ln-term" role="button" tabindex="0" data-act="lngloss" data-g="' + esc(p.term) + '" aria-haspopup="dialog">' + label + "</span>" : label;
      }).join("");
      return fell(obj) ? '<span lang="en">' + h + "</span>" : h;
    }

    /* ---------- data ---------- */
    // media: the image library by id (learn/media/credits.json); svg: fetched animation sources by id; n: SVG count.
    var W = { ix: null, err: null, loading: null, lessons: {}, bad: {}, inflight: {}, gloss: null, media: null, svg: {}, n: 0, paused: {},
      les: null, step: 0, picks: {}, hot: {}, sheet: null, zoom: null, rev: null, act: null };
    // A lesson file loads when it is opened and stays cached. Never rejects: a failed or invalid lesson is W.bad[id].
    function fetchLesson(id) {
      if (W.lessons[id]) return Promise.resolve();
      if (W.inflight[id]) return W.inflight[id];
      return (W.inflight[id] = Promise.resolve(W.loading).then(function () { return I.getJSON("learn/lessons/" + id + ".json"); }).then(function (l) {
        var e = D.validateLesson(l, W.gloss, W.media);
        if (l && l.id !== id) e.push("id does not match the file name");
        if (e.length) { W.bad[id] = 1; try { G.console.warn("Learn: lesson " + id + " is invalid", e); } catch (x) {} return; }
        W.lessons[id] = l; delete W.bad[id];
      }, function () { W.bad[id] = 1; }).then(function () { delete W.inflight[id]; }));
    }
    // Never rejects. A missing index (404: the host has no lessons yet) is an empty index; any other failure is
    // W.err and the Learn home offers a retry.
    function load() {
      if (W.loading) return W.loading;
      W.err = null;
      W.loading = I.getJSON("learn/glossary.json").then(function (g) { W.gloss = (g && g.terms) || {}; }, function () { W.gloss = null; })
        .then(function () { return I.getJSON("learn/media/credits.json"); })
        .then(function (c) { W.media = {}; ((c && c.items) || []).forEach(function (m) { W.media[m.id] = m; }); }, function () { W.media = null; })
        .then(function () { return I.getJSON("learn/index.json").then(null, function (e) { if (e && e.status === 404) return { v: 1, units: [], lessons: {} }; throw e; }); })
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
    // A lesson's summary in index.json: title, minutes, idea, see {img | diagram}, test?.
    function meta(id) { return (W.ix && W.ix.lessons && W.ix.lessons[id]) || null; }
    function allIds() { var out = []; D.learnUnits(W.ix).forEach(function (u) { out = out.concat(u.lessons); }); return out; }
    function doneCount(ids) { return ids.filter(function (id) { return D.lessonDone(st.store, id); }).length; }
    function imgSrc(see) { return see.img ? I.imgUrl(see.img) : BASE + "learn/" + see.diagram; }
    function deckSize(see) {
      var d = see.deckItem && st.decks[see.deckItem.deck], list = d && (d.items || d.cases);
      if (list) for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(see.deckItem.id)) return list[i].w ? { w: list[i].w, h: list[i].h } : null;
      return null;
    }
    // The picture's size before it loads: the deck item's, else the lesson's w and h (a diagram's viewBox).
    function picSize(see) { return deckSize(see) || (see.w > 0 && see.h > 0 ? { w: see.w, h: see.h } : null); }
    function mediaUrl(m) { return BASE + "learn/media/" + m.file; }
    function moreIds(l) { return ((l && l.see.more) || []).filter(function (id) { return W.media && W.media[id]; }); }
    // An animation's SVG source, fetched once and inlined (scoped per instance by D.scopeSvg) so it can pause and
    // its own reduced-motion rule applies; photos and still illustrations stay <img>.
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
    function root() { return G.document.getElementById(cfg.rootId); }
    function paint(html, focusSel) {
      W.sheet = null; W.zoom = null; // painting replaces every layer
      I.paint(html, focusSel);
    }
    function tabs(active) {
      return '<div class="sp-seg ln-tabs" role="group" aria-label="' + s("mode") + '">' + ["learn", "test"].map(function (x) {
        return '<button type="button" data-act="tab" data-t="' + x + '" aria-pressed="' + (x === active) + '">' + ico(x === "learn" ? "book" : "target") + s(x) + "</button>";
      }).join("") + "</div>";
    }
    function badge(id) { var x = I.trial(id); return x === "open" ? "" : '<span class="sp-pro' + (x === "used" ? " used" : "") + '">' + ico("lock") + s(x === "trial" ? "trial1" : "trialUsed") + "</span>"; }

    /* ---------- first run: Learn or Test, and the language ---------- */
    function firstRun() {
      st.view = "hub"; st.onBack = null; st.again = firstRun;
      var first = W.ix && D.nextLesson(W.ix, st.store), fl = first && meta(first.id);
      var lthumb = fl && fl.see.img ? '<img src="' + esc(I.imgUrl(fl.see.img)) + '" alt="" loading="lazy" decoding="async">' : I.tile("book");
      paint(I.markTop("") +
        '<div class="sp-scroll sp-pad ln-first"><div class="sp-col">' +
        '<h1 class="ln-h1">' + s("welcome") + "</h1>" +
        (cfg.subtitle ? '<p class="ln-sub">' + esc(D.t(cfg.subtitle, L())) + "</p>" : "") +
        '<div class="ln-langrow"><span class="sp-small" id="lnLangL">' + s("language") + '</span><div class="sp-seg" role="group" aria-labelledby="lnLangL">' +
        '<button type="button" data-act="setlang" data-l="en" lang="en" aria-pressed="' + (L() === "en") + '">English</button>' +
        '<button type="button" data-act="setlang" data-l="hi" lang="hi" aria-pressed="' + (L() === "hi") + '">हिन्दी</button></div></div>' +
        '<p class="ln-lede">' + s("choose") + "</p>" +
        '<ul class="ln-choices">' +
        '<li><button type="button" class="ln-choice" data-act="pick" data-t="learn"><span class="sp-lead" aria-hidden="true">' + lthumb + '</span><span class="ln-choice-b"><b>' + s("learn") + "</b><span>" + s("learnLine") + '</span></span><span class="sp-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>" +
        '<li><button type="button" class="ln-choice" data-act="pick" data-t="test"><span class="sp-lead" aria-hidden="true">' + I.tile("target") + '</span><span class="ln-choice-b"><b>' + s("test") + "</b><span>" + s("testLine") + '</span></span><span class="sp-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>" +
        "</ul>" +
        '<p class="sp-small ln-later">' + s("switchLater") + "</p></div></div>", ".ln-choice");
    }

    /* ---------- Learn home ---------- */
    function home(focusSel) {
      st.view = "hub"; st.onBack = null; st.again = home;
      var body;
      if (W.loading && !W.ix) {
        body = '<p class="sp-mut" role="status">' + s("loading") + "</p>";
        W.loading.then(function () { if (st.view === "hub" && st.prefs.tab === "learn" && I.root().classList.contains("on")) home(); });
      } else if (!W.ix) body = '<section class="sp-today"><p class="sp-today-line">' + s("ixErr") + '</p><button type="button" class="sp-btn pri" data-act="lnretryix">' + ico("refresh") + " " + s("retry") + "</button></section>";
      else if (!allIds().length) body = '<section class="sp-today ln-empty"><p class="sp-today-line">' + s("none") + '</p><button type="button" class="sp-btn sec sp-wide" data-act="tab" data-t="test">' + ico("target") + " " + s("goTest") + "</button></section>";
      else body = startCard() + reviseRow() + unitsHtml();
      paint(I.markTop(s("homeSub")) +
        '<div class="sp-scroll sp-pad ln-home"><div class="sp-col">' + tabs("learn") + body + (host._exploreUI ? host._exploreUI.homeHtml() : "") + referenceHtml() +
        "</div></div>", focusSel);
      wireUnits();
    }

    function startCard() {
      var nx = D.nextLesson(W.ix, st.store), anyDone = doneCount(allIds()) > 0;
      if (!nx) {
        return '<section class="ln-start"><div class="ln-start-b"><h2 class="ln-start-t ln-alldone">' + ico("check") + s("allDoneH") + "</h2>" +
          '<p class="ln-start-idea">' + s("allDone") + "</p>" +
          '<button type="button" class="sp-btn pri sp-wide" data-act="tab" data-t="test">' + ico("target") + " " + s("goTest") + "</button></div></section>";
      }
      var l = meta(nx.id), res = nx.level === "resident";
      var head = res ? '<p class="ln-start-idea">' + s("mbbsDone") + " " + s("residentNudge") + "</p>" : "";
      var see = l.see, u = unitOf(nx.id);
      return '<section class="ln-start" aria-label="' + (anyDone ? s("upNext") : s("startHere")) + '">' +
        '<div class="ln-start-img' + (see.img ? "" : " diagram") + '" aria-hidden="true"><img src="' + esc(imgSrc(see)) + '" alt="" decoding="async"></div>' +
        '<div class="ln-start-b">' + head +
        '<h2 class="ln-start-t" id="lnStartH">' + tx(l.title) + "</h2>" +
        '<p class="ln-start-idea">' + esc(plain(l.idea)) + "</p>" +
        '<p class="sp-small">' + s("min", { n: l.minutes }) + (u ? " · " + tx(u.title) : "") + (res ? " " + badge("learn.resident") : "") + "</p>" +
        '<button type="button" class="sp-btn pri sp-wide" data-act="lesson" data-l="' + esc(nx.id) + '">' + ico("play") + " " + (anyDone ? s("cont") : s("startHere")) + "</button></div></section>";
    }

    function reviseRow() {
      var n = D.learnDue(st.store, I.today()).filter(meta).length;
      if (!n) return "";
      return '<ul class="sp-rows ln-revise">' + I.row("lnrevise", "", I.tile("refresh"), s("revise"), s("reviseDue", { n: fmt(n) }), "") + "</ul>";
    }

    // The unit holding the learner's next lesson opens by default; the learner's own opens/closes persist in prefs.units.
    function defaultUnitId() { var nx = D.nextLesson(W.ix, st.store), u = nx && unitOf(nx.id); return u ? u.id : null; }
    function unitOpen(u, defId) {
      var pu = st.prefs.units;
      if (pu && Object.prototype.hasOwnProperty.call(pu, u.id)) return !!pu[u.id];
      return u.id === defId;
    }
    function setUnitOpen(id, open) {
      if (!st.prefs.units) st.prefs.units = {};
      st.prefs.units[id] = !!open;
      I.savePrefs();
    }
    // <details>/<summary>: native disclosure semantics and keyboard support.
    function wireUnits() {
      Array.prototype.forEach.call(G.document.querySelectorAll("#" + cfg.rootId + " .ln-unit[data-u]"), function (d) {
        d.addEventListener("toggle", function () { setUnitOpen(d.getAttribute("data-u"), d.open); });
      });
    }
    function unitsHtml() {
      var out = "", defId = defaultUnitId();
      ["mbbs", "resident"].forEach(function (lv) {
        var us = W.ix.units.filter(function (u) { return u.level === lv; });
        if (!us.length) return;
        out += '<h2 class="sp-h2">' + s(lv) + "</h2>";
        us.forEach(function (u) {
          var hmeta = s(lv) + " · " + s("ofDone", { d: fmt(doneCount(u.lessons)), n: fmt(u.lessons.length) }) + (lv === "resident" ? " " + badge("learn.resident") : "");
          out += '<details class="ln-unit" data-u="' + esc(u.id) + '"' + (unitOpen(u, defId) ? " open" : "") + ">" +
            '<summary class="ln-unit-sum"><span class="ln-unit-b"><h3>' + tx(u.title) + '</h3><span class="sp-small">' + hmeta + "</span></span>" +
            '<span class="sp-chev" aria-hidden="true">' + ico("chev") + '</span></summary><ol class="ln-lessons">' +
            u.lessons.map(function (id, i) {
              var l = meta(id), dn = D.lessonDone(st.store, id);
              var line = s("min", { n: l.minutes }) + (dn ? " · " + s("done") : "");
              return '<li><button type="button" class="ln-row" data-act="lesson" data-l="' + esc(id) + '" data-done="' + dn + '">' +
                '<span class="ln-num" aria-hidden="true">' + (dn ? ico("check") || "✓" : i + 1) + "</span>" +
                '<span class="ln-row-b"><b>' + tx(l.title) + '</b><span class="sp-small">' + line + (lv === "resident" ? " " + badge("learn.resident") : "") + "</span></span>" +
                '<span class="sp-chev" aria-hidden="true">' + ico("chev") + '</span><span class="sp-sr">' + (dn ? s("done") : s("toDo")) + "</span></button></li>";
            }).join("") + "</ol></details>";
        });
      });
      return out;
    }

    // Reference: notes (_reads) and calculators (_tools) live here, with the glossary.
    function referenceHtml() {
      var rows = host._reads.filter(function (r) { return !r.ready || r.ready(); }).map(function (r) { return I.row("read", ' data-r="' + esc(r.id) + '"', I.tile(r.icon || "book"), tx(r.title), tx(r.sub), r.line()); }).join("");
      var tl = host._tools;
      if (tl.length) rows += I.row("tools", "", I.tile("calc"), s("calc"), tl.map(function (x) { return tx(x.title); }).join(", "), s("nTools", { n: fmt(tl.length) }));
      var n = W.gloss ? Object.keys(W.gloss).length : 0;
      if (n) rows += I.row("lnglossary", "", I.tile("list"), s("glossary"), s("glossSub"), s("nTerms", { n: fmt(n) }));
      return rows ? '<h2 class="sp-h2">' + s("reference") + '</h2><ul class="sp-rows">' + rows + "</ul>" : "";
    }

    /* ---------- lesson player: one step per screen ---------- */
    function stepKeys(l) {
      var a = ["idea", "see", "why", "spot", "todo", "remember"];
      l.check.forEach(function (q, i) { a.push("check" + i); });
      a.push("done");
      return a;
    }
    function isResident(id) { var u = unitOf(id), l = W.lessons[id]; return u ? u.level === "resident" : !!(l && l.level === "resident"); }
    function openLesson(id) {
      var l = W.lessons[id], res = isResident(id);
      if (res && I.trial("learn.resident") === "used") return I.gate("learn.resident", function () {}); // the paywall; nothing to fetch
      if (!l) return fetchOpen(id);
      var go = function () { I.leave(); st.session = null; W.les = l; W.picks = {}; W.hot = {}; W.act = null; prefetchSvgs(l); renderStep(0, true); };
      if (res) return I.gate("learn.resident", go);
      go();
    }
    // The lesson file is fetched on open: the loading line, then the lesson, or "did not load" with Try again.
    function fetchOpen(id) {
      I.leave();
      st.view = "lesson-load"; st.onBack = null; st.again = function () { fetchOpen(id); };
      var top = function () { var m = meta(id); return I.top(st.prefs.tab === "test" ? rawS("backTest") : rawS("backLearn"), m ? tx(m.title) : s("learn"), "", I.langBtn()); };
      paint(top() + '<div class="sp-scroll sp-pad"><div class="sp-col"><p role="status" class="sp-mut">' + s("loadingLesson") + "</p></div></div>");
      delete W.bad[id];
      fetchLesson(id).then(function () {
        if (st.view !== "lesson-load") return;
        if (W.lessons[id]) return openLesson(id);
        paint(top() + '<div class="sp-scroll sp-pad"><div class="sp-col"><p role="alert">' + s("lessonErr") + " " + s("lessonErrHint") + "</p>" +
          '<button type="button" class="sp-btn pri" data-act="lesson" data-l="' + esc(id) + '">' + ico("refresh") + " " + s("retry") + "</button></div></div>", ".sp-btn");
      });
    }

    function sheetBack() {
      if (W.sheet) { closeSheet(); return true; }
      if (W.zoom) { closeZoom(); return true; }
      return false;
    }

    function renderStep(i, noAnim, focusSel) {
      var l = W.les, keys = stepKeys(l), key = keys[i], n = keys.length;
      W.step = i; st.view = "lesson";
      st.again = function (f) { renderStep(W.step, true, f); };
      st.onBack = function () { if (sheetBack()) return true; if (W.step > 0) { renderStep(W.step - 1); return true; } return false; };
      st.onLeave = function () { W.les = null; };
      var body = "", foot = true, answered = true;
      if (key === "idea") {
        body = '<div class="ln-banner' + (l.see.img ? "" : " diagram") + '" aria-hidden="true"><img src="' + esc(imgSrc(l.see)) + '" alt="" decoding="async"></div>' +
          '<h1 class="ln-title">' + tx(l.title) + "</h1>" +
          '<p class="ln-meta">' + s("min", { n: l.minutes }) + " · " + s(l.level) + (D.reviewStatus(l.review) === "ai_drafted" && cfg.draft ? " · " + s("draftMark") : "") + "</p>" +
          '<p class="ln-idea">' + rich(l.idea) + "</p>";
      } else if (key === "see") body = seeHtml(l);
      else if (key === "why") {
        body = '<h2 class="ln-h">' + s("why") + '</h2><ol class="ln-steps">' + l.why.steps.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ol>" +
          (l.why.analogy ? '<div class="ln-analogy"><b>' + s("analogy") + "</b><p>" + rich(l.why.analogy) + "</p></div>" : "");
      } else if (key === "spot" || key === "todo") {
        body = '<h2 class="ln-h">' + s(key) + '</h2><ul class="ln-list">' + l[key].map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul>";
      } else if (key === "remember") {
        body = '<h2 class="ln-h">' + s("remember") + '</h2><p class="ln-remember">' + rich(l.remember) + "</p>";
      } else if (key.indexOf("check") === 0) {
        var qi = +key.slice(5), q = l.check[qi], pick = W.picks[qi];
        answered = pick != null;
        body = '<h2 class="ln-h">' + s("check") + "</h2>" + (l.check.length > 1 ? '<p class="sp-small ln-qof">' + s("qOf", { i: qi + 1, n: l.check.length }) + "</p>" : "") +
          '<p class="ln-q" id="lnQ">' + rich(q.q) + "</p>" +
          '<div class="sp-answers' + (answered ? " done" : "") + '" role="group" aria-labelledby="lnQ">' + q.o.map(function (o, j) {
            var stt = !answered ? "" : j === q.a ? "right" : j === pick ? "wrong" : "dim";
            var mk = stt === "right" ? ico("check") || "✓" : stt === "wrong" ? ico("close") || "x" : j + 1;
            return '<button type="button" class="sp-ans" data-act="lnans" data-k="' + j + '"' + (stt ? ' data-state="' + stt + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + mk + "</span>" + tx(o) + "</button>";
          }).join("") + "</div>" +
          '<div id="lnFb" aria-live="polite">' + (answered ? feedback(q, pick) : '<p class="sp-small ln-hint">' + s("answerFirst") + "</p>") + "</div>";
      } else {
        body = doneHtml(l); foot = false;
      }
      var pct = Math.round((i + 1) * 100 / n);
      // back: the previous step, or from the first step the tab the lesson was opened from
      paint(I.top(i > 0 ? rawS("prevStep") : st.prefs.tab === "test" ? rawS("backTest") : rawS("backLearn"), tx(l.title), s("stepOf", { i: i + 1, n: n }),
          '<button type="button" class="sp-icon" data-act="lnexit" aria-label="' + s("closeLesson") + '">' + (ico("close") || "×") + "</button>" + I.langBtn()) +
        '<div class="ln-prog" role="progressbar" aria-label="' + s("stepOf", { i: i + 1, n: n }) + '" aria-valuemin="1" aria-valuemax="' + n + '" aria-valuenow="' + (i + 1) + '"><i style="width:' + pct + '%"></i></div>' +
        '<div class="sp-scroll sp-pad" id="lnScroll"><article class="ln-art" id="lnArt" data-step="' + key + '">' + body + "</article></div>" +
        (foot ? '<div class="sp-foot ln-foot">' + (i > 0 ? '<button type="button" class="sp-btn sec" data-act="lnprev">' + s("prev") + "</button>" : "<span></span>") +
          '<button type="button" class="sp-btn pri" data-act="lnnext" id="lnNext"' + (answered ? "" : " disabled") + ">" + s("next") + "</button></div>" : ""),
        focusSel || (key.indexOf("check") === 0 && !answered ? ".sp-ans" : foot ? "#lnNext" : ".ln-done-act .sp-btn"));
      // Each step rises in once (6 px, 200 ms); keyboard steps and reduced motion skip the rise.
      var art = G.document.getElementById("lnArt");
      if (!noAnim && art) { art.classList.add("sp-reveal", "pre"); G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { art.classList.remove("pre"); }); }); }
      if (key === "see") { wireSee(l); fillSvgs(); }
      var ban = G.document.querySelector("#" + cfg.rootId + " .ln-banner img");
      if (ban) ban.addEventListener("error", function () { ban.parentNode.hidden = true; });
    }

    function feedback(q, pick) {
      var ok = pick === q.a;
      return '<div class="ln-fb"><p class="sp-verdict ' + (ok ? "ok" : "bad") + '">' + (ico(ok ? "check" : "close") || (ok ? "✓" : "x")) + "<span>" +
        (ok ? s("right") : s("wrong", { x: plain(q.o[q.a]) })) + '</span></p><p class="ln-why">' + rich(q.why) + "</p></div>";
    }

    function answer(key, viaKey) {
      var l = W.les, sk = l && stepKeys(l)[W.step];
      if (!l || sk.indexOf("check") !== 0) return;
      var qi = +sk.slice(5), q = l.check[qi];
      if (W.picks[qi] != null || !q.o[key]) return;
      W.picks[qi] = key;
      I.haptic(key === q.a ? "success" : "error");
      var all = l.check.every(function (x, j) { return W.picks[j] != null; });
      if (all && D.finishLesson(st.store, l.id, I.today())) I.save();
      var wrap = G.document.querySelector("#lnArt .sp-answers");
      wrap.classList.add("done");
      Array.prototype.forEach.call(wrap.querySelectorAll(".sp-ans"), function (b) {
        var j = +b.getAttribute("data-k"), mk = b.querySelector(".k");
        if (j === q.a) { b.setAttribute("data-state", "right"); mk.innerHTML = ico("check") || "✓"; }
        else if (j === key) { b.setAttribute("data-state", "wrong"); mk.innerHTML = ico("close") || "x"; }
        else b.setAttribute("data-state", "dim");
        b.setAttribute("aria-disabled", "true");
      });
      var fb = G.document.getElementById("lnFb");
      fb.innerHTML = feedback(q, key);
      if (!viaKey) { var blk = fb.firstChild; blk.classList.add("sp-reveal", "pre"); G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { blk.classList.remove("pre"); }); }); }
      var nx = G.document.getElementById("lnNext");
      nx.disabled = false;
      try { nx.focus({ preventScroll: true }); } catch (e) {}
      var sc = G.document.getElementById("lnScroll");
      var calm = viaKey || !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches);
      try { sc.scrollTo({ top: sc.scrollHeight, behavior: calm ? "auto" : "smooth" }); } catch (e) { sc.scrollTop = sc.scrollHeight; }
    }

    function find(list, id) { var r = null; list.forEach(function (x) { if (!r && id && x.id === id) r = x; }); return r; }
    function doneHtml(l) {
      var t = l.test || {}, spec = t.clinic && I.clinic(t.clinic), bank = bankFor(t);
      var test = spec && st.decks[t.clinic]
        ? '<button type="button" class="sp-btn pri sp-wide" data-act="lntest">' + ico("target") + " " + s("testYourself") + '</button><p class="sp-small">' + s("testClinic", { c: D.t(spec.title, L()) }) + "</p>"
        : bank ? '<button type="button" class="sp-btn pri sp-wide" data-act="lntest">' + ico("target") + " " + s("testYourself") + '</button><p class="sp-small">' + s("testBank") + "</p>" : "";
      var sm = find(host._sims, t.sim);
      var sim = sm ? '<button type="button" class="sp-btn sec sp-wide" data-act="lnsim" data-s="' + esc(sm.id) + '">' + ico("target") + " " + s("trySim") + '</button><p class="sp-small">' + s("simLine", { t: D.t(sm.title, L()) }) + "</p>" : "";
      var tl = find(host._tools, t.tool);
      var tool = tl ? '<button type="button" class="sp-btn sec sp-wide" data-act="lntool" data-s="' + esc(tl.id) + '">' + ico("calc") + " " + s("tryTool") + '</button><p class="sp-small">' + s("toolLine", { t: D.t(tl.title, L()) }) + "</p>" : "";
      var ex = t.explorer && find(host._explore, t.explorer);
      var explorer = ex ? '<button type="button" class="sp-btn sec sp-wide" data-act="lnexplore" data-s="' + esc(ex.id) + '">' + ico("compass") + " " + s("tryExplorer") + '</button><p class="sp-small">' + s("explorerLine", { t: D.t(ex.title, L()) }) + "</p>" : "";
      var note = l.deeper && noteFor(l.deeper.note);
      // Without a study note, a lesson's own deeper.text {en, hi} is shown on the finish screen.
      var deepText = !note && l.deeper && l.deeper.text ? '<section class="ln-deeper" aria-labelledby="lnDeepH"><h2 class="sp-h2" id="lnDeepH">' + s("goDeeper") + "</h2><p>" + rich(l.deeper.text) + "</p></section>" : "";
      var deeper = note ? '<button type="button" class="sp-btn sec sp-wide" data-act="lndeeper" data-n="' + esc(l.deeper.note) + '">' + ico("book") + " " + s("goDeeper") + '</button><p class="sp-small">' + s("deeperNote", { t: D.t(note.title, L()) }) + "</p>" : "";
      var nx = D.nextLesson(W.ix, st.store), nl = nx && meta(nx.id);
      var more = nl ? '<button type="button" class="sp-nextnote" data-act="lesson" data-l="' + esc(nx.id) + '"><span class="sp-small">' + s("nextLesson") +
        (nx.level === "resident" ? " " + badge("learn.resident") : "") + "</span><b>" + tx(nl.title) + '</b><span class="sp-chev" aria-hidden="true">' + ico("chev") + "</span></button>" : "";
      return '<div class="ln-done"><p class="sp-verdict ok">' + (ico("check") || "✓") + "<span>" + s("lessonDone") + "</span></p>" +
        '<h1 class="ln-title">' + tx(l.title) + '</h1><p class="ln-remember">' + rich(l.remember) + '</p><p class="sp-small">' + s("comesBack") + "</p></div>" + deepText +
        '<div class="ln-done-act">' + test + sim + tool + explorer + deeper + more +
        I.maikBtn("I am learning " + D.t(cfg.subtitle || cfg.title, "en") + ". Lesson: " + D.t(l.title, "en") + ". Key point: " + D.glossParts(D.t(l.remember, "en")).map(function (p) { return p.text != null ? p.text : p.shown || p.term; }).join("") +
          " Explain this in more depth, with a clinical example.") +
        '<button type="button" class="sp-btn sec sp-wide ln-backlearn" data-act="lnexit">' + s("backLearn") + "</button></div>";
    }
    function bankFor(t) { var b = null; if (t && t.mcqTopic) host._banks.forEach(function (x) { if (x.topic && (!x.hasTopic || x.hasTopic(t.mcqTopic))) b = x; }); return b; }
    function noteFor(id) { var n = null; host._reads.forEach(function (r) { if (!n && r.find) n = r.find(id); }); return n; }

    /* ---------- See it: the picture with tap-to-reveal hotspots ---------- */
    function seeHtml(l) {
      var see = l.see, sz = picSize(see), hs = see.hotspots;
      var style = sz ? ' style="aspect-ratio:' + sz.w + " / " + sz.h + ";width:min(100%, calc(52vh * " + (sz.w / sz.h).toFixed(4) + '))"' : "";
      var hots = hs.map(function (h, i) {
        var on = !!W.hot[i], side = h.x < 0.34 ? "l" : h.x > 0.66 ? "r" : "c";
        return '<button type="button" class="ln-hot" data-act="lnhot" data-k="' + i + '" data-side="' + side + '"' + (h.y > 0.72 ? ' data-up=""' : "") + (i === W.act ? " data-named" : "") + ' style="left:' + (h.x * 100).toFixed(2) + "%;top:" + (h.y * 100).toFixed(2) + '%"' +
          ' aria-expanded="' + on + '" aria-label="' + s("point", { n: i + 1 }) + (on ? ": " + esc(plain(h.label)) : "") + '"><span class="ln-dot" aria-hidden="true">' + (i + 1) + "</span>" +
          '<span class="ln-chip" aria-hidden="true"' + (i === W.act ? "" : " hidden") + ">" + tx(h.label) + "</span></button>";
      }).join("");
      return '<h2 class="ln-h">' + s("see") + "</h2>" +
        '<figure class="ln-fig"><div class="ln-pic' + (see.img ? "" : " diagram") + '" id="lnPic"' + style + ">" +
        '<button type="button" class="ln-pic-b" data-act="lnzoom" aria-label="' + s("enlarge", { x: plain(see.alt) }) + '"><img id="lnImg" src="' + esc(imgSrc(see)) + '" alt="' + esc(plain(see.alt)) + '"' +
        (sz ? ' width="' + sz.w + '" height="' + sz.h + '"' : "") + ' decoding="async"></button>' + hots + "</div>" +
        "<figcaption>" + tx(see.caption) + (see.credit ? ' <span class="sp-credit" lang="en">' + esc(see.credit) + "</span>" : "") + "</figcaption></figure>" +
        (hs.length ? '<p class="sp-small ln-tap" id="lnTap">' + s("tapPoints") + "</p>" : "") +
        '<ol class="ln-hotlist" id="lnHotList">' + hotList(l) + "</ol>" +
        (hs.length && hs.some(function (h, i) { return !W.hot[i]; }) ? '<button type="button" class="sp-btn sec ln-showall" data-act="lnshowall">' + s("showAll") + "</button>" : "") +
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
          '<button type="button" class="ln-play" data-act="lnplay" data-m="' + esc(id) + '" aria-label="' + s(on ? "pauseA" : "playA", { x: plain(m.alt).split(/[.:]/)[0] }) + '">' +
          s(on ? "pause" : "play") + "</button></figcaption></figure>";
      }
      pic = '<button type="button" class="ln-mpic" data-act="lnzoom" data-m="' + esc(id) + '" aria-label="' + s("enlarge", { x: plain(m.alt) }) + '"' + ar + ">" +
        '<img src="' + esc(mediaUrl(m)) + '" alt="' + alt + '" width="' + m.w + '" height="' + m.h + '" loading="lazy" decoding="async"></button>';
      return '<figure class="ln-mfig">' + pic + "<figcaption>" + tx(m.caption) + " " + creditHtml(m) + "</figcaption></figure>";
    }
    // Credit as the licence asks: author, licence (linked), source link, "adapted" when changed; originals name the owner.
    function creditHtml(m) {
      var c = D.mediaCredit(m), parts = [];
      function a(u, t) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>"; }
      if (c.by) parts.push(esc(c.by));
      parts.push(c.licenceUrl ? a(c.licenceUrl, c.licence) : esc(c.licence));
      if (c.source) parts.push(a(c.source, /commons\.wikimedia\.org/.test(c.source) ? "Wikimedia Commons" : "Source") + (c.adapted ? ", adapted" : ""));
      return '<span class="sp-credit" lang="en">' + parts.join(" · ") + "</span>";
    }
    function fillSvgs() {
      Array.prototype.forEach.call(G.document.querySelectorAll("#" + cfg.rootId + " .ln-anim[data-m]:empty"), function (el) {
        var id = el.getAttribute("data-m");
        svgSrc(id).then(function (t) { if (el.isConnected && !el.firstChild) el.innerHTML = D.scopeSvg(t, "lnm" + (++W.n)); },
          function () { if (el.isConnected) { el.classList.add("err"); el.innerHTML = '<p class="ln-imgerr">' + s("mediaErr") + "</p>"; } });
      });
    }
    function togglePlay(b) {
      var id = b.getAttribute("data-m"), m = W.media && W.media[id], el = G.document.querySelector('#' + cfg.rootId + ' .ln-anim[data-m="' + id + '"]');
      if (!m || !el) return;
      W.paused[id] = !W.paused[id];
      var on = !W.paused[id];
      el.classList.toggle("paused", !on);
      b.setAttribute("aria-label", D.t(STR[on ? "pauseA" : "playA"], L()).replace("{x}", plain(m.alt).split(/[.:]/)[0]));
      b.textContent = D.t(STR[on ? "pause" : "play"], L());
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
        var sa = G.document.querySelector("#" + cfg.rootId + " .ln-showall"); if (sa) sa.remove();
        var tp = G.document.getElementById("lnTap"); if (tp) tp.remove();
      });
      if (img.complete && img.naturalWidth) fitFrame();
    }
    function toggleHot(i, quiet) {
      var l = W.les, h = l && l.see.hotspots[i];
      if (!h) return;
      W.hot[i] = W.hot[i] ? 0 : 1;
      // One name on the picture at a time (the last point opened); the list keeps them all.
      W.act = !quiet && W.hot[i] ? i : null;
      Array.prototype.forEach.call(G.document.querySelectorAll("#" + cfg.rootId + " .ln-hot"), function (b) {
        var on = +b.getAttribute("data-k") === W.act;
        b.querySelector(".ln-chip").hidden = !on;
        b.toggleAttribute("data-named", on);
      });
      var b = G.document.querySelector('#' + cfg.rootId + ' .ln-hot[data-k="' + i + '"]');
      if (b) {
        b.setAttribute("aria-expanded", String(!!W.hot[i]));
        b.setAttribute("aria-label", D.t(STR.point, L()).replace("{n}", i + 1) + (W.hot[i] ? ": " + plain(h.label) : ""));
      }
      G.document.getElementById("lnHotList").innerHTML = hotList(l);
      if (l.see.hotspots.every(function (x, j) { return W.hot[j]; })) { var sa = G.document.querySelector("#" + cfg.rootId + " .ln-showall"); if (sa) sa.remove(); }
      I.haptic("tap");
    }

    /* ---------- enlarged picture: the zoom stage over the lesson ---------- */
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
      z.className = "sp-zoom pre";
      z.setAttribute("role", "dialog");
      z.setAttribute("aria-modal", "true");
      z.setAttribute("aria-label", D.t(STR.enlarged, L()));
      z.innerHTML = I.top(rawS("closeImg"), s("enlarged"), s("zoomHint"),
          '<button type="button" class="sp-icon" data-act="lnzin" aria-label="' + s("zoomIn") + '">' + (ico("plus") || "+") + "</button>" +
          '<button type="button" class="sp-icon" data-act="lnzfit" aria-label="' + s("fit") + '">' + (ico("target") || "=") + "</button>") +
        '<div class="sp-stage' + (see.img ? "" : " ln-zdiag") + '" id="lnZStage"><img id="lnZImg" src="' + esc(see.src || imgSrc(see)) + '" alt="' + esc(plain(see.alt)) + '" width="' + sz.w + '" height="' + sz.h + '" decoding="async"></div>' +
        '<p class="sp-zcap">' + tx(see.caption) + "</p>";
      Array.prototype.forEach.call(r.children, function (c) { c.inert = true; });
      r.appendChild(z);
      W.zoom = z; W.zoomFrom = b && b.nodeType === 1 ? b : null;
      z._z = S.attach(G.document.getElementById("lnZStage"), G.document.getElementById("lnZImg"));
      G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { z.classList.remove("pre"); }); });
      try { z.querySelector(".sp-back").focus({ preventScroll: true }); } catch (e) {}
    }
    function closeZoom() {
      var z = W.zoom;
      W.zoom = null;
      Array.prototype.forEach.call(z.parentNode.children, function (c) { if (c !== z) c.inert = false; });
      z.classList.add("pre", "out");
      G.setTimeout(function () { z.remove(); }, 150);
      var b = W.zoomFrom && W.zoomFrom.isConnected ? W.zoomFrom : G.document.querySelector("#" + cfg.rootId + " [data-act=lnzoom]");
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
        '<button type="button" class="sp-btn sec sp-wide" data-act="lnsheetclose">' + s("closeSheet") + "</button></div>";
      Array.prototype.forEach.call(r.children, function (c) { c.inert = true; });
      r.appendChild(el);
      W.sheet = { el: el, from: from };
      G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { el.classList.remove("pre"); }); });
      try { el.querySelector(".ln-sheet .sp-btn").focus({ preventScroll: true }); } catch (e) {}
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
      I.leave();
      st.view = "lngloss"; st.onBack = sheetBack; st.again = glossList;
      var g = W.gloss || {}, lang = L();
      var ids = Object.keys(g).sort(function (a, b) { return D.t(g[a].term, lang).localeCompare(D.t(g[b].term, lang), lang); });
      paint(I.top(rawS("backLearn"), s("glossary"), s("nTerms", { n: fmt(ids.length) }), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col"><ul class="ln-gloss">' + ids.map(function (id) {
          return '<li><button type="button" class="ln-grow" data-act="lngloss" data-g="' + esc(id) + '" aria-haspopup="dialog"><b>' + tx(g[id].term) + "</b><span>" + tx(g[id].def) + "</span></button></li>";
        }).join("") + "</ul></div></div>", focusSel);
    }

    /* ---------- Revise: each finished lesson's remember line as a recall card (deck key "learn") ---------- */
    function revise() {
      I.leave();
      var ids = D.learnDue(st.store, I.today()).filter(meta);
      W.rev = { ids: ids, i: 0, shown: false };
      renderRevise();
    }
    function renderRevise(focusSel) {
      var r = W.rev;
      st.view = "lnrevise"; st.onBack = sheetBack; st.again = renderRevise;
      if (r.i >= r.ids.length) {
        return paint(I.top(rawS("backLearn"), s("revise"), "", I.langBtn()) +
          '<div class="sp-scroll sp-pad"><div class="sp-col ln-art"><p class="sp-verdict ok">' + (ico("check") || "✓") + "<span>" + (r.ids.length ? s("reviseDone") : s("reviseEmpty")) + "</span></p>" +
          '<button type="button" class="sp-btn pri sp-wide" data-act="back">' + s("backLearn") + "</button></div></div>", focusSel || ".sp-btn.pri");
      }
      var id = r.ids[r.i], l = W.lessons[id], ans = "";
      if (!l && !W.bad[id]) fetchLesson(id).then(function () { if (st.view === "lnrevise" && W.rev === r && r.ids[r.i] === id && r.shown) renderRevise(); });
      if (r.shown) {
        ans = l ? '<p class="ln-remember">' + rich(l.remember) + "</p>"
          : W.bad[id] ? '<p role="alert">' + s("lessonErr") + " " + s("lessonErrHint") + '</p><button type="button" class="sp-btn sec" data-act="lnshow">' + ico("refresh") + " " + s("retry") + "</button>"
          : '<p role="status" class="sp-mut">' + s("loadingLesson") + "</p>";
      }
      paint(I.top(rawS("backLearn"), s("revise"), s("xOfY", { i: r.i + 1, n: r.ids.length }), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><article class="ln-art"><p class="sp-small">' + s("recall") + '</p><h1 class="ln-title">' + tx(meta(id).title) + "</h1>" +
        ans + "</article></div>" +
        '<div class="sp-foot ln-rfoot">' + (r.shown
          ? '<div class="ln-rate"><button type="button" class="sp-btn sec" data-act="lnrate" data-g="1">' + s("again") + '</button><button type="button" class="sp-btn pri" data-act="lnrate" data-g="3">' + s("gotIt") + "</button></div>"
          : '<button type="button" class="sp-btn pri sp-wide" data-act="lnshow">' + s("showAnswer") + "</button>") + "</div>",
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
    // Today's plan: the next MBBS lesson, or Revise when every lesson is done.
    function planItem() {
      if (!W.ix) return null;
      var d = I.today(), done = null, id;
      for (id in st.store.learn) if (st.store.learn[id].day === d && meta(id)) done = id;
      var nx = D.nextLesson(W.ix, st.store), nl = nx && nx.level === "mbbs" && meta(nx.id);
      if (done) return { act: "lesson", key: nl ? nx.id : done, title: rawS("learn") === "सीखें" ? "पाठ" : "Lesson", done: true, line: I.s("lessonToday", { t: D.t(meta(done).title, L()) }) };
      if (nl) return { act: "lesson", key: nx.id, title: I.raw("planLesson"), done: false, line: esc(D.t(nl.title, L())) + " · " + s("min", { n: nl.minutes }) };
      var due = D.learnDue(st.store, d).filter(meta).length;
      return due ? { act: "lnrevise", title: I.raw("planRevise"), done: false, line: I.s("reviseN", { n: fmt(due) }) } : null;
    }
    // "Learn this" after a wrong clinic answer: the first lesson (study order) whose test covers the clinic class.
    function lessonFor(clinicId, cls) {
      var ids = W.ix ? allIds() : [];
      for (var i = 0; i < ids.length; i++) {
        var l = meta(ids[i]), t = l && l.test;
        if (t && t.clinic === clinicId && (!t.classes || t.classes.indexOf(cls) >= 0)) return { id: ids[i], title: plain(l.title) };
      }
      return null;
    }

    /* ---------- wiring ---------- */
    A.pick = function (b) { I.setPref("tab", b.getAttribute("data-t")); I.renderHub(); };
    A.tab = function (b) {
      I.leave(); st.session = null;
      I.setPref("tab", b.getAttribute("data-t"));
      I.renderHub('[data-act=tab][data-t="' + b.getAttribute("data-t") + '"]');
    };
    A.setlang = function (b) { I.setPref("lang", b.getAttribute("data-l") === "hi" ? "hi" : "en"); firstRun(); var f = G.document.querySelector('#' + cfg.rootId + ' [data-act=setlang][data-l="' + L() + '"]'); try { f.focus({ preventScroll: true }); } catch (e) {} };
    A.lnretryix = function () { load(); home(); };
    A.lesson = function (b) { openLesson(b.getAttribute("data-l") || b.getAttribute("data-k")); };
    A.lnexit = function () { I.leave(); I.renderHub(); };
    A.lnnext = function () { if (W.les && W.step < stepKeys(W.les).length - 1) renderStep(W.step + 1); };
    A.lnprev = function () { if (W.les && W.step > 0) renderStep(W.step - 1); };
    A.lnans = function (b) { answer(+b.getAttribute("data-k"), false); };
    A.lnhot = function (b) { toggleHot(+b.getAttribute("data-k")); };
    A.lnshowall = function () { var l = W.les; l.see.hotspots.forEach(function (h, i) { if (!W.hot[i]) toggleHot(i, true); }); var x = G.document.querySelector("#" + cfg.rootId + " .ln-pic-b"); try { x.focus({ preventScroll: true }); } catch (e) {} };
    A.lnzoom = zoom;
    A.lnplay = togglePlay;
    A.lnzin = function () { if (W.zoom) W.zoom._z.zoomBy(1.5); };
    A.lnzfit = function () { if (W.zoom) W.zoom._z.reset(); };
    A.lngloss = function (b) { openSheet(b.getAttribute("data-g"), b); };
    A.lnsheetclose = closeSheet;
    A.lnglossary = function () { glossList(); };
    A.lnrevise = function () { revise(); };
    A.lnshow = function () { var r = W.rev; if (r) { if (r.ids[r.i]) delete W.bad[r.ids[r.i]]; r.shown = true; renderRevise(); } };
    A.lnrate = function (b) { rate(+b.getAttribute("data-g")); };
    // Back from Test yourself / a drill / a calculator / Go deeper returns to the lesson step it left (st.ret).
    function lessonRet() {
      var l = W.les, i = W.step, p = W.picks;
      return function () { W.les = l; W.picks = p; W.hot = {}; W.act = null; renderStep(i, true); };
    }
    function afterJump(ret) { if (st.view === "lesson") ret(); else if (st.view !== "hub") I.setRet(ret, rawS("backLesson")); }
    A.lntest = function () {
      var l = W.les, t = l && l.test, ret = lessonRet(), b = bankFor(t);
      if (!t) return;
      I.leave();
      if (t.clinic && I.clinic(t.clinic) && st.decks[t.clinic]) I.startClinic(t.clinic, { classes: t.classes });
      else if (b) b.topic(t.mcqTopic);
      afterJump(ret); // the paywall leaves the lesson on screen: repaint it
    };
    A.lnsim = function (b) { var ret = lessonRet(), x = find(host._sims, b.getAttribute("data-s")); I.leave(); if (x) x.open(); afterJump(ret); };
    A.lntool = function (b) { var ret = lessonRet(), x = find(host._tools, b.getAttribute("data-s")); I.leave(); if (x) x.open(); afterJump(ret); };
    A.lnexplore = function (b) { var ret = lessonRet(), id = b.getAttribute("data-s"); if (!host._exploreUI) return; I.leave(); host._exploreUI.open(id); afterJump(ret); };
    A.lndeeper = function (b) { var ret = lessonRet(); if (A.note) A.note(b); afterJump(ret); };

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
    K.lngloss = function (e) { termKey(e); };

    host._learn = { load: load, home: home, firstRun: firstRun, tabs: tabs, planItem: planItem, lessonFor: lessonFor, meta: meta, _w: W };
    return host._learn;
  };
})(typeof window !== "undefined" ? window : this);
