import { test } from "node:test";
import assert from "node:assert";
import LLM from "../sknx-llm.js";
import EV from "../sknx-evidence.js";

var psoriasisAnalysis = {
  differential: [
    { label: "psoriasis", prob: 0.72, band: "high" },
    { label: "eczema", prob: 0.18, band: "low" }
  ],
  lesion: null,
  referral: false,
  referralReason: null,
  rxEligible: true,
  disclaimerKey: "educational_not_clinical"
};

var referralAnalysis = {
  differential: [{ label: "benign keratosis", prob: 0.6, band: "moderate" }],
  lesion: { top: "melanoma", prob: 0.2, band: "low" },
  referral: true,
  referralReason: "Possible melanoma - specialist referral, do not prescribe.",
  rxEligible: false,
  disclaimerKey: "educational_not_clinical"
};

test("no-hallucination: every reference and guidelineSummary url/source traces back to the passed evidence", async () => {
  var evidence = EV.retrieve(["psoriasis"]);
  assert.ok(evidence.length >= 1, "fixture should retrieve at least one psoriasis evidence entry");
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: evidence, context: {} });
  var evidenceUrls = evidence.map((e) => e.url);
  var evidenceSources = evidence.map((e) => e.source);

  assert.ok(report.references.length >= 1);
  for (const ref of report.references) {
    assert.ok(evidenceUrls.indexOf(ref.url) !== -1, "reference url " + ref.url + " not found in passed evidence");
    assert.ok(evidenceSources.indexOf(ref.source) !== -1, "reference source " + ref.source + " not found in passed evidence");
  }
  for (const g of report.guidelineSummary) {
    assert.ok(evidenceUrls.indexOf(g.url) !== -1, "guidelineSummary url " + g.url + " not found in passed evidence");
    assert.ok(evidenceSources.indexOf(g.source) !== -1, "guidelineSummary source " + g.source + " not found in passed evidence");
  }
});

test("no-hallucination: empty evidence -> references === [] and guidelineSummary === []", async () => {
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: [], context: {} });
  assert.deepEqual(report.references, []);
  assert.deepEqual(report.guidelineSummary, []);
});

test("analysis.referral === true forces at least one redFlag", async () => {
  var report = await LLM.buildReport({
    analysis: referralAnalysis,
    features: { asymmetry: true, borderIrregular: true, colorVariegation: true, diameterMm: 8, evolving: true },
    evidence: [],
    context: {}
  });
  assert.ok(report.redFlags.length >= 1);
});

test("analysis.referral === true with no explicit ABCDE feature flags still surfaces the referral reason as a red flag", async () => {
  var report = await LLM.buildReport({ analysis: referralAnalysis, features: {}, evidence: [], context: {} });
  assert.ok(report.redFlags.length >= 1);
});

test("referral === false may report zero redFlags", async () => {
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: [], context: {} });
  assert.ok(Array.isArray(report.redFlags));
});

test("no-Rx: payload contains no prescription/prescribe/rx tokens anywhere", async () => {
  var evidence = EV.retrieve(["psoriasis"]);
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: { diameterMm: 4 }, evidence: evidence, context: {} });
  var json = JSON.stringify(report);
  assert.doesNotMatch(json, /prescription|prescrib|\brx\b/i);
});

test("no-Rx: no dose/mg drug-instruction anywhere in the payload", async () => {
  var evidence = EV.retrieve(["tinea"]);
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: evidence, context: {} });
  var json = JSON.stringify(report);
  assert.doesNotMatch(json, /\bdose\b/i);
  assert.doesNotMatch(json, /\d+\s*mg\b/i);
});

test("no-Rx: management entries are non-empty educational strings, not drug+dose instructions", async () => {
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: [], context: {} });
  assert.ok(Array.isArray(report.management) && report.management.length >= 1);
  for (const m of report.management) {
    assert.equal(typeof m, "string");
    assert.ok(m.trim().length > 0);
    assert.doesNotMatch(m, /prescription|prescrib|\brx\b|\bdose\b|\d+\s*mg\b/i);
  }
});

test("no-Rx: referral case management defers to specialist and carries no treatment options", async () => {
  var report = await LLM.buildReport({ analysis: referralAnalysis, features: {}, evidence: [], context: {} });
  assert.ok(report.management.length >= 1);
  assert.ok(report.management.some((m) => /refer/i.test(m)));
});

test("explainAs re-levels discussion by audience but leaves citations untouched", async () => {
  var evidence = EV.retrieve(["psoriasis"]);
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: evidence, context: {} });
  var patient = LLM.explainAs(report, "patient");
  var consultant = LLM.explainAs(report, "consultant");

  assert.notEqual(patient.discussion, consultant.discussion);
  assert.deepEqual(patient.references, report.references);
  assert.deepEqual(consultant.references, report.references);
  assert.deepEqual(patient.guidelineSummary, report.guidelineSummary);
  assert.deepEqual(consultant.guidelineSummary, report.guidelineSummary);
});

test("explainAs covers all five documented audiences with distinct-enough templates", async () => {
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: [], context: {} });
  var audiences = ["mbbs", "intern", "resident", "consultant", "patient"];
  var seen = new Set();
  for (const aud of audiences) {
    var out = LLM.explainAs(report, aud);
    assert.equal(typeof out.discussion, "string");
    assert.ok(out.discussion.length > 0);
    seen.add(out.discussion);
  }
  assert.ok(seen.size >= 4, "expected most audience templates to differ from one another");
});

test("explainAs does not mutate the original report", async () => {
  var report = await LLM.buildReport({ analysis: psoriasisAnalysis, features: {}, evidence: [], context: {} });
  var originalDiscussion = report.discussion;
  LLM.explainAs(report, "patient");
  assert.equal(report.discussion, originalDiscussion);
});

test("deps.remote swap seam is used instead of the mock when provided", async () => {
  var sentinel = { quality: "n/a", differential: [], references: [], guidelineSummary: [], mocked: false, fromRemote: true };
  var result = await LLM.buildReport(
    { analysis: psoriasisAnalysis, features: {}, evidence: [], context: {} },
    { remote: function () { return Promise.resolve(sentinel); } }
  );
  assert.equal(result, sentinel);
});

test("no em-dash in any user-visible text field", async () => {
  var evidence = EV.retrieve(["psoriasis"]);
  var report = await LLM.buildReport({ analysis: referralAnalysis, features: { diameterMm: 8 }, evidence: evidence, context: {} });
  var fields = [report.visualFindings, report.discussion, report.disclaimer]
    .concat(report.management)
    .concat(report.investigations)
    .concat(report.followup)
    .concat(report.redFlags)
    .concat(report.differential.map((d) => d.why + " " + d.whyNot));
  for (const f of fields) {
    assert.ok(!/—/.test(String(f)), "em-dash found in: " + f);
  }
});

test("dual export shape matches other sknx-*.js modules", () => {
  assert.equal(typeof LLM.buildReport, "function");
  assert.equal(typeof LLM.explainAs, "function");
});
