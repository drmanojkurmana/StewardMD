/* kardia-sim-probe.js - Kardia probe for Echo Lab (WP4, plan sections 1.2, 1.8, 5 WP4/WP10, 9.3).
 *
 * ES5 IIFE, window.KARDIA_PROBE, module.exports under node. No DOM needed
 * for the maths; the touch and gyroscope binders use DOM only when called.
 *
 * Patient frame (kardia/views.json): x to patient left, y anterior,
 * z cranial, millimetres. A view plane is {origin, normal, up} in that
 * frame, exactly as KARDIA_GEOM.cut() and KARDIA_GEOM.viewPlane() use it.
 *
 * Probe state:
 *   { window, position:{x,y}, rotationDeg, tiltDeg, rockDeg, markerDeg,
 *     depthCm, omniplaneDeg, flexDeg, gyroOn }
 * TTE and POCUS: position is the slide on the chest map for the window,
 * in millimetres along the window marker axis (x) and normal axis (y).
 * rotationDeg turns the imaging plane about the beam (positive is
 * clockwise seen from the probe, looking along the beam). tiltDeg fans
 * the beam in the imaging plane. rockDeg rocks the beam out of plane.
 * markerDeg is the in-plane marker direction, kept equal to rotationDeg
 * offset from the window marker so a screen can draw the marker dot.
 * TEE (oesophageal and gastric windows): depthCm is the depth from the
 * incisors, omniplaneDeg is the multiplane angle (0 to 180), flexDeg is
 * anteflex when positive and retroflex when negative. rotationDeg is the
 * shaft turn about the oesophageal (cranial-caudal) axis, decoupled from
 * the omniplane crystal angle: turning the shaft swings the beam from
 * anterior (heart) round to posterior (descending aorta) while flex bends
 * the tip in the sagittal plane. position is the tip excursion from the
 * window anchor in millimetres (flex and oesophageal mobility move the
 * tip centimetres at full lock). The screen up of a TEE view is the
 * refitted views.json up, which is generally NOT opposite the beam, so
 * the TEE plane is built from an orthonormal (normal, up, beam) basis
 * spun by the omniplane angle about the beam (beam = normal x up).
 *
 * Orientation maths: a window has a base frame (marker M0, normal N0,
 * beam B0, orthonormal, N0 = cross(B0, M0) up to sign fixed at build).
 * The beam for a state is Rot(N0, tilt) * Rot(M0, rock) * B0 and the
 * plane normal is that same rotation applied after Rot(B0, rotation),
 * so rotation spins the plane about the final beam. stateForView()
 * inverts this exactly (see its comment), which is what makes every
 * target reachable inside the clamps by construction.
 *
 * Gyroscope ("Use phone as probe", opt-in, off by default): the phone
 * attitude {alpha, beta, gamma} in degrees (deviceorientation) is read
 * relative to a calibrate pose. beta drives tilt, gamma drives
 * rotation, alpha drives rock (wrapped to plus or minus 90 degrees,
 * because compass yaw is the least stable axis). A one-pole low-pass
 * filter (gyro maths below) smooths each sample. iOS permission is
 * requested only from the toggle tap, never on load.
 */
