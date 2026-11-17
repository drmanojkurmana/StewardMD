/* PrepReels (MediGram) feed controller. window.PREP_MEDIGRAM. ES5.
   Loaded lazily by prep-loader.js only when smd_prep_medigram is on; with the flag off this file is never fetched.
   Draws through PREP._host with data-act="mg-*"; prep.js forwards mg-, asks back() first and calls leave() on close.
   One full-screen card per swipe, every format mixed: real bank questions from every subject of the learner's exam
   (FSRS through host.record, like the Play feed), key-point pearls, CliniX teaching videos (prep-medigram-media.js),
   lessons for the modules just drawn, and image cards. Finite: a batch ends on a score card with Keep going / Finish. */
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

  var BATCH = 18, L = ["A", "B", "C", "D", "E", "F"];
  var S = null;   // { host, mode, cards, loading, err, done, right, top, brk, timer, io, seen }
  var VIDS = null, IMGS = null;

  function H() { return S.host; }
  function esc(s) { return S && S.host ? S.host.esc(s) : String(s == null ? "" : s); }
  function consent() { return { analytics: lsGet("smd_prep_stats") === "1" }; }
  function emit(name, data) {
    var e = DATA.buildEvent(name, data, consent());
    if (e) { try { var k = "smd_prep_medigram_events", old = JSON.parse(lsGet(k) || "[]"); old.push(e); G.localStorage.setItem(k, JSON.stringify(old.slice(-100))); } catch (x) {} }
  }
  function subjName(sid) { try { var sb = H().subjectById(sid); return sb ? H().tx(sb.name) : ""; } catch (e) { return ""; } }
  function firstSentence(t) { t = String(t || "").replace(/\*\*|__/g, "").replace(/[​‌‍⁠﻿]/g, "").replace(/\s+/g, " ").trim(); var m = /^.*?[.!?](\s|$)/.exec(t); return (m ? m[0] : t).trim().slice(0, 260); }
  function imgUrl(f) { var u = (H().bankApi || "/api/prep/bank/") + "img/maikimg/" + f; return u.charAt(0) === "/" && G.SMD_API_BASE ? G.SMD_API_BASE + u : u; }

  /* ---------- content ---------- */
  // Random medical knowledge: k random modules across every subject of the exam, their usable items, shuffled.
  function draw(k) {
    var h = H(), ex = h.exam().id;
    return Promise.all(h.subjectsOf(ex).map(function (sb) { return h.loadIndex(sb.id).then(function (ix) { return { sid: sb.id, ix: ix }; }, function () { return null; }); })).then(function (xs) {
      var mods = [];
      xs.forEach(function (x) { if (x && x.ix && x.ix.topics) x.ix.topics.forEach(function (t) { if (t.group !== "mixed" && h.countFor(t, ex) > 0) mods.push({ s: x.sid, m: t.id }); }); });
      return Promise.all(h.shuffle(mods).slice(0, k).map(function (x) { return h.loadModule(x.s, x.m).then(function (items) { return h.pool(h.poolFor(items, ex, null)).filter(textOnly); }, function () { return []; }); }));
    }).then(function (lists) { var all = []; lists.forEach(function (l) { all = all.concat(l); }); return h.shuffle(all); });
  }
  // A reel card shows text only, so questions that need their figure are left out (same rule as the daily question in prep.js).
  function textOnly(it) {
    if (!it || !it.id || !it.q || !it.o || it.o.length < 2 || it.o.length > L.length || !(it.a >= 0 && it.a < it.o.length)) return false;
    if ((it.img && it.img.length) || /\b(image|shown|figure|photograph|picture|x-?ray below|graph)\b/i.test(it.q)) return false;
    try { if (G.PREP_RAD && G.PREP_RAD.figure(it, H())) return false; } catch (e) {}
    return true;
  }
  function videos() {
    if (VIDS || !FLAGS.youtube || !MEDIA) return Promise.resolve(VIDS || []);
    return G.fetch("/clinix/media/manifest.json").then(function (r) { return r.json(); }).then(function (m) { return (VIDS = MEDIA.videosFrom(m)); }, function () { return []; });
  }
  function images() {
    if (IMGS) return Promise.resolve(IMGS);
    var base = (H().staticBase || "/prep/").replace(/bank\/?$/, "");
    var get = function (f) { return H().getJSON(base + "imglearn/" + f).then(function (m) { return ((m && m.items) || []).filter(function (x) { return x.img && x.dx; }); }, function () { return []; }); };
    return Promise.all([get("eye.json"), get("psm.json")]).then(function (x) { return (IMGS = x[0].concat(x[1])); });
  }
  function lessonsFor(items) {
    if (!G.PREP_LESSONS || !G.PREP_LESSONS.index) return Promise.resolve([]);
    return G.PREP_LESSONS.index().then(function (ix) {
      var seen = {}, out = [];
      items.forEach(function (it) { var l = ix && ix.modules && ix.modules[it._m]; if (l && !seen[it._m]) { seen[it._m] = 1; out.push({ kind: "lesson", sid: it._s, mid: it._m, title: l.title, minutes: l.minutes }); } });
      return out;
    }, function () { return []; });
  }
  // Extras in a rotation (video, lesson, image) so every format shows up early in a batch.
  function rotate(vids, lessons, imgs) {
    var h = H(), v = h.shuffle(vids.slice()), l = lessons.slice(), im = h.shuffle(imgs.slice()).slice(0, 4).map(function (it) { return { kind: "img", it: it }; }), out = [];
    while (v.length || l.length || im.length) { if (v.length) out.push(v.shift()); if (l.length) out.push(l.shift()); if (im.length) out.push(im.shift()); }
    return out;
  }
  // Nothing repeats inside a session: questions, videos, lessons and images already shown are left out of later batches.
  function keyOf(c) { return c.kind === "q" ? "q:" + c.it.id : c.kind === "video" ? "v:" + c.videoId : c.kind === "lesson" ? "l:" + c.mid : c.kind === "img" ? "i:" + c.it.img : c.kind === "pearl" ? "p:" + c.text : ""; }
  function fresh(cards) { return cards.filter(function (c) { var k = keyOf(c); if (!k || S.seen[k]) return false; S.seen[k] = 1; return true; }); }
  function unseen(xs, kind) { return xs.filter(function (x) { return !S.seen[keyOf(x.kind ? x : { kind: kind, it: x })]; }); }
  function batch() {
    if (S.mode === "clinical") return Promise.all([videos(), images()]).then(function (x) { return fresh(rotate(unseen(x[0]), [], unseen(x[1], "img")).slice(0, BATCH)); });
    return Promise.all([draw(5), videos(), images()]).then(function (x) {
      var items = unseen(x[0], "q").slice(0, BATCH);
      return lessonsFor(items).then(function (les) { return fresh(DATA.mixFeed(items, rotate(unseen(x[1]), unseen(les), unseen(x[2], "img")), lsGet("smd_prep_medigram_cadence") || 3)); });
    });
  }
  function load(more) {
    S.loading = true; S.err = false;
    if (!more) render();
    var s0 = S;
    batch().then(function (cards) {
      if (S !== s0) return;
      S.loading = false;
      if (!cards.length && !S.cards.length) S.err = true;
      if (more && !cards.length) { H().toast("You have seen every card for now. Come back later for more."); return render(S.cards.length); }
      S.cards = S.cards.concat(cards);
      render(more ? S.cards.length - cards.length : -1);
    }, function () { if (S !== s0) return; S.loading = false; if (!S.cards.length) S.err = true; else H().toast("More cards need a connection."); render(); });
  }

  /* ---------- cards ---------- */
  function card(c, i) {
    var a = ' data-i="' + i + '"';
    if (c.kind === "pearl") return '<article class="vf-c vf-pearl pn-mg-c"' + a + '><p class="pn-mg-tag">Remember</p><p class="vf-big">' + esc(c.text) + "</p>" + (c.s ? '<p class="pn-mut pn-small">' + esc(subjName(c.s)) + "</p>" : "") + "</article>";
    if (c.kind === "video") {
      return '<article class="vf-c pn-mg-c pn-mg-vid"' + a + ' data-vid="' + esc(c.videoId) + '"><p class="pn-mg-tag">Watch</p><p class="vf-stem">' + esc(c.title) + "</p>" +
        '<div class="pn-mg-frame" role="region" aria-label="Video player"><img alt="" loading="lazy" src="https://i.ytimg.com/vi/' + esc(c.videoId) + '/hqdefault.jpg"></div>' +
        '<p class="pn-mut pn-small">' + esc(c.caption && c.caption !== c.title ? c.caption + " · " : "") + (c.by ? esc(c.by) + " on YouTube" : "YouTube") + "</p></article>";
    }
    if (c.kind === "lesson") return '<article class="vf-c pn-mg-c"' + a + '><p class="pn-mg-tag">Lesson · ' + esc(subjName(c.sid)) + '</p><p class="vf-big">' + esc(c.title) + '</p><p class="pn-mut">' + (c.minutes ? c.minutes + " min read, built from the questions you just met." : "Built from the questions you just met.") + '</p><button type="button" class="pn-btn pri" data-act="mg-lesson" data-i="' + i + '">Open lesson</button></article>';
    if (c.kind === "img") {
      return '<article class="vf-c vf-img pn-mg-c"' + a + '><p class="pn-mg-tag">Spot it · ' + esc(c.it.modality || c.it.deck || "Image") + '</p><figure><img src="' + esc(imgUrl(c.it.img)) + '" alt="Clinical image" loading="lazy" decoding="async"></figure>' +
        (c.shown ? '<p class="vf-big">' + esc(c.it.dx) + "</p>" + (c.it.finding ? '<p class="vf-why">' + esc(c.it.finding) + "</p>" : "") : '<button type="button" class="pn-btn" data-act="mg-reveal" data-i="' + i + '">Show the diagnosis</button>') + "</article>";
    }
    var it = c.it, done = c.ans != null;
    return '<article class="vf-c vf-q pn-mg-c"' + a + '><p class="pn-mg-tag">' + esc(subjName(it._s) || "Question") + '</p><p class="vf-stem">' + esc(it.q) + '</p><ol class="vf-opts">' + it.o.map(function (o, k) {
      var cls = "pn-opt" + (done && k === it.a ? " right" : "") + (done && k === c.ans && k !== it.a ? " wrong" : "");
      return '<li><button type="button" class="' + cls + '" data-act="mg-answer" data-i="' + i + '" data-k="' + k + '"' + (done ? ' aria-disabled="true"' : "") + '><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></button></li>";
    }).join("") + "</ol>" +
      (done ? '<p class="vf-why" role="status"><b>' + (c.ans === it.a ? "Right. " : "Answer: " + L[it.a] + ". ") + "</b>" + esc(firstSentence(it.exp || (it.x && it.x.key))) + "</p>" +
        '<div class="pn-mg-row"><button type="button" class="pn-btn pri" data-act="mg-next" data-i="' + i + '">Next</button>' +
        (G.PREP_ASK && G.PREP_ASK.open ? '<button type="button" class="pn-btn" data-act="mg-understand" data-i="' + i + '">Explain simply</button>' : "") + "</div>" : "") + "</article>";
  }
  function subtitle() { return S.done ? S.right + " of " + S.done + " right" : "Swipe up for the next"; }
  function render(scrollTo) {
    var h = H();
    if (S.mode === "break") return renderBreak();
    var body;
    if (S.loading && !S.cards.length) body = '<p class="pn-load" role="status">Building your reel…</p>';
    else if (S.err) body = '<p class="pn-err" role="alert">' + esc(G.PREP_BANK_MSG ? G.PREP_BANK_MSG("PrepReels needs a connection the first time. Try again online.") : "PrepReels needs a connection the first time. Try again online.") + '</p><button type="button" class="pn-btn pri" data-act="mg-retry">Try again</button>';
    else body = '<div class="vf pn-mg-feed" id="pnMgFeed" tabindex="-1" aria-label="PrepReels">' + S.cards.map(card).join("") +
      '<article class="vf-c vf-end pn-mg-c"><p class="vf-big">' + (S.done ? S.right + " of " + S.done + " right" : "End of this reel") + '</p><p class="pn-mut">' + S.cards.length + ' cards. Stop here or keep going.</p>' +
      '<button type="button" class="pn-btn pri" data-act="mg-more"' + (S.loading ? " disabled" : "") + ">Keep going" + '</button><button type="button" class="pn-btn" data-act="mg-done">Finish</button></article></div>';
    h.paint(h.bar("PrepReels", subtitle(), "back") + '<div class="pn-body pv-feed pn-mg">' + modeTabs() + body + "</div>");
    var box = h.root() && h.root().querySelector("#pnMgFeed");
    if (!box) return;
    if (scrollTo >= 0) { var nx = box.querySelectorAll(".vf-c")[scrollTo]; if (nx) box.scrollTop = nx.offsetTop - box.offsetTop; }
    else box.scrollTop = S.top || 0;
    box.addEventListener("scroll", function () { if (S) S.top = box.scrollTop; }, { passive: true });
    watchVideos(box);
  }
  // A video autoplays in the app while its card is on screen and is removed when swiped away, so one plays at a time.
  function watchVideos(box) {
    if (S.io) S.io.disconnect();
    if (!MEDIA || !G.IntersectionObserver) return;
    S.io = new G.IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        var el = e.target, vid = el.getAttribute("data-vid"), holder = el.querySelector(".pn-mg-frame");
        if (!holder) return;
        if (e.isIntersecting) MEDIA.mount(holder, vid, el.querySelector(".vf-stem").textContent);
        else if (holder.classList.contains("on")) MEDIA.release();
      });
    }, { root: box, rootMargin: "-45% 0px -45% 0px" });   // "on screen" = crosses the middle band, whatever the card height
    [].forEach.call(box.querySelectorAll(".pn-mg-vid"), function (el) { S.io.observe(el); });
  }
  function redraw(i) {
    var el = H().root().querySelector('#pnMgFeed .vf-c[data-i="' + i + '"]');
    if (el) el.outerHTML = card(S.cards[i], i);
    var sub = H().root().querySelector(".pn-bar .pn-t p"); if (sub) sub.textContent = subtitle();
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
  function renderBreak() {
    var h = H();
    if (!S.brk) {
      return h.paint(h.bar("Smart Break", "Timed break", "back") + '<div class="pn-body pn-mg">' + modeTabs() + '<section class="pn-mg-card"><h2 class="pn-mg-h">Take a short break</h2><p class="pn-mg-sum">Choose 3 or 5 minutes. The timer is a guide, not a lock. You can return to study at any time.</p><div class="pn-mg-nav"><button type="button" class="pn-mg-btn pri" data-act="mg-break-start" data-v="3">3 minutes</button><button type="button" class="pn-mg-btn" data-act="mg-break-start" data-v="5">5 minutes</button></div></section><button type="button" class="pn-mg-btn" data-act="mg-mode" data-v="study">Return to Study</button></div>');
    }
    var st = DATA.breakState(S.brk, Date.now());
    var mm = Math.floor(st.remainingSec / 60), ss = String(st.remainingSec % 60); if (ss.length < 2) ss = "0" + ss;
    h.paint(h.bar("Smart Break", st.expired ? "Break finished" : "Break in progress", "back") + '<div class="pn-body pn-mg"><section class="pn-mg-card" aria-live="polite"><h2 class="pn-mg-h">' + (st.expired ? "Break finished" : mm + ":" + ss + " left") + '</h2><p class="pn-mg-sum">' + (st.expired ? "Return to study when you are ready. No penalty, no streak loss." : "Rest your eyes. Nothing is playing and nothing will autoplay.") + '</p></section><div class="pn-mg-nav"><button type="button" class="pn-mg-btn pri" data-act="mg-break-return">Return to study</button>' + (st.expired ? "" : '<button type="button" class="pn-mg-btn" data-act="mg-break-extend">Add 3 minutes</button>') + '</div></div>');
  }
  function tickBreak() { if (!S || !S.brk || S.mode !== "break") return stopBreakTimer(); if (DATA.breakState(S.brk, Date.now()).expired) stopBreakTimer(); renderBreak(); }
  function stopBreakTimer() { if (S && S.timer) { G.clearInterval(S.timer); S.timer = 0; } }
  function stopMedia() { if (MEDIA) MEDIA.release(); if (S && S.io) { S.io.disconnect(); S.io = null; } }
  function setMode(mode) { stopMedia(); stopBreakTimer(); S.brk = null; S.mode = mode; S.cards = []; S.seen = {}; S.top = 0; S.done = S.right = 0; if (mode === "break") return renderBreak(); load(); }

  function start(host, mode) {
    if (G.PrepPro && G.PrepPro.can && !G.PrepPro.can("questions", { items: [] })) { G.PrepPro.openLimit("questions"); return; }
    S = { host: host, mode: "study", cards: [], loading: false, err: false, done: 0, right: 0, top: 0, brk: null, timer: 0, io: null, seen: {} };
    if (mode === "clinical" && FLAGS.discovery) S.mode = "clinical";
    else if (!FLAGS.study && FLAGS.discovery) S.mode = "clinical";
    emit("session_started", { mode: S.mode });
    host.push(function () { render(); });
    if (S.mode !== "break") load();
  }
  function homeRowHtml(host) {
    var icon = (host && host.ico ? host.ico("play") : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l12 7-12 7z"/></svg>');
    if (host && host.row) return host.row("mg-open", icon, "PrepReels", "Questions, videos and pearls, one swipe each");
    var chev = (host && host.ico ? host.ico("chev") : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>');
    return '<button type="button" class="pn-row" data-act="mg-open"><span class="pn-ri" aria-hidden="true">' + icon + '</span><span class="pn-rb"><b>PrepReels</b><small>Questions, videos and pearls, one swipe each</small></span>' + chev + "</button>";
  }
  function homeHtml(host) {
    if (!FLAGS.study && !FLAGS.discovery && !FLAGS.breakMode) return "";
    return '<h2 class="pn-h">PrepReels</h2><div class="pn-group">' + homeRowHtml(host) + "</div>";
  }

  function act(a, el, host) {
    if (a === "mg-open") return start(host, "study");
    if (!S) return;
    var v = el && el.getAttribute("data-v"), i = el ? Number(el.getAttribute("data-i")) : -1, c = S.cards[i];
    if (a === "mg-answer") {
      if (!c || c.kind !== "q" || c.ans != null) return;
      var k = Number(el.getAttribute("data-k")), ok = k === c.it.a;
      c.ans = k; S.done++; if (ok) S.right++;
      try { host.record(c.it, k, { ms: 0 }); } catch (e) {}   // FSRS + stats, exactly as the runner and Play feed do
      emit("mcq_answered", { correct: ok });
      try { if (G.SMD_HAPTICS) G.SMD_HAPTICS[ok ? "success" : "warning"](); } catch (e) {}
      return redraw(i);
    }
    if (a === "mg-next") {
      var box = host.root().querySelector("#pnMgFeed"), nx = box && box.querySelectorAll(".vf-c")[i + 1];
      if (nx) box.scrollTo({ top: nx.offsetTop - box.offsetTop, behavior: G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    if (a === "mg-reveal") { if (c) { c.shown = true; redraw(i); } return; }
    if (a === "mg-lesson") { if (c && G.PREP_LESSONS) { stopMedia(); emit("lesson_completed", {}); G.PREP_LESSONS.open(c.sid, c.mid, host); } return; }
    if (a === "mg-understand") {
      if (c && G.PREP_ASK && G.PREP_ASK.open) { stopMedia(); try { G.PREP_ASK.open({ kind: "card", title: firstSentence(c.it.q).slice(0, 80), ask: "Explain this question and its answer in plain language with one analogy.", fr: c.it.q + "\n" + c.it.o.map(function (o, k) { return L[k] + ". " + o; }).join("\n"), bk: "Answer: " + L[c.it.a] + ". " + c.it.o[c.it.a] + "\n" + String(c.it.exp || (c.it.x && c.it.x.key) || "") }, host); } catch (e) {} }
      emit("understand_requested", {}); return;
    }
    if (a === "mg-more") { if (!S.loading) { el.disabled = true; stopMedia(); load(true); } return; }
    if (a === "mg-retry") return load();
    if (a === "mg-mode") return setMode(v || "study");
    if (a === "mg-done") { emit("session_finished", { answered: S.done, correct: S.right }); stopMedia(); stopBreakTimer(); S = null; return host.back(); }
    if (a === "mg-break-start") { S.brk = DATA.createBreak(Number(v)); emit("break_started", { minutes: S.brk.durationMin }); stopBreakTimer(); S.timer = G.setInterval(tickBreak, 1000); return renderBreak(); }
    if (a === "mg-break-extend") { S.brk = DATA.extendBreak(S.brk, 3); stopBreakTimer(); S.timer = G.setInterval(tickBreak, 1000); return renderBreak(); }
    if (a === "mg-break-return") { emit("break_returned", {}); return setMode("study"); }
  }
  function back() { stopMedia(); return false; }
  function leave() { stopMedia(); stopBreakTimer(); S = null; }

  G.PREP_MEDIGRAM = { open: start, act: act, back: back, leave: leave, homeHtml: homeHtml, homeRow: homeRowHtml, _flags: FLAGS, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
