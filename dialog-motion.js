/* dialog-motion.js — motion.dev (Motion One / Motion) spring open/close for dialogs, app-wide.
 *
 * Additive progressive enhancement (mirrors syndromes-motion.js) — NO edits to the minified app.js.
 * A single MutationObserver watches the shared open/close class toggles (.on/.open/.active/.show) and
 * inserted-already-open dialogs, then springs the CONTAINER in/out via window.Motion. Composes with
 * syndromes-motion.js (which staggers the CONTENT inside — different targets).
 *
 * FLICKER FIX (v2): this Motion build defers the whole animation to its rAF loop and applies the START
 * keyframe a frame LATE — so without help the element shows its FINAL (open) state for one frame before
 * the animation yanks it back = a visible flicker. We therefore PRIME the hidden start state inline,
 * synchronously, in the observer callback (which runs before paint), so the dialog is never shown open
 * before it animates. Motion commits the end state, and we clear the inline overrides on finish so the
 * CSS resting (.on) state holds.
 *
 * Fails safe: no-op under prefers-reduced-motion, if Motion never loads, or via kill-switch
 * localStorage.smd_dialog_motion="0". Reuses the vendored /vendor/motion/motion.js (window.Motion). */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try { if (localStorage.getItem("smd_dialog_motion") === "0") return; } catch (e) {}

  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function visible(el) { try { return el.getClientRects().length > 0; } catch (e) { return false; } }

  function withMotion(cb) {
    if (window.Motion && window.Motion.animate) return cb(window.Motion);
    if (!document.getElementById("smd-motion-js")) {
      var s = document.createElement("script"); s.id = "smd-motion-js"; s.src = "/vendor/motion/motion.js"; s.defer = true;
      (document.head || document.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() { if (window.Motion && window.Motion.animate) return cb(window.Motion); if (tries++ > 80) return; setTimeout(wait, 50); })();
  }

  var SEL = "#maikSheet,#maikScrim,.hv-sheet,.hv-scrim,[role=dialog],.modal,.overlay,.drawer,.sheet,.ntf-overlay,.smd-dialog";
  function isDialog(el) { try { return el && el.nodeType === 1 && el.matches && el.matches(SEL); } catch (e) { return false; } }
  function hasOpen(el) { var c = el.classList; return !!(c && (c.contains("on") || c.contains("open") || c.contains("active") || c.contains("show"))); }

  // Family. Bottom sheets slide up; scrims/backdrops fade; a full-viewport overlay FADES (scaling the
  // whole screen looks wrong); a smaller floating box scale+fades. Measured while the element is open.
  function familyOf(el) {
    var C = el.classList, id = el.id || "";
    if (id === "maikScrim" || C.contains("hv-scrim") || C.contains("scrim") || C.contains("backdrop")) return "scrim";
    if (id === "maikSheet" || C.contains("hv-sheet") || C.contains("sheet")) return "sheet";
    try { var r = el.getBoundingClientRect(); if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.82) return "fade"; } catch (e) {}
    return "modal";
  }

  // start (hidden) inline state to PRIME sync; Motion IN keyframes + opts; Motion OUT keyframes + opts.
  var F = {
    sheet: { start: { transform: "translateY(100%)" }, kin: { transform: ["translateY(100%)", "translateY(0px)"], opacity: [0.7, 1] }, oin: { type: "spring", stiffness: 280, damping: 32 }, kout: { transform: "translateY(100%)", opacity: 0.5 }, oout: { duration: 0.22, easing: "ease-in" } },
    scrim: { start: { opacity: "0" }, kin: { opacity: [0, 1] }, oin: { duration: 0.2, easing: "ease-out" }, kout: { opacity: 0 }, oout: { duration: 0.16, easing: "ease-in" } },
    fade:  { start: { opacity: "0" }, kin: { opacity: [0, 1] }, oin: { duration: 0.22, easing: "ease-out" }, kout: { opacity: 0 }, oout: { duration: 0.16, easing: "ease-in" } },
    modal: { start: { opacity: "0", transform: "scale(0.94)" }, kin: { opacity: [0, 1], transform: ["scale(0.94)", "scale(1)"] }, oin: { type: "spring", stiffness: 340, damping: 28 }, kout: { opacity: 0, transform: "scale(0.97)" }, oout: { duration: 0.14, easing: "ease-in" } }
  };

  var openState = new WeakSet();

  function animateIn(el) {
    // Only run when Motion is READY — otherwise priming to hidden with no animator would leave the
    // dialog invisible. Not ready: let the app's own CSS show this one, and warm Motion for the next.
    if (!(window.Motion && window.Motion.animate)) { withMotion(function () {}); return; }
    var fam = familyOf(el), f = F[fam];
    // PRIME (sync, before paint): transition off + hidden start state -> no flash of the open state.
    el.style.transition = "none";
    if (f.start.opacity !== undefined) el.style.opacity = f.start.opacity;
    if (f.start.transform !== undefined) el.style.transform = f.start.transform;
    var ctrl; try { ctrl = window.Motion.animate(el, f.kin, f.oin); } catch (e) {}
    var settle = function () { try { el.style.opacity = ""; if (fam === "sheet" || fam === "modal") el.style.transform = ""; } catch (e) {} };
    if (ctrl && ctrl.finished && ctrl.finished.then) ctrl.finished.then(settle).catch(settle);
    setTimeout(settle, 700);   // safety: never leave the dialog stuck in its primed/animating state
  }
  function animateOut(el) {
    if (!(window.Motion && window.Motion.animate)) return;   // Motion gone: app's removal handles it
    var f = F[familyOf(el)];
    el.style.transition = "none";
    try { window.Motion.animate(el, f.kout, f.oout); } catch (e) {}
  }
  function onOpen(el) { if (openState.has(el)) return; openState.add(el); if (reduced() || !visible(el)) return; animateIn(el); }
  function onClose(el) { if (!openState.has(el)) return; openState.delete(el); if (reduced()) return; animateOut(el); }

  function handle(muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === "attributes") {
        var el = m.target;
        if (isDialog(el)) { if (hasOpen(el)) onOpen(el); else onClose(el); }
      } else if (m.type === "childList") {
        var a = m.addedNodes, r = m.removedNodes, j;
        for (j = 0; j < a.length; j++) { if (isDialog(a[j]) && hasOpen(a[j])) onOpen(a[j]); }
        for (j = 0; j < r.length; j++) { if (r[j] && r[j].nodeType === 1 && openState.has(r[j])) openState.delete(r[j]); }
      }
    }
  }
  function boot() {
    try { new MutationObserver(handle).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true }); } catch (e) {}
    try { (window.requestIdleCallback || function (f) { setTimeout(f, 300); })(function () { withMotion(function () {}); }); } catch (e) {}  // warm Motion so the first dialog springs cleanly
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
