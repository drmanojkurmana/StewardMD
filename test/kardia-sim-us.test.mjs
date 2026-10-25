import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const US = require("../kardia-sim-us.js");
const P = US._pure;

test("exports and ES5", () => {
  assert.equal(typeof US.create, "function");
  const src = readFileSync(new URL("../kardia-sim-us.js", import.meta.url), "utf8");
  assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "ES5 only");
  const win = {}; new Function("window", "module", src)(win, undefined);
  assert.ok(win.KARDIA_US && typeof win.KARDIA_US.create === "function");
});

test("scan conversion round trip and sector mask", () => {
  for (const [ang, dep] of [[0, 80], [0.3, 120], [-0.5, 40]]) {
    const [x, y] = P.polarToDisplay(ang, dep);
    const sc = P.scanConvert(x, y, 80, 160);
    assert.ok(sc && Math.abs(sc.angle - ang) < 1e-9 && Math.abs(sc.depth - dep) < 1e-9);
  }
  assert.equal(P.scanConvert(100, 10, 80, 160), null, "outside sector rejected");
  assert.equal(P.scanConvert(0, 200, 80, 160), null, "beyond depth rejected");
  assert.ok(P.scanConvert(0, 0, 80, 160).depth === 0);
});

test("TGC curve interpolates sliders and adds gain", () => {
  const tgc = [0, 0, 0, 0, 10, 10, 10, 10];
  assert.equal(P.tgcDb(0, 160, tgc, 5), 5);
  assert.ok(Math.abs(P.tgcDb(160, 160, tgc, 0) - 10) < 1e-9);
  const mid = P.tgcDb(80, 160, tgc, 0);
  assert.ok(mid > 0 && mid < 10, "mid-depth interpolated, got " + mid);
  assert.ok(P.tgcDb(80, 160, tgc, 6) > P.tgcDb(80, 160, tgc, 0), "gain raises TGC output");
});

test("attenuation grows with depth and frequency", () => {
  const a1 = P.attenuationDb(50, 3, 0.8), a2 = P.attenuationDb(100, 3, 0.8), a3 = P.attenuationDb(100, 5, 0.8);
  assert.ok(a2 > a1 * 1.9 && a3 > a2, "monotonic in depth and frequency");
  assert.ok(Math.abs(P.dbToLin(20) - 10) < 1e-9);
  assert.equal(P.attenuationDb(0, 3, 0.8), 0);
});

test("speckle statistics are Rayleigh-like", () => {
  let sum = 0, sq = 0; const N = 20000;
  for (let i = 0; i < N; i++) { const v = P.speckleAmp(P.hash3(i % 251, (i / 251) | 0, 3)); sum += v; sq += v * v; }
  const mean = sum / N, variance = sq / N - mean * mean;
  assert.ok(Math.abs(mean - 1) < 0.03, "Rayleigh mean ~1, got " + mean);
  assert.ok(variance > 0.22 && variance < 0.34, "mean-normalised Rayleigh variance ~0.27, got " + variance);
  assert.ok(P.rayleigh(0) === 0 && P.speckleAmp(0.5) > 0);
  assert.equal(P.hash3(1, 2, 3), P.hash3(1, 2, 3), "deterministic");
});

