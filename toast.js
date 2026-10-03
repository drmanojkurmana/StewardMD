/* StewardMD — global toast shim (SMD_toast / toast).
 *
 * WHY THIS EXISTS: a number of modules show their user feedback through window.toast(...)
 * (icu.js, account.js, ghis-ward.js, voice.js, image-engine.js, offline-db.js) or through
 * window.SMD_toast(...) (watch-lab.js, native-push.js) — but NEITHER global was ever defined.
 * Every such message was silently swallowed, so buttons that only give toast feedback looked
 * dead. This defines ONE self-contained, theme-invariant toast and aliases both names to it.
 *
 * Behaviour (Sonner principles): toasts STACK (newest in front, max 3 visible, the rest queue),
 * the auto-dismiss timer pauses while the app is hidden or the toast is held, swipe DOWN (the
 * edge it entered from) dismisses with velocity, exit is faster than enter, transform/opacity
 * only. Kill switch: localStorage smd_toast_stack=0 shows one toast at a time (old replace
 * behaviour). Call sites need no change: toast(msg) / SMD_toast(msg). A repeat of the newest
 * message restarts its timer instead of stacking a duplicate.
 *
 * Self-contained by design (inline styles, no CSS dependency, lazy DOM) so it works on the
 * native WebView and before any stylesheet loads. Loaded early + idempotent: if some other
 * script has already provided window.toast, we defer to it and only fill the missing alias. */
