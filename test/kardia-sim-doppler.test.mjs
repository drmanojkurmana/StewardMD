/* test/kardia-sim-doppler.test.mjs - Kardia WP5 Doppler (kardia-sim-doppler.js).
 *
 * Threshold citations (ASE/EACVI, restated in kardia-sim-doppler.js):
 * - Normal LVOT VTI 18 to 25 cm; normal mitral E 0.6 to 1.0 m/s, E/A 1.0
 *   to 2.0 (ASE/EACVI chamber quantification and 2016 diastolic guidance).
 * - Severe AS: peak jet velocity above 4 m/s and mean gradient above
 *   40 mmHg, AVA below 1.0 cm2 (ASE/EACVI 2017 stenosis grading).
 * - Simplified Bernoulli peak gradient = 4*v^2 (ASE/EACVI 2017).
 * - Mitral stenosis: MVA = 220 / pressure half-time; severe MVA below
 *   1.0 cm2 therefore has PHT above 220 ms (Hatle; ASE 2009 stenosis).
 * - PW aliasing at the Nyquist limit (PRF/2); max PRF = c/(2*depth) with
 *   c = 1540 m/s, so lower depth raises the limit and baseline shift
 *   moves the wrap window; CW never aliases (ASE 2019 spectral Doppler).
 * - Angle: uncorrected velocity = v*cos(theta); 60 degrees reads half.
 * - PISA EROA = 2*pi*r^2*Va/Vpeak; severe primary MR EROA >= 0.40 cm2
 *   (ASE 2017 regurgitation, Zoghbi et al.).
 * - PASP = 4*vTR^2 + RA pressure (ASE right heart guidance).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const H = require("../kardia-sim-heart.js");
const D = require("../kardia-sim-doppler.js");

function settled(params, dopplerOpts) {
  const h = H.create(params);
  for (let t = 0; t < 10000; t += 10) h.step(10);
  return { h, d: D.create(h, dopplerOpts), s: h.summary() };
}

test("exports: window global, module.exports, ES5 source", () => {
  assert.ok(D && typeof D.create === "function");
  const src = readFileSync(new URL("../kardia-sim-doppler.js", import.meta.url), "utf8");
  assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "ES5 only");
  const win = {};
  new Function("window", "module", src)(win, undefined);
  assert.ok(win.KARDIA_DOPPLER && typeof win.KARDIA_DOPPLER.create === "function");
});

test("velocity field: every valve, outflow, jet and shunt with unit directions", () => {
  const { d } = settled({ mitralRegurgAreaCm2: 0.4, aorticRegurgAreaCm2: 0.3, tricuspidRegurgAreaCm2: 0.5 },
    { defect: { type: "VSD", sizeMm: 8 } });
  const ids = new Set(d.flows(d.heart.state()).map((f) => f.id));
  for (const id of ["mitralInflow", "lvot", "aorticJet", "tricuspidInflow", "rvot", "pulmonaryJet", "mrJet", "arJet", "trJet", "vsdJet"])
    assert.ok(ids.has(id), "missing flow " + id);
  for (const f of d.flows(d.heart.state())) {
    const l = Math.hypot(...f.direction);
    assert.ok(Math.abs(l - 1) < 1e-9, f.id + " direction not unit");
    assert.ok(f.origin.length === 3 && f.areaCm2 > 0, f.id + " anchor/area");
  }
  const asd = settled({}, { defect: { type: "ASD", sizeMm: 15 } }).d;
  assert.ok(asd.flows(asd.heart.state()).some((f) => f.id === "asdFlow"), "ASD flow present");
  const pda = settled({}, { defect: { type: "PDA", sizeMm: 3 } }).d;
  assert.ok(pda.flows(pda.heart.state()).some((f) => f.id === "pdaJet"), "PDA jet present");
  const none = settled({}).d;
  assert.ok(!none.flows(none.heart.state()).some((f) => f.kind === "regurgitant"), "no jets without orifices");
});

test("normal LVOT VTI is 18 to 25 cm and continuity recovers the valve area", () => {
  const { d } = settled({});
  const lvot = d.measure(d.spectrum({ flow: "lvot", mode: "PW", durationMs: 900, dtMs: 2 }));
  assert.ok(lvot.vtiCm >= 18 && lvot.vtiCm <= 25, "LVOT VTI " + lvot.vtiCm.toFixed(1) + " cm");
  const av = d.measure(d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2 }));
  const ava = D.continuityAVA(D.lvotAreaCm2(2.2), lvot.vtiCm, av.vtiCm);
  assert.ok(Math.abs(ava - 5.0) / 5.0 < 0.05, "continuity AVA " + ava.toFixed(2) + " vs preset 5.0");
});

test("severe AS: peak velocity above 4 m/s and mean gradient above 40 mmHg", () => {
  const { d, s } = settled({ preset: "severeAS" });
  const m = d.measure(d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2 }));
  assert.ok(m.peakVelocityMs > 4, "peak velocity " + m.peakVelocityMs.toFixed(2));
  assert.ok(m.meanGradientMmHg > 40, "mean gradient " + m.meanGradientMmHg.toFixed(1));
  assert.ok(Math.abs(m.peakVelocityMs - s.peakAorticVelocity) < 0.05, "matches heart ground truth velocity");
  assert.ok(Math.abs(m.peakGradientMmHg - s.peakAorticGradient) < 2, "matches heart ground truth gradient");
});

test("Bernoulli numerically: 4v^2, proximal correction, inverse, spectrum peak", () => {
  assert.equal(D.bernoulli(2), 16);
  assert.equal(D.bernoulli(4), 64);
  assert.equal(D.bernoulli(0.5), 1);
  assert.ok(Math.abs(D.bernoulli(3, 1) - (36 - 4)) < 1e-9, "extended Bernoulli subtracts proximal term");
  for (const v of [0.3, 1.0, 2.7, 4.5]) assert.ok(Math.abs(D.velocityFromGradient(D.bernoulli(v)) - v) < 1e-9, "inverse at " + v);
  const { d } = settled({ preset: "severeAS" });
  const m = d.measure(d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2 }));
  assert.ok(Math.abs(m.peakGradientMmHg - 4 * m.peakVelocityMs * m.peakVelocityMs) < 1e-9, "spectrum peak gradient is 4v^2");
});

test("mitral stenosis: pressure half-time above 220 ms for MVA below 1.0, 220/PHT consistent", () => {
  const { d } = settled({ mitralValveAreaCm2: 0.9 });
  const m = d.measure(d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 2600, dtMs: 2 }));
  assert.ok(m.pressureHalfTimeMs > 220, "PHT " + m.pressureHalfTimeMs.toFixed(0) + " ms");
  assert.ok(Math.abs(D.mvaFromPHT(m.pressureHalfTimeMs) - m.mitralValveAreaCm2) < 1e-9, "MVA is 220/PHT by construction");
  assert.ok(Math.abs(m.mitralValveAreaCm2 - 0.9) / 0.9 < 0.10,
    "derived MVA " + m.mitralValveAreaCm2.toFixed(2) + " within 10% of preset 0.9");
  assert.ok(Math.abs(D.phtFromMVA(0.9) - 220 / 0.9) < 1e-9, "formula 220/MVA");
  const normal = settled({});
  const mn = normal.d.measure(normal.d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 2600, dtMs: 2 }));
  assert.ok(mn.pressureHalfTimeMs < 220, "normal PHT " + mn.pressureHalfTimeMs.toFixed(0) + " ms stays below the severe band");
});

test("normal mitral E and A match the heart ground truth", () => {
  const { d, s } = settled({});
  const m = d.measure(d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 2 }));
  assert.ok(m.eVelocityMs >= 0.6 && m.eVelocityMs <= 1.0, "E " + m.eVelocityMs.toFixed(2));
  assert.ok(m.aVelocityMs > 0 && m.aVelocityMs < m.eVelocityMs, "A below E");
  assert.ok(m.eaRatio >= 1.0 && m.eaRatio <= 2.0, "E/A " + m.eaRatio.toFixed(2));
  assert.ok(Math.abs(m.eVelocityMs - s.Evelocity) < 0.03, "E matches summary()");
  assert.ok(Math.abs(m.aVelocityMs - s.Avelocity) < 0.03, "A matches summary()");
  const af = settled({ af: true, heartRateBpm: 90 });
  const ma = af.d.measure(af.d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 2 }));
  assert.equal(ma.aVelocityMs, 0, "no A wave in AF");
});

test("PW aliasing appears exactly above Nyquist, CW never aliases", () => {
  const { d } = settled({});
  const below = d.spectrum({ flow: "aorticJet", mode: "PW", durationMs: 900, dtMs: 2, nyquistMs: 1.5 });
  assert.equal(below.anyAliased, false, "peak 1.39 m/s below 1.5 m/s Nyquist does not alias");
  const above = d.spectrum({ flow: "aorticJet", mode: "PW", durationMs: 900, dtMs: 2, nyquistMs: 1.3 });
  assert.equal(above.anyAliased, true, "peak 1.39 m/s above 1.3 m/s Nyquist aliases");
  const peakIdx = above.trueVelocityMs.indexOf(Math.max(...above.trueVelocityMs));
  assert.equal(above.aliased[peakIdx], true, "the peak sample itself is flagged aliased");
  assert.ok(Math.abs(above.envelopeMs[peakIdx]) <= 1.3 + 1e-9, "displayed peak wraps inside the Nyquist window");
  const cw = d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2, nyquistMs: 0.5 });
  assert.equal(cw.anyAliased, false, "CW has no aliasing at any scale");
  assert.equal(cw.nyquistMs, Infinity);
});

test("PW aliasing disappears with baseline shift or lower depth", () => {
  const { d } = settled({});
  const deep = d.spectrum({ flow: "lvot", mode: "PW", durationMs: 900, dtMs: 2, depthMm: 160 });
  assert.equal(deep.anyAliased, true, "LVOT peak above the 160 mm Nyquist " + deep.nyquistMs.toFixed(2));
  const shifted = d.spectrum({ flow: "lvot", mode: "PW", durationMs: 900, dtMs: 2, depthMm: 160, baselineShift: -1 });
  assert.equal(shifted.anyAliased, false, "baseline shifted by one Nyquist unwraps the (away) LVOT jet");
  assert.ok(Math.abs(Math.min(...shifted.envelopeMs) + Math.max(...shifted.beamVelocityMs)) < 1e-9,
    "unwrapped display equals the true beam velocity, below the baseline");
  const shallow = d.spectrum({ flow: "lvot", mode: "PW", durationMs: 900, dtMs: 2, depthMm: 40 });
  assert.ok(shallow.nyquistMs > deep.nyquistMs, "lower depth raises Nyquist");
  assert.equal(shallow.anyAliased, false, "no aliasing at 40 mm depth");
  assert.ok(Math.abs(deep.nyquistMs - D.nyquistFromDepth(160, 2)) < 1e-9, "Nyquist from depth formula");
  assert.ok(Math.abs(D.maxPrfHz(160) - 1540 / 0.32) < 1e-6, "max PRF = c/(2*depth)");
});

test("60 degree angle without correction underestimates velocity by half", () => {
  const { d } = settled({ preset: "severeAS" });
  const plain = d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2, angleDeg: 60 });
  const truePeak = Math.max(...plain.trueVelocityMs);
  const m = d.measure(plain);
  assert.ok(Math.abs(m.peakVelocityMs - 0.5 * truePeak) < 0.02 * truePeak,
    "uncorrected " + m.peakVelocityMs.toFixed(2) + " is half of " + truePeak.toFixed(2));
  const corrected = d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2, angleDeg: 60, angleCorrection: true });
  assert.ok(Math.abs(d.measure(corrected).peakVelocityMs - truePeak) < 0.02 * truePeak, "correction recovers the true velocity");
  const wrong = d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2, angleDeg: 60, angleCorrection: true, assumedAngleDeg: 0 });
  assert.ok(Math.abs(d.measure(wrong).peakVelocityMs - 0.5 * truePeak) < 0.02 * truePeak, "a wrong assumed angle leaves the error in");
});

test("sample volume selects the nearest stream and beam direction sets the angle", () => {
  const { d } = settled({});
  const spec = d.spectrum({ mode: "PW", durationMs: 900, dtMs: 2,
    sampleVolume: { position: D.ANCHOR.lvot, beamDirection: [0, 0, 1] } });
  assert.equal(spec.flow, "lvot");
  assert.ok(spec.angleDeg < 10, "axial beam near parallel: " + spec.angleDeg.toFixed(1) + " deg");
  const cross = d.spectrum({ mode: "PW", durationMs: 900, dtMs: 2, flow: "lvot", beamDirection: [1, 0, 0] });
  assert.ok(cross.angleDeg > 80, "cross beam near 90 deg: " + cross.angleDeg.toFixed(1));
  assert.ok(Math.abs(d.measure(cross).peakVelocityMs) < 0.2 * Math.max(...cross.trueVelocityMs), "cosine kills a cross beam");
});

test("spectral broadening: turbulent AS jet is broader than laminar LVOT", () => {
  function rowSpread(spec) {
    const i = spec.trueVelocityMs.indexOf(Math.max(...spec.trueVelocityMs));
    const row = spec.intensity[i];
    let sum = 0, mean = 0;
    row.forEach((g, j) => { sum += g; mean += g * spec.velocityAxisMs[j]; });
    mean /= sum;
    let va = 0;
    row.forEach((g, j) => { va += g * Math.pow(spec.velocityAxisMs[j] - mean, 2); });
    return Math.sqrt(va / sum);
  }
  const lam = settled({}).d;
  const lamSpec = lam.spectrum({ flow: "lvot", mode: "PW", durationMs: 900, dtMs: 2 });
  const as = settled({ preset: "severeAS" }).d;
  const asSpec = as.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 900, dtMs: 2 });
  assert.ok(rowSpread(asSpec) > 2 * rowSpread(lamSpec),
    "turbulent spread " + rowSpread(asSpec).toFixed(2) + " vs laminar " + rowSpread(lamSpec).toFixed(2));
});

test("PISA EROA within 10 percent of the preset EROA, regurgitant volume matches", () => {
  const { d, h } = settled({ mitralRegurgAreaCm2: 0.4 });
  const p = d.pisa({ flow: "mrJet", durationMs: 1800, dtMs: 2 });
  assert.ok(Math.abs(p.eroaCm2 - 0.4) / 0.4 < 0.10, "EROA " + p.eroaCm2.toFixed(3) + " vs preset 0.40");
  assert.ok(p.radiusCm > 0.3 && p.radiusCm < 2, "aliasing radius " + p.radiusCm.toFixed(2) + " cm");
  assert.ok(Math.abs(p.regurgitantVolumeMl - h.summary().regurgitantVolumeMl) / h.summary().regurgitantVolumeMl < 0.1,
    "regurgitant volume " + p.regurgitantVolumeMl.toFixed(1) + " ml");
  assert.ok(Math.abs(D.pisaEROA(D.pisaRadiusCm(0.4, 0.4, 5), 0.4, 5) - 0.4) < 1e-9, "PISA formula round trip");
});

test("TR velocity gives PASP by 4v^2 plus RA pressure", () => {
  const { d } = settled({ tricuspidRegurgAreaCm2: 0.5 });
  const m = d.measure(d.spectrum({ flow: "trJet", mode: "CW", durationMs: 900, dtMs: 2 }));
  assert.ok(m.peakVelocityMs > 1, "TR peak " + m.peakVelocityMs.toFixed(2) + " m/s");
  assert.ok(Math.abs(m.paspMmHg - (4 * m.peakVelocityMs * m.peakVelocityMs + 8)) < 1e-9, "PASP formula with RAP 8");
  assert.ok(Math.abs(D.estimatePASP(2.8, 3) - (4 * 2.8 * 2.8 + 3)) < 1e-9, "estimatePASP helper");
});

test("colour field: MR jet toward the probe aliases into a mosaic at the colour Nyquist", () => {
  const { d, h } = settled({ mitralRegurgAreaCm2: 0.4 });
  for (let t = 0; t < 3000 && h.state().flows.mitral > -150; t += 2) h.step(2);
  const cf = d.colourField({ nx: 48, ny: 48 });
  assert.equal(cf.points.length, 48 * 48);
  assert.equal(cf.nyquistMs, 0.6);
  const jet = cf.points.filter((p) => p.flow === "mrJet");
  assert.ok(jet.length >= 3, "MR jet paints " + jet.length + " points");
  assert.ok(jet.some((p) => p.aliased && p.mosaic), "fast turbulent core aliases as a mosaic");
  assert.ok(jet.every((p) => Math.abs(p.displayVelocityMs) <= cf.nyquistMs + 1e-9), "display velocity wrapped at the colour Nyquist");
  assert.ok(jet.some((p) => Math.abs(p.meanVelocityMs) > cf.nyquistMs), "true mean velocity exceeds the Nyquist in the core");
  const cToward = d.colourFor(0.3, 0, 0.6);
  assert.ok(cToward.r > cToward.b && !cToward.aliased, "toward the probe is red");
  const cAway = d.colourFor(-0.3, 0, 0.6);
  assert.ok(cAway.b > cAway.r && !cAway.aliased, "away from the probe is blue");
  const cWrap = d.colourFor(0.9, 0.5, 0.6);
  assert.equal(cWrap.aliased, true, "0.9 m/s aliases at a 0.6 m/s scale");
  assert.ok(Math.abs(cWrap.displayVelocityMs - (0.9 - 1.2)) < 1e-9, "wraps by one full scale");
});

test("display direction: apical mitral inflow above baseline, LVOT/aortic/MR below", () => {
  const { d } = settled({ mitralRegurgAreaCm2: 0.4 });
  const mitral = d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 2 });
  assert.ok(Math.max(...mitral.envelopeMs) > 0.6 && Math.min(...mitral.envelopeMs) >= -1e-9,
    "mitral inflow is toward the apical probe (above)");
  const lvot = d.spectrum({ flow: "lvot", mode: "PW", durationMs: 900, dtMs: 2, nyquistMs: 3 });
  assert.ok(Math.min(...lvot.envelopeMs) < -1 && Math.max(...lvot.envelopeMs) <= 1e-9, "LVOT is away (below)");
  const mr = d.spectrum({ flow: "mrJet", mode: "CW", durationMs: 1800, dtMs: 2 });
  assert.ok(Math.min(...mr.envelopeMs) < -2 && Math.max(...mr.envelopeMs) <= 1e-9, "MR jet is away (below)");
});

test("CW severe AS envelope: below baseline, autoscaled to 70-90% of half-scale, late peak, dense fill", () => {
  const { d } = settled({ preset: "severeAS" });
  const s = d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 1800, dtMs: 2 });
  assert.ok(Math.max(...s.envelopeMs) <= 1e-9, "AS CW envelope never above baseline from apical");
  const peak = Math.min(...s.envelopeMs);
  const frac = Math.abs(peak) / (s.scaleMs / 2);
  assert.ok(frac >= 0.7 && frac <= 0.9, "peak at " + (frac * 100).toFixed(0) + "% of half-scale");
  assert.ok(Math.abs(peak) < s.scaleMs / 2, "never clipped at the scale edge");
  const pkIdx = s.envelopeMs.indexOf(peak);
  const avo = s.events.filter((e) => e.type === "AVO" && e.atMs <= s.timesMs[pkIdx]).pop();
  const avc = s.events.find((e) => e.type === "AVC" && e.atMs > s.timesMs[pkIdx]);
  const u = (s.timesMs[pkIdx] - avo.atMs) / (avc.atMs - avo.atMs);
  assert.ok(u > 0.55 && u < 0.85, "severe AS peaks late in systole at u=" + u.toFixed(2));
  const mild = settled({ aorticValveAreaCm2: 2.5 }).d.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 1800, dtMs: 2 });
  const mIdx = mild.envelopeMs.indexOf(Math.min(...mild.envelopeMs));
  const mAvo = mild.events.filter((e) => e.type === "AVO" && e.atMs <= mild.timesMs[mIdx]).pop();
  const mAvc = mild.events.find((e) => e.type === "AVC" && e.atMs > mild.timesMs[mIdx]);
  const um = (mild.timesMs[mIdx] - mAvo.atMs) / (mAvc.atMs - mAvo.atMs);
  assert.ok(um > 0.35 && um < 0.65, "milder AS peaks near mid-systole at u=" + um.toFixed(2));
  /* Dense fill with a brighter edge on the peak row's column. */
  const col = s.intensity[pkIdx];
  const baseIdx = s.velocityAxisMs.findIndex((v) => v >= 0);
  const lit = col.filter((g, j) => (peak < 0 ? j <= baseIdx : j >= baseIdx) && g > 20).length;
  assert.ok(lit >= 8, "CW column is densely filled from baseline to envelope (" + lit + " bins)");
  const edgeIdx = s.velocityAxisMs.reduce((bi, v, j) => Math.abs(v - peak) < Math.abs(s.velocityAxisMs[bi] - peak) ? j : bi, 0);
  assert.ok(col[edgeIdx] >= col[Math.floor(baseIdx / 2)] || col[edgeIdx] > 180, "bright modal edge");
});