test("display levels at default gain land in the target bands", () => {
  const knobs = { depth: 160, tgc: [0, 0, 0, 0, 0, 0, 0, 0], gain: 0, frequencyMHz: 3 };
  const tags = {
    blood: { echogenicity: 0.05, attenuation: 0.2, isBlood: true },
    myocardium: { echogenicity: 0.45, attenuation: 0.8 },
    valve: { echogenicity: 0.80, attenuation: 1.0 },
    pericardium: { echogenicity: 0.95, attenuation: 1.2 },
  };
  const means = {};
  for (const [name, ac] of Object.entries(tags)) {
    let sum = 0, n = 0;
    for (let d = 25; d <= 110; d += 5) for (let lat = -45; lat <= 45; lat += 1.5) {
      sum += P.echoDisplay(ac, d, P.speckleField(lat, d, 11) * 0.75 + P.speckleAmp(P.hash3(lat * 10 | 0, d, 77)) * 0.25, knobs, 1, 0);
      n++;
    }
    means[name] = sum / n;
  }
  assert.ok(means.blood >= 0.02 && means.blood <= 0.10, "blood " + means.blood.toFixed(3));
  assert.ok(means.myocardium >= 0.30 && means.myocardium <= 0.55, "myocardium " + means.myocardium.toFixed(3));
  assert.ok(means.valve >= 0.70 && means.valve <= 1.0, "valve " + means.valve.toFixed(3));
  assert.ok(means.pericardium >= 0.70 && means.pericardium <= 1.0, "pericardium " + means.pericardium.toFixed(3));
  const shadow = P.echoDisplay(tags.myocardium, 80, 1, knobs, 0.08, 0);
  assert.ok(shadow < 0.1, "shadow behind a reflector " + shadow.toFixed(3));
});

test("speckle is fine, smooth and elongated laterally, growing with depth", () => {
  const near = P.speckleSizes(25), far = P.speckleSizes(120);
  assert.ok(near.lateral > near.axial && far.lateral > far.axial, "lateral wider than axial");
  assert.ok(far.lateral > near.lateral && far.axial > near.axial, "speckle grows with depth");
  let sum = 0; const N = 20000;
  for (let i = 0; i < N; i++) sum += P.speckleField(P.hash3(i, 7, 3) * 160 - 80, 20 + P.hash3(i, 11, 5) * 100, 11);
  assert.ok(Math.abs(sum / N - 1) < 0.08, "speckle mean ~1, got " + (sum / N).toFixed(3));
  // smooth: a 0.2 mm step changes the field far less than a 5 mm step
  let dSmall = 0, dLarge = 0, m = 0;
  for (let lat = -40; lat < 40; lat += 2) for (const dep of [40, 80]) {
    const a = P.speckleField(lat, dep, 11);
    dSmall += Math.abs(P.speckleField(lat + 0.2, dep, 11) - a);
    dLarge += Math.abs(P.speckleField(lat + 5, dep, 11) - a); m++;
  }
  assert.ok(dSmall / m < 0.35 * (dLarge / m), "smooth field, small-step delta " + (dSmall / m).toFixed(3) + " vs large " + (dLarge / m).toFixed(3));
});

test("ECG strip layout does not overlap the sector", () => {
  const lay = P.layoutFor(390, 312, { showEcg: true, depth: 160 });
  assert.ok(lay.ecg && lay.ecg.y0 === lay.sectorHeight, "strip starts where the sector area ends");
  assert.ok(lay.sector.bottom <= lay.ecg.y0 + 1e-9, "sector bottom " + lay.sector.bottom + " above strip " + lay.ecg.y0);
  assert.ok(Math.abs(lay.apexY + 160 * lay.scale - lay.ecg.y0) < 1e-9, "sector scaled to fit above the strip");
  const noEcg = P.layoutFor(390, 312, { showEcg: false, depth: 160 });
  assert.equal(noEcg.ecg, null);
  assert.equal(noEcg.sectorHeight, 312);
});

test("compression and ECG helpers", () => {
  assert.ok(P.compress(1, 55) === 1 && P.compress(0.001, 55) < 0.1);
  assert.ok(P.compress(0.5, 40) < P.compress(0.5, 80), "wider range compresses less");
  let peak = 0, peakPh = 0;
  for (let p = 0; p < 1; p += 0.002) { const v = P.ecgVoltage(p); if (v > peak) { peak = v; peakPh = p; } }
  assert.ok(peak > 0.8 && peakPh > 0.25 && peakPh < 0.35, "QRS peak near 0.30, got " + peakPh);
});

/* End-to-end on the CPU fallback with a mock canvas: snapshot() masks
 * come from the geometry acoustic tags (geom.cut), so the region means
 * below are measured image levels, not tag values. */
