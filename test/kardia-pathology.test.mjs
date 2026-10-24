/* test/kardia-pathology.test.mjs - Kardia WP7 pathology library (kardia/pathology/*.json).
 *
 * Each file carries one catalogue condition with severity graded heart
 * overrides (KARDIA_HEART parameter names only), geometry hooks, ECG and
 * sound changes, measurable expect targets from the catalogue thresholds,
 * sources and ai_drafted review status.
 *
 * Method: every heart override runs through KARDIA_HEART for 10 cycles.
 * Each computable expect target is asserted against the model summary,
 * sampled flows or event stream: gradients (peak aortic velocity and peak
 * gradient), ejection fraction, chamber volumes, mean left atrial pressure,
 * mitral regurgitant volume, heart rate, AF irregularity and absent P waves,
 * and sampled pulmonary to systemic flow ratio. Targets the model cannot
 * compute (orifice areas set as inputs, vena contracta widths, pressure half
 * times, tissue Doppler and strain, ECG voltage and ST morphology, chamber
 * collapse timing, caval imaging, anatomy text such as defect size, flap
 * type or vegetation size) are listed in expect.skipped with a reason and
 * reported, never asserted and never loosened.
 *
 * Threshold provenance: ASE and EACVI valve stenosis bands (severe AS peak
 * velocity above 4 m per s, peak gradient above 64 mmHg, area below
 * 1.0 sq cm), ASE native regurgitation bands (severe MR orifice 0.40 sq cm
 * or more with regurgitant volume 60 ml or more), Braunwald normal mean
 * left atrial pressure 4 to 12 mmHg and peak right ventricular pressure 15
 * to 30 mmHg, Lang et al chamber bands, ESC pulmonary hypertension bands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const H = require("../kardia-sim-heart.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH_DIR = join(ROOT, "kardia", "pathology");
const catalogue = JSON.parse(readFileSync(join(PATH_DIR, "catalogue.json"), "utf8"));

const VALID_KEYS = new Set(Object.keys(H.defaults()));
const CYCLES = 10;
const DASH = /[-\u2013\u2014]/;

function textOf(value, out) {
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { value.forEach(function (v) { textOf(v, out); }); return; }
  if (value && typeof value === "object") { Object.values(value).forEach(function (v) { textOf(v, out); }); }
}

/* Run one severity override: 10 steady cycles, then sample one more cycle
 * of instantaneous flows for shunt and QpQs metrics. */
function runSeverity(heart) {
  const h = H.create(heart);
  const ev = [];
  h.on("P", function (e) { ev.push({ type: "P", timeMs: e.timeMs }); });
  h.on("QRS", function (e) { ev.push({ type: "QRS", timeMs: e.timeMs }); });
  const hr = heart.heartRateBpm || 70;
  const totalMs = CYCLES * (60000 / hr);
  for (let t = 0; t < totalMs; t += 1) h.step(1);
  const cyc = Math.round(60000 / hr);
  let qp = 0, qs = 0, sh = 0, n = 0;
  for (let t = 0; t < cyc; t += 1) {
    h.step(1);
    const st = h.state();
    qp += st.flows.pulmonaryCirculation;
    qs += st.flows.systemic;
    sh += st.flows.shunt;
    n += 1;
  }
  const s = h.summary();
  const qrs = ev.filter(function (e) { return e.type === "QRS"; }).map(function (e) { return e.timeMs; });
  let spread = 0;
  if (qrs.length > 2) {
    const rr = [];
    for (let i = 1; i < qrs.length; i += 1) rr.push(qrs[i] - qrs[i - 1]);
    spread = Math.max.apply(null, rr) - Math.min.apply(null, rr);
  }
  return {
    s: s,
    qpqs: qs > 0 ? qp / qs : 0,
    meanshunt: n > 0 ? sh / n : 0,
    irregularrr: spread > 80,
    rrspread: spread,
    absentp: ev.filter(function (e) { return e.type === "P"; }).length === 0
  };
}

