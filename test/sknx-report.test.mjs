import { test } from "node:test";
import assert from "node:assert";
import REPORT from "../sknx-report.js";
import LLM from "../sknx-llm.js";
import EVID from "../sknx-evidence.js";

async function buildSamplePayload() {
  var evidence = EVID.retrieve(["psoriasis"]);
  return LLM.buildReport({
    analysis: { differential: [{ label: "psoriasis", prob: 0.72, band: "high" }], referral: false },
    features: { diameterMm: 20, borderIrregular: true },
    evidence: evidence,
    context: {}
  });
}

test("html() renders every required section heading and the disclaimer text", async () => {
  const payload = await buildSamplePayload();
  const h = REPORT.html(payload);

  assert.match(h, /Visual findings/i);
  assert.match(h, /Differential/i);
  assert.match(h, /Guideline/i);
  assert.match(h, /Investigations/i);
  assert.match(h, /Management/i);
  assert.match(h, /Follow.?up/i);
  assert.match(h, /References/i);
  assert.ok(h.indexOf(payload.disclaimer) !== -1, "disclaimer text should appear verbatim in the rendered html");
});

test("html() renders a clickable citation href for every guidelineSummary entry", async () => {
  const payload = await buildSamplePayload();
  const h = REPORT.html(payload);

  assert.ok(payload.guidelineSummary.length >= 1, "fixture should retrieve at least one guideline entry");
  for (const g of payload.guidelineSummary) {
    assert.ok(h.indexOf('href="' + g.url + '"') !== -1, "expected href for url " + g.url);
  }
  assert.match(h, /<a /);
});

test("html() never contains sknx-rx, prescription, or prescribe", async () => {
  const payload = await buildSamplePayload();
  const h = REPORT.html(payload);

  assert.ok(h.indexOf("sknx-rx") === -1, "must not contain the sknx-rx class");
  assert.doesNotMatch(h, /prescription/i);
  assert.doesNotMatch(h, /prescribe/i);
});

test("html() contains the disclaimer block text", async () => {
  const payload = await buildSamplePayload();
  const h = REPORT.html(payload);
  assert.ok(h.indexOf(payload.disclaimer) !== -1);
});

test("html() HTML-escapes an XSS payload in a differential label", async () => {
  const evidence = EVID.retrieve(["psoriasis"]);
  const xssPayload = await LLM.buildReport({
    analysis: { differential: [{ label: "<script>alert(1)</script>", prob: 0.5, band: "moderate" }], referral: false },
    features: {},
    evidence: evidence,
    context: {}
  });
  const h = REPORT.html(xssPayload);
  assert.ok(h.indexOf("<script>alert(1)</script>") === -1, "raw script tag must not appear unescaped");
  assert.ok(h.indexOf("&lt;script&gt;alert(1)&lt;/script&gt;") !== -1, "label should be HTML-escaped");
});

test("explainControls() renders 5 buttons including patient and consultant audiences", () => {
  const controls = REPORT.explainControls();
  assert.ok(controls.indexOf('data-audience="patient"') !== -1);
  assert.ok(controls.indexOf('data-audience="consultant"') !== -1);
  const buttonCount = (controls.match(/<button/g) || []).length;
  assert.equal(buttonCount, 5);
});

test("pdf() is a function and never throws in a node (DOM-less) environment", async () => {
  const payload = await buildSamplePayload();
  assert.equal(typeof REPORT.pdf, "function");
  assert.doesNotThrow(() => { REPORT.pdf(payload); });
});

test("dual export shape matches other sknx-*.js modules", () => {
  assert.equal(typeof REPORT.html, "function");
  assert.equal(typeof REPORT.explainControls, "function");
  assert.equal(typeof REPORT.pdf, "function");
});
