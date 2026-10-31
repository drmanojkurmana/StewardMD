/* StewardMD - page-motion.js: full-screen pages and modules open and close with motion.
 *
 * Owner, 2026-10-28: "every open or close of every module or page of the app should have motion
 * transitions so it looks premium rather than sudden appearance and disappearing pages".
 *
 * dialog-motion.js already springs sheets, scrims and dialogs. This covers the rest: a module root or
 * page that is a direct child of <body>, fixed and (nearly) the whole screen, that appears or goes away
 * with no animation of its own (a class flip to display:none, a hidden attribute, node insert/remove).
 *   open  : rises 16px and fades in (Web Animations, start keyframe applied before first paint).
 *   close : the page is held for one beat and fades down, then is released. A class/hidden/display
 *           close re-shows the element inline for the exit; a REMOVED node gets an inert, id-less
 *           visual copy (no iframes, video or scripts) so nothing in the app sees a lingering node.
 *   back  : tapping a "Back" control cross-fades the screen change (View Transitions API, no hero).
 * inner : a screen swapped inside a module (a big block added, or replacing a big block with another heading) fades up
 *           over 220 ms; a repaint of the same screen (same heading) never animates, so answering or typing cannot flicker.
 * Never adds an entrance to an element that already animates its own (CSS transition on opacity/transform/
 * all or a CSS animation), nor a copy-exit to a node it removes itself. Not the splash / intro / sign-in gates, nor anything dialog-motion.js owns.
 * No-op under prefers-reduced-motion. Kill switch: localStorage smd_page_motion = "0".
 *
 * Motion 3 (owner 2026-10-31, smd-motion.js, switch smd_motion3 = "0" for the motion above): a page opened from a tile
 * or row GROWS OUT OF IT (the container transform: clipped from the tile's rect to the full screen on a spring) and
 * shrinks back into it on close when the tile is still there; a page with no source rises on the open spring and
 * sinks on close. Inside a module a new screen slides in on the push spring from the side it was reached (from the
 * left after a Back tap, which replaces the View Transition cross-fade) and its first rows settle one after another. */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try { if (localStorage.getItem("smd_page_motion") === "0") return; } catch (e) {}
  if (!Element.prototype.animate) return;

  var SKIP_ID = /^(smdBootSplash|introPoster|splash|accountGate|introOverlay|disclaimerModal|phvRoot|maikSheet|maikScrim|smdPushPop|smdOtaBanner)$/;
  // dialog-motion.js's own selector: those elements are its job.
  var DIALOG = "#maikSheet,#maikScrim,.hv-sheet,.hv-scrim,[role=dialog],.modal,.overlay,.drawer,.sheet,.ntf-overlay,.smd-dialog";
  var IN = { duration: 300, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" };
  var OUT = { duration: 190, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" };
  var K_IN = [{ opacity: 0, transform: "translateY(16px) scale(.992)" }, { opacity: 1, transform: "none" }];
  var K_OUT = [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(12px) scale(.994)" }];

  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function skip(el) {
    try {
      if (!el || el.nodeType !== 1 || SKIP_ID.test(el.id || "")) return true;
      if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT)$/.test(el.tagName)) return true;
      if (el.hasAttribute("data-no-motion") || el.hasAttribute("data-kb-managed") || el.hasAttribute("data-pm-ghost")) return true;
      return !!(el.matches && el.matches(DIALOG));
    } catch (e) { return true; }
  }
  function big(el) {
    var r = el.getBoundingClientRect();
    return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.82;
  }
  // The app animates this element itself: leave it alone.
  function selfAnimated(cs) {
    if (cs.animationName && cs.animationName !== "none") return true;
    var props = String(cs.transitionProperty || "").split(","), durs = String(cs.transitionDuration || "").split(",");
    for (var i = 0; i < props.length; i++) {
      var p = props[i].trim(), d = parseFloat(durs[i % durs.length]) || 0;
      if (d > 0 && (p === "all" || p === "opacity" || p === "transform")) return true;
    }
    return false;
  }
  function shownState(el) {
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    // Fully transparent counts as hidden unless it is only the first frame of the app's own fade-in.
    if ((parseFloat(cs.opacity) || 0) < 0.02 && !selfAnimated(cs)) return null;
    if (cs.position !== "fixed" || !big(el)) return null;
    return cs;
  }

  // el -> { vis, disp, own }. own = it animates itself, so we never touch it.
  var info = new WeakMap(), exiting = new WeakMap();

  function endExit(el) { var x = exiting.get(el); if (x) { exiting.delete(el); x.done(); } }

  var SM = function () { var m = window.SMD_MOTION; return m && m.on() ? m : null; };
  function animateIn(el, i) {
    endExit(el);
    var m = SM();
    if (m && m.vtBusy()) return;   // a View Transition is already pushing the whole screen
    if (m) {
      var src = m.take();
      i.src = src && src.el && !el.contains(src.el) ? src : null;
      if (i.src ? m.morphIn(el, i.src) : m.riseIn(el)) return;
    }
    try { el.animate(K_IN, IN); } catch (e) {}
  }
  // The close: back into the tile it came from when that tile is still on screen where it was, else a sink.
  function outFor(el, i) {
    var m = SM(); if (!m) return { kf: K_OUT, o: OUT };
    var src = i && i.src, e = m.ease("close");
    if (src && src.el && src.el.isConnected) {
      var r = src.el.getBoundingClientRect();
      if (r.width > 8 && Math.abs(r.left - src.left) < 2 && Math.abs(r.top - src.top) < 2) { var mo = m.morphOutKf(el, src); return { kf: mo.kf, o: { duration: 260, easing: e.easing, fill: "forwards" }, origin: mo.origin }; }
    }
    var sk = m.sinkKf();   // no tile to go back to: the page slides down off the bottom edge
    return { kf: sk.kf, o: sk.o };
  }

  // Close without removal: show it again inline (overriding whatever hid it) for one exit beat.
  var FORCE = { opacity: "1", transform: "none", visibility: "visible", transition: "none", animation: "none", pointerEvents: "none" };
  function exitInPlace(el, i) {
    var keep = {}, k, disp = i.disp || "block";
    for (k in FORCE) keep[k] = el.style[k];
    keep.display = el.style.display;
    function restore() {
      for (k in FORCE) el.style[k] = keep[k];
      if (el.style.display === disp) el.style.display = keep.display;
    }
    for (k in FORCE) el.style[k] = FORCE[k];
    el.style.display = disp;
    if (!big(el)) { restore(); return; }
    var x = outFor(el, i), oo = el.style.transformOrigin; if (x.origin) el.style.transformOrigin = x.origin;
    var a; try { a = el.animate(x.kf, x.o); } catch (e) { el.style.transformOrigin = oo; restore(); return; }
    var finished = false;
    function done() {
      if (finished) return; finished = true;
      try { a.cancel(); } catch (e) {}
      el.style.transformOrigin = oo;
      restore();
      exiting.delete(el);
      i.vis = !!shownState(el);
    }
    exiting.set(el, { done: done });
    a.onfinish = done;
    setTimeout(done, 700);
  }

  // Close by removal: fade an inert, id-less copy where the page was.
  function exitGhost(node, parent, next, st) {
    if (!parent || !parent.isConnected) return;
    var g;
    try { g = node.cloneNode(true); } catch (e) { return; }
    var junk = g.querySelectorAll("iframe,video,audio,script,canvas,object,embed"), i;
    for (i = 0; i < junk.length; i++) junk[i].parentNode.removeChild(junk[i]);
    if (g.removeAttribute) g.removeAttribute("id");
    var ids = g.querySelectorAll("[id]");
    for (i = 0; i < ids.length; i++) ids[i].removeAttribute("id");
    g.setAttribute("inert", ""); g.setAttribute("aria-hidden", "true"); g.setAttribute("data-pm-ghost", "");
    g.style.pointerEvents = "none";
    try { parent.insertBefore(g, next && next.parentNode === parent ? next : null); } catch (e) { return; }
    var x = outFor(node, st); if (x.origin) g.style.transformOrigin = x.origin;
    var a; try { a = g.animate(x.kf, x.o); } catch (e) { if (g.parentNode) g.parentNode.removeChild(g); return; }
    function gone() { try { if (g.parentNode) g.parentNode.removeChild(g); } catch (e) {} }
    a.onfinish = gone; setTimeout(gone, 700);
  }

  function consider(el, cause) {
    if (skip(el) || el.parentNode !== document.body) return;
    if (exiting.get(el)) return;   // our own inline re-show during the exit beat; done() re-syncs the state
    var i = info.get(el), cs = shownState(el), now = !!cs;
    if (!i) {
      if (!now && cause !== "attr") { info.set(el, { vis: false, disp: "", own: false }); return; }
      i = { vis: false, disp: "", own: false }; info.set(el, i);
    }
    if (cs) { i.disp = cs.display; i.own = selfAnimated(cs); }
    if (now === i.vis) return;
    var was = i.vis; i.vis = now;
    if (reduced()) return;
    // A page that animates its own ENTRANCE (a CSS transition) still vanishes at once when it is
    // hidden with display:none, because a transition cannot run on a display change: give it the exit.
    if (now && !was) { if (!i.own) animateIn(el, i); }
    else if (!now && was) exitInPlace(el, i);
  }

  // ---- screen swaps inside a module
  var IN2 = { duration: 220, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" };
  var K_IN2 = [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }];
  var T0 = Date.now(), swapBudget = 0, swapAt = 0;
  function sig(n) {
    try {
      var h = n.querySelector("h1,h2,[role=heading],[class*=title],[class*=-h]");
      return String((h || n).textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    } catch (e) { return ""; }
  }
  function bigBlock(n) {
    if (n.nodeType !== 1 || skip(n) || !n.childElementCount) return false;
    var r = n.getBoundingClientRect();
    return r.width >= innerWidth * 0.55 && r.height >= innerHeight * 0.4;
  }
  function innerSwap(m, all) {
    if (Date.now() - T0 < 2500 || reduced() || (SM() && SM().vtBusy())) return;
    var now = Date.now(); if (now - swapAt > 400) swapBudget = 0; swapAt = now;
    var gone = [], j, n;
    for (j = 0; j < m.removedNodes.length; j++) { n = m.removedNodes[j]; if (n.nodeType === 1 && n.childElementCount) gone.push(sig(n)); }
    for (j = 0; j < m.addedNodes.length && swapBudget < 2; j++) {
      n = m.addedNodes[j];
      if (n.nodeType !== 1 || !n.isConnected || n.hasAttribute("data-pm-ghost") || n.closest("[data-no-motion],[data-pm-ghost]")) continue;
      if (n.parentNode === document.body || n.closest(DIALOG)) continue;
      if (!bigBlock(n)) continue;
      var cs = getComputedStyle(n);
      if (selfAnimated(cs) || (parseFloat(cs.opacity) || 1) < 0.99) continue;
      var sg = sig(n); if (gone.length && gone.indexOf(sg) >= 0) continue;   // same screen repainted
      swapBudget++;
      var mm = SM();
      if (mm) {
        // Motion 3, no cross-fades (owner 2026-10-31): a real push. A copy of the screen that left is laid over the
        // new one's place and travels with it (pushX); a Back tap runs it the other way.
        pushX(n, oldNode(m, all), Date.now() - backAt < 700 ? -1 : 1, mm);
        continue;
      }
      try { n.animate(K_IN2, IN2); } catch (e) {}
    }
  }

  // The screen a swap removed (the largest element node), to copy for the push.
  function oldNode(m, all) {
    var best = null, bn = 0, recs = (all || [m]).filter(function (r) { return r.target === m.target && r.type === "childList"; });
    recs.forEach(function (r) { for (var j = 0; j < r.removedNodes.length; j++) { var x = r.removedNodes[j]; if (x.nodeType === 1 && x.childElementCount > bn) { best = x; bn = x.childElementCount; } } });
    return best;
  }
  function pushX(n, old, dir, mm) {
    var g = null;
    if (old) {
      try {
        var r = n.getBoundingClientRect(), z = (n.offsetWidth ? r.width / n.offsetWidth : 1) || 1;
        var c = old.cloneNode(true);
        c.removeAttribute("id"); Array.prototype.forEach.call(c.querySelectorAll("[id]"), function (x) { x.removeAttribute("id"); });
        g = document.createElement("div"); g.setAttribute("data-pm-ghost", ""); g.setAttribute("aria-hidden", "true"); g.inert = true;
        var bg = "", p = n.parentElement;
        for (; p && !bg; p = p.parentElement) { var b = getComputedStyle(p).backgroundColor; if (b && b !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(b)) bg = b; }
        g.style.cssText = "position:fixed;left:" + r.left / z + "px;top:" + r.top / z + "px;width:" + r.width / z + "px;height:" + r.height / z + "px;overflow:hidden;pointer-events:none;z-index:2147482000;contain:paint;background:" + (bg || "var(--bg, #fff)");
        c.style.margin = "0";
        g.appendChild(c); document.body.appendChild(g);
      } catch (e) { g = null; }
    }
    var e2 = mm.ease("push"), a = g ? mm.push(dir > 0 ? [n] : [], g, dir) : [];
    // Back (under the copy sliding off) or no copy to push against: the new screen travels a third of the width.
    if (dir < 0 || !g) { try { n.animate([{ transform: "translateX(" + Math.round(innerWidth * 0.3) * dir + "px)" }, { transform: "translateX(0px)" }], { duration: e2.duration, easing: e2.easing, fill: "backwards" }); } catch (e) {} }
    if (g) {
      var drop = function () { if (g && g.parentNode) g.parentNode.removeChild(g); g = null; };
      var ga = a[a.length - 1]; if (ga) ga.onfinish = ga.oncancel = drop;
      setTimeout(drop, 900);
    }
    var rows = n.querySelectorAll(":scope > ul > li, :scope > ol > li, :scope > * > ul > li");
    if (dir > 0 && rows.length > 1) mm.stagger(rows);
  }

  function handle(muts) {
    for (var k = 0; k < muts.length; k++) {
      var m = muts[k], j, n;
      if (m.type === "attributes") { if (m.target.parentNode === document.body) consider(m.target, "attr"); continue; }
      if (m.target !== document.body) { if (m.type === "childList" && m.addedNodes.length) innerSwap(m, muts); continue; }
      for (j = 0; j < m.addedNodes.length; j++) { n = m.addedNodes[j]; if (n.nodeType === 1) consider(n, "add"); }
      for (j = 0; j < m.removedNodes.length; j++) {
        n = m.removedNodes[j];
        var i = n.nodeType === 1 ? info.get(n) : null;
        if (i && i.vis && !i.own && !reduced() && !n.isConnected) { i.vis = false; exitGhost(n, m.target, m.nextSibling, i); }
      }
    }
  }

  // A Back tap as a pop (View Transitions API, slide rules in smd-motion.js). Not inside modal dialogs: their taps are synchronous by contract.
  var BACK = "button.db-back,button.dx-back,button[data-act='back'],button[aria-label='Back'],a[aria-label='Back']";
  var replaying = false, busy = false, backAt = 0;
  function settled(ms) {
    return new Promise(function (res) {
      var done = false, mo, quiet = 0;
      function fin() { if (done) return; done = true; try { mo.disconnect(); } catch (e) {} setTimeout(res, 16); }
      try { mo = new MutationObserver(function () { clearTimeout(quiet); quiet = setTimeout(fin, 30); }); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] }); } catch (e) {}
      setTimeout(fin, ms);
    });
  }
  function onBack(e) {
    if (!replaying && SM() && e.target && e.target.closest && e.target.closest(BACK)) { backAt = Date.now(); return; }
    if (replaying || busy || e.defaultPrevented || e.button !== 0 || reduced() || typeof document.startViewTransition !== "function") return;
    var t = e.target; if (!t || !t.closest) return;
    var b = t.closest(BACK); if (!b || b.disabled || b.closest("[role=dialog],[aria-modal=true],[data-no-vt],[data-no-motion]")) return;
    e.stopImmediatePropagation(); e.preventDefault();
    busy = true;
    var init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: e.clientX, clientY: e.clientY, detail: e.detail || 1 };
    function replay() { replaying = true; try { b.dispatchEvent(new MouseEvent("click", init)); } finally { replaying = false; } }
    try {
      window.__smdVtAt = Date.now(); document.documentElement.classList.add("smd-vt-back");   // slides the other way (smd-motion.js)
      var vt = document.startViewTransition(function () { replay(); return settled(160); });
      var free = function () { busy = false; document.documentElement.classList.remove("smd-vt-back"); };
      vt.finished.then(free, free);
      setTimeout(free, 1500);
    } catch (x) { busy = false; document.documentElement.classList.remove("smd-vt-back"); replay(); }
  }

  function boot() {
    try { new MutationObserver(handle).observe(document.body, { childList: true, attributes: true, attributeFilter: ["class", "style", "hidden"], subtree: true }); } catch (e) {}
    // Whatever is already on screen is the starting state, not an "open".
    setTimeout(function () {
      var kids = document.body.children;
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i]; if (skip(el)) continue;
        var cs = shownState(el);
        info.set(el, { vis: !!cs, disp: cs ? cs.display : "", own: cs ? selfAnimated(cs) : false });
      }
    }, 1500);
    document.addEventListener("click", onBack, true);
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
})();
