// test/interaction-high-fixes.test.mjs - regression guards for the HIGH clinical DDI gaps
// (qa-report/clinical_safety.md H1-H6). Loads the real engine in node; asserts the missed tier-1
// interactions now fire, and that widening existing rules to classes did NOT drop or double the
// originals.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(fs.readFileSync(join(ROOT, "interaction-rules.js"), "utf8"))();
new Function(fs.readFileSync(join(ROOT, "interactions.js"), "utf8"))();

const BUCKETS = ["critical", "major", "moderate", "minor", "monitor", "duplicates", "combinations"];
function alerts(a, b) {
  const r = window.INTERACTIONS.checkInteractions([{ generic: a }, { generic: b }]) || {};
  return BUCKETS.flatMap((k) => (Array.isArray(r[k]) ? r[k] : []));
}
const fires = (a, b) => alerts(a, b).length > 0;

// H1 - azathioprine + xanthine-oxidase inhibitors (fatal myelosuppression)
test("H1: azathioprine + febuxostat is flagged", () => assert.ok(fires("azathioprine", "febuxostat")));
test("H1 regression: azathioprine + allopurinol still flagged", () => assert.ok(fires("azathioprine", "allopurinol")));

// H2 - digoxin + P-gp inhibitors
test("H2: digoxin + clarithromycin is flagged", () => assert.ok(fires("digoxin", "clarithromycin")));
test("H2 regression: digoxin + amiodarone still flagged (once, no double)", () => {
  assert.equal(alerts("digoxin", "amiodarone").length, 1);
});
test("H2 regression: digoxin + verapamil still flagged", () => assert.ok(fires("digoxin", "verapamil")));

// H3 - potassium-sparing diuretic + potassium supplement (hyperkalemia)
test("H3: spironolactone + potassium is flagged", () => assert.ok(fires("spironolactone", "potassium")));
test("H3: amiloride + potassium chloride is flagged", () => assert.ok(fires("amiloride", "potassium chloride")));

// H4 - lithium + thiazide/loop diuretic
test("H4: lithium + hydrochlorothiazide is flagged", () => assert.ok(fires("lithium", "hydrochlorothiazide")));
test("H4: lithium + furosemide is flagged", () => assert.ok(fires("lithium", "furosemide")));
test("H4 regression: lithium + lisinopril still flagged once (lisinopril no longer mis-tagged diuretic)", () => {
  assert.equal(alerts("lithium", "lisinopril").length, 1);
});

// H5 - anticoagulant + antiplatelet dual therapy (bleeding)
test("H5: warfarin + clopidogrel is flagged", () => assert.ok(fires("warfarin", "clopidogrel")));
test("H5: apixaban + aspirin is flagged", () => assert.ok(fires("apixaban", "aspirin")));
test("H5 regression: warfarin + aspirin still flagged", () => assert.ok(fires("warfarin", "aspirin")));

// H6 - DOAC + P-gp inhibitor (bleeding)
test("H6: apixaban + clarithromycin is flagged", () => assert.ok(fires("apixaban", "clarithromycin")));
test("H6: rivaroxaban + ketoconazole is flagged", () => assert.ok(fires("rivaroxaban", "ketoconazole")));
test("H6: dabigatran + verapamil is flagged", () => assert.ok(fires("dabigatran", "verapamil")));

// No-false-positive spot check
test("no-FP: amlodipine + paracetamol produces no interaction", () => {
  assert.equal(alerts("amlodipine", "paracetamol").length, 0);
});
