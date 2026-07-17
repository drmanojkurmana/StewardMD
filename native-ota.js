/* StewardMD — OTA live-update bootstrap (Capgo @capgo/capacitor-updater).
 * ---------------------------------------------------------------------------
 * WHY: the native iOS/Android apps bundle the web assets at build time, so a
 * web deploy never reaches an installed app. Capgo lets us push the web bundle
 * (JS/HTML/CSS/KB) over the air — no store release for content changes.
 *
 * THIS FILE only does the ONE safety-critical, framework-agnostic step:
 *   CapacitorUpdater.notifyAppReady()  — tells the native layer the freshly
 *   loaded bundle booted OK. If this is NOT called on a launch, Capgo assumes
 *   the update is broken and AUTO-ROLLS-BACK to the previous bundle on the next
 *   launch (appReadyTimeout). Missing it = updates silently revert.
 *
 * WEB build (stewardmd.in) and any build without the plugin: NO-OP. Loads after
 * native-bridge.js (which sets window.SMD_IS_NATIVE). No dependencies.
 *
 * Everything else (plugin install, capacitor.config CapacitorUpdater block,
 * bundle hosting + upload) is set up per docs/ota-setup.md and lives in the
 * native build + Capgo, not here.
 * --------------------------------------------------------------------------- */
(function () {
  "use strict";
  if (!window.SMD_IS_NATIVE) return;                       // web / PWA — nothing to do
  var C = window.Capacitor;
  var Updater = C && C.Plugins && C.Plugins.CapacitorUpdater;
  if (!Updater || typeof Updater.notifyAppReady !== "function") return;  // plugin not in this build yet — safe no-op

  function ready() { try { Updater.notifyAppReady(); } catch (e) {} }
  // Call as soon as the document is interactive so a healthy boot is confirmed
  // well within appReadyTimeout.
  if (document.readyState === "interactive" || document.readyState === "complete") ready();
  else document.addEventListener("DOMContentLoaded", ready);

  // Optional UX: let the clinician know a new bundle is ready (applied on next launch).
  try {
    if (typeof Updater.addListener === "function") {
      Updater.addListener("updateAvailable", function () {
        try { if (typeof window.toast === "function") window.toast("Update ready — reopen the app to apply"); } catch (e) {}
      });
    }
  } catch (e) {}
})();
