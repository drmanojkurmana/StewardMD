/* "Test Hospital" demo dataset (demo-hospital.js) — for a live meeting demo, no GHIS
 * login needed. This exists because a demo lab value that LOOKS right but doesn't map
 * into a typed analyte is worse than an obviously-fake one: the calculator would just
 * silently show nothing, in front of the room. So every test name here is checked
 * against icu.js's REAL, clinician-verified mapWardLab() (extracted from the live
 * file, not re-typed), not assumed to match.
 *
 * Owner: "create a demo patient in ICU/Ward Dashboard & Ward Sync, a ghis like Test
 * Hospital with 5 branches and 5 patients each with real labs and also to able to
 * show any drug dosing just for demo."
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const DEMO_SRC = readFileSync(new URL("../demo-hospital.js", import.meta.url), "utf8");
const ICU_SRC = readFileSync(new URL("../icu.js", import.meta.url), "utf8");
const WARD_SRC = readFileSync(new URL("../ghis-ward.js", import.meta.url), "utf8");

function loadDataset() {
  const sandbox = { window: {}, Date };
  vm.createContext(sandbox);
  vm.runInContext(DEMO_SRC, sandbox);
  return sandbox.window.SMD_TEST_HOSPITAL;
}

// Pull mapWardLab + its two tables out of the real icu.js source and run them standalone,
// exactly as shipped — no re-typing the vocabulary here.
function loadMapWardLab() {
  const tableStart = ICU_SRC.indexOf("var WARD_LAB_MAP = [");
  const fnEnd = ICU_SRC.indexOf("\n  function mapWardLab(name) {");
  const fnBody = ICU_SRC.slice(fnEnd, ICU_SRC.indexOf("\n  }", fnEnd) + 4);
  const tables = ICU_SRC.slice(tableStart, ICU_SRC.indexOf("var NON_SERUM_SPECIMEN", tableStart) +
    ICU_SRC.slice(ICU_SRC.indexOf("var NON_SERUM_SPECIMEN", tableStart)).indexOf(";") + 1);
  const src = tables + "\n" + fnBody + "\nmodule.exports = mapWardLab;";
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.module.exports;
}

test("dataset is exactly 5 branches of 5 patients", () => {
  const t = loadDataset();
  assert.equal(t.branches.length, 5);
  t.branches.forEach((b) => assert.equal(b.patients.length, 5, b.dept + " should have 5 patients"));
});

test("every patientId and episodeId is unique", () => {
  const t = loadDataset();
  const ids = [], eps = [];
  t.branches.forEach((b) => b.patients.forEach((p) => { ids.push(p.patientId); eps.push(p.episodeId); }));
  assert.equal(new Set(ids).size, ids.length, "duplicate patientId");
  assert.equal(new Set(eps).size, eps.length, "duplicate episodeId");
  assert.equal(ids.length, 25);
});

test("REGRESSION: every lab test name maps to a real analyte, not silently dropped", () => {
  const t = loadDataset();
  const mapWardLab = loadMapWardLab();
  const names = new Set();
  t.branches.forEach((b) => b.patients.forEach((p) => p.labs.forEach((l) => names.add(l.test))));
  assert.ok(names.size >= 10, "sanity: expected a real spread of test names");
  for (const name of names) {
    assert.ok(mapWardLab(name), `"${name}" does not map to any icu.js analyte key — it would silently vanish on ingest`);
  }
});

test("the Nephrology branch actually spans normal to severe renal function", () => {
  const t = loadDataset();
  const neph = t.branches.find((b) => b.dept === "Nephrology");
  const creats = neph.patients.map((p) => {
    const row = p.labs.find((l) => l.test === "Serum Creatinine");
    return parseFloat(row.result);
  });
  assert.ok(Math.min(...creats) < 1.3, "should include a patient with normal creatinine");
  assert.ok(Math.max(...creats) > 4.0, "should include a patient with severe renal impairment");
  assert.equal(new Set(creats.map((c) => Math.round(c * 10))).size, 5, "all 5 should differ, or the dosing demo shows no contrast");
});

test("lab dates are dynamically 'today', not a stale hardcoded date", () => {
  const t = loadDataset();
  const year = String(new Date().getFullYear());
  const anyDate = t.branches[0].patients[0].labs[0].date;
  assert.ok(anyDate.includes(year), `expected the current year (${year}) in "${anyDate}"`);
});

test("ghis-ward.js: demoFetch answers /patients, /lab and /lab-detail from local data only", () => {
  const start = WARD_SRC.indexOf("function demoFetch(path) {");
  assert.ok(start > -1, "demoFetch must exist in ghis-ward.js");
  const end = WARD_SRC.indexOf("\n      }", start) + "\n      }".length;
  const fnSrc = WARD_SRC.slice(start, end);
  const wrapped = "var DEMO;\nfunction load(d){ DEMO = d; return " + fnSrc + "; }\nmodule.exports = load;";
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox);
  const demoFetch = sandbox.module.exports({
    patients: [{ patientId: "TH1", patientFirstName: "Test Patient" }],
    labsByPatientId: { TH1: [
      { test: "Haemoglobin", result: "11", units: "g/dL", low: 12, high: 16, date: "01-JAN-2026 08:00" },
      { test: "Serum Creatinine", result: "2.0", units: "mg/dL", low: 0.6, high: 1.3, date: "01-JAN-2026 08:00" },
    ] },
  });
  return Promise.resolve()
    .then(() => demoFetch("/patients"))
    .then((r) => { assert.equal(r.length, 1); assert.equal(r[0].patientId, "TH1"); return demoFetch("/lab?patientId=TH1"); })
    .then((r) => { assert.equal(r.orders.length, 2, "expected one CBC-style order and one chemistry-style order"); return demoFetch("/lab-detail?renderId=demo-cbc-TH1&patientId=TH1"); })
    .then((r) => { assert.equal(r.tests.length, 1); assert.equal(r.tests[0].test, "Haemoglobin"); return demoFetch("/lab-detail?renderId=demo-chem-TH1&patientId=TH1"); })
    .then((r) => { assert.equal(r.tests.length, 1); assert.equal(r.tests[0].test, "Serum Creatinine"); });
});
