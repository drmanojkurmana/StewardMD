// test/tokos-calipers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderCalibratedTraceSvg, yForBpm } from "../tools/tokos-ctg-prep.mjs";
const K = createRequire(import.meta.url)("../tokos-calipers.js");
const { layout: L } = renderCalibratedTraceSvg(new Float64Array(30 * 60 * 4).fill(140), new Float64Array(30 * 60 * 4).fill(10), 4);

test("caliper y mapping agrees with the renderer", () => {
  assert.equal(K.yForBpm(L, 110).toFixed(3), yForBpm(L, 110).toFixed(3));
  assert.equal(Math.round(K.bpmAt(L, yForBpm(L, 137))), 137);
});

test("deltaBpm between the 160 and 110 lines is 50; deltaSec over 100 s of plot is 100", () => {
  assert.equal(K.deltaBpm(L, yForBpm(L, 160), yForBpm(L, 110)), 50);
  const x1 = L.padL + L.plotW * 0.2, x2 = x1 + (100 / L.durationSec) * L.plotW;
  assert.equal(K.deltaSec(L, x1, x2), 100);
});

test("readouts use a colon, no em-dash, and ASCII digits in Hindi", () => {
  const st = { mode: "bpm", y1: yForBpm(L, 150), y2: yForBpm(L, 138), x1: 0, x2: 0 };
  const en = K.readout(L, st, "en"), hi = K.readout(L, st, "hi");
  assert.match(en, /^Range: 12 bpm, normal/);
  assert.ok(!/—/.test(en + hi));
  assert.ok(/12/.test(hi) && !/[०-९]/.test(hi));
  const t = K.readout(L, { mode: "time", x1: L.padL, x2: L.padL + (200 / L.durationSec) * L.plotW, y1: 0, y2: 0 }, "en");
  assert.match(t, /^Span: 3 min 20 s \(200 s\), prolonged/);
});
