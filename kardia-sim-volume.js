/* kardia-sim-volume.js - Kardia K3 tissue volumes (independent build).
 * Voxelises a registered heart plus great vessels and liver into a
 * 160 x 160 x 160 label volume in the patient frame (x left, y anterior,
 * z cranial, mm, origin near the LV centroid). Anatomy is built from
 * smooth analytic signed-distance surfaces (prolate LV along its long
 * axis, crescent RV, atria, valve discs with orifices, great vessels,
 * pericardial shell, liver, lung, ribs), sampled at about 1.06 mm.
 * Alongside the labels a smoothed field volume is built: each tissue
 * contributes echogenicity, specular strength, attenuation and a blood
 * flag, blurred over about 2 mm, so trilinear sampling gives sub-voxel
 * smooth walls with no nearest-neighbour staircase.
 * Labels: 0 outside, 1 blood, 2 myocardium, 3 valve, 4 pericardium,
 * 5 fat, 6 liver, 7 lung, 8 bone.
 * Exports (UMD): buildVolumes, deformPoint, LABELS, TISSUE, packAtlas,
 * poseToPlane, VIEWS, classify, contraction.
 */
(function (G) {
  "use strict";
  var LABELS = { OUTSIDE: 0, BLOOD: 1, MYOCARDIUM: 2, VALVE: 3, PERICARDIUM: 4, FAT: 5, LIVER: 6, LUNG: 7, BONE: 8 };
  var TISSUE = [
    { name: "outside", echo: 0.02, atten: 0.10, spec: 0.0 }, { name: "blood", echo: 0.04, atten: 0.18, spec: 0.0 },
    { name: "myocardium", echo: 0.42, atten: 0.90, spec: 0.25 }, { name: "valve", echo: 0.85, atten: 1.10, spec: 0.9 },
    { name: "pericardium", echo: 0.95, atten: 1.00, spec: 1.0 }, { name: "fat", echo: 0.18, atten: 0.70, spec: 0.1 },
    { name: "liver", echo: 0.38, atten: 0.85, spec: 0.15 }, { name: "lung", echo: 0.55, atten: 3.50, spec: 0.6 },
    { name: "bone", echo: 0.90, atten: 4.00, spec: 0.8 }
  ];
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function ell(p, c, r) {
    var dx = (p[0] - c[0]) / r[0], dy = (p[1] - c[1]) / r[1], dz = (p[2] - c[2]) / r[2];
    return (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * Math.min(r[0], Math.min(r[1], r[2]));
  }
  function capsule(p, a, b, r) {
    var abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    var t = clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
    var dx = a[0] + abx * t - p[0], dy = a[1] + aby * t - p[1], dz = a[2] + abz * t - p[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  }
  function contraction(phase) {
    var t = ((phase % 1) + 1) % 1;
    if (t < 0.32) { var u = t / 0.32; return u * u * (3 - 2 * u); }
    var v = (t - 0.32) / 0.68; return 1 - v * v * (3 - 2 * v) * 0.92 - 0.08 * Math.sin(v * Math.PI);
  }
  /* LV long axis (base to apex): left, anterior, caudal. */
  var A = norm([-0.32, 0.28, -0.905]);
  var V1 = norm(cross(A, [1, 0, 0])), V2 = norm(cross(A, V1));
  var LV_C = [-2, 2, -4];
  /* Heart-local frame: a along A (base to apex), b along V1 (anterior
   * negative, posterior positive), c along V2 (patient right positive).
   * All chamber centres are placed in this frame so the standard planes
   * (PLAX in the a-b plane, A4C in the a to RV direction plane, PSAX
   * across a) cut every chamber they are meant to show. */
  function toPatient(a, b, c) {
    return [LV_C[0] + A[0] * a + V1[0] * b + V2[0] * c,
      LV_C[1] + A[1] * a + V1[1] * b + V2[1] * c,
      LV_C[2] + A[2] * a + V1[2] * b + V2[2] * c];
  }
  var RV_C = toPatient(-4, -38, 2);
  var BASE = toPatient(-30, 0, 0);
  var LA_C = toPatient(-44, 8, -2), RA_C = toPatient(-48, -34, 6);
  var AV_C = toPatient(-37, -4, -4), TV_C = toPatient(-30, -32, 8), RVOT_C = toPatient(-28, -32, -2);
  var AO_ASC = toPatient(-54, -8, -2), AO_ARCH = toPatient(-62, -2, 6), AO_DESC = toPatient(-52, 22, 2);
  var AO = norm([-0.15, -0.2, 0.97]), AO_A1 = norm(cross(AO, [0, 1, 0])), AO_A2 = norm(cross(AO, AO_A1));
  function local(p, c) { var d = sub(p, c); return [dot(d, A), dot(d, V1), dot(d, V2)]; }
  function deformPoint(p, phase) {
    var s = contraction(phase), out = p.slice();
    [[LV_C, 0.22], [RV_C, 0.18]].forEach(function (pair) {
      var c = pair[0], d = sub(p, c), dist = Math.sqrt(dot(d, d)) || 1;
      if (dist < 38) { var f = 1 + pair[1] * s * (1 - dist / 38); out = [c[0] + (out[0] - c[0]) * f, c[1] + (out[1] - c[1]) * f, c[2] + (out[2] - c[2]) * f]; }
    });
    return out;
  }
  function valveDisc(p, c, axis, a1, a2, r, orS, orT, thick) {
    var d = sub(p, c), u = dot(d, axis), s = dot(d, a1), t = dot(d, a2);
    var rad = Math.sqrt(s * s + t * t);
    if (Math.abs(u) > thick || rad > r) return false;
    var e = (s * s) / (orS * orS) + (t * t) / (orT * orT);
    return e > 1;
  }
  function qLocal(p, c, ra, rb, rc) {
    var l = local(p, c);
    return (l[0] / ra) * (l[0] / ra) + (l[1] / rb) * (l[1] / rb) + (l[2] / rc) * (l[2] / rc);
  }
  function classify(p) {
    var x = p[0], y = p[1], z = p[2];
    var pc = local(p, LV_C);
    var pqOut = ((pc[0] + 4) / 57) * ((pc[0] + 4) / 57) + ((pc[1] + 4) / 45) * ((pc[1] + 4) / 45) + (pc[2] / 45) * (pc[2] / 45);
    /* Liver below the diaphragm, but never inside the heart itself
     * (the LV apex dips below z -34 and must stay myocardium/blood). */
    if (z < -34 && pqOut > 1.3 && ell(p, [6, 18, -74], [76, 58, 32]) < 0) {
      if (capsule(p, [-18, -8, -40], [-6, 14, -66], 6) < 0) return LABELS.BLOOD;
      if (capsule(p, [24, 22, -64], [10, -2, -46], 4) < 0) return LABELS.BLOOD;
      return LABELS.LIVER;
    }
    if (y > 34) {
      for (var i = 0; i < 5; i++) { var rz = 56 - i * 24; if (capsule(p, [-60, 64 - i * 2, rz], [60, 62 - i * 2, rz - 8], 4.2) < 0) return LABELS.BONE; }
    }
    if (capsule(p, [0, -78, 36], [0, -80, -62], 9) < 0) return LABELS.BONE;
    if (ell(p, [-72, -12, 2], [22, 46, 56]) < 0 || ell(p, [68, -16, 0], [20, 42, 54]) < 0) return LABELS.LUNG;
    var lv = local(p, LV_C), rv = local(p, RV_C);
    var lvCav = (lv[0] / 36) * (lv[0] / 36) + (lv[1] / 22) * (lv[1] / 22) + (lv[2] / 22) * (lv[2] / 22);
    var lvOut = (lv[0] / 46) * (lv[0] / 46) + (lv[1] / 29) * (lv[1] / 29) + (lv[2] / 29) * (lv[2] / 29);
    /* RV: thin crescent anterior to the septum (b negative), flattened
     * in b so a 5 mm free wall and a 6 mm septum survive the blur. */
    var rvCav = (rv[0] / 28) * (rv[0] / 28) + (rv[1] / 12) * (rv[1] / 12) + (rv[2] / 20) * (rv[2] / 20);
    var rvOut = (rv[0] / 34) * (rv[0] / 34) + (rv[1] / 17) * (rv[1] / 17) + (rv[2] / 25) * (rv[2] / 25);
    /* Papillary muscles inside the LV cavity. */
    if (lvCav < 1) {
      var p1 = capsule(p, [LV_C[0] + V1[0] * 13 - A[0] * 4, LV_C[1] + V1[1] * 13 - A[1] * 4, LV_C[2] + V1[2] * 13 - A[2] * 4],
        [LV_C[0] + V1[0] * 13 + A[0] * 10, LV_C[1] + V1[1] * 13 + A[1] * 10, LV_C[2] + V1[2] * 13 + A[2] * 10], 3.0);
      var p2 = capsule(p, [LV_C[0] + V2[0] * 13 - A[0] * 4, LV_C[1] + V2[1] * 13 - A[1] * 4, LV_C[2] + V2[2] * 13 - A[2] * 4],
        [LV_C[0] + V2[0] * 13 + A[0] * 10, LV_C[1] + V2[1] * 13 + A[1] * 10, LV_C[2] + V2[2] * 13 + A[2] * 10], 3.0);
      if (p1 < 0 || p2 < 0) return LABELS.MYOCARDIUM;
    }
    /* Valves first: discs with a central orifice (mitral fish mouth in SAX). */
    if (valveDisc(p, BASE, A, V1, V2, 14, 7.5, 10.5, 2.2)) return LABELS.VALVE;
    if (valveDisc(p, AV_C, AO, AO_A1, AO_A2, 9.5, 3.0, 3.0, 1.8)) return LABELS.VALVE;
    if (valveDisc(p, TV_C, A, V1, V2, 11, 5, 2.6, 1.8)) return LABELS.VALVE;
    /* Blood: chambers and great vessels. */
    if (lvCav < 1 || rvCav < 1) return LABELS.BLOOD;
    if (qLocal(p, RVOT_C, 13, 10, 11) < 1) return LABELS.BLOOD;
    if (qLocal(p, LA_C, 15, 13, 14) < 1 || qLocal(p, RA_C, 15, 12, 14) < 1) return LABELS.BLOOD;
    if (capsule(p, AV_C, AO_ASC, 10.5) < 0 || capsule(p, AO_ASC, AO_ARCH, 10) < 0 || capsule(p, AO_ARCH, AO_DESC, 8.5) < 0) return LABELS.BLOOD;
    if (capsule(p, RVOT_C, [18, 10, 48], 8) < 0) return LABELS.BLOOD;
    if (capsule(p, RA_C, [RA_C[0] + 2, RA_C[1] + 2, RA_C[2] + 24], 7.5) < 0) return LABELS.BLOOD;
    if (capsule(p, RA_C, [RA_C[0] + 6, RA_C[1] + 10, RA_C[2] - 24], 7.5) < 0) return LABELS.BLOOD;
    /* Vessel walls. */
    if (capsule(p, AV_C, AO_ASC, 13) < 0 || capsule(p, AO_ASC, AO_ARCH, 12.5) < 0) return LABELS.MYOCARDIUM;
    /* Myocardium: chamber walls and septum between the cavities. */
    if (lvOut < 1 || rvOut < 1) return LABELS.MYOCARDIUM;
    if (qLocal(p, RVOT_C, 18, 15, 16) < 1) return LABELS.MYOCARDIUM;
    if (qLocal(p, LA_C, 19, 17, 19) < 1 || qLocal(p, RA_C, 19, 16, 19) < 1) return LABELS.MYOCARDIUM;
    /* Pericardium: a thin bright shell hugging the heart, not a ball. */
    var qIn = ((pc[0] + 4) / 54) * ((pc[0] + 4) / 54) + ((pc[1] + 4) / 42) * ((pc[1] + 4) / 42) + (pc[2] / 42) * (pc[2] / 42);
    if (pqOut < 1 && qIn > 1) return LABELS.PERICARDIUM;
    if (pqOut < 1.25) return LABELS.FAT;
    return LABELS.OUTSIDE;
  }
  var DIMS = [160, 160, 160], MIN = [-84, -78, -84], SIZE = [168, 156, 168];
  function blur3(src, nx, ny, nz) {
    var tmp = new Float32Array(src.length), out = new Float32Array(src.length), x, y, z, i;
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      i = x + nx * (y + ny * z);
      var xm = x > 0 ? src[i - 1] : src[i], xp = x < nx - 1 ? src[i + 1] : src[i];
      tmp[i] = (xm + src[i] * 2 + xp) * 0.25;
    }
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      i = x + nx * (y + ny * z);
      var ym = y > 0 ? tmp[i - nx] : tmp[i], yp = y < ny - 1 ? tmp[i + nx] : tmp[i];
      out[i] = (ym + tmp[i] * 2 + yp) * 0.25;
    }
    var dst = new Float32Array(src.length);
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      i = x + nx * (y + ny * z);
      var zm = z > 0 ? out[i - nx * ny] : out[i], zp = z < nz - 1 ? out[i + nx * ny] : out[i];
      dst[i] = (zm + out[i] * 2 + zp) * 0.25;
    }
    return dst;
  }
  function buildVolumes() {
    var nx = DIMS[0], ny = DIMS[1], nz = DIMS[2];
    var step = [SIZE[0] / (nx - 1), SIZE[1] / (ny - 1), SIZE[2] / (nz - 1)];
    var n = nx * ny * nz, data = new Uint8Array(n), x, y, z, i;
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      data[x + nx * (y + ny * z)] = classify([MIN[0] + x * step[0], MIN[1] + y * step[1], MIN[2] + z * step[2]]);
    }
    /* Smoothed fields: blur tissue scalars twice (about 2 mm total). */
    function field(pick) {
      var raw = new Float32Array(n);
      for (i = 0; i < n; i++) raw[i] = pick(data[i], i);
      var b = blur3(blur3(raw, nx, ny, nz), nx, ny, nz), u = new Uint8Array(n);
      for (i = 0; i < n; i++) u[i] = Math.round(clamp(b[i], 0, 1) * 255);
      return u;
    }
    var fields = {
      echo: field(function (l) { return TISSUE[l].echo; }),
      atten: field(function (l) { return TISSUE[l].atten / 4; }),
      blood: field(function (l) { return l === 1 ? 1 : 0; }),
      spec: null
    };
    var specRaw = new Float32Array(n);
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      i = x + nx * (y + ny * z); var lab = data[i], bnd = 0;
      if (x + 1 < nx && data[i + 1] !== lab) bnd = 1;
      if (y + 1 < ny && data[i + nx] !== lab) bnd = 1;
      if (z + 1 < nz && data[i + nx * ny] !== lab) bnd = 1;
      specRaw[i] = Math.max(TISSUE[lab].spec * 0.55, bnd * (lab === 3 || lab === 4 ? 1 : 0.45));
    }
    var sb = blur3(specRaw, nx, ny, nz), su = new Uint8Array(n);
    for (i = 0; i < n; i++) su[i] = Math.round(clamp(sb[i], 0, 1) * 255);
    fields.spec = su;
    return { labels: data, fields: fields, dims: DIMS.slice(), min: MIN.slice(), step: step, labelsMeta: LABELS, tissue: TISSUE };
  }
  /* Atlas channels: R smoothed echo, G specular/boundary, B attenuation/4, A blood. */
  function packAtlas(vol) {
    var nx = vol.dims[0], ny = vol.dims[1], nz = vol.dims[2];
    var cols = Math.ceil(Math.sqrt(nz)), rows = Math.ceil(nz / cols), W = cols * nx, H = rows * ny;
    var rgba = new Uint8Array(W * H * 4), x, y, z, i, j;
    for (z = 0; z < nz; z++) for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      j = x + nx * (y + ny * z);
      i = ((z % cols) * nx + x + W * (Math.floor(z / cols) * ny + y)) * 4;
      rgba[i] = vol.fields.echo[j]; rgba[i + 1] = vol.fields.spec[j]; rgba[i + 2] = vol.fields.atten[j]; rgba[i + 3] = vol.fields.blood[j];
    }
    return { rgba: rgba, width: W, height: H, cols: cols, rows: rows, dims: vol.dims.slice(), min: vol.min.slice(), step: vol.step.slice() };
  }
  function poseToPlane(pose) {
    var beam = norm(pose.beam || pose.normal), upIn = norm(pose.up);
    var right = norm(cross(beam, upIn));
    var up = norm(cross(right, beam));
    /* The imaging plane is spanned by beam and right, so its normal
     * (the elevation direction) is up, not cross(right, up) (-beam). */
    return { origin: pose.origin.slice(), beam: beam, right: right, up: up, normal: up.slice() };
  }
  function mkView(origin, beamDir, rightDir, depthCm, label) {
    var beam = norm(beamDir);
    var rd = sub(rightDir, beam.map(function (b) { return b * dot(rightDir, beam); }));
    var right = norm(rd);
    return { origin: origin, beam: beam, up: cross(right, beam), depthCm: depthCm, label: label };
  }
  function along(c, v, d) { return [c[0] + v[0] * d, c[1] + v[1] * d, c[2] + v[2] * d]; }
  /* Standard planes, defined in the heart-local frame.
   * PLAX: plane a-b (normal V2), beam along V1 (anterior to posterior,
   * top to bottom on screen), right toward the base so the apex is on
   * the left and the aortic root and LA are on the right.
   * A4C: beam from apex to base along -A, right across the septum so
   * the RV is on the left of the screen and the LV on the right.
   * PSAX MV: short axis across A at the mitral level, RV at the top. */
  var a4cRight = V1.map(function (v, i) { return v * 0.998 + V2[i] * -0.066; });
  var VIEWS = {
    plax: mkView(along(LV_C, V1, -73), V1, A.map(function (a) { return -a; }), 16, "PLAX"),
    psax_mv: mkView(along(BASE, V1, -66), V1, V2, 14, "PSAX MV"),
    a4c: mkView(along(LV_C, A, 58), A.map(function (a) { return -a; }), a4cRight, 18, "A4C"),
    subcostal_4c: null
  };
  (function () {
    var subOrigin = [4, 44, -80], subTarget = along(LV_C, A, -6);
    VIEWS.subcostal_4c = mkView(subOrigin, sub(subTarget, subOrigin), a4cRight, 19, "Subcostal 4C");
  })();
  var API = { LABELS: LABELS, TISSUE: TISSUE, DIMS: DIMS, MIN: MIN, buildVolumes: buildVolumes, packAtlas: packAtlas,
    classify: classify, contraction: contraction, deformPoint: deformPoint, poseToPlane: poseToPlane, VIEWS: VIEWS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.KARDIA_SIM_VOLUME = API;
})(typeof window !== "undefined" ? window : globalThis);
