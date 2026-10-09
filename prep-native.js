/* PrepNucleus on the phone: daily reminder, the home widget and Live Activity feed, and the sync controls. window.PREP_NATIVE. ES5.
   Plan: vault/plans/PrepNucleus-Plan2.md (phase 4). Loaded by prep-loader.js after prep-plan.js. Every native call is
   guarded: on the web (or a build without a plugin) each part quietly does nothing.

   Reminders: on or off per device (localStorage smd_prep_rem = "1"); the time itself lives in the plan. Permission is
   asked only when the student turns them on. Two modes (localStorage smd_prep_ndg_mode, per device): "smart" (the
   default) hands every flush to prep-nudges.js, which schedules personal nudges (vault/plans/PrepNucleus-Nudges.md);
   "daily" is one local notification (@capacitor/local-notifications) at pl.rem, scheduled for its next occurrence only
   under a stable id and re-scheduled on each open and plan change so the count stays fresh. Quiet hours (smart mode)
   live in prep-nudges.js. A tap opens PrepNucleus (extra.route "prep", extra.prep = PREP.open options, routed by
   native-push.js).
   Widget and Live Activity: Capacitor.Plugins.PrepWidgets (setData, activityStatus, startActivity, updateActivity,
   endActivity) with { v: 1, score, exam, daysLeft, done, total, next, day, updated }. The Live Activity starts when the
   student starts an item of today's plan and the system allows it (never prompted), follows the items, and ends when
   the plan is done or on the next day (localStorage smd_prep_la = the day it started).
   Sync: window.PREP_SYNC (prep-sync.js) drives the "Sync progress across devices" controls in the plan settings sheet;
   it syncs on open, after a finished set and on "Sync now". Pure helpers load under node for tests. */
