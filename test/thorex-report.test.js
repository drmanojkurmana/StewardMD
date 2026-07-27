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

// ── all sections present (Clinical information, Technique, Image quality, Findings, Impression,
//    Differential diagnosis, Recommendations, Urgency, Follow-up) ──
assert.equal(report.order.length, 9, "buildReport should expose all 9 report sections in `order`");
report.order.forEach((key) => {
  assert.ok(report.sections[key], `section "${key}" should be present`);
  assert.ok(report.sections[key].title, `section "${key}" should have a title`);
});

assert.equal(report.sections.clinicalInformation.text, "Cough and fever x3 days.", "Clinical information should reflect opts.context");

// ── The unified radiology report is brand-neutral: "ThoreX AI" only, no raw engine/model names ──
assert.ok(/ThoreX AI/.test(report.sections.technique.text), "Technique should present the report as ThoreX AI");
assert.ok(!/TorchXRayVision|DenseNet|xraydar|X-Raydar|Hugging/i.test(report.html), "the unified report must not leak raw engine/model names — ThoreX AI branding only");

// ── Differential diagnosis: ranked considerations, each with the AI confidence %, + correlation advised ──
assert.ok(report.sections.differential.items.length >= 1, "Differential should list the clinical considerations");
assert.equal(report.sections.differential.items[0].confPct, 89, "top differential should carry its AI confidence % (0.89 -> 89)");
assert.ok(/Differential diagnosis/i.test(report.html), "html should render the Differential diagnosis section");
assert.ok(/89%/.test(report.html), "html should show the AI confidence percentage");
assert.ok(/Clinical correlation advised/i.test(report.html), "Differential must append 'Clinical correlation advised.'");

// ── Findings carry the exact AI confidence % threaded from the model ──
assert.equal(report.sections.findings.items[0].confPct, 89, "Findings should carry the exact AI confidence % (0.89 -> 89)");

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
// consolidation 0.89 (>75% -> working diagnosis) leads; air bronchogram 0.71 (50-75% -> consideration)
assert.ok(report.sections.impression.text.startsWith("Findings support Right lower lobe consolidation (>75% AI confidence)"), "Impression should lead with the >75% finding as a working diagnosis");
assert.ok(/Differential consideration: Air bronchogram \(50–75% AI confidence\)/.test(report.sections.impression.text), "Impression should tier the 50-75% finding as a differential consideration");
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
assert.ok(report.sections.educational.items.some((it) => it.label === "Bilateral lower lobe interstitial opacities"));

// ── the mandatory disclaimer is present VERBATIM in `text` ──
const DISCLAIMER =
  "AI-generated findings are intended to assist qualified healthcare professionals and must always be interpreted in conjunction with clinical assessment, radiologist review where appropriate, laboratory findings and other investigations.";
assert.equal(R.MANDATORY_DISCLAIMER, DISCLAIMER, "MANDATORY_DISCLAIMER must match the spec text verbatim");
assert.ok(report.text.indexOf(DISCLAIMER) >= 0, "the rendered text report must contain the mandatory disclaimer verbatim");
// The in-app report FRAGMENT no longer repeats the disclaimer (the result screen shows it ONCE at its
// footer); the standalone text report + the professional export document still carry it.
assert.ok(report.html.indexOf(DISCLAIMER) < 0, "the in-app report html must NOT repeat the disclaimer (deduped to the screen footer)");

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
assert.ok(lowReport.sections.impression.text.startsWith("No finding reached a confidence level suggesting an acute abnormality — the study may be normal."), "a low-band-only analysis should read as possibly-normal");
assert.equal(lowReport.sections.urgency.text, "Routine.", "a low/info-only analysis should be Routine urgency");

