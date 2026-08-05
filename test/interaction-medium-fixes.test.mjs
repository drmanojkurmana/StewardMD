// test/interaction-medium-fixes.test.mjs - regression guards for the MEDIUM clinical DDI items
// (qa-report/clinical_safety.md M1-M5, the DDI-engine subset). Loads the real engine in node; asserts
// the missed interactions now fire, the misclassification false-positives are gone (without dropping the
// genuine alert), and the additive-toxicity pairs fire.
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
const text = (a, b) => JSON.stringify(alerts(a, b)).toLowerCase();
function combos(a, b) {
  const r = window.INTERACTIONS.checkInteractions([{ generic: a }, { generic: b }]) || {};
  return Array.isArray(r.combinations) ? r.combinations : [];
}

// M1 - amiodarone + CYP3A4-metabolised statin (myopathy; FDA dose caps)
test("M1: amiodarone + simvastatin is flagged", () => assert.ok(fires("amiodarone", "simvastatin")));
test("M1: amiodarone + atorvastatin is flagged", () => assert.ok(fires("amiodarone", "atorvastatin")));
test("M1: amiodarone + lovastatin is flagged", () => assert.ok(fires("amiodarone", "lovastatin")));

// M2 - narrow-therapeutic-index CYP victims
test("M2: carbamazepine + clarithromycin is flagged (CYP3A4 -> carbamazepine toxicity)", () => assert.ok(fires("carbamazepine", "clarithromycin")));
test("M2: phenytoin + fluconazole is flagged (CYP2C9 -> phenytoin toxicity)", () => assert.ok(fires("phenytoin", "fluconazole")));
test("M2: theophylline + ciprofloxacin is flagged (CYP1A2 -> theophylline toxicity)", () => assert.ok(fires("theophylline", "ciprofloxacin")));
test("M2 bonus: warfarin + fluconazole is flagged (fluconazole is a CYP2C9 inhibitor)", () => assert.ok(fires("warfarin", "fluconazole")));

// M3 - misclassification false-positives removed WITHOUT dropping the genuine alert
test("M3: clozapine + morphine no longer fires the opioid+benzodiazepine coma/death alert", () => {
  assert.equal(combos("clozapine", "morphine").length, 0);            // clozapine is not a benzodiazepine
  assert.doesNotMatch(text("clozapine", "morphine"), /coma and death/);
});
test("M3 regression: morphine + diazepam STILL fires the opioid+benzodiazepine alert", () => {
  assert.ok(combos("morphine", "diazepam").length >= 1);
});
test("M3: clozapine + morphine still fires an additive CNS-depression alert (via cns_depressant)", () => {
  assert.ok(fires("clozapine", "morphine"));
});
test("M3: clozapine + diazepam still fires (genuine additive CNS depression preserved)", () => {
  assert.ok(fires("clozapine", "diazepam"));
});
test("M3: clarithromycin + verapamil still fires after the DHP mis-tag removal (non-DHP CCB rule)", () => {
  assert.ok(fires("clarithromycin", "verapamil"));
});
test("M3 bonus: clarithromycin + diltiazem now fires (non-DHP CCB, previously missed)", () => {
  assert.ok(fires("clarithromycin", "diltiazem"));
});

// M5 - additive-toxicity pairs
test("M5: prednisolone + ibuprofen is flagged (GI ulceration/bleeding)", () => assert.ok(fires("prednisolone", "ibuprofen")));
test("M5: insulin glargine + glimepiride is flagged (hypoglycaemia)", () => assert.ok(fires("insulin glargine", "glimepiride")));
test("M5: bare 'insulin' now resolves and flags insulin + glimepiride (was unclassified -> missed)", () => assert.ok(fires("insulin", "glimepiride")));
test("M5: furosemide + gentamicin is flagged (oto/nephrotoxicity)", () => assert.ok(fires("furosemide", "gentamicin")));

// No-false-positive spot checks
test("no-FP: metformin + glimepiride produces no interaction (standard dual therapy)", () => {
  assert.equal(alerts("metformin", "glimepiride").length, 0);
});
test("no-FP: amlodipine + atorvastatin produces no spurious interaction", () => {
  assert.equal(alerts("amlodipine", "atorvastatin").length, 0);
});
