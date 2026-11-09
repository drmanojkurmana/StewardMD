/* StewardMD — shared spring animator (window.SMD_SPRING). Used by the premium-motion modules
 * (sheet-drag.js, pull-refresh.js, long-press-preview.js) so a gesture's release continues with
 * the finger's velocity instead of restarting on a fixed curve. Same physics as dynamic-notify.js.
 *
 *   var stop = SMD_SPRING.animate({ from, to, velocity, stiffness, damping, onUpdate(x), onDone() })
 *   SMD_SPRING.reduced()   true under prefers-reduced-motion (callers then jump to the end)
 *
 * Pure stepping is exported for node tests. rAF only while moving. */
(function () {
  "use strict";
  var DT = 1 / 240;
  function step(x, v, to, dt, k, c) { var a = -k * (x - to) - c * v; v += a * dt; return { x: x + v * dt, v: v }; }
  function settled(x, v, to) { return Math.abs(x - to) < 0.2 && Math.abs(v) < 4; }
  // Simulate to rest; returns frames (tests, and a fallback when rAF is unavailable).
  function simulate(from, to, v0, k, c, max) {
    var x = from, v = v0 || 0, n = 0, path = [];
    while (!settled(x, v, to) && n < (max || 2400)) { var r = step(x, v, to, DT, k, c); x = r.x; v = r.v; n++; if (n % 4 === 0) path.push(x); }
    return { steps: n, path: path };
  }
  // Settle-flight controller: owns one in-flight release settle so a touch can catch it.
  // touch(onElement): "ignore" (touch elsewhere: the settle finishes untouched), "hold"
  // (touch on the settling element: frozen where it is), "none" (nothing in flight).
  // While held, resume() re-runs the SAME settle to its original target with its original
  // completion (exactly once); supersede() drops that completion because a drag took over
  // and the drag's own release will start the next settle. start() supersedes any old one.
  function makeSettle(animateFn) {
    var flight = null, held = null;
    function dropFlight() { if (flight) { var f = flight; flight = null; if (f.stop) try { f.stop(); } catch (e) {} } }
    function start(o) {
      dropFlight(); held = null;
      var f = { to: o.to, update: o.onUpdate, done: o.onDone, k: o.stiffness, c: o.damping, current: o.from, stop: null };
      flight = f;
      f.stop = animateFn({ from: o.from, to: o.to, velocity: o.velocity || 0, stiffness: o.stiffness, damping: o.damping,
        onUpdate: function (x) { f.current = x; if (f.update) f.update(x); },
        onDone: function () { if (flight === f) flight = null; if (f.done) f.done(); } });
      return f;
    }
    function touch(onElement) {
      if (!flight) return "none";
      if (!onElement) return "ignore";
      held = flight; flight = null;
      if (held.stop) try { held.stop(); } catch (e) {}
      return "hold";
    }
    function resume(from) {
      if (!held) return false;
      var h = held;
      start({ from: typeof from === "number" ? from : h.current, to: h.to, velocity: 0, stiffness: h.k, damping: h.c, onUpdate: h.update, onDone: h.done });
      return true;
    }
    return { start: start, touch: touch, resume: resume,
      supersede: function () { held = null; },
      drop: function () { dropFlight(); held = null; },
      flying: function () { return !!flight; }, holding: function () { return !!held; },
      heldPos: function () { return held ? held.current : null; } };
  }
  var seam = { step: step, settled: settled, simulate: simulate, makeSettle: makeSettle };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined" || window.SMD_SPRING) return;

  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }

  function animate(o) {
    var k = o.stiffness || 380, c = o.damping || 34, x = o.from, v = o.velocity || 0, to = o.to;
    var raf = 0, last = 0, dead = false;
    function done() { dead = true; if (o.onUpdate) o.onUpdate(to); if (o.onDone) o.onDone(); }
    if (reduced() || typeof requestAnimationFrame !== "function") { done(); return function () {}; }
    function tick(now) {
      if (dead) return;
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      for (var i = Math.max(1, Math.round(dt / DT)); i > 0; i--) { var r = step(x, v, to, DT, k, c); x = r.x; v = r.v; }
      if (settled(x, v, to)) { done(); return; }
      if (o.onUpdate) o.onUpdate(x);
      raf = requestAnimationFrame(tick);
    }
    last = performance.now();
    raf = requestAnimationFrame(tick);
    return function stop() { dead = true; if (raf) cancelAnimationFrame(raf); };
  }

  // Velocity tracker for gestures: feed (value, timeMs); read px/s, smoothed over the last ~80ms.
  function tracker() {
    var pts = [];
    return {
      add: function (x, t) { pts.push([x, t]); while (pts.length > 2 && t - pts[0][1] > 80) pts.shift(); },
      velocity: function () {
        if (pts.length < 2) return 0;
        var a = pts[0], b = pts[pts.length - 1], dt = b[1] - a[1];
        return dt > 0 ? (b[0] - a[0]) / dt * 1000 : 0;
      }
    };
  }

  window.SMD_SPRING = { animate: animate, reduced: reduced, tracker: tracker, step: step, makeSettle: makeSettle };
})();
