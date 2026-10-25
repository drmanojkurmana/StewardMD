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

test("severity helpers read the pathology files shape", () => {
  const cond = { id: "x", severities: { severe: { heart: { aorticValveAreaCm2: 0.75 }, geom: { effusionMm: 3 }, sound: { s4: "present" } } } };
  assert.equal(P.severityHeart(cond, "severe").aorticValveAreaCm2, 0.75);
  assert.equal(P.severityGeom(cond, "severe").effusionMm, 3);
  assert.deepEqual(P.severityHeart(cond, "mild"), {});
});
