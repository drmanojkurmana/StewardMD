/* PrepNucleus Focus (prep-focus.js, owner 2026-11-28): the focus timer with app blocking, modelled on Regain and built
   around studying. window.PREP_FOCUS. ES5. Plan and Regain teardown: vault/plans/PrepNucleus-Focus.md.

   What it is: a Focus screen with today's minutes against a daily goal, three modes (Timer, Pomodoro, Stopwatch), a
   running screen with one large ring, a "Leave early?" sheet that helps the student stay, a summary at the end, and
   today's timeline, the week and recent sessions. Every answer given in PrepNucleus while a session runs is counted
   and tags the session by subject (no typing). The session survives a closed PrepNucleus or a killed app: its state
   is in localStorage smd_prep_focus_run and the clock is wall time.

   App blocking is native and optional. The JS calls Capacitor.Plugins.SmdFocus when it exists (the iOS Screen Time
   plugin is built in a separate session; Android later). Contract (all promises; every failure is ignored, so without
   the plugin Focus is a full timer, only without blocking):
     status()                 -> { available, authorized, apps, categories, domains }
     authorize()              -> { authorized }
     pick()                   -> { apps, categories, domains }
     start({ endsAt, strict, title, plan }) -> { shielding }     endsAt ms or null (stopwatch), plan [[kind, sec]]
     stop()                   -> {}
     schedule({ items, web })  -> {}     items [{ id, name, from "HH:MM", to "HH:MM", days [0..6 Sun..Sat] }]: repeating
                                         focus windows that block the picked apps even with PrepNucleus closed; [] clears
   start() also carries web (block the picked websites too). Website blocking and schedules are Pro extras.
   Strict mode is a Pro extra (owner 2026-11-28: blocking free, extras Pro) when PrepPro enforces the free tier; while
   PrepPro does not enforce, everything is open, like the rest of PrepNucleus.

   Loaded by prep-loader.js after prep.js (optional). prep.js forwards every data-act starting "fo-" here, asks back()
   first, calls noteAnswer() from record() and leave() on close. prep-play.js hands its Focus room row to open().
   Flag smd_prep_focus, default OFF: localStorage "1" or ?focus=1 turns it on; "0" or ?focus=0 leaves PREP_FOCUS
   undefined (the Play Focus room stays as it was).
   Store (smd_prep_v1): fo = { goal (min a day), mode, dur, pomo, strict, block, d: { "YYYY-MM-DD": min }, log: [ { s, e,
   m, tag, q, r, ok } ] newest last, at most 200, web, sch: [schedule items + on] }; fxm["YYYY-MM"] (focus minutes a month) is shared with Play's Wrapped. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var RKEY = "smd_prep_focus_run", LOG_MAX = 200, WATCH_MAX = 6 * 3600, BEAT_MS = 60e3;
  var DURS = [25, 45, 60, 90, 120];
  var POMOS = { "25": { f: 25, b: 5, n: 4 }, "50": { f: 50, b: 10, n: 3 } };
  var GOALS = [60, 120, 180, 240, 360, 480];

  /* ================= pure ================= */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ym(ms) { return dayKey(ms).slice(0, 7); }
  // "25:00", "1:02:03".
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
  }
  // "45m", "2h", "1h 20m".
  function fmtMin(min) {
    min = Math.max(0, Math.round(min));
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + "h" + (m ? " " + m + "m" : "") : m + "m";
  }
  // The phases of a session: [[kind, sec]] with kind "f" (focus) or "b" (break). A stopwatch is one open focus phase.
  function planOf(mode, dur, pomo) {
    if (mode === "watch") return [["f", WATCH_MAX]];
    if (mode === "pomo") {
      var p = POMOS[String(pomo)] || POMOS["25"], o = [];
      for (var i = 0; i < p.n; i++) { o.push(["f", p.f * 60]); if (i < p.n - 1) o.push(["b", p.b * 60]); }
      return o;
    }
    return [["f", (Number(dur) || 25) * 60]];
  }
  function totalSec(plan) { return plan.reduce(function (a, p) { return a + p[1]; }, 0); }
  // Where a run is at a time: { i, kind, left, len, done (sec of focus so far), over }.
  function phaseAt(run, now) {
    var el = Math.max(0, (now - run.t0) / 1000), acc = 0, f = 0, plan = run.plan;
    for (var i = 0; i < plan.length; i++) {
      var len = plan[i][1];
      if (el < acc + len) {
        if (plan[i][0] === "f") f += el - acc;
        return { i: i, kind: plan[i][0], left: acc + len - el, len: len, done: f, pos: el - acc, over: false };
      }
      if (plan[i][0] === "f") f += len;
      acc += len;
    }
    var last = plan[plan.length - 1];
    return { i: plan.length - 1, kind: last[0], left: 0, len: last[1], done: f, pos: last[1], over: true };
  }
  function focusBlocks(plan) { return plan.filter(function (p) { return p[0] === "f"; }).length; }
  function blockNo(plan, i) { var n = 0; for (var k = 0; k <= i; k++) if (plan[k][0] === "f") n++; return n; }
  // The subject a session was mostly about, from its answer counts, or "".
  function topTag(tags) {
    var best = "", n = 0;
    for (var k in tags) if (Object.prototype.hasOwnProperty.call(tags, k) && tags[k] > n) { n = tags[k]; best = k; }
    return best;
  }
  // Save a finished run into the store. Minutes under 1 are not kept. -> the log entry or null.
  function saveRun(fo, fxm, run, now) {
    var ph = phaseAt(run, Math.min(now, run.t0 + totalSec(run.plan) * 1000)), min = Math.floor(ph.done / 60);
    if (min < 1) return null;
    var e = { s: run.t0, e: now, m: min, tag: topTag(run.tags || {}), q: run.q || 0, r: run.r || 0, ok: ph.over ? 1 : 0 };
    var log = fo.log || (fo.log = []);
    log.push(e); if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    var d = fo.d || (fo.d = {}), k = dayKey(run.t0); d[k] = (d[k] || 0) + min;
    var mk = ym(run.t0); fxm[mk] = (fxm[mk] || 0) + min;
    return e;
  }
  // Days in a row with 10+ focused minutes, ending today (or yesterday, when today has none yet).
  function streak(d, now) {
    var n = 0, t = new Date(now); t.setHours(12, 0, 0, 0);
    if (!((d || {})[dayKey(+t)] >= 10)) t.setDate(t.getDate() - 1);
    while ((d || {})[dayKey(+t)] >= 10) { n++; t.setDate(t.getDate() - 1); }
    return n;
  }
  // The last 7 days, oldest first: [{ k, label, m }].
  function week(d, now) {
    var o = [], t = new Date(now); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - 6);
    for (var i = 0; i < 7; i++) { var k = dayKey(+t); o.push({ k: k, label: "SMTWTFS".charAt(t.getDay()), m: (d || {})[k] || 0 }); t.setDate(t.getDate() + 1); }
    return o;
  }
  // Today's sessions as fractions of the day: [{ a, b, live }].
  function timeline(log, run, now) {
    var t = new Date(now); t.setHours(0, 0, 0, 0);
    var d0 = +t, d1 = d0 + 864e5, o = [];
    function add(s, e, live) { s = Math.max(s, d0); e = Math.min(e, d1); if (e > s) o.push({ a: (s - d0) / 864e5, b: (e - d0) / 864e5, live: !!live }); }
    (log || []).forEach(function (x) { if (x.e > d0) add(x.s, x.e, false); });
    if (run) add(run.t0, now, true);
    return o;
  }
  // Schedules: "HH:MM" -> minutes; the label "6:00 to 8:00 AM, weekdays"; the one running at a time.
  function hm(t) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : -1; }
  function clock12(t) { var v = hm(t), h = Math.floor(v / 60), m = v % 60, ap = h < 12 ? "AM" : "PM", h12 = h % 12 || 12; return h12 + ":" + pad(m) + " " + ap; }
  function daysLabel(d) {
    var k = (d || []).slice().sort().join("");
    if (k === "12345") return "weekdays"; if (k === "06") return "weekends"; if (k === "0123456") return "every day";
    return (d || []).slice().sort().map(function (x) { return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x]; }).join(", ");
  }
  function schLabel(x) {
    var a = clock12(x.from), b = clock12(x.to);
    if (a.slice(-2) === b.slice(-2)) a = a.slice(0, -3);
    return a + " to " + b + ", " + daysLabel(x.days);
  }
  function schValid(x) { var a = hm(x && x.from), b = hm(x && x.to); return a >= 0 && b > a && b - a >= 15 && !!(x.days && x.days.length); }
  // The schedule that is on at a moment (local time), or null. Windows do not cross midnight (schValid).
  function schActive(list, ms) {
    var d = new Date(ms), m = d.getHours() * 60 + d.getMinutes(), dow = d.getDay();
    for (var i = 0; i < (list || []).length; i++) { var x = list[i]; if (x.on !== false && schValid(x) && x.days.indexOf(dow) >= 0 && m >= hm(x.from) && m < hm(x.to)) return x; }
    return null;
  }
  var PURE = { hm: hm, schLabel: schLabel, schValid: schValid, schActive: schActive, dayKey: dayKey, fmtClock: fmtClock, fmtMin: fmtMin, planOf: planOf, totalSec: totalSec, phaseAt: phaseAt, focusBlocks: focusBlocks, blockNo: blockNo, topTag: topTag, saveRun: saveRun, streak: streak, week: week, timeline: timeline, POMOS: POMOS };
  if (NODE) { module.exports = PURE; return; }

  /* ================= app ================= */
  function flagOn() {
    try {
      var q = (G.location.search.match(/[?&]focus=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return G.localStorage.getItem("smd_prep_focus") === "1";
    } catch (e) { return false; }
  }
  if (!flagOn()) return;

  var D = G.document, H = null;
  var P = { tick: 0, beat: 0, sheet: null, prev: null, live: null, nat: null, lastPhase: -1, summary: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function now() { return Date.now(); }
  function store() { return H.store(); }
  function fo() { var s = store(); return s.fo || (s.fo = {}); }
  function goalMin() { var f = fo(), s = store(); return f.goal || (s.pl && s.pl.min) || 120; }
  function todayMin() { var r = run(), base = (fo().d || {})[dayKey(now())] || 0; return base + (r ? Math.floor(phaseAt(r, now()).done / 60) : 0); }
  function run() { try { return JSON.parse(G.localStorage.getItem(RKEY) || "null"); } catch (e) { return null; } }
  function setRun(r) { try { if (r) G.localStorage.setItem(RKEY, JSON.stringify(r)); else G.localStorage.removeItem(RKEY); } catch (e) {} }
  function hap(k) { try { var h = G.SMD_HAPTICS; if (h && h[k]) h[k](); } catch (e) {} }
  function user() { try { var a = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }
  function onScreen(view) { if (H && H.stackTop() === view) H.rerender(); }

  // Pro extras (strict mode). Open while PrepPro does not enforce the free tier.
  function proOk() { try { var st = G.PrepPro && G.PrepPro.status && G.PrepPro.status(); return !st || !st.enforce || !!st.pro; } catch (e) { return true; } }

  /* ---------- native blocking (optional) ---------- */
  function NAT() { try { var p = G.Capacitor && G.Capacitor.Plugins; return (p && p.SmdFocus) || null; } catch (e) { return null; } }
  function natCall(fn, arg) {
    var n = NAT();
    if (!n || typeof n[fn] !== "function") return Promise.resolve(null);
    try { return Promise.resolve(n[fn](arg || {})).then(function (x) { return x || {}; }, function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  function natRefresh() { return natCall("status").then(function (x) { P.nat = x; return x; }); }
  function pickedText(x) {
    if (!x || !x.authorized) return "Not set up";
    var a = x.apps || 0, c = x.categories || 0, w = x.domains || 0, parts = [];
    if (a) parts.push(a + (a === 1 ? " app" : " apps"));
    if (c) parts.push(c + (c === 1 ? " category" : " categories"));
    if (w) parts.push(w + (w === 1 ? " website" : " websites"));
    return parts.length ? parts.join(", ") : "Nothing picked yet";
  }
  function setupBlocking() {
    var x = P.nat;
    var go = x && x.authorized ? Promise.resolve({ authorized: true }) : natCall("authorize");
    return go.then(function (a) {
      if (!a || !a.authorized) { H.toast("App blocking needs Screen Time access."); return natRefresh(); }
      return natCall("pick").then(natRefresh);
    }).then(function () { var f = fo(); if (P.nat && P.nat.authorized && (P.nat.apps || P.nat.categories || P.nat.domains)) { f.block = true; H.save(); } H.rerender(); });
  }

  /* ---------- Live Activity / Dynamic Island (live-activities.js; iOS 16.2+, a no-op elsewhere) ---------- */
  // The clock ticks natively from startedAt / endsAt. Lock Screen text is only "Focus" and the subject count rule
  // of live-activities.js: no names, nothing private.
  function liveUp(r) {
    try {
      var L = G.SMD_liveActivity; if (!L || !L.upsert || !r) return;
      L.upsert({ key: "prep-focus", title: "PrepNucleus Focus", detail: r.mode === "pomo" ? "Pomodoro" : r.mode === "watch" ? "Stopwatch" : "Timer",
        startedAt: r.t0, endsAt: r.mode === "watch" ? 0 : r.t0 + totalSec(r.plan) * 1000, symbol: "timer", tint: "#efc07b" });
    } catch (e) {}
  }
  function liveEnd() { try { var L = G.SMD_liveActivity; if (L && L.end) L.end("prep-focus"); } catch (e) {} }

  /* ---------- session ---------- */
  function start() {
    var f = fo(), mode = f.mode || "timer", plan = planOf(mode, f.dur || 25, f.pomo || 25);
    var strict = !!f.strict && proOk() && mode !== "watch";
    var r = { t0: now(), mode: mode, plan: plan, strict: strict, q: 0, r: 0, tags: {}, block: !!f.block };
    setRun(r);
    hap("success");
    r.web = !!f.web && proOk();
    if (r.block) natCall("start", { endsAt: mode === "watch" ? null : r.t0 + totalSec(plan) * 1000, strict: strict, web: r.web, title: "Focus", plan: plan });
    beat(true); arm(); liveUp(r);
    H.push(renderRun);
  }
  function finish(early) {
    var r = run(); if (!r) return;
    var s = store(), e = saveRun(fo(), s.fxm || (s.fxm = {}), r, now());
    setRun(null); disarm(); beat(false); liveEnd();
    if (r.block) natCall("stop");
    H.save();
    P.summary = { e: e, early: !!early, mode: r.mode };
    hap(e && !early ? "success" : "light");
    if (H.stackTop() === renderRun) { H.back(); H.push(renderDone); }
    else {
      if (e && !early) H.toast("Focus session complete: " + fmtMin(e.m) + ".");
      if (H.stackTop() === renderHome) H.rerender();
    }
  }
  // Finish in 5 minutes: the session ends 5 min from now (never later than it would have).
  function extendTo5() {
    var r = run(); if (!r) return;
    var t = now(), ph = phaseAt(r, t), el = (t - r.t0) / 1000, cut = el + 300;
    var plan = [], acc = 0;
    for (var i = 0; i < r.plan.length && acc < cut; i++) { var len = Math.min(r.plan[i][1], cut - acc); plan.push([r.plan[i][0], len]); acc += len; }
    if (ph.kind === "b") plan.push(["f", 300]);
    r.plan = plan; setRun(r);
    if (r.block) natCall("start", { endsAt: r.t0 + totalSec(plan) * 1000, strict: r.strict, web: !!r.web, title: "Focus", plan: plan });
    liveUp(r);
    H.toast("5 more minutes. Make them count.");
  }
  function beat(on) {
    G.clearInterval(P.beat); P.beat = 0;
    // The live count rides Play's focus room heartbeat (functions/api/prep/play, a 150 s window): signed in only.
    var send = function (v) {
      var u = user(); if (!u || !u.getIdToken) return;
      u.getIdToken().then(function (tok) {
        return G.fetch("/api/prep/play/focus", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ on: v }), cache: "no-store" });
      }).then(function (res) { return res && res.ok ? res.json() : null; }).then(function (j) { if (j && typeof j.now === "number") { P.live = j.now; } }).catch(function () {});
    };
    send(!!on);
    if (on) P.beat = G.setInterval(function () { send(true); }, BEAT_MS);
  }
  function arm() { G.clearInterval(P.tick); P.tick = G.setInterval(tick, 1000); P.lastPhase = -1; tick(); }
  function disarm() { G.clearInterval(P.tick); P.tick = 0; }
  function tick() {
    var r = run(); if (!r) return disarm();
    var t = now(), ph = phaseAt(r, t);
    if (ph.over) return finish(false);
    if (P.lastPhase !== -1 && P.lastPhase !== ph.i) { hap("medium"); if (H && H.stackTop() === renderRun) return H.rerender(); }
    P.lastPhase = ph.i;
    if (!H || !H.root) return;
    var root = H.root(); if (!root) return;
    var c = root.querySelector("#foClock"); if (!c) return;
    c.textContent = fmtClock(r.mode === "watch" ? ph.done : ph.left);
    var arc = root.querySelector("#foArc");
    if (arc) arc.style.strokeDashoffset = String(CIRC * (1 - (r.mode === "watch" ? (ph.done % 3600) / 3600 : ph.pos / ph.len)));
    var tm = root.querySelector("#foToday"); if (tm) tm.textContent = fmtMin(todayMin()) + " today";
    // Every full focused minute: one light tick (not in a break).
    var m = Math.floor(ph.done / 60);
    if (ph.kind === "f" && P.lastMin != null && m > P.lastMin) hap("light");
    P.lastMin = m;
  }

  /* ---------- answers during a session ---------- */
  function noteAnswer(it, ok) {
    var r = run(); if (!r || !it) return;
    r.q = (r.q || 0) + 1; if (ok) r.r = (r.r || 0) + 1;
    var tag = "";
    try { var sb = it._s && it._s !== "deck" && H && H.subjectById ? H.subjectById(it._s) : null; tag = sb ? (H.tx ? H.tx(sb.name) : sb.name) : it._s === "deck" ? "My decks" : ""; } catch (e) {}
    if (tag) { r.tags = r.tags || {}; r.tags[tag] = (r.tags[tag] || 0) + 1; }
    setRun(r);
  }

  /* ---------- drawing ---------- */
  var R = 52, CIRC = 2 * Math.PI * R;
  function ring(frac, cls, inner) {
    frac = Math.max(0, Math.min(1, frac));
    return '<div class="fo-ring ' + (cls || "") + '"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="fo-tr" cx="60" cy="60" r="' + R + '"/>' +
      '<circle class="fo-arc" id="foArc" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="' + (CIRC * (1 - frac)).toFixed(2) + '" transform="rotate(-90 60 60)"/></svg>' +
      '<div class="fo-in">' + inner + "</div></div>";
  }
  function chip(act, v, label, on, extra) { return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + !!on + '"' + (extra || "") + ">" + label + "</button>"; }
  function sw(act, on, label, sub, badge) {
    return '<button type="button" class="fo-sw" role="switch" aria-checked="' + !!on + '" data-act="' + act + '"><span class="fo-swb"><b>' + label + (badge ? ' <i class="fo-pro">Pro</i>' : "") + "</b><small>" + sub + '</small></span><span class="fo-knob" aria-hidden="true"></span></button>';
  }
  var MODES = [["timer", "Timer"], ["pomo", "Pomodoro"], ["watch", "Stopwatch"]];
  function modeOpts(f) {
    var mode = f.mode || "timer";
    if (mode === "timer") return '<div class="fo-chips">' + DURS.map(function (m) { return chip("fo-dur", m, fmtMin(m), (f.dur || 25) === m); }).join("") + "</div>";
    if (mode === "pomo") return '<div class="fo-chips">' + Object.keys(POMOS).map(function (k) { var p = POMOS[k]; return chip("fo-pomo", k, p.f + " + " + p.b + " x " + p.n, String(f.pomo || 25) === k); }).join("") + "</div>" +
      '<p class="pn-mut pn-small">Focus blocks with short breaks between them. Breaks do not count as focus time.</p>';
    return '<p class="pn-mut pn-small fo-note">Counts up until you stop, up to 6 hours.</p>';
  }
  function timelineHtml(log, r) {
    var seg = timeline(log, r, now()).map(function (x) { return '<i class="' + (x.live ? "live" : "") + '" style="left:' + (x.a * 100).toFixed(2) + "%;width:" + Math.max(0.6, (x.b - x.a) * 100).toFixed(2) + '%"></i>'; }).join("");
    return '<div class="fo-tl" role="img" aria-label="Today\'s focus sessions across the day"><div class="fo-tlbar">' + seg + '</div><div class="fo-tlx" aria-hidden="true"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div></div>';
  }
  function weekHtml(d, goal) {
    var w = week(d, now()), max = Math.max(goal, w.reduce(function (a, x) { return Math.max(a, x.m); }, 0)) || 1, tk = dayKey(now());
    return '<ol class="fo-wk">' + w.map(function (x) {
      return '<li class="' + (x.k === tk ? "td" : "") + (x.m >= goal ? " hit" : "") + '"><span class="fo-wkb"><i style="height:' + Math.round(x.m / max * 100) + '%"></i></span><span class="fo-wkl" aria-hidden="true">' + x.label + '</span><span class="pn-sr">' + x.k + ": " + fmtMin(x.m) + "</span></li>";
    }).join("") + '<li class="fo-goal" style="bottom:' + Math.round(goal / max * 100) + '%" aria-hidden="true"></li></ol>';
  }
  function recentHtml(log) {
    var items = (log || []).slice(-5).reverse();
    if (!items.length) return '<p class="pn-mut pn-small">Your sessions show here.</p>';
    return '<ul class="fo-rec">' + items.map(function (x) {
      var d = new Date(x.s), when = (dayKey(x.s) === dayKey(now()) ? "Today" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" })) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      var what = x.tag ? esc(x.tag) : "Focus";
      var out = x.q ? x.q + (x.q === 1 ? " question" : " questions") + ", " + Math.round((x.r || 0) / x.q * 100) + "% right" : (x.ok ? "Completed" : "Ended early");
      return '<li><span class="fo-rm">' + fmtMin(x.m) + '</span><span class="fo-rb"><b>' + what + "</b><small>" + when + " · " + out + "</small></span></li>";
    }).join("") + "</ul>";
  }

  /* Schedules (Pro): repeating windows the native plugin blocks on its own. */
  var SUGGEST = [{ id: "morning", name: "Morning study", from: "06:00", to: "08:00", days: [1, 2, 3, 4, 5] }, { id: "evening", name: "Evening study", from: "19:00", to: "21:00", days: [1, 2, 3, 4, 5] }];
  function schHtml(f) {
    var list = f.sch || [], pro = proOk();
    var rows = list.map(function (x) {
      return '<div class="fo-sch">' + sw("fo-schon", x.on !== false && pro, esc(x.name), esc(schLabel(x)), false).replace('data-act="fo-schon"', 'data-act="fo-schon" data-v="' + esc(x.id) + '"') +
        '<button type="button" class="pn-link fo-schdel" data-act="fo-schdel" data-v="' + esc(x.id) + '" aria-label="Remove ' + esc(x.name) + '">Remove</button></div>';
    }).join("");
    var have = {}; list.forEach(function (x) { have[x.id] = 1; });
    var sug = SUGGEST.filter(function (x) { return !have[x.id]; }).map(function (x) { return chip("fo-schadd", x.id, "+ " + esc(x.name) + " \u00b7 " + esc(schLabel(x)), false); }).join("");
    return '<section class="fo-panel"><h2 class="fo-h">Schedules' + (pro ? "" : ' <i class="fo-pro">Pro</i>') + "</h2>" +
      '<p class="pn-mut pn-small">Picked apps are blocked in these hours, even with PrepNucleus closed.</p>' + rows +
      '<div class="fo-chips">' + sug + chip("fo-schnew", "", "+ Custom", false) + "</div></section>";
  }
  function schSync() { var f = fo(), on = proOk() ? (f.sch || []).filter(function (x) { return x.on !== false && schValid(x); }) : []; natCall("schedule", { items: on.map(function (x) { return { id: x.id, name: x.name, from: x.from, to: x.to, days: x.days }; }), web: !!f.web && proOk() }); }
  function schNewSheet() {
    var D7 = ["S", "M", "T", "W", "T", "F", "S"], dsel = [1, 2, 3, 4, 5];
    sheet("sch", "New schedule",
      '<label class="fo-lab" for="foSchN">Name</label><input id="foSchN" class="pn-in" maxlength="40" value="Study block">' +
      '<div class="fo-times"><label class="fo-lab">From<input id="foSchF" class="pn-in" type="time" value="15:00"></label><label class="fo-lab">To<input id="foSchT" class="pn-in" type="time" value="17:00"></label></div>' +
      '<div class="fo-days" role="group" aria-label="Days">' + D7.map(function (d, i) { return '<button type="button" class="pn-chip' + (dsel.indexOf(i) >= 0 ? " on" : "") + '" data-act="fo-schday" data-v="' + i + '" aria-pressed="' + (dsel.indexOf(i) >= 0) + '" aria-label="' + ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i] + '">' + d + "</button>"; }).join("") + "</div>" +
      '<p class="pn-mut pn-small" id="foSchMsg" role="status"></p><div class="fo-sheet-acts"><button type="button" class="pn-btn pri" data-act="fo-schsave">Save schedule</button></div>');
  }
  function schSave() {
    var el = P.sheet; if (!el) return;
    var days = []; [].forEach.call(el.querySelectorAll('[data-act=fo-schday][aria-pressed="true"]'), function (b) { days.push(+b.getAttribute("data-v")); });
    var x = { id: "s" + now().toString(36), name: (el.querySelector("#foSchN").value || "Study block").trim().slice(0, 40), from: el.querySelector("#foSchF").value, to: el.querySelector("#foSchT").value, days: days, on: true };
    if (!schValid(x)) { el.querySelector("#foSchMsg").textContent = !days.length ? "Pick at least one day." : "End after the start, at least 15 minutes, same day."; return; }
    var f = fo(); (f.sch || (f.sch = [])).push(x); H.save(); closeSheet(true); schSync(); hap("success"); H.rerender();
  }

  /* Focus home. */
  function renderHome() {
    var f = fo(), r = run(), goal = goalMin(), today = todayMin(), st = streak(f.d, now()), mode = f.mode || "timer";
    if (P.nat == null) { P.nat = false; natRefresh().then(function () { onScreen(renderHome); }); }
    var nat = P.nat, natAvail = !!(nat && nat.available !== false && NAT());
    var sub = st ? st + (st === 1 ? " day" : " days") + " in a row" : "";
    var hero = ring(today / goal, "fo-big", '<b class="fo-num">' + fmtMin(today) + '</b><button type="button" class="fo-goalb" data-act="fo-goal">of ' + fmtMin(goal) + " goal</button>");
    var opts = "";
    if (natAvail) {
      opts += '<button type="button" class="pn-row" data-act="fo-block"><span class="pn-ri" aria-hidden="true">' + LOCK + '</span><span class="pn-rb"><b>Block distracting apps</b><small>' + esc(pickedText(nat)) + "</small></span>" + H.ico("chev") + "</button>";
      if (nat.authorized && (nat.apps || nat.categories || nat.domains)) opts += sw("fo-blk", !!f.block, "Block during focus", "Blocked apps show a PrepNucleus screen");
      if (nat.authorized && nat.domains && f.block) opts += sw("fo-web", !!f.web && proOk(), "Block websites too", "The websites you picked, in every browser", !proOk());
    }
    if (mode !== "watch") opts += sw("fo-strict", !!f.strict && proOk(), "Strict mode", "End stays locked until the time is up", !proOk());
    var live = typeof P.live === "number" && P.live > 1 ? '<p class="pn-mut pn-small fo-live"><b>' + H.fmt(P.live) + "</b> students are focusing now</p>" : "";
    var main = r
      ? '<button type="button" class="pn-btn pri fo-go" data-act="fo-resume">' + H.ico("play") + " Back to your session</button>"
      : '<button type="button" class="pn-btn pri fo-go" data-act="fo-start">' + H.ico("play") + " Start focus</button>";
    var schOn = !r && natAvail ? schActive(f.sch, now()) : null;
    var nowBan = schOn ? '<section class="fo-panel fo-schnow"><p><b>' + esc(schOn.name) + "</b> is on now. Apps you picked are blocked until " + esc(clock12(schOn.to)) + '.</p><button type="button" class="pn-btn pri" data-act="fo-start">' + H.ico("play") + " Count it as a session</button></section>" : "";
    H.paint(H.bar("Focus", sub, "back") + '<div class="pn-body fo-home">' + nowBan +
      '<section class="fo-hero">' + hero + "</section>" +
      '<section class="fo-panel"><div class="fo-seg" role="radiogroup" aria-label="Mode">' + MODES.map(function (m) { return '<button type="button" role="radio" aria-checked="' + (mode === m[0]) + '" class="' + (mode === m[0] ? "on" : "") + '" data-act="fo-mode" data-v="' + m[0] + '">' + m[1] + "</button>"; }).join("") + "</div>" +
      modeOpts(f) + "</section>" +
      (opts ? '<section class="fo-panel fo-opts">' + opts + "</section>" : "") +
      main + live +
      (natAvail && nat.authorized ? schHtml(f) : "") +
      '<section class="fo-panel"><h2 class="fo-h">Today</h2>' + timelineHtml(f.log, r) + "</section>" +
      '<section class="fo-panel"><h2 class="fo-h">This week</h2>' + weekHtml(f.d, goal) + "</section>" +
      '<section class="fo-panel"><h2 class="fo-h">Recent</h2>' + recentHtml(f.log) + "</section>" +
      "</div>");
  }

  /* The running session. */
  function renderRun() {
    var r = run();
    if (!r) { H.back(); return; }
    var t = now(), ph = phaseAt(r, t), watch = r.mode === "watch", brk = ph.kind === "b";
    var blocks = focusBlocks(r.plan), label = brk ? "Break" : watch ? "Focusing" : blocks > 1 ? "Focus · block " + blockNo(r.plan, ph.i) + " of " + blocks : "Focus";
    var frac = watch ? (ph.done % 3600) / 3600 : ph.pos / ph.len;
    var endAt = new Date(r.t0 + totalSec(r.plan) * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    var studied = r.q ? r.q + (r.q === 1 ? " question" : " questions") + " · " + Math.round(r.r / r.q * 100) + "% right" + (topTag(r.tags) ? " · " + esc(topTag(r.tags)) : "") : "Answer questions in PrepNucleus and they count here.";
    var endBtn = r.strict && !watch
      ? '<button type="button" class="pn-btn fo-end" disabled aria-disabled="true">' + LOCK + " Locked until " + endAt + "</button>"
      : '<button type="button" class="pn-btn fo-end" data-act="fo-end">' + (watch ? "Stop and save" : "End session") + "</button>";
    H.paint(H.bar("Focus", '<span id="foToday">' + fmtMin(todayMin()) + " today</span>", "back") +
      '<div class="pn-body fo-run' + (brk ? " brk" : "") + '">' +
      '<p class="fo-phase" aria-live="polite">' + label + "</p>" +
      ring(frac, "fo-live-ring", '<b class="fo-clock" id="foClock" role="timer">' + fmtClock(watch ? ph.done : ph.left) + "</b>" + (watch ? "" : '<small class="fo-ends">Ends ' + endAt + "</small>")) +
      '<section class="fo-now"><p class="fo-eb">' + (brk ? "Stand up, drink water, look far away" : "This session") + '</p><p class="fo-studied">' + studied + "</p>" +
      (brk ? "" : '<button type="button" class="pn-btn pri" data-act="fo-study">' + H.ico("play") + " Study now</button>") + "</section>" +
      (r.block ? '<p class="pn-mut pn-small fo-note">' + LOCK + " Distracting apps are blocked until the session ends.</p>" : "") +
      endBtn + "</div>");
    arm();
  }

  /* The end of a session. */
  function renderDone() {
    var x = P.summary || {}, e = x.e, f = fo(), goal = goalMin(), today = todayMin(), st = streak(f.d, now());
    var head = !e ? "Under a minute, so nothing was saved." : x.early ? "Saved. Every focused minute counts." : today >= goal ? "Goal reached for today." : "Session complete.";
    var tiles = e ? '<div class="fo-tiles"><div><b>' + fmtMin(e.m) + "</b><small>Focused</small></div><div><b>" + (e.q || 0) + "</b><small>Questions</small></div><div><b>" + (e.q ? Math.round(e.r / e.q * 100) + "%" : "-") + "</b><small>Right</small></div><div><b>" + st + "</b><small>Day streak</small></div></div>" : "";
    H.paint(H.bar("Focus", "", "back") + '<div class="pn-body fo-done">' +
      ring(today / goal, "fo-big", '<b class="fo-num">' + fmtMin(today) + '</b><small>of ' + fmtMin(goal) + " today</small>") +
      '<h2 class="fo-dh" tabindex="-1" id="foDoneH">' + head + "</h2>" + (e && e.tag ? '<p class="pn-mut">Mostly ' + esc(e.tag) + ".</p>" : "") + tiles +
      '<div class="fo-acts"><button type="button" class="pn-btn pri" data-act="fo-again">' + H.ico("play") + ' Start another</button><button type="button" class="pn-btn" data-act="back">Done</button></div></div>', "#foDoneH");
  }

  /* ---------- sheets ---------- */
  function sheet(id, title, body) {
    closeSheet(true);
    var el = D.createElement("div"); el.className = "pn-sheet-wrap"; el.id = "foSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="fo-close"></div><section class="pn-sheet fo-sheet" role="dialog" aria-modal="true" aria-labelledby="foSheetT" tabindex="-1"><span class="pn-grab" aria-hidden="true"></span><h2 id="foSheetT">' + title + "</h2>" + body + "</section>";
    P.sheet = el; P.prev = D.activeElement; H.root().appendChild(el);
    try { el.querySelector(".pn-sheet").focus({ preventScroll: true }); } catch (e) {}
  }
  function closeSheet(quiet) {
    if (!P.sheet) return false;
    if (P.sheet.parentNode) P.sheet.parentNode.removeChild(P.sheet);
    P.sheet = null;
    if (!quiet) try { if (P.prev && P.prev.isConnected) P.prev.focus({ preventScroll: true }); } catch (e) {}
    return true;
  }
  function giveUpSheet() {
    var r = run(); if (!r) return;
    var ph = phaseAt(r, now()), m = Math.floor(ph.done / 60);
    hap("warning");
    sheet("give", "Leave early?",
      '<p class="pn-mut">' + (m ? "You have focused " + fmtMin(m) + " so far." : "You have only just started.") + " The first minutes are the hardest; it gets easier from here.</p>" +
      '<div class="fo-sheet-acts"><button type="button" class="pn-btn pri" data-act="fo-keep">Keep going</button>' +
      '<button type="button" class="pn-btn" data-act="fo-five">Finish in 5 minutes</button>' +
      '<button type="button" class="pn-link fo-quit" data-act="fo-quit">End and save</button></div>');
  }
  function goalSheet() {
    var g = goalMin();
    sheet("goal", "Daily focus goal", '<p class="pn-mut">The ring fills toward it. Your study plan suggested ' + fmtMin((store().pl && store().pl.min) || 120) + '.</p><div class="fo-chips">' +
      GOALS.map(function (m) { return chip("fo-setgoal", m, fmtMin(m), g === m); }).join("") + "</div>");
  }

  /* ---------- actions ---------- */
  function act(a, b, h) {
    H = h;
    var v = b && b.getAttribute ? b.getAttribute("data-v") : null, f = fo();
    if (a === "fo-close") return closeSheet();
    if (a === "fo-mode") { f.mode = v; H.save(); hap("selection"); return H.rerender(); }
    if (a === "fo-dur") { f.dur = Number(v) || 25; H.save(); return H.rerender(); }
    if (a === "fo-pomo") { f.pomo = Number(v) || 25; H.save(); return H.rerender(); }
    if (a === "fo-strict") {
      if (!proOk()) { if (G.PrepPro && G.PrepPro.openPricing) return G.PrepPro.openPricing(H); return H.toast("Strict mode is part of Pro."); }
      f.strict = !f.strict; H.save(); hap("selection"); return H.rerender();
    }
    if (a === "fo-blk") { f.block = !f.block; H.save(); hap("selection"); return H.rerender(); }
    if (a === "fo-web") {
      if (!proOk()) { if (G.PrepPro && G.PrepPro.openPricing) return G.PrepPro.openPricing(H); return H.toast("Website blocking is part of Pro."); }
      f.web = !f.web; H.save(); hap("selection"); schSync(); return H.rerender();
    }
    if (a === "fo-schadd" || a === "fo-schnew" || a === "fo-schon") {
      if (!proOk()) { if (G.PrepPro && G.PrepPro.openPricing) return G.PrepPro.openPricing(H); return H.toast("Schedules are part of Pro."); }
      if (a === "fo-schnew") return schNewSheet();
      if (a === "fo-schadd") { var sg = SUGGEST.filter(function (x) { return x.id === v; })[0]; if (sg) { (f.sch || (f.sch = [])).push({ id: sg.id, name: sg.name, from: sg.from, to: sg.to, days: sg.days.slice(), on: true }); H.save(); schSync(); hap("success"); } return H.rerender(); }
      (f.sch || []).forEach(function (x) { if (x.id === v) x.on = x.on === false; }); H.save(); schSync(); hap("selection"); return H.rerender();
    }
    if (a === "fo-schdel") { f.sch = (f.sch || []).filter(function (x) { return x.id !== v; }); H.save(); schSync(); return H.rerender(); }
    if (a === "fo-schday") { var pr = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(pr)); b.classList.toggle("on", pr); return; }
    if (a === "fo-schsave") return schSave();
    if (a === "fo-block") return setupBlocking();
    if (a === "fo-goal") return goalSheet();
    if (a === "fo-setgoal") { f.goal = Number(v) || 120; H.save(); closeSheet(true); return H.rerender(); }
    if (a === "fo-start" || a === "fo-again") { if (run()) return H.push(renderRun); if (a === "fo-again") H.back(); return start(); }
    if (a === "fo-resume") return H.push(renderRun);
    if (a === "fo-study") { H.back(); if (H.stackTop() === renderHome) H.back(); return; }
    if (a === "fo-end") { var r = run(); if (!r) return; if (r.mode === "watch") return finish(true); return giveUpSheet(); }
    if (a === "fo-keep") { closeSheet(); hap("light"); return; }
    if (a === "fo-five") { closeSheet(true); return extendTo5(); }
    if (a === "fo-quit") { closeSheet(true); return finish(true); }
  }
  function back() { return closeSheet(); }
  function leave() { closeSheet(true); }
  // A running session opens over Focus home, so back (and Done after it ends) lands on Focus, not PrepNucleus home.
  function open(h) { H = h; P.nat = null; H.push(renderHome); if (run()) { arm(); H.push(renderRun); } }
  // The Play menu row (prep-play.js) and PrepNucleus home call this for their subtitle.
  function rowSub(h) {
    H = h || H; var r = run();
    if (r) { var ph = phaseAt(r, now()); return (r.mode === "watch" ? fmtMin(ph.done / 60) + " so far" : fmtClock(ph.left) + (ph.kind === "b" ? " of break left" : " left")); }
    return H ? fmtMin(todayMin()) + " of " + fmtMin(goalMin()) + " today" : "Timer, Pomodoro and app blocking";
  }
  // A session that outlives a closed PrepNucleus keeps its clock: the next bind re-arms it.
  function bind(h) { H = h; if (run() && !P.tick) { arm(); beat(true); } }

  var LOCK = '<svg class="fo-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  // The welcome screen (prep-welcome.js): is the native plugin here, and run the blocking setup from outside Focus.
  function nativeAvailable() { return !!NAT(); }
  function setup(h) { H = h; return natRefresh().then(function () { H.push(renderHome); return setupBlocking(); }); }

  G.PREP_FOCUS = { act: act, back: back, leave: leave, open: open, bind: bind, rowSub: rowSub, noteAnswer: noteAnswer, nativeAvailable: nativeAvailable, setup: setup, running: function () { return !!run(); }, _pure: PURE, _p: P };
})(typeof window !== "undefined" ? window : this);
