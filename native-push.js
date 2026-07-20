/* StewardMD — native push notifications (Capacitor).
 * ---------------------------------------------------------------------------
 * Web Push does NOT work inside the iOS Capacitor WebView, so the native apps
 * use @capacitor/push-notifications (APNs on iOS, FCM on Android). This module
 * registers the device, sends its token to /api/push/register-native, and routes
 * taps. On the WEB build (`native` false) it is a NO-OP — web push in home.js
 * continues to handle browsers/PWAs.
 *
 * Loads after native-bridge.js (so /api/* is rewritten to the live host) and
 * after app.js (so Firebase auth/uid is available). No hard dependencies.
 *
 * Public API:
 *   window.SMD_NATIVE_PUSH        true when native push is available on this device
 *   window.SMD_enableNativePush() request permission + register  → Promise<bool granted>
 *   window.SMD_disableNativePush() forget this device's token on the server
 *   window.SMD_nativePushOn()     best-effort "is it on" (local flag)
 */
(function () {
  "use strict";
  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")));

  // Route a notification's url. A background lab-watch alert deep-links to /?ghisPatient=<id>;
  // when Ward Sync is loaded, open that patient in-place (no reload). Otherwise navigate — the
  // ghis-ward deep-link handler opens it on load (covers cold-start taps).
  function routeUrl(url) {
    try {
      var m = url && String(url).match(/[?&]ghisPatient=([^&]+)/);
      if (m && m[1] && window.GHIS && window.GHIS.openPatientById) { window.GHIS.openPatientById(decodeURIComponent(m[1])); return; }
    } catch (e) {}
    // Medical Update deep link (/?u=<id>): open that guideline's card IN-APP (warm tap);
    // if the app isn't ready yet, fall through to navigate — the on-load handler opens it.
    try {
      var mu = url && String(url).match(/[?&]u=([^&]+)/);
      if (mu && mu[1] && window.SMD_openUpdate) { window.SMD_openUpdate(decodeURIComponent(mu[1])); return; }
    } catch (e) {}
    try { if (url && url !== "/") window.location.href = url; } catch (e) {}
  }

  /* ── Immediate local notification (for the foreground watch-lab poller) ──────
   * The watch-lab feature polls GHIS while the app is active and calls this when a
   * NEW lab is reported for a patient the signed-in doctor is watching. It is the
   * doctor's own device + own GHIS session, so it is inherently account-specific.
   * Native → @capacitor/local-notifications banner; web → Notification / toast.
   * Defined on web too so the shared poller code has one call to make.
   *   window.SMD_localNotify(title, body, url?)  → Promise (best-effort) */
  var _lnId = 1;
  window.SMD_localNotify = async function (title, body, url) {
    try {
      if (native && C.Plugins && C.Plugins.LocalNotifications) {
        var LN = C.Plugins.LocalNotifications;
        try { var p = await LN.checkPermissions(); if (!p || p.display !== "granted") await LN.requestPermissions(); } catch (e) {}
        return LN.schedule({ notifications: [{
          id: (_lnId = (_lnId % 2147483000) + 1),
          title: title || "StewardMD", body: body || "",
          extra: { url: url || "/" }
        }] });
      }
      // web fallback
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        var n = new Notification(title || "StewardMD", { body: body || "", data: { url: url || "/" } });
        n.onclick = function () { try { routeUrl(url); window.focus(); } catch (e) {} };
        return;
      }
      if (window.SMD_toast) window.SMD_toast((title ? title + " — " : "") + (body || ""));
    } catch (e) { try { if (window.SMD_toast) window.SMD_toast(body || title || "New lab"); } catch (x) {} }
  };

  if (!native) return;                       // web: web-push path in home.js handles remote push

  function plugin() { return (C.Plugins && C.Plugins.PushNotifications) || null; }
  if (!plugin()) return;                     // plugin not present in this build
  window.SMD_NATIVE_PUSH = true;

  function platform() { try { return (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform) || "ios"; } catch (e) { return "ios"; } }
  // Firebase ID token → the server verifies it and scopes the device to that account.
  function idToken() {
    try {
      var u = window.SMD_AUTH && SMD_AUTH.currentUser;
      return u && u.getIdToken ? u.getIdToken() : Promise.resolve(null);
    } catch (e) { return Promise.resolve(null); }
  }
  function api(path) { return (window.SMD_API_BASE || "") + path; }
  function flag(v) { try { v == null ? localStorage.removeItem("smd_push_on") : localStorage.setItem("smd_push_on", "1"); } catch (e) {} }
  // Selected specialty workspaces for specialty-aware push (set via Notification preferences).
  function workspaces() { try { var a = JSON.parse(localStorage.getItem("smd_notif_prefs") || "null"); if (a && Array.isArray(a.workspaces) && a.workspaces.length) return a.workspaces; } catch (e) {} return ["internal_medicine"]; }

  var _token = null, _wired = false;

  function wireListeners() {
    if (_wired) return; _wired = true;
    var P = plugin();
    // Device registered with APNs/FCM → we get the token. Store it server-side.
    P.addListener("registration", function (t) {
      _token = t && t.value;
      if (!_token) return;
      idToken().then(function (jwt) {
        var headers = { "Content-Type": "application/json" };
        if (jwt) headers["Authorization"] = "Bearer " + jwt;   // server derives the owning account from this
        return fetch(api("/api/push/register-native"), {
          method: "POST", headers: headers,
          body: JSON.stringify({ token: _token, platform: platform(), workspaces: workspaces() })
        });
      }).then(function () { flag("1"); }).catch(function () {});
    });
    P.addListener("registrationError", function (e) {
      try { console.warn("[StewardMD] push registration error:", e && (e.error || e)); } catch (x) {}
    });
    // Foreground receipt (OS may not show a banner while the app is open) — surface it in-app.
    P.addListener("pushNotificationReceived", function (n) {
      try {
        // FOREGROUND receipt. Android/FCM does NOT show a tray banner while the app is open
        // (iOS suppresses it too by default) — the OS only auto-displays when backgrounded, and
        // this handler ONLY fires in the foreground. So re-raise it as a LOCAL notification, which
        // manages its own channel — the doctor gets a real banner on Android even with the app open.
        var d = (n && n.data) || {};
        var title = (n && n.title) || d.title || "StewardMD";
        var body = (n && n.body) || d.body || "New update";
        var url = d.url || d.URL || "/";
        if (window.SMD_localNotify) window.SMD_localNotify(title, body, url);
        else if (window.SMD_toast) window.SMD_toast(title + " — " + body);
        if (window.SMD_refreshNotifBadge) window.SMD_refreshNotifBadge();
      } catch (x) {}
    });
    // Tap on a delivered notification → route to its url.
    P.addListener("pushNotificationActionPerformed", function (a) {
      try {
        var data = a && a.notification && a.notification.data;
        var url = (data && (data.url || data.URL)) || "/";
        // Code Blue push → open the native Command Center (also handles cold-launch
        // when the app was force-quit and relaunched by the tap).
        if (url === "codeblue") {
          var cbp = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.WatchBridge;
          if (cbp && cbp.openCodeBlue) { cbp.openCodeBlue().catch(function () {}); return; }
        }
        routeUrl(url);
      } catch (x) {}
    });
  }

  // Request OS permission and register. Resolves true when granted+registering.
  window.SMD_enableNativePush = async function () {
    var P = plugin(); if (!P) return false;
    wireListeners();
    try {
      var perm = await P.checkPermissions();
      if (!perm || perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        perm = await P.requestPermissions();
      }
      if (!perm || perm.receive !== "granted") { flag(null); return false; }
      await P.register();                    // triggers the "registration" listener above
      return true;
    } catch (e) { return false; }
  };

  // Forget this device on the server so it stops receiving pushes.
  window.SMD_disableNativePush = async function () {
    flag(null);
    if (!_token) return true;
    try {
      await fetch(api("/api/push/unregister-native"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: _token })
      });
    } catch (e) {}
    return true;
  };

  window.SMD_nativePushOn = function () { try { return localStorage.getItem("smd_push_on") === "1"; } catch (e) { return false; } };

  // Wire tap/receive listeners on load so a cold-start tap still routes; only
  // request permission when the user opts in via SMD_enableNativePush().
  wireListeners();
  // Route taps on local (watch-lab) notifications to their patient/url.
  try {
    if (C.Plugins && C.Plugins.LocalNotifications) {
      C.Plugins.LocalNotifications.addListener("localNotificationActionPerformed", function (a) {
        try {
          var url = a && a.notification && a.notification.extra && a.notification.extra.url;
          routeUrl(url);
        } catch (x) {}
      });
    }
  } catch (e) {}
  // If the user already enabled it on a previous launch, re-register silently to refresh the token.
  if (window.SMD_nativePushOn()) { try { plugin().register(); } catch (e) {} }

  // Re-register when the signed-in account changes, so the device's token is
  // re-scoped to the current doctor (and un-scoped to guest on sign-out). This is
  // what keeps lab alerts account-specific — only the doctor watching a patient
  // gets that patient's alerts. Attaches once SMD_AUTH is available.
  (function attachAuth(tries) {
    try {
      if (window.SMD_AUTH && SMD_AUTH.onAuthStateChanged) {
        SMD_AUTH.onAuthStateChanged(function () {
          if (window.SMD_nativePushOn()) { try { plugin().register(); } catch (e) {} }
        });
        return;
      }
    } catch (e) {}
    if ((tries || 0) < 40) setTimeout(function () { attachAuth((tries || 0) + 1); }, 500);
  })(0);
})();
