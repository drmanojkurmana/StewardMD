/* StewardMD — daily learning-streak active-time engine.
 * ---------------------------------------------------------------------------
 * A day counts toward the streak only after 5 minutes of ACTIVE, FOREGROUND use
 * during that LOCAL calendar day (00:00–23:59) — not merely opening the app and
 * not idle time. Time need not be continuous (2 + 1 + 2 min = 5). Once 5 min is
 * reached the client posts the local day to the server (POST /api/ku/qualify),
 * which owns the streak maths (idempotent, so it can never double-count).
 *
 * "Active" = tab visible + app foreground + a user interaction within the last
 * IDLE_MS. Leaving the app open untouched stops counting after the idle cutoff.
 * Accrual is lifecycle-driven with one low-frequency tick — no hot polling, so
 * it is battery-safe. Progress persists per-day in localStorage, so it survives
 * app/phone restart, low-memory kills and offline use.
 *
 *   window.SMD_STREAK = {
 *     progress()      -> { seconds, target, done, remaining }  today, LOCAL day
 *     qualifiedToday()-> bool
 *     todayKey()      -> "YYYYMMDD" (local)
 *     onQualify(fn)   -> fn(summary) when the day is credited server-side
 *     onProgress(fn)  -> fn(progress) as active time accrues
 *   }
 * Also dispatches window events: "smd-streak-progress", "smd-streak-qualified".
 */