test("PW mitral default Nyquist >=1.2x peak, E accel/decel and DT 160-240 ms from rendered envelope", () => {
  const { d } = settled({});
  const s = d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 2 });
  const peakBeam = Math.max(...s.beamVelocityMs);
  assert.ok(s.nyquistMs >= 1.2 * peakBeam, "default Nyquist " + s.nyquistMs.toFixed(2) + " >= 1.2x peak " + peakBeam.toFixed(2));
  assert.equal(s.anyAliased, false, "default PW mitral does not alias");
  const mvo = s.events.find((e) => e.type === "MVO");
  const seg = s.timesMs.map((t, i) => [t, s.envelopeMs[i]]).filter((x) => x[0] >= mvo.atMs && x[0] < mvo.atMs + 500);
  const epk = seg.reduce((a, b) => (b[1] > a[1] ? b : a));
  const accelMs = epk[0] - mvo.atMs;
  assert.ok(accelMs >= 60 && accelMs <= 120, "E acceleration time ~80-100 ms (got " + accelMs.toFixed(0) + ")");
  const dec = [];
  for (const x of seg) {
    if (x[0] <= epk[0]) continue;
    if (x[1] < 0.3 * epk[1]) break;
    if (x[1] <= 0.9 * epk[1]) dec.push(x);
  }
  assert.ok(dec.length >= 8, "deceleration limb sampled");
  let mx = 0, my = 0; dec.forEach((x) => { mx += x[0]; my += x[1]; }); mx /= dec.length; my /= dec.length;
  let sxy = 0, sxx = 0; dec.forEach((x) => { sxy += (x[0] - mx) * (x[1] - my); sxx += (x[0] - mx) ** 2; });
  const dtMs = epk[1] / -(sxy / sxx);
  assert.ok(dtMs >= 160 && dtMs <= 240, "DT from rendered envelope " + dtMs.toFixed(0) + " ms");
  /* Diastasis (near-baseline) then a distinct A wave before the next QRS. */
  const qrs = s.events.find((e) => e.type === "QRS" && e.atMs > epk[0]);
  const between = seg.filter((x) => x[0] > epk[0] && x[0] < qrs.atMs);
  const dip = between.find((x) => x[1] < 0.1 * epk[1]);
  assert.ok(dip, "diastasis reaches near baseline");
  const aPk = between.filter((x) => x[0] > dip[0]).reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
  assert.ok(aPk[1] > 0.3 * epk[1] && aPk[0] > dip[0], "A wave follows diastasis");
  /* PW laminar band is narrow with a clear window under it. */
  const pkI = s.timesMs.indexOf(epk[0]);
  const row = s.intensity[pkI];
  const zeroIdx = s.velocityAxisMs.findIndex((v) => v >= 0);
  assert.ok(row[zeroIdx] < 8, "clear window at the baseline under the E band");
});

