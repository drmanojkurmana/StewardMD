const assert = require("assert");
const M = require("../thorex-models.js");

// Test 1: makeAnalysis with 2 engines, clinicalEngine, learningEngine
const a = M.makeAnalysis({
  engines: [
    {
      engine: "torchxrayvision",
      educational: false,
      findings: [{ label: "Pneumonia", band: "High", severity: "severe", relevance: "x" }]
    },
    {
      engine: "xraydar",
      educational: true,
      findings: [{ label: "Cavity", band: "Medium", severity: "moderate", relevance: "y" }],
      disclaimer_key: "educational_not_clinical"
    }
  ]
});

assert.equal(a.engines.length, 2, "Should have 2 engines");
assert.equal(M.clinicalEngine(a).engine, "torchxrayvision", "Clinical engine should be torchxrayvision");
assert.equal(M.learningEngine(a).educational, true, "Learning engine should have educational===true");

// Test 2: band() thresholds
assert.equal(M.band(0.72), "High", "0.72 should be High");
assert.equal(M.band(0.60), "High", "0.60 should be High");
assert.equal(M.band(0.45), "Medium", "0.45 should be Medium");
assert.equal(M.band(0.30), "Medium", "0.30 should be Medium");
assert.equal(M.band(0.15), "Low", "0.15 should be Low");
assert.equal(M.band(0.10), "Low", "0.10 should be Low");
assert.equal(M.band(0.05), null, "0.05 should be null");
assert.equal(M.band(0.00), null, "0.00 should be null");

// Test 3: id and createdAt get filled when absent
assert.ok(a.id && typeof a.id === "string", "id should be filled");
assert.ok(a.createdAt && typeof a.createdAt === "string", "createdAt should be filled");

// Test 4: snake_case → camelCase mapping (disclaimer_key)
assert.equal(
  M.learningEngine(a).disclaimerKey,
  "educational_not_clinical",
  "disclaimer_key should map to disclaimerKey"
);

// Test 5: hasClinicalEngine
assert.equal(M.hasClinicalEngine(a), true, "Should have clinical engine");
const b = M.makeAnalysis({ engines: [{ engine: "only-learning", educational: true }] });
assert.equal(M.hasClinicalEngine(b), false, "Should not have clinical engine");

console.log("ok");
