import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const D = require("../kardia-sim-doppler.js");
const H = require("../kardia-sim-heart.js");
const EL = require("../kardia-echolab.js");

function settled(params) {
  const h = H.create(params || {});
  for (let t = 0; t < 10000; t += 10) h.step(10);
  return { h, d: D.create(h, {}) };
}

test("spectralLabels: machine labels, no internal ids, ticks inside scale", () => {
  const { d } = settled({ preset: "severeAS" });
  const spec = d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 1800, dtMs: 4 });
  const lab = D.spectralLabels(spec);
  assert.equal(lab.title, "Continuous wave Doppler");
  assert.equal(lab.site, "Aortic valve");
  assert.ok(!/aorticJet|mitralInflow/.test(JSON.stringify(lab)), "no internal id in labels");
  assert.ok(lab.scaleText.includes("m/s") && lab.sweepText.includes("mm/s"));
  assert.equal(lab.baselineText, "Baseline 0 m/s");
  assert.ok(lab.ticks.length >= 3);
  const lo = spec.velocityAxisMs[0], hi = spec.velocityAxisMs[spec.velocityAxisMs.length - 1];
  for (const t of lab.ticks) assert.ok(t.velocityMs >= lo - 1e-9 && t.velocityMs <= hi + 1e-9);
  const pw = D.spectralLabels(settled({}).d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 4 }));
  assert.equal(pw.title, "Pulsed wave Doppler");
  assert.equal(pw.site, "Mitral inflow");
  assert.ok(pw.nyquistText.startsWith("Nyquist"));
});

test("spectral fill: wall filter gap, speckle variation and bright modal envelope", () => {
  const { d } = settled({});
  const spec = d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 2 });
  const zeroIdx = spec.velocityAxisMs.findIndex((v) => Math.abs(v) < D.WALL_FILTER_MS);
  assert.ok(zeroIdx >= 0);
  const pkIdx = spec.envelopeMs.indexOf(Math.max(...spec.envelopeMs));
  assert.ok(spec.intensity[pkIdx][zeroIdx] < 8, "wall filter leaves a gap at the baseline");
  const row = spec.intensity[pkIdx].filter((g) => g > 20);
  assert.ok(new Set(row).size > 4, "spectral fill is speckled, not one flat value");
  const envIdx = spec.velocityAxisMs.reduce((bi, v, j) => Math.abs(v - spec.envelopeMs[pkIdx]) < Math.abs(spec.velocityAxisMs[bi] - spec.envelopeMs[pkIdx]) ? j : bi, 0);
  assert.ok(spec.intensity[pkIdx][envIdx] >= 150, "modal envelope is bright");
});

test("PW aliasing wraps into the opposite half of the display", () => {
  const { d } = settled({});
  const spec = d.spectrum({ flow: "aorticJet", mode: "PW", durationMs: 900, dtMs: 2, nyquistMs: 0.6 });
  assert.ok(spec.anyAliased);
  assert.ok(spec.envelopeMs.every((v) => Math.abs(v - (spec.baselineShiftMs || 0)) <= spec.nyquistMs + 1e-9));
});

test("velocityColour: red toward, blue away, alias to opposite, turbulence green yellow", () => {
  const toward = D.velocityColour(0.3, 0, 0.6);
  assert.ok(toward.r > toward.b && !toward.aliased);
  const away = D.velocityColour(-0.3, 0, 0.6);
  assert.ok(away.b > away.r && !away.aliased);
  const wrapped = D.velocityColour(0.9, 0, 0.6);
  assert.equal(wrapped.aliased, true);
  assert.ok(wrapped.displayVelocityMs < 0 && wrapped.b > wrapped.r, "aliases to blue");
  const turb = D.velocityColour(0.9, 0.25, 0.6);
  assert.ok(turb.mosaic && turb.g > 120 && turb.r > 120, "turbulent alias is green yellow mosaic");
  const calm = D.velocityColour(0.3, 0.25, 0.6);
  assert.ok(calm.g > toward.g, "variance adds green even without aliasing");
});

test("colourBarStops: spans +Nyquist to -Nyquist through zero", () => {
  const bar = D.colourBarStops(0.6);
  assert.equal(bar.topLabel, "+0.6");
  assert.equal(bar.bottomLabel, "-0.6");
  assert.equal(bar.stops.length, 17);
  assert.ok(bar.stops[0].r > bar.stops[0].b, "top is red");
  assert.ok(bar.stops[16].b > bar.stops[16].r, "bottom is blue");
  assert.equal(bar.stops[8].velocityMs, 0);
});

test("mmodeColumn: dark cavity between bright walls that narrows in systole", () => {
  const dia = EL._pure.mmodeColumn(140, 3);
  const sys = EL._pure.mmodeColumn(50, 3);
  assert.equal(dia.length, 56);
  const mid = Math.round(dia.length * 0.52);
  assert.ok(dia[mid] < 40, "cavity is dark");
  assert.ok(Math.max(...dia) > 200, "walls are bright");
  const darkDia = dia.filter((v) => v < 40).length;
  const darkSys = sys.filter((v) => v < 40).length;
  assert.ok(darkDia > darkSys, "cavity narrows as LV volume falls");
  const lab = EL._pure.mmodeLabels(160);
  assert.equal(lab.ticks[lab.ticks.length - 1].label, "16 cm");
  assert.ok(!/—|–/.test(readFileSync(new URL("../kardia-echolab.js", import.meta.url), "utf8").split("mmodeLabels")[1].slice(0, 400)));
});

test("no raw debug spectral label remains in the renderer source", () => {
  const src = readFileSync(new URL("../kardia-sim-doppler.js", import.meta.url), "utf8");
  assert.ok(!src.includes("toward up / away down"));
  assert.ok(!/fillText\(spec\.mode \+ " " \+ spec\.flow/.test(src));
  const el = readFileSync(new URL("../kardia-echolab.js", import.meta.url), "utf8");
  assert.ok(!el.includes("Target 30 fps"), "no frame debug text on screen");
});
