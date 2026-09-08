// test/connect/onboard/csv-upload.test.mjs — Increment 2: self-service CSV upload path.
// A well-formed CSV -> valid SCCM bundle + right counts + PHI-free audit; a ragged CSV -> warnings, no crash;
// an oversized CSV -> rejected cleanly (before parse); the reused parser's DoS caps (wide-column / many-row)
// hold; RBAC mirrors the FHIR pull (connector:read, auditor denied). No outbound fetch (SSRF N/A).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { parseCsvUpload, inferColumnMap, CSV_MAX_BYTES } from "../../../functions/_connect/onboard/csv-upload.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const env = {};
const seedDb = (role = "admin") => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const deps = (db, id = "u1") => ({ db, identifyFn: async () => ({ id, guest: false }) });
const req = {};

// A typical lab export whose column names the auto-mapper recognizes with no manual mapping.
const CSV = ["MRN,Name,DOB,Sex,Order,Code,CodeSys,Test,Value,Unit,Low,High,Flag,Collected,Status",
  "P1,Jane Doe,1980-01-01,F,O9,718-7,LN,Hemoglobin,9.2,g/dL,13,17,L,2026-08-01,F",
  "P1,Jane Doe,1980-01-01,F,O9,2160-0,LN,Creatinine,1.1,mg/dL,0.6,1.3,,2026-08-01,F"].join("\n");

test("inferColumnMap maps common lab headers with no manual mapping", () => {
  const m = inferColumnMap(["MRN", "Test", "Value", "Unit", "Order", "Sex"]);
  assert.equal(m.patientId, "MRN");
  assert.equal(m.testName, "Test");
  assert.equal(m.value, "Value");
  assert.equal(m.unit, "Unit");
  assert.equal(m.orderId, "Order");
  assert.equal(m.sex, "Sex");
});

test("well-formed CSV -> valid SCCM bundle with the right counts + PHI-free audit", async () => {
  const db = seedDb();
  const res = await parseCsvUpload(deps(db), req, env, "t1", { csv: CSV });
  assert.equal(res.ok, true);
  assert.equal(res.rowsParsed, 2);
  assert.equal(res.columns.length, 15);
  assert.equal(validateBundle(res.bundle).ok, true);
  assert.equal(res.bundle.sccmVersion, "1.1");
  assert.equal(res.bundle.patient.gender, "female");
  assert.equal(res.bundle.observations.length, 2);
  assert.equal(res.bundle.observations[0].value.value, 9.2);
  assert.equal(res.bundle.diagnosticReports.length, 1);          // both rows share order O9

  const auditRows = db._tables.connect_audit_event || [];
  const parsedRow = auditRows.find((r) => r.action === "connect.onboard.csv-parsed");
  assert.ok(parsedRow, "a csv-parsed audit row is written");
  assert.equal(parsedRow.outcome, "ok");
  // PHI-free: no raw patient name / value / MRN / test name reaches the audit sink.
  // The TIMESTAMP is excluded from the scan. It is an ISO 8601 string whose seconds-and-millis field
  // (SS.mmm) can itself contain "9.2" — e.g. "...T10:19:59.234Z" — so scanning it failed this
  // assertion on roughly 1% of runs, reporting a PHI leak that was only ever a clock reading. A
  // timestamp is not PHI here; every field that could actually carry a value is still scanned.
  const blob = JSON.stringify(auditRows.map(({ ts, ...rest }) => rest));
  for (const phi of ["Jane", "Doe", "9.2", "Hemoglobin", "Creatinine"]) assert.equal(blob.includes(phi), false);
  // counts only (rows + per-resource-type) survive the audit ALLOW filter.
  const counts = JSON.parse(parsedRow.resource_counts);
  assert.equal(counts.rows, 2);
  assert.equal(counts.observations, 2);
});

test("ragged / malformed CSV surfaces warnings without crashing", async () => {
  const db = seedDb();
  const res = await parseCsvUpload(deps(db), req, env, "t1", { csv: "MRN,Test,Value\nP1,Hb,9.2\nP1,Creatinine" });
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.includes("ragged")), "ragged row is warned");
  assert.equal(res.bundle.observations.length, 2);               // warn-don't-drop
});

test("empty CSV is rejected as invalid (not a crash)", async () => {
  const db = seedDb();
  await assert.rejects(() => parseCsvUpload(deps(db), req, env, "t1", { csv: "   " }), (e) => e.klass === "invalid");
});

test("oversized CSV (past the byte cap) is rejected cleanly BEFORE parsing", async () => {
  const db = seedDb();
  const big = "col\n" + "x".repeat(CSV_MAX_BYTES);               // > 2MB
  await assert.rejects(() => parseCsvUpload(deps(db), req, env, "t1", { csv: big }), (e) => e.klass === "too-large");
  assert.equal((db._tables.connect_audit_event || []).length, 0); // nothing normalized / audited
});

test("DoS cap holds: a pathological WIDE header is column-capped (not O(cols x rows))", async () => {
  const db = seedDb();
  const HEADER_COLS = 20000, ROWS = 400;
  const csv = Array.from({ length: HEADER_COLS }, (_, i) => "c" + i).join(",") + "\n" +
    Array.from({ length: ROWS }, () => "v").join("\n");
  const res = await parseCsvUpload(deps(db), req, env, "t1", { csv });
  assert.equal(res.ok, true);
  assert.equal(res.columns.length, 512, "header capped to maxColumns");
  assert.ok(res.warnings.some((w) => w.includes("maxColumns")), "column-cap warned");
  assert.equal(res.rowsParsed, ROWS);
});

test("DoS cap holds: a many-row input is bounded by maxRows", async () => {
  const db = seedDb();
  const csv = "a\n" + Array.from({ length: 120000 }, () => "1").join("\n");   // > 100k rows, under 2MB
  const res = await parseCsvUpload(deps(db), req, env, "t1", { csv });
  assert.equal(res.ok, true);
  assert.ok(res.rowsParsed <= 100000, "rows bounded by maxRows");
  assert.ok(res.warnings.some((w) => w.includes("rows truncated")), "row-cap warned");
});

test("RBAC: an auditor may not view the parsed patient bundle (PHI), like the FHIR pull", async () => {
  const db = seedDb("auditor");
  await assert.rejects(() => parseCsvUpload(deps(db), req, env, "t1", { csv: CSV }));   // PermissionError
});

test("RBAC: a non-member actor is denied (fail-closed)", async () => {
  const db = seedDb();
  await assert.rejects(() => parseCsvUpload(deps(db, "intruder"), req, env, "t1", { csv: CSV }));
});
