/* PrepReels (MediGram) feed controller. window.PREP_MEDIGRAM. ES5.
   Plan: vault/plans/PrepNucleus-MediGram.md; owner decisions section 16 (UI name PrepReels).
   Loaded lazily by prep-loader.js only when smd_prep_medigram is on; with the flag off this file is never
   fetched and PrepNucleus is unchanged. Draws through PREP._host with data-act="mg-*"; prep.js forwards
   mg-, asks back() first and calls leave() on close. Finite sessions only: visible progress, an explicit
   Finish session, no autoplay chain, no lock. FSRS moves only on a valid answer (prep-medigram-data.js). */
(function (G) {
  "use strict";
  var DATA = G.PREP_MG_DATA, MEDIA = G.PREP_MG_MEDIA;
  if (!DATA) return;

  function lsGet(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function prepOn() {
    try { var q = (G.location.search.match(/[?&]prep=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; } catch (e) {}
    return lsGet("smd_prep") !== "0";
  }
  var FLAGS = DATA.resolveFlags({ prepEnabled: prepOn(), get: lsGet, search: (G.location && G.location.search) || "" });
  if (!FLAGS.parent) return;

  /* Synthetic fixtures built from existing lesson assets (invented topics, no patient data). In production
     the same contract is filled from the screened bank and prep/lessons/v1; the serving boundary re-checks
     every record with DATA.eligible, so an unreviewed or expired item is hidden even if listed here. */
  var CANDIDATES = [
    { id: "mg-q-ecg-axis", kind: "mcq", exam: ["neet-pg", "ini-cet", "usmle", "fmge"], subject: "medicine", module: "cardiology-basics", topicIds: ["ecg-axis"], difficulty: 2, language: "en", title: "ECG axis", questionId: "q-ecg-axis-1", q: "A normal ECG axis lies between which range?", o: ["-30 to +90 degrees", "+90 to +180 degrees", "-90 to -30 degrees", "+180 to +270 degrees"], a: 0, exp: "The normal axis is -30 to +90 degrees. Left axis deviation is more negative than -30.", rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "cardiology" }, captions: { en: true }, sourceRefs: ["lesson:ecg-basics"], tags: ["ecg-axis"], updatedAt: "2026-10-01" },
    { id: "mg-q-kussmaul", kind: "mcq", exam: ["neet-pg", "ini-cet", "usmle", "fmge"], subject: "medicine", module: "cardiology-basics", topicIds: ["pericardium"], difficulty: 2, language: "en", title: "Kussmaul sign", questionId: "q-kussmaul-1", q: "Kussmaul sign (rise in JVP on inspiration) is classically seen in?", o: ["Constrictive pericarditis", "Mitral stenosis", "Aortic regurgitation", "Ventricular septal defect"], a: 0, exp: "A rigid pericardium cannot accommodate the inspiratory rise in venous return, so JVP rises.", rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "cardiology" }, captions: { en: true }, sourceRefs: ["lesson:pericardium"], tags: ["pericardium"], updatedAt: "2026-10-01" },
    { id: "mg-q-acidbase", kind: "mcq", exam: ["neet-pg", "ini-cet", "usmle", "fmge"], subject: "medicine", module: "acid-base", topicIds: ["abg"], difficulty: 3, language: "en", title: "ABG step one", questionId: "q-abg-1", q: "pH 7.20, PaCO2 60, HCO3 23. The primary disorder is?", o: ["Respiratory acidosis", "Metabolic acidosis", "Respiratory alkalosis", "Normal ABG"], a: 0, exp: "Low pH with high PaCO2 and near-normal bicarbonate is acute respiratory acidosis.", rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "critical-care" }, captions: { en: true }, sourceRefs: ["lesson:abg"], tags: ["abg"], updatedAt: "2026-10-01" },
    { id: "mg-l-ecg60", kind: "micro_lesson", exam: ["neet-pg", "ini-cet", "usmle", "fmge"], subject: "medicine", module: "cardiology-basics", topicIds: ["ecg-axis"], durationSec: 60, language: "en", title: "ECG axis in 60 seconds", summary: "Look at leads I and aVF. Both positive: normal axis. Then narrow with lead II.", lessonId: "ecg-basics", media: { provider: "first_party", assetId: "lesson-ecg-basics" }, rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "cardiology" }, captions: { en: true, hi: true }, sourceRefs: ["lesson:ecg-basics"], tags: ["ecg-axis"], updatedAt: "2026-10-01" },
    { id: "mg-v-yt-ecg", kind: "video", exam: ["neet-pg", "ini-cet", "usmle"], subject: "medicine", module: "cardiology-basics", topicIds: ["ecg-axis"], durationSec: 90, language: "en", title: "Reading the axis (explainer)", summary: "A short official-channel explainer. It plays only when YouTube is enabled in settings.", media: { provider: "youtube", videoId: "dQw4w9WgXcQ" }, rightsStatus: "youtube_embed", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "cardiology" }, captions: { en: true }, sourceRefs: ["youtube:official-channel"], tags: ["ecg-axis"], updatedAt: "2026-10-01" },
    { id: "mg-l-hi-ecg", kind: "micro_lesson", exam: ["neet-pg", "fmge"], subject: "medicine", module: "cardiology-basics", topicIds: ["ecg-axis"], durationSec: 60, language: "hi", title: "ECG axis (Hindi)", summary: "Leads I aur aVF dekhen. Dono positive: normal axis.", lessonId: "ecg-basics-hi", media: { provider: "first_party", assetId: "lesson-ecg-basics-hi" }, rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-02", reviewerRole: "cardiology-hi" }, captions: { hi: true, en: true }, sourceRefs: ["lesson:ecg-basics"], tags: ["ecg-axis"], updatedAt: "2026-10-02" },
    { id: "mg-case-1", kind: "micro_lesson", exam: ["neet-pg", "ini-cet", "usmle"], subject: "medicine", module: "cardiology-basics", topicIds: ["pericardium"], durationSec: 75, language: "en", title: "One case: rising JVP", summary: "A worked case on constriction versus restriction, told as one short story with a comparison table.", lessonId: "pericardium-case", media: { provider: "first_party", assetId: "lesson-pericardium" }, rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "cardiology" }, captions: { en: true }, sourceRefs: ["lesson:pericardium"], tags: ["pericardium", "case"], updatedAt: "2026-10-01" },
    { id: "mg-break-1", kind: "break", exam: ["neet-pg", "ini-cet", "neet-ss", "usmle", "fmge"], subject: "break", module: "break", topicIds: [], language: "en", title: "Look away and breathe", summary: "Rest your eyes on something far away. No task, no score.", rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "editorial" }, captions: { en: true }, sourceRefs: [], tags: ["break"], updatedAt: "2026-10-01" }
  ];

  var S = null; // { host, mode, feed, i, mission, answered, correct, retrievalAnswered, chosen, revealed, showWhy, brk, timer, cadence, lang, events }
  function esc(s) { return S && S.host ? S.host.esc(s) : String(s == null ? "" : s); }
  function freshSession(host, mode) {
    var rawCad = lsGet("smd_prep_medigram_cadence");
    var cad = DATA.resolveCadence ? DATA.resolveCadence(rawCad) : (rawCad || "3:1");
    return { host: host, mode: mode || "study", feed: [], i: 0, mission: DATA.missionById("mix"), answered: 0, correct: 0, retrievalAnswered: 0, chosen: -1, revealed: false, showWhy: false, brk: null, timer: 0, cadence: cad, lang: lsGet("smd_prep_medigram_lang") || "en", events: [] };
  }
  function consent() { return { analytics: lsGet("smd_prep_stats") === "1" }; }
  function emit(name, data) {
    if (!S) return null;
    var e = DATA.buildEvent(name, data, consent());
    if (e) { S.events.push(e); try { var k = "smd_prep_medigram_events"; var old = JSON.parse(lsGet(k) || "[]"); old.push(e); G.localStorage.setItem(k, JSON.stringify(old.slice(-100))); } catch (x) {} }
    return e;
  }
  function ctxFor(host, mode) {
    var store = {}; try { store = host.store() || {}; } catch (e) {}
    var dueMap = {}, cards = store.cards || {};
    Object.keys(cards).forEach(function (k) { var id = k.split(":").pop(); dueMap[id] = cards[k][3]; });
    var mistakeIds = {}; Object.keys(store.mt || {}).forEach(function (id) { mistakeIds[id] = 1; });
    var ex = "neet-pg"; try { ex = host.exam().id; } catch (e) {}
    return { exam: ex, mode: mode, now: Date.now(), today: host.today(), hiddenIds: (store.hid && store.hid.ids) || {}, youtubeEnabled: FLAGS.youtube, language: S ? S.lang : "en", dueMap: dueMap, mistakeIds: mistakeIds, weakTopics: [], timetableSubjects: [], recentSubjects: [], seenIds: {} };
  }
  function buildCurrent() {
    var ctx = ctxFor(S.host, S.mode);
    var pool = DATA.eligible(CANDIDATES, ctx);
    var ranked = DATA.rankCandidates(pool, ctx);
    S.feed = S.mode === "break" ? pool.slice(0, 3) : DATA.buildFeed(ranked, { cadence: S.cadence, size: Math.max(5, (S.mission.mcq || 5) + (S.mission.lessons || 0) + 2) });
    S.i = 0; S.chosen = -1; S.revealed = false; S.showWhy = false;
  }

  function modeTabs() {
    var tabs = [];
    if (FLAGS.study) tabs.push(["study", "Study"]);
    if (FLAGS.discovery) tabs.push(["clinical", "Clinical"]);
    if (FLAGS.breakMode) tabs.push(["break", "Break"]);
    if (tabs.length < 2) return "";
    return '<div class="pn-mg-tabs" role="tablist" aria-label="PrepReels mode">' + tabs.map(function (t) {
      return '<button type="button" role="tab" class="pn-mg-tab' + (S.mode === t[0] ? " on" : "") + '" aria-selected="' + (S.mode === t[0]) + '" data-act="mg-mode" data-v="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>";
  }
  function progressText() {
    if (S.mode === "break") return S.brk ? "Break in progress" : "Choose a break length";
    return "Item " + Math.min(S.i + 1, S.feed.length) + " of " + S.feed.length + " · " + S.mission.label;
  }
  function cardHtml(c) {
    var ctx = ctxFor(S.host, S.mode);
    var reason = DATA.reasonFor(c, ctx);
    if (DATA.isQuestion(c)) {
      var done = S.revealed, letters = ["A", "B", "C", "D"];
      var opts = (c.o || []).map(function (o, k) {
        var cls = "pn-mg-opt" + (done && k === c.a ? " right" : "") + (done && S.chosen === k && k !== c.a ? " wrong" : "");
        return '<li><button type="button" class="' + cls + '" data-act="mg-answer" data-k="' + k + '"' + (done ? " disabled" : "") + ' aria-pressed="' + (S.chosen === k) + '"><span class="pn-mg-l">' + letters[k] + "</span><span>" + esc(o) + "</span></button></li>";
      }).join("");
      return '<section class="pn-mg-card" aria-label="Question"><p class="pn-mg-reason">' + esc(reason) + (c._retrievalFor ? " · Retrieval check" : "") + '</p><p class="pn-mg-q">' + esc(c.q || c.title) + '</p><ol class="pn-mg-opts">' + opts + "</ol>" +
        (done ? '<div class="pn-mg-exp" role="status"><p><b>' + (S.chosen === c.a ? "Correct. " : "Answer: " + letters[c.a] + ". ") + "</b>" + esc(c.exp || "") + '</p></div>' : "") + "</section>";
    }
    var label = MEDIA ? MEDIA.sourceLabel(c.media) : "";
    var d = MEDIA ? MEDIA.describe(c, { youtubeEnabled: FLAGS.youtube, offline: typeof navigator !== "undefined" && navigator.onLine === false }) : { kind: "none" };
    var mediaHtml = "";
    if (d.kind === "youtube") mediaHtml = '<div class="pn-mg-media" id="pnMgMedia"></div><p class="pn-mg-src">Source: YouTube · embedded with the official player</p>';
    else if (d.kind === "disabled") mediaHtml = '<p class="pn-mg-note">This video uses YouTube, which is off. The lesson below still teaches the point.</p>';
    else if (d.kind === "unavailable") mediaHtml = '<p class="pn-mg-note">Video unavailable right now. The lesson below still teaches the point.</p>';
    else if (d.kind === "first_party") mediaHtml = '<p class="pn-mg-src">Source: PrepReels micro-lesson</p>';
    return '<section class="pn-mg-card pn-mg-lesson" aria-label="Micro-lesson"><p class="pn-mg-reason">' + esc(reason) + (label ? " · " + esc(label) : "") + '</p><h2 class="pn-mg-h">' + esc(c.title) + '</h2><p class="pn-mg-sum">' + esc(c.summary || "") + "</p>" + mediaHtml +
      '<button type="button" class="pn-mg-btn" data-act="mg-lesson-done">Done with this lesson</button></section>';
  }
  function actionsHtml(c) {
    return '<div class="pn-mg-acts">' +
      '<button type="button" class="pn-mg-act" data-act="mg-save">Save</button>' +
      '<button type="button" class="pn-mg-act" data-act="mg-skip">Skip</button>' +
      '<button type="button" class="pn-mg-act" data-act="mg-understand">I don\'t understand</button>' +
      '<button type="button" class="pn-mg-act" data-act="mg-report">Report</button></div>' +
      (S.showWhy ? '<p class="pn-mg-note" role="status">' + esc((c && (c.summary || c.exp)) || "No extra explanation stored for this item. Try a related lesson.") + "</p>" : "");
  }
  function renderFeed() {
    var host = S.host;
    if (S.mode === "break") return renderBreak();
    if (!S.feed.length) {
      return host.paint(host.bar("PrepReels", "Short study feed", "back") + '<div class="pn-body pn-mg"><section class="pn-mg-card"><h2 class="pn-mg-h">Nothing due right now</h2><p class="pn-mg-sum">No eligible item matches this exam and language. Try English, or open a lesson from a subject.</p></section><button type="button" class="pn-mg-btn pri" data-act="mg-finish">Finish session</button></div>');
    }
    if (S.i >= S.feed.length) return renderSummary();
    var c = S.feed[S.i];
    host.paint(host.bar("PrepReels", esc(progressText()), "back") + '<div class="pn-body pn-mg">' + modeTabs() +
      '<div class="pn-mg-missions" role="group" aria-label="Session">' + DATA.MISSIONS.map(function (m) { return '<button type="button" class="pn-mg-chip' + (S.mission.id === m.id ? " on" : "") + '" aria-pressed="' + (S.mission.id === m.id) + '" data-act="mg-mission" data-v="' + m.id + '">' + esc(m.label) + "</button>"; }).join("") + "</div>" +
      '<div class="pn-mg-lang" role="group" aria-label="Language">' + DATA.LANGS.map(function (l) { return '<button type="button" class="pn-mg-chip sm' + (S.lang === l ? " on" : "") + '" aria-pressed="' + (S.lang === l) + '" data-act="mg-lang" data-v="' + l + '">' + (l === "en" ? "English" : l === "hi" ? "Hindi" : "Telugu") + "</button>"; }).join("") + "</div>" +
      cardHtml(c) + actionsHtml(c) +
      '<div class="pn-mg-nav"><button type="button" class="pn-mg-btn" data-act="mg-prev"' + (S.i ? "" : " disabled") + '>Previous</button>' +
      '<button type="button" class="pn-mg-btn" data-act="mg-next">' + (S.i < S.feed.length - 1 ? "Next" : "Review finish") + '</button></div>' +
      '<button type="button" class="pn-mg-btn pri" data-act="mg-finish">Finish session</button>' +
      '<p class="pn-mg-fine">Finite session. Finish is always available; nothing autoplays next.</p></div>', S.revealed ? ".pn-mg-exp" : null);
    mountMedia(c);
  }
  function mountMedia(c) {
    if (!MEDIA || !c || c.kind !== "video") return;
    var holder = S.host.root() && S.host.root().querySelector("#pnMgMedia");
    if (holder) MEDIA.mount(holder, c, { youtubeEnabled: FLAGS.youtube, offline: typeof navigator !== "undefined" && navigator.onLine === false });
  }
  function renderSummary() {
    var p = DATA.missionProgress(S.mission, S);
    S.host.paint(S.host.bar("Session done", S.mission.label, "back") + '<div class="pn-body pn-mg"><section class="pn-mg-card"><h2 class="pn-mg-h">' + (p.done ? "Mission complete" : "Session finished") + '</h2><p class="pn-mg-sum">' + S.correct + " of " + S.answered + " answered correctly" + (S.retrievalAnswered ? " · " + S.retrievalAnswered + " retrieval check" + (S.retrievalAnswered === 1 ? "" : "s") : "") + '.</p><p class="pn-mg-note">Video time alone never completes a mission; only answers count.</p></section><button type="button" class="pn-mg-btn pri" data-act="mg-done">Done</button></div>', ".pn-mg-btn.pri");
    emit("session_finished", { answered: S.answered, correct: S.correct, mission: S.mission.id });
    if (p.done) emit("mission_completed", { mission: S.mission.id });
  }
  function renderBreak() {
    var host = S.host;
    if (!S.brk) {
      return host.paint(host.bar("Smart Break", "Timed break", "back") + '<div class="pn-body pn-mg">' + modeTabs() + '<section class="pn-mg-card"><h2 class="pn-mg-h">Take a short break</h2><p class="pn-mg-sum">Choose 3 or 5 minutes. The timer is a guide, not a lock. You can return to study at any time.</p><div class="pn-mg-nav"><button type="button" class="pn-mg-btn pri" data-act="mg-break-start" data-v="3">3 minutes</button><button type="button" class="pn-mg-btn" data-act="mg-break-start" data-v="5">5 minutes</button></div></section><button type="button" class="pn-mg-btn" data-act="mg-mode" data-v="study">Return to Study</button></div>');
    }
    var st = DATA.breakState(S.brk, Date.now());
    var mm = Math.floor(st.remainingSec / 60), ss = String(st.remainingSec % 60); if (ss.length < 2) ss = "0" + ss;
    host.paint(host.bar("Smart Break", st.expired ? "Break finished" : "Break in progress", "back") + '<div class="pn-body pn-mg"><section class="pn-mg-card" aria-live="polite"><h2 class="pn-mg-h">' + (st.expired ? "Break finished" : mm + ":" + ss + " left") + '</h2><p class="pn-mg-sum">' + (st.expired ? "Return to study when you are ready. No penalty, no streak loss." : "Rest your eyes. Nothing is playing and nothing will autoplay.") + '</p></section><div class="pn-mg-nav"><button type="button" class="pn-mg-btn pri" data-act="mg-break-return">Return to study</button>' + (st.expired ? "" : '<button type="button" class="pn-mg-btn" data-act="mg-break-extend">Add 3 minutes</button>') + '</div></div>');
  }
  function tickBreak() {
    if (!S || !S.brk) return;
    if (DATA.breakState(S.brk, Date.now()).expired) { stopBreakTimer(); renderBreak(); return; }
    renderBreak();
  }
  function stopBreakTimer() { if (S && S.timer) { G.clearInterval(S.timer); S.timer = 0; } }
  function releaseMedia() { if (MEDIA && MEDIA.release) MEDIA.release(); }

  function start(host, mode) {
    S = freshSession(host, mode && FLAGS[mode === "clinical" ? "discovery" : mode === "break" ? "breakMode" : "study"] ? mode : "study");
    if (S.mode !== "break" && !FLAGS.study && S.mode === "study") S.mode = FLAGS.discovery ? "clinical" : "study";
    buildCurrent();
    emit("session_started", { mode: S.mode, mission: S.mission.id, cadence: S.cadence });
    host.push(function () { renderFeed(); });
  }
  function setCadence(arm) {
    var c = DATA.resolveCadence ? DATA.resolveCadence(arm) : (arm === "2" || arm === "2:1" ? "2:1" : arm === "5" || arm === "5:1" ? "5:1" : "3:1");
    try { G.localStorage.setItem("smd_prep_medigram_cadence", String(arm)); } catch (e) {}
    if (S) {
      S.cadence = c;
      buildCurrent();
      if (S.host && S.host.rerender) S.host.rerender();
    }
    return c;
  }
  function homeRowHtml(host) {
    var icon = (host && host.ico ? host.ico("play") : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l12 7-12 7z"/></svg>');
    if (host && host.row) {
      return host.row("mg-open", icon, "PrepReels", "Short study feed · finish anytime");
    }
    var chev = (host && host.ico ? host.ico("chev") : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>');
    return '<button type="button" class="pn-row" data-act="mg-open"><span class="pn-ri" aria-hidden="true">' + icon + '</span><span class="pn-rb"><b>PrepReels</b><small>Short study feed · finish anytime</small></span>' + chev + '</button>';
  }
  function homeHtml(host) {
    if (!FLAGS.study && !FLAGS.discovery && !FLAGS.breakMode) return "";
    return '<h2 class="pn-h">PrepReels</h2><div class="pn-group">' + homeRowHtml(host) + '</div>';
  }

  function act(a, el, host) {
    if (!S) { if (a === "mg-open") return start(host, "study"); return; }
    var v = el && el.getAttribute("data-v"), c = S.feed[S.i];
    if (a === "mg-open") return start(host, "study");
    if (a === "mg-mode") { releaseMedia(); stopBreakTimer(); S.brk = null; S.mode = v || "study"; buildCurrent(); return renderFeed(); }
    if (a === "mg-mission") { S.mission = DATA.missionById(v); buildCurrent(); return renderFeed(); }
    if (a === "mg-lang") { try { G.localStorage.setItem("smd_prep_medigram_lang", v); } catch (e) {} S.lang = v; buildCurrent(); return renderFeed(); }
    if (a === "mg-cadence") { setCadence(v); return renderFeed(); }
    if (a === "mg-answer") {
      if (S.revealed || !c) return;
      var k = Number(el.getAttribute("data-k")), ok = k === c.a;
      S.chosen = k; S.revealed = true; S.answered++; if (ok) S.correct++;
      if (c._retrievalFor) { S.retrievalAnswered++; }
      emit(c._retrievalFor ? "retrieval_answered" : "mcq_answered", { candidateId: c.id, correct: ok, cadence: S.cadence });
      if (DATA.shouldScheduleFsrs({ type: c._retrievalFor ? "retrieval_answer" : "mcq_answer", correct: ok })) {
        try { var core = host.core(), store = host.store(); core.review(store, "p:" + (c.module || "medigram"), c.questionId || c.id, core.gradeFor(ok), host.today()); host.save(); } catch (e) {}
        try { if (host.record) host.record({ id: c.questionId || c.id, a: c.a, _m: c.module, _s: c.subject }, k); } catch (e) {}
      }
      return renderFeed();
    }
    if (a === "mg-lesson-done") { emit("lesson_completed", { candidateId: c && c.id }); S.i++; S.chosen = -1; S.revealed = false; return renderFeed(); }
    if (a === "mg-save") { emit("item_saved", { candidateId: c && c.id }); try { host.toast("Saved"); } catch (e) {} return; }
    if (a === "mg-skip") { emit("item_skipped", { candidateId: c && c.id }); S.i++; S.chosen = -1; S.revealed = false; S.showWhy = false; return renderFeed(); }
    if (a === "mg-next") { releaseMedia(); S.i++; S.chosen = -1; S.revealed = false; S.showWhy = false; return renderFeed(); }
    if (a === "mg-prev") { releaseMedia(); if (S.i) S.i--; S.chosen = -1; S.revealed = false; S.showWhy = false; return renderFeed(); }
    if (a === "mg-understand") {
      emit("understand_requested", { candidateId: c && c.id });
      var req = DATA.explainRequest(c);
      if (G.PREP_ASK && G.PREP_ASK.open && req) { try { G.PREP_ASK.open({ kind: "card", title: req.title || "Explain", ask: "Explain this in plain language with one analogy and one follow-up question.", fr: req.topic }, host); return; } catch (e) {} }
      S.showWhy = true; return renderFeed();
    }
    if (a === "mg-report") { emit("item_reported", { candidateId: c && c.id }); try { host.toast("Thanks. This item will be reviewed."); } catch (e) {} return; }
    if (a === "mg-finish") { releaseMedia(); stopBreakTimer(); return renderSummary(); }
    if (a === "mg-done") { releaseMedia(); stopBreakTimer(); var h = S.host; S = null; return h.back(); }
    if (a === "mg-break-start") { S.brk = DATA.createBreak(Number(v)); emit("break_started", { minutes: S.brk.durationMin }); stopBreakTimer(); S.timer = G.setInterval(tickBreak, 1000); return renderBreak(); }
    if (a === "mg-break-extend") { S.brk = DATA.extendBreak(S.brk, 3); stopBreakTimer(); S.timer = G.setInterval(tickBreak, 1000); return renderBreak(); }
    if (a === "mg-break-return") { stopBreakTimer(); S.brk = null; emit("break_returned", {}); S.mode = "study"; buildCurrent(); return renderFeed(); }
  }
  function back() { releaseMedia(); return false; }
  function leave() { releaseMedia(); stopBreakTimer(); S = null; }

  G.PREP_MEDIGRAM = { open: start, act: act, back: back, leave: leave, homeHtml: homeHtml, homeRow: homeRowHtml, setCadence: setCadence, candidates: function () { return CANDIDATES.slice(); }, _pure: DATA, _flags: FLAGS, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