function mockCanvas(w, h) {
  const c = {
    width: w, height: h, style: {}, _img: null,
    addEventListener() {},
    getContext(kind) {
      if (kind !== "2d") return null;
      return {
        createImageData: (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }),
        putImageData(img) { c._img = img; },
        fillStyle: "", beginPath() {}, arc() {}, fill() {},
      };
    },
  };
  return c;
}
function maxRunsFromGrid(grid) {
  const { w, h, data, regions } = grid;
  const speck = (i) => regions[i] === 1 || regions[i] === 2;
  let maxH = 0, maxV = 0;
  for (let y = 0; y < h; y++) { let run = 0; for (let x = 0; x < w; x++) { const i = y * w + x; run = speck(i) && run > 0 && data[i] === data[i - 1] ? run + 1 : speck(i) ? 1 : 0; if (run > maxH) maxH = run; } }
  for (let x = 0; x < w; x++) { let run = 0; for (let y = 0; y < h; y++) { const i = y * w + x; run = speck(i) && run > 0 && data[i] === data[i - w] ? run + 1 : speck(i) ? 1 : 0; if (run > maxV) maxV = run; } }
  return { maxH, maxV };
}

test("rendered image: region bands, blockiness, autocorrelation, ECG strip (CPU fallback)", () => {
  const HEART = require("../kardia-sim-heart.js");
  const GEOM = require("../kardia-sim-geom.js");
  const views = JSON.parse(readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));
  const heart = HEART.create(HEART.presets.normal);
  for (let t = 0; t < 12000; t += 10) heart.step(10);
  const geom = GEOM.create({ heart, views });
  for (const viewId of ["tte_plax", "tte_a4c"]) {
    const canvas = mockCanvas(290, 232);
    const us = US.create(canvas, geom, heart);
    us.setProbe({ viewId });
    assert.equal(us.frame(1000), true, viewId + " frame renders");
    const s = us.snapshot({ includeGrid: true });
    assert.ok(s.mean > 0.02, viewId + " snapshot mean inside the sector is non-black on the CPU fallback, got " + s.mean);
    assert.ok(s.regions.blood.count > 100 && s.regions.myocardium.count > 100, viewId + " masks populated");
    assert.ok(s.regions.blood.mean >= 0.02 && s.regions.blood.mean <= 0.10, viewId + " blood " + s.regions.blood.mean.toFixed(3));
    assert.ok(s.regions.myocardium.mean >= 0.30 && s.regions.myocardium.mean <= 0.55, viewId + " myocardium " + s.regions.myocardium.mean.toFixed(3));
    if (s.regions.bright.count > 20) assert.ok(s.regions.bright.mean >= 0.70 && s.regions.bright.mean <= 1.0, viewId + " valves/pericardium " + s.regions.bright.mean.toFixed(3));
    if (s.regions.shadow.count > 20) assert.ok(s.regions.shadow.mean < 0.1, viewId + " shadow " + s.regions.shadow.mean.toFixed(3));
    assert.ok(s.blockiness.maxRunH <= 3 && s.blockiness.maxRunV <= 3, viewId + " blockiness " + JSON.stringify(s.blockiness));
    const runs = maxRunsFromGrid(s.grid);
    assert.ok(runs.maxH <= 3 && runs.maxV <= 3, viewId + " grid runs " + JSON.stringify(runs));
    assert.ok(s.autocorrelation.lateralMm > s.autocorrelation.axialMm, viewId + " speckle elongated laterally " + JSON.stringify(s.autocorrelation));
    assert.equal(s.ecgSectorOverlapPx, 0, viewId + " ECG strip overlap");
    assert.ok(s.layout.sector.bottom <= s.layout.ecg.y0, viewId + " sector fits above ECG strip");
    // actual canvas pixels: the strip holds only black and the green trace
    const img = canvas._img, W = canvas.width;
    let stray = 0;
    for (let y = s.layout.ecg.y0; y < canvas.height; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
      if (!((r === 0 && g === 0 && b === 0) || (r === 110 && g === 240 && b === 140))) stray++;
    }
    assert.equal(stray, 0, viewId + " no sector pixels inside the ECG strip");
    us.destroy();
  }
});
