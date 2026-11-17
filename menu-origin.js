/* StewardMD - menu-origin.js: every dropdown, popover and menu grows out of the button that opened it and goes back
 * into it when it closes (owner 2026-11-15: "any dropdown or menu should originate from the button that opened it ...
 * nothing should just fade in from nowhere").
 *
 * Generic, like the rest of the motion layer: no module edits. A tap (pointerdown) snapshots which menus are already
 * on screen; a menu that becomes visible within 900 ms of that tap (class flip, hidden removed, inserted) springs out
 * of the tapped control on the shared menu spring (smd-motion.js popIn: the individual `scale` property from the
 * button's centre, so a transform the menu uses to place itself is untouched). When it later hides or is removed, it
 * shrinks back into that same button: a hidden one is shown inline for the 200 ms exit, a removed one leaves an inert,
 * id-less copy in its place.
 * Skips dialogs and sheets (dialog-motion.js), full-screen pages (page-motion.js), anything marked data-own-motion /
 * data-no-motion, and the iPad header row that is always visible (.hrf-inline). A menu's own CSS entrance is held off
 * (animation:none) while it is open, so the two never fight; it is released once the menu is closed.
 * No-op under prefers-reduced-motion and with localStorage smd_menu_origin = "0" (or smd_motion3 = "0").
 * Pure helper (isMenuBox) loads under node for tests. */