(function (G) {
  "use strict";
  // Bound once per element and site; a later call swaps the handler (prep.js PREP_DOM.on: a patched repaint keeps nodes).
  function ON(el, site, type, fn, opts) { if (G.PREP_DOM && G.PREP_DOM.on) return G.PREP_DOM.on(el, site, type, fn, opts); el.addEventListener(type, fn, opts); }
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  /* ================= pure ================= */
  // Above any id native-push.js (counter from 1) or MaiK (1 to 100000) uses; a Java int.
  var NOTIF_ID = 2147483100;
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // Local calendar day of a time, "YYYY-MM-DD".
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // The next local time at "HH:MM" strictly after now (a time already past today, or this very minute, is tomorrow).
  // Built with the local Date constructor, so a DST change between now and then shifts nothing by hand.
  function nextAt(rem, now) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(rem || "")); if (!m || +m[1] > 23 || +m[2] > 59) return null;
    var d = new Date(now), t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], 0, 0);
    if (t.getTime() <= now) t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, +m[1], +m[2], 0, 0);
    return t.getTime();
  }
  /* The notification for the next reminder. planDay = the day today's plan was made for ("YYYY-MM-DD") and n its item
     count: the count shows only when the reminder falls on that day; otherwise the plan is made when the app opens. */
  function reminderPayload(rem, now, planDay, n) {
    var at = nextAt(rem, now); if (at == null) return null;
    var body = planDay && planDay === ymd(at) && n > 0 ? "Today's plan: " + n + (n === 1 ? " item" : " items") : "Today's plan is ready";
    return { id: NOTIF_ID, title: "PrepNucleus", body: body, schedule: { at: new Date(at), allowWhileIdle: true }, extra: { route: "prep" } };
  }
  /* The widget and Live Activity data. o: { score, exam, daysLeft, items: [{ label, done }], now }. */
  function snapshot(o) {
    var items = o.items || [], done = 0, next = null;
    items.forEach(function (it) { if (it.done) done++; else if (next == null) next = it.label; });
    return { v: 1, score: o.score || 0, exam: o.exam || "", daysLeft: o.daysLeft == null ? null : o.daysLeft, done: done, total: items.length, next: next, day: ymd(o.now), updated: o.now };
  }
  /* What to do with the Live Activity. st = activityStatus() { supported, enabled, active }; startDay = the day it was
     started here; start = the student just started an item of today's plan. -> "start" | "update" | "end" | null. */
  function activityAction(st, startDay, d, start) {
    st = st || {};
    if (st.active) {
      if (startDay !== d.day) return "end";
      return d.total && d.done >= d.total ? "end" : "update";
    }
    return start && st.supported && st.enabled && d.total > 0 && d.done < d.total ? "start" : null;
  }
  // "Last synced" wording.
  function ago(at, now) {
    var s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    var d = new Date(at); return "on " + d.getDate() + " " + "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[d.getMonth()];
  }
  // The status line under the sync switch, from PREP_SYNC.status().
  function syncLine(st, now) {
    if (!st || !st.signedIn) return "Sign in to sync";
    if (st.busy) return "Syncing";
    if (st.err) return st.on ? "Last sync failed: " + st.err : st.err;
    if (!st.on) return "Off. Progress stays on this phone.";
    return st.at ? "Last synced " + ago(st.at, now) : "Not synced yet";
  }

  var PURE = { NOTIF_ID: NOTIF_ID, ymd: ymd, nextAt: nextAt, reminderPayload: reminderPayload, snapshot: snapshot, activityAction: activityAction, ago: ago, syncLine: syncLine };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var H = null;
  var R = { perm: null, start: false, timer: 0, last: "", remKey: "", ndg: "", confirmOff: false, msg: "", wired: false, at: null };
  function noop() {}
  function cap() { return G.Capacitor || null; }
  function native() { var C = cap(); return !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web"))); }
  function plug(n) { var C = cap(); return native() && C.Plugins && C.Plugins[n] || null; }
  function call(p, m, arg) { try { return Promise.resolve(p[m](arg)); } catch (e) { return Promise.reject(e); } }
  function lsGet(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) G.localStorage.removeItem(k); else G.localStorage.setItem(k, v); } catch (e) {} }
  function sync() { var S = G.PREP_SYNC; return S && S.status ? S : null; }
  function host() { return H || (G.PREP && G.PREP._host) || null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function remOn() { return lsGet("smd_prep_rem") === "1"; }
  function nudges() { return G.PREP_NUDGES || null; }
  function smart() { return lsGet("smd_prep_ndg_mode") !== "daily" && !!nudges(); }
  function root() { var h = host(); return h && h.root(); }

  /* ---------- feed: widget, Live Activity, reminder ---------- */
  function data() {
    var h = host(), P = G.PREP_PLAN;
    if (!h || !P || !P.snapshot) return null;
    try { return P.snapshot(h); } catch (e) { return null; }
  }
  function flush() {
    R.timer = 0;
    var x = data(); if (!x) return;
    var d = snapshot({ score: x.score, exam: x.exam, daysLeft: x.daysLeft, items: x.items, now: Date.now() });
    var W = plug("PrepWidgets");
    if (W) {
      var key = JSON.stringify([d.score, d.exam, d.daysLeft, d.done, d.total, d.next, d.day]), json = JSON.stringify(d);
      if (key !== R.last) { R.last = key; call(W, "setData", { data: json }).catch(noop); }
      activity(W, d, json);
    }
    reminder(x.planDay, x.items.length, false, x);
  }
  // Debounced: an answer, a plan change, home mounting and a sync can all land within a moment.
  function changed() { if (R.timer) G.clearTimeout(R.timer); R.timer = G.setTimeout(flush, 600); }
  function activity(W, d, json) {
    var start = R.start; R.start = false;
    call(W, "activityStatus").then(function (st) {
      var a = activityAction(st, lsGet("smd_prep_la"), d, start);
      if (a === "start") return call(W, "startActivity", { data: json }).then(function () { lsSet("smd_prep_la", d.day); });
      if (a === "update") return call(W, "updateActivity", { data: json });
      if (a === "end") return call(W, "endActivity", {}).then(function () { lsSet("smd_prep_la", null); });
    }).catch(noop);
  }
  function cancelReminder(LN) { R.remKey = "off"; return call(LN, "cancel", { notifications: [{ id: NOTIF_ID }] }).catch(noop); }
  // Re-schedules only when the time or text changed; never asks for permission (that happens on the switch).
  function reminder(planDay, n, force, x) {
    var LN = plug("LocalNotifications"); if (!LN) return Promise.resolve();
    var h = host(), rem = h && h.store().pl && h.store().pl.rem, N = nudges();
    if (!rem || !remOn()) { if (N && (R.ndg !== "off" || force)) { R.ndg = "off"; N.stop(LN); } return R.remKey !== "off" || force ? cancelReminder(LN) : Promise.resolve(); }
    // Smart: the nudges replace the single daily reminder.
    if (smart()) {
      R.ndg = "on";
      var c = R.remKey !== "off" || force ? cancelReminder(LN) : Promise.resolve();
      return c.then(function () { return N.feed(h, x || data(), LN); });
    }
    if (N && (R.ndg !== "off" || force)) { R.ndg = "off"; N.stop(LN); }
    var p = reminderPayload(rem, Date.now(), planDay, n); if (!p) return Promise.resolve();
    var key = p.schedule.at.getTime() + "|" + p.body;
    if (key === R.remKey && !force) return Promise.resolve();
    return call(LN, "checkPermissions").then(function (r) {
      R.perm = r && r.display;
      if (R.perm !== "granted") return;
      return call(LN, "cancel", { notifications: [{ id: NOTIF_ID }] }).catch(noop).then(function () { return call(LN, "schedule", { notifications: [p] }); }).then(function () { R.remKey = key; });
    }).catch(noop);
  }
  function remNow(force) { var x = data(); return reminder(x ? x.planDay : null, x ? x.items.length : 0, force, x); }

  /* ---------- hooks from prep.js ---------- */
  function opened(h) {
    H = h;
    var S = sync();
    if (S && !R.wired && S.onChange) { R.wired = true; try { S.onChange(onSync); } catch (e) {} }
    if (S) { try { R.at = S.status().at; if (S.status().on) S.sync("open").catch(noop); } catch (e) {} }
    var LN = plug("LocalNotifications");
    if (LN) call(LN, "checkPermissions").then(function (r) { R.perm = r && r.display; }, noop);
    R.remKey = "";
    changed();
  }
  function finished() { var S = sync(); try { if (S && S.status().on) S.sync("finish").catch(noop); } catch (e) {} changed(); }
  function planStarted() { R.start = true; changed(); }
  // A finished sync may have changed the store: redraw readiness and the plan in place (no focus jump), refresh the feed.
  function onSync() {
    var S = sync(), st = null; try { st = S.status(); } catch (e) {}
    redrawSync();
    if (!st || st.busy || st.at === R.at) return;
    R.at = st.at;
    var h = host(), r = root();
    if (h && r && r.querySelector("#pnPlanTop") && G.PREP_PLAN) G.PREP_PLAN.homeMounted(h);
    changed();
  }

  /* ---------- settings: reminder ---------- */
  function sw(act, on, label, sub, dis, extra) {
    return '<button type="button" class="pl-sw" role="switch" aria-checked="' + !!on + '" data-act="' + act + '"' + (dis ? " disabled" : "") + (extra || "") + '>' +
      '<span class="pn-rb"><b>' + label + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + '</span><span class="pl-track" aria-hidden="true"><i></i></span></button>';
  }
  function clock(m) { var h = Math.floor(m / 60); return (h % 12 || 12) + (h < 12 ? " am" : " pm"); }
  /* The reminder controls under the time field. c = the plan answers being edited; sheet = the settings sheet (the mode
     and quiet hours show there, not in onboarding). */
  function remHtml(c, sheet) {
    if (!plug("LocalNotifications")) return '<p class="pn-mut pn-small">Reminders arrive in the StewardMD app on your phone. Your time is kept.</p>';
    var on = remOn(), denied = R.perm === "denied" && (on || R.msg === "denied"), N = nudges(), sm = smart();
    var sub = !c.rem ? "Pick a time first" : !on || denied ? "Off. Nothing is sent." : sm ? "Smart nudges, at most 2 a day" : "Every day at " + esc(c.rem) + ", with the count from today's plan";
    var h = sw("p-n-rem", on && !denied, "Study reminders", sub, !c.rem) +
      (denied ? '<p class="pl-warn pn-small" role="status">Notifications are off for StewardMD in Settings. Turn them on there, then here. Your time is kept.</p>' : "");
    if (!sheet || !on || denied || !N || !c.rem) return h;
    var opt = function (v, on1, label, small) {
      return '<button type="button" class="pl-opt' + (on1 ? " on" : "") + '" role="radio" aria-checked="' + on1 + '" data-act="p-n-mode" data-v="' + v + '"><span class="pn-rb"><b>' + label + "</b><small>" + small + '</small></span><span class="pl-dot" aria-hidden="true">' + (on1 ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : "") + "</span></button>";
    };
    var lt = N.learned(), q = String(N.quiet()).split("-");
    h += '<div class="pl-opts" role="radiogroup" aria-label="Reminder style">' +
      opt("smart", sm, "Smart nudges", "Your plan, due reviews, streak and exam countdown, from your own progress.") +
      opt("daily", !sm, "Daily reminder only", "One a day at " + esc(c.rem) + ".") + "</div>";
    if (sm) h += '<p class="pn-mut pn-small pl-when" role="status">' + (lt != null ? "Timed to when you usually start, around " + clock(lt) + "." : "At " + esc(c.rem) + " until PrepNucleus learns when you usually study.") + " Fewer if you don't open them.</p>" +
      '<fieldset class="pl-quiet"><legend>Quiet hours</legend><label><span class="pn-mut pn-small">From</span><input class="pn-in" type="time" id="plQa" name="quietFrom" autocomplete="off" value="' + esc(q[0]) + '"></label>' +
      '<label><span class="pn-mut pn-small">To</span><input class="pn-in" type="time" id="plQb" name="quietTo" autocomplete="off" value="' + esc(q[1]) + '"></label></fieldset>';
    return h;
  }
  // The quiet hour inputs report on change (prep-plan.js calls this after drawing the sheet).
  function wire(r) {
    var a = r && r.querySelector("#plQa"), b = r && r.querySelector("#plQb"), N = nudges();
    if (!a || !b || !N) return;
    var on = function () { if (/^\d{2}:\d{2}$/.test(a.value) && /^\d{2}:\d{2}$/.test(b.value)) { N.setQuiet(a.value, b.value); remNow(true); } };
    ON(a, "pn", "change", on); ON(b, "pn", "change", on);
  }
  function remToggle(redraw) {
    var LN = plug("LocalNotifications"); if (!LN) return Promise.resolve();
    if (remOn()) { lsSet("smd_prep_rem", null); R.msg = ""; R.ndg = "off"; return Promise.all([cancelReminder(LN), nudges() ? nudges().stop(LN) : null]).then(redraw); }
    // Asked here, in context, and only here.
    return call(LN, "checkPermissions").then(function (r) {
      var d = r && r.display;
      return d === "granted" || d === "denied" ? d : call(LN, "requestPermissions").then(function (q) { return q && q.display; });
    }).then(function (d) {
      R.perm = d;
      if (d === "granted") { lsSet("smd_prep_rem", "1"); R.msg = ""; return remNow(true); }
      R.msg = "denied"; R.perm = "denied";
    }, function () { R.msg = "denied"; R.perm = "denied"; }).then(redraw);
  }

  /* ---------- settings: sync ---------- */
  function syncInner() {
    var S = sync(), st = {}; try { st = S.status() || {}; } catch (e) {}
    var line = R.msg && R.msg !== "denied" ? R.msg : syncLine(st, Date.now()), bad = !!(st.err || (R.msg && R.msg !== "denied"));
    var html = sw("p-n-sync", !!st.on, "Sync progress across devices", "", !st.signedIn || st.busy, ' aria-describedby="plSyncSt"') +
      '<p class="pl-sst pn-small' + (bad ? " bad" : "") + '" id="plSyncSt" role="status">' + esc(line) + "</p>";
    if (R.confirmOff && st.on) html += '<div class="pl-conf" role="group" aria-labelledby="plConfT"><p id="plConfT"><b>Turn off sync on this phone?</b> Your progress here stays. The encrypted copy on the server can stay for your other devices, or be deleted now.</p>' +
      '<button type="button" class="pn-btn" data-act="p-n-off" data-v="0">Turn off, keep the server copy</button>' +
      '<button type="button" class="pn-btn danger" data-act="p-n-off" data-v="1">Turn off and delete the server copy</button>' +
      '<button type="button" class="pn-link pl-keep" data-act="p-n-offx">Keep sync on</button></div>';
    else if (st.on) html += '<button type="button" class="pn-btn sm pl-now" data-act="p-n-now"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Syncing" : "Sync now") + "</button>";
    return html + '<p class="pn-mut pn-small">Progress is encrypted on this phone before upload. StewardMD cannot read it without your account.</p>';
  }
  function syncHtml() { return sync() ? '<section class="pl-grp pl-g-sync"><h3 class="pl-sh"><span class="pl-sic" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17 18zM12 11v5M9.5 13.5L12 11l2.5 2.5"/></svg></span>Sync</h3><div class="pl-sync" id="plSync">' + syncInner() + "</div></section>" : ""; }
  function redrawSync(focus) {
    var r = root(), box = r && r.querySelector("#plSync"); if (!box) return;
    var a = focus || (G.document.activeElement && box.contains(G.document.activeElement) ? G.document.activeElement.getAttribute("data-act") : null);
    if (G.PREP_DOM) G.PREP_DOM.patch(box, syncInner()); else box.innerHTML = syncInner();
    var f = a && box.querySelector('[data-act="' + a + '"]:not([disabled])');
    try { if (f) f.focus(); } catch (e) {}
  }
  function fail(e, what) { R.msg = what + " Check the connection and try again."; redrawSync(); }

  /* ---------- events: "p-n-*" through prep-plan.js ---------- */
  function act(a, b, h, redraw) {
    H = h || H;
    var S = sync();
    if (a === "p-n-mode") {
      lsSet("smd_prep_ndg_mode", b.getAttribute("data-v") === "daily" ? "daily" : null);
      R.remKey = ""; R.ndg = "";
      return remNow(true).then(function () { if (redraw) redraw(); var r1 = root(), f1 = r1 && r1.querySelector('[data-act="p-n-mode"][aria-checked="true"]'); try { if (f1) f1.focus(); } catch (e) {} });
    }
    if (a === "p-n-rem") return remToggle(function () { if (redraw) redraw(); var r = root(), f = r && r.querySelector('[data-act="p-n-rem"]'); try { if (f) f.focus(); } catch (e) {} });
    if (!S) return;
    var st = {}; try { st = S.status() || {}; } catch (e) {}
    R.msg = "";
    if (a === "p-n-sync") {
      if (st.on) { R.confirmOff = true; redrawSync(); var r0 = root(), f0 = r0 && r0.querySelector('#plSync [data-act="p-n-off"]'); try { if (f0) f0.focus(); } catch (e) {} return; }
      if (!st.signedIn) return;
      var p = call(S, "enable"); redrawSync("p-n-sync");
      return p.then(function () { redrawSync("p-n-sync"); }, function (e) { fail(e, "Sync could not start."); });
    }
    if (a === "p-n-offx") { R.confirmOff = false; return redrawSync("p-n-sync"); }
    if (a === "p-n-off") {
      R.confirmOff = false;
      var q = call(S, "disable", { wipe: b.getAttribute("data-v") === "1" }); redrawSync("p-n-sync");
      return q.then(function () { redrawSync("p-n-sync"); }, function (e) { fail(e, "Sync could not be turned off."); });
    }
    if (a === "p-n-now") {
      var n = call(S, "sync", "manual"); redrawSync();
      return n.then(function () { redrawSync("p-n-now"); }, function (e) { fail(e, "Sync failed."); });
    }
  }
  function leave() { R.confirmOff = false; R.msg = ""; }

  G.PREP_NATIVE = { opened: opened, changed: changed, finished: finished, planStarted: planStarted, remHtml: remHtml, wire: wire, syncHtml: syncHtml, act: act, leave: leave, _pure: PURE, _r: R, _flush: flush };
})(typeof window !== "undefined" ? window : this);
