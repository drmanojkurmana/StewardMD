/* client-errors.js — fleet crash/error telemetry. Captures uncaught errors + unhandled promise
 * rejections and POSTs METADATA ONLY (message, stack, scrubbed path, build, platform) to /api/clientlog,
 * so silent crashes across 1000+ devices become visible in the admin console. Loaded FIRST (before the
 * app) so it can catch early failures. Sends NO PHI: never the DOM, app state, query strings, or ids. */
(function () {
  "use strict";
  var MAX_PER_SESSION = 25;
  var sent = 0, lastSig = "", lastAt = 0, posting = false;

  function build() {
    try { var s = document.querySelector('script[src*="app.js"]'); return (s && (s.getAttribute("src") || "").replace(/^.*\?v=/, "")) || ""; } catch (e) { return ""; }
  }
  function platform() {
    try { var C = window.Capacitor; return (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) || "web"; } catch (e) { return "web"; }
  }
  function uidHash() {
    try { return (window.SMD_UID_HASH || "").slice(0, 24); } catch (e) { return ""; }
  }
  function post(rec) {
    try {
      var sig = (rec.message || "") + "|" + (rec.stack || "").slice(0, 80);
      var t = Date.now();
      if (sig === lastSig && (t - lastAt) < 5000) return;
      lastSig = sig; lastAt = t;
      if (sent >= MAX_PER_SESSION) return; sent++;
      rec.build = build(); rec.platform = platform(); rec.ua = (navigator.userAgent || "").slice(0, 200); rec.uidHash = uidHash();
      fetch("/api/clientlog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec), keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  window.addEventListener("error", function (e) {
    if (posting) return;
    posting = true;
    try {
      var err = e && e.error;
      post({
        level: "error",
        message: String((e && e.message) || (err && err.message) || "error"),
        stack: (err && err.stack) ? String(err.stack) : ((e && e.filename) ? (e.filename + ":" + e.lineno + ":" + e.colno) : ""),
        url: (location && location.pathname) || "",
      });
    } catch (x) {} finally { posting = false; }
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    try {
      var r = e && e.reason;
      post({
        level: "unhandledrejection",
        message: String((r && r.message) || r || "unhandled rejection"),
        stack: (r && r.stack) ? String(r.stack) : "",
        url: (location && location.pathname) || "",
      });
    } catch (x) {}
  });

  window.SMD_logError = function (message, stack) { post({ level: "warn", message: String(message || ""), stack: String(stack || ""), url: (location && location.pathname) || "" }); };
  window.SMD_track = function (event) {
    try { fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: String(event || "") }), keepalive: true }).catch(function () {}); } catch (e) {}
  };

  /* Connect Agent launcher.
     This is intentionally additive: it loads the existing read-only Connect Agent console and
     exposes one clearly labelled in-app entry point. The button never collects credentials and
     never enables production write access. */
  function loadConnectAgent() {
    if (window.SMD_CONNECT_AGENT) return Promise.resolve(window.SMD_CONNECT_AGENT);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/connect-agent-ui.js?v=connect-ui1";
      s.async = true;
      s.onload = function () { window.SMD_CONNECT_AGENT ? resolve(window.SMD_CONNECT_AGENT) : reject(new Error("Connect Agent UI did not initialize")); };
      s.onerror = function () { reject(new Error("Connect Agent UI failed to load")); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function installConnectButton() {
    try {
      if (document.getElementById("smd-connect-agent-launch")) return;
      var b = document.createElement("button");
      b.id = "smd-connect-agent-launch";
      b.type = "button";
      b.setAttribute("aria-label", "Connect Hospital — test mode");
      b.title = "Connect Hospital — read-only test mode";
      b.textContent = "Connect Hospital";
      b.style.cssText = [
        "position:fixed","right:max(14px,env(safe-area-inset-right))","bottom:max(14px,env(safe-area-inset-bottom))","z-index:49",
        "border:1px solid var(--teal,#0e6e63)","border-radius:999px","padding:10px 14px","background:var(--teal,#0e6e63)",
        "color:#fff","font:800 12px var(--sans,system-ui)","box-shadow:0 8px 24px rgba(0,0,0,.16)","cursor:pointer"
      ].join(";");
      b.addEventListener("click", function () {
        b.disabled = true;
        loadConnectAgent().then(function (ui) {
          if (ui && ui.open) ui.open();
        }).catch(function (e) {
          try { if (window.toast) window.toast("Connect Agent UI unavailable: " + (e.message || "load failed")); } catch (x) {}
        }).finally(function () { b.disabled = false; });
      });
      document.body.appendChild(b);
    } catch (e) {}
  }

  try {
    window.addEventListener("load", function () {
      window.SMD_track("app_open");
      setTimeout(installConnectButton, 1200);
    });
  } catch (e) {}
})();
