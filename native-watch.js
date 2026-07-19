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

  var publishing = false;
  async function publish() {
    if (publishing) return;
    var p = plugin(); var a = auth();
    if (!p) return;
    if (!a) return;
    var u = a.currentUser;
    if (!u) { try { await p.clear(); } catch (e) {} return; }
    publishing = true;
    try {
      var res = await u.getIdTokenResult();
      await p.publish({
        uid: u.uid,
        idToken: res.token,
        expiresAt: Math.floor(new Date(res.expirationTime).getTime() / 1000),
        favorites: favorites(),
        recents: recents()
      });
    } catch (e) {
      // Never surface — the watch degrades to cached/offline on a stale token.
    } finally {
      publishing = false;
    }
  }

  function start() {
    var a = auth();
    if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { publish(); }); }
    else { setTimeout(start, 1500); return; }        // Firebase not booted yet — retry

    // Refresh well before the ~1h ID-token expiry.
    setInterval(publish, 50 * 60 * 1000);

    // Republish when the recent-cases list changes (recent.js exposes onChange).
    try { if (window.SMD_RECENT && window.SMD_RECENT.onChange) window.SMD_RECENT.onChange(publish); }
    catch (e) {}

    // Republish when the app returns to the foreground (token may be near expiry).
    document.addEventListener("visibilitychange", function () { if (!document.hidden) publish(); });

    // The watch can ask for a fresh token (plugin re-emits the WC request).
    var p = plugin();
    try { if (p && p.addListener) p.addListener("tokenRequested", function () { publish(); }); }
    catch (e) {}

    publish();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