(function (G) {
  "use strict";
  var MENU = "[role=menu],[role=listbox],.menu,.dropdown,.popover,.popup,[class*='-menu'],[class*='menu-'],[class*='dropdown'],[class*='popover'],[class*='popup']";
  var DIALOG = "#maikSheet,#maikScrim,.hv-sheet,.hv-scrim,[role=dialog],.modal,.overlay,.drawer,.sheet,.ntf-overlay,.smd-dialog";

  // A menu-sized floating box: positioned out of flow, a real size, and well short of the whole screen.
  function isMenuBox(pos, w, h, vw, vh) {
    return (pos === "absolute" || pos === "fixed") && w >= 40 && h >= 32 && !(w >= vw * 0.9 && h >= vh * 0.82) && h < vh * 0.9;
  }
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = { isMenuBox: isMenuBox, MENU: MENU }; return; }
  if (!G || !G.document || G.__smdMenuOrigin) return;
  G.__smdMenuOrigin = true;
  var D = G.document;
  function off() {
    try { if (G.localStorage.getItem("smd_menu_origin") === "0") return true; } catch (e) {}
    var m = G.SMD_MOTION; return !(m && m.on && m.on() && m.popIn);
  }

  function shown(el) {
    try {
      if (!el.isConnected || !el.getClientRects().length) return null;
      var cs = G.getComputedStyle(el);
      // Transparent counts as hidden, unless that is only the first frame of its own entrance (a CSS fade-in).
      if (cs.visibility === "hidden") return null;
      if ((parseFloat(cs.opacity) || 0) < 0.02 && !((cs.animationName && cs.animationName !== "none") || (el.getAnimations && el.getAnimations().length))) return null;
      return cs;
    } catch (e) { return null; }
  }
  function skip(el) {
    try {
      if (!el || el.nodeType !== 1 || !el.matches || !el.matches(MENU)) return true;
      if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|svg|SVG|path|IMG|OPTION|LI)$/.test(el.tagName)) return true;
      if (el.matches(DIALOG) || el.closest("[data-own-motion],[data-no-motion],[data-pm-ghost]") || el.classList.contains("hrf-inline")) return true;
      if (!el.childElementCount) return true;
      return false;
    } catch (e) { return true; }
  }

  var tapAt = 0, before = null;           // menus already showing when the tap landed
  var open = [];                          // { el, origin, disp, keepAnim }
  var exiting = typeof WeakSet === "function" ? new WeakSet() : null;
  function isOpen(el) { for (var i = 0; i < open.length; i++) if (open[i].el === el) return true; return false; }

  D.addEventListener("pointerdown", function (e) {
    if (off()) return;
    tapAt = Date.now(); before = [];
    try {
      var all = D.querySelectorAll(MENU);
      for (var i = 0; i < all.length && i < 600; i++) if (all[i].getClientRects().length) before.push(all[i]);
    } catch (x) {}
  }, true);

  function tryOpen(el) {
    if (skip(el) || isOpen(el) || (exiting && exiting.has(el)) || (before && before.indexOf(el) >= 0)) return;
    var cs = shown(el); if (!cs) return;
    var r = el.getBoundingClientRect();
    if (!isMenuBox(cs.position, r.width, r.height, G.innerWidth, G.innerHeight)) return;
    var m = G.SMD_MOTION, src = m.source();
    if (!src || !src.el || el.contains(src.el) || src.el.contains(el)) return;
    var keepAnim = el.style.animation, keepTr = el.style.transition;
    el.style.animation = "none"; el.style.transition = "none";   // the menu's own CSS entrance stands down
    var o = m.popIn(el, src);
    el.style.transition = keepTr;
    if (!o) { el.style.animation = keepAnim; return; }
    open.push({ el: el, origin: o.origin, disp: cs.display, keepAnim: keepAnim, parent: el.parentNode });
  }

  // A menu that has closed: back into its button.
  function closeOut(rec, removed, parent, next) {
    var el = rec.el;
    if (removed) {
      if (!parent || !parent.isConnected) return;
      var g; try { g = el.cloneNode(true); } catch (e) { return; }
      g.removeAttribute("id"); Array.prototype.forEach.call(g.querySelectorAll("[id]"), function (x) { x.removeAttribute("id"); });
      g.setAttribute("data-pm-ghost", ""); g.setAttribute("aria-hidden", "true"); g.inert = true;
      g.style.pointerEvents = "none"; g.style.animation = "none"; g.style.transition = "none";
      try { parent.insertBefore(g, next && next.parentNode === parent ? next : null); } catch (e) { return; }
      if (!shown(g)) { g.remove(); return; }
      G.SMD_MOTION.popOut(g, rec.origin, function () { if (g.parentNode) g.parentNode.removeChild(g); });
      return;
    }
    // Hidden in place: show it again inline, inert, for the exit, then hand it back exactly as it was.
    var s = el.style, keep = { display: s.getPropertyValue("display"), dp: s.getPropertyPriority("display"), visibility: s.getPropertyValue("visibility"), vp: s.getPropertyPriority("visibility"), pe: s.pointerEvents };
    if (exiting) exiting.add(el);
    var hadHidden = el.hasAttribute("hidden");
    s.setProperty("display", rec.disp || "block", "important"); s.setProperty("visibility", "visible", "important"); s.pointerEvents = "none";
    var restore = function () {
      s.removeProperty("display"); if (keep.display) s.setProperty("display", keep.display, keep.dp);
      s.removeProperty("visibility"); if (keep.visibility) s.setProperty("visibility", keep.visibility, keep.vp);
      s.pointerEvents = keep.pe; s.animation = rec.keepAnim;
      try { el.getAnimations().forEach(function (a) { if (a.id === "smd-pop") a.cancel(); }); } catch (e) {}
      if (hadHidden && !el.hasAttribute("hidden")) el.setAttribute("hidden", "");
      setTimeout(function () { if (exiting) exiting.delete(el); }, 0);
    };
    if (!el.getClientRects().length) { restore(); return; }   // an ancestor hid it: nothing to show
    G.SMD_MOTION.popOut(el, rec.origin, restore);
  }

  function checkClosed(muts) {
    if (!open.length) return;
    for (var i = open.length - 1; i >= 0; i--) {
      var rec = open[i], el = rec.el;
      if (exiting && exiting.has(el)) continue;
      if (el.isConnected && shown(el)) continue;
      open.splice(i, 1);
      if (off()) { el.style.animation = rec.keepAnim; continue; }
      if (!el.isConnected) {
        var parent = null, next = null;
        for (var k = 0; k < muts.length; k++) { var mm = muts[k]; if (mm.type === "childList" && Array.prototype.indexOf.call(mm.removedNodes, el) >= 0) { parent = mm.target; next = mm.nextSibling; break; } }
        if (parent) closeOut(rec, true, parent, next); else el.style.animation = rec.keepAnim;
      } else closeOut(rec, false);
    }
  }

  function handle(muts) {
    checkClosed(muts);
    if (Date.now() - tapAt > 900 || off()) return;
    var seen = [], n = 0;
    function add(el) { if (el && el.nodeType === 1 && seen.indexOf(el) < 0) seen.push(el); }
    for (var i = 0; i < muts.length && n < 40; i++, n++) {
      var m = muts[i], t = m.target;
      if (m.type === "attributes") {
        if (t.nodeType !== 1 || (exiting && exiting.has(t))) continue;
        add(t);
        // A wrapper flipped open (.wrap.open .menu): its menus, when the wrapper itself is small.
        var r = t.getBoundingClientRect();
        if (r.width * r.height < G.innerWidth * G.innerHeight * 0.5 && t.querySelectorAll) { var q = t.querySelectorAll(MENU); for (var j = 0; j < q.length && j < 8; j++) add(q[j]); }
      } else {
        for (var a = 0; a < m.addedNodes.length; a++) {
          var x = m.addedNodes[a]; if (x.nodeType !== 1) continue;
          add(x);
          // An inserted wrapper's own menu (two levels down at most), never menus deep inside a whole new page.
          for (var c = x.firstElementChild; c; c = c.nextElementSibling) { add(c); for (var cc = c.firstElementChild; cc; cc = cc.nextElementSibling) add(cc); }
        }
      }
    }
    for (var s = 0; s < seen.length; s++) tryOpen(seen[s]);
  }

  function boot() {
    try { new MutationObserver(handle).observe(D.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "style", "open"] }); } catch (e) {}
  }
  if (D.body) boot(); else D.addEventListener("DOMContentLoaded", boot);
})(typeof window !== "undefined" ? window : this);