(function (G) {
  "use strict";

  /* ---------- vec helpers ---------- */
  function v3(x, y, z) { return [x, y, z]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)) || 1; }
  function norm(a) { var l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rad(d) { return d * Math.PI / 180; }
  function deg(r) { return r * 180 / Math.PI; }
  /* Rodrigues rotation of v about unit axis by angleDeg. */
  function rot(v, axis, angleDeg) {
    var a = norm(axis), t = rad(angleDeg), c = Math.cos(t), s = Math.sin(t);
    var cr = cross(a, v);
    var d = dot(a, v);
    return [v[0] * c + cr[0] * s + a[0] * d * (1 - c),
            v[1] * c + cr[1] * s + a[1] * d * (1 - c),
            v[2] * c + cr[2] * s + a[2] * d * (1 - c)];
  }
  function angleBetween(a, b) {
    var c = clamp(dot(norm(a), norm(b)), -1, 1);
    return deg(Math.acos(c));
  }
  function wrapDeg(d) {
    var x = d % 360;
    if (x > 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  }
  /* Wrap an attitude delta to plus or minus lim (for alpha yaw). */
  function wrapDelta(d, lim) { return clamp(wrapDeg(d), -lim, lim); }

  /* ---------- windows ----------
   * baseBeam/baseRef only seed the base frame; when views are supplied
   * the frame is rebuilt from the mean target beam and marker of that
   * window's views, so the needed tilt and rock stay small and inside
   * the clamps. Clamps are the anatomically possible ranges used on a
   * real chest for that window (slide in mm on the chest map). */
  var WINDOWS = {
    parasternal:  { label: "Parasternal",   beam: [-0.2, -0.98, 0], ref: [1, 0, 0], slideX: [-45, 45], slideY: [-55, 55], rotation: [-180, 180], tilt: [-80, 80], rock: [-60, 60] },
    apical:       { label: "Apical",        beam: [0, 0, 1],        ref: [1, 0, 0], slideX: [-35, 35], slideY: [-40, 40], rotation: [-180, 180], tilt: [-60, 60], rock: [-50, 50] },
    subcostal:    { label: "Subcostal",     beam: [0, 0.3, 1],      ref: [1, 0, 0], slideX: [-40, 40], slideY: [-45, 45], rotation: [-180, 180], tilt: [-90, 90], rock: [-60, 60] },
    suprasternal: { label: "Suprasternal",  beam: [0, -0.3, -1],    ref: [1, 0, 0], slideX: [-30, 30], slideY: [-35, 35], rotation: [-180, 180], tilt: [-65, 65], rock: [-50, 50] },
    abdominal:    { label: "Abdominal",     beam: [0, -1, 0.2],     ref: [0, 0, 1], slideX: [-60, 60], slideY: [-60, 60], rotation: [-180, 180], tilt: [-60, 60], rock: [-65, 65] },
    lung:         { label: "Lung",          beam: [-1, 0, 0],       ref: [0, 0, 1], slideX: [-45, 45], slideY: [-60, 60], rotation: [-180, 180], tilt: [-45, 45], rock: [-40, 40] },
    oesophageal:  { label: "Oesophageal (TEE)", beam: [0, 0.7071, -0.7071], ref: [1, 0, 0], slideX: [-25, 25], slideY: [-25, 25], rotation: [-180, 180], tilt: [0, 0], rock: [0, 0], tee: true, depth: [25, 45], flex: [-45, 60] },
    gastric:      { label: "Gastric (TEE)", beam: [0, 1, 0.3],      ref: [1, 0, 0], slideX: [-25, 25], slideY: [-25, 25], rotation: [-180, 180], tilt: [0, 0], rock: [0, 0], tee: true, depth: [40, 55] }
  };
  function windowDef(id) { return WINDOWS[id] || WINDOWS.parasternal; }
  function isTeeWindow(id) { var w = WINDOWS[id]; return !!(w && w.tee); }

  function frameFromBeam(beam, ref) {
    var B = norm(beam);
    var r = ref || [1, 0, 0];
    if (Math.abs(dot(B, norm(r))) > 0.9) r = [0, 0, 1];
    var M = norm(sub(r, mul(B, dot(r, B))));
    var N = norm(cross(B, M));
    /* Re-derive M so (M, N, B) is exactly orthonormal. */
    M = norm(cross(N, B));
    return { M: M, N: N, B: B };
  }

  /* ---------- low-pass filter (gyroscope) ---------- */
  /* One-pole filter: out = prev + alpha * (sample - prev). alpha from
   * the cutoff and the sample period: alpha = dt / (dt + RC),
   * RC = 1 / (2 * pi * fc). At fc 5 Hz and dt 16 ms alpha is about
   * 0.34, so hand tremor above 5 Hz is damped and the probe still
   * follows a deliberate move within about three samples. */
  function lowPassAlpha(cutoffHz, dtMs) {
    var dt = Math.max(1, dtMs || 16) / 1000;
    var rc = 1 / (2 * Math.PI * (cutoffHz || 5));
    return dt / (dt + rc);
  }
  function lowPass(prev, sample, alpha) { return prev + alpha * (sample - prev); }

  /* Gyroscope attitude to probe deltas, relative to a calibrate pose.
   * attitude and calibrate are {alpha, beta, gamma} in degrees, as
   * deviceorientation reports them. Returns {tiltDeg, rotationDeg,
   * rockDeg} deltas to add to the probe state at calibrate time. */
  function gyroDeltas(attitude, calibrate) {
    if (!attitude || !calibrate) return { tiltDeg: 0, rotationDeg: 0, rockDeg: 0 };
    return {
      tiltDeg: wrapDelta((attitude.beta || 0) - (calibrate.beta || 0), 90),
      rotationDeg: wrapDelta((attitude.gamma || 0) - (calibrate.gamma || 0), 120),
      rockDeg: wrapDelta((attitude.alpha || 0) - (calibrate.alpha || 0), 45)
    };
  }

  function create(options) {
    options = options || {};
    var viewsData = options.views || null;
    var geom = options.geom || null;
    var listeners = [];
    var gyroFilter = null;      /* {tilt, rotation, rock} filtered deltas */
    var gyroCalibrate = null;   /* attitude at calibrate time */
    var gyroBase = null;        /* probe state at calibrate time */
    var achievedSince = null;   /* ms timestamp, for the 1 s hold */

    function views() { return viewsData && viewsData.views ? viewsData.views : []; }
    function viewById(id) {
      var vs = views(), i;
      for (i = 0; i < vs.length; i++) if (vs[i].id === id) return vs[i];
      return null;
    }
    /* Target plane cache: one entry per view id holding the plane the
     * probe must reproduce plus the landmark refs actually visible in
     * the target cut (the scored "expected" set). Normal and up always
     * come from the CURRENT views.json entry. The origin starts at
     * geom.viewPlane's best origin and moves along the normal only when
     * a cut at the moved origin covers strictly more listed landmarks
     * (verified with geom.cut, the same cut the score uses), so views
     * that already cover everything keep the catalogue origin exactly.
     * Entries hold the frozen target the score compares against, so the
     * target does not swim while the heart beats. Copies go out;
     * setViews/setGeom clear the cache. */
    var targetCache = {};
    function cutSeen(tp) {
      if (!geom || !geom.cut) return null;
      var polys, seen = {}, i;
      try { polys = geom.cut(tp.origin, tp.normal, tp.up, 260, 260); } catch (e) { return null; }
      for (i = 0; i < polys.length; i++) seen[polys[i].ref] = 1;
      return seen;
    }
    function targetEntry(v) {
      if (targetCache[v.id]) return targetCache[v.id];
      var tp;
      if (geom && geom.viewPlane) tp = geom.viewPlane(v);
      else tp = { origin: [0, 0, 0], normal: norm(v.probe.normal), up: norm(v.probe.up), viewId: v.id };
      tp = { origin: tp.origin.slice(), normal: norm(tp.normal), up: norm(tp.up), viewId: v.id };
      var refs = (v.landmarks || []).map(function (lm) { return lm.ref; });
      var seen = cutSeen(tp);
      var hit = seen ? refs.filter(function (r) { return seen[r]; }) : refs.slice();
      if (seen && hit.length < refs.length) {
        var n = tp.normal, d0 = dot(tp.origin, n);
        var bestD = d0, bestHit = hit.length, k, d, cov, h2;
        for (k = -40; k <= 40; k += 4) {
          d = d0 + k;
          cov = cutSeen({ origin: mul(n, d), normal: n, up: tp.up });
          if (!cov) continue;
          h2 = refs.filter(function (r) { return cov[r]; }).length;
          if (h2 > bestHit || (h2 === bestHit && Math.abs(d - d0) < Math.abs(bestD - d0))) { bestHit = h2; bestD = d; }
        }
        for (k = -3; k <= 3; k += 1) {
          if (k === 0) continue;
          d = bestD + k;
          cov = cutSeen({ origin: mul(n, d), normal: n, up: tp.up });
          if (!cov) continue;
          h2 = refs.filter(function (r) { return cov[r]; }).length;
          if (h2 > bestHit || (h2 === bestHit && Math.abs(d - d0) < Math.abs(bestD - d0))) { bestHit = h2; bestD = d; }
        }
        if (bestHit > hit.length) {
          tp = { origin: mul(n, bestD), normal: n, up: tp.up, viewId: v.id };
          seen = cutSeen(tp);
          hit = seen ? refs.filter(function (r) { return seen[r]; }) : hit;
        }
      }
      var entry = { plane: tp, expected: seen ? refs.filter(function (r) { return seen[r]; }) : refs.slice() };
      targetCache[v.id] = entry;
      return entry;
    }
    function targetPlane(view) {
      var v = typeof view === "string" ? viewById(view) : view;
      if (!v) return { origin: [0, 0, 0], normal: [0, 1, 0], up: [0, 0, -1] };
      var e = targetEntry(v);
      return { origin: e.plane.origin.slice(), normal: e.plane.normal.slice(), up: e.plane.up.slice(), viewId: v.id };
    }
    function expectedRefs(view) {
      var v = typeof view === "string" ? viewById(view) : view;
      if (!v) return [];
      return targetEntry(v).expected.slice();
    }

    /* Window frame and anchor, derived from the window's own views
     * when data is present (mean beam, mean marker, mean target
     * origin), else from the static seed above. */
    var frameCache = {};
    function windowFrame(windowId) {
      if (frameCache[windowId]) return frameCache[windowId];
      var def = windowDef(windowId);
      var frame = frameFromBeam(def.beam, def.ref);
      var anchor = [0, 0, 0];
      var vs = views().filter(function (v) { return v.window === windowId; });
      /* Oesophageal frame is fixed by anatomy, not rebuilt from the
       * views: the neutral TEE beam points anterior and 45 degrees
       * caudal into the heart (ante/retroflexion bends the tip in the
       * sagittal plane, hence the patient-left marker axis), and the
       * anchor is the oesophageal lumen below. Rebuilding the frame
       * from the scattered TEE target beams would tip the flex circle
       * away from the caudal beams (mid-oesophageal two-chamber,
       * long-axis and bicaval) and strand them past full retroflexion. */
      if (windowId === "oesophageal") {
        frame = frameFromBeam([0, 0.7071, -0.7071], [1, 0, 0]);
        var oe2 = oesophagusAnchor();
        anchor = oe2 || anchor;
        var out0 = { M: frame.M, N: frame.N, B: frame.B, anchor: anchor, def: def };
        frameCache[windowId] = out0;
        return out0;
      }
      if (vs.length) {
        var bSum = [0, 0, 0], mSum = [0, 0, 0], oSum = [0, 0, 0], i;
        var planes = [];
        for (i = 0; i < vs.length; i++) {
          var tp = targetPlane(vs[i]);
          planes.push(tp);
          var B = mul(norm(tp.up), -1);
          var M = norm(cross(B, norm(tp.normal)));
          bSum = add(bSum, B); mSum = add(mSum, M); oSum = add(oSum, tp.origin);
        }
        if (len(bSum) > 1e-6) frame = frameFromBeam(bSum, len(mSum) > 1e-6 ? mSum : def.ref);
        anchor = mul(oSum, 1 / vs.length);
        /* Window centre: the point closest to every target plane of
         * the window (least squares over (A - origin) dot normal).
         * A mean of origins sits inside the heart and can leave a
         * view a long slide away; this centre is the chest point the
         * window's planes share, so each view is a short slide away. */
        var S = [[1e-6, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]], rhs = [0, 0, 0], r, c;
        planes.forEach(function (tp2) {
          var n = norm(tp2.normal), d = dot(tp2.origin, n);
          for (r = 0; r < 3; r++) { rhs[r] += n[r] * d; for (c = 0; c < 3; c++) S[r][c] += n[r] * n[c]; }
        });
        for (r = 0; r < 3; r++) {
          var piv = S[r][r];
          if (Math.abs(piv) < 1e-9) continue;
          for (c = 0; c < 3; c++) S[r][c] /= piv;
          rhs[r] /= piv;
          for (var r2 = 0; r2 < 3; r2++) {
            if (r2 === r) continue;
            var f = S[r2][r];
            for (c = 0; c < 3; c++) S[r2][c] -= f * S[r][c];
            rhs[r2] -= f * rhs[r];
          }
        }
        if (isFinite(rhs[0]) && isFinite(rhs[1]) && isFinite(rhs[2])) anchor = rhs;
        /* Anchor feasibility polish: the least-squares centre can sit
         * where one view's plane is nearly parallel to the slide plane
         * (subcostal short axis: transverse plane, transverse slide),
         * stranding that view millimetres off plane past the slide
         * stops. Nudge the anchor while every view's clamped slide
         * residual shrinks; keep the least-squares point when nothing
         * is stranded so settled windows are bit-identical. */
        anchor = refineAnchor(windowId, anchor, frame, vs);
      }
      var out = { M: frame.M, N: frame.N, B: frame.B, anchor: anchor, def: def };
      frameCache[windowId] = out;
      return out;
    }
    function anchorCost(windowId, anchor, frame, vs) {
      var c = clampsFor(windowId), cost = 0, i;
      for (i = 0; i < vs.length; i++) {
        var tp = targetPlane(vs[i]);
        var n = norm(tp.normal);
        var rel = sub(tp.origin, anchor);
        var pu = dot(rel, frame.M), pv = dot(rel, frame.N);
        var a1 = dot(frame.M, n), a2 = dot(frame.N, n);
        var rhs = dot(rel, n);
        var denom = a1 * a1 + a2 * a2;
        if (denom > 1e-9) {
          var k = (rhs - (a1 * pu + a2 * pv)) / denom;
          pu += a1 * k; pv += a2 * k;
        }
        var cx = clamp(pu, c.positionX[0], c.positionX[1]);
        var cy = clamp(pv, c.positionY[0], c.positionY[1]);
        var ox = anchor[0] + frame.M[0] * cx + frame.N[0] * cy;
        var oy = anchor[1] + frame.M[1] * cx + frame.N[1] * cy;
        var oz = anchor[2] + frame.M[2] * cx + frame.N[2] * cy;
        var d = Math.abs((ox - tp.origin[0]) * n[0] + (oy - tp.origin[1]) * n[1] + (oz - tp.origin[2]) * n[2]);
        cost += d * d + (pu - cx) * (pu - cx) + (pv - cy) * (pv - cy);
      }
      return cost;
    }
    function refineAnchor(windowId, anchor, frame, vs) {
      var def = windowDef(windowId);
      if (def.tee || !vs.length) return anchor;
      var cur = anchorCost(windowId, anchor, frame, vs);
      if (cur <= 1e-9) return anchor;
      var a = anchor.slice(), step = 4, it, t, improved;
      for (it = 0; it < 40; it++) {
        improved = false;
        var trials = [
          [a[0] + step, a[1], a[2]], [a[0] - step, a[1], a[2]],
          [a[0], a[1] + step, a[2]], [a[0], a[1] - step, a[2]],
          [a[0], a[1], a[2] + step], [a[0], a[1], a[2] - step]
        ];
        for (t = 0; t < trials.length; t++) {
          var c = anchorCost(windowId, trials[t], frame, vs);
          if (c < cur - 1e-12) { cur = c; a = trials[t]; improved = true; }
        }
        if (!improved) {
          step *= 0.5;
          if (step < 0.01) break;
        }
      }
      return a;
    }
    function oesophagusAnchor() {
      if (!geom || !geom.structures) return null;
      var ss, i, fallback = null;
      try { ss = geom.structures(); } catch (e) { return null; }
      for (i = 0; i < ss.length; i++) {
        if (ss[i].ref === "FJ2563") return ss[i].centroid.slice();
        if (ss[i].ref === "LIVE_esophagus") fallback = ss[i].centroid.slice();
      }
      return fallback;
    }

    /* ---------- state ---------- */
    function defaultState(windowId) {
      var def = windowDef(windowId);
      return {
        window: windowId || "parasternal",
        position: { x: 0, y: 0 },
        rotationDeg: 0, tiltDeg: 0, rockDeg: 0, markerDeg: 0,
        depthCm: def.tee ? (windowId === "gastric" ? 45 : 35) : 0,
        omniplaneDeg: 0, flexDeg: 0, gyroOn: false
      };
    }
    var state = defaultState("parasternal");

    function clampsFor(windowId) {
      var def = windowDef(windowId);
      return {
        positionX: def.slideX, positionY: def.slideY,
        rotationDeg: def.rotation, tiltDeg: def.tilt, rockDeg: def.rock,
        depthCm: def.depth || [25, 45], omniplaneDeg: [0, 180], flexDeg: def.flex || [-30, 60]
      };
    }
    function clampState(s) {
      var c = clampsFor(s.window), def = windowDef(s.window);
      s.position.x = clamp(+s.position.x || 0, c.positionX[0], c.positionX[1]);
      s.position.y = clamp(+s.position.y || 0, c.positionY[0], c.positionY[1]);
      if (def.tee) {
        /* rotationDeg is the shaft turn here, independent of the
         * omniplane crystal angle (see planeFor). */
        s.depthCm = clamp(+s.depthCm || c.depthCm[0], c.depthCm[0], c.depthCm[1]);
        s.omniplaneDeg = clamp(+s.omniplaneDeg || 0, 0, 180);
        s.flexDeg = clamp(+s.flexDeg || 0, c.flexDeg[0], c.flexDeg[1]);
        s.rotationDeg = clamp(+s.rotationDeg || 0, c.rotationDeg[0], c.rotationDeg[1]);
      } else {
        s.rotationDeg = clamp(+s.rotationDeg || 0, c.rotationDeg[0], c.rotationDeg[1]);
        s.tiltDeg = clamp(+s.tiltDeg || 0, c.tiltDeg[0], c.tiltDeg[1]);
        s.rockDeg = clamp(+s.rockDeg || 0, c.rockDeg[0], c.rockDeg[1]);
      }
      s.markerDeg = s.rotationDeg;
      return s;
    }
    function copyState(s) {
      return {
        window: s.window, position: { x: s.position.x, y: s.position.y },
        rotationDeg: s.rotationDeg, tiltDeg: s.tiltDeg, rockDeg: s.rockDeg, markerDeg: s.markerDeg,
        depthCm: s.depthCm, omniplaneDeg: s.omniplaneDeg, flexDeg: s.flexDeg, gyroOn: !!s.gyroOn,
        anteflexDeg: Math.max(0, s.flexDeg || 0), retroflexDeg: Math.max(0, -(s.flexDeg || 0))
      };
    }
    function emit() {
      var snap = copyState(state);
      listeners.forEach(function (fn) { try { fn(snap); } catch (e) {} });
    }
    function setState(partial) {
      if (!partial) return copyState(state);
      if (partial.window && WINDOWS[partial.window]) {
        var keepWindow = state.window === partial.window;
        state.window = partial.window;
        if (!keepWindow) {
          var fresh = defaultState(partial.window);
          state.position = fresh.position; state.depthCm = fresh.depthCm;
          state.omniplaneDeg = fresh.omniplaneDeg; state.flexDeg = fresh.flexDeg;
          if (!windowDef(partial.window).tee) { state.rotationDeg = 0; state.tiltDeg = 0; state.rockDeg = 0; }
        }
      }
      if (partial.position) {
        if (partial.position.x != null) state.position.x = +partial.position.x;
        if (partial.position.y != null) state.position.y = +partial.position.y;
      }
      var keys = ["rotationDeg", "tiltDeg", "rockDeg", "depthCm", "omniplaneDeg", "flexDeg"], i;
      for (i = 0; i < keys.length; i++) if (partial[keys[i]] != null) state[keys[i]] = +partial[keys[i]];
      if (partial.gyroOn != null) state.gyroOn = !!partial.gyroOn;
      clampState(state);
      emit();
      return copyState(state);
    }
    function getState() { return copyState(state); }

    /* ---------- plane from state ---------- */
    function planeFor(s) {
      var wf = windowFrame(s.window), def = wf.def;
      var origin;
      if (def.tee) {
        /* TEE: shaft turn about the cranial-caudal axis, flex bend of
         * the tip, then the omniplane crystal spin about the beam. The
         * basis (e1, e2, beam) is orthonormal with beam = e1 x e2, so
         * the refitted screen up is matched exactly rather than forced
         * opposite the beam. Depth runs down the oesophagus (caudal is
         * minus z); the window anchor sits at the reference depth. */
        var shaft = s.rotationDeg, flex = s.flexDeg, omni = s.omniplaneDeg;
        var zAxis = v3(0, 0, 1);
        var beam = norm(rot(rot(wf.B, wf.M, flex), zAxis, shaft));
        var e1 = norm(rot(rot(wf.N, wf.M, flex), zAxis, shaft));
        var e2 = norm(cross(beam, e1));
        var normal = norm(rot(e1, beam, omni));
        var up = norm(rot(e2, beam, omni));
        var markerBase = norm(rot(rot(wf.M, wf.M, flex), zAxis, shaft));
        var marker = norm(rot(markerBase, beam, omni));
        var refDepth = s.window === "gastric" ? 45 : 35;
        origin = add(wf.anchor, add(mul(wf.M, s.position.x), mul(wf.N, s.position.y)));
        origin = add(origin, mul(v3(0, 0, -1), (s.depthCm - refDepth) * 10));
        return { origin: origin, normal: normal, up: up, marker: marker, beam: beam, window: s.window };
      }
      var rotation = s.rotationDeg;
      var tilt = s.tiltDeg;
      var rock = s.rockDeg;
      /* v' = Rot(N0, tilt) * Rot(M0, rock) * Rot(B0, rotation) * v */
      function xf(v) { return rot(rot(rot(v, wf.B, rotation), wf.M, rock), wf.N, tilt); }
      var normal2 = norm(xf(wf.N));
      var beam2 = norm(rot(rot(wf.B, wf.M, rock), wf.N, tilt));
      var up2 = mul(beam2, -1);
      var marker2 = norm(xf(wf.M));
      origin = add(wf.anchor, add(mul(wf.M, s.position.x), mul(wf.N, s.position.y)));
      return { origin: origin, normal: normal2, up: up2, marker: marker2, beam: beam2, window: s.window };
    }
    function plane() { return planeFor(state); }

    /* Inverse of planeFor: the state whose plane matches the target
     * plane of a view. Non-TEE windows invert the forward map in closed
     * form. Beam first: with B written in the window frame as (x along
     * M0, y along N0, z along B0), the forward beam is (sin tilt * cos
     * rock, minus sin rock, cos tilt * cos rock), so rock =
     * asin(minus y) and tilt = atan2(x, z). Rotation is then the angle
     * about the final beam from the intermediate normal to the target
     * normal. Slide solves the slide plane meeting the target plane,
     * nearest the projected target origin. TEE solves numerically (see
     * solveTee): orientation (shaft turn, flex, omniplane) first, then
     * origin (slide, depth), which decouple. Every view is solved
     * within its window clamps. */
    var teeSolveCache = {};
    function teeBasis(wf, shaftDeg, flexDeg) {
      var zAxis = v3(0, 0, 1);
      var beam = norm(rot(rot(wf.B, wf.M, flexDeg), zAxis, shaftDeg));
      var e1 = norm(rot(rot(wf.N, wf.M, flexDeg), zAxis, shaftDeg));
      return { beam: beam, e1: e1, e2: norm(cross(beam, e1)) };
    }
    /* Omniplane candidates for one (shaft, flex) basis: the analytic
     * spin about the beam plus its 180-degree aliases, kept inside the
     * 0 to 180 crystal range. The caller minimises the returned error. */
    function teeOmniCandidates(wf, tp, shaftDeg, flexDeg) {
      var b = teeBasis(wf, shaftDeg, flexDeg);
      var n = norm(tp.normal), u = norm(tp.up);
      var omni = deg(Math.atan2(dot(cross(b.e1, n), b.beam), clamp(dot(b.e1, n), -1, 1)));
      var cands = [omni, omni + 180, omni - 180], out = [], i;
      for (i = 0; i < cands.length; i++) {
        var o = cands[i];
        if (o < 0 || o > 180) continue;
        var nn = norm(rot(b.e1, b.beam, o)), uu = norm(rot(b.e2, b.beam, o));
        var e1 = angleBetween(nn, n) + angleBetween(uu, u);
        var e2 = angleBetween(nn, mul(n, -1)) + angleBetween(uu, mul(u, -1));
        out.push({ omni: o, err: Math.min(e1, e2) });
      }
      if (!out.length) {
        var nn2 = norm(rot(b.e1, b.beam, 0)), uu2 = norm(rot(b.e2, b.beam, 0));
        return { omni: 0, err: angleBetween(nn2, n) + angleBetween(uu2, u) };
      }
      out.sort(function (a, b2) { return a.err - b2.err; });
      return out[0];
    }
    function teeOriented(wf, tp, shaft, flex) {
      var c = teeOmniCandidates(wf, tp, shaft, flex);
      return { shaft: shaft, flex: flex, omni: c.omni, err: c.err };
    }
    /* TEE orientation, solved analytically. The forward beam is
     * Rot(z, shaft) * Rot(M0, flex) * B0 with z the oesophageal axis,
     * and the plane normal x up always equals the beam, so the beam
     * must equal targetNormal x targetUp exactly. Shaft rotation keeps
     * the world z of the beam, so flex follows from the z equation
     * Bz*cos(f) + Kz*sin(f) = beamTz with K = M0 x B0 (at most two
     * flex branches), then shaft from the xy-plane angle, then the
     * omniplane analytically. Each branch is polished by a short
     * clamped descent and the best is kept. */
    function solveTeeOrientation(wf, tp, flexLo, flexHi) {
      var n = norm(tp.normal), u = norm(tp.up);
      var bt = norm(cross(n, u));
      var K = cross(wf.M, wf.B);
      var Bz = wf.B[2], Kz = K[2];
      var R = Math.sqrt(Bz * Bz + Kz * Kz);
      var best = null, i;
      function consider(shaft, flex) {
        var r = polishTee(wf, tp, shaft, flex, flexLo, flexHi);
        if (!best || r.err < best.err) best = r;
      }
      if (R > 1e-9) {
        var phi = deg(Math.atan2(Kz, Bz));
        var c = clamp(bt[2] / R, -1, 1);
        var da = deg(Math.acos(c));
        var fs = [phi + da, phi - da];
        for (i = 0; i < fs.length; i++) {
          var f = fs[i];
          while (f > 180) f -= 360;
          while (f < -180) f += 360;
          if (f < flexLo || f > flexHi) continue;
          var m = rot(wf.B, wf.M, f);
          var s = deg(Math.atan2(m[0] * bt[1] - m[1] * bt[0], m[0] * bt[0] + m[1] * bt[1]));
          consider(s, f);
        }
      }
      if (!best) {
        var shafts = [0, 90, 180, -90];
        for (i = 0; i < shafts.length; i++) consider(shafts[i], 0);
      }
      return best;
    }
    function polishTee(wf, tp, shaft0, flex0, flexLo, flexHi) {
      var shaft = shaft0, flex = flex0, stepS = 6, stepF = 4, it, t, cur, nxt;
      cur = teeOriented(wf, tp, shaft, flex);
      for (it = 0; it < 32; it++) {
        var improved = false;
        var trials = [[shaft + stepS, flex], [shaft - stepS, flex], [shaft, flex + stepF], [shaft, flex - stepF]];
        for (t = 0; t < trials.length; t++) {
          var sh = trials[t][0], fl = trials[t][1];
          if (sh > 180 || sh < -180 || fl > flexHi || fl < flexLo) continue;
          nxt = teeOriented(wf, tp, sh, fl);
          if (nxt.err < cur.err - 1e-9) { cur = nxt; shaft = sh; flex = fl; improved = true; }
        }
        if (!improved) {
          stepS *= 0.5; stepF *= 0.5;
          if (stepS < 0.002 && stepF < 0.002) break;
        }
      }
      return cur;
    }
    function solveTeeOrigin(wf, tp, windowId) {
      var refDepth = windowId === "gastric" ? 45 : 35;
      var c = clampsFor(windowId);
      var n = norm(tp.normal);
      function distOf(x, y, d) {
        var o = add(wf.anchor, add(mul(wf.M, x), mul(wf.N, y)));
        o = add(o, mul(v3(0, 0, -1), (d - refDepth) * 10));
        return Math.abs(dot(sub(o, tp.origin), n));
      }
      var sx = 0, sy = 0, depth = clamp(refDepth - (tp.origin[2] - wf.anchor[2]) / 10, c.depthCm[0], c.depthCm[1]);
      var stepX = 4, stepY = 4, stepD = 1, it, t;
      var cur = distOf(sx, sy, depth);
      for (it = 0; it < 60; it++) {
        var improved = false;
        var trials = [
          [sx + stepX, sy, depth], [sx - stepX, sy, depth],
          [sx, sy + stepY, depth], [sx, sy - stepY, depth],
          [sx, sy, depth + stepD], [sx, sy, depth - stepD]
        ];
        for (t = 0; t < trials.length; t++) {
          var x = trials[t][0], y = trials[t][1], d = trials[t][2];
          if (x > c.positionX[1] || x < c.positionX[0] || y > c.positionY[1] || y < c.positionY[0]) continue;
          if (d > c.depthCm[1] || d < c.depthCm[0]) continue;
          var e = distOf(x, y, d);
          if (e < cur - 1e-9) { cur = e; sx = x; sy = y; depth = d; improved = true; }
        }
        if (!improved) {
          stepX *= 0.5; stepY *= 0.5; stepD *= 0.5;
          if (stepX < 0.002 && stepD < 0.0005) break;
        }
      }
      return { x: sx, y: sy, depth: depth };
    }
    function solveTee(wf, tp, windowId) {
      var c = clampsFor(windowId);
      var o = solveTeeOrientation(wf, tp, c.flexDeg[0], c.flexDeg[1]);
      var g = solveTeeOrigin(wf, tp, windowId);
      var s = defaultState(windowId);
      s.position.x = g.x; s.position.y = g.y;
      s.rotationDeg = o.shaft; s.flexDeg = o.flex; s.omniplaneDeg = o.omni; s.depthCm = g.depth;
      return clampState(s);
    }
    function stateForPlane(tp, windowId) {
      var wf = windowFrame(windowId), def = wf.def;
      if (def.tee) return solveTee(wf, tp, windowId);
      var Bt = mul(norm(tp.up), -1);
      var bx = dot(Bt, wf.M), by = dot(Bt, wf.N), bz = dot(Bt, wf.B);
      var rock = deg(Math.asin(clamp(-by, -1, 1)));
      var tilt = deg(Math.atan2(bx, bz));
      function xfNoRot(v) { return rot(rot(v, wf.M, rock), wf.N, tilt); }
      var nMid = norm(xfNoRot(wf.N));
      var beam = norm(xfNoRot(wf.B));
      var rotation = deg(Math.atan2(dot(cross(nMid, norm(tp.normal)), beam), clamp(dot(nMid, norm(tp.normal)), -1, 1)));
      /* rotation about the beam is clockwise from the probe: the
       * Rodrigues sign above gives the mathematical angle about the
       * beam axis pointing away from the probe, which reads clockwise
       * to the operator holding the probe. Kept as is, and the hint
       * wording follows this sign. */
      var s = defaultState(windowId);
      s.rotationDeg = rotation; s.tiltDeg = tilt; s.rockDeg = rock;
      /* Slide: nearest point of (slide plane intersect target
       * plane) to the target origin projected on the slide plane. */
      var rel = sub(tp.origin, wf.anchor);
      var pu = dot(rel, wf.M), pv = dot(rel, wf.N);
      var a1 = dot(wf.M, norm(tp.normal)), a2 = dot(wf.N, norm(tp.normal));
      var rhs = dot(rel, norm(tp.normal));
      var denom = a1 * a1 + a2 * a2;
      if (denom > 1e-9) {
        /* move (pu, pv) the shortest way onto a1*u + a2*v = rhs */
        var k = (rhs - (a1 * pu + a2 * pv)) / denom;
        pu += a1 * k; pv += a2 * k;
      }
      s.position.x = pu; s.position.y = pv;
      return clampState(s);
    }
    function stateForView(view) {
      var v = typeof view === "string" ? viewById(view) : view;
      if (!v) return null;
      var tp = targetPlane(v);
      if (isTeeWindow(v.window)) {
        if (teeSolveCache[v.id]) {
          var c2 = teeSolveCache[v.id];
          var s2 = defaultState(v.window);
          s2.position.x = c2.x; s2.position.y = c2.y;
          s2.rotationDeg = c2.rotationDeg; s2.flexDeg = c2.flexDeg;
          s2.omniplaneDeg = c2.omniplaneDeg; s2.depthCm = c2.depthCm;
          s2.markerDeg = c2.rotationDeg;
          return s2;
        }
        var solved = solveTee(windowFrame(v.window), tp, v.window);
        teeSolveCache[v.id] = {
          x: solved.position.x, y: solved.position.y, rotationDeg: solved.rotationDeg,
          flexDeg: solved.flexDeg, omniplaneDeg: solved.omniplaneDeg, depthCm: solved.depthCm
        };
        return solved;
      }
      return stateForPlane(tp, v.window);
    }
    function setToView(view) {
      var s = stateForView(view);
      if (s) setState(s);
      return getState();
    }

    /* ---------- quality score ---------- */
    /* Landmarks present in a cut(): refs of the view landmarks that
     * appear in the polygons KARDIA_GEOM.cut returns for a plane. */
    function landmarksInCut(pl, view) {
      if (!geom || !geom.cut) return null;
      var polys = geom.cut(pl.origin, pl.normal, pl.up, 260, 260);
      var present = {};
      polys.forEach(function (p) { present[p.ref] = true; });
      return (view.landmarks || []).map(function (lm) {
        return { ref: lm.ref, name: lm.name, present: !!present[lm.ref] };
      });
    }
    var APEX_REF = "lv_apex";
    function score(view, opts) {
      opts = opts || {};
      var v = typeof view === "string" ? viewById(view) : view;
      if (!v) return null;
      var tp = targetPlane(v);
      var pl = opts.plane || plane();
      var tolD = (v.tolerance && v.tolerance.distanceMm) || 5;
      var tolA = (v.tolerance && v.tolerance.angleDeg) || 8;
      var distanceMm = Math.abs(dot(sub(pl.origin, tp.origin), norm(tp.normal)));
      var angleDeg = angleBetween(pl.normal, tp.normal);
      var upDeg = angleBetween(pl.up, tp.up);
      /* Joint sign invariance: the catalogue normal/up signs are a
       * convention, and (normal, up) and (-normal, -up) are the same
       * geometric plane with mirrored display. The probe locates the
       * plane; the marker carries the display sense. Score the better
       * of the two joint signs so a sign flip forced by the
       * omniplane crystal range cannot cap a target below 100. A lone
       * normal flip (upside-down TTE) still scores its full error. */
      var angleErr = Math.min(
        Math.max(angleDeg, upDeg * 0.7),
        Math.max(180 - angleDeg, (180 - upDeg) * 0.7));
      /* Landmarks: from cut() when a geometry is wired, else from the
       * caller (Echo Lab may pass a precomputed cut), else estimated
       * as present only inside tolerance, marked estimated. Only the
       * landmarks visible in the TARGET cut (the "expected" set) enter
       * the score: a landmark the refitted plane itself cannot show in
       * the current geometry (a part with no mesh, or one lying off a
       * refitted plane) must not cap the target at less than 100. Hints
       * name missing expected landmarks only, so the target readout
       * carries no spurious "missing" hint. */
      var landmarks = opts.landmarks || null, estimated = false;
      if (!landmarks && geom && geom.cut && !opts.noCut) landmarks = landmarksInCut(pl, v);
      if (!landmarks) {
        estimated = true;
        var inside = distanceMm <= tolD && angleErr <= tolA;
        landmarks = (v.landmarks || []).map(function (lm) { return { ref: lm.ref, name: lm.name, present: inside }; });
      }
      var lmTotal = landmarks.length || 1;
      var lmPresent = landmarks.filter(function (l) { return l.present; }).length;
      var expRefs = null;
      if (!estimated && geom && geom.cut && !opts.noCut) expRefs = expectedRefs(v);
      var scored = expRefs ? landmarks.filter(function (l) { return expRefs.indexOf(l.ref) >= 0; }) : landmarks;
      var scoredTotal = scored.length;
      var scoredPresent = scored.filter(function (l) { return l.present; }).length;
      var lmScore = scoredTotal ? scoredPresent / scoredTotal : 1;
      /* Foreshortening: only scored for apical views that carry the
       * apex landmark. Error is the apex distance from the current
       * plane beyond its distance from the target plane, so the
       * target itself scores full marks. The apex point is the
       * landmark centroid when the geometry exposes it, else the
       * target plane point offset is used and the term is neutral. */
      var foreScore = 1, foreMm = 0, hasFore = false;
      var isApical = v.window === "apical" && (v.landmarks || []).some(function (l) { return l.ref === APEX_REF; });
      if (isApical) {
        hasFore = true;
        var apex = opts.apexPoint || null;
        if (!apex && geom && geom.structures) {
          var structs = geom.structures();
          for (var i = 0; i < structs.length; i++) if (structs[i].ref === APEX_REF) { apex = structs[i].centroid; break; }
        }
        if (apex) {
          var curD = Math.abs(dot(sub(apex, pl.origin), norm(pl.normal)));
          var tgtD = Math.abs(dot(sub(apex, tp.origin), norm(tp.normal)));
          foreMm = Math.max(0, curD - tgtD);
          foreScore = clamp(1 - foreMm / 18, 0, 1);
        }
      }
      var distScore = clamp(1 - distanceMm / (tolD * 4), 0, 1);
      /* The angle curve reaches zero at three tolerances: a plane 15
       * degrees off target must read below 90 for every view, including
       * the widest-tolerance (15 degree) lung windows. */
      var angScore = clamp(1 - angleErr / (tolA * 3), 0, 1);
      var total;
      if (hasFore) total = 100 * (0.28 * distScore + 0.28 * angScore + 0.26 * lmScore + 0.18 * foreScore);
      else total = 100 * (0.34 * distScore + 0.34 * angScore + 0.32 * lmScore);
      total = Math.round(clamp(total, 0, 100));
      /* Hints, in the order a sonographer corrects: slide, rotate,
       * tilt, rock (or depth and omniplane for TEE). */
      var hints = [];
      var target = stateForView(v);
      var def = windowDef(v.window);
      if (target) {
        if (def.tee) {
          var dDepth = target.depthCm - state.depthCm;
          if (Math.abs(dDepth) >= 1) hints.push((dDepth > 0 ? "Advance the probe " : "Withdraw the probe ") + Math.abs(Math.round(dDepth)) + " cm");
          var dShaft = wrapDeg(target.rotationDeg - state.rotationDeg);
          if (Math.abs(dShaft) >= 5) hints.push(dShaft > 0 ? "Turn the probe shaft clockwise" : "Turn the probe shaft anticlockwise");
          var dOmni = target.omniplaneDeg - state.omniplaneDeg;
          if (Math.abs(dOmni) >= 3) hints.push("Turn the omniplane to " + Math.round(target.omniplaneDeg) + " degrees");
          var dFlex = target.flexDeg - state.flexDeg;
          if (Math.abs(dFlex) >= 3) hints.push(dFlex > 0 ? "Anteflex a little more" : "Ease the anteflex back");
        } else {
          var dx = target.position.x - state.position.x;
          var dy = target.position.y - state.position.y;
          if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) {
            if (Math.abs(dx) >= Math.abs(dy)) hints.push(dx > 0 ? "Slide towards the apex side of the window" : "Slide back from the apex side of the window");
            else hints.push(dy > 0 ? "Slide up the chest within the window" : "Slide down the chest within the window");
            if (v.window === "apical" && Math.abs(dx) >= 3) hints[0] = dx > 0 ? "Slide towards the apex" : "Slide away from the apex, back over the apex point";
          }
          var dRot = wrapDeg(target.rotationDeg - state.rotationDeg);
          if (Math.abs(dRot) >= 3) hints.push(dRot > 0 ? "Rotate clockwise" : "Rotate anticlockwise");
          var dTilt = target.tiltDeg - state.tiltDeg;
          if (Math.abs(dTilt) >= 3) hints.push(dTilt > 0 ? "Tilt (fan) the probe further" : "Tilt (fan) the probe back");
          var dRock = target.rockDeg - state.rockDeg;
          if (Math.abs(dRock) >= 3) hints.push(dRock > 0 ? "Rock the probe one way" : "Rock the probe the other way");
        }
      }
      var missing = (expRefs ? landmarks.filter(function (l) { return expRefs.indexOf(l.ref) >= 0 && !l.present; }) : landmarks.filter(function (l) { return !l.present; }));
      if (missing.length && lmScore < 1) hints.push("Missing in this cut: " + missing.slice(0, 3).map(function (l) { return l.name; }).join(", "));
      if (hasFore && foreMm > 4) hints.push("Foreshortened: the true apex is out of plane, slide and tilt to bring the apex in");
      var within = distanceMm <= tolD && angleErr <= tolA;
      return {
        viewId: v.id, score: total,
        distanceMm: Math.round(distanceMm * 10) / 10, angleDeg: Math.round(angleErr * 10) / 10,
        normalAngleDeg: Math.round(angleDeg * 10) / 10, upAngleDeg: Math.round(upDeg * 10) / 10,
        foreshorteningMm: Math.round(foreMm * 10) / 10, hasForeshortening: hasFore,
        landmarks: landmarks, landmarksPresent: lmPresent, landmarksTotal: lmTotal, landmarksEstimated: estimated,
        landmarksExpected: expRefs ? expRefs.length : lmTotal,
        components: { distance: Math.round(distScore * 100), angle: Math.round(angScore * 100), landmarks: Math.round(lmScore * 100), foreshortening: Math.round(foreScore * 100) },
        hints: hints, withinTolerance: within,
        tolerance: { distanceMm: tolD, angleDeg: tolA }
      };
    }
    /* "View achieved" needs the plane held inside tolerance for a
     * full second. Call tick() (or score with opts.nowMs) on each
     * frame; achieved flips true only after 1000 ms inside. */
    function tick(view, nowMs, opts) {
      var r = score(view, opts || {});
      if (!r) return { achieved: false, heldMs: 0, result: null };
      var now = nowMs == null ? (typeof Date !== "undefined" ? Date.now() : 0) : nowMs;
      if (r.withinTolerance) {
        if (achievedSince == null) achievedSince = now;
      } else achievedSince = null;
      var held = achievedSince == null ? 0 : now - achievedSince;
      return { achieved: held >= 1000, heldMs: held, result: r };
    }
    function resetAchieved() { achievedSince = null; }

    /* ---------- gyroscope ---------- */
    function gyroSupported() {
      return typeof G !== "undefined" && !!G && typeof G.addEventListener === "function" &&
        (typeof G.DeviceOrientationEvent !== "undefined" || typeof G.DeviceMotionEvent !== "undefined");
    }
    /* iOS 13 and later: permission must be asked from a user gesture.
     * Resolves true when motion may be used. Never throws. */
    function requestGyroPermission() {
      try {
        var DOE = G.DeviceOrientationEvent, DME = G.DeviceMotionEvent;
        var ask = (DOE && typeof DOE.requestPermission === "function") ? DOE.requestPermission
          : (DME && typeof DME.requestPermission === "function") ? DME.requestPermission : null;
        if (!ask) return Promise.resolve(gyroSupported());
        return ask.call(DOE && typeof DOE.requestPermission === "function" ? DOE : DME).then(
          function (r) { return r === "granted"; }, function () { return false; });
      } catch (e) { return Promise.resolve(false); }
    }
    function calibrateGyro(attitude) {
      gyroCalibrate = { alpha: attitude.alpha || 0, beta: attitude.beta || 0, gamma: attitude.gamma || 0 };
      gyroBase = copyState(state);
      gyroFilter = { tiltDeg: 0, rotationDeg: 0, rockDeg: 0 };
      return getState();
    }
    /* One attitude sample in, filtered probe state out. The filter
     * state is kept here so successive samples smooth; calibrateGyro
     * (or enableGyro) resets it. dtMs is the gap since the last
     * sample, used for the cutoff maths. */
    function applyGyroSample(attitude, dtMs) {
      if (!gyroCalibrate || !gyroBase) calibrateGyro(attitude);
      var raw = gyroDeltas(attitude, gyroCalibrate);
      var alpha = lowPassAlpha(5, dtMs == null ? 16 : dtMs);
      gyroFilter.tiltDeg = lowPass(gyroFilter.tiltDeg, raw.tiltDeg, alpha);
      gyroFilter.rotationDeg = lowPass(gyroFilter.rotationDeg, raw.rotationDeg, alpha);
      gyroFilter.rockDeg = lowPass(gyroFilter.rockDeg, raw.rockDeg, alpha);
      var def = windowDef(state.window);
      if (def.tee) {
        setState({ omniplaneDeg: gyroBase.omniplaneDeg + gyroFilter.rotationDeg, flexDeg: gyroBase.flexDeg + gyroFilter.tiltDeg });
      } else {
        setState({
          tiltDeg: gyroBase.tiltDeg + gyroFilter.tiltDeg,
          rotationDeg: gyroBase.rotationDeg + gyroFilter.rotationDeg,
          rockDeg: gyroBase.rockDeg + gyroFilter.rockDeg
        });
      }
      return getState();
    }
    var gyroHandler = null, gyroLastTs = 0;
    function enableGyro() {
      state.gyroOn = true;
      gyroFilter = { tiltDeg: 0, rotationDeg: 0, rockDeg: 0 };
      gyroCalibrate = null; gyroBase = null; gyroLastTs = 0;
      if (!gyroHandler && typeof G.addEventListener === "function") {
        gyroHandler = function (e) {
          if (!state.gyroOn) return;
          var now = (e && e.timeStamp) || (typeof Date !== "undefined" ? Date.now() : 0);
          var dt = gyroLastTs ? now - gyroLastTs : 16;
          gyroLastTs = now;
          if (!gyroCalibrate) calibrateGyro(e);
          applyGyroSample(e, dt);
        };
        try { G.addEventListener("deviceorientation", gyroHandler, true); } catch (e) {}
      }
      emit();
      return getState();
    }
    function disableGyro() {
      state.gyroOn = false;
      if (gyroHandler && typeof G.removeEventListener === "function") {
        try { G.removeEventListener("deviceorientation", gyroHandler, true); } catch (e) {}
        gyroHandler = null;
      }
      emit();
      return getState();
    }

    /* ---------- touch ----------
     * Chest map: one finger slides the probe (position follows the
     * finger, in millimetres at the element scale), two fingers twist
     * to rotate (the change in the angle between the fingers). The
     * element reports its millimetre scale through opts.mmPerPx or a
     * data-mm-per-px attribute; default 0.6 mm per px. */
    function bindTouchSurface(el, opts) {
      if (!el || !el.addEventListener) return function () {};
      opts = opts || {};
      var mmPerPx = opts.mmPerPx || parseFloat(el.getAttribute && el.getAttribute("data-mm-per-px")) || 0.6;
      var ptrs = {}, lastAngle = null, lastMid = null;
      function pos(e) { var r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
      function ids() { return Object.keys(ptrs); }
      function angleOf() {
        var k = ids(); if (k.length < 2) return null;
        var a = ptrs[k[0]], b = ptrs[k[1]];
        return Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
      function midOf() {
        var k = ids(); if (k.length < 2) return null;
        var a = ptrs[k[0]], b = ptrs[k[1]];
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      }
      function down(e) {
        ptrs[e.pointerId] = pos(e);
        try { el.setPointerCapture(e.pointerId); } catch (x) {}
        if (ids().length === 2) { lastAngle = angleOf(); lastMid = midOf(); }
        if (e.preventDefault) e.preventDefault();
      }
      function move(e) {
        if (!ptrs[e.pointerId]) return;
        var p = pos(e), prev = ptrs[e.pointerId];
        ptrs[e.pointerId] = p;
        if (ids().length === 1) {
          setState({ position: { x: state.position.x + (p[0] - prev[0]) * mmPerPx, y: state.position.y - (p[1] - prev[1]) * mmPerPx } });
        } else if (ids().length === 2) {
          var ang = angleOf();
          if (lastAngle != null && ang != null) {
            var dA = deg(ang - lastAngle);
            if (dA > 180) dA -= 360; if (dA < -180) dA += 360;
            if (windowDef(state.window).tee) setState({ omniplaneDeg: state.omniplaneDeg + dA });
            else setState({ rotationDeg: state.rotationDeg + dA });
          }
          lastAngle = ang;
          var mid = midOf();
          if (lastMid && mid) {
            setState({ position: { x: state.position.x + (mid[0] - lastMid[0]) * mmPerPx, y: state.position.y - (mid[1] - lastMid[1]) * mmPerPx } });
          }
          lastMid = mid;
        }
        if (e.preventDefault) e.preventDefault();
      }
      function up(e) {
        delete ptrs[e.pointerId];
        if (ids().length < 2) { lastAngle = null; lastMid = null; }
      }
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      return function unbind() {
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
    }
    /* Side slider: vertical drag tilts. Rock strip: horizontal drag
     * rocks. Both follow the finger 1 to 1 in degrees at the given
     * scale (default 0.5 degrees per px) and stay interruptible: a
     * new touch continues from the value on screen. */
    function bindDragControl(el, axis, opts) {
      if (!el || !el.addEventListener) return function () {};
      opts = opts || {};
      var degPerPx = opts.degPerPx || 0.5;
      var startVal = 0, startPos = 0, activeId = null;
      function down(e) {
        if (activeId != null) return;
        activeId = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch (x) {}
        startPos = axis === "y" ? e.clientY : e.clientX;
        startVal = axis === "tilt" ? state.tiltDeg : axis === "flex" ? state.flexDeg : state.rockDeg;
        if (axis === "omniplane") startVal = state.omniplaneDeg;
        if (e.preventDefault) e.preventDefault();
      }
      function move(e) {
        if (e.pointerId !== activeId) return;
        var now = axis === "y" || axis === "tilt" || axis === "flex" || axis === "omniplane" && opts.vertical ? e.clientY : e.clientX;
        if (axis === "tilt" || axis === "flex") now = e.clientY;
        if (axis === "rock") now = e.clientX;
        if (axis === "omniplane") now = opts.vertical ? e.clientY : e.clientX;
        var delta = (axis === "tilt" || axis === "flex" || (axis === "omniplane" && opts.vertical)) ? (startPos - now) * degPerPx : (now - startPos) * degPerPx;
        if (axis === "tilt") setState({ tiltDeg: startVal + delta });
        else if (axis === "rock") setState({ rockDeg: startVal + delta });
        else if (axis === "flex") setState({ flexDeg: startVal + delta });
        else if (axis === "omniplane") setState({ omniplaneDeg: startVal + delta });
      }
      function up(e) { if (e.pointerId === activeId) activeId = null; }
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      return function unbind() {
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
    }

    var api = {
      getState: getState, setState: setState, plane: plane, planeFor: planeFor,
      stateForView: stateForView, stateForPlane: stateForPlane, setToView: setToView,
      targetPlane: targetPlane, viewById: viewById,
      score: score, tick: tick, resetAchieved: resetAchieved,
      landmarksInCut: landmarksInCut,
      clampsFor: clampsFor, windowFrame: windowFrame,
      onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); return api; },
      gyroSupported: gyroSupported, requestGyroPermission: requestGyroPermission,
      calibrateGyro: calibrateGyro, applyGyroSample: applyGyroSample,
      resetGyroCalibration: function () { gyroCalibrate = null; gyroBase = null; gyroFilter = { tiltDeg: 0, rotationDeg: 0, rockDeg: 0 }; return getState(); },
      enableGyro: enableGyro, disableGyro: disableGyro,
      bindTouchSurface: bindTouchSurface, bindDragControl: bindDragControl,
      setViews: function (v) { viewsData = v; frameCache = {}; targetCache = {}; teeSolveCache = {}; return api; },
      setGeom: function (g) { geom = g; frameCache = {}; targetCache = {}; teeSolveCache = {}; return api; },
      getViews: function () { return viewsData; }
    };
    return api;
  }

  var API = {
    create: create, WINDOWS: WINDOWS, windowDef: windowDef, isTeeWindow: isTeeWindow,
    gyroDeltas: gyroDeltas, lowPassAlpha: lowPassAlpha, lowPass: lowPass,
    wrapDeg: wrapDeg,
    _pure: { rot: rot, angleBetween: angleBetween, frameFromBeam: frameFromBeam, gyroDeltas: gyroDeltas, lowPassAlpha: lowPassAlpha, lowPass: lowPass, wrapDeg: wrapDeg }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_PROBE = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
