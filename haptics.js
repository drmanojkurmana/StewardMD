/* StewardMD global haptics (haptics.js) -> window.SMD_HAPTICS. Additive, self-contained.
 *
 * Fires tactile feedback on every interactive tap across the app via one capture-phase
 * pointerdown listener (snappy, fires on press). Smart intensity: light tap for normal
 * taps/nav, medium for primary actions, a selection tick for toggles/switches/segmented,
 * and a success/warning/error buzz on outcomes (error-like toasts). No edits to any feature
 * internals - it only observes the DOM.
 *
 * Native: @capacitor/haptics (registered on iOS SPM + Android). Web: navigator.vibrate
 * fallback (Android Chrome; iOS Safari has no vibrate, but the native app uses the plugin).
 * Preference: localStorage "smd_haptics" (default ON). ?haptics=0 disables, ?haptics=1 forces.
 * Throttled ~45ms so rapid taps never stack or drain battery. */
(function () {
  "use strict";

  var Cap = window.Capacitor;
  function isNative() { try { return !!(Cap && (typeof Cap.isNativePlatform === "function" ? Cap.isNativePlatform() : Cap.isNative)); } catch (e) { return false; } }

  var _p; // cached plugin ref (undefined=unknown, null=absent)
  function plugin() {
    if (_p !== undefined) return _p;
    _p = (isNative() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) || null;
    return _p;
  }
  function canVibrate() { try { return typeof navigator !== "undefined" && typeof navigator.vibrate === "function"; } catch (e) { return false; } }

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

  function impact(style) {
    if (!enabled() || !gate()) return;
    var p = plugin();
    if (p && p.impact) { try { p.impact({ style: style }); return; } catch (e) {} }
    if (canVibrate()) { try { navigator.vibrate(style === IMPACT.heavy ? 16 : style === IMPACT.medium ? 11 : 7); } catch (e) {} }
  }
  function notify(type) {
    if (!enabled() || !gate()) return;
    var p = plugin();
    if (p && p.notification) { try { p.notification({ type: type }); return; } catch (e) {} }
    if (canVibrate()) { try { navigator.vibrate(type === NOTIF.error ? [10, 45, 10] : type === NOTIF.warning ? [10, 35] : [6, 22]); } catch (e) {} }
  }
  function selection() {
    if (!enabled() || !gate()) return;
    var p = plugin();
    if (p && p.selectionStart) {
      try { p.selectionStart(); if (p.selectionChanged) p.selectionChanged(); if (p.selectionEnd) p.selectionEnd(); return; } catch (e) {}
    }
    if (p && p.impact) { try { p.impact({ style: IMPACT.light }); return; } catch (e) {} }   // fallback: light tick
    if (canVibrate()) { try { navigator.vibrate(5); } catch (e) {} }
  }

  // ---- public API -------------------------------------------------------------------------
  window.SMD_HAPTICS = {
    tap: function () { impact(IMPACT.light); },
    light: function () { impact(IMPACT.light); },
    medium: function () { impact(IMPACT.medium); },
    heavy: function () { impact(IMPACT.heavy); },
    selection: selection,
    success: function () { notify(NOTIF.success); },
    warning: function () { notify(NOTIF.warning); },
    error: function () { notify(NOTIF.error); },
    enabled: enabled,
    setEnabled: function (on) { try { localStorage.setItem("smd_haptics", on ? "1" : "0"); } catch (e) {} },
    supported: function () { return !!plugin() || canVibrate(); }
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
      if (el.matches(PRIMARY)) return impact(IMPACT.medium);
      impact(IMPACT.light);
    } catch (e) { impact(IMPACT.light); }
  }

  // pointerdown = immediate on-press feedback (feels native); capture so it runs before the
  // app's own handlers and survives stopPropagation.
  document.addEventListener("pointerdown", function (e) {
    if (!enabled()) return;
    if (e.pointerType === "" && e.button && e.button !== 0) return;   // ignore non-primary mouse
    var t = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (t) fireFor(t);
  }, true);

  // Keyboard activation (Enter/Space) for accessibility parity.
  document.addEventListener("keydown", function (e) {
    if (!enabled()) return;
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    var t = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (t) fireFor(t);
  }, true);

  // Outcome feedback: a distinct error buzz when an error-like toast appears. Wrap the shared
  // toast shim (window.toast / SMD_toast) once available; the triggering tap already buzzed, so
  // we ONLY add a buzz for failures (never double-buzz success).
  function wrapToast() {
    var fn = window.toast;
    if (typeof fn !== "function" || fn.__smdHapticWrapped) return false;
    var wrapped = function (msg) {
      try { if (enabled() && /\b(fail|failed|error|unable|couldn|could not|invalid|denied|wrong|not\s+found|no\s+internet|offline)\b/i.test(String(msg || ""))) notify(NOTIF.error); } catch (e) {}
      return fn.apply(this, arguments);
    };
    wrapped.__smdHapticWrapped = true;
    window.toast = wrapped;
    if (window.SMD_toast === fn) window.SMD_toast = wrapped;
    return true;
  }
  if (!wrapToast()) { var n = 0, iv = setInterval(function () { if (wrapToast() || ++n > 40) clearInterval(iv); }, 250); }
})();
