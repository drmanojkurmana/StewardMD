/* Phase 6 unit tests: the printable Protocol PDF builder (onco-protocol-report.js) stays PURE (no
 * DOM, no fetch) and - the non-negotiable safety guarantee this file exists to prove - renders doses
 * read verbatim off the plan/cycle, never recomputed via onco-dose.js. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const REPORT_PATH = join(ROOT, "onco-protocol-report.js");

const REPORT = require(REPORT_PATH);
const RCHOP = require(join(ROOT, "kb", "protocols", "rchop.json"));
const DOSE = require(join(ROOT, "onco-dose.js"));

function fixturePlan() {
  const params = { height: 165, weight: 60, age: 55, sex: "female" };
  const calculatedDoses = DOSE.planDoses(RCHOP, params);
  return {
    planId: "TP-fixture", protocolId: RCHOP.id, lockedVersion: RCHOP.version, lockedTemplate: RCHOP,
    ghisPatientId: "MRN-900", intent: "curative", patientParams: params,
    plannedCycles: RCHOP.cycles, plannedDates: [Date.UTC(2026, 7, 20)],
    calculatedDoses: calculatedDoses, confirmedDoses: calculatedDoses,
    physicianModifications: [], confirmations: [{ by: "dr-1", at: Date.UTC(2026, 7, 19) }],
    status: "active", createdAt: Date.UTC(2026, 7, 19),
  };
}
function fixtureCycle(plan) {
  const rituximabDose = plan.confirmedDoses.filter((d) => d.drugId === "rituximab")[0];
  return {
    cycleId: "TP-fixture__1", planId: "TP-fixture", cycleNo: 1, day: 1, state: "ready",
    plannedDate: Date.UTC(2026, 7, 20),
    clearance: { status: "cleared", checks: [{ name: "CBC/platelets", status: "ok" }], resolvedBy: "dr-1", resolvedAt: Date.UTC(2026, 7, 19) },
    confirmedDoses: plan.confirmedDoses,
    administrationSequence: [
      { id: "a1", cycleId: "TP-fixture__1", planId: "TP-fixture", drugId: "rituximab", planned: rituximabDose,
        actual: rituximabDose.final, route: "IV", startTime: Date.UTC(2026, 7, 20, 9, 0), endTime: Date.UTC(2026, 7, 20, 11, 0),
        administeredBy: "nurse-1", reaction: "none", status: "administered", createdAt: Date.UTC(2026, 7, 20, 9, 0) },
    ],
  };
}

test("onco-protocol-report.js NEVER references the dose engine - no 'onco-dose' / 'SMD_ONCODOSE' anywhere in its own source (the PDF never recomputes)", () => {
  const src = readFileSync(REPORT_PATH, "utf8");
  assert.ok(!/onco-dose/i.test(src), "onco-protocol-report.js must not import/require onco-dose.js");
  assert.ok(!/SMD_ONCODOSE/.test(src), "onco-protocol-report.js must not reference window.SMD_ONCODOSE");
});

test("buildProtocolSheet returns a full HTML document with two pages, the drug x cycle matrix, and the safety disclaimer", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle(plan);
  const html = REPORT.buildProtocolSheet(plan, { cycle: cycle, patientName: "Jane Doe", diagnosis: "Diffuse large B-cell lymphoma" });

  assert.ok(html.indexOf("<!doctype html>") === 0, "starts with the doctype");
  assert.ok(html.indexOf("</html>") > 0, "closes the document");

  const pageMatches = html.match(/<div class="page/g) || [];
  assert.equal(pageMatches.length, 2, "exactly two .page blocks (page 1 and page 2)");

  RCHOP.drugs.forEach((d) => assert.ok(html.indexOf(d.name) >= 0, "matrix shows drug " + d.name));
  for (let c = 1; c <= RCHOP.cycles; c++) assert.ok(html.indexOf("Cycle " + c) >= 0, "matrix has a column for cycle " + c);

  assert.ok(html.indexOf("Jane Doe") >= 0, "patient name rendered");
  assert.ok(html.indexOf("MRN-900") >= 0, "MRN rendered");
  assert.ok(html.indexOf("Diffuse large B-cell lymphoma") >= 0, "diagnosis rendered");

  assert.ok(html.indexOf(REPORT.MANDATORY_DISCLAIMER) >= 0, "carries the exact mandatory safety disclaimer");
  assert.ok(html.indexOf("decision-support") >= 0, "disclaimer names decision-support software");
  assert.ok(html.indexOf("reviewed and confirmed by the responsible clinician") >= 0, "disclaimer requires clinician review");
});

test("single source of truth: every rendered dose number equals the fixture plan's confirmedDoses[].final exactly (no recomputation)", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle(plan);
  const html = REPORT.buildProtocolSheet(plan, { cycle: cycle });

  plan.confirmedDoses.forEach((d) => {
    assert.ok(d.final != null, "fixture sanity: " + d.drugId + " has a computed final dose");
    assert.ok(html.indexOf(d.final + " mg") >= 0, d.drugId + "'s confirmed dose (" + d.final + " mg) appears verbatim");
  });
});

test("no cycle supplied: page 2 still renders (2 pages) without crashing, and says no cycle exists yet", () => {
  const plan = fixturePlan();
  const html = REPORT.buildProtocolSheet(plan, { patientName: "Jane Doe" });
  const pageMatches = html.match(/<div class="page/g) || [];
  assert.equal(pageMatches.length, 2, "still two pages with no cycle");
  assert.ok(html.indexOf("No cycle has been created for this treatment plan yet.") >= 0);
});

test("no em dash or en dash anywhere in the generated document", () => {
  const plan = fixturePlan();
  const cycle = fixtureCycle(plan);
  const html = REPORT.buildProtocolSheet(plan, { cycle: cycle, patientName: "Jane Doe", diagnosis: "DLBCL" });
  assert.ok(html.indexOf("—") < 0, "no em dash");
  assert.ok(html.indexOf("–") < 0, "no en dash");
});

test("no invented content: escapes a malicious drug name and never fabricates a dose when none is on file", () => {
  const plan = fixturePlan();
  plan.confirmedDoses = [];
  plan.calculatedDoses = [];
  plan.lockedTemplate = Object.assign({}, RCHOP, { drugs: [Object.assign({}, RCHOP.drugs[0], { name: "<img src=x onerror=alert(1)>" })] });
  const html = REPORT.buildProtocolSheet(plan, {});
  assert.ok(html.indexOf("<img") < 0, "raw tag never lands in the output");
  assert.ok(html.indexOf("&lt;img") >= 0, "escaped instead");
  assert.ok(html.indexOf(">verify<") >= 0, "an unmatched drug shows verify, never a guessed number");
});
