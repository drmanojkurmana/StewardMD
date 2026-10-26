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
 * Look (2026-10-26, owner-approved): a left-aligned card, title + one detail line, a small dot only for errors
 * and warnings, an optional action button, no icons. It also draws everything SMD_dynNotify is asked to show
 * (Undo, foreground push); the gooey Dynamic Island is opt-in via smd_dyn_notify=island.
 *
 * Self-contained by design (inline styles, no CSS dependency, lazy DOM) so it works on the
 * native WebView and before any stylesheet loads. Loaded early + idempotent: if some other
 * script has already provided window.toast, we defer to it and only fill the missing alias. */
(function () {
  "use strict";
  var EASE = "cubic-bezier(0.23,1,0.32,1)";
  var MAX_VISIBLE = 3, FLICK = 0.11, SWIPE_PX = 45, ENTER_MS = 280, EXIT_MS = 150;

  /* ---- pure helpers (exported on a test seam, no DOM) ---- */
  // Errors need longer to read and act on than a "Saved" does.
  function duration(msg, kind) {
    var lo = kind === "error" ? 5500 : kind === "warning" ? 4000 : 2400;
    return Math.min(kind === "error" ? 8000 : 6500, Math.max(lo, String(msg).length * 55));
  }
  // "Title\nbody" or "Title \u2014 body" -> two lines; anything else is a title only.
  function splitText(text) {
    var s = String(text == null ? "" : text).trim();
    var nl = s.indexOf("\n");
    if (nl > 0) return { title: s.slice(0, nl).trim(), message: s.slice(nl + 1).trim() };
    var d = s.indexOf(" \u2014 ");
    if (d > 0 && d < 60) return { title: s.slice(0, d).trim(), message: s.slice(d + 3).trim() };
    // Two sentences: the first is what happened, the rest is what to do. Not after abbreviations (Dr., e.g.).
    var m = /^(.{6,70}?[.!?])\s+([A-Z][\s\S]*)$/.exec(s);
    if (m && !/\b(Dr|Mr|Mrs|Ms|vs|etc|e\.g|i\.e|approx|No)\.$/i.test(m[1]) && !/\d\.$/.test(m[1])) return { title: m[1].replace(/\.$/, ""), message: m[2] };
    return { title: s, message: "" };
  }
  // "error" | "warning" | "info": decides the dot and how long the card stays. Wording never changes.
  function kindOf(text) {
    var s = String(text || "");
    if (/\b(fail(ed|ure)?|error|could ?n[o']t|can ?n[o']t|unable|denied|invalid|offline|too (many|fast)|not (saved|sent|available|found|allowed))\b/i.test(s)) return "error";
    if (/\b(warning|caution|careful|expir(ed|es|ing)|low |limit)\b/i.test(s)) return "warning";
    return "info";
  }
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
  var seam = { duration: duration, step: step, swipeDismiss: swipeDismiss, dampen: dampen, slot: slot, splitText: splitText, kindOf: kindOf };
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

  // The chip is dark in the light theme and light in the dark theme, so it always separates from the page.
  function lightChip() {
    try { var c = document.body.classList; return c.contains("dark") || c.contains("v3-dark"); } catch (e) { return false; }
  }
  function baseStyle(light) {
    return [
      "position:absolute", "left:50%", "bottom:0", "width:max-content", "min-width:min(280px,calc(100vw - 32px))",
      "max-width:min(calc(100vw - 32px - max(env(safe-area-inset-left,0px),var(--sai-left,0px)) - max(env(safe-area-inset-right,0px),var(--sai-right,0px))),440px)",
      "box-sizing:border-box", "padding:12px 8px 12px 16px", "border-radius:16px",
      "background:" + (light ? "rgb(233,241,244)" : "rgb(20,38,50)"),   // opaque: a translucent chip let the toast behind bleed through (2026-10-03)
      "color:" + (light ? "#0E1A24" : "#F2F7F8"),
      "font:400 13.5px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
      "box-shadow:0 10px 30px rgba(0,0,0,.26)",
      "display:flex", "align-items:center", "gap:12px", "text-align:left",
      "white-space:pre-line", "overflow-wrap:anywhere",
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
      it.el.style.color = i === 0 ? it.fg : "transparent";
      if (it.dot) it.dot.style.opacity = i === 0 ? "1" : "0";
      if (it.btn) it.btn.style.visibility = i === 0 ? "visible" : "hidden";
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
    var id = null, y0 = 0, t0 = 0, el = it.el, downEl = null;
    el.addEventListener("pointerdown", function (e) {
      if (id !== null) return;                      // ignore extra touch points
      downEl = e.target;                            // capture retargets later events to the card, so keep the real target
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
      if (!cancelled && Math.abs(dy) < 6 && Date.now() - t0 < 400) {      // a tap
        var onAct = it.action && downEl && downEl.closest && downEl.closest("[data-act]");
        var fn = onAct ? it.action.onPress : it.onPress;
        dismiss(it);
        if (fn) { try { fn(); } catch (x) {} }
        return;
      }
      if (!cancelled && swipeDismiss(dy, Date.now() - t0, el.offsetHeight)) dismiss(it);   // exits from where the finger left it
      else { setTrans(it, ENTER_MS); layout(); }
    }
    el.addEventListener("pointerup", function (e) { end(e, false); });
    el.addEventListener("pointercancel", function (e) { end(e, true); });
  }

  // opts: { text } or { title, message }, plus kind ("error"|"warning"|"info"), symbol (legacy), action {label,onPress},
  // onPress (tap the card), duration (ms). Wording is shown exactly as given.
  function card(opts) {
    opts = opts || {};
    var title, message;
    if (opts.title != null || opts.message != null) { title = String(opts.title == null ? "" : opts.title); message = String(opts.message == null ? "" : opts.message); }
    else { var sp = splitText(opts.text); title = sp.title; message = sp.message; }
    if (!title && !message) return;
    var text = message ? title + "\n" + message : title;
    var kind = opts.kind || (opts.symbol === "error" ? "error" : opts.symbol === "warning" ? "warning" : null) || kindOf(text);
    try {
      ensureRoot();
      var front = all[0], dur = opts.duration || duration(text, kind);
      if (front && front.msg === text && !opts.action) {   // same message again: restart, don't pile up
        clearTimeout(front.timer); front.timer = null;
        front.t = { remaining: dur, t0: 0, running: false };
        sync();
        return;
      }
      if (!stacking()) { while (all.length) dismiss(all[0]); }
      var light = lightChip();
      var el = document.createElement("div");
      el.style.cssText = baseStyle(light);
      var dot = null, btn = null;
      if (kind === "error" || kind === "warning") {
        dot = document.createElement("span");
        dot.setAttribute("aria-hidden", "true");
        dot.style.cssText = "flex:none;width:8px;height:8px;border-radius:50%;background:" +
          (kind === "error" ? (light ? "#B42332" : "#FF7A8A") : (light ? "#8A5A00" : "#F0B84F"));
        el.appendChild(dot);
      }
      var col = document.createElement("div");
      col.style.cssText = "flex:1;min-width:0";
      var b = document.createElement("div");
      b.style.cssText = "font-size:15px;font-weight:600;line-height:1.35;letter-spacing:-.005em";
      b.textContent = title;
      col.appendChild(b);
      if (message) {
        var m = document.createElement("div");
        m.style.cssText = "margin-top:1px;opacity:.72";
        m.textContent = message;
        col.appendChild(m);
      }
      el.appendChild(col);
      if (opts.action && opts.action.label) {
        btn = document.createElement("button");
        btn.type = "button"; btn.setAttribute("data-act", "1");
        btn.textContent = String(opts.action.label);
        btn.style.cssText = "flex:none;min-height:44px;padding:0 12px;border:0;background:none;color:inherit;font:700 15px/1 system-ui,-apple-system,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer";
        el.appendChild(btn);
      } else { el.style.paddingRight = "16px"; }
      var it = { el: el, msg: text, fg: light ? "#0E1A24" : "#F2F7F8", dot: dot, btn: btn,
                 action: opts.action || null, onPress: opts.onPress || null,
                 t: { remaining: dur, t0: 0, running: false }, vis: false, dragging: false };
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
      try { console.log("[toast]", text); } catch (x) {}
    }
  }
  function show(msg) {
    if (msg == null || msg === "") return;
    card({ text: String(msg) });
  }
  window.SMD_toastCard = card;
  window.SMD_toastDismiss = function () { while (all.length) dismiss(all[0]); };
  window.SMD_toastVisible = function () { return all.length > 0; };

  document.addEventListener("visibilitychange", sync);
  window.toast = show;
  window.SMD_toast = show;
})();