// ── a fully empty analysis (no engines at all) must not crash and still produces a safe report ──
const emptyReport = R.buildReport(M.makeAnalysis({}));
assert.equal(emptyReport.sections.findings.items.length, 0);
assert.ok(emptyReport.sections.impression.text.startsWith("No finding reached a confidence level suggesting an acute abnormality — the study may be normal."));
assert.equal(emptyReport.sections.recommendations.items.length, 1, "no findings should yield exactly the generic fallback recommendation");
assert.ok(emptyReport.text.indexOf(DISCLAIMER) >= 0);
assert.equal(emptyReport.sections.clinicalInformation.text, "Not provided", "Clinical information should default to 'Not provided' with no opts.context");

// ── sign-vs-diagnosis relabel: the model's "Emphysema" head fires on hyperinflation; the report must
//    present the SIGN, never assert the diagnosis "Emphysema" bare (hyperinflated ≠ emphysema) ──
const emphysemaReport = R.buildReport(M.makeAnalysis({
  engines: [
    { engine: "torchxrayvision", educational: false, findings: [{ label: "Emphysema", prob: 0.72, band: "Medium", severity: "warn", relevance: "Hyperinflation/lucency." }] }
  ],
  quality: { view: "PA upright", adequate: true, issues: [] }
}));
assert.equal(emphysemaReport.sections.findings.items[0].label, "Hyperinflation (possible emphysema)", "'Emphysema' must be reframed as the radiographic sign (hyperinflation)");
assert.ok(/Hyperinflation/.test(emphysemaReport.html) && !/>Emphysema</.test(emphysemaReport.html), "report must show Hyperinflation, never assert bare Emphysema");
assert.equal(M.displayLabel("Emphysema"), "Hyperinflation (possible emphysema)", "models.displayLabel should reframe Emphysema");
assert.equal(M.displayLabel("Pneumothorax"), "Pneumothorax", "displayLabel should pass through labels with no reframe");

// ── differential diagnosis maps a radiographic finding to candidate DISEASES incl. infections ──
const cavityReport = R.buildReport(M.makeAnalysis({
  engines: [
    { engine: "torchxrayvision", educational: false, findings: [{ label: "Cavity", prob: 0.82, band: "High", severity: "urgent", relevance: "Cavitating lesion." }] }
  ]
}));
const cavityDdx = cavityReport.sections.differential.items[0];
assert.ok(cavityDdx.dx && /lung abscess/i.test(cavityDdx.dx) && /tuberculosis/i.test(cavityDdx.dx), "a cavity's differential must include lung abscess + TB");
assert.ok(/Consider:.*lung abscess/i.test(cavityReport.html), "the report html must render the disease differential for the cavity");
const cavityPro = R.buildProDocument(M.makeAnalysis({
  engines: [{ engine: "torchxrayvision", educational: false, findings: [{ label: "Cavity", prob: 0.82, band: "High", severity: "urgent" }] }]
}), {});
assert.ok(/lung abscess/i.test(cavityPro), "the exported PDF document must include the disease differential");

// ── confidence tiers: a lone 50% (operating-point) finding must read "may be normal", NOT a diagnosis ──
const fiftyReport = R.buildReport(M.makeAnalysis({
  engines: [
    { engine: "torchxrayvision", educational: false, findings: [{ label: "Infiltration", prob: 0.50, band: "Low", severity: "info", relevance: "Correlate clinically." }] }
  ],
  quality: { view: "PA upright", adequate: true, issues: [] }
}));
assert.ok(/the study may be normal/.test(fiftyReport.sections.impression.text), "a 50% finding should read as possibly normal");
assert.ok(!/working diagnosis/.test(fiftyReport.sections.impression.text), "a 50% finding must never be called a working diagnosis");

// ── a >75% finding is tiered as a working diagnosis ──
const highReport = R.buildReport(M.makeAnalysis({
  engines: [
    { engine: "torchxrayvision", educational: false, findings: [{ label: "Pneumothorax", prob: 0.83, band: "High", severity: "urgent", relevance: "Urgent." }] }
  ]
}));
assert.ok(/Findings support Pneumothorax \(>75% AI confidence\) — may be read as a working diagnosis/.test(highReport.sections.impression.text), ">75% should read as a working diagnosis");

