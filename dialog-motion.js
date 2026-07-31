/* dialog-motion.js — motion.dev (Motion One) spring open/close for dialogs, app-wide.
 *
 * Additive progressive enhancement (mirrors syndromes-motion.js) — NO edits to the minified app.js.
 * A single MutationObserver watches the shared open/close class toggles (.on/.open/.active/.show) and
 * inserted-already-open dialogs, then springs the CONTAINER in/out via window.Motion. It composes with
 * syndromes-motion.js, which staggers the CONTENT inside (different targets, no conflict).
 *
 * Fails safe: no-op under prefers-reduced-motion, if Motion never loads, or if the clinician set
 * localStorage.smd_dialog_motion = "0". We only ever touch an element that ALSO toggles an open class,
 * so the selector list scopes cleanly to real open/close surfaces (not decorative always-on overlays).
 * Reuses the vendored /vendor/motion/motion.js (window.Motion). */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try { if (localStorage.getItem("smd_dialog_motion") === "0") return; } catch (e) {}

  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function visible(el) { try { return el.getClientRects().length > 0; } catch (e) { return false; } }   // false for display:none

  // Lazy Motion loader — identical pattern to syndromes-motion.js (shares the same <script id>).
  function withMotion(cb) {
    if (window.Motion && window.Motion.animate) return cb(window.Motion);
    if (!document.getElementById("smd-motion-js")) {
      var s = document.createElement("script"); s.id = "smd-motion-js"; s.src = "/vendor/motion/motion.js"; s.defer = true;
      (document.head || document.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() { if (window.Motion && window.Motion.animate) return cb(window.Motion); if (tries++ > 80) return; setTimeout(wait, 50); })();
  }

  // Dialog surfaces we manage. Membership is checked only when an OPEN class toggles, so static
  // always-on elements are never touched.
  var SEL = "#maikSheet,#maikScrim,.hv-sheet,.hv-scrim,[role=dialog],.modal,.overlay,.drawer,.sheet,.ntf-overlay,.smd-dialog";
  function isDialog(el) { try { return el && el.nodeType === 1 && el.matches && el.matches(SEL); } catch (e) { return false; } }
  function hasOpen(el) { var c = el.classList; return !!(c && (c.contains("on") || c.contains("open") || c.contains("active") || c.contains("show"))); }

  // Family -> spring. Direction-agnostic scale+fade is the safe default; only the unambiguous cases
  // (bottom sheet slides up from the bottom, scrim just fades) get a directional move.
  function familyOf(el) {
    var C = el.classList, id = el.id || "";
    if (id === "maikScrim" || C.contains("hv-scrim") || C.contains("scrim") || C.contains("backdrop")) return "scrim";
    if (id === "maikSheet" || C.contains("hv-sheet") || C.contains("sheet")) return "sheet";
    return "modal";
  }
  var FAM = {
    scrim: {
      in:  [{ opacity: [0, 1] }, { duration: 0.2, easing: "ease-out" }],
      out: [{ opacity: 0 }, { duration: 0.18, easing: "ease-in" }]
    },
    sheet: {
      in:  [{ transform: ["translateY(100%)", "translateY(0px)"], opacity: [0.5, 1] }, { type: "spring", stiffness: 300, damping: 34 }],
      out: [{ transform: "translateY(100%)", opacity: 0.4 }, { duration: 0.24, easing: "ease-in" }]
    },
    modal: {
      in:  [{ opacity: [0, 1], transform: ["scale(0.94)", "scale(1)"] }, { type: "spring", stiffness: 340, damping: 26 }],
      out: [{ opacity: 0, transform: "scale(0.97)" }, { duration: 0.16, easing: "ease-in" }]
    }
  };

  var openState = new WeakSet();   // elements we've sprung open (so we don't double-fire or mis-close)

  function play(el, dir) {
    var M = window.Motion;
    if (!M || !M.animate) { withMotion(function () {}); return; }  // not ready yet: let CSS handle this one, warm for next
    var spec = (FAM[familyOf(el)] || FAM.modal)[dir];
    try { el.style.transition = "none"; } catch (e) {}            // Motion owns transform/opacity now — stop CSS fighting it
    try { M.animate(el, spec[0], spec[1]); } catch (e) {}
  }
  function onOpen(el) { if (openState.has(el)) return; openState.add(el); if (reduced() || !visible(el)) return; play(el, "in"); }
  function onClose(el) { if (!openState.has(el)) return; openState.delete(el); if (reduced()) return; play(el, "out"); }

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
