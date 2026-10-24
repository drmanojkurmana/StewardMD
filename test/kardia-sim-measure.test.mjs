import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const M = require(join(ROOT, "kardia-sim-measure.js"));
const HEART = require(join(ROOT, "kardia-sim-heart.js"));
const GEOM = require(join(ROOT, "kardia-sim-geom.js"));
const P = M._pure;

/* Ellipse trace (closed polygon) in pixels for a prolate ellipsoid cut:
 * long semi-axis aMm, radial semi-axis bMm, at mmPerPx. */
function ellipseTrace(aMm, bMm, mmPerPx, n = 72) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: (Math.cos(t) * aMm) / mmPerPx + 200, y: (Math.sin(t) * bMm) / mmPerPx + 200 });
  }
  return pts;
}
function scaleTrace(pts, f) {
  let cx = 0, cy = 0;
  pts.forEach((p) => { cx += p.x; cy += p.y; });
  cx /= pts.length; cy /= pts.length;
  return pts.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
}

test("method of discs reproduces analytic ellipsoid volumes within 2 percent", () => {
  const mmPerPx = 0.5;
  // Prolate ellipsoid: a = 45 mm, b = 26 mm. V = 4/3 pi a b^2.
  const a = 45, b = 26;
  const analytic = (4 / 3) * Math.PI * a * b * b / 1000; // ml
  const r = P.simpsonBiplane(ellipseTrace(a, b, mmPerPx), ellipseTrace(a, b, mmPerPx), mmPerPx);
  assert.ok(Math.abs(r.volumeMl - analytic) / analytic < 0.02, `discs ${r.volumeMl} vs analytic ${analytic}`);
  assert.equal(r.discs.length, 20);
  // Single plane (circular discs) agrees for a circular cross section.
  const s = P.simpsonSinglePlane(ellipseTrace(a, b, mmPerPx), mmPerPx);
  assert.ok(Math.abs(s.volumeMl - analytic) / analytic < 0.02);
  // EF from a smaller end systolic ellipsoid.
  const ef = P.simpsonEF(
    ellipseTrace(a, b, mmPerPx), ellipseTrace(a, b, mmPerPx),
    ellipseTrace(a * 0.92, b * 0.68, mmPerPx), ellipseTrace(a * 0.92, b * 0.68, mmPerPx), mmPerPx);
  const esAnalytic = (4 / 3) * Math.PI * (a * 0.92) * (b * 0.68) ** 2 / 1000;
  const efAnalytic = (analytic - esAnalytic) / analytic * 100;
  assert.ok(Math.abs(ef.EF - efAnalytic) < 1.5, `EF ${ef.EF} vs ${efAnalytic}`);
});

test("tracing the true cut polygon grades correct", () => {
  const heart = HEART.create();
  heart.step(4000);
  const geom = GEOM.create({ heart });
  const views = JSON.parse(readFileSync(join(ROOT, "kardia/views.json"), "utf8"));
  geom.setViews(views);
  const src = M.createStubImageSource({ heart, geom, view: "tte_a4c" });
  const frame = src.frameAt("endDiastole");
  const truth = M.lvCutTruth(frame.polygons);
  assert.ok(truth && truth.areaCm2 > 5, "LV cavity polygon present at end diastole");
  // Trace the true polygon (mm plane coords used as pixels at 1 mm per px).
  const g = M.grade("LAarea", M._pure.polygonAreaCm2(truth.points, 1), truth.areaCm2, { phase: "endDiastole", expectedPhase: "endDiastole" });
  assert.equal(g.pass, true, g.feedback);
  // Simpson volume from the true A4C polygon paired with itself is positive and sane.
  const vol = P.simpsonBiplane(truth.points, truth.points, 1);
  assert.ok(vol.volumeMl > 40 && vol.volumeMl < 260, `volume ${vol.volumeMl}`);
  // Ground truth from the model carries the headline quantities.
  const gt = M.groundTruth(heart);
  assert.ok(gt.EF > 40 && gt.EF < 80 && gt.EDV > gt.ESV && gt.LVOTVTI > 5 && gt.MVA === 5);
});

test("a 15 percent undertrace grades wrong with the right feedback", () => {
  const heart = HEART.create();
  heart.step(4000);
  const geom = GEOM.create({ heart });
  geom.setViews(JSON.parse(readFileSync(join(ROOT, "kardia/views.json"), "utf8")));
  const src = M.createStubImageSource({ heart, geom, view: "tte_a4c" });
  const truth = M.lvCutTruth(src.frameAt("endDiastole").polygons);
  const under = scaleTrace(truth.points, Math.sqrt(0.85)); // 15 percent small by area
  const area = P.polygonAreaCm2(under, 1);
  assert.ok(Math.abs(area / truth.areaCm2 - 0.85) < 0.02);
  const g = M.grade("LAarea", area, truth.areaCm2, { phase: "endDiastole", expectedPhase: "endDiastole" });
  assert.equal(g.pass, false);
  assert.match(g.feedback, /trabeculations/i);
  // Wrong frame is named before any tracing judgement.
  const wf = M.grade("EDV", truth.areaCm2, truth.areaCm2, { phase: "systole", expectedPhase: "endDiastole" });
  assert.equal(wf.pass, false);
  assert.match(wf.feedback, /not end diastole/i);
  // Foreshortening is named when the traced length is short.
  const fs = M.grade("EDV", 80, 120, { lengthMm: 70, trueLengthMm: 90 });
  assert.equal(fs.pass, false);
  assert.match(fs.feedback, /foreshortened/i);
});

