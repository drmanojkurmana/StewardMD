/* Phase 8 P0 unit tests: Onco Home's categorized search (onco-home.js) stays PURE, deterministic
 * (no LLM, ever) and reuses the REAL app data sources — window.MEDCALC (calculators.js),
 * window.KB_ENRICHMENT (the real KB dist files), window.MEDDRUGS (drugs.js) — rather than any
 * duplicated/local copy of clinical content. Also smoke-tests onco-evidence.js's provenance builder.
 * node --test test/onco-home.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// Minimal window/document stubs so the real, unmodified browser-IIFE modules (calculators.js,
// drugs.js, the KB dist files, onco-home.js) can be require()'d in plain Node — same trick
// test/onco-ui.test.mjs and friends use for opd-emr.js/onco-protocols.js.
global.window = global;
if (!global.document) {
  global.document = {
    addEventListener: function () {},
    getElementById: function () { return null; },
    createElement: function () { return { classList: { add: function () {}, remove: function () {} }, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {}, querySelector: function () { return null; } }; },
    head: { appendChild: function () {} },
    body: { appendChild: function () {} },
    querySelectorAll: function () { return []; }
  };
}

require(join(ROOT, "calculators.js"));   // -> window.MEDCALC (405 calcs incl. ECOG/Khorana/Calvert)
require(join(ROOT, "drugs.js"));         // -> window.MEDDRUGS (ward formulary)
require(join(ROOT, "kb", "dist", "kb.core.js"));
require(join(ROOT, "kb", "dist", "kb.clinical.js"));
require(join(ROOT, "kb", "dist", "kb.enrichment.js"));
require(join(ROOT, "kb", "dist", "kb.enrichment.2.js"));   // Object.assigns onto window.KB_ENRICHMENT.byId

const OH = require(join(ROOT, "onco-home.js"));
const EV = require(join(ROOT, "onco-evidence.js"));

test("real MEDCALC/KB/MEDDRUGS globals are actually present (test would be vacuous otherwise)", () => {
  assert.ok(global.window.MEDCALC && typeof global.window.MEDCALC.list === "function", "window.MEDCALC.list missing");
  assert.ok(global.window.MEDDRUGS && typeof global.window.MEDDRUGS.searchIndex === "function", "window.MEDDRUGS.searchIndex missing");
  assert.ok(global.window.KB_ENRICHMENT && global.window.KB_ENRICHMENT.byId && Object.keys(global.window.KB_ENRICHMENT.byId).length > 1000, "KB_ENRICHMENT.byId looks empty/small");
});

test("empty query returns empty buckets (no curated content invented)", () => {
  const r = OH.search("");
  assert.deepEqual(r, { diseases: [], calculators: [], drugs: [], protocols: [] });
  assert.deepEqual(OH.search("   "), { diseases: [], calculators: [], drugs: [], protocols: [] });
});

test("no crash on an unknown/gibberish query — all buckets empty", () => {
  const r = OH.search("zzzznotarealclinicalterm12345");
  assert.deepEqual(r, { diseases: [], calculators: [], drugs: [], protocols: [] });
});

test('"khorana" -> the real Khorana calculator, from MEDCALC, not a local copy', () => {
  const r = OH.search("khorana");
  assert.equal(r.calculators.length, 1);
  assert.equal(r.calculators[0].id, "khorana");
  assert.match(r.calculators[0].title, /Khorana/);
  assert.equal(r.calculators[0].cat, "Oncology");
});

test('"ecog" matches the ECOG calculator by whole word (not a substring false-positive, e.g. inside "Recognition")', () => {
  const r = OH.search("ecog");
  const ids = r.calculators.map((c) => c.id);
  assert.ok(ids.includes("ecog"), "expected the ecog calculator: " + JSON.stringify(ids));
  assert.ok(!ids.includes("rosier"), "ROSIER's 'Recognition' must not false-positive-match 'ecog': " + JSON.stringify(ids));
});

test('"EGFR" (case-insensitive abbreviation) -> oncology KB diseases, incl. Lung cancer', () => {
  const r = OH.search("EGFR");
  assert.ok(r.diseases.length > 0, "expected at least one EGFR-related disease");
  assert.ok(r.diseases.some((d) => d.id === "lung_cancer"), "expected lung_cancer among EGFR hits: " + JSON.stringify(r.diseases.map((d) => d.id)));
});

test('"NSCLC" abbreviation resolves to lung cancer entries even via the synonym expansion path', () => {
  const r = OH.search("nsclc");
  assert.ok(r.diseases.some((d) => d.id === "lung_cancer"));
});

test('"lung" (plain word) -> disease results, every one drawn from the real oncology-tagged KB', () => {
  const r = OH.search("lung");
  assert.ok(r.diseases.length > 0);
  r.diseases.forEach((d) => { assert.ok(d.id && d.name, "every disease result must carry a real KB id/name"); });
});

test("a drug name (\"pantop\", a brand) -> the real Pantoprazole row from MEDDRUGS.searchIndex", () => {
  const r = OH.search("pantop");
  assert.ok(r.drugs.length >= 1);
  assert.ok(r.drugs.some((d) => d.generic === "Pantoprazole"));
});

test("a drug generic name (\"furosemide\") also matches via MEDDRUGS", () => {
  const r = OH.search("furosemide");
  assert.ok(r.drugs.some((d) => d.generic === "Furosemide"));
});

test("protocols bucket is always an array and never crashes before /kb/protocols/index.json has loaded (Node has no fetch)", () => {
  const r = OH.search("rchop");
  assert.ok(Array.isArray(r.protocols));
});

test("search never returns undefined buckets, whatever the input type", () => {
  [null, undefined, 123, {}, []].forEach((bad) => {
    const r = OH.search(bad);
    assert.ok(Array.isArray(r.diseases) && Array.isArray(r.calculators) && Array.isArray(r.drugs) && Array.isArray(r.protocols));
  });
});

// ---- onco-evidence.js: the shared provenance panel builder ----
test("onco-evidence: build() separates Patient data / Guideline knowledge / Clinical calculation / AI explanation", () => {
  assert.equal(EV.build([]), "", "no entries -> no panel (never a placeholder with nothing to say)");
  const calc = EV.forCalculator({ id: "khorana", title: "Khorana Score", cat: "Oncology", interpretation: "High risk" });
  assert.match(calc, /oev-calc/);
  assert.match(calc, /Clinical calculation/);
  const dis = EV.forDisease({ id: "lung_cancer", name: "Lung cancer", system: "Oncology / Pulmonary" });
  assert.match(dis, /oev-guideline/);
  assert.match(dis, /Guideline knowledge/);
  const pd = EV.forPatientData("Height 165 cm");
  assert.match(pd, /oev-patient/);
  assert.match(pd, /Patient data/);
  const ai = EV.forAI("MaiK: consider ondansetron for high emetogenic risk.");
  assert.match(ai, /oev-ai/);
  assert.match(ai, /AI explanation/);
});
