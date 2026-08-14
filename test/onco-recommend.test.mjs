/* ONCQIS Phase B unit tests: onco-recommend.js recommend() is a PURE decision-SUPPORT function.
 * It suggests which ACTIVE Standard Protocols are APPLICABLE to a clinical phenotype and never
 * auto-selects or prescribes: it ALWAYS returns the full applicable list with reviewRequired:true,
 * even when exactly one applies. A protocol is excluded only when a concrete eligibility field
 * CONTRADICTS the phenotype; a VERIFY / missing field is surfaced in `unconfirmed`, never silently
 * matched or silently dropped. node --test test/onco-recommend.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { recommend } = require(join(ROOT, "onco-recommend.js"));

// ---- FIXTURE Standard Protocols (kb/schema/standard-protocol.schema.json shape) ----------------
const P_MATCH = {
  id: "fx-dlbcl-rchop", name: "FX R-CHOP", protocolVersion: "1.0", status: "ACTIVE",
  diseaseId: "dlbcl", stage: ["III", "IV"], biomarkers: { CD20: "positive" },
  treatmentSetting: "curative-intent", treatmentIntent: ["curative"], lineOfTherapy: "first",
  evidence: { core: [{ layer: "core", source: "DeVita 12th ed", evidenceStatus: "current" }] }
};
const P_WRONG_DISEASE = {
  id: "fx-nsclc", name: "FX NSCLC regimen", protocolVersion: "1.0", status: "ACTIVE",
  diseaseId: "nsclc", stage: ["IV"], treatmentIntent: ["palliative"],
  evidence: { core: [{ layer: "core", source: "Harrison 22nd ed", evidenceStatus: "current" }] }
};
const P_VERIFY_BM = {
  id: "fx-verify-bm", name: "FX verify-biomarker", protocolVersion: "0.9", status: "ACTIVE",
  diseaseId: "dlbcl", stage: ["III", "IV"], biomarkers: { CD20: "positive", MYC: "VERIFY" },
  treatmentIntent: ["curative"],
  evidence: { core: [{ layer: "core", source: "ESMO", evidenceStatus: "unknown" }] }
};
const P_DRAFT = { // NOT ACTIVE -> never considered
  id: "fx-draft", name: "FX draft", protocolVersion: "0.1", status: "DRAFT",
  diseaseId: "dlbcl", treatmentIntent: ["curative"], evidence: { core: [{ layer: "core", source: "x" }] }
};

const PHENO = { diseaseId: "dlbcl", stage: "III", biomarkers: { CD20: "positive" }, intent: "curative", line: "first" };

test("matching phenotype -> protocol appears in applicable list", () => {
  const out = recommend(PHENO, [P_MATCH]);
  assert.equal(out.reviewRequired, true);
  const ids = out.applicable.map((a) => a.id);
  assert.ok(ids.includes("fx-dlbcl-rchop"));
  const hit = out.applicable.find((a) => a.id === "fx-dlbcl-rchop");
  assert.equal(hit.matched.disease, true);
  assert.equal(hit.matched.stage, true);
  assert.equal(hit.matched.biomarkers, true);
});

test("contradicting phenotype (wrong disease) -> excluded", () => {
  const out = recommend(PHENO, [P_MATCH, P_WRONG_DISEASE]);
  const ids = out.applicable.map((a) => a.id);
  assert.ok(!ids.includes("fx-nsclc"));
  assert.ok(ids.includes("fx-dlbcl-rchop"));
});

test("non-ACTIVE protocols are never considered", () => {
  const out = recommend(PHENO, [P_DRAFT]);
  assert.deepEqual(out.applicable, []);
  assert.equal(out.reviewRequired, true);
});

test("exactly one match -> still returned in a list, reviewRequired true, no auto-select", () => {
  const out = recommend(PHENO, [P_MATCH, P_WRONG_DISEASE, P_DRAFT]);
  assert.equal(out.applicable.length, 1);
  assert.equal(out.reviewRequired, true);
  // No pre-selection surface anywhere: no `selected` key, list is the only output.
  assert.equal(out.selected, undefined);
  assert.ok(Array.isArray(out.applicable));
});

test("VERIFY biomarker -> protocol appears with that field in `unconfirmed` (not matched, not dropped)", () => {
  const out = recommend(PHENO, [P_VERIFY_BM]);
  const hit = out.applicable.find((a) => a.id === "fx-verify-bm");
  assert.ok(hit, "protocol with a VERIFY biomarker must still be offered, not silently dropped");
  assert.ok(hit.unconfirmed.includes("biomarkers.MYC"), "the VERIFY field must be listed as unconfirmed");
  // A concrete matched marker still confirms; the VERIFY one keeps the biomarker dim unconfirmed.
  assert.equal(hit.matched.biomarkers, false);
});

test("missing phenotype field -> surfaced as unconfirmed, never a silent match or exclude", () => {
  const out = recommend({ diseaseId: "dlbcl" }, [P_MATCH]); // no stage/biomarkers/intent/line supplied
  const hit = out.applicable.find((a) => a.id === "fx-dlbcl-rchop");
  assert.ok(hit);
  assert.ok(hit.unconfirmed.includes("stage"));
  assert.ok(hit.unconfirmed.includes("intent"));
  assert.equal(hit.matched.disease, true);
});

test("rationale string is present and mentions review", () => {
  const hit = recommend(PHENO, [P_MATCH]).applicable[0];
  assert.equal(typeof hit.rationale, "string");
  assert.ok(hit.rationale.length > 0);
  assert.ok(/review/i.test(hit.rationale));
  assert.ok(!/[–—]/.test(hit.rationale), "no en/em dashes in app-facing text");
});

test("pure + deterministic: same inputs -> deep-equal output", () => {
  const a = recommend(PHENO, [P_MATCH, P_VERIFY_BM, P_WRONG_DISEASE]);
  const b = recommend(PHENO, [P_MATCH, P_VERIFY_BM, P_WRONG_DISEASE]);
  assert.deepEqual(a, b);
});
