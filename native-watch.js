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

  // Patient watchlist for the watch's "My patients". Prefers the ICU roster
  // (the only source carrying a computed NEWS2, via state.scores), falling back
  // to the GHIS worklist (demographics/bed, no score). All reads are synchronous,
  // in-memory, and side-effect-free (never trigger a fetch). Capped for the WC payload.
  function watchlist() {
    var out = [];
    try {
      if (window.ICU && ICU.listPatients) {
        (ICU.listPatients() || []).forEach(function (e) {
          if (!e) return;
          var st = e.state || {}, scores = st.scores || [], n2 = null;
          for (var i = 0; i < scores.length; i++) {
            if (scores[i] && scores[i].id === "news2" && scores[i].value != null) { n2 = scores[i].value; break; }
          }
          var pt = st.patient || {};
          out.push({
            id: String(e.id || ""),
            name: String(e.name || pt.name || "Patient"),
            bed: String(e.bed || pt.bed || ""),
            news2: (typeof n2 === "number") ? Math.round(n2) : null,
            flag: String(e.dx || pt.diagnosis || "") || null
          });
        });
      }
    } catch (e) {}
    try {
      if (!out.length && window.GHIS && GHIS.getPatients) {
        (GHIS.getPatients() || []).forEach(function (p) {
          if (!p) return;
          out.push({
            id: String(p.patientId || p.episodeId || ""),
            name: String(p.patientFirstName || "Patient"),
            bed: String(p.bedName || ""),
            news2: null,
            flag: String(p.deptDescription || "") || null
          });
        });
      }
    } catch (e) {}
    return out.filter(function (e) { return e.id; }).slice(0, 30);
  }

  // Ward Sync census. Only phone-owned fields (the watch keeps its own critical
  // count). No true bed denominator or task count exists client-side, so we don't
  // invent them: censusTotal = worklist size; tasksDue = 0.
  function census() {
    try {
      var occupied = 0, ghisN = 0, icuN = 0;
      if (window.GHIS && GHIS.getPatients) {
        var ps = GHIS.getPatients() || [];
        ghisN = ps.length;
        occupied = ps.filter(function (p) { return p && /occupied/i.test(String(p.queueStatus || "")); }).length;
      }
      if (window.ICU && ICU.listPatients) { icuN = (ICU.listPatients() || []).length; }
      var patientCount = ghisN || icuN;
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
      // Only include census/watchlist when we actually have data, so a cold-start
      // (before Ward Sync/ICU are loaded) never wipes the watch's last-known list.
      var wl = watchlist(); if (wl.length) payload.watchlist = wl;
      var cen = census(); if (cen) payload.glance = cen;
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
