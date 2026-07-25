/* test/thorex-report.test.js — node smoke for the deterministic structured-report generator
 * (thorex-report.js). Builds a 2-engine (v2beta) analysis via SMD_THOREX_MODELS.makeAnalysis and
 * exercises buildReport() headlessly (no DOM) — mirrors the style of
 * test/thorex-screens-helpers.test.js.
 */
const assert = require("assert");
const M = require("../thorex-models.js");
const R = require("../thorex-report.js");

// ── the canonical pneumonia sample: torchxrayvision (clinical, High+Medium) + xraydar (educational) ──
const analysis = M.makeAnalysis(M.samples.pneumonia);
const report = R.buildReport(analysis, { context: "Cough and fever x3 days." });

// ── all sections present (the spec enumerates 8: Clinical information, Technique, Image quality,
//    Findings, Impression, Recommendations, Urgency, Follow-up) ──
assert.equal(report.order.length, 8, "buildReport should expose all 8 spec sections in `order`");
report.order.forEach((key) => {
  assert.ok(report.sections[key], `section "${key}" should be present`);
  assert.ok(report.sections[key].title, `section "${key}" should have a title`);
});

assert.equal(report.sections.clinicalInformation.text, "Cough and fever x3 days.", "Clinical information should reflect opts.context");

// ── Technique reflects what actually ran (torchxrayvision on-device model) ──
assert.ok(/TorchXRayVision DenseNet-121/.test(report.sections.technique.text), "Technique should name the on-device model that actually ran");

// ── Image quality reflects analysis.quality (PA upright, adequate) ──
assert.ok(/PA upright/.test(report.sections.imageQuality.text), "Image quality should mention the reported view");
assert.ok(/Adequate/.test(report.sections.imageQuality.text), "Image quality should say adequate when quality.adequate is true");

// ── Findings: only clinical (torchxrayvision) findings, ordered High -> Medium -> Low ──
assert.equal(report.sections.findings.items.length, 2, "Findings should only include the clinical engine's findings (2), not the educational engine's");
assert.equal(report.sections.findings.items[0].band, "High", "the first finding should be the High-band one");
assert.equal(report.sections.findings.items[0].label, "Right lower lobe consolidation");
assert.equal(report.sections.findings.items[1].band, "Medium");
const eduLabels = report.sections.findings.items.map((f) => f.label);
assert.ok(!eduLabels.includes("Bilateral lower lobe interstitial opacities"), "educational findings must never appear in the clinical Findings section");

// ── Impression leads with the High-band finding ──
assert.ok(report.sections.impression.text.startsWith("High-confidence: Right lower lobe consolidation."), "Impression should lead with the High-band finding");
assert.ok(!/Bilateral lower lobe interstitial opacities/.test(report.sections.impression.text), "Impression must never be driven by the educational engine's findings");

// ── Recommendations reflect the consolidation/pneumonia finding, and never the educational engine ──
assert.ok(report.sections.recommendations.items.some((r) => /antibiotics|stewardship|WBC/i.test(r)), "Recommendations should include a pneumonia/consolidation-driven recommendation");
assert.ok(!/Bilateral lower lobe interstitial opacities/.test(report.sections.recommendations.items.join(" ")), "Recommendations must never be driven by the educational engine's findings");

// ── Urgency: the worst clinical severity is "urgent" -> "Urgent — correlate immediately." ──
assert.equal(report.sections.urgency.text, "Urgent — correlate immediately.", "Urgency should reflect the worst clinical severity (urgent)");
assert.ok(!/Urgent/.test(report.sections.urgency.text) || report.sections.urgency.bucket === "urgent");

// ── Follow-up is present and non-empty ──
assert.ok(report.sections.followUp.text && report.sections.followUp.text.length > 0, "Follow-up should always be a non-empty deterministic string");

// ── Educational engine is surfaced ONLY in a clearly-labelled appendix, never driving the clinical sections ──
assert.ok(report.sections.educational, "an educational appendix should be present when a learning engine has findings");
assert.equal(report.sections.educational.title, "Educational (not for clinical use)");
assert.equal(report.sections.educational.engine, "xraydar");
assert.ok(report.sections.educational.items.some((it) => it.label === "Bilateral lower lobe interstitial opacities"));

// ── the mandatory disclaimer is present VERBATIM in `text` ──
const DISCLAIMER =
  "AI-generated findings are intended to assist qualified healthcare professionals and must always be interpreted in conjunction with clinical assessment, radiologist review where appropriate, laboratory findings and other investigations.";
assert.equal(R.MANDATORY_DISCLAIMER, DISCLAIMER, "MANDATORY_DISCLAIMER must match the spec text verbatim");
assert.ok(report.text.indexOf(DISCLAIMER) >= 0, "the rendered text report must contain the mandatory disclaimer verbatim");
assert.ok(report.html.indexOf(DISCLAIMER) >= 0, "the rendered html report must contain the mandatory disclaimer verbatim");

// ── html is a `.tx-report` block ──
assert.ok(/class="tx-report"/.test(report.html), "html should render a .tx-report container");

// ── an empty/low analysis yields the "no high-confidence" impression, and never crashes ──
const lowAnalysis = M.makeAnalysis({
  engines: [
    { engine: "torchxrayvision", educational: false, findings: [{ label: "Mild atelectasis", band: "Low", severity: "info", relevance: "minor" }] }
  ],
  quality: { view: "PA upright", adequate: true, issues: [] }
});
const lowReport = R.buildReport(lowAnalysis);
assert.ok(lowReport.sections.impression.text.startsWith("No high-confidence acute abnormality flagged by the AI."), "a low-band-only analysis should yield the no-high-confidence impression");
assert.equal(lowReport.sections.urgency.text, "Routine.", "a low/info-only analysis should be Routine urgency");

// ── a fully empty analysis (no engines at all) must not crash and still produces a safe report ──
const emptyReport = R.buildReport(M.makeAnalysis({}));
assert.equal(emptyReport.sections.findings.items.length, 0);
assert.ok(emptyReport.sections.impression.text.startsWith("No high-confidence acute abnormality flagged by the AI."));
assert.equal(emptyReport.sections.recommendations.items.length, 1, "no findings should yield exactly the generic fallback recommendation");
assert.ok(emptyReport.text.indexOf(DISCLAIMER) >= 0);
assert.equal(emptyReport.sections.clinicalInformation.text, "Not provided", "Clinical information should default to 'Not provided' with no opts.context");

console.log("ok");
