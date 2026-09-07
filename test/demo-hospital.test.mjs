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

function loadDemoFetch() {
  const start = WARD_SRC.indexOf("function demoFetch(path) {");
  assert.ok(start > -1, "demoFetch must exist in ghis-ward.js");
  const end = WARD_SRC.indexOf("\n      }", start) + "\n      }".length;
  const fnSrc = WARD_SRC.slice(start, end);
  const wrapped = "var DEMO;\nfunction load(d){ DEMO = d; return " + fnSrc + "; }\nmodule.exports = load;";
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox);
  return sandbox.module.exports;
}

test("ghis-ward.js: demoFetch answers /patients, /lab and /lab-detail from local data only", () => {
  const load = loadDemoFetch();
  const demoFetch = load({
    patients: [{ patientId: "TH1", patientFirstName: "Test Patient" }],
    labsByPatientId: { TH1: [
      { test: "Haemoglobin", result: "11", units: "g/dL", low: 12, high: 16, date: "01-JAN-2026 08:00" },
      { test: "Serum Creatinine", result: "2.0", units: "mg/dL", low: 0.6, high: 1.3, date: "01-JAN-2026 08:00" },
    ] },
    imagingByPatientId: {}, imagingByResultId: {},
  });
  return Promise.resolve()
    .then(() => demoFetch("/patients"))
    .then((r) => { assert.equal(r.length, 1); assert.equal(r[0].patientId, "TH1"); return demoFetch("/lab?patientId=TH1"); })
    .then((r) => {
      assert.equal(r.orders.length, 2, "one date, one CBC-style order and one chemistry-style order");
      const cbcOrder = r.orders.find((o) => o.renderId.startsWith("demo-cbc|"));
      const chemOrder = r.orders.find((o) => o.renderId.startsWith("demo-chem|"));
      assert.ok(cbcOrder && chemOrder);
      return demoFetch("/lab-detail?renderId=" + encodeURIComponent(cbcOrder.renderId) + "&patientId=TH1");
    })
    .then((r) => { assert.equal(r.tests.length, 1); assert.equal(r.tests[0].test, "Haemoglobin"); return demoFetch("/lab-detail?renderId=" + encodeURIComponent("demo-chem|TH1|01-JAN-2026 08:00") + "&patientId=TH1"); })
    .then((r) => { assert.equal(r.tests.length, 1); assert.equal(r.tests[0].test, "Serum Creatinine"); });
});

test("REGRESSION: a real 6-day patient gets 6 distinct dated orders, not 2 orders piled onto one date", () => {
  const t = loadDataset();
  const chandrasekhar = t.branches.find((b) => b.dept === "Nephrology").patients.find((p) => p.name === "Chandrasekhar Rao");
  const load = loadDemoFetch();
  const demoFetch = load({
    patients: [], labsByPatientId: { [chandrasekhar.patientId]: chandrasekhar.labs },
    imagingByPatientId: {}, imagingByResultId: {},
  });
  return demoFetch("/lab?patientId=" + chandrasekhar.patientId).then((r) => {
    const dates = new Set(r.orders.map((o) => o.orderDate));
    assert.equal(dates.size, 6, "expected 6 distinct dated orders (one draw per day), got " + dates.size + ": " + JSON.stringify([...dates]));
    assert.ok(r.orders.length >= 6, "expected at least one order per day");
  });
});

test("ghis-ward.js: demoFetch answers /radiology and /radiology-report", () => {
  const load = loadDemoFetch();
  const demoFetch = load({
    patients: [], labsByPatientId: {},
    imagingByPatientId: { TH1: [{ resultid: "R1", studyName: "USG Abdomen", date: "01-JAN-2026 08:00", report: "Normal study.", doctor: "Radiology" }] },
    imagingByResultId: { R1: { resultid: "R1", studyName: "USG Abdomen", date: "01-JAN-2026 08:00", report: "Normal study.", doctor: "Radiology" } },
  });
  return Promise.resolve()
    .then(() => demoFetch("/radiology?patientId=TH1"))
    .then((r) => { assert.equal(r.orders.length, 1); assert.equal(r.orders[0].resultid, "R1"); assert.equal(r.orders[0].description, "USG Abdomen"); return demoFetch("/radiology-report?resultid=R1&type=manual"); })
    .then((r) => { assert.equal(r.report, "Normal study."); assert.equal(r.testName, "USG Abdomen"); });
});

test("REGRESSION: every patient has exactly two imaging reports (USG + CECT Abdomen)", () => {
  const t = loadDataset();
  t.branches.forEach((b) => b.patients.forEach((p) => {
    assert.equal(p.imaging.length, 2, p.name + " should have exactly 2 imaging reports");
    const names = p.imaging.map((im) => im.studyName).sort().join(",");
    assert.equal(names, "CECT Abdomen,USG Abdomen");
    p.imaging.forEach((im) => {
      assert.ok(im.resultid, "every imaging report needs a resultid");
      assert.ok(im.report && im.report.length > 5, "every imaging report needs real report text");
    });
  }));
});

test("REGRESSION: every patient carries the full panel across all 6 days, not a partial vignette subset", () => {
  const t = loadDataset();
  let checked = 0;
  t.branches.forEach((b) => b.patients.forEach((p) => {
    checked++;
    const byTest = {};
    p.labs.forEach((l) => { byTest[l.test] = (byTest[l.test] || 0) + 1; });
    const testNames = Object.keys(byTest);
    assert.ok(testNames.length >= 20, p.name + " should carry the full ~23-test panel, got " + testNames.length);
    testNames.forEach((name) => assert.equal(byTest[name], 6, p.name + "'s " + name + " should have exactly 6 dated days"));
  }));
  assert.equal(checked, 25);
});

test("REGRESSION: the StewardMD MICU branch has 5 named residents, each with vitals, and no one else does", () => {
  const t = loadDataset();
  const micu = t.branches.find((b) => b.dept === "StewardMD MICU");
  assert.ok(micu, "the ICU branch must be renamed to StewardMD MICU");
  const residents = new Set(micu.patients.map((p) => p.doctor));
  assert.equal(residents.size, 5, "each StewardMD MICU patient should have a distinct named resident");
  micu.patients.forEach((p) => {
    assert.ok(p.vitals && p.vitals.length === 9, p.name + " should have a 3-day (9-reading) vitals timeline");
    p.vitals.forEach((v) => assert.ok(typeof v.ts === "number" && v.ts > 0, "every vitals row needs a real timestamp"));
  });
  t.branches.filter((b) => b.dept !== "StewardMD MICU").forEach((b) => b.patients.forEach((p) => {
    assert.equal(p.vitals, null, p.name + " (outside the ICU) should not have a vitals feed — Ward Sync never supplies one");
  }));
});

test("REGRESSION: no doctor name is pre-fixed with 'Dr.' (the render layer adds its own, or it doubles up)", () => {
  const t = loadDataset();
  t.branches.forEach((b) => b.patients.forEach((p) => {
    assert.ok(!/^dr\.?\s/i.test(p.doctor), p.name + "'s doctor field \"" + p.doctor + "\" already starts with Dr. — the UI would show \"Dr. Dr. \"");
  }));
});
