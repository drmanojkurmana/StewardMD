// test/connect/file/normalize.test.mjs — Task 6: CSV lab -> SCCM via columnMap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDelimited } from "../../../functions/_connect/connectors/file/csv.js";
import { normalizeCsvLab } from "../../../functions/_connect/connectors/file/normalize.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";

const columnMap = { patientId: "MRN", name: "Name", dob: "DOB", sex: "Sex", orderId: "Order", testCode: "Code", testCodeSystem: "CodeSys", testName: "Test", value: "Value", unit: "Unit", refLow: "Low", refHigh: "High", abnormalFlag: "Flag", collectedAt: "Collected", resultStatus: "Status" };
const ctx = (map = columnMap) => ({ tenant: { id: "t1" }, now: () => new Date(0), config: { config: { columnMap: map } } });
const CSV = ["MRN,Name,DOB,Sex,Order,Code,CodeSys,Test,Value,Unit,Low,High,Flag,Collected,Status",
  "P1,Jane Doe,1980-01-01,F,O9,718-7,LN,Hemoglobin,9.2,g/dL,13,17,L,2026-08-01,F",
  "P1,Jane Doe,1980-01-01,F,O9,2160-0,LN,Creatinine,1.1,mg/dL,0.6,1.3,,2026-08-01,F"].join("\n");

test("columnMap happy path -> valid SCCM: one Patient, grouped DiagnosticReport", () => {
  const b = normalizeCsvLab(ctx(), parseDelimited(CSV));
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.patient.gender, "female");
  assert.equal(b.observations.length, 2);
  assert.equal(b.observations[0].value.value, 9.2);
  assert.equal(b.diagnosticReports.length, 1);                 // both rows share order O9
  assert.equal(b.diagnosticReports[0].results.length, 2);
  assert.equal(b.observations[0].interpretation.text, "L");
});

test("mapped-but-absent column and unmapped column both warn (never silently dropped)", () => {
  const b = normalizeCsvLab(ctx(Object.assign({}, columnMap, { unit: "MISSING_COL" })), parseDelimited("MRN,Extra\nP1,x"));
  assert.ok(b.meta.warnings.some((w) => w.includes("mapped column")));
  assert.ok(b.meta.warnings.some((w) => w.includes("unmapped column")));
});

test("a flat feed (no orderId) yields standalone Observations", () => {
  const map = { patientId: "MRN", testName: "Test", value: "Value", unit: "Unit" };
  const b = normalizeCsvLab(ctx(map), parseDelimited("MRN,Test,Value,Unit\nP1,Glucose,90,mg/dL"));
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.observations.length, 1);
  assert.equal(b.diagnosticReports.length, 0);
});
