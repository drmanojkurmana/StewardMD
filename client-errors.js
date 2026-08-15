/* client-errors.js — fleet crash/error telemetry. Captures uncaught errors + unhandled promise
 * rejections and POSTs METADATA ONLY (message, stack, scrubbed path, build, platform) to /api/clientlog,
 * so silent crashes across 1000+ devices become visible in the admin console. Loaded FIRST (before the
 * app) so it can catch early failures. Sends NO PHI: never the DOM, app state, query strings, or ids. */
(function () {
  "use strict";
  var MAX_PER_SESSION = 25;      // hard cap so a crash-loop can't hammer the endpoint
  var sent = 0, lastSig = "", lastAt = 0, posting = false;

  function build() {
    try { var s = document.querySelector('script[src*="app.js"]'); return (s && (s.getAttribute("src") || "").replace(/^.*\?v=/, "")) || ""; } catch (e) { return ""; }
  }
  function platform() {
    try { var C = window.Capacitor; return (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) || "web"; } catch (e) { return "web"; }
  }
  function uidHash() {
    // hashed only, never the raw uid/email; best-effort from the last-known hashed id if the app exposes one
    try { return (window.SMD_UID_HASH || "").slice(0, 24); } catch (e) { return ""; }
  }
  function post(rec) {
    try {
      var sig = (rec.message || "") + "|" + (rec.stack || "").slice(0, 80);
      var t = Date.now();
      if (sig === lastSig && (t - lastAt) < 5000) return;   // debounce identical bursts
      lastSig = sig; lastAt = t;
      if (sent >= MAX_PER_SESSION) return; sent++;
      rec.build = build(); rec.platform = platform(); rec.ua = (navigator.userAgent || "").slice(0, 200); rec.uidHash = uidHash();
      // relative /api → native-bridge routes it to stewardmd.in; web hits same-origin. keepalive so it
      // still flushes if the page is tearing down from the crash.
      fetch("/api/clientlog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec), keepalive: true }).catch(function () {});
    } catch (e) { /* the reporter must never throw */ }
  }

  window.addEventListener("error", function (e) {
    if (posting) return;   // guard against reporting an error thrown inside the reporter
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

  // Manual hook the app can call for handled-but-notable failures: window.SMD_logError(message, stack?)
  window.SMD_logError = function (message, stack) { post({ level: "warn", message: String(message || ""), stack: String(stack || ""), url: (location && location.pathname) || "" }); };

  // Privacy-safe product analytics: window.SMD_track("event") counts an ALLOW-LISTED event server-side
  // (server drops anything not on the list). Never pass PHI/free-text. Fire-and-forget.
  window.SMD_track = function (event) {
    try { fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: String(event || "") }), keepalive: true }).catch(function () {}); } catch (e) {}
  };
  // auto app_open once per launch, after deferred scripts (native-bridge routes /api on native by then)
  try { window.addEventListener("load", function () { window.SMD_track("app_open"); }); } catch (e) {}
})();
