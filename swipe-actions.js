/* StewardMD — swipe a row to reveal its actions, like iOS Mail (swipe-actions.js).
 *
 * Swipe a list row left: it slides away from the right edge and a tray shows that row's OWN buttons
 * (Call, Labs, Remove...), up to three. The tray locks open past 40% (or on a flick) with a haptic
 * tick; tap an action to press the real control, tap anywhere else (or scroll) to close.
 * A full swipe never fires an action by itself: a stray swipe must not discharge or delete anyone.
 *
 * Generic, like long-press-preview.js (which it composes with: a horizontal move cancels the hold):
 * a row is a full-width tappable element that contains labelled buttons. Skipped: the left 28px
 * (edge swipe-back), horizontally scrolling lists (carousels), home's tool grid, inputs, [data-no-swipe].
 * Touchmove is non-passive only on the one row, only during the touch (iOS scroll performance).
 * Kill switch: localStorage smd_swipe_actions=0. */
(function () {
  "use strict";
  var TRAY_W = 76;   // px per action
  // Revealed width for n actions, capped so a row always keeps most of its content visible.
  function trayWidth(n, rowW) { return Math.min(Math.max(1, n) * TRAY_W, Math.round(rowW * 0.62)); }
  // Left swipe only: dx<0. Past the width it rubber-bands.
  function offset(dx, w) {
    if (dx >= 0) return 0;
    var m = -dx;
    return m <= w ? -m : -(w + Math.sqrt(m - w) * 3.2);
  }
  function shouldLock(dx, v, w) { return -dx > w * 0.4 || (-dx > 12 && v < -420); }
  function intent(dx, dy) {   // "h" | "v" | null (undecided)
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null;
    return Math.abs(dx) > Math.abs(dy) * 1.4 && dx < 0 ? "h" : "v";
  }
  function labelOf(text, aria, title) {
    var t = String(aria || title || text || "").replace(/\s+/g, " ").trim();
    return t.length >= 1 && t.length <= 20 ? t : "";
  }
  var seam = { trayWidth: trayWidth, offset: offset, shouldLock: shouldLock, intent: intent, labelOf: labelOf, TRAY_W: TRAY_W };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_swipe_actions") === "0") return; } catch (e) {}
  window.SMD_SWIPE_SEAM = seam;

  var ROW = "button,a[href],[role='button'],[onclick],[data-act]";
  var EXCLUDE = "#rnavToolsGrid,.rnav-tile,.rnav-tab,input,textarea,select,[contenteditable],[data-no-swipe],[data-no-peek],[class*='maik-comp'],#maikSheet,[role=menu],[data-dn-action]";
  var CTRL = "button,a[href],[role='button'],[onclick]";
  var DESTRUCT = /delete|remove|discard|cancel|no-?show|reject|leave|sign out|clear/i;

  function shown(el) {
    if (!el.getClientRects().length) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) { var cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return false; }
    return true;
  }
  function inHScroller(el) {
    for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 2) return true;
    }
    return false;
  }
  function rowish(el) { var r = el.getBoundingClientRect(); return r.width >= innerWidth * 0.7 && r.height >= 44 && r.height <= 220; }
  function rowFor(t) {
    if (!t || !t.closest || t.closest(EXCLUDE)) return null;
    var row = t.closest(ROW); if (!row) return null;
    var outer = row.parentElement && row.parentElement.closest(ROW);
    if (outer && !outer.closest(EXCLUDE) && rowish(outer)) row = outer;
    return rowish(row) ? row : null;
  }
  function actionsOf(row) {
    var out = [], c = row.querySelectorAll(CTRL);
    for (var i = 0; i < c.length && out.length < 3; i++) {
      var b = c[i]; if (b === row || !shown(b) || b.disabled) continue;
      var l = labelOf(b.textContent, b.getAttribute("aria-label"), b.getAttribute("title"));
      if (l) out.push({ label: l, el: b });
    }
    return out;
  }

  var open = null;    // { row, tray, w, timer }
  var swallowUntil = 0, g = null;

  function closeOpen(animate) {
    var o = open; if (!o) return; open = null;
    clearInterval(o.timer);
    var row = o.row, S = window.SMD_SPRING;
    var done = function () { row.style.transform = ""; row.style.willChange = ""; o.tray.remove(); };
    if (animate && S && !S.reduced() && row.isConnected) S.animate({ from: -o.w, to: 0, stiffness: 420, damping: 36, onUpdate: function (x) { row.style.transform = "translate3d(" + x + "px,0,0)"; o.tray.style.clipPath = clip(o.w, -x); }, onDone: done });
    else done();
  }
  function clip(w, revealed) { return "inset(0 0 0 " + Math.max(0, w - Math.max(0, revealed)) + "px)"; }

  function buildTray(row, acts, w) {
    var r = row.getBoundingClientRect(), cs = getComputedStyle(row);
    var t = document.createElement("div");
    t.setAttribute("role", "toolbar"); t.setAttribute("aria-label", "Row actions");
    t.style.cssText = "position:fixed;z-index:2147482400;display:flex;overflow:hidden;box-sizing:border-box;left:" + (r.right - w) + "px;top:" + r.top +
      "px;width:" + w + "px;height:" + r.height + "px;border-radius:0 " + cs.borderTopRightRadius + " " + cs.borderBottomRightRadius + " 0;clip-path:" + clip(w, 0);
    acts.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = a.label;
      var bad = DESTRUCT.test(a.label);
      b.style.cssText = "flex:1 1 0;min-width:0;border:0;color:#fff;background:" + (bad ? "#FF3B30" : "#0F766E") +
        ";font:600 13px/1.15 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;padding:0 6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;-webkit-tap-highlight-color:transparent";
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var el = a.el; closeOpen(true);
        setTimeout(function () { try { el.click(); } catch (x) {} }, 120);
      });
      t.appendChild(b);
    });
    document.body.appendChild(t);
    return t;
  }

  document.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) { g = null; return; }
    var t = e.target, x = e.touches[0].clientX;
    if (open && !(open.tray.contains(t))) { if (!open.row.contains(t)) closeOpen(true); }
    if (g) g.row.removeEventListener("touchmove", onMove, { passive: false });
    g = null;
    if (x < 28 || x > innerWidth - 6) return;
    var row = rowFor(t); if (!row || inHScroller(row)) return;
    var acts = actionsOf(row); if (!acts.length) return;
    var base = open && open.row === row ? -open.w : 0;
    g = { row: row, acts: acts, x0: x, y0: e.touches[0].clientY, active: false, dead: false, base: base, w: trayWidth(acts.length, row.getBoundingClientRect().width), v: 0, lx: x, lt: performance.now(), dx: 0 };
    row.addEventListener("touchmove", onMove, { passive: false });
  }, { passive: true, capture: true });

  function onMove(e) {
    if (!g || g.dead) return;
    var tch = e.touches[0], dx = tch.clientX - g.x0, dy = tch.clientY - g.y0;
    if (!g.active) {
      // A closed row only opens on a left swipe; an open row follows a horizontal drag either way.
      var it = g.base ? (Math.abs(dx) < 8 && Math.abs(dy) < 8 ? null : (Math.abs(dx) > Math.abs(dy) * 1.4 ? "h" : "v")) : intent(dx, dy);
      if (it === null) return;
      if (it === "v") { g.dead = true; return; }
      if (!open || open.row !== g.row) {
        if (open) closeOpen(false);
        g.tray = buildTray(g.row, g.acts, g.w);
        open = { row: g.row, tray: g.tray, w: g.w, timer: 0 };
      } else { clearInterval(open.timer); g.tray = open.tray; }
      g.active = true; g.row.style.willChange = "transform";
    }
    if (e.cancelable) e.preventDefault();
    var now = performance.now();
    if (now > g.lt) { g.v = 0.7 * g.v + 0.3 * ((tch.clientX - g.lx) / (now - g.lt) * 1000); g.lx = tch.clientX; g.lt = now; }
    g.dx = dx;
    var pos = g.base + dx, x = pos >= 0 ? 0 : offset(pos, g.w);
    g.row.style.transform = "translate3d(" + x + "px,0,0)";
    g.tray.style.clipPath = clip(g.w, Math.min(g.w, -x));
  }

  function release() {
    var st = g; g = null;
    if (!st) return;
    st.row.removeEventListener("touchmove", onMove, { passive: false });
    if (!st.active || !open || open.row !== st.row) return;
    swallowUntil = Date.now() + 350;
    var cur = parseFloat((/translate3d\((-?[\d.]+)px/.exec(st.row.style.transform) || [0, 0])[1]) || 0;
    var o = open, S = window.SMD_SPRING, lock = shouldLock(cur, st.v, st.w);
    var to = lock ? -st.w : 0;
    var upd = function (x) { st.row.style.transform = "translate3d(" + x + "px,0,0)"; o.tray.style.clipPath = clip(st.w, Math.min(st.w, -x)); };
    if (lock && !st.base) { try { window.SMD_HAPTICS && SMD_HAPTICS.medium(); } catch (x) {} }
    var fin = function () {
      if (!lock) { if (open === o) { open = null; } st.row.style.transform = ""; st.row.style.willChange = ""; o.tray.remove(); return; }
      // Open: close itself if the row is re-rendered away or moves (scroll / layout change).
      var r0 = st.row.getBoundingClientRect().top;
      o.timer = setInterval(function () { if (!st.row.isConnected || Math.abs(st.row.getBoundingClientRect().top - r0) > 2) closeOpen(false); }, 250);
    };
    if (S) S.animate({ from: cur, to: to, velocity: st.v, stiffness: 420, damping: 36, onUpdate: upd, onDone: fin });
    else { upd(to); fin(); }
  }
  document.addEventListener("touchend", release, { capture: true });
  document.addEventListener("touchcancel", release, { capture: true });
  document.addEventListener("scroll", function () { if (open) closeOpen(false); }, { capture: true, passive: true });
  // The finger lifting after a swipe must not "tap" the row.
  document.addEventListener("click", function (e) {
    if (Date.now() < swallowUntil && !(open && open.tray.contains(e.target))) { e.stopImmediatePropagation(); e.preventDefault(); swallowUntil = 0; }
  }, true);
})();
