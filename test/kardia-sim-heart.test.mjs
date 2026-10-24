/* test/kardia-sim-heart.test.mjs - Kardia WP1 cycle model (kardia-sim-heart.js).
 *
 * Threshold citations (normal preset, HR 70):
 * - LVEF 55-70%: ASE/EACVI chamber quantification (Lang et al. 2015) normal
 *   LVEF ~62 +/- 5% (men) / 64 +/- 5% (women); abnormal <52-54%.
 * - LVEDV 100-160 ml: ASE 2015 normal LVEDV ~106 +/- 22 ml (men, 2D/biplane
 *   range roughly 62-150 ml); test band widened slightly for a lumped model.
 * - SV 60-100 ml: Guyton & Hall, Textbook of Medical Physiology - resting
 *   stroke volume ~70 ml (EDV ~120 ml, ESV ~50 ml) at HR ~72, CO ~5 L/min.
 * - LV systolic 100-140 mmHg and aortic ~120/80 (within 15 mmHg): standard
 *   systemic arterial pressure, Guyton & Hall (systolic ~120, diastolic ~80).
 * - Mean LA pressure 4-12 mmHg: Braunwald's Heart Disease - normal mean left
 *   atrial / pulmonary wedge pressure ~6-12 mmHg.
 * - RV systolic 15-30 mmHg: Braunwald - normal RV systolic ~15-28 mmHg,
 *   pulmonary artery systolic ~15-28 mmHg.
 * - Isovolumic contraction 30-90 ms, LVET 250-330 ms: Braunwald / Guyton
 *   cardiac cycle timings at HR ~70 (IVC ~0.05 s, ejection ~0.30 s of a
 *   0.85 s cycle; systole ~0.3 s, diastole ~0.55 s).
 * - Severe AS peak gradient >64 mmHg: ASE/EACVI valve guidelines - severe AS
 *   is peak jet velocity >4 m/s, i.e. peak gradient 4v^2 > 64 mmHg, mean
 *   gradient >40 mmHg, AVA <1.0 cm2 (test uses AVA 0.8 cm2).
 * - Severe MR: ASE native valvular regurgitation guidance - severe primary MR
 *   EROA >= 0.40 cm2; forward SV falls and LA pressure rises.
 * - HR 120: Guyton - raising rate shortens diastole far more than systole
 *   (diastole ~0.55 s of 0.85 s at rest is the phase compressed).
 * - Mitral E 0.6-1.0 m/s and E/A 1.0-2.0: ASE/EACVI 2016 diastolic function
 *   guidelines (Nagueh et al.) - in a healthy adult early filling dominates:
 *   peak E is roughly 0.6-1.0 m/s with E/A 1.0-2.0; E/A <= 0.8 is the
 *   impaired-relaxation (grade I) pattern and is abnormal for this preset.
 * - Peak AV velocity 1.0-1.5 m/s (gradient 4-9 mmHg), severe AS >64 mmHg:
 *   ASE/EACVI 2017 aortic valve stenosis recommendations (Baumgartner
 *   et al.) - a normal aortic valve has a peak jet velocity of about
 *   1.0-1.5 m/s (peak gradient 4v^2 = 4-9 mmHg); severe AS is peak jet
 *   velocity >4.0 m/s, i.e. peak gradient >64 mmHg, AVA <1.0 cm2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const H = require("../kardia-sim-heart.js");

const EVENTS = ["P", "QRS", "T", "MVC", "AVO", "AVC", "MVO", "TVC", "PVC"];

function runHeart(params, beats = 15, dt = 1) {
  const h = H.create(params);
  const ev = [];
  for (const t of EVENTS) h.on(t, (e) => ev.push({ type: t, timeMs: e.timeMs, cycleTimeMs: e.cycleTimeMs }));
  const hr = (params && params.heartRateBpm) || 70;
  const totalMs = beats * (60000 / hr);
  for (let t = 0; t < totalMs; t += dt) h.step(dt);
  return { h, ev, s: h.summary() };
}

/* One steady-state cycle's valve events (absolute ms), from the event stream. */
function oneCycle(ev) {
  const cycles = [];
  let cur = null;
  for (const e of ev) {
    if (e.type === "MVC") { cur = { MVC: e.timeMs }; cycles.push(cur); }
    else if (cur && cur[e.type] === undefined) cur[e.type] = e.timeMs;
  }
  return cycles.find((c) => c.AVO !== undefined && c.AVC !== undefined && c.MVO !== undefined) || null;
}

test("exports: window global, module.exports, presets, ES5 source", () => {
  assert.ok(H && typeof H.create === "function");
  assert.ok(H.presets && H.presets.normal);
  for (const k of ["severeAS", "severeMR", "af"]) assert.ok(H.presets[k], "preset " + k);
  const src = readFileSync(new URL("../kardia-sim-heart.js", import.meta.url), "utf8");
  assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "ES5 only");
  const win = {};
  new Function("window", "module", src)(win, undefined);
  assert.ok(win.KARDIA_HEART && typeof win.KARDIA_HEART.create === "function");
});

