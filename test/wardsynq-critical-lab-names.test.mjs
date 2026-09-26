/* CLIN-06, CLIN-07, CLIN-14 (audit B:A1, B:A2, B:A4). A critical value released from the ward's own lab
 * templates must open a loop; a value that cannot be compared (unrecognised unit) must reach a clinician
 * rather than be dropped; a corrected value on the same report must open a new loop.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-critical-lab-names.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, LAB, H } = await import("./_wardsynq-alert-harness.mjs");
const { codeForTest } = await import("../functions/_wardsynq/lab-result.js");
const { classify } = await import("../functions/_wardsynq/critical-results.js");

/* Every test name in ward.js LAB_TEMPLATES, with the LOINC code it must carry (null: deliberately local, see
 * LAB_CODE_SEED's header). Adding a template name without deciding its code fails here. */
const EXPECTED = {
  "Hemoglobin": "718-7", "TLC / Total Leucocyte Count": "6690-2", "Platelet Count": "777-3", "RBC Count": null,
  "Neutrophils": null, "Lymphocytes": null, "Eosinophils": null, "Monocytes": null, "PCV / Packed Cell Volume": "4544-3", "ESR": null,
  "Bilirubin (Total)": "1975-2", "Bilirubin (Direct)": "1968-7", "SGOT / AST": "1920-8", "SGPT / ALT": "1742-6",
  "Alkaline Phosphatase (ALP)": "6768-6", "Total Protein": null, "Serum Albumin": "1751-7", "Serum Globulin": null,
  "Blood Urea": null, "Serum Creatinine": "2160-0", "Blood Urea Nitrogen (BUN)": "3094-0", "Serum Uric Acid": null,
  "Sodium (Na+)": "2951-2", "Potassium (K+)": "2823-3", "Chloride (Cl-)": "2075-0", "Bicarbonate (HCO3-)": null,
  "Total Cholesterol": null, "Triglycerides": null, "HDL Cholesterol": null, "LDL Cholesterol": null, "VLDL Cholesterol": null,
  "Malarial Parasite (Smear/Card)": null, "Widal / Typhidot": null, "Dengue NS1 Antigen": null, "Dengue IgM / IgG": null,
  "Urine Routine (Pus cells)": null, "C-Reactive Protein (CRP)": "1988-5",
  "Prothrombin Time (PT)": null, "Control PT": null, "INR": "6301-6", "aPTT": null,
  "pH": null, "pCO2": null, "pO2": null, "HCO3-": null, "Base Excess": null, "SaO2": null,
};

function templateTests() {
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  const start = src.indexOf("var LAB_TEMPLATES = {");
  const block = src.slice(start, src.indexOf("\n  };", start));
  return [...block.matchAll(/\{ test: "([^"]+)", unit: "([^"]*)"/g)].map((m) => ({ test: m[1], unit: m[2] }));
}

test("every ward lab template name is pinned to its code", () => {
  const rows = templateTests();
  assert.ok(rows.length >= 40, "the template block was found");
  assert.deepEqual(rows.map((r) => r.test).sort(), Object.keys(EXPECTED).sort(), "a template name was added or renamed: pin its code here");
  for (const r of rows) {
    const c = codeForTest(r.test);
    if (EXPECTED[r.test]) assert.equal(c.code, EXPECTED[r.test], r.test);
    else assert.equal(c.codeSystem, "wardsynq-lab-local", `${r.test} stays local`);
  }
});

test("template units compare against the limits: critical values open, normal values are quiet, nothing is uncomparable", () => {
  const unitOf = Object.fromEntries(templateTests().map((r) => [r.test, r.unit]));
  const obs = (name, value) => ({ code: codeForTest(name).code, value, unit: unitOf[name] });
  const critical = [["Potassium (K+)", 7.5], ["Sodium (Na+)", 112], ["Serum Creatinine", 9.8], ["Bilirubin (Total)", 22],
    ["Hemoglobin", 5], ["Platelet Count", 0.08], ["TLC / Total Leucocyte Count", 600], ["INR", 9.2]];
  for (const [name, v] of critical) {
    const hit = classify(obs(name, v));
    assert.ok(hit && hit.critical === true, `${name} ${v} ${unitOf[name]} -> ${JSON.stringify(hit)}`);
  }
  const normal = [["Potassium (K+)", 4.1], ["Sodium (Na+)", 138], ["Hemoglobin", 13], ["Platelet Count", 2.5], ["TLC / Total Leucocyte Count", 8000], ["INR", 1.0]];
  for (const [name, v] of normal) assert.equal(classify(obs(name, v)), null, `${name} ${v} ${unitOf[name]}`);
});

test("mEq/L is mmol/L only for a monovalent ion; a blank unit is the INR's own", () => {
  assert.equal(classify({ code: "2823-3", value: 7.5, unit: "mEq/L" }).critical, true);
  assert.equal(classify({ code: "6301-6", value: 9.2, unit: "" }).critical, true);
  // A blank unit on potassium is not assumed to be anything.
  assert.equal(classify({ code: "2823-3", value: 7.5, unit: "" }).uncomparable, true);
  // A hospital limit for a divalent ion in mmol/L is never compared with mEq/L.
  const limits = { "17861-6": { display: "Calcium", unit: "mmol/L", low: 1.5, high: 3.2 } };
  assert.equal(classify({ code: "17861-6", value: 3.4, unit: "mEq/L" }, limits).uncomparable, true);
});

async function release(p, code, tests, status) {
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: p.encounterId, code, category: "laboratory" });
  await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: order.orderId, specimenType: "Serum" });
  const r = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: order.orderId, patientId: p.patientId, encounterId: p.encounterId, tests, status: status || "final" });
  return { r, order };
}

