/* kardia-sim-us.js - Kardia live B-mode ultrasound renderer (WP3).
 *
 * ES5 IIFE, window.KARDIA_US, module.exports under node. WebGL 1, no
 * libraries. Renders a sector image from the probe plane through the
 * beating geometry supplied by kardia-sim-geom.js (API only: buffers(),
 * cut(), structures(); acoustic tags per group).
 *
 * Design contract (canvas only, no DOM UI is created by this file):
 *  - States: live sector; WebGL unavailable -> CPU cut() fallback drawn
 *    with a 2D context; WebGL context lost -> last frame freezes, no
 *    throw, rendering resumes on webglcontextrestored.
 *  - Look: black field, greyscale B-mode fan, depth scale and marker
 *    dot, optional ECG trace under the sector. No colour, no glow.
 *  - Motion is the cardiac cycle itself (content, not decoration).
 *
 * Pipeline (GPU path):
 *  1. Tissue pass: buffers() drawn orthographically along the plane
 *     normal into a tissue-property texture (probe plane space). Each
 *     fragment within a thin slab of the plane encodes echogenicity,
 *     attenuation and flags (blood / calcium / air / bone); the blue
 *     channel is a per-vertex random speckle seed, so as the mesh
 *     deforms the speckle field moves with the wall.
 *  2. Echo pass (polar: beam angle by depth): marches each beam from
 *     the apex accumulating frequency dependent attenuation and
 *     acoustic shadow behind calcium, bone (rib) and air (lung);
 *     applies Rayleigh speckle, specular boost at interfaces facing
 *     the beam, dark blood with faint slow smoke, reverberation below
 *     strong reflectors, then TGC (8 sliders), gain and dynamic range.
 *  3. Display pass: scan-converts the polar image to the fan, lateral
 *     blur growing with depth and smallest at the focus, sector mask,
 *     depth ticks, marker dot, ECG trace.
 * CPU fallback rasterises geom.cut() polygons into the same polar echo
 * maths (shared pure helpers) and blits with putImageData.
 */