test("normal preset at HR 70: volumes, EF, pressures (ASE 2015 / Guyton / Braunwald ranges in header)", () => {
  const { s } = runHeart(H.presets.normal);
  assert.ok(s.EF >= 55 && s.EF <= 70, "EF " + s.EF);
  assert.ok(s.LVEDV >= 100 && s.LVEDV <= 160, "LVEDV " + s.LVEDV);
  assert.ok(s.SV >= 60 && s.SV <= 100, "SV " + s.SV);
  assert.ok(s.peakLVPressure >= 100 && s.peakLVPressure <= 140, "peak LV " + s.peakLVPressure);
  assert.ok(Math.abs(s.aorticSystolic - 120) <= 15, "aortic sys " + s.aorticSystolic);
  assert.ok(Math.abs(s.aorticDiastolic - 80) <= 15, "aortic dia " + s.aorticDiastolic);
  assert.ok(s.meanLAPressure >= 4 && s.meanLAPressure <= 12, "mean LA " + s.meanLAPressure);
  assert.ok(s.peakRVPressure >= 15 && s.peakRVPressure <= 30, "RV sys " + s.peakRVPressure);
  assert.ok(s.Evelocity > 0 && s.Avelocity > 0, "E/A velocities present");
  assert.ok(s.LVOTVTI > 10 && s.LVOTVTI < 35, "LVOT VTI " + s.LVOTVTI);
  assert.ok(s.CO > 3.5 && s.CO < 7, "CO " + s.CO);
});

test("normal preset: mitral E 0.6-1.0 m/s and E/A 1.0-2.0 (ASE/EACVI 2016 diastolic function)", () => {
  const { s } = runHeart(H.presets.normal);
  // ASE/EACVI 2016 diastolic function (Nagueh et al.): healthy early
  // filling gives a peak mitral E velocity of about 0.6-1.0 m/s.
  assert.ok(s.Evelocity >= 0.6 && s.Evelocity <= 1.0, "E velocity " + s.Evelocity);
  // ASE/EACVI 2016 diastolic function (Nagueh et al.): a normal heart has
  // E/A 1.0-2.0; E/A <= 0.8 is the impaired-relaxation (grade I) pattern.
  const ea = s.Evelocity / s.Avelocity;
  assert.ok(ea >= 1.0 && ea <= 2.0, "E/A " + ea);
});

test("normal preset: peak AV velocity 1.0-1.5 m/s, severe AS still >64 mmHg (ASE/EACVI 2017 valve stenosis)", () => {
  const normal = runHeart(H.presets.normal).s;
  // ASE/EACVI 2017 valve stenosis (Baumgartner et al.): a normal aortic
  // valve has a peak jet velocity of about 1.0-1.5 m/s.
  assert.ok(normal.peakAorticVelocity >= 1.0 && normal.peakAorticVelocity <= 1.5,
    "peak AV velocity " + normal.peakAorticVelocity);
  // ASE/EACVI 2017 valve stenosis: peak gradient is 4v^2, so 1.0-1.5 m/s
  // across a normal valve is a peak gradient of about 4-9 mmHg.
  assert.ok(normal.peakAorticGradient >= 4 && normal.peakAorticGradient <= 9,
    "peak AV gradient " + normal.peakAorticGradient);
  const as = runHeart({ ...H.presets.normal, aorticValveAreaCm2: 0.8 }).s;
  // ASE/EACVI 2017 valve stenosis: severe AS (AVA <1.0 cm2) is peak jet
  // velocity >4.0 m/s, i.e. peak gradient 4v^2 > 64 mmHg.
  assert.ok(as.peakAorticVelocity > 4.0, "severe AS peak velocity " + as.peakAorticVelocity);
  // ASE/EACVI 2017 valve stenosis: severe AS peak gradient >64 mmHg.
  assert.ok(as.peakAorticGradient > 64, "severe AS gradient " + as.peakAorticGradient);
});

test("event order MVC < AVO < AVC < MVO, IVC 30-90 ms, LVET 250-330 ms each cycle", () => {
  const { ev, s } = runHeart(H.presets.normal);
  const c = oneCycle(ev.slice(ev.length - 40));
  assert.ok(c, "complete cycle found");
  assert.ok(c.MVC < c.AVO && c.AVO < c.AVC && c.AVC < c.MVO, JSON.stringify(c));
  const ivc = c.AVO - c.MVC, lvet = c.AVC - c.AVO;
  assert.ok(ivc >= 30 && ivc <= 90, "IVC " + ivc);
  assert.ok(lvet >= 250 && lvet <= 330, "LVET " + lvet);
  assert.equal(Math.round(s.IVCms), Math.round(ivc));
  assert.equal(Math.round(s.LVETms), Math.round(lvet));
  // ECG events fire on the same clock, P before QRS before T in a cycle.
  const tail = ev.slice(ev.length - 30);
  const p = tail.find((e) => e.type === "P"), q = tail.find((e) => e.type === "QRS"), t = tail.find((e) => e.type === "T");
  assert.ok(p && q && t && p.timeMs < q.timeMs && q.timeMs < t.timeMs);
});

