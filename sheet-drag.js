/* StewardMD — drag-to-dismiss bottom sheets + iOS depth behind them (sheet-drag.js).
 *
 * Any bottom sheet in the app (home's #hvSheet "More" / settings sheets, the MaiK sheet, module
 * sheets) can be pulled down by its grabber/header, or by its content when that content is already
 * scrolled to the top, exactly like an iOS sheet. The sheet tracks the finger 1:1 downward and
 * rubber-bands upward, the scrim fades with it, and on release the finger's velocity decides:
 * a flick or a pull past ~28% dismisses (the spring carries the flick), anything else springs back.
 *
 * Dismissal reuses what the app already defines: the sheet's own scrim click, else its close
 * control. A sheet with neither is never made draggable (we never invent a way to close it).
 *
 * Depth: while home's sheet is open, the home screen behind it recedes (scale + rounded corners),
 * like an iOS page sheet, and comes forward again as the sheet is dragged away.
 *
 * Generic by design: nothing registers; a sheet is recognised at touchstart by its geometry (fixed,
 * full width, sitting on the bottom edge). Touch events only (mobile app); touchmove is cancelled
 * only once a sheet drag has actually begun, so scrolling and taps are untouched.
 * Kill switch: localStorage smd_sheet_drag=0 (smd_sheet_depth=0 for the depth effect alone). */