function metricValue(name, r) {
  const s = r.s;
  switch (name) {
    case "ef": return s.EF;
    case "edv": return s.LVEDV;
    case "esv": return s.LVESV;
    case "rvedv": return s.RVEDV;
    case "rvesv": return s.RVESV;
    case "forwardsv": return s.forwardSV;
    case "co": return s.CO;
    case "meanla": return s.meanLAPressure;
    case "peaklv": return s.peakLVPressure;
    case "peakrv": return s.peakRVPressure;
    case "aosys": return s.aorticSystolic;
    case "aodia": return s.aorticDiastolic;
    case "pulsepressure": return s.aorticSystolic - s.aorticDiastolic;
    case "peakaorticvelocity": return s.peakAorticVelocity;
    case "peakaorticgradient": return s.peakAorticGradient;
    case "evelocity": return s.Evelocity;
    case "avelocity": return s.Avelocity;
    case "regurgitantvolume": return s.regurgitantVolumeMl;
    case "heartrate": return s.heartRateBpm;
    case "qpqs": return r.qpqs;
    case "meanshunt": return r.meanshunt;
    case "irregularrr": return r.irregularrr;
    case "absentp": return r.absentp;
    default: throw new Error("unknown expect metric " + name);
  }
}

function checkTarget(actual, op, value) {
  switch (op) {
    case "gt": return actual > value;
    case "gte": return actual >= value;
    case "lt": return actual < value;
    case "lte": return actual <= value;
    case "eq": return actual === value;
    case "between":
      return Array.isArray(value) && actual >= value[0] && actual <= value[1];
    default: throw new Error("unknown expect op " + op);
  }
}

function loadFile(id) {
  return JSON.parse(readFileSync(join(PATH_DIR, id + ".json"), "utf8"));
}

const results = { passed: 0, skipped: [], files: 0 };

for (const cond of catalogue.conditions) {
  test(cond.id + ": severities run through KARDIA_HEART and meet computable targets", function () {
    const doc = loadFile(cond.id);
    assert.equal(doc.id, cond.id, "id mismatch");
    assert.equal(doc.name, cond.name, "name mismatch");
    assert.equal(doc.review && doc.review.status, "ai_drafted", "review status must be ai_drafted");
    const grades = cond.severity_grades.map(function (g) { return g.grade; }).sort();
    assert.deepEqual(Object.keys(doc.severities).sort(), grades, "severity grades must match catalogue");
    assert.ok(Array.isArray(doc.sources) && doc.sources.length > 0, "needs sources");
    assert.ok(doc.expect && Array.isArray(doc.expect.checks) && doc.expect.checks.length > 0, "needs checks");
    assert.ok(Array.isArray(doc.expect.skipped) && doc.expect.skipped.length > 0, "needs skipped list");
    for (const sk of doc.expect.skipped) {
      assert.ok(sk.target && sk.reason, "skipped entry needs target and reason");
    }
    const strings = [];
    textOf(doc, strings);
    const bad = strings.filter(function (s) { return DASH.test(s); });
    assert.deepEqual(bad.slice(0, 3), [], "dash found: " + bad.slice(0, 3).join(" | "));
    for (const grade of grades) {
      const sev = doc.severities[grade];
      assert.ok(sev.heart && sev.geom && sev.ecg && sev.sound, grade + " needs heart geom ecg sound");
      for (const key of Object.keys(sev.heart)) {
        assert.ok(VALID_KEYS.has(key), cond.id + " " + grade + " unknown heart key " + key);
      }
      const r = runSeverity(sev.heart);
      for (const c of doc.expect.checks.filter(function (x) { return x.severity === grade; })) {
        const actual = metricValue(c.metric, r);
        assert.ok(checkTarget(actual, c.op, c.value),
          cond.id + " " + grade + " " + c.label + ": got " + actual + " " + (c.unit || ""));
        results.passed += 1;
      }
    }
    for (const sk of doc.expect.skipped) {
      results.skipped.push(cond.id + ": " + sk.target + " -- " + sk.reason);
    }
    results.files += 1;
  });
}

test("pathology summary: files, passed targets, skipped targets", function () {
  assert.equal(results.files, catalogue.conditions.length, "every condition needs a file");
  assert.ok(results.passed > 0, "no computable targets ran");
  console.log("kardia pathology: " + results.files + " files, " +
    results.passed + " computable targets passed, " +
    results.skipped.length + " targets skipped");
  for (const line of results.skipped) console.log("  skipped: " + line);
});