test("dt 1 ms and 4 ms are stable and give the same EF within 1 percent", () => {
  const a = runHeart(H.presets.normal, 15, 1).s;
  const b = runHeart(H.presets.normal, 15, 4).s;
  assert.ok(Math.abs(a.EF - b.EF) <= 1, `EF dt1 ${a.EF} dt4 ${b.EF}`);
  assert.ok(Math.abs(a.SV - b.SV) <= 2, "SV dt invariance");
});

test("severe AS (AVA 0.8 cm2): peak gradient above 64 mmHg (4v^2, v > 4 m/s)", () => {
  const normal = runHeart(H.presets.normal).s;
  const as = runHeart({ ...H.presets.normal, aorticValveAreaCm2: 0.8 }).s;
  assert.ok(as.peakAorticGradient > 64, "AS gradient " + as.peakAorticGradient);
  assert.ok(as.peakAorticGradient > normal.peakAorticGradient * 2);
  assert.ok(as.peakLVPressure > normal.peakLVPressure, "LV pressure overload");
});

test("severe MR (EROA 0.40 cm2): forward SV falls and LA pressure rises", () => {
  const normal = runHeart(H.presets.normal).s;
  const mr = runHeart({ ...H.presets.normal, mitralRegurgAreaCm2: 0.40 }).s;
  assert.ok(mr.SV < normal.SV, `forward SV MR ${mr.SV} vs normal ${normal.SV}`);
  assert.ok(mr.meanLAPressure > normal.meanLAPressure, `mean LA MR ${mr.meanLAPressure} vs ${normal.meanLAPressure}`);
  assert.ok(mr.regurgitantVolumeMl > 5, "regurgitant volume " + mr.regurgitantVolumeMl);
});

test("HR 120 shortens diastole more than systole", () => {
  function systoleDiastole(params) {
    const { ev } = runHeart(params, 15, 1);
    const qrs = ev.filter((e) => e.type === "QRS").map((e) => e.timeMs);
    const avc = ev.filter((e) => e.type === "AVC").map((e) => e.timeMs);
    const q = qrs[qrs.length - 2];
    const a = avc.find((t) => t > q);
    const qNext = qrs[qrs.length - 1];
    return { systole: a - q, diastole: qNext - a };
  }
  const slow = systoleDiastole(H.presets.normal);
  const fast = systoleDiastole({ ...H.presets.normal, heartRateBpm: 120 });
  assert.ok(fast.systole < slow.systole, "systole shortens");
  assert.ok(fast.diastole < slow.diastole, "diastole shortens");
  assert.ok((slow.diastole - fast.diastole) > (slow.systole - fast.systole),
    `diastole delta ${slow.diastole - fast.diastole} vs systole delta ${slow.systole - fast.systole}`);
});

test("state() shape, setParams, AF determinism (no P, irregular RR, reproducible)", () => {
  const { h } = runHeart(H.presets.normal, 3);
  const st = h.state();
  assert.ok(st.phase && typeof st.cycleTimeMs === "number");
  for (const k of ["LA", "LV", "RA", "RV"]) {
    assert.ok(st.volumes[k] > 0 && st.pressures[k] !== undefined, "chamber " + k);
  }
  for (const k of ["mitral", "aortic", "tricuspid", "pulmonary"]) {
    assert.ok(typeof st.valves[k].open === "boolean" && typeof st.valves[k].flow === "number", "valve " + k);
  }
  h.setParams({ heartRateBpm: 90 });
  assert.equal(h.getParams().heartRateBpm, 90);

  const a = runHeart(H.presets.af, 12);
  const b = runHeart(H.presets.af, 12);
  assert.equal(a.ev.filter((e) => e.type === "P").length, 0, "AF has no P");
  assert.ok(a.ev.filter((e) => e.type === "QRS").length > 5);
  assert.equal(a.s.EF, b.s.EF, "deterministic AF");
  const rr = [];
  const qs = a.ev.filter((e) => e.type === "QRS").map((e) => e.timeMs);
  for (let i = 1; i < qs.length; i++) rr.push(qs[i] - qs[i - 1]);
  assert.ok(Math.max(...rr) - Math.min(...rr) > 80, "irregular RR in AF");
});
