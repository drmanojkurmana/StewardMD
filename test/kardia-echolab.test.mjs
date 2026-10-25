import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const EL = require("../kardia-echolab.js");
const P = EL._pure;

test("mapKnobs: centre gain is 0 dB, TGC centre is 0 dB", () => {
  const k = P.mapKnobs({ gain: 55, depth: 160, focus: 50, tgc: [50,50,50,50,50,50,50,50], frequencyMHz: 3, sectorDeg: 80, dynamicRange: 55, colourGain: 70, colourNyquistMs: 0.6 }, 1);
  assert.equal(k.gain, 0); assert.equal(k.focusMm, 80); assert.deepEqual(k.tgc, [0,0,0,0,0,0,0,0]);
  const hi = P.mapKnobs({ gain: 100, depth: 160, focus: 50, tgc: [100,0,50,50,50,50,50,50] }, 1);
  assert.ok(hi.gain > 20); assert.equal(hi.tgc[0], 12); assert.equal(hi.tgc[1], -12);
});

test("pickResolutionScale steps down when frames are slow", () => {
  assert.equal(P.pickResolutionScale(2, 10), 2);
  assert.equal(P.pickResolutionScale(2, 40), 0.5);
  assert.equal(P.pickResolutionScale(1, 28), 0.75);
});

test("pathologyGeom converts words to factors and defects", () => {
  const g = P.pathologyGeom({ chamberDilation: { lv: "severe", la: "mild", rv: "normal", ra: "small" }, effusionMm: 12, wallThicknessScale: 1.3, wallMotion: { "1": "akinetic", "2": "normal" }, defect: { type: "asd", sizeMm: 20 }, leaflet: { aortic: { restriction: true, thickening: true } } });
  assert.equal(g.chamberDilation.LV, 1.6); assert.equal(g.chamberDilation.LA, 1.15); assert.equal(g.chamberDilation.RA, 0.8);
  assert.equal(g.wallMotion["1"], 0.05); assert.equal(g.septalDefect.type, "ASD"); assert.equal(g.septalDefect.sizeMm, 20);
  assert.ok(g.leafletRestriction > 0); assert.ok(g.leafletThickeningMm > 0);
  const unknown = P.pathologyGeom({ chamberDilation: { lv: "huge" } });
  assert.equal(unknown.chamberDilation.LV, 1);
});

test("soundKindFor maps conditions and gallops", () => {
  assert.equal(P.soundKindFor("aortic_stenosis", { murmur: {} }), "as_murmur");
  assert.equal(P.soundKindFor("mitral_regurgitation", null), "mr_murmur");
  assert.equal(P.soundKindFor("anything", { s3: "present" }), "s3_gallop");
  assert.equal(P.soundKindFor("unknown", null), "s1s2_normal");
});

test("cine ring buffer wraps without growing", () => {
  const c = P.createCine(3);
  c.push(1, 10); c.push(2, 20); c.push(3, 30); c.push(4, 40);
  assert.equal(c.count(), 3); assert.equal(c.at(0).timeMs, 4); assert.equal(c.at(2).timeMs, 2);
});

test("spectrumSource converts pixels both ways", () => {
  const s = P.spectrumSource({ velocityAxisMs: [-2, 2], timesMs: [0, 1000] }, 100, 100);
  assert.equal(s.velocityAt(50), 0); assert.equal(s.timeAt(50), 0.5);
  assert.equal(s.velocityToPx(0), 50);
});

