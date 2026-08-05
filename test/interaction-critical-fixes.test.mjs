// test/interaction-critical-fixes.test.mjs - regression guards for the CRITICAL clinical DDI bugs found
// in the production QA pass (qa-report/clinical_safety.md CR1-CR3). Loads the REAL engine in node
// (window shim) and asserts the missed interactions now fire, the false alerts are gone, and the
// genuine opioid+benzodiazepine alert is preserved.
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

// ── CR1: warfarin + common antibiotics must be flagged ──
test("CR1: warfarin + ciprofloxacin is flagged", () => assert.ok(fires("warfarin", "ciprofloxacin")));
test("CR1: warfarin + metronidazole is flagged", () => assert.ok(fires("warfarin", "metronidazole")));
test("CR1: warfarin + co-trimoxazole is flagged", () => assert.ok(fires("warfarin", "co-trimoxazole")));
test("CR1: warfarin + amiodarone is flagged", () => assert.ok(fires("warfarin", "amiodarone")));
test("CR1: co-trimoxazole and cotrimoxazole behave identically (hyphen data bug fixed)", () => {
  assert.ok(fires("warfarin", "co-trimoxazole") && fires("warfarin", "cotrimoxazole"), "both spellings flag warfarin");
});

// ── CR2: colchicine + strong CYP3A4/P-gp inhibitor (fatal) must be flagged ──
test("CR2: colchicine + clarithromycin is flagged (contraindicated)", () => {
  assert.ok(fires("colchicine", "clarithromycin"), "must fire");
  assert.match(text("colchicine", "clarithromycin"), /contraindicated/);
});

// ── CR3: paracetamol/naloxone are NOT opioids/CNS-depressants -> no false alerts ──
test("CR3: paracetamol + diazepam produces NO interaction (was a false coma/respiratory alert)", () => {
  assert.equal(alerts("paracetamol", "diazepam").length, 0);
});
test("CR3: naloxone + diazepam produces NO interaction (naloxone is an antagonist, not an opioid)", () => {
  assert.equal(alerts("naloxone", "diazepam").length, 0);
});
test("CR3: paracetamol + morphine produces NO CNS-depressant duplication (false positive)", () => {
  assert.equal(alerts("paracetamol", "morphine").length, 0);
});

// ── REGRESSION: the genuine opioid + benzodiazepine alert must be preserved ──
test("REGRESSION: morphine + diazepam STILL fires the opioid+benzodiazepine alert", () => {
  assert.ok(fires("morphine", "diazepam"));
  assert.match(text("morphine", "diazepam"), /respiratory|sedation|central nervous/);
});
