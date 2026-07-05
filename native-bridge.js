/* StewardMD — native (Capacitor) bridge.
 * ---------------------------------------------------------------------------
 * The app is bundled LOCALLY inside the iOS/Android apps, so its origin is
 * https://localhost (Capacitor). Relative "/api/*" calls would resolve to that
 * local origin, which has no backend. Here we rewrite them to the live
 * Cloudflare Functions host. CapacitorHttp (enabled in capacitor.config.json)
 * then proxies the request through native HTTP, bypassing browser CORS.
 *
 * On the WEB build (stewardmd.in) this file is a NO-OP — `native` is false, so
 * fetch is left untouched and same-origin "/api/*" works as before. Safe to load
 * everywhere from the single shared index.html.
 *
 * Loads before app.js. No dependencies.
 */
(function () {
  "use strict";
  var API_ORIGIN = "https://stewardmd.in";
  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function"
    ? C.isNativePlatform()
    : (C.platform && C.platform !== "web")));

  // Expose for any code that wants to build absolute URLs explicitly.
  window.SMD_API_BASE = native ? API_ORIGIN : "";
  window.SMD_IS_NATIVE = native;
  if (!native) return;                       // web: leave everything alone

  // Splash: launchAutoHide is false (see capacitor.config.json), so dismiss the
  // native splash once the web layer is up. 'load' fires even if home.js later
  // throws, so the splash can never get stuck; hiding before the timeout also
  // removes the "automatically hidden after default timeout" advisory.
  window.addEventListener("load", function () {
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.SplashScreen) P.SplashScreen.hide();
    } catch (e) { /* no-op */ }
  });

  function absolutize(u) {
    // Only rewrite root-relative API paths; leave everything else (assets, absolute URLs) as-is.
    return (typeof u === "string" && u.charAt(0) === "/" && u.lastIndexOf("/api/", 0) === 0)
      ? API_ORIGIN + u : u;
  }

  // Wrap whatever fetch is current (CapacitorHttp may have already patched it),
  // rewriting the URL BEFORE it is dispatched natively.
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string") {
          input = absolutize(input);
        } else if (input && typeof input === "object" && typeof input.url === "string") {
          var nu = absolutize(input.url);
          if (nu !== input.url) input = new Request(nu, input);
        }
      } catch (e) { /* fall through with original input */ }
      return origFetch(input, init);
    };
  }

  // Some code paths use XMLHttpRequest (and CapacitorHttp patches XHR too).
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype && window.XMLHttpRequest.prototype.open) {
    var origOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      try { if (typeof url === "string") arguments[1] = absolutize(url); } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  }
})();