(function () {
  "use strict";
  // Pure decisions, exported for tests.
  function shouldDismiss(dy, v, h) { return dy > Math.max(60, h * 0.28) || (dy > 12 && v > 700); }
  function rubber(dy) { return dy >= 0 ? dy : -Math.sqrt(-dy) * 2.6; }
  function isBottomSheetRect(r, vw, vh) {
    return r.bottom >= vh - 2 && r.width >= vw * 0.9 && r.top > vh * 0.06 && r.height >= 120 && r.height < vh - 4;
  }
  var seam = { shouldDismiss: shouldDismiss, rubber: rubber, isBottomSheetRect: isBottomSheetRect };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  function off(k) { try { return localStorage.getItem(k) === "0"; } catch (e) { return false; } }
  if (off("smd_sheet_drag") && off("smd_sheet_depth")) return;
  window.SMD_SHEET_DRAG_SEAM = seam;

  var HANDLE_ZONE = 64;                 // px from the sheet top that always drags (grabber + title)
  // .pn-sheet-wrap: PrepNucleus sheets have their own drag (prep.js); never double it.
  var NO_DRAG = "input,textarea,select,[contenteditable=''],[contenteditable=true],[data-no-sheet-drag],canvas,video,.pn-sheet-wrap";

  function vis(el) {
    var cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0.05;
  }
  function findSheet(t) {
    var vw = innerWidth, vh = innerHeight;
    for (var n = t; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.position !== "fixed") continue;
      if (isBottomSheetRect(n.getBoundingClientRect(), vw, vh)) return n;
      return null;                       // first fixed ancestor is not a sheet: a full-screen page, a FAB...
    }
    return null;
  }
  // The scrim the app shows under this sheet: a visible, clickable, full-viewport fixed layer below
  // it, named like a scrim/backdrop. Else the sheet's own close control.
  function findDismiss(sheet) {
    var z = parseInt(getComputedStyle(sheet).zIndex, 10) || 0, best = null;
    var cands = document.querySelectorAll("[id$='Scrim'],[id$='scrim'],[class*='scrim'],[class*='backdrop'],[id$='Backdrop']");
    for (var i = 0; i < cands.length; i++) {
      var s = cands[i]; if (s === sheet || sheet.contains(s)) continue;
      var cs = getComputedStyle(s);
      if (cs.position !== "fixed" || !vis(s) || cs.pointerEvents === "none") continue;
      var r = s.getBoundingClientRect();
      if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) continue;
      var sz = parseInt(cs.zIndex, 10) || 0;
      if (sz > z) continue;
      if (!best || sz > best.z) best = { el: s, z: sz };
    }
    if (best) return { scrim: best.el, close: function () { best.el.click(); } };
    var c = sheet.querySelector("[data-act='close'],[aria-label^='Close'],[aria-label^='close'],[class*='-close'],[data-dismiss]");
    if (c && vis(c)) return { scrim: null, close: function () { c.click(); } };
    return null;
  }
  function scrollerIn(t, sheet) {
    for (var n = t; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
      if (n === sheet) break;
    }
    return null;
  }

  /* ---- depth: home recedes behind its sheet ---- */
  var home = null, depthOn = false, fixedKidsAt = 0, fixedKids = false;
  function homeEl() { return home && home.isConnected ? home : (home = document.getElementById("homeV2")); }
  function hasFixedKids(h) {
    var now = Date.now(); if (now - fixedKidsAt < 10000) return fixedKids;
    fixedKidsAt = now; fixedKids = false;
    var all = h.querySelectorAll("*");
    for (var i = 0; i < all.length && i < 4000; i++) {
      var p = getComputedStyle(all[i]).position;
      if ((p === "fixed") && all[i].getClientRects().length) { fixedKids = true; break; }
    }
    return fixedKids;
  }
  function depthAllowed() {
    if (off("smd_sheet_depth") || window.SMD_SPRING && window.SMD_SPRING.reduced()) return false;
    var h = homeEl(); return !!(h && h.classList.contains("on") && vis(h) && !hasFixedKids(h));
  }
  // p: 0 = fully receded (sheet open), 1 = home fully forward.
  function setDepth(p, animate) {
    var h = homeEl(); if (!h) return;
    var s = 0.94 + 0.06 * p, ty = 10 * (1 - p), rad = 14 * (1 - p);
    h.style.transition = animate ? "transform .42s cubic-bezier(.32,.72,0,1),border-radius .42s cubic-bezier(.32,.72,0,1)" : "none";
    h.style.transformOrigin = "50% 0";
    h.style.transform = p >= 1 ? "" : "translateY(" + ty + "px) scale(" + s + ")";
    h.style.borderRadius = p >= 1 ? "" : rad + "px";
    h.style.overflow = p >= 1 ? "" : "hidden";
    var root = document.documentElement;
    if (p < 1) root.classList.add("smd-sheet-depth");
    else if (!animate) root.classList.remove("smd-sheet-depth");
    else setTimeout(function () { if (!depthOn) root.classList.remove("smd-sheet-depth"); }, 440);
  }
  // Black behind the receded page, as on iOS (the body is never otherwise visible behind #homeV2).
  try {
    var st = document.createElement("style");
    st.textContent = "html.smd-sheet-depth,html.smd-sheet-depth body{background:#000!important}";
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}
  function syncDepth() {
    var want = document.body.classList.contains("hv-sheet-open") && depthAllowed();
    if (want === depthOn) return;
    depthOn = want;
    setDepth(want ? 0 : 1, true);
    if (!want) setTimeout(function () { var h = homeEl(); if (h && !depthOn) h.style.transition = ""; }, 460);
  }
  if (!off("smd_sheet_depth")) {
    var mo = new MutationObserver(syncDepth);
    var startObs = function () { if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["class"] }); };
    if (document.body) startObs(); else document.addEventListener("DOMContentLoaded", startObs);
  }

  /* ---- drag ---- */
  if (off("smd_sheet_drag")) return;
  var g = null;    // active gesture
  // In-flight release settle, owned by the shared controller: a touch OFF the sheet leaves it
  // running; a touch ON the sheet holds it where it is. A drag supersedes its completion; a
  // touch that never becomes a drag resumes it to its original target and completion.
  var settleCtl = window.SMD_SPRING && SMD_SPRING.makeSettle ? SMD_SPRING.makeSettle(SMD_SPRING.animate) : null;
  var flightSt = null, catchParked = false;
  function startSettle(st, from, to, vel, k, c, done) {
    flightSt = st;
    var wrap = function () { if (flightSt === st) flightSt = null; done(); };
    if (settleCtl) settleCtl.start({ from: from, to: to, velocity: vel, stiffness: k, damping: c, onUpdate: function (x) { paint(st, x); }, onDone: wrap });
    else done();
  }
  function resumeParked() { if (catchParked) { catchParked = false; if (settleCtl) settleCtl.resume(); } }

  document.addEventListener("touchstart", function (e) {
    var t = e.target, caught = false;
    if (flightSt && settleCtl) {
      var onEl = !!(t && (t === flightSt.sheet || (flightSt.sheet.contains && flightSt.sheet.contains(t))));
      if (settleCtl.touch(onEl) === "ignore") return;          // touch elsewhere: the settle finishes normally
      if (settleCtl.holding()) { caught = true; catchParked = true; }
    }
    if (g || e.touches.length !== 1) { if (g) { if (g.heldCatch && settleCtl) settleCtl.resume(); g.sheet.removeEventListener("touchmove", onMove, { passive: false }); } g = null; return; }
    if (!t || !t.closest || t.closest(NO_DRAG)) return;        // parked catch resumes on touchend
    var sheet = findSheet(t); if (!sheet) return;
    var sr = sheet.getBoundingClientRect(), y = e.touches[0].clientY;
    var sc = scrollerIn(t, sheet);
    var curY = parseFloat((/translate3d\(0,\s*(-?[\d.]+)px/.exec(sheet.style.transform) || [0, 0])[1]) || 0;
    g = { sheet: sheet, y0: y, x0: e.touches[0].clientX, h: sr.height, handle: y - sr.top < HANDLE_ZONE, base: caught ? (settleCtl.heldPos() || 0) : curY,
          heldCatch: caught,
          sc: sc, active: false, dead: false, dy: 0, tr: window.SMD_SPRING ? SMD_SPRING.tracker() : null, dismiss: null };
    if (caught) catchParked = false;
    // Non-passive touchmove ONLY on this sheet and only for this touch: a document-wide non-passive
    // listener makes iOS WebKit wait on JS before every scroll in the app (see prep.js, same lesson).
    sheet.addEventListener("touchmove", onMove, { passive: false });
  }, { passive: true, capture: true });

  function onMove(e) {
    if (!g || g.dead) return;
    var tch = e.touches[0], dy = tch.clientY - g.y0, dx = tch.clientX - g.x0;
    if (!g.active) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      var vertical = Math.abs(dy) > Math.abs(dx) * 1.2;
      var atTop = !g.sc || g.sc.scrollTop <= 0;
      if (!vertical || (!g.handle && !(dy > 0 && atTop))) { g.dead = true; return; }
      g.dismiss = findDismiss(g.sheet);
      if (!g.dismiss) { g.dead = true; return; }
      g.active = true; g.y0 = tch.clientY; dy = 0;            // start from here: no jump
      if (g.heldCatch) { g.heldCatch = false; if (settleCtl) settleCtl.supersede(); flightSt = null; }   // the drag decides now
      g.sheet.style.transition = "none"; g.sheet.style.willChange = "transform";
      if (g.dismiss.scrim) { g.scrimOp = parseFloat(getComputedStyle(g.dismiss.scrim).opacity) || 1; g.dismiss.scrim.style.transition = "none"; }
    }
    if (e.cancelable) e.preventDefault();
    g.dy = dy;
    if (g.tr) g.tr.add(dy, e.timeStamp || Date.now());
    paint(g, g.base + rubber(dy));
  }

  function paint(st, y) {
    st.sheet.style.transform = "translate3d(0," + y + "px,0)";
    var p = Math.max(0, Math.min(1, y / st.h));
    if (st.dismiss.scrim) st.dismiss.scrim.style.opacity = String(st.scrimOp * (1 - p));
    if (depthOn) setDepth(p, false);
  }
  function cleanup(st) {
    st.sheet.style.willChange = "";
    if (st.dismiss && st.dismiss.scrim) { st.dismiss.scrim.style.transition = ""; st.dismiss.scrim.style.opacity = ""; }
  }

  function end() {
    var st = g; g = null;
    if (st) st.sheet.removeEventListener("touchmove", onMove, { passive: false });
    if (!st) { resumeParked(); return; }
    if (!st.active) {   // tap / lost axis lock on a caught sheet: resume the original settle
      if (st.heldCatch) { st.heldCatch = false; if (settleCtl) settleCtl.resume(); }
      return;
    }
    var v = st.tr ? st.tr.velocity() : 0, y = st.base + rubber(st.dy), totalDy = st.base + st.dy;
    if (shouldDismiss(totalDy, v, st.h)) {
      var finish = function () {
        // Leave the sheet parked off-screen while the app closes it, then hand styling back to CSS.
        try { st.dismiss.close(); } catch (x) {}
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          st.sheet.style.transform = ""; st.sheet.style.transition = ""; cleanup(st);
          if (depthOn) syncDepth();
        }); });
      };
      startSettle(st, y, st.h + 20, Math.max(v, 900), 300, 38, finish);
    } else {
      var back = function () { st.sheet.style.transform = ""; st.sheet.style.transition = ""; cleanup(st); if (depthOn) setDepth(0, false); };
      startSettle(st, y, 0, v, 420, 34, back);
    }
  }
  document.addEventListener("touchend", end, { capture: true });
  document.addEventListener("touchcancel", end, { capture: true });
})();