test("VTI integral of a synthetic triangle is exact", () => {
  const spec = M.createStubSpectrumSource({ peakVelocityMs: 1.5, durationSec: 0.4, riseSec: 0.13 });
  spec.setSize(640, 400);
  const vti = P.vtiCm(spec.envelopePoints(400), spec);
  const exact = spec.trueVtiCm(); // 0.5 * 0.4 s * 1.5 m/s = 30 cm
  assert.ok(Math.abs(vti - exact) / exact < 0.005, `VTI ${vti} vs exact ${exact}`);
  // A coarser trace still lands within the 10 percent VTI tolerance.
  const coarse = P.vtiCm(spec.envelopePoints(12), spec);
  assert.equal(M.grade("LVOTVTI", coarse, exact).pass, true);
});

test("pressure half time and Bernoulli maths", () => {
  assert.equal(P.bernoulliGradientMmHg(2), 16);
  assert.equal(P.bernoulliGradientMmHg(4), 64);
  assert.equal(P.velocityFromGradientMmHg(64), 4);
  // Linear E slope from 1.8 m/s: half pressure velocity is 1.8/root2.
  // Slope reaches it after 150 ms by construction.
  const target = 1.8 / Math.SQRT2;
  const p2v = 1.8 + (target - 1.8) * 2; // twice as far along the slope at 300 ms
  const pht = P.pressureHalfTimeMs({ tSec: 0, vMs: 1.8 }, { tSec: 0.3, vMs: p2v });
  assert.ok(Math.abs(pht - 150) < 1, `PHT ${pht}`);
  assert.ok(Math.abs(P.mvaFromPressureHalfTimeCm2(150) - 220 / 150) < 1e-9);
  // PISA hemisphere: r 0.9 cm, alias 40 cm/s, peak 5 m/s.
  const pz = P.pisa(0.9, 40, 5, 150);
  assert.ok(Math.abs(pz.flowMlPerSec - 2 * Math.PI * 0.81 * 40) < 1e-6);
  assert.ok(Math.abs(pz.EROAcm2 - pz.flowMlPerSec / 500) < 1e-9);
  // Continuity: LVOT 20 mm, LVOT VTI 20 cm, AV VTI 80 cm gives 0.785 cm2.
  assert.ok(Math.abs(P.continuityAvaCm2(20, 20, 80) - Math.PI * 1 * 1 * 0.25) < 1e-9);
  assert.ok(Math.abs(P.strokeVolumeMl(P.lvotAreaCm2(20), 20) - 62.83) < 0.1);
  assert.ok(Math.abs(P.lvotDiameterMm(P.lvotAreaCm2(21)) - 21) < 1e-9);
  assert.equal(P.distanceMm({ x: 0, y: 0 }, { x: 30, y: 40 }, 0.5), 25);
  assert.equal(P.tapseMm({ x: 5, y: 100 }, { x: 5, y: 60 }, 0.5), 20);
});

test("frame selection by cardiac phase", () => {
  const heart = HEART.create();
  heart.step(5000);
  const evs = heart.state().events;
  const ed = P.frameForPhase(evs, "endDiastole");
  const es = P.frameForPhase(evs, "endSystole");
  assert.equal(ed.event, "QRS");
  assert.equal(es.event, "AVC");
  assert.ok(es.cycleTimeMs > ed.cycleTimeMs, "aortic valve closure follows the QRS in the cycle");
  // EF tolerance is 5 percentage points absolute (ASE 2015 reproducibility).
  assert.equal(M.toleranceFor("EF", 55), 5);
  assert.equal(M.grade("EF", 59, 55).pass, true);
  assert.equal(M.grade("EF", 61, 55).pass, false);
  assert.ok(Math.abs(M.toleranceFor("EDV", 120) - 12) < 1e-9);
  assert.ok(Math.abs(M.toleranceFor("LVOTDiameter", 20) - 2) < 1e-9); // 2 mm floor beats 5 percent
  assert.ok(Math.abs(M.toleranceFor("LVOTDiameter", 60) - 3) < 1e-9); // 5 percent wins when larger
});

test("each case echoTask quantity has a tool", () => {
  const casesFile = JSON.parse(readFileSync(join(ROOT, "kardia/cases/index.json"), "utf8"));
  const cov = M.echoTaskCoverage(casesFile.cases || []);
  assert.equal(cov.ok, true, `missing tools for ${cov.missing}`);
  // Quantities taught across the measurement and Doppler lessons and used
  // by the pathology expectation checks all resolve to a tool.
  const taught = ["EF", "EDV", "ESV", "MVA", "AVA", "LVOTDiameter", "LVOTVTI", "AVVTI",
    "PeakVelocity", "PeakGradient", "PHT", "PISARadius", "EROA", "TAPSE", "LAarea",
    "LAVolume", "LVIDd", "IVSd", "EVelocity", "TRVelocity"];
  taught.forEach((q) => assert.ok(M.toolForQuantity(q), `no tool for ${q}`));
  // All nine required tools exist.
  ["caliper", "areaTrace", "simpson", "lvotDiameter", "vtiTrace", "peakVelocity", "pressureHalfTime", "pisaRadius", "tapse"]
    .forEach((id) => assert.ok(M.TOOLS[id], `missing tool ${id}`));
  // Lesson files exist for the methods these tools teach.
  const lessons = readdirSync(join(ROOT, "kardia/learn/lessons"));
  ["meas_simpson_ef.json", "meas_plax_linear.json", "meas_la_volume.json", "meas_rv_tapse.json",
   "dop_bernoulli.json", "dop_continuity_ava.json", "dop_pisa_eroa.json"].forEach((f) => assert.ok(lessons.includes(f), f));
});
