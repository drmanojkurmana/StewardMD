/* wear-bridge.js — phone→watch GHIS-token relay hook (native Android only).
 *
 * Auth is done ON THE WATCH (on-watch Google Sign-In), so the only thing bridged from the phone is the
 * GHIS ward-session token, which lives only here in the web layer. The ward-login flow should call:
 *     window.SMD_WEAR.setGhisToken(token)   // after /api/ghis/login succeeds
 *     window.SMD_WEAR.setGhisToken("")      // on ward logout / session end
 * The native WearBridge plugin relays it to a paired Wear OS watch (SmdWearListenerService).
 *
 * No-op when not native / the plugin is absent (web, iOS, no watch) — safe to load everywhere. */
(function () {
  "use strict";
  function plugin() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.WearBridge) || null;
    } catch (e) { return null; }
  }
  window.SMD_WEAR = {
    setGhisToken: function (token) {
      var p = plugin();
      if (!p || !p.setGhisToken) return;
      try { p.setGhisToken({ token: token || "" }); } catch (e) {}
    }
  };
})();
