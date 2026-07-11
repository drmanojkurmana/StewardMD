/* StewardMD — System appearance sync (light/dark follows the OS).
 * ===========================================================================
 * The core theme logic in app.js reads the OS preference ONCE at first launch
 * (then a stored value wins forever) and never live-updates. This module makes
 * the in-app Light/Dark theme track the device's system appearance:
 *   • on launch, live while open, and on app resume — the app matches the OS;
 *   • the manual theme toggle still works as an OVERRIDE, held until the OS
 *     appearance next changes (then the app snaps back to following the OS).
 *
 * Pure JS / no app.js edit — augments via the same DOM/localStorage seams the
 * core uses (body.dark, #themeKnob, key "stewardmd_theme"). Works on web + the
 * Capacitor WKWebView (which reflects the iOS system appearance via
 * prefers-color-scheme, since nothing forces overrideUserInterfaceStyle).
 *
 * Reversible: set localStorage "stewardmd_theme_autosync"="0" to disable and
 * fall back to the classic stored-preference behavior. Accent themes
 * (html[data-theme=...]) are untouched — this only flips the light/dark axis.
 * ======================================================================== */
(function () {
  "use strict";
  var TK = "stewardmd_theme";                 // "dark" | "light" (applied theme; also read by app.js)
  var SRC = "stewardmd_theme_source";         // "system" | "user"
  var OSAT = "stewardmd_theme_os_at_override"; // "dark" | "light" — OS value captured when user overrode
  var FLAG = "stewardmd_theme_autosync";      // "0" disables (default enabled)

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) {} }

  function enabled() { return lsGet(FLAG) !== "0"; }
  function osDark() { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
  function isDark() { return !!(document.body && document.body.classList.contains("dark")); }

  // Apply a light/dark state exactly like app.js's internal setter (class + knob glyph + storage).
  function applyDark(dark) {
    if (document.body) document.body.classList.toggle("dark", !!dark);
    var knob = document.getElementById("themeKnob");
    if (knob) knob.textContent = dark ? "🌙" : "☀️";
    lsSet(TK, dark ? "dark" : "light");
  }

  // Resume following the OS: apply OS appearance and clear any manual override.
  function followOS() {
    applyDark(osDark());
    lsSet(SRC, "system");
    lsDel(OSAT);
  }

  // One-time migration for users who predate this module: if a divergent manual
  // choice already exists (stored theme != OS), preserve it as a "user" override;
  // otherwise adopt "system" (follow OS).
  function migrateIfNeeded() {
    if (lsGet(SRC) != null) return;
    var stored = lsGet(TK);
    if (stored && (stored === "dark") !== osDark()) {
      lsSet(SRC, "user");
      lsSet(OSAT, osDark() ? "dark" : "light");
    } else {
      lsSet(SRC, "system");
    }
  }

  // Resolve + apply the correct theme for the current OS state.
  function resolve() {
    if (!enabled()) return;                       // classic behavior — leave app.js's result as-is
    migrateIfNeeded();
    var src = lsGet(SRC);
    if (src === "user") {
      var was = lsGet(OSAT);
      if (was && (was === "dark") !== osDark()) {
        followOS();                               // OS changed since the override → OS wins again
      } else {
        applyDark(lsGet(TK) === "dark");          // keep the manual choice (also re-syncs the knob)
      }
    } else {
      applyDark(osDark());                        // system mode → match the OS
    }
  }

  // The user tapped the theme toggle (app.js's own handler has already flipped the
  // class by the time this bubble-phase listener runs). Record it as a manual
  // override, capturing the OS value so a later OS change can supersede it.
  function onToggleClick(ev) {
    if (!enabled()) return;
    var t = ev.target;
    var hit = t && (t.id === "themeToggle" || (t.closest && t.closest("#themeToggle")));
    if (!hit) return;
    lsSet(SRC, "user");
    lsSet(OSAT, osDark() ? "dark" : "light");
  }

  function wire() {
    // Correct the theme now (app.js has run and set an initial value from storage).
    resolve();

    // Live OS appearance changes (also fires inside the WKWebView on iOS toggle).
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () { if (enabled()) followOS(); };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);   // Safari < 14
    }

    // Track manual toggle taps (bubble phase → after app.js's element handler).
    document.addEventListener("click", onToggleClick, false);

    // Native: re-evaluate on resume — an OS appearance change made while the app was
    // backgrounded may not deliver a matchMedia 'change' until foreground.
    try {
      var C = window.Capacitor;
      if (C && C.Plugins && C.Plugins.App && C.Plugins.App.addListener) {
        C.Plugins.App.addListener("appStateChange", function (st) { if (st && st.isActive) resolve(); });
      }
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  // Expose a tiny control surface (parity with other SMD_* modules; handy for support).
  window.SMD_THEME_SYNC = {
    followOS: followOS,
    isEnabled: enabled,
    setEnabled: function (on) { lsSet(FLAG, on ? "1" : "0"); if (on) resolve(); },
    osDark: osDark
  };
})();
