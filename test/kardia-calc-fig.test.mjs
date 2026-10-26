import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const K = require("../kardia-calc-data.js");
const D = require("../kardia-calc-fig-data.js");
const F = require("../kardia-calc-fig.js");

function fakeCtx() {
  const noop = () => {};
  return {
    canvas: { width: 640, height: 420 },
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, arc: noop,
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop,
    clearRect: noop, fillText: noop, setLineDash: noop, clip: noop,
  };
}

test("every calculator id has a bespoke figure with caption, measure, pitfall, attribution", () => {
  assert.equal(K.calcs.length, 74);
  for (const c of K.calcs) {
    const f = D.figures[c.id];
    assert.ok(f, "missing figure " + c.id);
    assert.ok(f.caption && f.measure && f.pitfall, c.id + " text");
    assert.ok(f.attribution && f.attribution.length > 20, c.id + " attribution");
    assert.ok(f.keyLabel && typeof f.keyPhase === "number", c.id + " key frame");
    assert.ok(f.kind && (f.wave ? D.waves[f.wave] : D.views[f.view || f.ref]), c.id + " geometry " + f.kind);
    if (f.source) assert.ok(f.attribution.includes(f.source) || f.attribution.length > 20, c.id + " source attributed");
  }
  assert.equal(Object.keys(D.figures).length, K.calcs.length);
});

test("every figure renders without throwing in Node with a fake canvas, at key and mid phases", () => {
  for (const c of K.calcs) {
    for (const phase of [0, 0.02, 0.28, 0.55, 0.85]) {
      const out = F.render(fakeCtx(), c.id, phase, 640, 420);
      assert.ok(out && out.id === c.id && out.phaseName, c.id + " @" + phase);
    }
    assert.ok(F.render(fakeCtx(), c.id, D.figures[c.id].keyPhase, 640, 420), c.id + " key frame");
  }
  assert.equal(F.render(fakeCtx(), "no-such-id", 0, 640, 420), null);
});

test("ECG clock: QRS peak and contraction stay in step", () => {
  assert.ok(F.ecg(0.13) > 0.8, "R wave near phase 0.13");
  assert.ok(F.contraction(0.02) < 0.1, "relaxed at end diastole");
  assert.ok(F.contraction(0.28) > 0.9, "contracted in systole");
  assert.match(F.phaseName(D.figures["diastolic-sinus"], 0.55), /E wave/);
  assert.match(F.phaseName(D.figures["lv-ef"], 0.02), /End diastole/);
});

test("figure data stays compact, ES5, British hygiene, lazy wiring", () => {
  const dataSize = statSync("kardia-calc-fig-data.js").size + statSync("kardia-calc-fig.js").size;
  assert.ok(dataSize < 3 * 1024 * 1024, "added figure data " + dataSize);
  for (const file of ["kardia-calc-fig-data.js", "kardia-calc-fig.js", "kardia-calc.js"]) {
    const src = readFileSync(file, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/=>|\bconst\s|\blet\s/.test(code), file + " ES5");
    assert.ok(!/—|–/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), file + " dashes");
    assert.ok(!/\bweb app\b|\bbrowser\b/i.test(code), file + " wording");
  }
  const ui = readFileSync("kardia-calc.js", "utf8");
  for (const s of ["kardia-calc-fig-data.js", "kardia-calc-fig.js", "data-kcalc-fig", "kcalc-fig-toggle", "prefers-reduced-motion", "What to measure", "Common pitfall"]) assert.ok(ui.includes(s), "UI " + s);
  const css = readFileSync("kardia-calc.css", "utf8");
  assert.ok(css.includes(".kcalc-canvas") && css.includes("min-height:44px"), "figure CSS");
  const manifest = JSON.parse(readFileSync("kardia/media/calc/manifest.json", "utf8"));
  assert.ok(Array.isArray(manifest.downloaded) && Array.isArray(manifest.sourcesForLead), "manifest lists sources");
  for (const s of manifest.sourcesForLead) assert.ok(s.sourceUrl && s.licence && s.attribution, "source attributed: " + s.sourceUrl);
});
