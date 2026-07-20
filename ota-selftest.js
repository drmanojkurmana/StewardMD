/* TEMPORARY — OTA self-test badge. Safe to delete after verifying OTA delivery.
 * ---------------------------------------------------------------------------
 * On NATIVE builds only, shows a small fixed pill with the LIVE bundle version
 * reported by the updater. This file/script is intentionally NOT in the
 * cap-synced builtin bundle — so if this pill appears in the installed app, it
 * could ONLY have arrived over the air. That is the proof OTA works.
 *   • builtin (installed build): pill absent (script not referenced).
 *   • after an OTA pull:         pill shows "⚡ OTA bundle: <version> · native <n>".
 * Remove the <script> tag in index.html + this file to retire the test. */
(function () {
  "use strict";
  if (!window.SMD_IS_NATIVE) return;                 // web / PWA — nothing to show
  function show(txt) {
    try {
      var el = document.getElementById("smd-ota-selftest");
      if (!el) {
        el = document.createElement("div");
        el.id = "smd-ota-selftest";
        el.style.cssText =
          "position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#0a2320;" +
          "color:#7fe0cf;font:600 11px/1.35 -apple-system,system-ui,sans-serif;" +
          "padding:6px 10px;border-radius:10px;border:1px solid #7fe0cf;" +
          "box-shadow:0 2px 10px rgba(0,0,0,.45);max-width:78vw;pointer-events:none";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = txt;
    } catch (e) {}
  }
  function run() {
    var C = window.Capacitor, U = C && C.Plugins && C.Plugins.CapacitorUpdater;
    if (!U || typeof U.current !== "function") { show("⚡ OTA self-test loaded (updater n/a)"); return; }
    U.current().then(function (r) {
      var v = (r && r.bundle && r.bundle.version) || "builtin";
      var n = (r && r.native) || "?";
      show("⚡ OTA bundle: " + v + " · native " + n);
    }).catch(function () { show("⚡ OTA self-test loaded"); });
  }
  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(run, 800);
  else document.addEventListener("DOMContentLoaded", function () { setTimeout(run, 800); });
})();
