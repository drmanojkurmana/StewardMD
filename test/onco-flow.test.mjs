/* ONCQIS Phase D unit tests: the PURE builders of onco-plan-flow.js (derivePhenotype /
 * buildDigitalProtocol / renderFind / renderCompare / renderDigitalProtocol). No DOM: the flow's
 * dependencies (SMD_ONCORECOMMEND / SMD_ONCODOSE / SMD_ONCOUI / SMD_ONCOEV) are loaded as globals
 * first, exactly as the <script> order in index.html does in the browser.
 * node --test test/onco-flow.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
require(join(ROOT, "onco-dose.js"));        // sets globalThis.SMD_ONCODOSE
require(join(ROOT, "onco-evidence.js"));    // sets globalThis.SMD_ONCOEV
require(join(ROOT, "onco-recommend.js"));   // sets globalThis.SMD_ONCORECOMMEND
require(join(ROOT, "onco-protocols.js"));   // sets globalThis.SMD_ONCOUI
const FLOW = require(join(ROOT, "onco-plan-flow.js"));

const PROTO = {
  id: "fx-dlbcl", name: "FX R-CHOP-D", protocolVersion: "1.0", status: "ACTIVE",
  disease: "Diffuse large B-cell lymphoma", diseaseId: "dlbcl", stage: ["III", "IV"],
  biomarkers: { CD20: "positive" }, treatmentSetting: "curative-intent", treatmentIntent: ["curative"], lineOfTherapy: "first",
  regimen: { cycleLengthDays: 21, cycles: 3, drugs: [
    { id: "rituximab", name: "Rituximab", basis: "bsa", dosePerUnit: 375, unit: "mg/m2", route: "IV", days: [1], roundingRule: { increment: 50 } },
    { id: "prednisolone", name: "Prednisolone", basis: "flat", dosePerUnit: 100, unit: "mg", route: "PO", days: [1, 2, 3, 4, 5], cycles: [1] }
  ] },
  evidence: { core: [{ layer: "core", source: "DeVita 12th ed", evidenceStatus: "current" }] }
};
const CTX = {
  patient: { name: "Test Patient", mrn: "MR-1001" }, age: 55, sex: "female", heightCm: 165, weightKg: 60,
  diagnosis: "Diffuse large B-cell lymphoma", diseaseId: "dlbcl", stage: "III", biomarkers: { CD20: "positive" },
  treatmentSetting: "curative-intent", treatmentIntent: "curative", lineOfTherapy: "first"
};

test("derivePhenotype maps the ctx onto the recommend engine's keys", () => {
  const p = FLOW.derivePhenotype(CTX);
  assert.equal(p.diseaseId, "dlbcl");
  assert.equal(p.stage, "III");
  assert.equal(p.setting, "curative-intent");
  assert.equal(p.intent, "curative");
  assert.equal(p.line, "first");
  assert.deepEqual(p.biomarkers, { CD20: "positive" });
});

test("renderFind: honest empty state when no ACTIVE protocol applies (never fabricated)", () => {
  const html = FLOW.renderFind(FLOW.derivePhenotype(CTX), []);
  assert.match(html, /No applicable ACTIVE Standard Protocol - none published yet/);
});

test("renderFind: exactly one applicable -> the review-required header note", () => {
  const html = FLOW.renderFind(FLOW.derivePhenotype(CTX), [PROTO]);
  assert.match(html, /1 applicable protocol identified - review required/);
  assert.match(html, /Why suggested:/);
  assert.match(html, /Evidence status:/);
  assert.match(html, /data-of-act="select:fx-dlbcl"/);
});

test("buildDigitalProtocol computes patient-specific doses via SMD_ONCODOSE (never invented)", () => {
  const d = FLOW.buildDigitalProtocol(PROTO, FLOW.derivePhenotype(CTX), FLOW.deriveParams(CTX), CTX);
  assert.equal(d.patientName, "Test Patient");
  assert.equal(d.mrn, "MR-1001");
  assert.equal(d.cycles, 3);
  assert.ok(d.bsa > 1.6 && d.bsa < 1.7, "BSA computed");
  const ritux = d.lineages.find((l) => l.drugId === "rituximab");
  assert.equal(ritux.final, 600, "375 mg/m2 x ~1.65 = 618.75, rounded to nearest 50 -> 600 mg");
});

test("renderDigitalProtocol: Tata matrix + visible lineage + 'Not scheduled' + all 6 actions", () => {
  const d = FLOW.buildDigitalProtocol(PROTO, FLOW.derivePhenotype(CTX), FLOW.deriveParams(CTX), CTX);
  const html = FLOW.renderDigitalProtocol(d);
  assert.match(html, /PATIENT-SPECIFIC DIGITAL PROTOCOL/);
  assert.match(html, /oe-onco-tbl/, "reuses the SMD_ONCOUI Tata matrix");
  assert.match(html, /600 mg/, "patient-specific proposed dose in the matrix");
  assert.match(html, /Not scheduled/, "prednisolone absent from cycles 2 and 3");
  assert.match(html, /Dose lineage \(patient-specific\)/);
  assert.match(html, /protocol 375 mg\/m2.*proposed 600 mg/);
  ["edit", "viewcalc", "viewev", "compareguide", "print", "create"].forEach((a) => {
    assert.ok(html.indexOf('data-of-act="' + a + '"') >= 0, "action present: " + a);
  });
  assert.ok(!/[–—]/.test(html), "no en/em dashes in app-facing text");
});

test("renderCompare: side-by-side with regimen + cycle + evidence status", () => {
  const html = FLOW.renderCompare([PROTO]);
  assert.match(html, /COMPARE PROTOCOLS/);
  assert.match(html, /Rituximab/);
  assert.match(html, /Cycle length/);
  assert.match(html, /Evidence status/);
});
