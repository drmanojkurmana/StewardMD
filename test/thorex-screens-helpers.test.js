/* test/thorex-screens-helpers.test.js — node smoke for the PURE helpers extracted from
 * thorex-screens.js: the confidence-band/severity-pill mapping and the panel-model builder that
 * drives the entitlement-aware dual-panel result screen. The DOM screens themselves (router,
 * SCREENS map, delegated click handling) are browser-verified in Task 9 — this file only exercises
 * the side-effect-free data shaping so a) the dual Clinical/Learning panel split and b) the mandatory
 * disclaimer text are locked down without a DOM.
 */
const assert = require("assert");
const H = require("../thorex-screens.js");
const M = require("../thorex-models.js");

// ── (a) a v2beta analysis (2 engines) yields TWO panel models; the learning one is flagged
//        educational:true AND noActions:true ──
const v2beta = M.makeAnalysis(M.samples.pneumonia); // torchxrayvision (clinical) + xraydar (educational)
const panels = H.buildPanelModels(v2beta);

assert.equal(panels.length, 2, "v2beta analysis should yield 2 panel models");

const learning = panels.find((p) => p.educational === true);
const clinical = panels.find((p) => p.educational === false);

assert.ok(learning, "should have a learning (educational) panel");
assert.ok(clinical, "should have a clinical (non-educational) panel");
assert.equal(learning.engine, "xraydar", "learning panel should be the xraydar engine");
assert.equal(learning.noActions, true, "learning panel must be flagged noActions:true");

// ── (b) the clinical (torchxrayvision) panel has noActions:false ──
assert.equal(clinical.engine, "torchxrayvision", "clinical panel should be the torchxrayvision engine");
assert.equal(clinical.noActions, false, "clinical panel must be flagged noActions:false");

// ── a free/v1 analysis (1 engine) yields exactly ONE panel model ──
const v1 = M.makeAnalysis({
  engines: [
    { engine: "torchxrayvision", educational: false, findings: [{ label: "No acute abnormality", band: null, severity: "stable", relevance: "screening" }] }
  ]
});
const onePanels = H.buildPanelModels(v1);
assert.equal(onePanels.length, 1, "v1 analysis should yield exactly 1 panel model");
assert.equal(onePanels[0].noActions, false, "the sole v1 panel must allow actions (not educational)");

// ── (c) the mandatory disclaimer string is present VERBATIM ──
const DISCLAIMER =
  "AI-generated findings are intended to assist qualified healthcare professionals and must always be interpreted in conjunction with clinical assessment, radiologist review where appropriate, laboratory findings and other investigations.";

assert.equal(H.MANDATORY_DISCLAIMER, DISCLAIMER, "MANDATORY_DISCLAIMER must match the spec text verbatim");
panels.forEach((p) => {
  assert.equal(p.disclaimerText, DISCLAIMER, "every panel model must carry the verbatim disclaimer text");
});

// ── severity-pill mapping: icon + label, never colour alone ──
assert.deepEqual(H.sevInfo("critical"), { label: "Critical", icon: "crisis_alert" });
assert.deepEqual(H.sevInfo("urgent"), { label: "Urgent", icon: "priority_high" });
assert.deepEqual(H.sevInfo("stable"), { label: "Stable", icon: "check_circle" });
assert.deepEqual(H.sevInfo("bogus-unknown"), H.sevInfo("info"), "unknown severities should fall back to info");

// ── confidence-band mapping: band words only, never a raw probability ──
assert.equal(H.bandToPct("High"), 86);
assert.equal(H.bandToPct("Medium"), 55);
assert.equal(H.bandToPct("Low"), 24);
assert.equal(H.bandToPct(null), null, "no band (e.g. a screening finding) should map to null, not a fabricated number");
assert.equal(H.bandToPct(undefined), null);

// ── each finding model carries the band label, never a synthesized percentage as visible text ──
const learningFinding = learning.findings[0];
assert.equal(learningFinding.confLabel, "Medium", "confLabel should be the band word");
assert.equal(learningFinding.confPct, 55, "confPct is the internal bar-width mapping, not a raw probability");

console.log("ok");
