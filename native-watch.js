/* StewardMD — Apple Watch bridge (native only).
 * ---------------------------------------------------------------------------
 * Publishes the signed-in session (uid, Firebase ID token, expiry) plus
 * favorites/recents to the paired Apple Watch through the WatchBridge native
 * plugin (App Group + WatchConnectivity). The watch app / widgets read this to
 * authenticate their own API calls and render glanceable data.
 *
 * Purely ADDITIVE and defensive:
 *   - No-op on the web build and until the WatchBridge plugin is present, so it
 *     can never affect the existing web/native experience.
 *   - Reads auth via the app's existing SMD_AUTH (Firebase web SDK) — it does
 *     NOT create a second auth state (mirrors native-push.js / native-auth.js).
 *   - Token is minted on demand and republished before its ~1h expiry.
 */
(function () {
  "use strict";
  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function"
    ? C.isNativePlatform()
    : (C.platform && C.platform !== "web")));
  if (!native) return;

  function plugin() { return (C.Plugins && C.Plugins.WatchBridge) || null; }

  function auth() {
    if (window.SMD_AUTH) return window.SMD_AUTH;
    try { return (window.firebase && window.firebase.auth) ? window.firebase.auth() : null; }
    catch (e) { return null; }
  }

  function favorites() {
    try { return (window.SMD_FAV && window.SMD_FAV.get) ? (window.SMD_FAV.get() || []) : []; }
    catch (e) { return []; }
  }

  function recents() {
    try { return (window.SMD_RECENT && window.SMD_RECENT.get) ? (window.SMD_RECENT.get() || []) : []; }
    catch (e) { return []; }
  }

  // ---- Shared-unit (group mode) live cache ----------------------------------
  // Subscribe to ALL the doctor's shared units and their patients/tasks, so the
  // watch mirrors "ICU and my ward" — not just the one open unit. Reads only the
  // PUBLIC SMD_ICU_GROUPS API (never icu.js internals). Re-publishes (debounced)
  // on any snapshot change.
  var _grp = { groups: [], patients: {}, tasks: {}, role: {}, subs: [], ptSubs: {} };
  var _grpMax = 6;            // cap live units
  var _grpPtMax = 40;         // cap total patients we hold task listeners for
  function groupsApi() { try { return window.SMD_ICU_GROUPS || null; } catch (e) { return null; } }
  function groupsOn() { var a = groupsApi(); try { return !!(a && a.enabled && a.enabled()); } catch (e) { return !!a; } }

  var _repubT = null;
  function republishSoon() {
    if (_repubT) return;
    _repubT = setTimeout(function () { _repubT = null; autoPublish(); }, 400);
  }

  function startGroupSync() {
    var api = groupsApi();
    if (!api || !api.subscribeGroups || !groupsOn()) return;
    // one groups listener; (re)build per-group patient + task listeners on change
    _grp.subs.push(api.subscribeGroups(function (groups) {
      _grp.groups = (groups || []).slice(0, _grpMax);
      _grp.role = {};
      _grp.groups.forEach(function (g) { _grp.role[g.id] = g.myRole || null; });
      rebuildGroupPatientSubs();
      republishSoon();
    }, function () {}));
  }

  function rebuildGroupPatientSubs() {
    var api = groupsApi(); if (!api) return;
    var wanted = {};
    _grp.groups.forEach(function (g) {
      wanted[g.id] = 1;
      if (!_grp.ptSubs[g.id]) {
        _grp.ptSubs[g.id] = { patientsOff: null, taskOffs: {} };
        _grp.ptSubs[g.id].patientsOff = api.subscribePatients(g.id, function (pts) {
          _grp.patients[g.id] = pts || [];
          syncTaskSubs(g.id, pts || []);
          republishSoon();
        }, function () {});
      }
    });
    // tear down units we've left
    Object.keys(_grp.ptSubs).forEach(function (gid) {
      if (!wanted[gid]) { teardownGroup(gid); }
    });
  }

  function syncTaskSubs(gid, pts) {
    var api = groupsApi(); if (!api || !api.subscribeTasks) return;
    var slot = _grp.ptSubs[gid]; if (!slot) return;
    var want = {};
    var total = 0; Object.keys(_grp.ptSubs).forEach(function (k) { total += Object.keys(_grp.ptSubs[k].taskOffs).length; });
    pts.forEach(function (p) {
      if (!p || !p.id) return;
      want[p.id] = 1;
      if (!slot.taskOffs[p.id] && total < _grpPtMax) {
        total++;
        slot.taskOffs[p.id] = api.subscribeTasks(gid, p.id, function (tasks) {
          _grp.tasks[gid + "/" + p.id] = tasks || [];
          republishSoon();
        });
      }
    });
    Object.keys(slot.taskOffs).forEach(function (pid) {
      if (!want[pid]) { try { slot.taskOffs[pid](); } catch (e) {} delete slot.taskOffs[pid]; delete _grp.tasks[gid + "/" + pid]; }
    });
  }

  function teardownGroup(gid) {
    var slot = _grp.ptSubs[gid]; if (!slot) return;
    try { slot.patientsOff && slot.patientsOff(); } catch (e) {}
    Object.keys(slot.taskOffs).forEach(function (pid) { try { slot.taskOffs[pid](); } catch (e) {} delete _grp.tasks[gid + "/" + pid]; });
    delete _grp.ptSubs[gid]; delete _grp.patients[gid];
  }

  // Latest vitals snapshot for a patient-glance tile grid. state.vitals is a
  // time-series array; take the most recent by ts (fallback last). Returns the
  // classic four tiles (HR / BP / SpO2 / Temp), omitting absent values, with a
  // simple abnormal flag for coloring. null when no vitals are recorded.
  function vitalsFrom(st) {
    try {
      var arr = (st && st.vitals) || [];
      if (!arr.length) return null;
      var lv = arr[0];
      for (var i = 1; i < arr.length; i++) { if ((arr[i].ts || 0) >= (lv.ts || 0)) lv = arr[i]; }
      var out = [];
      function num(x) { return (typeof x === "number" && isFinite(x)); }
      if (num(lv.hr)) out.push({ id: "HR", value: String(Math.round(lv.hr)), abnormal: lv.hr < 50 || lv.hr > 110 });
      if (num(lv.sbp)) out.push({ id: "BP", value: Math.round(lv.sbp) + (num(lv.dbp) ? "/" + Math.round(lv.dbp) : ""), abnormal: lv.sbp < 100 || lv.sbp > 180 });
      if (num(lv.spo2)) out.push({ id: "SpO2", value: String(Math.round(lv.spo2)), abnormal: lv.spo2 < 93 });
      if (num(lv.temp)) out.push({ id: "Temp", value: (Math.round(lv.temp * 10) / 10).toFixed(1), abnormal: lv.temp < 36 || lv.temp > 38 });
      return out.length ? out : null;
    } catch (e) { return null; }
  }

  // The currently-open ICU patient (the one the clinician is actively viewing).
  // Available even when nothing is saved to the roster and the GHIS cache is
  // empty — which is the common case — so it's the PRIMARY watchlist source.
  function openState() {
    try { return (window.ICU && ICU.state) ? ICU.state() : null; } catch (e) { return null; }
  }
  function news2Of(st) {
    var scores = (st && st.scores) || [];
    for (var i = 0; i < scores.length; i++) {
      if (scores[i] && scores[i].id === "news2" && scores[i].value != null) return Math.round(scores[i].value);
    }
    return null;
  }

  // Patient watchlist for the watch's "My patients". Sources, deduped by name+bed:
  //   1. the OPEN ICU patient (ICU.state()) — live scores/vitals,
  //   2. the saved ICU roster (ICU.listPatients()) — NEWS2 + vitals,
  //   3. GHIS worklist fallback (demographics/bed only).
  // All reads are synchronous, in-memory, side-effect-free. Capped for the WC payload.
  function watchlist() {
    var out = [], seen = {};
    function push(e) {
      if (!e || !e.id) return;
      var k = (e.name || "") + "|" + (e.bed || "");
      if (seen[k]) return; seen[k] = 1; out.push(e);
    }
    // 1. Open patient
    try {
      var st = openState(), pt = st && st.patient;
      if (pt && pt.name) {
        push({
          id: String(pt.mrn || pt.name || "current"),
          name: String(pt.name),
          bed: String(pt.bed || ""),
          news2: news2Of(st),
          flag: String(pt.diagnosis || "") || null,
          vitals: vitalsFrom(st)
        });
      }
    } catch (e) {}
    // 1b. Shared-unit patients (group mode) — ALL the doctor's units.
    try {
      Object.keys(_grp.patients).forEach(function (gid) {
        (_grp.patients[gid] || []).forEach(function (p) {
          if (!p) return;
          var st2 = p.state || {};
          push({
            id: String(gid + ":" + (p.id || "")),
            name: String(p.name || (st2.patient && st2.patient.name) || "Patient"),
            bed: String(p.bed || (st2.patient && st2.patient.bed) || ""),
            news2: news2Of(st2),
            flag: String(p.dx || (st2.patient && st2.patient.diagnosis) || "") || null,
            vitals: vitalsFrom(st2)
          });
        });
      });
    } catch (e) {}
    // 2. Saved ICU roster
    try {
      if (window.ICU && ICU.listPatients) {
        (ICU.listPatients() || []).forEach(function (e) {
          if (!e) return;
          var st2 = e.state || {}, pt2 = st2.patient || {};
          push({
            id: String(e.id || pt2.mrn || e.name || ""),
            name: String(e.name || pt2.name || "Patient"),
            bed: String(e.bed || pt2.bed || ""),
            news2: news2Of(st2),
            flag: String(e.dx || pt2.diagnosis || "") || null,
            vitals: vitalsFrom(st2)
          });
        });
      }
    } catch (e) {}
    // 3. GHIS worklist fallback (only if we still have nothing)
    try {
      if (!out.length && window.GHIS && GHIS.getPatients) {
        (GHIS.getPatients() || []).forEach(function (p) {
          if (!p) return;
          push({
            id: String(p.patientId || p.episodeId || ""),
            name: String(p.patientFirstName || "Patient"),
            bed: String(p.bedName || ""),
            news2: null,
            flag: String(p.deptDescription || "") || null
          });
        });
      }
    } catch (e) {}
    return out.slice(0, 30);
  }

  // Critical alerts for the watch's "Critical labs". The OPEN ICU patient's live
  // alert list (ICU.state().alerts) carries the crit/warn flags (e.g. K⁺ >6.5 →
  // "Critical hyperkalaemia"). severity "crit"/"warn" → the watch's
  // "critical"/"warning". Roster patients' saved alerts are stripped, so only the
  // open patient's criticals are relayed today.
  function criticals() {
    var out = [];
    try {
      var st = openState(), pt = st && st.patient, alerts = st && st.alerts;
      if (pt && alerts && alerts.length) {
        var label = [pt.bed ? ("Bed " + pt.bed) : null, pt.name].filter(Boolean).join(" · ");
        alerts.forEach(function (a) {
          if (!a || (a.severity !== "crit" && a.severity !== "warn")) return;
          var m = String(a.msg || "").match(/([\d.]+)\s*([A-Za-z%\/]+)?/);
          out.push({
            id: "icu-" + String(pt.mrn || pt.name || "cur") + "-" + String(a.title || ""),
            analyte: String(a.title || "Alert"),
            value: m ? m[1] : "",
            units: (m && m[2]) ? m[2] : null,
            refRange: null,
            patientLabel: label || null,
            severity: a.severity === "crit" ? "critical" : "warning",
            ts: Math.floor(Date.now() / 1000)
          });
        });
      }
    } catch (e) {}
    // Unit-wide: every shared patient's alerts across all the doctor's units.
    try {
      Object.keys(_grp.patients).forEach(function (gid) {
        (_grp.patients[gid] || []).forEach(function (p) {
          var st2 = p.state || {}, alerts = st2.alerts || [];
          if (!alerts.length) return;
          var label = [p.bed ? ("Bed " + p.bed) : null, p.name].filter(Boolean).join(" · ");
          alerts.forEach(function (a) {
            if (!a || (a.severity !== "crit" && a.severity !== "warn")) return;
            var m = String(a.msg || "").match(/([\d.]+)\s*([A-Za-z%\/]+)?/);
            out.push({
              id: "icu-" + String(gid + ":" + (p.id || "")) + "-" + String(a.title || ""),
              analyte: String(a.title || "Alert"),
              value: m ? m[1] : "", units: (m && m[2]) ? m[2] : null, refRange: null,
              patientLabel: label || null,
              severity: a.severity === "crit" ? "critical" : "warning",
              ts: Math.floor(Date.now() / 1000)
            });
          });
        });
      });
    } catch (e) {}
    return out.slice(0, 20);
  }

  // Ward Sync census. patientCount is the deduped watchlist size (so the open
  // patient counts even with an empty roster/GHIS cache). No true bed denominator
  // or task count exists client-side, so we don't invent them.
  function census(patientCount) {
    try {
      var occupied = 0;
      if (window.GHIS && GHIS.getPatients) {
        occupied = (GHIS.getPatients() || []).filter(function (p) { return p && /occupied/i.test(String(p.queueStatus || "")); }).length;
      }
      if (!patientCount) return null;                 // nothing meaningful to relay
      var ward = "";
      try { if (window.ICU && ICU.currentUnitLabel) ward = ICU.currentUnitLabel() || ""; } catch (e) {}
      return {
        patientCount: patientCount,
        censusOccupied: occupied || patientCount,
        censusTotal: patientCount,
        tasksDue: 0,
        onCall: false,
        ward: ward,
        updatedAt: Math.floor(Date.now() / 1000)
      };
    } catch (e) { return null; }
  }

  // Automatic sync is on unless the user turned it off in Settings → Apple Watch.
  function autoSyncOn() {
    try { return localStorage.getItem("smd_watch_autosync") !== "0"; } catch (e) { return true; }
  }
  function lowPower() {
    try { return localStorage.getItem("smd_watch_lowpower") === "1"; } catch (e) { return false; }
  }
  function lastSyncMs() {
    try { return parseInt(localStorage.getItem("smd_watch_last_sync") || "0", 10) || 0; } catch (e) { return 0; }
  }
  function markSynced() {
    try { localStorage.setItem("smd_watch_last_sync", String(Date.now())); } catch (e) {}
  }
  // Notification-tier preferences (relayed to the watch; Settings → Apple Watch).
  function notifPrefs() {
    function on(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch (e) { return d; } }
    return { critical: on("smd_watch_notif_critical", true), warning: on("smd_watch_notif_warning", true), info: on("smd_watch_notif_info", false) };
  }

  var publishing = false;
  async function publish() {
    if (publishing) return false;
    var p = plugin(); var a = auth();
    if (!p) return false;
    if (!a) return false;
    var u = a.currentUser;
    if (!u) { try { await p.clear(); } catch (e) {} return false; }
    publishing = true;
    try {
      var res = await u.getIdTokenResult();
      var payload = {
        uid: u.uid,
        idToken: res.token,
        expiresAt: Math.floor(new Date(res.expirationTime).getTime() / 1000),
        favorites: favorites(),
        recents: recents(),
        notifPrefs: notifPrefs()
      };
      // Only include census/watchlist/criticals when we actually have data, so a
      // cold-start (before ICU/Ward Sync are loaded) never wipes the watch's
      // last-known data.
      var wl = watchlist(); if (wl.length) payload.watchlist = wl;
      var crit = criticals(); if (crit.length) payload.criticals = crit;
      var cen = census(wl.length); if (cen) payload.glance = cen;
      await p.publish(payload);
      markSynced();
      return true;
    } catch (e) {
      // Never surface — the watch degrades to cached/offline on a stale token.
      return false;
    } finally {
      publishing = false;
    }
  }

  // Manual sync from the Settings → Apple Watch page always runs (ignores the
  // auto-sync toggle). Returns a promise resolving to whether it succeeded.
  window.SMD_APPLE_WATCH_SYNC = function () { return publish(); };
  // Auto-triggered sync respects the toggle and battery-optimization throttle
  // (min 2h between background syncs when low-power is on).
  function autoPublish() {
    if (!autoSyncOn()) return;
    if (lowPower() && (Date.now() - lastSyncMs()) < 2 * 60 * 60 * 1000) return;
    publish();
  }

  function start() {
    var a = auth();
    if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { autoPublish(); }); }
    else { setTimeout(start, 1500); return; }        // Firebase not booted yet — retry

    // Live shared-unit sync (ICU + ward) — publishes on any snapshot change.
    startGroupSync();

    // Refresh well before the ~1h ID-token expiry.
    setInterval(autoPublish, 50 * 60 * 1000);

    // Republish when the recent-cases list changes (recent.js exposes onChange).
    try { if (window.SMD_RECENT && window.SMD_RECENT.onChange) window.SMD_RECENT.onChange(autoPublish); }
    catch (e) {}

    // Republish when the app returns to the foreground (token may be near expiry).
    document.addEventListener("visibilitychange", function () { if (!document.hidden) autoPublish(); });

    // The watch can ask for a fresh token (plugin re-emits the WC request) —
    // always honor a token request even if auto-sync is off.
    var p = plugin();
    try { if (p && p.addListener) p.addListener("tokenRequested", function () { publish(); }); }
    catch (e) {}

    autoPublish();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
