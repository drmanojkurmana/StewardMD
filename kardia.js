/* Kardia: the Echo and ECG learning module, a StewardMD specialty host on the specialty engine
   (specialty-*.js). Tabs: Echo Lab, Learn, Practice, Cases, KardiQ X. Echo Lab, Practice and Cases are
   coming soon (WP8: honest placeholder panels, no fake content). Learn opens the existing Learn ECG
   lesson atlas in place, unchanged (KARDIOX.openLearn). KardiQ X opens the existing AI reading screen,
   still behind SMD_XACCESS.gate("kardiox"), untouched.
   Loaded on first open by kardia-loader.js, which is the only Kardia file the app loads at boot.
   Flag: smd_kardia, DEFAULT OFF for everyone; a tester turns it on per device with ?kardia=1 or
   localStorage smd_kardia = "1" (same tester mechanism as the other module flags, no early-access tier).
   Levels (engine pattern): MBBS free; Resident, Fellow and Sonographer are StewardMD Pro. The free
   preview is the first KARDIA_FREE_LESSONS Learn ECG lessons; everything else is Pro.
   Content is ai_drafted: every screen carries the "To be verified, draft" footer until clinical review. */
(function (G) {
  "use strict";
  var SP = G.SPECIALTY;
  if (!SP || !SP.createHost) return;

  /* Free preview: the first few Learn ECG lessons. Owner decision 2026-10-25 (about 5 to 10 percent):
     a few Echo Lab views and lessons, and a few Learn ECG lessons. Everything else is Pro. */
  var FREE_LESSONS = 5;
  var FREE_ECHO_PER_AREA = 3;
  var FREE_BANK_QUESTIONS = 20;
  var TABS = ["echo", "learn", "practice", "cases", "kardiox"];
  var LEVELS = ["mbbs", "resident", "fellow", "sonographer"];

  function T(en, hi) { return { en: en, hi: hi }; }
  var TAB_T = {
    echo: T("Echo Lab", "इको लैब"), learn: T("Learn", "सीखें"), practice: T("Practice", "अभ्यास"),
    cases: T("Cases", "केस"), kardiox: T("KardiQ X", "KardiQ X")
  };
  var TAB_SUB = {
    echo: T("Probe lab and views", "प्रोब लैब और व्यू"),
    learn: T("Learn ECG: the ECG atlas and quiz", "Learn ECG: ECG एटलस और प्रश्नोत्तरी"),
    practice: T("Drills and protocols", "ड्रिल और प्रोटोकॉल"),
    cases: T("Whole patient cases", "पूरे मरीज़ के केस"),
    kardiox: T("AI ECG reading", "AI ECG रीडिंग")
  };

  var host = SP.createHost({
    id: "kardia", global: "KARDIA", base: G.SMD_KARDIA_BASE || "/kardia/", rootId: "smdKardia", rootClass: "krd-root",
    storeKey: "smd_kardia_v1", prefKey: "smd_kardia_prefs", flag: "smd_kardia",
    title: T("Kardia", "कार्डिया"), subtitle: T("Echo and ECG learning", "इको और ECG सीखना"),
    levels: { free: ["mbbs"] }, proFeature: "kardia",
    statusBg: "#06090b", draft: true
  });
  if (SP.features && SP.features.learn) SP.features.learn(host);
  if (SP.features && SP.features.bank) SP.features.bank(host, { id: "mcq", index: "decks/mcq/index.json" });
  var I = host._internal, st = host._st;

  /* The engine's enabled() is a kill switch (absent flag reads ON). Kardia is opt-in: absent flag
     reads OFF, the same tester mechanism (?kardia=1, localStorage "1") as the other module flags. */
  function on() {
    try { if (G.SMD_KARDIA_FLAGS && G.SMD_KARDIA_FLAGS.bool) return !!G.SMD_KARDIA_FLAGS.bool("smd_kardia"); } catch (e) {}
    try {
      var q = (G.location.search.match(/[?&]kardia=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return G.localStorage.getItem("smd_kardia") === "1";
    } catch (e) { return false; }
  }

  function tab() { var t = st.prefs && st.prefs.ktab; return TABS.indexOf(t) >= 0 ? t : "echo"; }
  function klevel() { var l = st.prefs && st.prefs.klevel; return LEVELS.indexOf(l) >= 0 ? l : "mbbs"; }
  function levelLockedK(lv) { return lv !== "mbbs" && !I.isPro(); }

  function tabsHtml(cur) {
    return '<div class="krd-tabs" role="tablist" aria-label="' + I.esc(I.t(host.cfg.title)) + '">' + TABS.map(function (id) {
      return '<button type="button" role="tab" class="krd-tab" data-act="ktab" data-t="' + id + '"' +
        ' aria-selected="' + (id === cur) + '">' + I.tx(TAB_T[id]) + "</button>";
    }).join("") + "</div>";
  }

  function levelsHtml(lv) {
    var seg = LEVELS.map(function (l) {
      var locked = levelLockedK(l);
      var label = l === "mbbs" ? "MBBS" : l === "resident" ? I.s("resident") : l === "fellow" ? "Fellow" : "Sonographer";
      return '<button type="button" data-act="klevel" data-v="' + l + '" aria-pressed="' + (lv === l) + '">' + I.esc(label) +
        (locked ? ' <span class="sp-pro">' + I.ico("lock") + I.s("pro") + "</span>" : "") + "</button>";
    }).join("");
    var note = lv === "mbbs" ? I.s("mbbsSub") : I.s("residentSub");
    return '<div class="sp-levelrow"><div class="sp-seg" role="group" aria-label="' + I.s("level") + '">' + seg + "</div>" +
      '<span class="sp-small">' + note + "</span></div>";
  }

  /* Coming soon: an honest panel. What the trainer will hold, in plain words; no fake lessons,
     no demo buttons, nothing that looks finished before it is. */
  var SOON = {
    echo: {
      icon: "pulse",
      lines: T("The probe lab opens here: a beating 3D heart with a live ultrasound sector, the ECG strip and the heart sounds running off the same cycle. Target views with a quality score, from parasternal to apical, then knobology, Doppler and measurements with a known right answer.",
        "यहाँ प्रोब लैब खुलेगी: धड़कता 3D दिल, लाइव अल्ट्रासाउंड सेक्टर, ECG स्ट्रिप और हृदय ध्वनियाँ एक ही चक्र पर। पैरास्टर्नल से एपिकल तक लक्ष्य व्यू, फिर नॉबोलॉजी, डॉप्लर और ज्ञात सही उत्तर वाली माप।")
    },
    practice: {
      icon: "target",
      lines: T("Graded drills open here: view acquisition against the clock, measurement and Doppler drills, knobology drills, POCUS protocols, and ECG spot diagnosis.",
        "यहाँ ग्रेडेड ड्रिल खुलेंगी: समय पर व्यू पकड़ना, माप और डॉप्लर ड्रिल, नॉबोलॉजी ड्रिल, POCUS प्रोटोकॉल और ECG स्पॉट निदान।")
    },
    cases: {
      icon: "folder",
      lines: T("Whole patient cases open here: history, examination with heart sounds, ECG, echo acquisition and measurement, a structured report, then diagnosis and management.",
        "यहाँ पूरे मरीज़ के केस खुलेंगे: हिस्ट्री, हृदय ध्वनियों के साथ जाँच, ECG, इको, संरचित रिपोर्ट, फिर निदान और उपचार।")
    }
  };

  function soonHtml(id) {
    var s = SOON[id];
    return '<div class="sp-scroll sp-pad"><div class="sp-col"><div class="krd-soon">' +
      '<div class="krd-soon-hero"><span class="krd-soon-lead" aria-hidden="true">' + I.tile(s.icon) + "</span>" +
      "<div><h2>" + I.tx(TAB_T[id]) + '</h2><p class="krd-soon-sub">' + I.tx(TAB_SUB[id]) + "</p></div></div>" +
      '<p class="krd-note">' + I.ico("info") + "<span><b>" +
      I.tx(T("Coming soon.", "जल्द आ रहा है।")) + "</b> " + I.tx(s.lines) + "</span></p>" +
      '<p class="krd-note">' + I.ico("lock") + "<span>" +
      I.tx(T("This trainer is part of StewardMD Pro.", "यह ट्रेनर StewardMD Pro का हिस्सा है।")) + "</span></p>" +
      "</div></div></div>";
  }

  function learnList() {
    try {
      var C = G.SMD_KARDIOX_CONTENT;
      if (C && C.ecgs && C.ecgs.length) return C.ecgs;
    } catch (e) {}
    return null;
  }

  function lessonRows(list, n) {
    return list.slice(0, n).map(function (e) {
      return I.row("klearn", ' data-id="' + I.esc(e.id) + '"', I.tile("book"), I.esc(e.title),
        e.category ? I.esc(e.category) : "", "");
    }).join("");
  }

  function echoHtml() {
    var W = host._learn && host._learn._w, ix = W && W.ix, lv = klevel(), pro = I.isPro();
    var head = '<h2 class="sp-h2">' + I.tx(T("Echo", "Echo")) + '</h2><p class="sp-small">' +
      I.tx(T("Echo lessons for the level above. The first three lessons in each area are free at MBBS; the rest are part of StewardMD Pro.", "Echo lessons for the level above. The first three lessons in each area are free at MBBS; the rest are part of StewardMD Pro.")) + "</p>";
    if (!ix) {
      if (W && W.err) return head + '<div class="sp-err krd-err" role="alert"><p>' +
        I.tx(T("Echo lessons did not load. Check the connection and try again.", "Echo lessons did not load. Check the connection and try again.")) +
        '</p><button type="button" class="sp-btn pri" data-act="kretry">' + I.ico("refresh") + " " + I.s("retry") + "</button></div>";
      return head + '<p class="sp-mut" role="status">' + I.tx(T("Loading echo lessons.", "Loading echo lessons.")) + "</p>";
    }
    if (!ix.units || !ix.units.length) return head + '<p class="sp-small">' + I.tx(T("No echo lessons yet.", "No echo lessons yet.")) + "</p>";
    var out = head;
    ix.units.forEach(function (u) {
      var ids = (u.lessons || []).filter(function (id) {
        var m = ix.lessons[id];
        return m && m.levels && m.levels.indexOf(lv) >= 0;
      });
      out += '<h3 class="sp-h3">' + I.tx(u.title) + "</h3>";
      if (!ids.length) {
        out += '<p class="sp-small">' + I.tx(T("No lessons at this level in this area.", "No lessons at this level in this area.")) + "</p>";
        return;
      }
      out += '<ul class="sp-rows">' + ids.map(function (id, i) {
        var m = ix.lessons[id], free = pro || (lv === "mbbs" && i < FREE_ECHO_PER_AREA);
        var title = I.esc(I.t(m.title)), line = (m.minutes ? m.minutes + " min" : "") + (free ? "" : " · Pro");
        if (!free) return I.row("kpro", "", I.tile("lock"), title, line, "");
        return I.row("lesson", ' data-l="' + I.esc(id) + '"', I.tile("book"), title, line, "");
      }).join("") + "</ul>";
    });
    return out;
  }

  function practiceHtml() {
    var bank = host._banks && host._banks[0], pro = I.isPro();
    var line = bank ? bank.line() : "";
    var rows = bank ? '<ul class="sp-rows">' + I.row("kbank", ' data-b="' + I.esc(bank.id) + '"', I.tile("list"),
      I.tx(T("Question bank", "Question bank")), I.tx(T("Explained echo questions and the timed exam", "Explained echo questions and the timed exam")), line) + "</ul>" : "";
    var note = pro ? "" : '<div class="krd-note">' + I.ico("lock") + "<span>" +
      I.tx(T("Free preview: the first " + FREE_BANK_QUESTIONS + " bank questions in a study set. The full bank and the timed exam beyond the free try are part of StewardMD Pro.", "Free preview: the first " + FREE_BANK_QUESTIONS + " bank questions in a study set. The full bank and the timed exam beyond the free try are part of StewardMD Pro.")) + "</span></div>";
    var body = bank ? rows + note : '<p class="sp-mut" role="status">' + I.tx(T("Loading questions.", "Loading questions.")) + "</p>";
    return '<div class="sp-scroll sp-pad"><div class="sp-col"><h2 class="sp-h2">' + I.tx(T("Practice", "Practice")) + "</h2>" + body + "</div></div>";
  }

  function ecgHtml() {
    var list = learnList(), pro = I.isPro();
    var head = '<p class="sp-small">' + I.tx(T("The Learn ECG atlas and quiz, with no AI. Your progress stays in Learn ECG. Atlas pictures need a connection the first time.",
      "बिना AI वाला Learn ECG एटलस और प्रश्नोत्तरी। आपकी प्रगति Learn ECG में रहती है। एटलस की तस्वीरों को पहली बार कनेक्शन चाहिए।")) + "</p>";
    if (!list || !list.length) {
      return '<h2 class="sp-h2">' + I.tx(T("Learn ECG", "Learn ECG")) + "</h2>" + head +
        '<div class="sp-err krd-err" role="alert"><p>' +
        (!list
          ? I.tx(T("Learn ECG did not load. Check the connection and try again.", "Learn ECG लोड नहीं हुआ। कनेक्शन जाँचें और फिर कोशिश करें।"))
          : I.tx(T("No lessons yet. The atlas is being prepared.", "अभी कोई पाठ नहीं है। एटलस तैयार हो रहा है।"))) +
        '</p><button type="button" class="sp-btn pri" data-act="kretry">' + I.ico("refresh") + " " + I.s("retry") + "</button></div>";
    }
    var free = lessonRows(list, FREE_LESSONS);
    var rest = list.length > FREE_LESSONS
      ? '<div class="krd-note">' + I.ico("lock") + "<span>" +
        I.tx(T("Plus " + (list.length - FREE_LESSONS) + " more lessons in the full atlas. The full atlas is part of StewardMD Pro.",
          "पूरे एटलस में " + (list.length - FREE_LESSONS) + " और पाठ। पूरा एटलस StewardMD Pro का हिस्सा है।")) +
        '</span></div><p><button type="button" class="sp-btn sec sp-wide" data-act="kpro">' + I.ico("lock") + " " + I.s("seePro") + "</button></p>"
      : "";
    var openAll = pro
      ? '<p><button type="button" class="sp-btn pri sp-wide" data-act="klearn">' + I.ico("play") + " " +
        I.tx(T("Open the Learn ECG atlas", "Learn ECG एटलस खोलें")) + "</button></p>"
      : "";
    return '<h2 class="sp-h2">' + I.tx(T("Learn ECG", "Learn ECG")) + "</h2>" + head + openAll +
      '<h3 class="sp-h3">' + I.tx(T("Free preview", "मुफ़्त झलक")) + "</h3>" +
      '<ul class="sp-rows" aria-label="' + I.tx(T("Free preview lessons", "मुफ़्त झलक पाठ")) + '">' + free + "</ul>" +
      (pro ? "" : rest);
  }

  function learnHtml() {
    return '<div class="sp-scroll sp-pad"><div class="sp-col">' + echoHtml() + ecgHtml() + "</div></div>";
  }

  function kardioxHtml() {
    return '<div class="sp-scroll sp-pad"><div class="sp-col">' +
      '<div class="krd-soon-hero"><span class="krd-soon-lead" aria-hidden="true">' + I.tile("bolt") + "</span>" +
      "<div><h2>" + I.tx(TAB_T.kardiox) + '</h2><p class="krd-soon-sub">' + I.tx(TAB_SUB.kardiox) + "</p></div></div>" +
      '<p class="sp-small">' + I.tx(T("AI reading of the ECG. It stays behind its access code until clinical sign-off, exactly as before.",
        "ECG की AI रीडिंग। क्लिनिकल अनुमति तक यह अपने एक्सेस कोड के पीछे ही रहेगी, बिल्कुल पहले जैसी।")) + "</p>" +
      '<p><button type="button" class="sp-btn pri sp-wide" data-act="kx">' +
      I.tx(T("Open KardiQ X", "KardiQ X खोलें")) + "</button></p>" +
      "</div></div>";
  }

  function showTab(id, focusSel) {
    if (TABS.indexOf(id) < 0) id = "echo";
    I.setPref("ktab", id);
    st.view = "hub"; st.again = function (f) { showTab(tab(), f || null); };
    I.leave();
    var lv = klevel();
    if (id === "cases" && G.KARDIA_CASES) {
      G.KARDIA_CASES.attach(host);
      G.KARDIA_CASES.setNavigator(function (f) { showTab("cases", typeof f === "string" ? f : null); });
      var cbody = G.KARDIA_CASES.html();
      /* A case in progress paints its own top bar and progress; the list keeps the tab chrome. */
      if (G.KARDIA_CASES._state && G.KARDIA_CASES._state.curId) { I.paint(cbody, focusSel); return; }
      I.paint(I.markTop(I.tx(host.cfg.subtitle)) + tabsHtml(id) + levelsHtml(lv) + cbody, focusSel);
      return;
    }
    var body = id === "learn" ? learnHtml() : id === "practice" ? practiceHtml() : id === "kardiox" ? kardioxHtml() : soonHtml(id);
    I.paint(I.markTop(I.tx(host.cfg.subtitle)) + tabsHtml(id) + levelsHtml(lv) + body, focusSel);
  }

  function openKardioX() {
    try { G.localStorage.setItem("smd_kardiox", "1"); } catch (e) {}
    if (G.KARDIOX && G.KARDIOX.open) G.KARDIOX.open();
    else I.toast("KardiQ X AI loading…");
  }

  I.ACTIONS.ktab = function (b) { showTab(b.getAttribute("data-t")); };
  I.ACTIONS.klevel = function (b) {
    var v = b.getAttribute("data-v");
    if (LEVELS.indexOf(v) < 0) return;
    if (v !== klevel() && levelLockedK(v)) { I.showPro(); return; }
    if (v === klevel()) return;
    I.setPref("klevel", v);
    I.setPref("level", v === "mbbs" ? "mbbs" : "resident");
    showTab(tab(), '[data-act=klevel][data-v="' + v + '"]');
  };
  I.ACTIONS.kbank = function (b) {
    var id = b.getAttribute("data-b");
    host._banks.forEach(function (x) { if (x.id === id) x.open(); });
    I.setRet(function () { showTab("practice"); }, "Back to Practice");
  };
  if (host._learn) I.ACTIONS.lnexit = function () { I.leave(); showTab("learn"); };
  I.ACTIONS.klearn = function (b) {
    var id = b.getAttribute && b.getAttribute("data-id");
    try {
      if (G.KARDIOX && G.KARDIOX.openLearn) { G.KARDIOX.openLearn(id || undefined); return; }
    } catch (e) {}
    I.toast("Learn ECG loading…");
  };
  I.ACTIONS.kx = function () {
    try {
      if (G.SMD_XACCESS && G.SMD_XACCESS.gate) { G.SMD_XACCESS.gate("kardiox", openKardioX); return; }
    } catch (e) {}
    openKardioX();
  };
  I.ACTIONS.kpro = function () { I.showPro(); };
  I.ACTIONS.kretry = function () { showTab(tab(), "[data-act=kretry]"); };

  /* Open on the engine host. The engine fetches kardia/tracks.json on first open; the tab screen does
     not need it, so paint after the load settles (first open) or at once ( later opens, config cached).
     Attached after the engine's own handlers, so the tab paint always wins, with no flash. */
  var baseOpen = host.open;
  host.open = function () {
    if (!on()) return false;
    var r = baseOpen();
    if (!r) return r;
    var L = st.loading;
    if (L && !st.cfg && !st.err) L.then(showReady, showReady);
    else showReady();
    return r;
  };
  function showReady() { if (host.isOpen()) showTab(tab()); }

  /* Review Desk style "Read it" hooks and tests read these; the atlas itself stays untouched. */
  host._kardia = { tabs: TABS.slice(), levels: LEVELS.slice(), freeLessons: FREE_LESSONS, freeEchoPerArea: FREE_ECHO_PER_AREA, freeBankQuestions: FREE_BANK_QUESTIONS, on: on, openKardioX: openKardioX };
})(typeof window !== "undefined" ? window : this);
