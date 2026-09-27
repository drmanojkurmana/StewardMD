/* Ophthalmós retinoscopy model. ES5, pure, no DOM.
   The eye, the trial lens and the working distance are one symmetric dioptric matrix F in the pupil plane
   (x to the examiner's right, y up, angles in TABO degrees). Sweeping the streak along n moves the lit retinal
   strip; the pupil points that send light back to the peephole satisfy x . (F n) = s, so the reflex band lies
   perpendicular to g = F n, moves along g at a speed of 1/|g| and fills the pupil when g = 0 (neutral).
   With and against motion, speed, band width, the break between band and streak, the skew of its motion and the
   dull reflex of a large error all follow from that one relation.
   Exported as window.OPHTHALMOS_RETINO in the browser and module.exports under node (tests). */
(function (G) {
  "use strict";
  var DEG = Math.PI / 180;
  var NEUTRAL = 0.2; // |g| in dioptres below which the pupil fills

  function norm180(a) { a = a % 180; if (a < 0) a += 180; return a; }
  function axis(a) { a = Math.round(norm180(a)); return a === 0 ? 180 : a; }
  // Signed smallest difference between two orientations, in (-90, 90].
  function odiff(a, b) { var d = norm180(a - b); return (d > 90 ? d - 180 : d) + 0; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }

  // Sphero-cylinder (s, c, axis) -> [xx, xy, yy]; power along direction t is s + c sin^2(t - axis).
  function mat(s, c, ax) {
    var a = ax * DEG, sn = Math.sin(a), cs = Math.cos(a);
    return [s + c * sn * sn, -c * sn * cs, s + c * cs * cs];
  }
  function sum(A, B, k) { return [A[0] + k * B[0], A[1] + k * B[1], A[2] + k * B[2]]; }
  function meridian(F, deg) {
    var t = deg * DEG, c = Math.cos(t), s = Math.sin(t);
    return F[0] * c * c + 2 * F[1] * s * c + F[2] * s * s;
  }
  // Principal meridians: hi is the more plus power, at orientation hiAx.
  function principal(F) {
    var m = (F[0] + F[2]) / 2, d = hyp((F[0] - F[2]) / 2, F[1]);
    var hiAx = norm180(0.5 * Math.atan2(2 * F[1], F[0] - F[2]) / DEG);
    return { hi: m + d, lo: m - d, hiAx: hiAx, loAx: norm180(hiAx + 90) };
  }
  function round(v, q) { return Math.round(v / q) * q; }
  // Matrix -> prescription in minus-cylinder form (the axis is the more plus meridian).
  function toRx(F) {
    var p = principal(F), c = round(p.lo - p.hi, 0.25);
    return { s: round(p.hi, 0.25) + 0, c: c + 0, ax: Math.abs(c) < 0.125 ? 180 : axis(p.hiAx) };
  }

  // Everything in front of the retina, seen from the peephole: patient error minus trial lens plus 1/distance.
  function effective(rx, lens, wd) {
    var F = mat(rx.s, rx.c, rx.ax);
    if (lens) F = sum(F, mat(lens.s || 0, lens.c || 0, lens.ax || 180), -1);
    return sum(F, [1, 0, 1], wd);
  }

  // The reflex for a streak held at streakDeg (the streak line's orientation) and swept across it.
  function reflex(F, streakDeg) {
    var n = (streakDeg + 90) * DEG, c = Math.cos(n), s = Math.sin(n);
    var gx = F[0] * c + F[1] * s, gy = F[1] * c + F[2] * s, mag = hyp(gx, gy), p = gx * c + gy * s;
    var bandDeg = mag > 1e-9 ? norm180(Math.atan2(gy, gx) / DEG + 90) : norm180(streakDeg);
    return {
      gx: gx, gy: gy, mag: mag, p: p,
      meridian: axis(streakDeg + 90),
      motion: mag < NEUTRAL ? "neutral" : p >= 0 ? "with" : "against",
      bandDeg: bandDeg,
      breakDeg: mag < NEUTRAL ? 0 : odiff(bandDeg, streakDeg),
      bright: 0.3 + 0.7 / (1 + 0.1 * mag * mag),   // a large error gives a dull reflex
      fill: Math.max(0, 1 - mag / 0.6)              // the pupil glows as neutral approaches
    };
  }

  // Lens that neutralizes a meridian (what the learner should find at neutral).
  function neutralLens(rx, merDeg, wd) { return meridian(mat(rx.s, rx.c, rx.ax), merDeg) + wd; }

  // Power vectors (Thibos): M spherical equivalent, J0/J45 astigmatism.
  function pv(r) { var a = 2 * r.ax * DEG; return { M: r.s + r.c / 2, J0: -r.c / 2 * Math.cos(a), J45: -r.c / 2 * Math.sin(a) }; }
  function pvDist(a, b) { return hyp(a.J0 - b.J0, a.J45 - b.J45); }

  // Clinical tolerance: spherical equivalent within 0.25 D and residual astigmatism within 0.20 D
  // (0.25 D of cylinder at the right axis, or about 5 degrees of axis on 2 D of cylinder).
  function grade(u, t, wd) {
    var pu = pv(u), pt = pv(t), dM = pu.M - pt.M, dJ = pvDist(pu, pt), e = 1e-9;
    var ok = Math.abs(dM) <= 0.25 + e && dJ <= 0.2 + e;
    var r = { ok: ok, close: !ok && Math.abs(dM) <= 0.75 + e && dJ <= 0.5 + e, type: null, dM: dM, dJ: dJ,
      axisOff: Math.abs(t.c) >= 0.25 && Math.abs(u.c) >= 0.25 ? Math.abs(odiff(u.ax, t.ax)) : 0 };
    if (ok) return r;
    if (Math.abs(dM - wd) <= 0.25 + e && dJ <= 0.2 + e) r.type = "wd";
    else if (Math.abs(dM + wd) <= 0.25 + e && dJ <= 0.2 + e) r.type = "wd2";
    else if (Math.abs(t.c) >= 0.5 && Math.abs(dM) <= 0.25 + e && pvDist(pu, pv({ s: t.s, c: t.c, ax: t.ax + 90 })) <= 0.2 + e) r.type = "axis90";
    else if (Math.abs(t.c) >= 0.5 && Math.abs(dM) <= 0.25 + e && Math.abs(Math.abs(u.c) - Math.abs(t.c)) <= 0.25 + e) r.type = "axis";
    else if (Math.abs(dM) <= 0.25 + e) r.type = "cyl";
    else r.type = "sph";
    return r;
  }

  // Deterministic generator (mulberry32) so a case can be replayed from its seed.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, lo, hi, q) { return round(lo + r() * (hi - lo), q) + 0; }

  // Foundation: sphere within -5 to +4, regular astigmatism at 90 or 180, a good pupil.
  // Resident: higher errors, oblique axes, small pupils and hazy media.
  function makeCase(level, seed) {
    var r = rng(seed), res = level === "resident", s, c, ax;
    var u = r();
    if (!res) s = u < 0.6 ? pick(r, -3, 3, 0.25) : pick(r, -5, 4, 0.25);
    else s = u < 0.4 ? pick(r, -3, 3, 0.25) : u < 0.8 ? pick(r, -8, -3, 0.25) : pick(r, 3, 6, 0.25);
    if (r() < (res ? 0.25 : 0.45)) { c = 0; ax = 180; }
    else {
      c = -pick(r, 0.5, res ? 4 : 2, 0.25);
      if (!res) ax = r() < 0.5 ? 180 : 90;
      else if (r() < 0.45) ax = pick(r, 20, 70, 5) + (r() < 0.5 ? 0 : 90);
      else ax = axis((r() < 0.5 ? 180 : 90) + pick(r, -10, 10, 5));
    }
    return {
      rx: { s: s, c: c, ax: axis(ax) },
      pupil: res ? pick(r, 3, 7, 0.5) : pick(r, 5, 6, 0.5),
      haze: res && r() < 0.3 ? pick(r, 0.2, 0.5, 0.05) : 0,
      seed: seed >>> 0, level: res ? "resident" : "foundation"
    };
  }

  var API = {
    NEUTRAL: NEUTRAL, mat: mat, sum: sum, meridian: meridian, principal: principal, toRx: toRx,
    effective: effective, reflex: reflex, neutralLens: neutralLens, pv: pv, grade: grade,
    rng: rng, makeCase: makeCase, axis: axis, odiff: odiff, norm180: norm180
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.OPHTHALMOS_RETINO = API;
})(typeof window !== "undefined" ? window : this);
