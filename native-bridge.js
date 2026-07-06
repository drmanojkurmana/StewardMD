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

  // Dump every same-origin stylesheet rule so an exported page looks like the app.
  function collectCss() {
    var css = "";
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var s = document.styleSheets[i];
        try { var r = s.cssRules; for (var j = 0; j < r.length; j++) css += r[j].cssText + "\n"; } catch (e) {}
      }
    } catch (e) {}
    return css;
  }
  // Wrap an HTML fragment into a standalone, print/PDF-friendly light-theme document.
  function buildHtmlDoc(fragment, title) {
    var t = String(title || "StewardMD — Clinical decision");
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + t.replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }) + '</title>' +
      '<style>' + collectCss() +
      // force a clean printable light page regardless of the app's dark theme
      ':root{color-scheme:light}html,body{background:#fff!important;color:#111!important}' +
      'body{margin:0;padding:20px;max-width:820px;margin-left:auto;margin-right:auto;font:15px/1.6 -apple-system,system-ui,sans-serif}' +
      '#smdCaseShare,.cs-row,.smd-caseprint-hide{display:none!important}' +
      '@page{margin:12mm}' +
      '</style></head><body>' + String(fragment == null ? "" : fragment) + '</body></html>';
  }

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
    // Export an HTML fragment as a fully-styled, self-contained page FILE and open the
    // iOS share sheet ON THE FILE — which offers "Print" (→ pinch → Save as PDF),
    // "Save to Files", Books, Markup, Mail. This gives the whole expanded decision as a
    // real document (not plain text). Uses @capacitor/filesystem + @capacitor/share
    // (both first-party). Falls back to a stripped-text share if either is missing.
    saveHtmlFile: function (fragmentHtml, title, filename) {
      var self = this;
      var P = plugins();
      var frag = String(fragmentHtml == null ? "" : fragmentHtml);
      if (!(P && P.Filesystem && P.Filesystem.writeFile && P.Filesystem.getUri && P.Share && P.Share.share)) {
        return self.share({ title: title || "StewardMD", text: frag.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), dialogTitle: title || "Save or share" });
      }
      var name = (filename || "StewardMD-clinical-decision").replace(/[^\w.-]+/g, "-") + ".html";
      var doc = buildHtmlDoc(frag, title);
      return P.Filesystem.writeFile({ path: name, data: doc, directory: "CACHE", encoding: "utf8" })
        .then(function () { return P.Filesystem.getUri({ path: name, directory: "CACHE" }); })
        .then(function (r) { return P.Share.share({ title: title || "StewardMD", files: [r.uri], dialogTitle: "Save as PDF / Print / Share" }); });
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
    },
    // Native document/file picker (PDF OR image) for "Upload PDF/file". @capacitor/camera
    // is images-only, so this uses @capawesome/capacitor-file-picker. Returns a Blob with
    // .type set so the existing handleImportFile() PDF(pdf.js)/image pipeline consumes it.
    pickFile: function (opts) {
      var P = plugins();
      var FP = P && P.FilePicker;
      if (!(FP && FP.pickFiles)) return Promise.reject(new Error("filepicker-unavailable"));
      var types = (opts && opts.types) || ["application/pdf", "image/*"];
      return FP.pickFiles({ types: types, readData: true, limit: 1 }).then(function (res) {
        var f = res && res.files && res.files[0];
        if (!f || !f.data) throw new Error("no-file");
        var mime = f.mimeType || (/\.pdf$/i.test(f.name || "") ? "application/pdf" : "application/octet-stream");
        var bin = atob(f.data), n = bin.length, bytes = new Uint8Array(n);
        for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
        var blob = new Blob([bytes], { type: mime });
        try { blob.name = f.name || "upload"; } catch (e) {}
        return blob;
      });
    },
    // On-device OCR via ML Kit text recognition. The IMAGE NEVER LEAVES THE DEVICE —
    // only recognized text is returned to JS. Resolves { text, lines:[string] }.
    ocr: function (dataUrl) {
      var P = plugins();
      var TR = P && P.VisionOcr;   // local Apple Vision plugin (@stewardmd/capacitor-vision-ocr)
      if (!(TR && TR.detectText)) return Promise.reject(new Error("ocr-unavailable"));
      var b64 = String(dataUrl || "").replace(/^data:[^;]+;base64,/, "");
      if (!b64) return Promise.reject(new Error("no-image"));
      return TR.detectText({ base64Image: b64 }).then(function (res) {
        var lines = [];
        try { (res.blocks || []).forEach(function (bl) { (bl.lines || []).forEach(function (ln) { if (ln && ln.text) lines.push(String(ln.text)); }); }); } catch (e) {}
        if (!lines.length && res && res.text) lines = String(res.text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        return { text: (res && res.text) || lines.join("\n"), lines: lines };
      });
    }
  };

  // ---- Native nav hardening: when a syndrome is opened from the Knowledge-Library
  // list (SB.openSyn) and the user then closes the stewardship console, return STRAIGHT
  // to the home shell — never strand them on a lurking Clinical Reasoning overlay.
  // Only the LIST-opened path is forced home; the reasoning→stewardship path is left
  // untouched so "Select diagnosis → back" still returns to the differential. ----
  (function hardenSyndromeNav() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      try {
        if (window.SB && typeof SB.openSyn === "function" && !SB.__smdListWrap) {
          SB.__smdListWrap = true;
          var _os = SB.openSyn.bind(SB);
          SB.openSyn = function () { try { window.__smdAspFromList = true; } catch (e) {} return _os.apply(SB, arguments); };
        }
        if (window.ASP && typeof ASP.close === "function" && !ASP.__smdCloseWrap) {
          ASP.__smdCloseWrap = true;
          var _ac = ASP.close.bind(ASP);
          ASP.close = function () {
            var r; try { r = _ac.apply(ASP, arguments); } catch (e) {}
            if (window.__smdAspFromList) {
              window.__smdAspFromList = false;
              try { var dx = document.querySelector(".dx-overlay.on"); if (dx && window.DX && DX.close) DX.close(); } catch (e) {}
              try { if (window.SMD_setUI) SMD_setUI(true); } catch (e) {}
            }
            return r;
          };
        }
      } catch (e) {}
      if (window.SB && SB.__smdListWrap && window.ASP && ASP.__smdCloseWrap) clearInterval(iv);
      if (tries > 80) clearInterval(iv);
    }, 200);
  })();

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

  // Splash: launchAutoHide is false (see capacitor.config.json). The 35 app scripts
  // are `defer`, so the WebView does not paint the app's own boot splash until they
  // all execute — hiding the native splash before that shows a BLACK unpainted WebView.
  // The KB (~4.8MB) is now lazy-loaded AFTER first paint (see index.html), so the app's
  // own white branded loading splash (#smdBootSplash — logo + wordmark + progress + MaiK)
  // paints quickly. We hand off to it by hiding the native splash as soon as that white
  // splash has painted (DOMContentLoaded + double rAF), so the user sees the branded white
  // splash — not a lingering navy native splash. Backgrounds are white (capacitor.config)
  // so any sub-frame gap is white, not black/navy. 'load' + a timeout are backstops so the
  // native splash can never get stuck even if the app scripts throw.
  var _splashHidden = false;
  function hideNativeSplash() {
    if (_splashHidden) return;
    _splashHidden = true;
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.SplashScreen) P.SplashScreen.hide();
    } catch (e) { /* no-op */ }
  }
  // Hide the native splash on window 'load' — the only reliable signal that the WebView's
  // content is actually COMPOSITED to screen. (rAF/DOMContentLoaded fire while the WebView
  // still paints behind the native splash, so hiding then reveals an un-composited black
  // frame.) The native splash is now a WHITE branded splash (white bg + StewardMD logo — see
  // Splash.imageset + LaunchScreen.storyboard), so the user sees white-branded → the white
  // #smdBootSplash (logo + progress + MaiK) → home, with no black/navy flash. The KB is
  // lazy-loaded after first paint, so 'load' now fires quickly. Timeout is a hard backstop.
  window.addEventListener("load", hideNativeSplash);
  setTimeout(hideNativeSplash, 8000);

  function absolutize(u) {
    // Only rewrite root-relative API paths; leave everything else (assets, absolute URLs) as-is.
    return (typeof u === "string" && u.charAt(0) === "/" && u.lastIndexOf("/api/", 0) === 0)
      ? API_ORIGIN + u : u;
  }

  // ---- Native /api transport. CapacitorHttp's fetch AUTO-patch proved unreliable here
  // (patch-ordering vs. our wrapper) — relative "/api/*" calls leaked out as browser
  // CROSS-ORIGIN requests to stewardmd.in and died on the CORS preflight (the server
  // sends no CORS headers) → "Server not reachable" for GHIS login, MaiK AI/web-research,
  // and ICU vision. Fix: for /api/* on native, call the CapacitorHttp plugin EXPLICITLY
  // (a real native request, no CORS) and adapt the result into a fetch Response. Works
  // regardless of the `enabled` flag or patch order. Everything else passes through. ----
  function capHttp() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || window.CapacitorHttp || null;
  }
  function headersToObj(h) {
    var o = {};
    try {
      if (!h) return o;
      if (typeof h.forEach === "function" && !Array.isArray(h)) h.forEach(function (v, k) { o[k] = v; });
      else if (Array.isArray(h)) h.forEach(function (p) { o[p[0]] = p[1]; });
      else for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) o[k] = h[k];
    } catch (e) {}
    return o;
  }
  function nativeApiFetch(url, init) {
    var Http = capHttp();
    if (!Http || !Http.request) return null;          // signal caller to fall back
    init = init || {};
    var headers = headersToObj(init.headers);
    var ct = ""; for (var k in headers) if (k.toLowerCase() === "content-type") ct = String(headers[k]);
    var data = init.body;
    // CapacitorHttp wants string or JSON object on iOS; hand JSON bodies as objects so it encodes them.
    if (typeof data === "string" && /json/i.test(ct)) { try { data = JSON.parse(data); } catch (e) {} }
    return Http.request({
      url: url, method: (init.method || "GET").toUpperCase(),
      headers: headers, data: data, connectTimeout: 30000, readTimeout: 30000
    }).then(function (res) {
      var body = res && res.data;
      if (body != null && typeof body !== "string") { try { body = JSON.stringify(body); } catch (e) { body = String(body); } }
      var rh = headersToObj(res && res.headers), hasCT = false;
      for (var kk in rh) if (kk.toLowerCase() === "content-type") hasCT = true;
      if (!hasCT) rh["Content-Type"] = (res && typeof res.data === "object") ? "application/json" : "text/plain";
      return new Response(body == null ? "" : body, { status: (res && res.status) || 0, headers: rh });
    });
  }
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === "string") ? input : (input && typeof input === "object" ? input.url : null);
        if (typeof url === "string" && url.charAt(0) === "/" && url.lastIndexOf("/api/", 0) === 0) {
          var abs = API_ORIGIN + url;
          var merged = init || (input && typeof input === "object" ? { method: input.method, headers: input.headers } : {});
          var r = nativeApiFetch(abs, merged);
          if (r) return r;                              // native request in flight
          return origFetch(abs, init);                  // fallback: at least absolutized
        }
      } catch (e) { /* fall through */ }
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
