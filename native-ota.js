/* StewardMD — OTA live-update client (Capgo @capgo/capacitor-updater).
 * ---------------------------------------------------------------------------
 * WHY: the native iOS/Android apps bundle the web assets at build time, so a
 * web deploy never reaches an installed app. Capgo lets us push the web bundle
 * (JS/HTML/CSS/KB) over the air — no store release for content changes.
 *
 * Native auto-update is OFF in capacitor.config (autoUpdate:false). "Automatic
 * updates" is driven HERE in JS instead, so the Settings toggle works at runtime
 * (no rebuild) and the user is never surprised by a silent bundle swap. This file:
 *   1. notifyAppReady()  — safety: confirms a healthy boot so Capgo doesn't
 *      auto-roll-back a good bundle (appReadyTimeout).
 *   2. window.SMD_OTA    — API for the Settings ▸ Experimental "Software update"
 *      controls: available / isAuto / setAuto / currentVersion / check / install.
 *   3. Automatic mode    — when the toggle is on, quietly fetch + stage the next
 *      bundle on a settled boot (applied on next launch — non-disruptive).
 *
 * WEB build (stewardmd.in) or any build without the plugin: SMD_OTA exists but
 * available() === false, and nothing else runs. Loads after native-bridge.js.
 * --------------------------------------------------------------------------- */
(function () {
  "use strict";
  var C = window.Capacitor;
  var Updater = C && C.Plugins && C.Plugins.CapacitorUpdater;
  var NATIVE = !!window.SMD_IS_NATIVE;
  var HAVE = NATIVE && Updater && typeof Updater.notifyAppReady === "function" && typeof Updater.getLatest === "function";
  var CUR = {};                                            // current bundle info {version,id,...}

  function isAuto() { try { return localStorage.getItem("smd_ota_auto") !== "0"; } catch (e) { return true; } }
  function setAuto(v) { try { localStorage.setItem("smd_ota_auto", v ? "1" : "0"); } catch (e) {} }
  function refreshCur() {
    if (!HAVE) return Promise.resolve(CUR);
    try { return Updater.current().then(function (c) { CUR = (c && c.bundle) || CUR; return CUR; }, function () { return CUR; }); }
    catch (e) { return Promise.resolve(CUR); }
  }
  function isNewer(v) { return !!v && v !== "builtin" && v !== (CUR.version || ""); }

  window.SMD_OTA = {
    available: function () { return HAVE; },
    isAuto: isAuto,
    setAuto: setAuto,
    currentVersion: function () { return CUR.version || ""; },

    // Ask the server for the latest bundle. Resolves {status:'available'|'uptodate'|'error', ...}.
    check: function () {
      if (!HAVE) return Promise.resolve({ status: "error", error: "not available" });
      return refreshCur().then(function () { return Updater.getLatest(); }).then(function (r) {
        r = r || {};
        if (r.error) return { status: "error", error: r.error, current: CUR.version || "" };
        if (r.url && isNewer(r.version)) return { status: "available", version: r.version, url: r.url, checksum: r.checksum, sessionKey: r.sessionKey, current: CUR.version || "" };
        return { status: "uptodate", current: CUR.version || "" };
      }, function (e) { return { status: "error", error: String((e && e.message) || e) }; });
    },

    // Download the given latest ({url,version,...}), activate it, and reload into it now.
    // onProgress(pct 0-100) is optional. Resolves {ok:true} (reload follows) or {ok:false,error}.
    install: function (latest, onProgress) {
      if (!HAVE || !latest || !latest.url) return Promise.resolve({ ok: false, error: "no update" });
      var h;
      try { if (onProgress && Updater.addListener) h = Updater.addListener("download", function (s) { try { onProgress(Math.max(0, Math.min(100, Math.round((s && s.percent) || 0)))); } catch (e) {} }); } catch (e) {}
      function off() { try { if (h && h.remove) h.remove(); } catch (e) {} }
      return Updater.download({ url: latest.url, version: latest.version, checksum: latest.checksum, sessionKey: latest.sessionKey }).then(function (b) {
        off();
        if (!b || !b.id) return { ok: false, error: "download failed" };
        return Updater.set({ id: b.id }).then(function () {
          setTimeout(function () { try { Updater.reload(); } catch (e) { try { location.reload(); } catch (e2) {} } }, 400);
          return { ok: true, version: latest.version };
        });
      }, function (e) { off(); return { ok: false, error: String((e && e.message) || e) }; });
    }
  };

  if (!HAVE) return;                                       // web / no-plugin: SMD_OTA present, available()=false

  // Safety: confirm a healthy boot as soon as the document is interactive.
  function ready() { try { Updater.notifyAppReady(); } catch (e) {} }
  if (document.readyState === "interactive" || document.readyState === "complete") ready();
  else document.addEventListener("DOMContentLoaded", ready);

  refreshCur();                                            // prime current-bundle info for the UI

  // Automatic updates (JS-driven; native autoUpdate is off). On a settled boot, quietly fetch +
  // stage the next bundle — applied on the NEXT launch so we never reload mid-use.
  if (isAuto()) {
    setTimeout(function () {
      refreshCur().then(function () { return Updater.getLatest(); }).then(function (r) {
        r = r || {};
        if (r.error || !r.url || !isNewer(r.version)) return;
        Updater.download({ url: r.url, version: r.version, checksum: r.checksum, sessionKey: r.sessionKey }).then(function (b) {
          if (b && b.id) { try { Updater.next({ id: b.id }); } catch (e) {} try { if (typeof window.toast === "function") window.toast("Update downloaded — reopen the app to apply"); } catch (e) {} }
        }, function () {});
      }, function () {});
    }, 5000);
  }
})();