(function () {
  "use strict";
  if (window.SMD_STREAK) return;

  var TARGET_SEC = 300;         // 5 minutes
  var IDLE_MS = 60000;          // no interaction for 60s → inactive
  var TICK_MS = 15000;          // low-frequency accrual/flush while active
  var SAVE_MIN_DELTA = 3;       // don't thrash localStorage for <3s deltas

  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")));

  var visible = (typeof document === "undefined") || document.visibilityState !== "hidden";
  var foreground = true;
  var lastInteraction = Date.now();
  var activeSince = null;       // ms when the current active stretch began
  var pendingUnsaved = 0;       // seconds accrued but not yet flushed to storage
  var timer = null;
  var qualifyInFlight = false;
  var qualifyListeners = [], progressListeners = [];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localDay(d) { d = d || new Date(); return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function secKey(day) { return "smd_streak_sec:" + day; }
  function qKey(day) { return "smd_streak_q:" + day; }
  function openKey(day) { return "smd_streak_open:" + day; }

  function getSec(day) { try { return parseInt(localStorage.getItem(secKey(day)) || "0", 10) || 0; } catch (e) { return 0; } }
  function setSec(day, v) { try { localStorage.setItem(secKey(day), String(Math.round(v))); } catch (e) {} }
  function qualifiedToday() { try { return localStorage.getItem(qKey(localDay())) === "1"; } catch (e) { return false; } }

  function signedIn() { try { return !!(window.SMD_KU && SMD_KU.signedIn && SMD_KU.signedIn()); } catch (e) { return false; } }
  function kuBase() { return window.AI_PROXY ? String(window.AI_PROXY).replace(/\/ai\b/, "/ku") : "/api/ku"; }
  function idToken() {
    try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; }); } catch (e) {}
    return Promise.resolve(null);
  }

  function progress() {
    var day = localDay();
    var seconds = getSec(day) + Math.round(pendingUnsaved);
    var done = seconds >= TARGET_SEC || qualifiedToday();
    return { seconds: Math.min(seconds, done ? seconds : TARGET_SEC), target: TARGET_SEC, done: done, remaining: Math.max(0, TARGET_SEC - seconds) };
  }
  function fireProgress() {
    var p = progress();
    progressListeners.forEach(function (f) { try { f(p); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent("smd-streak-progress", { detail: p })); } catch (e) {}
  }

  function isActiveNow(now) { return visible && foreground && (now - lastInteraction) < IDLE_MS; }

  // Fold elapsed active time into today's counter. Caps a trailing idle stretch at the idle cutoff.
  function accrue(now) {
    now = now || Date.now();
    if (activeSince != null) {
      var end = now;
      if ((now - lastInteraction) >= IDLE_MS) end = Math.min(now, lastInteraction + IDLE_MS);
      var delta = (Math.max(0, end - activeSince)) / 1000;
      if (delta > 0) { pendingUnsaved += delta; }
      activeSince = isActiveNow(now) ? now : null;
    } else if (isActiveNow(now)) {
      activeSince = now;
    }
    if (pendingUnsaved >= SAVE_MIN_DELTA || !isActiveNow(now)) flushToStorage();
    maybeQualify();
    fireProgress();
  }

  function flushToStorage() {
    if (pendingUnsaved <= 0) return;
    var day = localDay();
    setSec(day, getSec(day) + pendingUnsaved);
    pendingUnsaved = 0;
  }

  function maybeQualify() {
    if (!signedIn()) return;
    var day = localDay();
    if (localStorage.getItem(qKey(day)) === "1") return;
    if ((getSec(day) + pendingUnsaved) < TARGET_SEC) return;
    if (qualifyInFlight) return;
    qualifyInFlight = true;
    idToken().then(function (tok) {
      if (!tok) { qualifyInFlight = false; return; }               // not ready → retry next tick
      return fetch(kuBase() + "/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({ day: day, tzOffsetMin: new Date().getTimezoneOffset() })
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        qualifyInFlight = false;
        if (!j) return;
        if (j.qualified || j.already) { try { localStorage.setItem(qKey(day), "1"); } catch (e) {} }
        try { if (window.SMD_KU && SMD_KU._absorb) SMD_KU._absorb(j); } catch (e) {}
        qualifyListeners.forEach(function (f) { try { f(j); } catch (e) {} });
        try { window.dispatchEvent(new CustomEvent("smd-streak-qualified", { detail: j })); } catch (e) {}
      });
    }).catch(function () { qualifyInFlight = false; });
  }

  // "First app open each day" bonus — piggybacks on the KU award queue (server grants once/day).
  function pingOpen() {
    if (!signedIn()) return;
    var day = localDay();
    try { if (localStorage.getItem(openKey(day)) === "1") return; } catch (e) {}
    try { if (window.SMD_KU && SMD_KU.emit) { SMD_KU.emit("open", day); localStorage.setItem(openKey(day), "1"); } } catch (e) {}
  }

  function startTimer() { if (!timer) timer = setInterval(function () { accrue(Date.now()); }, TICK_MS); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function setForeground(on) {
    var now = Date.now();
    accrue(now);                                    // fold in time under the OLD state first
    foreground = !!on;
    visible = (typeof document === "undefined") || document.visibilityState !== "hidden";
    if (foreground && visible) { lastInteraction = now; activeSince = now; startTimer(); pingOpen(); maybeQualify(); }
    else { activeSince = null; flushToStorage(); stopTimer(); }
  }
  function onVisibility() {
    var vis = document.visibilityState !== "hidden";
    var now = Date.now();
    accrue(now);
    visible = vis;
    if (visible && foreground) { lastInteraction = now; activeSince = now; startTimer(); pingOpen(); maybeQualify(); }
    else { activeSince = null; flushToStorage(); stopTimer(); }
  }
  function onInteract() {
    lastInteraction = Date.now();
    if (activeSince == null && isActiveNow(lastInteraction)) activeSince = lastInteraction;
  }

  // ── wire lifecycle ──
  try { document.addEventListener("visibilitychange", onVisibility, { passive: true }); } catch (e) {}
  ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "click"].forEach(function (ev) {
    try { window.addEventListener(ev, onInteract, { passive: true, capture: true }); } catch (e) {}
  });
  try { window.addEventListener("focus", function () { setForeground(true); }, { passive: true }); } catch (e) {}
  try { window.addEventListener("blur", function () { setForeground(false); }, { passive: true }); } catch (e) {}
  try { window.addEventListener("pagehide", function () { accrue(Date.now()); flushToStorage(); }, { passive: true }); } catch (e) {}
  try { window.addEventListener("beforeunload", function () { accrue(Date.now()); flushToStorage(); }); } catch (e) {}
  if (native && C.Plugins && C.Plugins.App && C.Plugins.App.addListener) {
    try { C.Plugins.App.addListener("appStateChange", function (s) { setForeground(!!(s && s.isActive)); }); } catch (e) {}
  }
  // Retry a pending qualify (and first-open) when the account becomes available.
  try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.onChange) SMD_ACCOUNT.onChange(function () { pingOpen(); maybeQualify(); }); } catch (e) {}

  window.SMD_STREAK = {
    progress: progress,
    qualifiedToday: qualifiedToday,
    todayKey: function () { return localDay(); },
    onQualify: function (f) { if (typeof f === "function") qualifyListeners.push(f); },
    onProgress: function (f) { if (typeof f === "function") progressListeners.push(f); },
    _accrue: accrue
  };

  // Boot: begin counting if we're already visible+foreground.
  if (visible && foreground) { activeSince = Date.now(); lastInteraction = Date.now(); startTimer(); }
  setTimeout(function () { pingOpen(); maybeQualify(); fireProgress(); }, 1500);
})();
