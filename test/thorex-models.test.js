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

// Test 2: band() thresholds — anchored to the model's OPERATING POINT (op-normalized so 0.5 == the
// pathology's operating threshold): >=0.80 High, >=0.65 Medium, >=0.50 Low, below the op-point null
// (finding is negative → not shown). Kept in sync with thorex-models.js band().
assert.equal(M.band(0.85), "High", "0.85 should be High");
assert.equal(M.band(0.80), "High", "0.80 (High threshold) should be High");
assert.equal(M.band(0.72), "Medium", "0.72 should be Medium");
assert.equal(M.band(0.65), "Medium", "0.65 (Medium threshold) should be Medium");
assert.equal(M.band(0.55), "Low", "0.55 should be Low");
assert.equal(M.band(0.50), "Low", "0.50 (operating point) should be Low");
assert.equal(M.band(0.49), null, "0.49 (below operating point) should be null");
assert.equal(M.band(0.10), null, "0.10 should be null");
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