test("ECG strip data is a real synchronised trace, not ticks", () => {
  const { d } = settled({});
  const s = d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 2 });
  assert.equal(s.ecg.length, s.timesMs.length);
  assert.ok(Math.max(...s.ecg) > 0.8 && Math.min(...s.ecg) < -0.1, "QRS complex present");
  const qrs = s.events.find((e) => e.type === "QRS");
  const near = s.timesMs.map((t, i) => [Math.abs(t - qrs.atMs), s.ecg[i]]).sort((a, b) => a[0] - b[0])[0];
  assert.ok(near[1] > 0.5, "R peak aligns with the QRS event");
  const uniq = new Set(s.ecg.map((v) => v.toFixed(3)));
  assert.ok(uniq.size > 40, "continuous waveform, " + uniq.size + " distinct levels");
});

test("colour jet: vena contracta narrower than mid-LA, PISA upstream, no >3px uniform block", () => {
  const { d, h } = settled({ mitralRegurgAreaCm2: 0.4 });
  for (let t = 0; t < 3000 && h.state().flows.mitral > -150; t += 2) h.step(2);
  const cf = d.colourField({ nx: 64, ny: 64 });
  const widthAt = (lo, hi) => {
    const pts = cf.points.filter((p) => p.flow === "mrJet" && !p.pisa && p.axialMm >= lo && p.axialMm < hi);
    assert.ok(pts.length >= 2, "jet points in band " + lo + "-" + hi + " mm");
    return 2 * Math.max(...pts.map((p) => p.jetRadiusMm));
  };
  assert.ok(widthAt(0, 8) < widthAt(35, 50), "vena contracta narrower than mid-LA jet");
  const pisa = cf.points.filter((p) => p.flow === "mrJet" && p.pisa && p.axialMm < 0);
  assert.ok(pisa.length >= 1, "flow convergence (PISA) on the ventricular side");
  assert.ok(pisa.some((p) => Math.abs(p.meanVelocityMs) > 0.2), "convergence accelerates toward the orifice");
  assert.ok(cf.points.filter((p) => p.flow === "mrJet").some((p) => p.mosaic && p.colour.g > 120 && p.colour.r > 120),
    "variance mosaic mixes green/yellow in the turbulent core");
  /* Per-pixel renderer: capture ImageData and scan for uniform runs. */
  let img = null, putAt = null;
  const ctx = { fillStyle: "", strokeStyle: "", font: "",
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    createImageData(w, hh) { return { width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) }; },
    putImageData(im, x, y) { img = im; putAt = [x, y]; } };
  const canvas = { width: 320, height: 220, getContext: () => ctx };
  assert.equal(d.drawColour(canvas, cf), true);
  assert.ok(img && putAt, "colour rendered per-pixel inside a box");
  let maxRun = 0;
  for (let y = 0; y < img.height; y++) {
    let run = 1;
    for (let x = 1; x < img.width; x++) {
      const a = (y * img.width + x) * 4, b = a - 4;
      const colourful = img.data[a + 3] > 0 && Math.max(img.data[a], img.data[a + 1], img.data[a + 2]) - Math.min(img.data[a], img.data[a + 1], img.data[a + 2]) > 25;
      if (colourful && img.data[a] === img.data[b] && img.data[a + 1] === img.data[b + 1] && img.data[a + 2] === img.data[b + 2]) run++;
      else run = 1;
      if (run > maxRun) maxRun = run;
    }
  }
  assert.ok(maxRun <= 3, "largest uniform colour run " + maxRun + " px");
  assert.equal(d.drawColour(null, cf), false);
});

test("renderer draws a spectrum with a stub canvas and ECG events are timed", () => {
  const { d } = settled({});
  const spec = d.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 4 });
  assert.ok(spec.events.some((e) => e.type === "QRS"), "QRS event on the spectrum clock");
  assert.ok(spec.events.every((e) => e.atMs >= -20 && e.atMs <= 1800 + 20), "events land on the recording axis");
  let rects = 0;
  const ctx = { fillStyle: "", strokeStyle: "", font: "",
    fillRect() { rects++; }, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const canvas = { width: 640, height: 320, getContext: () => ctx };
  assert.equal(d.drawSpectrum(canvas, spec), true);
  assert.ok(rects > 100, "grey spectrum painted: " + rects + " rects");
  assert.equal(d.drawSpectrum(null, spec), false, "no canvas is a clean false");
});
