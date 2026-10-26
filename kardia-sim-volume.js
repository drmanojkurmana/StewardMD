/* kardia-sim-volume.js - Kardia K3 tissue volumes (independent build).
 * Voxelises a registered heart plus great vessels and liver into a
 * 160 x 160 x 160 field volume in the patient frame (x left, y anterior,
 * z cranial, mm, origin near the LV centroid). Anatomy is built from
 * signed-distance shells so myocardium is a real 8 to 11 mm band, not a
 * drawn outline: blood, wall, pericardium and vessels meet where
 * echogenicity changes. Intra-tissue scatter variation is baked in.
 * Labels: 0 outside, 1 blood, 2 myocardium, 3 valve, 4 pericardium,
 * 5 fat, 6 liver, 7 lung, 8 bone.
 * Exports (UMD): buildVolumes, deformPoint, LABELS, TISSUE, packAtlas,
 * poseToPlane, VIEWS, classify, contraction, sampleTissue.
 */
(function (G) {
  "use strict";
  var LABELS = { OUTSIDE: 0, BLOOD: 1, MYOCARDIUM: 2, VALVE: 3, PERICARDIUM: 4, FAT: 5, LIVER: 6, LUNG: 7, BONE: 8 };
  var TISSUE = [
    { name: "outside", echo: 0.03, atten: 0.12, spec: 0.0 },
    { name: "blood", echo: 0.06, atten: 0.18, spec: 0.0 },
    { name: "myocardium", echo: 0.48, atten: 0.75, spec: 0.08 },
    { name: "valve", echo: 0.88, atten: 1.05, spec: 0.85 },
    { name: "pericardium", echo: 0.96, atten: 1.15, spec: 1.0 },
    { name: "fat", echo: 0.22, atten: 0.65, spec: 0.05 },
    { name: "liver", echo: 0.40, atten: 0.80, spec: 0.12 },
    { name: "lung", echo: 0.62, atten: 3.80, spec: 0.55 },
    { name: "bone", echo: 0.92, atten: 4.20, spec: 0.75 }
  ];
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)) || 1; }
  function norm(a) { var l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; }
  function hash3(x, y, z) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 3266489917);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(p, s) {
    var x = p[0] * s, y = p[1] * s, z = p[2] * s;
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var fx = x - ix, fy = y - iy, fz = z - iz;
    fx *= fx * (3 - 2 * fx); fy *= fy * (3 - 2 * fy); fz *= fz * (3 - 2 * fz);
    function h(a, b, c) { return hash3(a, b, c); }
    var x0 = h(ix, iy, iz), x1 = h(ix + 1, iy, iz), x2 = h(ix, iy + 1, iz), x3 = h(ix + 1, iy + 1, iz);
    var x4 = h(ix, iy, iz + 1), x5 = h(ix + 1, iy, iz + 1), x6 = h(ix, iy + 1, iz + 1), x7 = h(ix + 1, iy + 1, iz + 1);
    var a = x0 + (x1 - x0) * fx, b = x2 + (x3 - x2) * fx, c = x4 + (x5 - x4) * fx, d = x6 + (x7 - x6) * fx;
    var e = a + (b - a) * fy, f = c + (d - c) * fy;
    return e + (f - e) * fz;
  }
  /* Oriented ellipsoid SDF: r = semi-axes in (e1,e2,e3). Negative inside. */
  function sdEll(p, c, e1, e2, e3, r) {
    var d = sub(p, c);
    var u = dot(d, e1) / r[0], v = dot(d, e2) / r[1], w = dot(d, e3) / r[2];
    var k = Math.sqrt(u * u + v * v + w * w);
    return (k - 1) * Math.min(r[0], Math.min(r[1], r[2]));
  }
  function sdCapsule(p, a, b, r) {
    var ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1);
    return len(sub(p, add(a, mul(ab, t)))) - r;
  }
  function sdTorus(p, c, ax, n1, n2, R, r) {
    var d = sub(p, c), u = dot(d, ax), s = dot(d, n1), t = dot(d, n2);
    var rad = Math.sqrt(s * s + t * t);
    return Math.sqrt((rad - R) * (rad - R) + u * u) - r;
  }
  function ramp(d, w) { return clamp(0.5 - d / Math.max(0.4, w), 0, 1); }

  /* Heart-local frame registered to the geom patient frame.
   * A: base -> apex (left, slightly anterior, caudal).
   * ANT: chest (anterior). LAT: patient left (LV free wall). */
  var A = norm([0.16, 0.20, -0.967]);
  var ANT = (function () {
    var raw = [0, 1, 0], d = dot(raw, A);
    return norm(sub(raw, mul(A, d)));
  })();
  var LAT = norm(cross(A, ANT));
  var LV_C = [0, 2, -3];
  function toP(a, ant, lat) {
    return [LV_C[0] + A[0] * a + ANT[0] * ant + LAT[0] * lat,
      LV_C[1] + A[1] * a + ANT[1] * ant + LAT[1] * lat,
      LV_C[2] + A[2] * a + ANT[2] * ant + LAT[2] * lat];
  }
  function loc(p) {
    var d = sub(p, LV_C);
    return [dot(d, A), dot(d, ANT), dot(d, LAT)];
  }
  /* RV wraps the LV anteriorly and to the patient's right so both PLAX
   * (anterior near field) and A4C (left of septum) cut a real cavity. */
  var RV_C = toP(-6, 12, -22);
  var LA_C = toP(-46, -12, 4);
  var RA_C = toP(-44, 10, -24);
  var MV_C = toP(-30, 1, 0);
  var AV_C = toP(-36, 8, -2);
  var TV_C = toP(-28, 14, -20);
  var PV_C = toP(-20, 22, -8);
  var AO_DIR = norm([-0.12, -0.18, 0.976]);
  var AO_N1 = norm(cross(AO_DIR, A));
  var AO_N2 = norm(cross(AO_DIR, AO_N1));
  var AO_ASC = toP(-52, 6, 2);
  var AO_ARCH = toP(-48, -2, 28);
  var AO_DESC = toP(-36, -22, 8);
  var PA_C = toP(-18, 30, 6);

  function contraction(phase) {
    var t = ((phase % 1) + 1) % 1;
    if (t < 0.32) { var u = t / 0.32; return u * u * (3 - 2 * u); }
    var v = (t - 0.32) / 0.68;
    return 1 - v * v * (3 - 2 * v) * 0.92 - 0.08 * Math.sin(v * Math.PI);
  }
  function deformPoint(p, phase) {
    var s = contraction(phase), out = p.slice();
    [[LV_C, 0.20, 42], [RV_C, 0.16, 36]].forEach(function (pair) {
      var c = pair[0], d = sub(out, c), dist = len(d);
      if (dist < pair[2]) {
        var f = 1 + pair[1] * s * (1 - dist / pair[2]);
        out = add(c, mul(sub(out, c), f));
      }
    });
    return out;
  }
  /* Inverse of deformPoint for a probe-plane sample (shader and CPU). */
  function undeformPoint(p, phase) {
    var s = contraction(phase), out = p.slice();
    [[RV_C, 0.16, 36], [LV_C, 0.20, 42]].forEach(function (pair) {
      var c = pair[0], d = sub(out, c), dist = len(d);
      if (dist < pair[2]) {
        var f = 1 + pair[1] * s * (1 - dist / pair[2]);
        out = add(c, mul(sub(out, c), 1 / f));
      }
    });
    return out;
  }

  /* Thin valve disc with a central orifice. Opening 0 = shut, 1 = open. */
  function valveW(p, c, axis, n1, n2, r, orS, orT, thick, opening) {
    var d = sub(p, c), u = dot(d, axis), s = dot(d, n1), t = dot(d, n2);
    var rad = Math.sqrt(s * s + t * t);
    if (Math.abs(u) > thick || rad > r) return 0;
    var e = (s * s) / ((orS * (0.22 + 0.78 * opening)) * (orS * (0.22 + 0.78 * opening))) +
      (t * t) / ((orT * (0.22 + 0.78 * opening)) * (orT * (0.22 + 0.78 * opening)));
    if (e < 1) return 0;
    var edge = 1 - clamp((rad - (r - 1.2)) / 1.2, 0, 1);
    return (1 - Math.abs(u) / thick) * (0.55 + 0.45 * edge);
  }
  /* Mercedes-Benz aortic coaptation: three radial leaflets. */
  function aorticW(p, opening) {
    var d = sub(p, AV_C), u = dot(d, AO_DIR), s = dot(d, AO_N1), t = dot(d, AO_N2);
    var rad = Math.sqrt(s * s + t * t);
    if (Math.abs(u) > 1.15 || rad > 10.5) return 0;
    var ang = Math.atan2(t, s);
    var sector = ((ang + Math.PI) / (Math.PI * 2 / 3));
    var f = sector - Math.floor(sector);
    var slit = Math.min(f, 1 - f) * rad;
    var openGap = 2.4 * opening + 0.35;
    if (slit < openGap && rad < 8.2) return 0;
    return (1 - Math.abs(u) / 1.15) * (rad > 8.6 ? 0.7 : 1);
  }

  function sampleTissue(p, phase) {
    phase = phase == null ? 0.28 : phase;
    var x = p[0], y = p[1], z = p[2];
    var lc = loc(p);
    var nMyo = vnoise(p, 0.11);
    var nFine = vnoise(p, 0.37);
    var nTrab = vnoise([p[0] + 11, p[1] - 7, p[2] + 3], 0.22);

    var lvIn = sdEll(p, LV_C, A, ANT, LAT, [44, 18.0, 21.0]);
    var lvOut = sdEll(p, LV_C, A, ANT, LAT, [49.5, 29.2, 32.2]); /* ~11 mm wall */
    /* RV as a crescent wrapping the LV on the anterior and right sides
     * so PLAX sees it in the near field and A4C sees it left of the septum. */
    var rSax = Math.sqrt(lc[1] * lc[1] + lc[2] * lc[2]);
    var angSax = Math.atan2(lc[2], lc[1]);
    var along = lc[0] / 36;
    var taper = Math.sqrt(Math.max(0, 1 - along * along * 0.85));
    var inArc = angSax > -2.35 && angSax < 0.85 && Math.abs(along) < 1.12;
    var innerR = (20.0 + 1.4) * taper;
    var bloodR = innerR + 13.0 * taper;
    var wallR = bloodR + 4.6;
    var rvIn = inArc ? Math.max(innerR - rSax, rSax - bloodR) : 1e9;
    var rvOut = inArc ? Math.max(innerR - 0.8 - rSax, rSax - wallR) : 1e9;
    var laIn = sdEll(p, LA_C, A, ANT, LAT, [16, 14, 15]);
    var laOut = sdEll(p, LA_C, A, ANT, LAT, [19, 17, 18]);
    var raIn = sdEll(p, RA_C, A, ANT, LAT, [15.5, 13, 14.5]);
    var raOut = sdEll(p, RA_C, A, ANT, LAT, [18.5, 16, 17.5]);

    /* Papillary muscles inside the LV cavity. */
    var pap1 = sdCapsule(p, toP(6, 9, 11), toP(18, 8, 10), 4.2);
    var pap2 = sdCapsule(p, toP(6, -7, -9), toP(18, -6, -8), 3.8);
    var pap = Math.min(pap1, pap2);

    /* Great vessels as blood tubes with walls. */
    var aoLumen = Math.min(sdCapsule(p, AV_C, AO_ASC, 10.5),
      Math.min(sdCapsule(p, AO_ASC, AO_ARCH, 10), sdCapsule(p, AO_ARCH, AO_DESC, 8.4)));
    var aoWall = Math.min(sdCapsule(p, AV_C, AO_ASC, 13.2),
      Math.min(sdCapsule(p, AO_ASC, AO_ARCH, 12.6), sdCapsule(p, AO_ARCH, AO_DESC, 10.6)));
    var paLumen = sdCapsule(p, PV_C, PA_C, 8.2);
    var paWall = sdCapsule(p, PV_C, PA_C, 10.6);
    var ivc = sdCapsule(p, add(RA_C, [4, 4, -28]), add(RA_C, [6, 8, -8]), 7.6);
    var svc = sdCapsule(p, add(RA_C, [2, 2, 8]), add(RA_C, [0, -2, 32]), 7.2);
    var rvot = sdEll(p, PV_C, A, ANT, LAT, [12, 10, 11]);
    var lvot = sdCapsule(p, toP(-18, 6, -2), AV_C, 10);

    /* Arch branches for suprasternal. */
    var bca = sdCapsule(p, AO_ARCH, add(AO_ARCH, [8, -6, 22]), 4.2);
    var lcca = sdCapsule(p, AO_ARCH, add(AO_ARCH, [-2, -4, 24]), 3.6);
    var lsa = sdCapsule(p, AO_ARCH, add(AO_ARCH, [-12, -2, 20]), 3.4);

    var sys = contraction(phase);
    var mvOpen = 1 - clamp(sys * 1.15, 0, 1);
    var avOpen = clamp(sys * 1.2, 0, 1);
    var tvOpen = mvOpen;
    var mv = valveW(p, MV_C, A, ANT, LAT, 14.5, 5.6, 11.5, 1.15, mvOpen);
    var tv = valveW(p, TV_C, A, ANT, LAT, 12, 3.6, 8.5, 1.15, tvOpen);
    var av = aorticW(p, avOpen);
    var pv = valveW(p, PV_C, ANT, A, LAT, 9.5, 3.2, 3.2, 1.05, avOpen);

    /* Liver caudal to the diaphragm, never inside the heart. */
    var liver = sdEll(p, [8, 16, -72], [1, 0, 0], [0, 1, 0], [0, 0, 1], [78, 62, 34]);
    var hv1 = sdCapsule(p, [-16, -4, -42], [-4, 12, -68], 5.5);
    var hv2 = sdCapsule(p, [22, 18, -66], [8, 0, -46], 4.2);

    /* Lungs either side; ribs on the anterior chest; sternum. */
    var lungL = sdEll(p, [-68, -8, 4], [1, 0, 0], [0, 1, 0], [0, 0, 1], [24, 48, 58]);
    var lungR = sdEll(p, [64, -10, 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [22, 44, 56]);
    var rib = 1e9, ri;
    for (ri = 0; ri < 5; ri++) {
      var rz = 48 - ri * 22;
      rib = Math.min(rib, sdCapsule(p, [-58, 58 - ri * 1.5, rz], [58, 56 - ri * 1.5, rz - 6], 4.0));
    }
    var sternum = sdCapsule(p, [0, 62, 28], [0, 64, -36], 7.5);

    /* Pericardium is a thin posterior bright layer, not a surrounding ring. */
    var periPost = (lc[1] < -16 && lvOut > 0.4 && lvOut < 5.2);
    var periAnt = (lc[1] > 18 && lvOut > 0.2 && lvOut < 1.6);

    var echo = 0.02, spec = 0, atten = 0.12, blood = 0, lab = LABELS.OUTSIDE;
    function set(l, e, s, a, b) { lab = l; echo = e; spec = s; atten = a; blood = b; }

    /* Priority: bone, valve, blood, myocardium, pericardium, liver, lung, fat. */
    if (rib < 0 || sternum < 0) {
      set(LABELS.BONE, 0.88, 0.7, 4.2, 0);
    } else if (mv > 0.08 || tv > 0.08 || av > 0.08 || pv > 0.08) {
      var vw = Math.max(mv, Math.max(tv, Math.max(av, pv)));
      set(LABELS.VALVE, 0.62 + 0.22 * vw, 0.55 + 0.3 * vw, 1.05, 0);
    } else if (pap < 0 && lvIn < 2) {
      var pe = 0.40 + 0.08 * nMyo + 0.05 * nFine;
      set(LABELS.MYOCARDIUM, pe, 0.08, 0.9, 0);
    } else if (lvIn < 0 || (rvIn < 0 && lvOut > 1.2) || laIn < 0 || raIn < 0 ||
      aoLumen < 0 || paLumen < 0 || rvot < 0 || lvot < 0 || ivc < 0 || svc < 0 ||
      bca < 0 || lcca < 0 || lsa < 0) {
      var be = 0.048 + 0.020 * nFine;
      set(LABELS.BLOOD, be, 0, 0.18, 1);
    } else if (lvOut < 0 || (rvOut < 0 && lvIn > 1.5) || laOut < 0 || raOut < 0 ||
      (aoWall < 0 && aoLumen > 0) || (paWall < 0 && paLumen > 0)) {
      var endo = Math.min(Math.abs(lvIn), Math.min(Math.abs(rvIn), Math.min(Math.abs(laIn), Math.abs(raIn))));
      var trab = endo < 2.8 ? (1 - endo / 2.8) * (0.05 + 0.08 * nTrab) : 0;
      var fiber = 0.12 * (nMyo - 0.5) + 0.07 * (nFine - 0.5);
      var me = 0.48 + fiber + trab;
      if (lvOut < 0 && rvOut < 6 && lc[2] < -2) me += 0.04;
      set(LABELS.MYOCARDIUM, clamp(me, 0.40, 0.62), 0.07 + trab * 0.3, 0.75, 0);
    } else if (periPost || periAnt) {
      var post = periPost ? 1 : 0.22;
      set(LABELS.PERICARDIUM, 0.62 + 0.26 * post, 0.40 + 0.45 * post, 1.15, 0);
    } else if (z < -36 && lvOut > 8 && liver < 0) {
      if (hv1 < 0 || hv2 < 0) set(LABELS.BLOOD, 0.06, 0, 0.18, 1);
      else set(LABELS.LIVER, 0.32 + 0.08 * nMyo + 0.04 * nFine, 0.10, 0.80, 0);
    } else if (lungL < 0 || lungR < 0) {
      var lungD = Math.min(lungL, lungR);
      if (lungD > -1.8) set(LABELS.LUNG, 0.55, 0.4, 3.8, 0);
      else set(LABELS.LUNG, 0.05, 0.02, 4.5, 0);
    } else if (lvOut < 10 && lvOut > 0) {
      set(LABELS.FAT, 0.10 + 0.04 * nFine, 0.03, 0.55, 0);
    } else {
      set(LABELS.OUTSIDE, 0.015 + 0.01 * nFine, 0, 0.10, 0);
    }

    /* Soft 1.2 mm ramps: walls stay bands, never a hard outline. */
    if (lab === LABELS.MYOCARDIUM) {
      var nearBlood = Math.min(Math.max(lvIn, 0), Math.min(Math.max(rvIn, 0), Math.min(Math.max(laIn, 0), Math.max(raIn, 0))));
      if (nearBlood < 1.2) {
        var k = nearBlood / 1.2;
        echo = echo * (0.70 + 0.30 * k) + 0.055 * (1 - k);
        blood = (1 - k) * 0.65;
      }
    }
    return { l: lab, echo: clamp(echo, 0, 1), spec: clamp(spec, 0, 1), atten: atten, blood: clamp(blood, 0, 1) };
  }
  function classify(p) { return sampleTissue(p, 0.28).l; }

  var DIMS = [160, 160, 160], MIN = [-88, -80, -88], SIZE = [176, 164, 176];

  function buildVolumes() {
    var nx = DIMS[0], ny = DIMS[1], nz = DIMS[2];
    var step = [SIZE[0] / (nx - 1), SIZE[1] / (ny - 1), SIZE[2] / (nz - 1)];
    var n = nx * ny * nz, labels = new Uint8Array(n);
    var echo = new Uint8Array(n), spec = new Uint8Array(n), atten = new Uint8Array(n), blood = new Uint8Array(n);
    var x, y, z, i, t, p;
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      i = x + nx * (y + ny * z);
      p = [MIN[0] + x * step[0], MIN[1] + y * step[1], MIN[2] + z * step[2]];
      t = sampleTissue(p, 0.08);
      labels[i] = t.l;
      echo[i] = Math.round(t.echo * 255);
      spec[i] = Math.round(t.spec * 255);
      atten[i] = Math.round(clamp(t.atten / 4, 0, 1) * 255);
      blood[i] = Math.round(t.blood * 255);
    }
    return {
      labels: labels,
      fields: { echo: echo, spec: spec, atten: atten, blood: blood },
      dims: DIMS.slice(), min: MIN.slice(), step: step, labelsMeta: LABELS, tissue: TISSUE
    };
  }
  function packAtlas(vol) {
    var nx = vol.dims[0], ny = vol.dims[1], nz = vol.dims[2];
    var cols = Math.ceil(Math.sqrt(nz)), rows = Math.ceil(nz / cols), W = cols * nx, H = rows * ny;
    var rgba = new Uint8Array(W * H * 4), x, y, z, i, j;
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      j = x + nx * (y + ny * z);
      i = ((z % cols) * nx + x + W * (Math.floor(z / cols) * ny + y)) * 4;
      rgba[i] = vol.fields.echo[j];
      rgba[i + 1] = vol.fields.spec[j];
      rgba[i + 2] = vol.fields.atten[j];
      rgba[i + 3] = vol.fields.blood[j];
    }
    return { rgba: rgba, width: W, height: H, cols: cols, rows: rows, dims: vol.dims.slice(), min: vol.min.slice(), step: vol.step.slice() };
  }
  function poseToPlane(pose) {
    var beam = norm(pose.beam || (pose.normal ? mul(pose.normal, -1) : [0, -1, 0]));
    var upIn = norm(pose.up || [0, 0, 1]);
    var right = norm(cross(beam, upIn));
    if (len(right) < 0.2) right = norm(cross(beam, [1, 0, 0]));
    var up = norm(cross(right, beam));
    return { origin: (pose.origin || [0, 0, 0]).slice(), beam: beam, right: right, up: up, normal: up.slice() };
  }
  function mkView(origin, beamDir, rightDir, depthCm, label) {
    var beam = norm(beamDir);
    var rd = sub(rightDir, mul(beam, dot(rightDir, beam)));
    var right = norm(rd);
    return { origin: origin, beam: beam, up: cross(right, beam), depthCm: depthCm, label: label };
  }

  /* Standard planes, built in the heart-local frame so a side-by-side
   * with the real clip of the same view shows the same structures. */
  var VIEWS = {
    /* PLAX: chest wall, beam posterior. Apex left of screen, base/aorta
     * right, RV in the near field, LV elongated, posterior pericardium. */
    plax: mkView(toP(6, 54, 2), mul(ANT, -1), mul(A, -1), 16, "PLAX"),
    /* PSAX AV: same window, short-axis at the aortic valve. */
    psax_av: mkView(add(AV_C, mul(ANT, 58)), mul(ANT, -1), LAT, 13, "PSAX AV"),
    /* PSAX MV: fish-mouth mitral, round LV, RV crescent on top. */
    psax_mv: mkView(add(MV_C, mul(ANT, 62)), mul(ANT, -1), LAT, 14, "PSAX MV"),
    /* A4C: apex at the transducer. Tilt the plane toward the RV so the
     * septum is vertical, LV on the right, RV on the left. */
    a4c: mkView(toP(58, 14, -10), mul(A, -1), norm(add(mul(LAT, 0.55), mul(ANT, 0.84))), 18, "A4C"),
    /* A2C: same apex, rotated onto anterior/inferior walls, no RV. */
    a2c: mkView(toP(60, 2, 4), mul(A, -1), ANT, 18, "A2C"),
    subcostal_4c: mkView([8, 28, -88], norm(sub(toP(-8, 8, -8), [8, 28, -88])), norm(add(mul(LAT, 0.7), mul(ANT, 0.7))), 19, "Subcostal 4C"),
    suprasternal: mkView(add(AO_ARCH, [2, 10, 58]), norm(sub(toP(-40, -8, 4), add(AO_ARCH, [2, 10, 58]))), ANT, 13, "Suprasternal")
  };

  function sampleFields(vol, p) {
    var gx = (p[0] - vol.min[0]) / vol.step[0], gy = (p[1] - vol.min[1]) / vol.step[1], gz = (p[2] - vol.min[2]) / vol.step[2];
    var nx = vol.dims[0], ny = vol.dims[1], nz = vol.dims[2];
    var x0 = Math.max(0, Math.min(nx - 2, Math.floor(gx)));
    var y0 = Math.max(0, Math.min(ny - 2, Math.floor(gy)));
    var z0 = Math.max(0, Math.min(nz - 2, Math.floor(gz)));
    var fx = clamp(gx - x0, 0, 1), fy = clamp(gy - y0, 0, 1), fz = clamp(gz - z0, 0, 1);
    var out = [0, 0, 0, 0], keys = ["echo", "spec", "atten", "blood"], c;
    for (c = 0; c < 4; c++) {
      var f = vol.fields[keys[c]];
      function at(xi, yi, zi) { return f[xi + nx * (yi + ny * zi)] / 255; }
      var v000 = at(x0, y0, z0), v100 = at(x0 + 1, y0, z0), v010 = at(x0, y0 + 1, z0), v110 = at(x0 + 1, y0 + 1, z0);
      var v001 = at(x0, y0, z0 + 1), v101 = at(x0 + 1, y0, z0 + 1), v011 = at(x0, y0 + 1, z0 + 1), v111 = at(x0 + 1, y0 + 1, z0 + 1);
      var a = v000 + (v100 - v000) * fx, b = v010 + (v110 - v010) * fx, d = v001 + (v101 - v001) * fx, e = v011 + (v111 - v011) * fx;
      out[c] = (a + (b - a) * fy) * (1 - fz) + (d + (e - d) * fy) * fz;
    }
    return out;
  }

  /* Load packed PNG atlases (kardia/media/k3-volume/) in the browser. */
  function loadAtlas(baseUrl, done) {
    if (typeof XMLHttpRequest === "undefined") { done(new Error("loadAtlas needs a browser")); return; }
    var x = new XMLHttpRequest();
    x.open("GET", baseUrl + "manifest.json");
    x.responseType = "json";
    x.onload = function () {
      var man = x.response; if (!man || !man.files) { done(new Error("manifest")); return; }
      var loaded = [], left = man.files.length, failed = false;
      man.files.forEach(function (f, i) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () {
          if (failed) return;
          loaded[i] = img;
          if (--left === 0) {
            var w = man.files[0].width, h = 0, k, y = 0;
            for (k = 0; k < man.files.length; k++) h += man.files[k].height;
            var c = document.createElement("canvas"); c.width = w; c.height = h;
            var ctx = c.getContext("2d");
            for (k = 0; k < loaded.length; k++) { ctx.drawImage(loaded[k], 0, y); y += man.files[k].height; }
            var data = ctx.getImageData(0, 0, w, h);
            done(null, { rgba: data.data, width: w, height: h, cols: man.cols, rows: man.rows, dims: man.dims, min: man.min, step: man.step });
          }
        };
        img.onerror = function () { if (!failed) { failed = true; done(new Error(f.name)); } };
        img.src = baseUrl + f.name;
      });
    };
    x.onerror = function () { done(new Error("manifest")); };
    x.send();
  }
  var API = {
    LABELS: LABELS, TISSUE: TISSUE, DIMS: DIMS, MIN: MIN,
    A: A, ANT: ANT, LAT: LAT, LV_C: LV_C,
    buildVolumes: buildVolumes, packAtlas: packAtlas, loadAtlas: loadAtlas,
    classify: classify, sampleTissue: sampleTissue, sampleFields: sampleFields,
    contraction: contraction, deformPoint: deformPoint, undeformPoint: undeformPoint,
    poseToPlane: poseToPlane, VIEWS: VIEWS, hash3: hash3, vnoise: vnoise
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.KARDIA_SIM_VOLUME = API;
})(typeof window !== "undefined" ? window : globalThis);