(function () {
  "use strict";
  var EASE = "cubic-bezier(0.23,1,0.32,1)";
  var MAX_VISIBLE = 3, FLICK = 0.11, SWIPE_PX = 45, ENTER_MS = 280, EXIT_MS = 150;

  /* ---- pure helpers (exported on a test seam, no DOM) ---- */
  function duration(msg) { return Math.min(6500, Math.max(2400, String(msg).length * 55)); }
  // Timer state {remaining, t0, running}. step(state, shouldRun, now) -> new state; pausing banks
  // the elapsed time, resuming continues from what is left. Returns the SAME object if unchanged.
  function step(s, shouldRun, now) {
    if (shouldRun && !s.running) return { remaining: s.remaining, t0: now, running: true };
    if (!shouldRun && s.running) return { remaining: Math.max(0, s.remaining - (now - s.t0)), t0: 0, running: false };
    return s;
  }
  // Swipe toward the entry edge (dy > 0 = down). A flick beats distance.
  function swipeDismiss(dy, dt, h) {
    if (!(dy > 0)) return false;
    return dy >= Math.max(SWIPE_PX, (h || 0) * 0.5) || dy / Math.max(1, dt) > FLICK;
  }
  // Toward the entry edge tracks 1:1; against it, damped (moves less the further you pull).
  function dampen(dy) { return dy >= 0 ? dy : -Math.sqrt(-dy) * 3; }
  // Stack slot (0 = front) -> look. Slots past the cap are queued: hidden, timers held.
  function slot(i) {
    if (i >= MAX_VISIBLE) return { y: -(MAX_VISIBLE - 1) * 9, s: 1 - (MAX_VISIBLE - 1) * 0.05, o: 0, vis: false };
    return { y: -i * 9, s: 1 - i * 0.05, o: i === 0 ? 1 : 1 - i * 0.18, vis: true };
  }
  var seam = { duration: duration, step: step, swipeDismiss: swipeDismiss, dampen: dampen, slot: slot };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;

  // Respect an existing implementation (don't clobber module-local globals if one appears).
  if (typeof window.toast === "function") {
    if (typeof window.SMD_toast !== "function") window.SMD_toast = window.toast;
    return;
  }
  window.SMD_TOAST_SEAM = seam;

  var root = null, all = [];   // all: newest first; slots 0..2 visible, the rest queued
  function stacking() { try { return window.localStorage.getItem("smd_toast_stack") !== "0"; } catch (e) { return true; } }
  // Reduced motion: fade only, no slide/scale (checked per call, the setting can change at runtime).
  function still() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function hidden() { return document.visibilityState === "hidden"; }
  function tf(y, s) { return "translate3d(-50%," + y + ",0) scale(" + s + ")"; }
  var OFF = "calc(100% + 40px)";   // entry AND exit edge: below the screen bottom

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement("div");
    root.id = "smdToast";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.style.cssText = [
      "position:fixed", "left:0", "right:0", "height:0",
      "bottom:calc(24px + max(env(safe-area-inset-bottom,0px),var(--sai-bottom,0px)))",
      "z-index:2147483000",                        // above every sheet/modal in the app
      "pointer-events:none", "opacity:0"
    ].join(";");
    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function baseStyle() {
    return [
      "position:absolute", "left:50%", "bottom:0", "width:max-content",
      "max-width:min(calc(100vw - 32px - max(env(safe-area-inset-left,0px),var(--sai-left,0px)) - max(env(safe-area-inset-right,0px),var(--sai-right,0px))),440px)",
      "box-sizing:border-box", "padding:12px 16px", "border-radius:12px",
      "background:rgb(17,24,39)",                   // fixed dark chip, fully opaque: at .96 the toast behind
                                                    // and the page bled through as ghost text (rendered 2026-10-03)
      "color:#fff",
      "font:600 13.5px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
      "box-shadow:0 10px 34px rgba(0,0,0,.30)",
      "text-align:center", "white-space:pre-line", "overflow-wrap:anywhere",
      "transform-origin:50% 100%", "touch-action:none", "-webkit-user-select:none", "user-select:none"
    ].join(";");
  }

  function setTrans(it, ms) {
    it.el.style.transition = ms
      ? "opacity " + ms + "ms " + EASE + ",color " + ms + "ms " + EASE + (still() ? "" : ",transform " + ms + "ms " + EASE)
      : "none";
  }

  // Apply stack positions. Transform/opacity only.
  function layout() {
    var live = 0, rm = still();
    for (var i = 0; i < all.length; i++) {
      var it = all[i], k = slot(i);
      it.vis = k.vis;
      if (!it.dragging) {
        it.el.style.transform = tf(rm ? "0px" : k.y + "px", rm ? 1 : k.s);
        it.el.style.opacity = String(rm && i > 0 ? 0 : k.o);   // reduced motion: only the front one shows
      }
      it.el.style.zIndex = String(MAX_VISIBLE + 1 - i);
      // Only the front toast shows its text; the ones behind read as card edges (Sonner), so a taller
      // older toast never peeks its words out above a shorter front one.
      it.el.style.color = i === 0 ? "#fff" : "transparent";
      it.el.style.pointerEvents = i === 0 ? "auto" : "none";
      if (k.vis) live++;
    }
    if (root) root.style.opacity = live ? "1" : "0";
    sync();
  }

  // Start/stop each countdown: runs only while visible, app foreground, and not held by a finger.
  function sync() {
    var now = Date.now();
    for (var i = 0; i < all.length; i++) {
      var it = all[i], next = step(it.t, it.vis && !hidden() && !it.dragging, now);
      if (next === it.t) continue;
      it.t = next;
      clearTimeout(it.timer); it.timer = null;
      if (next.running) it.timer = setTimeout((function (x) { return function () { dismiss(x); }; })(it), next.remaining);
    }
  }

  function dismiss(it) {
    var idx = all.indexOf(it);
    if (idx < 0) return;
    all.splice(idx, 1);
    clearTimeout(it.timer);
    it.dragging = false;
    it.el.style.pointerEvents = "none";
    setTrans(it, EXIT_MS);                         // exit faster than enter; retargets mid-flight
    it.el.style.transform = still() ? tf("0px", 1) : tf(OFF, 1);
    it.el.style.opacity = "0";
    setTimeout(function () { if (it.el.parentNode) it.el.parentNode.removeChild(it.el); }, EXIT_MS + 60);
    layout();
  }

  function attachSwipe(it) {
    var id = null, y0 = 0, t0 = 0, el = it.el;
    el.addEventListener("pointerdown", function (e) {
      if (id !== null) return;                      // ignore extra touch points
      if (e.pointerType === "mouse" && e.button !== 0) return;
      id = e.pointerId; y0 = e.clientY; t0 = Date.now();
      it.dragging = true; setTrans(it, 0); sync();
      try { el.setPointerCapture(id); } catch (x) {}
    });
    el.addEventListener("pointermove", function (e) {
      if (e.pointerId !== id) return;
      el.style.transform = tf(dampen(e.clientY - y0) + "px", 1);
    });
    function end(e, cancelled) {
      if (e.pointerId !== id) return;
      id = null;
      try { el.releasePointerCapture(e.pointerId); } catch (x) {}
      var dy = e.clientY - y0;
      it.dragging = false;
      if (!cancelled && swipeDismiss(dy, Date.now() - t0, el.offsetHeight)) dismiss(it);   // exits from where the finger left it
      else { setTrans(it, ENTER_MS); layout(); }
    }
    el.addEventListener("pointerup", function (e) { end(e, false); });
    el.addEventListener("pointercancel", function (e) { end(e, true); });
  }

  function show(msg) {
    if (msg == null || msg === "") return;
    try {
      var text = String(msg);
      ensureRoot();
      var front = all[0];
      if (front && front.msg === text) {            // same message again: restart, don't pile up
        clearTimeout(front.timer); front.timer = null;
        front.t = { remaining: duration(text), t0: 0, running: false };
        sync();
        return;
      }
      if (!stacking()) { while (all.length) dismiss(all[0]); }
      var el = document.createElement("div");
      el.style.cssText = baseStyle();
      el.textContent = text;
      var it = { el: el, msg: text, t: { remaining: duration(text), t0: 0, running: false }, vis: false, dragging: false };
      // park on the entry edge, then transition in (transitions, not keyframes: interruptible)
      el.style.transform = still() ? tf("0px", 1) : tf(OFF, 1);
      el.style.opacity = "0";
      root.appendChild(el);
      void el.offsetWidth;
      setTrans(it, ENTER_MS);
      all.unshift(it);
      attachSwipe(it);
      layout();
    } catch (e) {
      try { console.log("[toast]", msg); } catch (x) {}
    }
  }

  document.addEventListener("visibilitychange", sync);
  window.toast = show;
  window.SMD_toast = show;
})();