test("a template release with a critical potassium opens its loop (route)", async () => {
  seedHospital();
  const p = await admittedPatient();
  const { r } = await release(p, "Serum Electrolytes", [{ test: "Potassium (K+)", value: "7.5", unit: "mEq/L" }, { test: "Sodium (Na+)", value: "112", unit: "mEq/L" }]);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.criticalCheck.checked, true);
  assert.equal(r.criticalCheck.opened, 2, JSON.stringify(r.criticalCheck));
});

test("a value that cannot be compared opens a loop for a clinician and says so on the release", async () => {
  seedHospital();
  const p = await admittedPatient();
  const { r } = await release(p, "Potassium", [{ test: "Potassium", value: "7.5", unit: "mg/dL" }]);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.criticalCheck.opened, 0, "not claimed as a critical value");
  assert.equal(r.criticalCheck.uncomparable.length, 1, JSON.stringify(r.criticalCheck));
  assert.equal(r.criticalCheck.uncomparable[0].expectedUnit, "mmol/L");
  const loops = await H.RECORD.byPatient("tenant-wsq", "CriticalResultLoop", p.patientId);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].state, "open");
  assert.equal(loops[0].basis, "unit-mismatch");
  const board = await as(DOCTOR, `/ward/criticals?orgId=${ORG}&patientId=${p.patientId}`);
  assert.equal(board.open, 1, "on the critical board, waiting for a clinician");
});

test("a corrected value on an acknowledged loop opens a new loop; re-sending the correction does not", async () => {
  seedHospital();
  const p = await admittedPatient();
  const { r: r1, order } = await release(p, "Glucose", [{ test: "Glucose", value: 40, unit: "mg/dL" }]);
  assert.equal(r1.criticalCheck.opened, 1);
  const ack = await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: r1.criticalCheck.loops[0].loopId, action: "25% dextrose given", close: true });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  const again = (value) => as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: order.orderId, tests: [{ test: "Glucose", value, unit: "mg/dL" }], status: "corrected" });
  const r2 = await again(18);
  assert.equal(r2.__status, 200, JSON.stringify(r2));
  assert.equal(r2.criticalCheck.opened, 1, JSON.stringify(r2.criticalCheck));
  const fresh = r2.criticalCheck.loops.find((l) => l.value === 18);
  assert.ok(fresh && fresh.state === "open", "the corrected value is open for acknowledgement");
  const r3 = await again(18);
  assert.equal(r3.criticalCheck.opened, 0, "the same correction twice is one loop");
  const loops = await H.RECORD.byPatient("tenant-wsq", "CriticalResultLoop", p.patientId);
  assert.deepEqual(loops.map((l) => `${l.value}:${l.state}`).sort(), ["18:open", "40:closed"]);
});