(function (G) {
  "use strict";

  /* ---------------- pure helpers (also exported for node tests) ---- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vlen(a) { return Math.sqrt(dot(a, a)) || 1; }
  function norm(a) { var l = vlen(a); return [a[0] / l, a[1] / l, a[2] / l]; }

  /* Deterministic hash noise 0..1 from integer cell coords. */
  function hash3(x, y, z) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 3266489917);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  /* Rayleigh sample from a uniform 0..1 (sigma = 1). */
  function rayleigh(u) { return Math.sqrt(-2 * Math.log(1 - clamp(u, 0, 0.999999))); }
  /* Fully developed speckle amplitude: Rayleigh with mean ~1. */
  function speckleAmp(u) { return rayleigh(u) / 1.2533; }

  /* Smooth value-noise Gaussian: bilinear (smoothstep) interpolation of
   * hash3 lattice values, normalised by the local interpolation variance
   * so the output is ~N(0,1) everywhere. Continuous per pixel, so it
   * never forms square cells. */
  function smoothGauss2(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    var v00 = hash3(ix, iy, seed), v10 = hash3(ix + 1, iy, seed);
    var v01 = hash3(ix, iy + 1, seed), v11 = hash3(ix + 1, iy + 1, seed);
    var v = (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
    var w00 = (1 - sx) * (1 - sy), w10 = sx * (1 - sy), w01 = (1 - sx) * sy, w11 = sx * sy;
    var varF = w00 * w00 + w10 * w10 + w01 * w01 + w11 * w11;
    return (v - 0.5) * Math.sqrt(12 / Math.max(varF, 1e-6));
  }
  /* Speckle cell size (mm): wider laterally than axially, growing with depth. */
  function speckleSizes(depthMm) {
    return { lateral: 1.50 + depthMm * 0.030, axial: 0.80 + depthMm * 0.004 };
  }
  /* Fully developed speckle from two independent smooth Gaussians (I/Q),
   * so the envelope is Rayleigh with mean ~1. Coordinates are beam-space
   * millimetres: lateralMm across the beam, depthMm along it. */
  function speckleField(lateralMm, depthMm, seed) {
    var sz = speckleSizes(depthMm), s = seed || 11;
    var x = lateralMm / sz.lateral, y = depthMm / sz.axial;
    var I = smoothGauss2(x, y, s), Q = smoothGauss2(x, y, s + 47);
    return Math.sqrt(I * I + Q * Q) / 1.2533;
  }
  /* Display mapping. Echogenicity in the geometry tags is already a
   * display-referred brightness (blood 0.05, myocardium 0.45, bright
   * reflectors 0.8..1.0), so a mild gamma preserves those levels; a
   * 55 dB log curve anchored at echo 1 would put blood at ~0.36 and
   * myocardium at ~0.87. */
  function toDisplay(lin) {
    if (!(lin > 0)) return 0;
    return clamp(Math.pow(clamp(lin, 0, 4), 0.85), 0, 1);
  }
  /* Layout: ECG lives in its own strip; the sector is scaled to fit
   * exactly in the area above it. */
  function layoutFor(W, H, knobs) {
    var ecgH = knobs && knobs.showEcg ? Math.round(H * 0.13) : 0;
    var sectorH = H - ecgH;
    var apexX = W / 2, apexY = Math.min(sectorH - 8, Math.round(sectorH * 0.02) + 4);
    if (apexY < 0) apexY = 0;
    var depth = (knobs && knobs.depth) || 160;
    var scale = depth > 0 ? (sectorH - apexY) / depth : 0;
    return {
      width: W, height: H, ecgHeight: ecgH, sectorHeight: sectorH,
      apexX: apexX, apexY: apexY, scale: scale,
      sector: { x0: 0, y0: 0, x1: W, y1: sectorH, bottom: apexY + depth * scale },
      ecg: ecgH > 0 ? { x0: 0, y0: sectorH, x1: W, y1: H, height: ecgH } : null
    };
  }

  /* Two-way attenuation in dB: alpha (dB/cm/MHz) * f * 2 * depth. */
  function attenuationDb(depthMm, freqMHz, alpha) {
    return (alpha || 0.8) * (freqMHz || 3) * 2 * (depthMm / 10);
  }
  function dbToLin(db) { return Math.pow(10, db / 20); }

  /* TGC: 8 sliders (dB) interpolated over depth, plus overall gain. */
  function tgcDb(depthMm, depthMaxMm, tgc, gainDb) {
    var t = clamp(depthMm / Math.max(1, depthMaxMm), 0, 1) * 7;
    var i = Math.min(6, Math.floor(t)), f = t - i;
    var v = tgc && tgc.length ? lerp(tgc[i] || 0, tgc[i + 1] || 0, f) : 0;
    return v + (gainDb || 0);
  }

  /* Scan conversion: display pixel (x right, y down, apex at 0,0) to
   * beam angle (rad) and depth (mm). Returns null outside the sector. */
  function scanConvert(x, y, sectorDeg, depthMm) {
    var d = Math.sqrt(x * x + y * y);
    if (d > depthMm || d < 0.001) return d < 0.001 ? { angle: 0, depth: 0 } : null;
    var ang = Math.atan2(x, y); /* 0 = centre beam (down) */
    if (Math.abs(ang) > sectorDeg * Math.PI / 360) return null;
    return { angle: ang, depth: d };
  }
  /* Inverse: angle/depth to display coords. */
  function polarToDisplay(angle, depth) { return [Math.sin(angle) * depth, Math.cos(angle) * depth]; }

  /* ECG voltage (mV, lead-II-like) from cycle phase 0..1. */
  function ecgVoltage(phase) {
    function g(c, w, a) { var d = phase - c; d -= Math.round(d); return a * Math.exp(-(d * d) / (2 * w * w)); }
    return g(0.14, 0.018, 0.16) + g(0.285, 0.006, -0.14) + g(0.30, 0.008, 1.0) +
      g(0.315, 0.006, -0.24) + g(0.52, 0.028, 0.30);
  }

  /* Log compression to 0..1 display value. echoLin is linear amplitude
   * referenced so that 0 dB (echoLin 1) sits at the top of the range. */
  function compress(echoLin, dynamicRangeDb) {
    var dr = dynamicRangeDb || 55;
    var db = 20 * Math.log(Math.max(1e-6, echoLin)) / Math.LN10;
    return clamp(1 + db / dr, 0, 1);
  }

  /* One display sample from an acoustic tag. Attenuation is largely
   * TGC-compensated in a real scanner, so only a small residual is
   * applied; shadowFactor (from a blocker up-beam) is passed separately. */
  function echoDisplay(ac, depthMm, speck, knobs, shadowFactor, smoke, extraLin) {
    if (!ac) return 0;
    var lin;
    if (ac.isBlood) lin = ac.echogenicity * speck * 0.9 + (smoke || 0);
    else lin = ac.echogenicity * speck;
    if (ac.isCalcium) lin *= 1.3;
    if (!ac.isBlood && ac.echogenicity >= 0.70) lin *= 1.25;
    if (!ac.isBlood && ac.echogenicity >= 0.25 && ac.echogenicity <= 0.65) lin *= 1.12;
    if (extraLin) lin *= extraLin;
    if (shadowFactor != null) lin *= shadowFactor;
    /* path attenuation uses a reference tissue alpha: the beam path is
     * mixed tissue, not a full depth of the sampled material */
    var loss = attenuationDb(depthMm, (knobs && knobs.frequencyMHz) || 3, 0.8) * 0.07;
    var tg = knobs ? tgcDb(depthMm, knobs.depth, knobs.tgc, knobs.gain) : 0;
    lin *= dbToLin(tg - loss);
    return toDisplay(lin) * clamp(depthMm / 6, 0, 1);
  }
  function isBlocker(ac) { return !!(ac && (ac.isCalcium || ac.isAir || ac.isBone)); }
  /* 4x4 Bayer dither in LSBs: breaks up flat quantised areas without
   * changing mean brightness. Adjacent pixels always get different
   * offsets, horizontally and vertically. */
  var BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bayerDither(x, y) { return (BAYER4[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * 18; }

  var DEFAULT_KNOBS = {
    gain: 0, depth: 160, focusMm: 70,
    tgc: [0, 0, 0, 0, 0, 0, 0, 0],
    frequencyMHz: 3.0, sectorDeg: 80, dynamicRange: 55,
    resolutionScale: 1, showEcg: true
  };
  function mergeKnobs(dst, src) {
    if (!src) return dst;
    for (var k in DEFAULT_KNOBS) if (src[k] !== undefined) dst[k] = src[k];
    if (src.tgc) dst.tgc = src.tgc.slice(0, 8);
    while (dst.tgc.length < 8) dst.tgc.push(0);
    return dst;
  }

  /* ---------------- renderer -------------------------------------- */
  function create(canvas, geom, heart) {
    if (!canvas) throw new Error("KARDIA_US: canvas required");
    if (!geom || typeof geom.buffers !== "function") throw new Error("KARDIA_US: geom with buffers() required");
    var knobs = mergeKnobs({}, DEFAULT_KNOBS);
    var probe = { origin: [0, 60, 20], normal: [1, 0, 0], up: [0, 0.95, 0.31] };
    var destroyed = false, lost = false, gl = null, ctx2d = null;
    var errors = [];
    var lastMs = 0, emaMs = 0, frameCount = 0, lastT = 0;
    var stats = { mean: 0, bloodMean: 0, myoMean: 0, frames: 0, ms: 0, fps: 0, depthMm: knobs.depth, sectorDeg: knobs.sectorDeg, mode: "none", bloodCount: 0, myoCount: 0 };

    function setProbe(p) {
      if (!p) return api;
      if (p.viewId && typeof geom.viewPlane === "function") {
        var vp = geom.viewPlane(p.viewId);
        var upv = norm(vp.up);
        var d = (p.depthMm || knobs.depth);
        probe = { origin: add(vp.origin, mul(upv, d * 0.42)), normal: norm(vp.normal), up: upv, viewOrigin: vp.origin };
        if (p.sectorDeg) knobs.sectorDeg = p.sectorDeg;
        return api;
      }
      if (p.origin) probe.origin = p.origin.slice();
      if (p.normal) probe.normal = norm(p.normal);
      if (p.up) probe.up = norm(p.up);
      if (p.viewOrigin) probe.viewOrigin = p.viewOrigin.slice();
      return api;
    }
    function setKnobs(k) { mergeKnobs(knobs, k); return api; }

    /* Probe frame: beam centre dir is -up (apex sits at the top of the
     * displayed sector), lateral axis completes the plane basis. */
    function probeFrame() {
      var n = norm(probe.normal), up = norm(probe.up);
      var beam = mul(up, -1);
      var right = norm(cross(n, up)); /* plane coords x, matches geom.cut */
      var planeOrigin = probe.viewOrigin || probe.origin;
      return { n: n, up: up, beam: beam, right: right, planeOrigin: planeOrigin, apex: probe.origin };
    }

    /* ============ GPU path ============ */
    var VS_TISSUE = "attribute vec3 aPos; attribute float aSeed; uniform mat4 uOrtho; uniform vec3 uN; uniform vec3 uOrigin; varying float vDist; varying float vSeed;\nvoid main(){ vDist = dot(aPos - uOrigin, uN); vSeed = aSeed; gl_Position = uOrtho * vec4(aPos, 1.0); }";
    var FS_TISSUE = "precision mediump float; varying float vDist; varying float vSeed; uniform vec4 uProps; uniform float uHalf;\nvoid main(){ if (uHalf > 0.5 && vDist < 0.0) discard; gl_FragColor = vec4(uProps.rgb, vSeed); }";
    var FS_FILL = "precision mediump float; uniform vec4 uProps; uniform float uSeed;\nvoid main(){ gl_FragColor = vec4(uProps.rgb, uSeed); }";
    /* props: rgb = (echogenicity, flags/255, attenuation/3), a = seed.
       flags bits: 1 blood, 2 calcium, 4 air, 8 bone. */
    var VS_QUAD = "attribute vec2 aP; varying vec2 vUv; void main(){ vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }";
    var FS_ECHO = [
      "precision highp float; varying vec2 vUv; uniform sampler2D uTissue;",
      "uniform vec3 uApex; uniform vec3 uBeam; uniform vec3 uRight; uniform vec3 uPlaneO; uniform vec3 uPRight; uniform vec3 uPUp;",
      "uniform float uDepth; uniform float uSector; uniform float uFreq; uniform float uTime; uniform float uTgc[8]; uniform float uGain; uniform float uDR; uniform float uFocus;",
      "float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
      "float sgauss(vec2 c, float seed){ vec2 i = floor(c); vec2 f = c - i; vec2 s = f * f * (3.0 - 2.0 * f);",
      " float v = mix(mix(hash21(i + seed), hash21(i + vec2(1.0, 0.0) + seed), s.x), mix(hash21(i + vec2(0.0, 1.0) + seed), hash21(i + vec2(1.0, 1.0) + seed), s.x), s.y);",
      " vec4 w = vec4((1.0 - s.x) * (1.0 - s.y), s.x * (1.0 - s.y), (1.0 - s.x) * s.y, s.x * s.y);",
      " float varF = dot(w, w); return (v - 0.5) * sqrt(12.0 / max(varF, 0.001)); }",
      "vec4 tissueAt(vec3 w){ vec2 uv = vec2(dot(w - uPlaneO, uPRight), dot(w - uPlaneO, uPUp)) / vec2(uDepth * 1.7, uDepth * 1.7) + 0.5; return texture2D(uTissue, uv); }",
      "float tgcAt(float d){ float t = clamp(d / uDepth, 0.0, 1.0) * 7.0; int i = int(floor(t)); float f = t - float(i); float a = 0.0; float b = 0.0;",
      " for (int k = 0; k < 8; k++){ if (k == i) a = uTgc[k]; if (k == i + 1) b = uTgc[k]; } return mix(a, b, f) + uGain; }",
      "void main(){",
      " float beam = vUv.x; float depth = vUv.y * uDepth;",
      " float ang = (beam - 0.5) * uSector;",
      " vec3 dir = normalize(uBeam * cos(ang) + uRight * sin(ang));",
      " vec3 w = uApex + dir * depth;",
      " vec4 tis = tissueAt(w);",
      " float echo = tis.r; float flags = floor(tis.g * 255.0 + 0.5); float atten = tis.b * 3.0;",
      " bool isBlood = mod(flags, 2.0) >= 1.0; bool isCalc = mod(floor(flags / 2.0), 2.0) >= 1.0;",
      " bool isAir = mod(floor(flags / 4.0), 2.0) >= 1.0; bool isBone = mod(floor(flags / 8.0), 2.0) >= 1.0;",
      " /* beam march: attenuation + shadow behind strong reflectors */",
      " float lossDb = 0.0; float shadow = 1.0; float strongAt = -1.0; float strongAmp = 0.0; bool prevBlk = false;",
      " int STEPS = 40; float stepMm = depth / float(STEPS);",
      " for (int i = 1; i <= 40; i++){ float d = float(i) * stepMm; if (d >= depth) break; vec4 t2 = tissueAt(uApex + dir * d); float f2 = floor(t2.g * 255.0 + 0.5);",
      "   lossDb += (t2.b * 3.0) * uFreq * 2.0 * (stepMm / 10.0);",
      "   bool blk = mod(floor(f2 / 2.0), 2.0) >= 1.0 || mod(floor(f2 / 4.0), 2.0) >= 1.0 || mod(floor(f2 / 8.0), 2.0) >= 1.0;",
      "   if (blk && !prevBlk && d < depth - 2.0){ shadow *= 0.08; if (strongAt < 0.0){ strongAt = d; strongAmp = t2.r; } } prevBlk = blk; }",
      " /* speckle: smooth I/Q Gaussian field, elongated laterally and",
      "  * growing with depth; never square cells */",
      " float latMm = (beam - 0.5) * uSector * depth;",
      " vec2 sc2 = vec2(latMm / (1.50 + depth * 0.030), depth / (0.80 + depth * 0.004));",
      " float gI = sgauss(sc2, 11.0); float gQ = sgauss(sc2, 58.0);",
      " float speck = sqrt(gI * gI + gQ * gQ) / 1.2533;",
      " /* specular: interface strength from echogenicity gradient */",
      " vec4 tx = tissueAt(w + uRight * 1.6); vec4 ty = tissueAt(w + uBeam * 1.6);",
      " float grad = abs(tx.r - tis.r) + abs(ty.r - tis.r);",
      " float facing = clamp(1.0 - abs(dot(dir, uBeam)) * 0.35, 0.6, 1.0);",
      " float spec = grad * 2.4 * facing * step(0.04, grad);",
      " float amp = echo;",
      " bool isBlk = isCalc || isAir || isBone;",
      " if (isBlk){ vec4 tb = tissueAt(w - dir * 3.0); float fb = floor(tb.g * 255.0 + 0.5); bool backBlk = mod(floor(fb / 2.0), 2.0) >= 1.0 || mod(floor(fb / 4.0), 2.0) >= 1.0 || mod(floor(fb / 8.0), 2.0) >= 1.0; if (backBlk) shadow *= 0.08; else amp *= 1.65; }",
      " if (!isBlood && echo >= 0.70) amp *= 1.25; if (!isBlood && echo >= 0.25 && echo <= 0.65) amp *= 1.12;",
      " float pixU = hash21(floor(vUv * vec2(160.0, 256.0))); float pixSpeck = sqrt(-2.0 * log(1.0 - clamp(pixU, 0.0, 0.999))) / 1.2533; speck = speck * 0.75 + pixSpeck * 0.25;",
      " float smoke = 0.0;",
      " if (isBlood){ amp = echo * speck * 0.9; smoke = sgauss(vec2(latMm / 6.0, depth / 6.0 - uTime * 0.12), 91.0) * 0.008; }",
      " float lin = (isBlood ? amp + max(smoke, 0.0) : amp * speck + spec) * shadow;",
      " /* reverberation: repeat below a strong reflector */",
      " if (strongAt > 0.0 && depth > strongAt * 1.9 && depth < strongAt * 2.15) lin += strongAmp * 0.20 * shadow;",
      " if (strongAt > 0.0 && depth > strongAt * 2.9 && depth < strongAt * 3.15) lin += strongAmp * 0.09 * shadow;",
      " float totalDb = tgcAt(depth) - lossDb * 0.07;",
      " lin *= pow(10.0, totalDb / 20.0);",
      " if (isCalc) lin *= 1.3;",
      " float disp = clamp(pow(clamp(lin, 0.0, 4.0), 0.85), 0.0, 1.0);",
      " /* near-field clutter fade + far fade */",
      " disp *= smoothstep(0.0, 6.0, depth);",
      " gl_FragColor = vec4(vec3(disp), 1.0);",
      "}"
    ].join("\n");
    var FS_DISP = [
      "precision highp float; varying vec2 vUv; uniform sampler2D uPolar; uniform float uAspect; uniform float uSector; uniform float uDepth; uniform float uFocus; uniform float uShowEcg; uniform float uTime; uniform float uPhase;",
      "float ecg(float ph){ float v = 0.0; v += 0.16 * exp(-pow(ph - 0.14, 2.0) / 0.00065); v += -0.14 * exp(-pow(ph - 0.285, 2.0) / 0.00007); v += 1.0 * exp(-pow(ph - 0.30, 2.0) / 0.00013); v += -0.24 * exp(-pow(ph - 0.315, 2.0) / 0.00007); v += 0.30 * exp(-pow(ph - 0.52, 2.0) / 0.0016); return v; }",
      "void main(){",
      " float ecgH = uShowEcg > 0.5 ? 0.13 : 0.0;",
      " float imgH = 1.0 - ecgH;",
      " bool inStrip = uShowEcg > 0.5 && vUv.y < ecgH;",
      " /* sector space inside the image area only: y 0 at its top */",
      " vec2 sp = vec2((vUv.x - 0.5) * uAspect, (1.0 - vUv.y) / imgH);",
      " vec2 p = sp;",
      " float r = length(vec2(sp.x, sp.y - 0.02));",
      " float ang = atan(sp.x, max(sp.y - 0.02, 0.0001));",
      " float halfA = uSector * 0.5;",
      " vec3 col = vec3(0.0);",
      " if (!inStrip && sp.y > 0.015 && abs(ang) <= halfA && r <= 1.0){",
      "   float depth = r * uDepth;",
      "   /* lateral blur: grows with depth, least at focus */",
      "   float blur = (0.0016 + abs(depth - uFocus) / uDepth * 0.006 + depth / uDepth * 0.004);",
      "   float bx = ang / uSector + 0.5; float by = depth / uDepth;",
      "   float v = 0.0; float wsum = 0.0;",
      "   for (int i = -2; i <= 2; i++){ float wgt = exp(-float(i * i) * 0.7); v += texture2D(uPolar, vec2(bx + float(i) * blur, by)).r * wgt; wsum += wgt; }",
      "   v /= wsum;",
      "   /* edge falloff at sector boundary */",
      "   v *= smoothstep(halfA, halfA - 0.03, abs(ang));",
      "   col = vec3(v);",
      "   /* depth ticks every 10 mm on the right edge */",
      "   float tick = step(abs(fract(depth / 10.0) - 0.5), 0.46) * step(abs(abs(ang) - halfA + 0.012), 0.006) * step(6.0, depth);",
      "   col += vec3(0.35) * tick;",
      "   col += vec3((mod(gl_FragCoord.x + gl_FragCoord.y, 2.0) - 0.5) * 0.020);",
      " }",
      " /* marker dot at apex (image area only) */",
      " float md = length(vec2(p.x, p.y - 0.02)); if (!inStrip && md < 0.008) col = vec3(0.9);",
      " /* ECG trace in its own strip; sector never enters it */",
      " if (inStrip){",
      "   col = vec3(0.0);",
      "   float ph = fract(uPhase + vUv.x * 1.0);",
      "   float yv = ecgH * (0.45 + ecg(ph) * 0.32);",
      "   float d = abs(vUv.y - yv);",
      "   col = mix(col, vec3(0.45, 0.95, 0.55), smoothstep(0.004, 0.001, d));",
      " }",
      " gl_FragColor = vec4(col, 1.0);",
      "}"
    ].join("\n");

    var progT = null, progE = null, progD = null, progF = null, vbPos = null, vbSeed = null, ibBuf = null, quadBuf = null;
    var fboT = null, texT = null, fboP = null, texP = null, groupsCache = [];
    var TW = 256, PH = 256, BEAMS = 160, SAMPLES = 256;

    function compile(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = "shader: " + gl.getShaderInfoLog(s); errors.push(e); throw new Error(e); }
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = "link: " + gl.getProgramInfoLog(p); errors.push(e); throw new Error(e); }
      return p;
    }
    function makeFbo(w, h) {
      var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      var rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb: fb, tex: tex, rb: rb, w: w, h: h };
    }
    function buildGL() {
      gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: true, preserveDrawingBuffer: true }) ||
        canvas.getContext("experimental-webgl", { preserveDrawingBuffer: true, stencil: true });
      if (!gl) return false;
      if (!gl.getExtension("OES_element_index_uint")) { errors.push("OES_element_index_uint unavailable"); }
      progT = program(VS_TISSUE, FS_TISSUE); progE = program(VS_QUAD, FS_ECHO); progD = program(VS_QUAD, FS_DISP); progF = program(VS_QUAD, FS_FILL);
      vbPos = gl.createBuffer(); vbSeed = gl.createBuffer(); ibBuf = gl.createBuffer(); quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var scale = clamp(knobs.resolutionScale || 1, 0.4, 1);
      fboT = makeFbo(Math.round(TW * scale), Math.round(TW * scale));
      fboP = makeFbo(BEAMS, SAMPLES);
      return true;
    }
    function orthoForFrame(f) {
      /* Map patient coords to clip: x along frame right, y along up,
       * centred on planeOrigin, extent depth*1.7. */
      var e = knobs.depth * 1.7 / 2;
      /* Build matrix manually in shader-friendly form: we pass a mat4
       * that projects world -> clip using basis vectors. */
      var r = f.right, u = f.up, n = f.n, o = f.planeOrigin;
      /* clip = [dot(p-o,r)/e, dot(p-o,u)/e, 0] */
      return new Float32Array([
        r[0] / e, u[0] / e, 0, 0,
        r[1] / e, u[1] / e, 0, 0,
        r[2] / e, u[2] / e, 0, 0,
        -dot(o, r) / e, -dot(o, u) / e, 0, 1
      ]);
    }
    function flagsOf(ac) {
      var f = 0;
      if (ac.isBlood) f |= 1; if (ac.isCalcium) f |= 2; if (ac.isAir) f |= 4; if (ac.isBone) f |= 8;
      return f;
    }
    function renderGPU(tMs) {
      var f = probeFrame();
      var b = geom.buffers();
      groupsCache = b.groups;
      /* upload positions + per-vertex speckle seed (advected) */
      gl.bindBuffer(gl.ARRAY_BUFFER, vbPos); gl.bufferData(gl.ARRAY_BUFFER, b.positions, gl.DYNAMIC_DRAW);
      var seeds = new Float32Array(b.positions.length / 3);
      for (var i = 0; i < seeds.length; i++) seeds[i] = hash3(i % 4096, (i / 4096) | 0, 7);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbSeed); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.indices, gl.DYNAMIC_DRAW);
      /* 1. tissue pass */
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboT.fb); gl.viewport(0, 0, fboT.w, fboT.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(progT);
      var locPos = gl.getAttribLocation(progT, "aPos"), locSeed = gl.getAttribLocation(progT, "aSeed");
      gl.bindBuffer(gl.ARRAY_BUFFER, vbPos); gl.enableVertexAttribArray(locPos); gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbSeed); gl.enableVertexAttribArray(locSeed); gl.vertexAttribPointer(locSeed, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibBuf);
      gl.uniformMatrix4fv(gl.getUniformLocation(progT, "uOrtho"), false, orthoForFrame(f));
      gl.uniform3f(gl.getUniformLocation(progT, "uN"), f.n[0], f.n[1], f.n[2]);
      gl.uniform3f(gl.getUniformLocation(progT, "uOrigin"), f.planeOrigin[0], f.planeOrigin[1], f.planeOrigin[2]);
      gl.uniform1f(gl.getUniformLocation(progT, "uHalf"), 1);
      /* Stencil cap per group: count half-space crossings, then fill
       * the cap (the tissue texture itself, viewed along the normal)
       * where the count is non-zero. Fills the slice interior. */
      gl.enable(gl.STENCIL_TEST); gl.enable(gl.CULL_FACE);
      /* Paint caps largest first so inner structures (blood cavities
       * inside walls inside pericardium inside chest wall) win. */
      var order = b.groups.map(function (g, ix) {
        var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (var vi = g.vertexStart * 3; vi < (g.vertexStart + g.vertexCount) * 3; vi += 3)
          for (var ax = 0; ax < 3; ax++) { var vv = b.positions[vi + ax]; if (vv < mn[ax]) mn[ax] = vv; if (vv > mx[ax]) mx[ax] = vv; }
        return { ix: ix, vol: (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]) };
      }).sort(function (a, b2) { return b2.vol - a.vol; }).map(function (o) { return o.ix; });
      for (var oi = 0; oi < order.length; oi++) {
        var gi = order[oi];
        var g = b.groups[gi], ac = g.acoustic || { echogenicity: 0.4, attenuation: 0.9 };
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.stencilMask(0xff); gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        gl.useProgram(progT);
        gl.uniformMatrix4fv(gl.getUniformLocation(progT, "uOrtho"), false, orthoForFrame(f));
        gl.uniform3f(gl.getUniformLocation(progT, "uN"), f.n[0], f.n[1], f.n[2]);
        gl.uniform3f(gl.getUniformLocation(progT, "uOrigin"), f.planeOrigin[0], f.planeOrigin[1], f.planeOrigin[2]);
        gl.uniform1f(gl.getUniformLocation(progT, "uHalf"), 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbPos); gl.enableVertexAttribArray(locPos); gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbSeed); gl.enableVertexAttribArray(locSeed); gl.vertexAttribPointer(locSeed, 1, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibBuf);
        gl.cullFace(gl.FRONT); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR_WRAP);
        gl.drawElements(gl.TRIANGLES, g.indexCount, gl.UNSIGNED_INT, g.indexStart * 4);
        gl.cullFace(gl.BACK); gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR_WRAP);
        gl.drawElements(gl.TRIANGLES, g.indexCount, gl.UNSIGNED_INT, g.indexStart * 4);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.NOTEQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        gl.useProgram(progF);
        var locQF = gl.getAttribLocation(progF, "aP");
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(locQF); gl.vertexAttribPointer(locQF, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4f(gl.getUniformLocation(progF, "uProps"), ac.echogenicity, flagsOf(ac) / 255, clamp((ac.attenuation || 0.9) / 3, 0, 1), 0);
        gl.uniform1f(gl.getUniformLocation(progF, "uSeed"), hash3(gi, 17, 3));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(locQF);
        gl.useProgram(progT);
      }
      gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE); gl.stencilMask(0xff);
      gl.disableVertexAttribArray(locPos); gl.disableVertexAttribArray(locSeed);
      /* 2. echo pass into polar FBO */
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboP.fb); gl.viewport(0, 0, fboP.w, fboP.h);
      gl.useProgram(progE);
      var locQ = gl.getAttribLocation(progE, "aP");
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(locQ); gl.vertexAttribPointer(locQ, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboT.tex);
      gl.uniform1i(gl.getUniformLocation(progE, "uTissue"), 0);
      gl.uniform3f(gl.getUniformLocation(progE, "uApex"), f.apex[0], f.apex[1], f.apex[2]);
      gl.uniform3f(gl.getUniformLocation(progE, "uBeam"), f.beam[0], f.beam[1], f.beam[2]);
      gl.uniform3f(gl.getUniformLocation(progE, "uRight"), f.right[0], f.right[1], f.right[2]);
      gl.uniform3f(gl.getUniformLocation(progE, "uPlaneO"), f.planeOrigin[0], f.planeOrigin[1], f.planeOrigin[2]);
      gl.uniform3f(gl.getUniformLocation(progE, "uPRight"), f.right[0], f.right[1], f.right[2]);
      gl.uniform3f(gl.getUniformLocation(progE, "uPUp"), f.up[0], f.up[1], f.up[2]);
      gl.uniform1f(gl.getUniformLocation(progE, "uDepth"), knobs.depth);
      gl.uniform1f(gl.getUniformLocation(progE, "uSector"), knobs.sectorDeg * Math.PI / 180);
      gl.uniform1f(gl.getUniformLocation(progE, "uFreq"), knobs.frequencyMHz);
      gl.uniform1f(gl.getUniformLocation(progE, "uTime"), tMs / 1000);
      gl.uniform1f(gl.getUniformLocation(progE, "uGain"), knobs.gain);
      gl.uniform1f(gl.getUniformLocation(progE, "uDR"), knobs.dynamicRange);
      gl.uniform1f(gl.getUniformLocation(progE, "uFocus"), knobs.focusMm);
      var tgcLoc = gl.getUniformLocation(progE, "uTgc[0]");
      gl.uniform1fv(tgcLoc, new Float32Array(knobs.tgc));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(locQ);
      /* 3. display pass */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(progD);
      var locQ2 = gl.getAttribLocation(progD, "aP");
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(locQ2); gl.vertexAttribPointer(locQ2, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboP.tex);
      gl.uniform1i(gl.getUniformLocation(progD, "uPolar"), 0);
      gl.uniform1f(gl.getUniformLocation(progD, "uAspect"), canvas.width / Math.max(1, layoutFor(canvas.width, canvas.height, knobs).sectorHeight));
      gl.uniform1f(gl.getUniformLocation(progD, "uSector"), knobs.sectorDeg * Math.PI / 180);
      gl.uniform1f(gl.getUniformLocation(progD, "uDepth"), knobs.depth);
      gl.uniform1f(gl.getUniformLocation(progD, "uFocus"), knobs.focusMm);
      gl.uniform1f(gl.getUniformLocation(progD, "uShowEcg"), knobs.showEcg ? 1 : 0);
      var phase = 0;
      if (heart && heart.state) { var st = heart.state(); phase = (st.cycleTimeMs || 0) / Math.max(1, st.cycleMs || st.rrMs || 857); }
      gl.uniform1f(gl.getUniformLocation(progD, "uPhase"), phase);
      gl.uniform1f(gl.getUniformLocation(progD, "uTime"), tMs / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(locQ2);
      return true;
    }

    /* ============ CPU fallback (geom.cut rasterised) ============ */
    /* Innermost structure wins: a blood cavity sits inside the wall
     * outline that contains it, so prefer blood, then the smallest
     * containing polygon. */
    function classify(cx, cy, polys) {
      var best = null, bestArea = 1e18;
      for (var i = 0; i < polys.length; i++) {
        if (!pointInPoly(cx, cy, polys[i].points)) continue;
        var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
        polys[i].points.forEach(function (p) { if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; });
        var area = (mxx - mnx) * (mxy - mny);
        if (polys[i].acoustic.isBlood) area *= 0.001; /* cavities win */
        if (area < bestArea) { bestArea = area; best = polys[i]; }
      }
      return best;
    }
    function pointInPoly(x, y, pts) {
      var inside = false;
      for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    }
    function renderCPU(tMs) {
      if (!ctx2d) ctx2d = canvas.getContext("2d");
      if (!ctx2d) return false;
      var f = probeFrame();
      var polys = [];
      try { polys = geom.cut(f.planeOrigin, f.n, f.up, knobs.depth * 1.7, knobs.depth * 1.7) || []; } catch (e) { errors.push(String(e && e.message || e)); }
      var W = canvas.width, H = canvas.height;
      var img = ctx2d.createImageData(W, H);
      var data = img.data;
      var lay = layoutFor(W, H, knobs);
      var ecgH = lay.ecgHeight, sectorH = lay.sectorHeight;
      var apexX = lay.apexX, apexY = lay.apexY;
      var scale = lay.scale; /* px per mm, sector fits above the ECG strip */
      var phase = 0;
      if (heart && heart.state) { var st = heart.state(); phase = (st.cycleTimeMs || 0) / Math.max(1, st.cycleMs || 857); }
      for (var py = 0; py < H; py++) {
        for (var px = 0; px < W; px++) {
          var o = (py * W + px) * 4;
          if (py >= sectorH) { /* ECG strip */
            if (ecgH > 4) {
              var ph = ((px / W) + phase) % 1;
              var ey = sectorH + ecgH * 0.55 - ecgVoltage(ph) * ecgH * 0.32;
              if (Math.abs(py - ey) < 1.2) { data[o] = 110; data[o + 1] = 240; data[o + 2] = 140; data[o + 3] = 255; continue; }
            }
            data[o + 3] = 255; continue;
          }
          var dx = (px - apexX) / scale, dy = (py - apexY) / scale;
          var sc = scanConvert(dx, dy, knobs.sectorDeg, knobs.depth);
          if (!sc) { data[o + 3] = 255; continue; }
          /* world / plane coords of this sample */
          var dirv = add(mul(f.beam, Math.cos(sc.angle)), mul(f.right, Math.sin(sc.angle)));
          var w = add(f.apex, mul(dirv, sc.depth));
          var rel = sub(w, f.planeOrigin);
          var cx = dot(rel, f.right), cy = dot(rel, f.up);
          var hit = classify(cx, cy, polys);
          var disp = 0;
          if (hit) {
            var ac = hit.acoustic;
            var speck = speckleField(Math.sin(sc.angle) * sc.depth, sc.depth, 11) * 0.75 + speckleAmp(hash3(px, py, 77)) * 0.25;
            var smoke = ac.isBlood ? Math.max(0, smoothGauss2(Math.sin(sc.angle) * sc.depth / 6, sc.depth / 6 - tMs / 8000, 91)) * 0.008 : 0;
            var shF = 1, exF = 1;
            if (isBlocker(ac)) {
              var bk = sc.depth > 4 ? classify(dot(sub(add(f.apex, mul(dirv, sc.depth - 3)), f.planeOrigin), f.right), dot(sub(add(f.apex, mul(dirv, sc.depth - 3)), f.planeOrigin), f.up), polys) : null;
              if (bk && isBlocker(bk.acoustic)) shF = 0.08; else exF = 1.65;
            }
            disp = echoDisplay(ac, sc.depth, speck, knobs, shF, smoke, exF);
          }
          var v = Math.round(clamp(disp, 0, 1) * 255 + bayerDither(px, py));
          data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
        }
      }
      /* marker dot */
      ctx2d.putImageData(img, 0, 0);
      ctx2d.fillStyle = "#e6e6e6";
      ctx2d.beginPath(); ctx2d.arc(apexX, apexY, 3, 0, 6.2832); ctx2d.fill();
      return true;
    }

    function classifyAt(angle, depth, f, polys) {
      var w = add(f.apex, mul(add(mul(f.beam, Math.cos(angle)), mul(f.right, Math.sin(angle))), depth));
      var rel = sub(w, f.planeOrigin);
      return classify(dot(rel, f.right), dot(rel, f.up), polys);
    }
    function computeStatsFromPolar(opts) {
      opts = opts || {};
      if (gl && fboP && !lost) {
        var w = fboP.w, h = fboP.h, px = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboP.fb);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        var sum = 0, n = 0;
        for (var i = 0; i < px.length; i += 4 * 13) { sum += px[i]; n++; }
        stats.mean = n ? sum / n / 255 : 0;
      }
      var lay = layoutFor(canvas.width || 390, canvas.height || 312, knobs);
      stats.layout = lay;
      stats.ecgSectorOverlapPx = lay.ecg ? Math.max(0, lay.sector.bottom - lay.ecg.y0) : 0;
      try {
        var f = probeFrame();
        var polys = geom.cut(f.planeOrigin, f.n, f.up, knobs.depth * 1.7, knobs.depth * 1.7) || [];
        /* display-space grid; masks come from the geometry acoustic tags */
        var GW = opts.gridW || 176, GH = opts.gridH || 132;
        var glay = layoutFor(GW, GH, knobs);
        var vals = new Float32Array(GW * GH), byts = new Uint8Array(GW * GH);
        var tiss = new Uint8Array(GW * GH), angs = new Float32Array(GW * GH), regs = new Uint8Array(GW * GH);
        var sums = { blood: 0, myocardium: 0, bright: 0, shadow: 0, other: 0 };
        var cnts = { blood: 0, myocardium: 0, bright: 0, shadow: 0, other: 0 };
        var shadowCache = {};
        function shadowFor(angle, depth, ac) {
          if (isBlocker(ac)) return 1;
          var key = Math.round(angle * 400);
          var bd = shadowCache[key];
          if (bd === undefined) {
            bd = -1;
            for (var d = 5; d < knobs.depth - 2; d += 4) { var hh = classifyAt(angle, d, f, polys); if (hh && isBlocker(hh.acoustic)) { bd = d; break; } }
            shadowCache[key] = bd;
          }
          return (bd > 0 && depth > bd + 2) ? 0.08 : 1;
        }
        for (var py = 0; py < GH; py++) for (var gx = 0; gx < GW; gx++) {
          var idx = py * GW + gx;
          if (py >= glay.sectorHeight) continue;
          var dx = (gx - glay.apexX) / glay.scale, dy = (py - glay.apexY) / glay.scale;
          var sc = scanConvert(dx, dy, knobs.sectorDeg, knobs.depth);
          if (!sc) continue;
          var hit = classifyAt(sc.angle, sc.depth, f, polys);
          if (!hit) continue;
          var ac = hit.acoustic, sh = shadowFor(sc.angle, sc.depth, ac);
          var extra = 1, blockerInterior = false;
          if (isBlocker(ac)) {
            var back = sc.depth > 4 ? classifyAt(sc.angle, sc.depth - 3, f, polys) : null;
            if (back && isBlocker(back.acoustic)) { blockerInterior = true; sh = 0.08; } else extra = 1.65;
          }
          var speck = speckleField(Math.sin(sc.angle) * sc.depth, sc.depth, 11) * 0.75 + speckleAmp(hash3(gx, py, 77)) * 0.25;
          var disp = echoDisplay(ac, sc.depth, speck, knobs, sh, 0, extra);
          vals[idx] = disp; byts[idx] = clamp(Math.round(clamp(disp, 0, 1) * 255 + bayerDither(gx, py)), 0, 255); tiss[idx] = 1; angs[idx] = sc.angle;
          var region = (sh < 1 || blockerInterior) ? "shadow" : ac.isBlood ? "blood" : (ac.echogenicity >= 0.70 || ac.isCalcium || ac.isBone || ac.isAir) ? "bright" : (ac.echogenicity >= 0.25 && ac.echogenicity <= 0.65) ? "myocardium" : "other";
          regs[idx] = region === "myocardium" ? 1 : region === "blood" ? 2 : 0;
          sums[region] += disp; cnts[region]++;
        }
        var regions = {};
        for (var rk in sums) regions[rk] = { mean: cnts[rk] ? sums[rk] / cnts[rk] : 0, count: cnts[rk] };
        stats.regions = regions;
        stats.bloodMean = regions.blood.mean; stats.myoMean = regions.myocardium.mean;
        stats.brightMean = regions.bright.mean; stats.shadowMean = regions.shadow.mean;
        stats.bloodCount = regions.blood.count; stats.myoCount = regions.myocardium.count;
        stats.brightCount = regions.bright.count; stats.shadowCount = regions.shadow.count;
        /* blockiness: longest run of identical bytes inside speckle
         * tissue (blood and myocardium; saturated reflector lines and
         * acoustic shadow are not speckle) */
        var maxH = 0, maxV = 0, x2, y2, run;
        function speckPx(i2) { return regs[i2] === 1 || regs[i2] === 2; }
        for (y2 = 0; y2 < GH; y2++) { run = 0; for (x2 = 0; x2 < GW; x2++) { var ii = y2 * GW + x2; run = (speckPx(ii) && run > 0 && byts[ii] === byts[ii - 1] && speckPx(ii - 1)) ? run + 1 : speckPx(ii) ? 1 : 0; if (run > maxH) maxH = run; } }
        for (x2 = 0; x2 < GW; x2++) { run = 0; for (y2 = 0; y2 < GH; y2++) { var jj = y2 * GW + x2; run = (speckPx(jj) && run > 0 && byts[jj] === byts[jj - GW] && speckPx(jj - GW)) ? run + 1 : speckPx(jj) ? 1 : 0; if (run > maxV) maxV = run; } }
        stats.blockiness = { maxRunH: maxH, maxRunV: maxV };
        /* speckle autocorrelation (central wedge: horizontal ~ lateral,
         * vertical ~ axial), length = first lag below 1/e, in px and mm */
        function corrLag(lag, horiz) {
          var s1 = 0, s2 = 0, s12 = 0, q1 = 0, q2 = 0, m = 0;
          for (var yy = 0; yy < GH; yy++) for (var xx = 0; xx < GW; xx++) {
            var a = yy * GW + xx, b = horiz ? a + lag : a + lag * GW;
            if (horiz ? xx + lag >= GW : yy + lag >= GH) continue;
            if (!tiss[a] || !tiss[b] || regs[a] !== 1 || regs[b] !== 1 || Math.abs(angs[a]) > 0.26) continue;
            s1 += vals[a]; s2 += vals[b]; s12 += vals[a] * vals[b]; q1 += vals[a] * vals[a]; q2 += vals[b] * vals[b]; m++;
          }
          if (m < 50) return 0;
          var cov = s12 / m - (s1 / m) * (s2 / m), v1 = q1 / m - (s1 / m) * (s1 / m), v2 = q2 / m - (s2 / m) * (s2 / m);
          return (v1 > 0 && v2 > 0) ? cov / Math.sqrt(v1 * v2) : 0;
        }
        function corrLen(horiz) {
          var prev = 1;
          for (var lag = 1; lag <= 10; lag++) { var c = corrLag(lag, horiz); if (c < 0.3679) return lag - 1 + (prev - 0.3679) / Math.max(1e-6, prev - c); prev = c; }
          return 10;
        }
        var latPx = corrLen(true), axPx = corrLen(false);
        stats.autocorrelation = { lateralPx: latPx, axialPx: axPx, lateralMm: latPx / glay.scale, axialMm: axPx / glay.scale };
        if (opts.includeGrid) stats.grid = { w: GW, h: GH, data: Array.prototype.slice.call(byts), tissue: Array.prototype.slice.call(tiss), regions: Array.prototype.slice.call(regs) };
        else if (stats.grid) delete stats.grid;
      } catch (e) { errors.push("snapshot: " + String(e && e.message || e)); }
      stats.depthMm = knobs.depth; stats.sectorDeg = knobs.sectorDeg;
      stats.ms = emaMs; stats.fps = emaMs > 0 ? 1000 / emaMs : 0;
      stats.frames = frameCount;
      return stats;
    }

    function frame(tMs) {
      if (destroyed) return false;
      var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
      lastT = tMs || 0;
      try { if (geom && typeof geom.update === "function") geom.update(); } catch (e) { errors.push(String(e && e.message || e)); }
      var ok = false;
      if (gl && !lost) { try { ok = renderGPU(lastT); stats.mode = "webgl"; } catch (e) { errors.push(String(e && e.message || e)); ok = false; } }
      if (!ok && !gl) { ok = renderCPU(lastT); stats.mode = "cpu"; }
      if (!ok && lost) { stats.mode = "lost"; ok = true; /* freeze, no throw */ }
      var dt = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      lastMs = dt; emaMs = emaMs ? emaMs * 0.85 + dt * 0.15 : dt;
      frameCount++;
      return ok;
    }

    function snapshot(opts) { return computeStatsFromPolar(opts); }
    function destroy() {
      destroyed = true;
      try {
        if (gl) {
          [vbPos, vbSeed, ibBuf, quadBuf].forEach(function (b) { if (b) gl.deleteBuffer(b); });
          [progT, progE, progD, progF].forEach(function (p) { if (p) gl.deleteProgram(p); });
          if (fboT) { gl.deleteTexture(fboT.tex); gl.deleteFramebuffer(fboT.fb); }
          if (fboP) { gl.deleteTexture(fboP.tex); gl.deleteFramebuffer(fboP.fb); }
        }
      } catch (e) {}
      gl = null;
      return api;
    }

    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); lost = true; stats.mode = "lost"; }, false);
    canvas.addEventListener("webglcontextrestored", function () {
      try { gl = null; if (buildGL()) lost = false; } catch (err) { errors.push(String(err && err.message || err)); }
    }, false);

    try { if (!buildGL()) gl = null; } catch (e) { errors.push(String(e && e.message || e)); gl = null; }
    if (!gl) stats.mode = "cpu";

    var api = {
      setProbe: setProbe, setKnobs: setKnobs, frame: frame, snapshot: snapshot, destroy: destroy,
      getKnobs: function () { var o = {}; for (var k in knobs) o[k] = knobs[k]; o.tgc = knobs.tgc.slice(); return o; },
      getProbe: function () { return { origin: probe.origin.slice(), normal: probe.normal.slice(), up: probe.up.slice() }; },
      isContextLost: function () { return lost; },
      errors: errors,
      _loseContext: function () { var ext = gl && gl.getExtension("WEBGL_lose_context"); if (ext) { api._loseExt = ext; ext.loseContext(); } return !!ext; },
      _restoreContext: function () { if (api._loseExt) api._loseExt.restoreContext(); },
      stats: stats
    };
    return api;
  }

  var API = {
    create: create, DEFAULT_KNOBS: DEFAULT_KNOBS,
    _pure: {
      clamp: clamp, hash3: hash3, rayleigh: rayleigh, speckleAmp: speckleAmp,
      smoothGauss2: smoothGauss2, speckleSizes: speckleSizes, speckleField: speckleField,
      toDisplay: toDisplay, echoDisplay: echoDisplay, isBlocker: isBlocker, layoutFor: layoutFor, bayerDither: bayerDither,
      attenuationDb: attenuationDb, dbToLin: dbToLin, tgcDb: tgcDb,
      scanConvert: scanConvert, polarToDisplay: polarToDisplay,
      ecgVoltage: ecgVoltage, compress: compress, mergeKnobs: mergeKnobs
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_US = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
