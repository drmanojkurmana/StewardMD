/* StewardMD global haptics (haptics.js) -> window.SMD_HAPTICS. Additive, self-contained.
 *
 * Fires tactile feedback on every interactive tap across the app via one capture-phase
 * pointerdown listener (snappy, fires on press). Smart intensity: light tap for normal
 * taps/nav, medium for primary actions, a selection tick for toggles/switches/segmented.
 * Outcome haptics (success / warning / error) are fired by the code that owns the outcome
 * (record committed, safety alert rendered, validation failed), not inferred from toast text.
 *
 * iOS: @capacitor/haptics (taptic engine). Android: Capacitor.Plugins.SmdDevice.haptic({type}),
 * which uses the system's own tuned haptic constants. Nothing else: no web fallback.
 * Preference: localStorage "smd_haptics" (default ON). ?haptics=0 disables, ?haptics=1 forces.
 * Throttled ~45ms so rapid taps never stack or drain battery. */
(function () {
  "use strict";

  var Cap = window.Capacitor;
  function isNative() { try { return !!(Cap && (typeof Cap.isNativePlatform === "function" ? Cap.isNativePlatform() : Cap.isNative)); } catch (e) { return false; } }
  function platform() { try { return (typeof Cap.getPlatform === "function" ? Cap.getPlatform() : (Cap && Cap.platform)) || "web"; } catch (e) { return "web"; } }
  // Owner decision 2026-10-03 (supersedes the earlier iOS-only rule): Android gets haptics too, but
  // ONLY through the system's tuned haptics via the native SmdDevice plugin, never raw vibration,
  // because a bare motor buzz feels cheap next to the taptic engine. Web and every other platform are
  // a hard no-op. navigator.vibrate is intentionally NOT used.
  function iosNative() { return isNative() && platform() === "ios"; }
  function androidNative() { return isNative() && platform() === "android"; }
  function active() { return iosNative() || androidNative(); }

  var _p, _a; // cached plugin refs once FOUND. Absent is re-checked every call: caching null on the
  // first early call (before the bridge proxied the plugin) made every later tap silent. The Android
  // SmdDevice plugin can appear late the same way, so it is looked up per call until found.
  function plugin() {
    if (_p) return _p;
    if (!iosNative()) return null;
    var C = window.Capacitor, P = C && C.Plugins && C.Plugins.Haptics;
    if (!P && C && typeof C.registerPlugin === "function") { try { P = C.registerPlugin("Haptics"); } catch (e) { P = null; } }
    if (P && (P.impact || P.notification)) _p = P;
    return P || null;
  }
  function androidPlugin() {
    if (_a) return _a;
    if (!androidNative()) return null;
    var C = window.Capacitor, P = C && C.Plugins && C.Plugins.SmdDevice;
    if (P && typeof P.haptic === "function") _a = P;
    return _a || null;
  }
  // type: tap|light|medium|heavy|selection|success|warning|error. Resolves {performed:boolean}; ignored.
  function android(type) {
    var p = androidPlugin();
    if (!p) return;
    try { var r = p.haptic({ type: type }); if (r && r.catch) r.catch(function () {}); } catch (e) {}
  }

  function enabled() {
    try {
      var q = (location.search.match(/[?&]haptics=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on";
      var v = localStorage.getItem("smd_haptics");
      return v !== "0" && v !== "false";   // DEFAULT ON
    } catch (e) { return true; }
  }

  // throttle (avoid stacking on fast repeated taps)
  var _last = 0;
  function nowMs() { try { return (window.performance && performance.now) ? performance.now() : Date.now(); } catch (e) { return Date.now(); } }
  function gate() { var t = nowMs(); if (t - _last < 45) return false; _last = t; return true; }

  var IMPACT = { light: "LIGHT", medium: "MEDIUM", heavy: "HEAVY" };
  var NOTIF = { success: "SUCCESS", warning: "WARNING", error: "ERROR" };

  // `name` is the platform-neutral type the Android plugin takes.
  function impact(style, name) {
    if (!enabled() || !active() || !gate()) return;
    if (androidNative()) return android(name);
    var p = plugin();
    if (p && p.impact) { try { p.impact({ style: style }); } catch (e) {} }
  }
  function notify(type, name) {
    if (!enabled() || !active() || !gate()) return;
    if (androidNative()) return android(name);
    var p = plugin();
    if (p && p.notification) { try { p.notification({ type: type }); } catch (e) {} }
  }
  function selection() {
    if (!enabled() || !active() || !gate()) return;
    if (androidNative()) return android("selection");
    var p = plugin();
    if (p && p.selectionStart) {
      try { p.selectionStart(); if (p.selectionChanged) p.selectionChanged(); if (p.selectionEnd) p.selectionEnd(); return; } catch (e) {}
    }
    if (p && p.impact) { try { p.impact({ style: IMPACT.light }); } catch (e) {} }   // fallback: light tick
  }

  // ---- public API -------------------------------------------------------------------------
  window.SMD_HAPTICS = {
    tap: function () { impact(IMPACT.light, "tap"); },
    light: function () { impact(IMPACT.light, "light"); },
    medium: function () { impact(IMPACT.medium, "medium"); },
    heavy: function () { impact(IMPACT.heavy, "heavy"); },
    selection: selection,
    success: function () { notify(NOTIF.success, "success"); },
    warning: function () { notify(NOTIF.warning, "warning"); },
    error: function () { notify(NOTIF.error, "error"); },
    enabled: enabled,
    setEnabled: function (on) { try { localStorage.setItem("smd_haptics", on ? "1" : "0"); } catch (e) {} },
    supported: function () { return !!(plugin() || androidPlugin()); }   // true only on iOS / Android native with its plugin
  };

  // ---- auto-wire: classify every interactive tap ------------------------------------------
  // Broad "is this interactive" selector for closest(); classification then reads the matched
  // element's own classes/attributes to choose intensity.
  var INTERACTIVE = 'button,a[href],[role="button"],[role="tab"],[role="switch"],' +
    'input[type="checkbox"],input[type="radio"],select,[onclick],[data-act],[data-mi],[data-acct],[data-tgl],[data-t],[data-d],[data-p],[data-th],[data-f],[data-h],[data-cs],[data-m],[data-rid],[data-icu-act],' +
    '.v3-tile,.v4-tile,.rnav-tile,.v3-tab,.rnav-tab,.v3-qc,.v4-qc,.rnav-qc,.rnav-qa-btn,.hv-mi,.sb-main-link,.sb-subitem,.chip,.hv-tg,.smd-nav-sw,.hv-seg button,.hv-th,.hv-fn,.icu-btn,.smdt-b';

  var SELECTION = 'input[type="checkbox"],input[type="radio"],[role="switch"],[role="tab"],[data-tgl],.smd-nav-sw,.hv-tg,.hv-seg button,select';
  var PRIMARY = '.v3-primary,.v4-action.primary,.rnav-qa-btn,.smdt-b.pri,.hv-acct-btn,.ku-signin,[data-act="startcase"],[data-act="signin"],[data-acct="signin"]';

  function fireFor(el) {
    if (!el || !el.matches) return;
    try {
      if (el.matches(SELECTION)) return selection();
      if (el.matches(PRIMARY)) return impact(IMPACT.medium, "medium");
      impact(IMPACT.light, "light");
    } catch (e) { impact(IMPACT.light, "light"); }
  }

  // pointerdown = immediate on-press feedback (feels native); capture so it runs before the
  // app's own handlers and survives stopPropagation.
  document.addEventListener("pointerdown", function (e) {
    if (!active() || !enabled()) return;
    if (e.pointerType === "" && e.button && e.button !== 0) return;   // ignore non-primary mouse
    var t = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (t) fireFor(t);
  }, true);

  // Keyboard activation (Enter/Space) for accessibility parity.
  document.addEventListener("keydown", function (e) {
    if (!active() || !enabled()) return;
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    var t = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (t) fireFor(t);
  }, true);

  // The old toast-text regex buzz is gone: failures are signalled by the code that owns them
  // (SMD_HAPTICS.error()/warning() at the commit, validation and safety-alert points).
})();
