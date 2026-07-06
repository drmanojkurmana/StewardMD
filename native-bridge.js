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

  // ---- Native helpers (native-only; stay UNDEFINED on web because this file
  // early-returns above). Callers gate on window.SMD_IS_NATIVE / window.SMD_NATIVE
  // so the web build is byte-for-byte unchanged. ----
  function plugins() { return (window.Capacitor && window.Capacitor.Plugins) || null; }
  window.SMD_NATIVE = {
    // Route to the iOS share sheet (offers Save to Files / Print / Markup / Mail).
    share: function (opts) {
      var P = plugins();
      if (P && P.Share && P.Share.share) { try { return P.Share.share(opts || {}); } catch (e) {} }
      return Promise.reject(new Error("share-unavailable"));
    },
    // There is NO print plugin on iOS — share the case as text so the share sheet
    // can Save as PDF / Print / Markup. (Plain text; rich HTML export not available.)
    exportPdf: function (text, title) {
      return this.share({ title: title || "StewardMD", text: String(text == null ? "" : text), dialogTitle: title || "Save or share" });
    },
    // Native camera / photo picker → resolves to a data: URL string (rejects on cancel/error).
    // opts.camera → CAMERA; opts.prompt → PROMPT action sheet; else PHOTOS.
    pickImage: function (opts) {
      opts = opts || {};
      var P = plugins();
      if (!(P && P.Camera && P.Camera.getPhoto)) return Promise.reject(new Error("camera-unavailable"));
      var src = opts.camera ? "CAMERA" : (opts.prompt ? "PROMPT" : "PHOTOS");
      return P.Camera.getPhoto({ source: src, resultType: "dataUrl", quality: opts.quality || 80 }).then(function (img) {
        if (img && img.dataUrl) return img.dataUrl;
        if (img && img.base64String) return "data:image/jpeg;base64," + img.base64String;
        throw new Error("no-image");
      });
    }
  };

  // ---- Keyboard guard (native-only safety net): WKWebView pops the iOS keyboard
  // whenever code calls .focus() on a text field with no user intent (e.g. a search
  // box focused right after a screen opens). Blur any text input/textarea that gains
  // focus WITHOUT a real touch on that same field within ~350ms; genuine taps pass
  // through untouched. Covers focus() calls anywhere, including inside minified app.js. ----
  (function () {
    var lastTouchEl = null, lastTouchAt = 0;
    function mark(e) { lastTouchEl = e.target; lastTouchAt = Date.now(); }
    document.addEventListener("touchstart", mark, true);
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("mousedown", mark, true);
    function isText(el) {
      if (!el || !el.tagName) return false;
      if (el.tagName === "TEXTAREA") return true;
      if (el.tagName !== "INPUT") return false;
      var t = (el.getAttribute("type") || "text").toLowerCase();
      return t === "text" || t === "search" || t === "email" || t === "tel" || t === "url" || t === "number" || t === "password" || t === "";
    }
    document.addEventListener("focusin", function (e) {
      var el = e.target;
      if (!isText(el)) return;
      var recent = (Date.now() - lastTouchAt) < 350;
      var onEl = lastTouchEl && (lastTouchEl === el
        || (el.contains && el.contains(lastTouchEl))
        || (lastTouchEl.contains && lastTouchEl.contains(el)));
      if (recent && onEl) return;          // genuine tap on this field → allow keyboard
      try { el.blur(); } catch (x) {}      // programmatic focus → suppress the keyboard
    }, true);
  })();

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