// ── engineScope: report can be built from Engine 1 (clinical), Engine 2 (educational), or both ──
const clinOnly = R.buildReport(analysis, { engineScope: "clinical" });
assert.ok(clinOnly.sections.findings.items.some((f) => f.label === "Right lower lobe consolidation"), "clinical scope uses Engine 1 findings");
assert.ok(!clinOnly.sections.findings.items.some((f) => f.label === "Bilateral lower lobe interstitial opacities"), "clinical scope must not pull Engine 2 findings into Findings");
const eduOnly = R.buildReport(analysis, { engineScope: "educational" });
assert.ok(eduOnly.sections.findings.items.some((f) => f.label === "Bilateral lower lobe interstitial opacities"), "educational scope uses Engine 2 findings");
assert.ok(/Clinical Engine 2/.test(eduOnly.sections.technique.text), "educational scope names Engine 2 in Technique");
const bothScope = R.buildReport(analysis, { engineScope: "both" });
const bothLabels = bothScope.sections.findings.items.map((f) => f.label);
assert.ok(bothLabels.includes("Right lower lobe consolidation") && bothLabels.includes("Bilateral lower lobe interstitial opacities"), "both scope merges Engine 1 + Engine 2 findings");
assert.ok(/Engine 1 \+ 2/.test(bothScope.sections.technique.text), "both scope names Engine 1 + 2 in Technique");

// ── professional print/PDF document: self-contained branded HTML, warning + branding + embedded X-ray ──
const proDoc = R.buildProDocument(analysis, { context: "62M smoker, breathless", logoDataUrl: "data:image/png;base64,AAAA", xrayDataUrl: "data:image/png;base64,BBBB", createdAt: "2026-07-27" });
assert.ok(/^<!doctype html>/i.test(proDoc), "buildProDocument returns a full HTML document");
assert.ok(/StewardMD/.test(proDoc) && /AI CHEST X-RAY SCREENING REPORT/.test(proDoc), "pro doc has StewardMD branding + report title");
assert.ok(/#0f766e/.test(proDoc), "pro doc uses the teal brand colour for borders");
assert.ok(proDoc.indexOf("data:image/png;base64,AAAA") >= 0, "pro doc embeds the logo data-URI");
assert.ok(proDoc.indexOf("data:image/png;base64,BBBB") >= 0, "pro doc embeds the X-ray data-URI");
assert.ok(/IMPORTANT — AI-generated screening, not a diagnosis/.test(proDoc) && proDoc.indexOf(DISCLAIMER) >= 0, "pro doc carries the warning + mandatory disclaimer");
assert.ok(/62M smoker, breathless/.test(proDoc), "pro doc shows the clinical context");
assert.ok(/Findings support Right lower lobe consolidation/.test(proDoc), "pro doc carries the tiered impression");
// AI best-fit diagnosis (from the LLM) is embedded in the exported document when provided
const proDocAi = R.buildProDocument(analysis, { aiDdx: "1. Lung abscess — cavity + fever + foul sputum.\n2. Necrotizing pneumonia." });
assert.ok(/AI best-fit diagnosis \(correlated with history\)/.test(proDocAi), "pro doc includes the AI best-fit section when aiDdx provided");
assert.ok(/Lung abscess/.test(proDocAi) && /MaiK AI/.test(proDocAi), "pro doc renders the AI text + MaiK AI branding");
assert.ok(!/gemini|groq/i.test(proDocAi), "pro doc must not leak the raw LLM provider name");
// no AI section when none provided
assert.ok(!/AI best-fit diagnosis/.test(R.buildProDocument(analysis, {})), "no AI section when aiDdx absent");

// degrades cleanly with no logo/xray
const proDoc2 = R.buildProDocument(analysis, {});
assert.ok(/^<!doctype html>/i.test(proDoc2) && /StewardMD/.test(proDoc2), "pro doc still valid with no logo/xray/context");

console.log("ok");
