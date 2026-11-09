/* StewardMD — pull-to-refresh with a spring and a haptic tick (pull-refresh.js).
 *
 * On any screen that has its own Refresh control (Ward Sync, the OPD dashboard, the queue board,
 * Alerts...), pulling the list down from the top drags it with resistance, a spinner winds up with
 * the pull, a light haptic ticks as it crosses the trigger line, and releasing past it presses that
 * screen's own Refresh control (so pull does exactly what the button does, no second code path).
 * The list holds open while the screen updates, then springs home.
 *
 * Generic: the Refresh control is found by its accessible name (aria-label / title starting
 * "Refresh") in the same top-level layer as the list. Modules can also register explicitly:
 *   SMD_pullRefresh.register(scrollerEl, function () { return promiseOrNothing; })
 * Non-passive touchmove only on the armed list, only during the touch (iOS scroll performance).
 * Kill switch: localStorage smd_pull_refresh=0. */
(function () {
  "use strict";
  var TRIGGER = 72, HOLD = 54, MAX = 150;
  // Resistance: tracks early, stiffens toward MAX.
  function resist(dy) { return dy <= 0 ? 0 : MAX * (1 - Math.exp(-dy / (MAX * 1.6))); }
  function triggered(pull) { return pull >= TRIGGER; }
  var seam = { resist: resist, triggered: triggered, TRIGGER: TRIGGER, HOLD: HOLD, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_pull_refresh") === "0") { window.SMD_pullRefresh = { register: function () {} }; return; } } catch (e) {}
  window.SMD_PTR_SEAM = seam;

  var registry = [];   // [{ el, fn }]
  var REFRESH = "[aria-label^='Refresh'],[title^='Refresh'],[aria-label^='refresh']";

  function vis(el) {
    if (!el || !el.getClientRects().length) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1) return false;
    }
    return true;
  }
  function scrollerOf(t) {
    for (var n = t; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && n.clientHeight > 200) return n;
    }
    return null;
  }
  function layerOf(el) { var n = el; while (n.parentElement && n.parentElement !== document.body) n = n.parentElement; return n; }
  function actionFor(sc) {
    for (var i = 0; i < registry.length; i++) if (registry[i].el === sc || registry[i].el.contains(sc)) return registry[i].fn;
    var layer = layerOf(sc), c = layer.querySelectorAll(REFRESH);
    for (var j = 0; j < c.length; j++) {
      if (vis(c[j]) && !c[j].disabled && c[j].getAttribute("aria-disabled") !== "true") {
        var btn = c[j]; return function () { btn.click(); };
      }
    }
    return null;
  }

  /* ---- spinner ---- */
  var spin = null;
  function spinner() {
    if (spin && spin.isConnected) return spin;
    spin = document.createElement("div");
    spin.setAttribute("aria-hidden", "true");
    spin.style.cssText = "position:fixed;left:50%;top:0;width:30px;height:30px;margin-left:-15px;z-index:2147482000;pointer-events:none;opacity:0;color:var(--v3-primary,var(--teal,#0F766E))";
    spin.innerHTML = '<svg viewBox="0 0 30 30" width="30" height="30" style="display:block"><circle cx="15" cy="15" r="10.5" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="2.6"/>' +
      '<circle class="smd-ptr-arc" cx="15" cy="15" r="10.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="66" stroke-dashoffset="66" transform="rotate(-90 15 15)"/></svg>';
    var st = document.createElement("style");
    st.textContent = "@keyframes smdPtrSpin{to{transform:rotate(360deg)}}.smd-ptr-busy svg{animation:smdPtrSpin .8s linear infinite}";
    document.head.appendChild(st);
    document.body.appendChild(spin);
    return spin;
  }
  function drawSpinner(top, pull, busy) {
    var s = spinner(), p = Math.min(1, pull / TRIGGER);
    s.classList.toggle("smd-ptr-busy", !!busy);
    s.style.transform = "translateY(" + (top + Math.max(0, pull / 2 - 15)) + "px) rotate(" + (busy ? 0 : p * 270) + "deg) scale(" + (0.6 + 0.4 * p) + ")";
    s.style.opacity = String(busy ? 1 : Math.min(1, p * 1.4));
    s.querySelector(".smd-ptr-arc").setAttribute("stroke-dashoffset", busy ? "44" : String(66 - 58 * p));
  }

  /* ---- gesture ---- */
  var g = null, busy = false;
  // In-flight settle (snap-back, spring to HOLD, final spring home), owned by the shared
  // controller: a touch OFF the scroller leaves it running; a touch ON it holds it where it
  // is. A drag continues from the held pull; a touch that never becomes a drag resumes the
  // original settle and its completion, exactly once.
  var settleCtl = window.SMD_SPRING && SMD_SPRING.makeSettle ? SMD_SPRING.makeSettle(SMD_SPRING.animate) : null;
  var flightSt = null, flightTo = 0, catchParked = false;
  function resumeParked() { if (catchParked) { catchParked = false; if (settleCtl) settleCtl.resume(); } }
  // Raw finger travel that produces a given resisted pull (inverse of resist), so a caught
  // pull continues on the same resistance curve instead of restarting from 0.
  function rawFor(pull) { return pull > 0 ? (pull >= MAX ? MAX * 8 : -MAX * 1.6 * Math.log(1 - pull / MAX)) : 0; }
  document.addEventListener("touchstart", function (e) {
    var t = e.target, caught = null;
    if (flightSt && settleCtl) {
      var onEl = !!(t && flightSt.sc.contains && flightSt.sc.contains(t));
      if (settleCtl.touch(onEl) === "ignore") return;          // touch elsewhere: the settle finishes normally
      if (settleCtl.holding()) { caught = { pos: settleCtl.heldPos() || 0, st: flightSt, to: flightTo }; catchParked = true; }
    }
    if (g || e.touches.length !== 1) return;
    if (busy && !caught) return;
    if (!t || !t.closest || t.closest("input,textarea,select,[contenteditable],canvas,[data-no-ptr]")) return;   // parked catch resumes on touchend
    var sc = scrollerOf(t); if (!sc || sc.scrollTop > 0) return;
    // Inside a bottom sheet a pull-down at the top dismisses the sheet (sheet-drag.js), as on iOS.
    var lr = layerOf(sc).getBoundingClientRect();
    if (lr.bottom >= innerHeight - 2 && lr.top > innerHeight * 0.06 && lr.height < innerHeight - 4) return;
    var fn = actionFor(sc); if (!fn) return;
    if (caught && sc !== caught.st.sc) return;
    g = { sc: sc, fn: fn, y0: e.touches[0].clientY, x0: e.touches[0].clientX, on: false, dead: false, pull: caught ? caught.pos : 0, armed: false,
          base: caught ? caught.pos : 0, raw0: caught ? rawFor(caught.pos) : 0, heldCatch: !!caught, caughtBusy: busy, heldTo: caught ? caught.to : null,
          tr: window.SMD_SPRING ? SMD_SPRING.tracker() : null, top: sc.getBoundingClientRect().top };
    if (caught) catchParked = false;
    sc.addEventListener("touchmove", move, { passive: false });
  }, { passive: true, capture: true });

  function move(e) {
    if (!g || g.dead) return;
    var dy = e.touches[0].clientY - g.y0, dx = e.touches[0].clientX - g.x0;
    if (!g.on) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || g.sc.scrollTop > 0) { g.dead = true; return; }
      g.on = true; g.y0 = e.touches[0].clientY; dy = 0;
      if (g.heldCatch && !g.caughtBusy) { g.heldCatch = false; if (settleCtl) settleCtl.supersede(); flightSt = null; }   // the drag decides now
      g.sc.style.transition = "none"; g.sc.style.willChange = "transform";
    }
    if (e.cancelable) e.preventDefault();
    g.pull = resist(g.raw0 + dy);
    if (g.tr) g.tr.add(g.pull, e.timeStamp || Date.now());
    g.sc.style.transform = "translate3d(0," + g.pull + "px,0)";
    drawSpinner(g.top, g.pull, false);
    var over = triggered(g.pull);
    if (over && !g.armed) { g.armed = true; try { window.SMD_HAPTICS && SMD_HAPTICS.light(); } catch (x) {} try { window.SMD_SOUND && SMD_SOUND.play("tick"); } catch (x) {} }
    else if (!over && g.armed) g.armed = false;
  }

  function springTo(st, to, v, done) {
    var put = function (x) { st.sc.style.transform = x ? "translate3d(0," + x + "px,0)" : ""; drawSpinner(st.top, x, to === HOLD); if (to === 0 && spin) spin.style.opacity = String(Math.min(1, x / TRIGGER)); };
    flightSt = st; flightTo = to;
    var wrap = function () { if (flightSt === st) flightSt = null; st.pull = to; put(to); if (done) done(); };
    if (settleCtl) settleCtl.start({ from: st.pull, to: to, velocity: v || 0, stiffness: 340, damping: 32, onUpdate: function (x) { st.pull = x; put(x); }, onDone: wrap });
    else { st.pull = to; put(to); if (done) done(); }
  }
  function release() {
    var st = g; g = null;
    if (!st) { resumeParked(); return; }
    st.sc.removeEventListener("touchmove", move, { passive: false });
    if (!st.on) {   // tap / lost axis lock on a caught pull: resume the original settle
      if (st.heldCatch) { st.heldCatch = false; if (settleCtl) settleCtl.resume(); }
      return;
    }
    if (st.caughtBusy) {   // dragged while a refresh settle was held: return to its target, refresh flow untouched
      st.heldCatch = false;
      if (settleCtl) settleCtl.resume(st.pull); else springTo(st, st.heldTo || HOLD, 0);
      return;
    }
    var v = st.tr ? st.tr.velocity() : 0;
    if (!triggered(st.pull)) { springTo(st, 0, v, function () { st.sc.style.willChange = ""; st.sc.style.transition = ""; }); return; }
    busy = true;
    springTo(st, HOLD, v);
    var t0 = Date.now(), finished = false, mo = null, quiet = 0;
    function finish() {
      if (finished) return; finished = true;
      try { mo && mo.disconnect(); } catch (x) {}
      var wait = Math.max(0, 650 - (Date.now() - t0));   // never flash: the spinner shows for at least 650ms
      setTimeout(function () {
        springTo(st, 0, 0, function () { busy = false; st.sc.style.willChange = ""; st.sc.style.transition = ""; if (spin) spin.style.opacity = "0"; });
      }, wait);
    }
    try {
      mo = new MutationObserver(function () { clearTimeout(quiet); quiet = setTimeout(finish, 250); });
      mo.observe(st.sc, { childList: true, subtree: true, characterData: true });
    } catch (x) {}
    setTimeout(finish, 4000);
    var r; try { r = st.fn(); } catch (x) { finish(); }
    if (r && typeof r.then === "function") r.then(finish, finish);
  }
  document.addEventListener("touchend", release, { capture: true });
  document.addEventListener("touchcancel", release, { capture: true });

  window.SMD_pullRefresh = {
    register: function (el, fn) { if (el && typeof fn === "function") registry.push({ el: el, fn: fn }); }
  };
})();
