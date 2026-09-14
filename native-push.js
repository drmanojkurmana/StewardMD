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

  // Route a notification's url. A background lab-watch alert deep-links to /?ghisRef=<ref>;
  // when Ward Sync is loaded, open that patient in-place (no reload). Otherwise navigate — the
  // ghis-ward deep-link handler opens it on load (covers cold-start taps).
  // `ref` is opaque (see functions/api/watch/[[path]].js), never the real patientId, so it must be
  // resolved through SMD_WATCH.resolveRef() (the doctor's own authenticated session) first.
  function routeUrl(url) {
    try {
      var m = url && String(url).match(/[?&]ghisRef=([^&]+)/);
      if (m && m[1] && window.GHIS && window.GHIS.openPatientById && window.SMD_WATCH && window.SMD_WATCH.resolveRef) {
        var ref = decodeURIComponent(m[1]);
        window.SMD_WATCH.resolveRef(ref).then(function (pid) { if (pid) window.GHIS.openPatientById(pid); });
        return;
      }
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
  // Per-category notification opt-ins (tasks / critical / labs / guidelines / general), set via
  // Notification preferences. The push server gates fan-out on these; safety categories are already
  // forced ON for JR/interns when saved. Missing = default all-on.
  function categories() { try { var a = JSON.parse(localStorage.getItem("smd_notif_prefs") || "null"); if (a && a.categories && typeof a.categories === "object") return a.categories; } catch (e) {} return { tasks: true, critical: true, labs: true, guidelines: true, general: true }; }

  /* Device identity, sent at registration for IDENTIFICATION ONLY.
   *
   * It changes nothing about who receives a push: an account-scoped alert still goes to every
   * active token. It exists because the token store had no way to tell one handset from another -
   * six iOS registrations on one account looked identical to six different iPhones, so none could
   * be safely pruned and none could be named in a UI.
   *
   * installId is generated once and kept in localStorage, so it survives app updates and does NOT
   * survive a reinstall. That is the correct granularity: a reinstall mints a new APNs token, so a
   * new identity for it is honest rather than lossy.
   *
   * No plugin is added for this. iOS does not expose the device name or the real model to a
   * WebView, so `model` is a best-effort read of the user agent and is labelled as such rather than
   * being presented as authoritative. */
  function installId() {
    try {
      var v = localStorage.getItem("smd_install_id");
      if (!v) {
        v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("smd_install_id", v);
      }
      return v;
    } catch (e) { return null; }
  }
  function deviceIdentity() {
    var ua = "";
    try { ua = navigator.userAgent || ""; } catch (e) {}
    var os = null;
    try {
      var m = ua.match(/OS (\d+[_.]\d+(?:[_.]\d+)?) like Mac OS X/) || ua.match(/Android (\d+(?:\.\d+)*)/);
      if (m) os = m[1].replace(/_/g, ".");
    } catch (e) {}
    var model = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : null;
    var app = null;
    try { app = (window.SMD_BUILD || (document.querySelector('script[src*="app.js"]') || {}).getAttribute
      && (document.querySelector('script[src*="app.js"]').getAttribute("src") || "").split("?v=")[1]) || null; } catch (e) {}
    var label = null;
    try { label = localStorage.getItem("smd_device_label") || null; } catch (e) {}
    return { installId: installId(), label: label, model: model, osVersion: os, appVersion: app };
  }
  // So the owner can name a handset ("ward round phone") and have it show in the device list.
  window.SMD_setDeviceLabel = function (name) {
    try { localStorage.setItem("smd_device_label", String(name || "").slice(0, 80)); return true; } catch (e) { return false; }
  };

  var _token = null, _wired = false;

  /* ── WardSynQ hospital alerts (S3 P1) ─────────────────────────────────────────────────────────
   * A hospital's critical-result ladder reaches this phone only once the phone is bound to the
   * clinician's identity AT THAT HOSPITAL (POST /api/push/register-member). Bound when a WardSynQ
   * hospital is chosen or a staff session signs in, re-bound when the device token changes, unbound
   * (POST /api/push/unregister-member) when a staff session signs out. Each request carries that
   * hospital's own credential (hospital-auth.js), never whichever token happens to be stored.
   * localStorage smd_wsq_push_orgs = { orgId: tail of the token it was bound with, "" = pending }.
   * Inert unless smd_wsq_push is on. */
  var LS_WSQ = "smd_wsq_push_orgs";
  function wsqOn() { try { return !!(window.SMD_WARDSYNQ_FLAGS && SMD_WARDSYNQ_FLAGS.get("smd_wsq_push")); } catch (e) { return false; } }
  function wsqBound() { try { var o = JSON.parse(localStorage.getItem(LS_WSQ) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function wsqSave(o) { try { localStorage.setItem(LS_WSQ, JSON.stringify(o)); } catch (e) {} }
  function wsqToast(msg) { try { if (window.toast) window.toast(msg); else if (window.SMD_toast) window.SMD_toast(msg); } catch (e) {} }
  var NOT_REMOVED = "This phone may still receive this hospital's alerts. Ask the hospital admin to reset your access.";
  // -> Promise<{ok, status, error}>. The credential is read synchronously, before a caller signs out.
  function memberCall(route, orgId) {
    var HA = window.SMD_HOSPITAL_AUTH;
    if (!HA) return Promise.resolve({ ok: false, status: 0, error: "auth_module_missing" });
    var body = JSON.stringify({ orgId: orgId, token: _token, platform: platform(), device: deviceIdentity() });
    return HA.headersFor(orgId, idToken).then(function (h) {
      return fetch(api("/api/push/" + route), { method: "POST", headers: h, body: body });
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok && !!(j && j.ok), status: r.status, error: j && j.error }; }, function () { return { ok: false, status: r.status }; });
    }, function () { return { ok: false, status: 0, error: "network" }; });
  }
  function wsqBind(orgId, explicit) {
    if (!wsqOn() || !orgId) return Promise.resolve({ ok: false, error: "off" });
    var b = wsqBound();
    if (!_token) {
      if (b[orgId] === undefined) { b[orgId] = ""; wsqSave(b); }
      // The registration listener binds it once the device token arrives.
      return window.SMD_enableNativePush().then(function (on) {
        if (!on && explicit) wsqToast("Turn on notifications for StewardMD to receive this hospital's critical-result alerts.");
        return { ok: false, error: on ? "pending" : "notifications_off" };
      });
    }
    var tail = _token.slice(-12);
    if (b[orgId] === tail) return Promise.resolve({ ok: true, unchanged: true });
    return memberCall("register-member", orgId).then(function (r) {
      var c = wsqBound();
      // A refusal (not a member, no chart access) is not retried on later launches; anything else is.
      if (r.ok) c[orgId] = tail; else if (r.status === 403 || r.status === 404) delete c[orgId]; else if (c[orgId] === undefined) c[orgId] = "";
      wsqSave(c);
      if (!r.ok && explicit) wsqToast("This phone could not be registered for this hospital's critical-result alerts. Choose the hospital again to retry.");
      return r;
    });
  }
  function wsqUnbind(orgId) {
    var b = wsqBound();
    if (!orgId || b[orgId] === undefined) return Promise.resolve({ ok: true, unchanged: true });
    delete b[orgId]; wsqSave(b);
    if (!_token) { wsqToast(NOT_REMOVED); return Promise.resolve({ ok: false, error: "no_token" }); }
    return memberCall("unregister-member", orgId).then(function (r) { if (!r.ok) wsqToast(NOT_REMOVED); return r; });
  }
  // Every hospital this phone should be bound to: the ones it was bound for, and the one it works in now.
  function wsqRebindAll() {
    if (!wsqOn()) return;
    var b = wsqBound(), cur = window.SMD_HOSPITAL_AUTH ? SMD_HOSPITAL_AUTH.currentOrg() : "";
    if (cur && b[cur] === undefined) b[cur] = "";
    Object.keys(b).forEach(function (orgId) { wsqBind(orgId, false); });
  }
  window.SMD_WSQ_PUSH = { bind: wsqBind, unbind: wsqUnbind, bound: wsqBound };

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
          body: JSON.stringify({ token: _token, platform: platform(), workspaces: workspaces(), categories: categories(), device: deviceIdentity() })
        });
      }).then(function () { flag("1"); }).catch(function () {});
      wsqRebindAll();
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
        // A WardSynQ alert arriving while the app is OPEN: receipt it first (the escalation timer
        // depends on that fact), then straight to the alert screen rather than a banner behind
        // whatever is on screen. With smd_wsq_push off the screen declines and the thin text shows.
        if (d.type === "wardsynq-alert" && window.SMD_WSQ_ALERT) {
          window.SMD_WSQ_ALERT.delivered(d);
          if (window.SMD_WSQ_ALERT.handle(d)) return;
        }
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
        // A tap is evidence the alert reached this handset AND that a person opened it. Both are
        // recorded; neither is an acknowledgement, which stays an explicit act in the alert UI.
        // The alert screen posts `viewed` itself once the detail is on screen; opening it is the
        // whole purpose of the tap. It fetches nothing until app lock is passed.
        if (data && data.type === "wardsynq-alert" && window.SMD_WSQ_ALERT) {
          window.SMD_WSQ_ALERT.delivered(data);
          if (window.SMD_WSQ_ALERT.handle(data)) return;
        }
        // FollowCare push → deep-link straight to that patient's recovery detail in-app (covers cold-launch).
        if (data && data.type === "followcare" && data.episodeId && window.FollowCare && window.FollowCare.openDetail) {
          try { window.FollowCare.openDetail(data.episodeId); return; } catch (e) {}
        }
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
          // Defer to idle: registering at the instant of sign-in piles onto the fan-out that starves the
          // JS thread AI needs (see ku.js). Push registration is not time-critical.
          if (window.SMD_nativePushOn()) { (window.requestIdleCallback || function (f) { return setTimeout(f, 2500); })(function () { try { plugin().register(); } catch (e) {} }, { timeout: 8000 }); }
        });
        return;
      }
    } catch (e) {}
    if ((tries || 0) < 40) setTimeout(function () { attachAuth((tries || 0) + 1); }, 500);
  })(0);
})();
