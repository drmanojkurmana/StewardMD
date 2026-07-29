/* StewardMD — Firebase App Check bridge (native attestation → compat JS SDK).  window.SMD_APPCHECK
 *
 * The app runs the Firebase COMPAT JS SDK (v10.12.0, /vendor/firebase) inside a native WebView.
 * Strong App Check attestation — Apple App Attest (iOS 14+) / DeviceCheck (iOS 13) / Play Integrity
 * (Android) — can only be produced NATIVELY, so this module initialises the native
 * @capacitor-firebase/app-check plugin and bridges its token into the JS SDK via a CustomProvider.
 * That way the existing firebase.firestore()/auth() calls in app.js carry a verified App Check token
 * WITHOUT touching the (minified) app.js boot code.
 *
 * FAIL-OPEN by design — on ANY missing piece (non-native platform, plugin absent, app-check compat
 * script not loaded, firebase not yet initialised, native token error) this is a silent no-op and
 * the app behaves EXACTLY as before. It never blocks or delays Firestore/Auth.
 *
 * ENFORCEMENT is a Firebase-console setting, NOT here. Keep Firestore/Auth on **Monitor** until the
 * App Check dashboard shows this shipped build producing verified tokens; only THEN switch to
 * Enforce. Browsers (preview/QA) intentionally skip App Check — the app is mobile-only.
 */
(function () {
  "use strict";

  function isNative() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }
  // Mobile-only: attestation is native. A browser has no App Attest/Play Integrity, so skip (safe
  // under Monitor). If web enforcement is ever wanted, register the web app + a reCAPTCHA provider.
  if (!isNative()) return;

  function plugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAppCheck) || null; }
    catch (e) { return null; }
  }
  function fbReady() {
    return !!(window.firebase && window.firebase.apps && window.firebase.apps.length &&
              window.firebase.appCheck && window.firebase.appCheck.CustomProvider);
  }

  var initStarted = false, activated = false;

  function start() {
    if (initStarted || activated) return true;   // already kicked off / done → stop polling
    var P = plugin();
    if (!P || !fbReady()) return false;           // wait for the plugin + a booted compat SDK
    initStarted = true;
    // Native provider is chosen automatically when no `provider` is passed on native platforms
    // (App Attest / DeviceCheck / Play Integrity). initialize() is async; activate AFTER it resolves
    // so the first getToken() the JS SDK triggers has a live native provider behind it.
    Promise.resolve()
      .then(function () { return P.initialize({ isTokenAutoRefreshEnabled: true }); })
      .then(function () {
        var provider = new window.firebase.appCheck.CustomProvider({
          getToken: function () {
            return P.getToken({ forceRefresh: false }).then(function (r) {
              var exp = (r && r.expiresAt) ? r.expiresAt : (Date.now() + 30 * 60 * 1000);
              if (exp && exp < 1e12) exp = exp * 1000;   // guard: seconds → ms, if ever returned in seconds
              return { token: (r && r.token) || "", expireTimeMillis: exp };
            });
          }
        });
        window.firebase.appCheck().activate(provider, true);
        activated = true;
        try { window.SMD_APPCHECK = { active: true }; } catch (e) {}
        try { console.log("[app-check] active (native attestation bridged to JS SDK)"); } catch (e) {}
      })
      .catch(function (e) {
        // Fail-open: leave Firestore/Auth unverified (Monitor). Never block the app on App Check.
        try { console.warn("[app-check] init skipped:", (e && e.message) || e); } catch (x) {}
      });
    return true;
  }

  // firebase is loaded + booted lazily (see the loader in index.html), so poll briefly until it's up,
  // then kick off native init once. Bounded (~10s) so we never spin forever; once init has started,
  // the async chain above completes activation on its own regardless of the poll loop.
  if (!start()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (start() || ++tries > 200) { try { clearInterval(iv); } catch (e) {} }
    }, 50);
  }
})();
