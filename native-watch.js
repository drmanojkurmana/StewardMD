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
  var _grp = { groups: [], patients: {}, tasks: {}, role: {}, meta: {}, subs: [], ptSubs: {} };
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
    if (_grp.subs.length) return;                 // idempotent — subscribe once
    // subscribeGroups bails (empty, no listener, no retry) if there's no uid yet,
    // so only subscribe once Firebase auth has resolved a currentUser. start()
    // calls this again on every auth-state change, so it self-heals post-login.
    try { if (!(auth() && auth().currentUser)) return; } catch (e) { return; }
    // one groups listener; (re)build per-group patient + task listeners on change
    _grp.subs.push(api.subscribeGroups(function (groups) {
      _grp.groups = (groups || []).slice(0, _grpMax);
      _grp.role = {};
      _grp.meta = {};
      _grp.groups.forEach(function (g) {
        _grp.role[g.id] = g.myRole || null;
        _grp.meta[g.id] = { name: g.name || "", kind: g.kind || "" };
      });
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
        var m = _grp.meta[gid] || {};
        var kind = m.kind || "";
        var unitName = m.name || (kind === "ward" ? "Ward" : "ICU");
        (_grp.patients[gid] || []).forEach(function (p) {
          if (!p) return;
          var st2 = p.state || {};
          push({
            id: String(gid + ":" + (p.id || "")),
            name: String(p.name || (st2.patient && st2.patient.name) || "Patient"),
            bed: String(p.bed || (st2.patient && st2.patient.bed) || ""),
            news2: news2Of(st2),
            flag: String(p.dx || (st2.patient && st2.patient.diagnosis) || "") || null,
            vitals: vitalsFrom(st2),
            unit: unitName,
            unitKind: kind || null
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
  // Map an alert's title/msg → an ICU labs.trends key so the watch detail can show
  // a recent trend. First match wins; null when unmappable.
  function analyteKeyFor(text) {
    var t = String(text || "").toLowerCase();
    if (/hyperkal|hypokal|potassium|\bk[\s⁺+]/.test(t)) return "k";
    if (/hypernatr|hyponatr|sodium|\bna[\s⁺+]/.test(t)) return "na";
    if (/gluc|glyca?emi|\bbsl\b|\brbs\b/.test(t)) return "glu";
    if (/creatin|\baki\b|\bckd\b/.test(t)) return "creat";
    if (/bicarb|hco3|acidos|alkalos/.test(t)) return "hco3";
    if (/calc|\bca[\s²⁺+]/.test(t)) return "ca";
    if (/magnes|\bmg[\s²⁺+]/.test(t)) return "mg";
    if (/phosph|\bpo4\b/.test(t)) return "po4";
    if (/chlorid|\bcl[\s⁻-]/.test(t)) return "cl";
    if (/h(a)?emoglob|an(a)?emi|\bhb\b/.test(t)) return "hb";
    if (/platelet|thrombocyt|\bplt\b/.test(t)) return "plt";
    if (/leu?k(o|a)?cyt|\bwbc\b|neutrop/.test(t)) return "wbc";
    if (/\binr\b|coagulop/.test(t)) return "inr";
    if (/album/.test(t)) return "alb";
    return null;
  }
  function trendFor(st, key) {
    try {
      if (!key || !st || !st.labs || !st.labs.trends) return null;
      var vals = [];
      st.labs.trends.forEach(function (r) { if (r && typeof r[key] === "number" && isFinite(r[key])) vals.push(r[key]); });
      if (vals.length < 2) return null;
      return vals.slice(-8);   // last 8 readings, oldest→newest
    } catch (e) { return null; }
  }

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
            ts: Math.floor(Date.now() / 1000),
            trend: trendFor(st, analyteKeyFor((a.title || "") + " " + (a.msg || "")))
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
              ts: Math.floor(Date.now() / 1000),
              trend: trendFor(st2, analyteKeyFor((a.title || "") + " " + (a.msg || ""))),
              groupId: String(gid),
              patientId: String(p.id || "")
            });
          });
        });
      });
    } catch (e) {}
    return out.slice(0, 20);
  }

  // Flatten every shared unit's tasks into the relay shape. assignedTo carries
  // the executor uid; role gates visibility on the watch. id IS the raw Firestore
  // task id (globally unique) so the watch can write status back with it.
  function tasks() {
    var out = [];
    try {
      Object.keys(_grp.patients).forEach(function (gid) {
        var pts = _grp.patients[gid] || [];
        var byId = {}; pts.forEach(function (p) { if (p && p.id) byId[p.id] = p; });
        Object.keys(_grp.tasks).forEach(function (key) {
          if (key.indexOf(gid + "/") !== 0) return;
          var pid = key.slice((gid + "/").length), p = byId[pid] || {};
          var label = [p.bed ? ("Bed " + p.bed) : null, p.name].filter(Boolean).join(" · ");
          (_grp.tasks[key] || []).forEach(function (t) {
            if (!t || !t.id) return;
            out.push({
              id: String(t.id),
              groupId: String(gid), patientId: String(pid),
              patientLabel: label || null,
              text: String(t.text || ""), priority: String(t.priority || "moderate"),
              status: String(t.status || "pending"),
              assignedByName: t.assignedByName || null, assignedToUid: t.assignedTo || null,
              dueAt: (typeof t.dueAt === "number" ? Math.floor(t.dueAt / 1000) : null),
              ts: (typeof t.ts === "number" ? Math.floor(t.ts / 1000) : null)
            });
          });
        });
      });
    } catch (e) {}
    return out.slice(0, 100);
  }
  // The doctor's most-senior role across their units (watch-side visibility gate;
  // instruct roles see all unit tasks).
  function roleForRelay() {
    try {
      var order = ["head", "professor", "assistant", "senior_resident", "junior_resident", "intern"];
      var best = null, bestRank = 99;
      Object.keys(_grp.role).forEach(function (gid) {
        var idx = order.indexOf(_grp.role[gid]);
        if (idx >= 0 && idx < bestRank) { bestRank = idx; best = _grp.role[gid]; }
      });
      return best;
    } catch (e) { return null; }
  }

  // Calculators the doctor starred on the phone (localStorage) → relayed as
  // {id,title,category,inputs,computeSrc}. The watch renders the inputs and has
  // the PHONE compute the result (watchOS has no JS engine). Types are coerced so
  // the Swift CalcField decodes cleanly (step/min/def as numbers).
  function calcFavIds() {
    try { var a = JSON.parse(localStorage.getItem("smd_watch_calc_favs") || "[]"); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function calcDefs() {
    var out = [];
    try {
      var mc = window.MEDCALC; if (!mc || !mc._calcs) return out;
      var favs = calcFavIds(); if (!favs.length) return out;
      var byId = {}; mc._calcs.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
      favs.forEach(function (id) {
        var c = byId[id]; if (!c || typeof c.compute !== "function") return;
        var inputs = (c.inputs || []).map(function (f) {
          var o = { id: String(f.id), label: String(f.label || f.id), type: String(f.type || "number") };
          if (f.unit != null) o.unit = String(f.unit);
          if (f.step != null && !isNaN(parseFloat(f.step))) o.step = parseFloat(f.step);
          if (f.min != null && !isNaN(parseFloat(f.min))) o.min = parseFloat(f.min);
          if (f.def != null && !isNaN(parseFloat(f.def))) o.def = parseFloat(f.def);
          if (Array.isArray(f.opts)) o.opts = f.opts.map(function (op) { return { v: String(op.v), t: String(op.t) }; });
          return o;
        });
        out.push({ id: String(c.id), title: String(c.title || c.id), category: String(c.cat || ""),
                   inputs: inputs, computeSrc: String(c.compute.toString()) });
      });
    } catch (e) {}
    return out.slice(0, 40);
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
      var tk = tasks(); if (tk.length) payload.tasks = tk;
      var role = roleForRelay(); if (role) payload.role = role;
      var cd = calcDefs(); if (cd.length) payload.calcDefs = cd;
      var cen = census(wl.length); if (cen) payload.glance = cen;
      // W2: doctor's name for the watch home header (below the StewardMD wordmark).
      // NOTE: don't send HOSPITAL.current() — that's the antibiogram data source (e.g. "ICMR"),
      // not the doctor's hospital, so it would mislabel the watch. Name only.
      try { var dn = (u.displayName || "").trim(); if (dn) payload.doctorName = dn; } catch (e) {}
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

  // The signed-in doctor's most-senior clinical role across their units, for role-aware UI
  // (e.g. Notification preferences locks task / critical-value alerts ON for JR/interns).
  // Reuses roleForRelay() over the live ICU-group subscription; null when the user is in no
  // unit yet (unrestricted). isRestricted() = a junior resident or intern anywhere.
  window.SMD_ROLE = {
    seniorMost: function () { return roleForRelay(); },
    isRestricted: function () { var r = roleForRelay(); return r === "junior_resident" || r === "intern"; }
  };
  // Auto-triggered sync respects the toggle and battery-optimization throttle
  // (min 2h between background syncs when low-power is on).
  function autoPublish() {
    if (!autoSyncOn()) return;
    if (lowPower() && (Date.now() - lastSyncMs()) < 2 * 60 * 60 * 1000) return;
    publish();
  }

  function start() {
    var a = auth();
    // Attach the shared-unit sync on auth-state change too: subscribeGroups needs a
    // resolved currentUser, which isn't ready at boot. startGroupSync() is idempotent,
    // so firing it here (login) + below (in case auth already resolved) is safe.
    if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { startGroupSync(); autoPublish(); }); }
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

    // Watch → phone: apply a task-status change to Firestore. taskId is the raw
    // Firestore id (== WatchTask.id); groupId/patientId locate the task doc.
    try {
      if (p && p.addListener) p.addListener("taskStatus", function (a) {
        try {
          var api = groupsApi(); if (!api || !api.setTaskStatus || !a) return;
          if (!(a.groupId && a.patientId && a.taskId && a.status)) return;
          api.setTaskStatus(a.groupId, a.patientId, a.taskId, a.status);
          // Mirror the phone: completing a task appends an author-stamped timeline
          // event (setTaskStatus only updates the task doc). Look up the task text
          // from the live cache for a matching title.
          if (a.status === "done" && api.addTimelineEvent) {
            var text = "";
            try {
              (_grp.tasks[a.groupId + "/" + a.patientId] || []).forEach(function (t) {
                if (t && String(t.id) === String(a.taskId)) text = t.text || "";
              });
            } catch (e) {}
            try { api.addTimelineEvent(a.groupId, a.patientId, { type: "task", title: "Task completed — " + (text || "task") }); } catch (e) {}
          }
        } catch (e) {}
      });
    } catch (e) {}

    // Watch → phone: a critical acknowledged on the wrist → append an ICU-timeline
    // event on that shared patient (mirrors the phone; open/local patients omit gid/pid).
    try {
      if (p && p.addListener) p.addListener("labAck", function (a) {
        try {
          var api = groupsApi(); if (!api || !api.addTimelineEvent || !a || !a.gid || !a.pid) return;
          var label = [a.analyte, a.value].filter(Boolean).join(" ");
          api.addTimelineEvent(a.gid, a.pid, { type: "note", title: "Acknowledged — " + (label || "critical value") });
        } catch (e) {}
      });
    } catch (e) {}

    // Code Blue alert banner — appears center-screen when a code is started on the
    // watch: a blue StewardMD badge flips in with a blinking "CODE BLUE". Tap the
    // badge to open the Command Center; tap the backdrop to dismiss (the code keeps
    // running). Driven by the plugin's `codeBlueActive` event (native + watch only).
    try {
      var cbShownForCode = false;   // shown once per code — don't nag after dismiss
      function cbEnsure() {
        if (document.getElementById("cbAlert")) return;
        var css = document.createElement("style");
        css.textContent =
          "#cbAlert{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;" +
          "background:rgba(2,6,23,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}" +
          "#cbAlert.show{display:flex}" +
          "#cbAlert .cbc{cursor:pointer;text-align:center;padding:30px 38px;border-radius:22px;" +
          "background:linear-gradient(160deg,#0b3a8f,#1e40af 58%,#2563eb);" +
          "box-shadow:0 18px 50px rgba(37,99,235,.55),inset 0 0 0 1px rgba(255,255,255,.12);" +
          "animation:cbFlip .7s cubic-bezier(.2,.7,.2,1) both,cbPulse 1.6s ease-in-out .7s infinite;transform-style:preserve-3d}" +
          "#cbAlert .cbmark{width:56px;height:56px;margin:0 auto 8px;background:#fff;" +
          "-webkit-mask:url(/logo.png) center/contain no-repeat;mask:url(/logo.png) center/contain no-repeat}" +
          "#cbAlert .cbl{font:800 30px system-ui,-apple-system,sans-serif;color:#fff;letter-spacing:.5px}" +
          "#cbAlert .cbl span{color:#93c5fd}" +
          "#cbAlert .cbf{margin-top:10px;font:900 42px system-ui,-apple-system,sans-serif;letter-spacing:3px;color:#fff;" +
          "text-shadow:0 0 18px rgba(147,197,253,.9);animation:cbBlink 1s steps(1,end) infinite}" +
          "#cbAlert .cbh{margin-top:12px;font:600 14px system-ui;color:#dbeafe;opacity:.9}" +
          "@keyframes cbFlip{0%{transform:rotateY(90deg) scale(.82);opacity:0}100%{transform:rotateY(0) scale(1);opacity:1}}" +
          "@keyframes cbPulse{0%,100%{box-shadow:0 18px 50px rgba(37,99,235,.45),inset 0 0 0 1px rgba(255,255,255,.12)}" +
          "50%{box-shadow:0 18px 72px rgba(59,130,246,.9),inset 0 0 0 1px rgba(255,255,255,.22)}}" +
          "@keyframes cbBlink{0%,49%{opacity:1}50%,100%{opacity:.25}}";
        document.head.appendChild(css);
        var el = document.createElement("div");
        el.id = "cbAlert"; el.setAttribute("role", "alertdialog");
        el.setAttribute("aria-label", "Code Blue active — tap to open the Command Center");
        el.innerHTML = '<div class="cbc"><div class="cbmark"></div><div class="cbl">Steward<span>MD</span></div>' +
          '<div class="cbf">CODE BLUE</div><div class="cbh">Tap to open Command Center</div></div>';
        el.addEventListener("click", function (e) {
          if (e.target.closest(".cbc")) { if (p && p.openCodeBlue) p.openCodeBlue().catch(function () {}); }
          el.classList.remove("show");   // tapping the card (opened) or the backdrop (dismiss) both hide it
        });
        document.body.appendChild(el);
      }
      function cbShow() { cbEnsure(); var el = document.getElementById("cbAlert"); if (el) el.classList.add("show"); }
      function cbHide() { var el = document.getElementById("cbAlert"); if (el) el.classList.remove("show"); }
      if (p && p.addListener) p.addListener("codeBlueActive", function (ev) {
        var running = !!(ev && ev.running);
        if (running) { if (!cbShownForCode) { cbShownForCode = true; cbShow(); } }
        else { cbShownForCode = false; cbHide(); }
      });

      // Export tap on the native Command Center → append to the open ICU patient timeline.
      if (p && p.addListener) p.addListener("codeBlueExport", function (ev) {
        try {
          var detail = (ev && ev.detail) || "";
          var api = groupsApi();
          if (api && api.currentOpenPatient && api.addTimelineEvent) {
            var pt = api.currentOpenPatient();
            if (pt && pt.gid && pt.pid) {
              api.addTimelineEvent(pt.gid, pt.pid, { type: "codeblue", title: "Code Blue summary", detail: detail });
              return;
            }
          }
          console.log("[SMD-CodeBlue] export (no patient in context) — kept on device only");
        } catch (e) {}
      });
    } catch (e) {}

    // Watch → phone: register the watch's APNs token with the backend so the
    // wrist can be pushed directly (platform "watch"; server topic differs).
    try {
      if (p && p.addListener) p.addListener("watchPushToken", function (t) {
        try {
          var tok = t && t.token; if (!tok) return;
          var a2 = auth(), u2 = a2 && a2.currentUser;
          if (!u2 || !u2.getIdToken) return;
          u2.getIdToken().then(function (jwt) {
            var headers = { "Content-Type": "application/json" };
            if (jwt) headers["Authorization"] = "Bearer " + jwt;
            return fetch(((window.SMD_API_BASE || "") + "/api/push/register-native"), {
              method: "POST", headers: headers,
              body: JSON.stringify({ token: tok, platform: "watch" })
            });
          }).catch(function () {});
        } catch (e) {}
      });
    } catch (e) {}

    autoPublish();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