test("renderer is recreated when the sector canvas is replaced, and debug() reports it", () => {
  const created = [];
  const prevUS = globalThis.KARDIA_US, prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  globalThis.KARDIA_US = { create(canvas) { const r = { canvas, stats: { mode: "cpu", frames: 0, ms: 16 }, errors: [], destroyed: false, setProbe() {}, setKnobs() {}, frame() { this.stats.frames++; return true; }, snapshot() { return { mean: 0.5 }; }, destroy() { this.destroyed = true; } }; created.push(r); return r; } };
  try {
    const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const heart = { step() {}, state: () => ({ timeMs: 0, cycleTimeMs: 0, volumes: { LV: 100 } }) };
    const geom = { loadedParts: () => [] };
    const probe = { plane: () => ({ origin: [0, 0, 0], normal: [1, 0, 0], up: [0, 0, 1] }) };
    const lab = EL.create({ doc, heart, geom, probe, knobs: P.cloneKnobs(null) });
    const canvasA = { width: 64, height: 48 }, canvasB = { width: 64, height: 48 };
    lab.mount(canvasA, null, null, {});
    let d = lab.debug();
    assert.equal(d.rendererCreated, true); assert.equal(d.rendererOnCurrentCanvas, true);
    assert.equal(d.geometryMode, "parametric"); assert.equal(d.chunksLoaded, 0); assert.equal(d.lastError, "");
    lab.mount(canvasB, null, null, {});
    assert.equal(created.length, 2, "a new renderer is created for the replacement canvas");
    assert.equal(created[0].destroyed, true, "the renderer bound to the detached canvas is destroyed");
    assert.equal(created[1].canvas, canvasB);
    d = lab.debug(); assert.equal(d.rendererOnCurrentCanvas, true);
    assert.equal(lab.snapshot().mean, 0.5, "snapshot reads the renderer on the current canvas");
    lab.destroy();
  } finally {
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
  }
});

test("renderer is never created for a detached or zero-size sector canvas", () => {
  const created = [];
  const prevUS = globalThis.KARDIA_US, prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  globalThis.KARDIA_US = { create(canvas) { created.push(canvas); return { canvas, stats: { mode: "cpu", frames: 0, ms: 16 }, errors: [], setProbe() {}, setKnobs() {}, frame() { return true; }, snapshot() { return { mean: 0.5 }; }, destroy() {} }; } };
  try {
    const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const heart = { step() {}, state: () => ({ timeMs: 0, cycleTimeMs: 0, volumes: { LV: 100 } }) };
    const lab = EL.create({ doc, heart, geom: { loadedParts: () => [] }, probe: { plane: () => ({ origin: [0, 0, 0], normal: [1, 0, 0], up: [0, 0, 1] }) }, knobs: P.cloneKnobs(null) });
    lab.mount({ width: 64, height: 48, isConnected: false }, null, null, {});
    assert.equal(created.length, 0, "no renderer for a detached canvas");
    assert.equal(lab.debug().sectorConnected, false);
    lab.mount({ width: 0, height: 48, isConnected: true }, null, null, {});
    assert.equal(created.length, 0, "no renderer for a zero-width canvas");
    const live = { width: 64, height: 48, isConnected: true };
    lab.mount(live, null, null, {});
    assert.equal(created.length, 1, "renderer created once the canvas is on screen");
    assert.equal(lab.debug().rendererOnCurrentCanvas, true);
    lab.destroy();
  } finally {
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
  }
});

test("host keeps persistent live canvases outside the repainted HTML and joins probe text with Marker", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../kardia.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../kardia-echolab.css", import.meta.url), "utf8");
  assert.ok(src.includes("liveCanvases"), "canvases are held outside the paint HTML");
  assert.ok(src.includes('id="krdSectorSlot"') && src.includes('id="krdSpectrumSlot"'), "paint emits slots, not canvases");
  assert.ok(!/<canvas id="krdSector"/.test(src), "the sector canvas is not recreated by innerHTML");
  assert.ok(src.includes("attachLiveCanvases()"), "mount re-attaches after every paint");
  assert.ok(src.includes('". Marker "'), 'probe text joins as "<position>. Marker <direction>."');
  assert.ok(/\.kel-overlay \{[^}]*pointer-events: none/.test(css), "overlay does not cover the sector for hit testing");
});

test("severity helpers read the pathology files shape", () => {
  const cond = { id: "x", severities: { severe: { heart: { aorticValveAreaCm2: 0.75 }, geom: { effusionMm: 3 }, sound: { s4: "present" } } } };
  assert.equal(P.severityHeart(cond, "severe").aorticValveAreaCm2, 0.75);
  assert.equal(P.severityGeom(cond, "severe").effusionMm, 3);
  assert.deepEqual(P.severityHeart(cond, "mild"), {});
});
