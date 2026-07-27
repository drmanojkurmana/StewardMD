/* test/thorex-llm.test.js — thorex-llm.js (SMD_THOREX_LLM) node test.
 * Injects a fake fetch (opts.fetchImpl) so no network call is ever made. Asserts:
 *   (a) learnMore posts kind:"learn" with ONLY de-identified fields (no image/identifier keys)
 *   (b) a 200 {text} response is returned as-is
 *   (c) a fetch failure / a server provider:"offline" reply both fall back to the deterministic,
 *       non-empty local explanation
 *   (d) the payload never contains a forbidden key (image, heatmap, mrn/dob/name-shaped, or the
 *       analysis's own id) anywhere, for learn/impression/correlate alike
 */
const assert = require("assert");
const LLM = require("../thorex-llm.js");

const sampleFinding = {
  label: "Right lower lobe consolidation",
  band: "High",
  severity: "urgent",
  relevance: "diagnostic",
  heatmap: "iVBORw0KGgoAAAANSUhEUgAAAAEA-should-never-leave-the-device",
};
const sampleAnalysis = {
  id: "patient-mrn-12345", // identifier-shaped — must NEVER appear in an outgoing payload
  engines: [
    {
      engine: "torchxrayvision", educational: false,
      findings: [sampleFinding, { label: "Air bronchogram", band: "Medium", severity: "warn", relevance: "supportive" }],
    },
  ],
};

function fakeFetchOk(capture) {
  return function (url, opts) {
    capture.url = url; capture.opts = opts; capture.body = JSON.parse(opts.body);
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ ok: true, provider: "groq", text: "This finding suggests early consolidation; correlate with WBC/CRP and exam." }); } });
  };
}
function fakeFetchOffline() {
  return function () {
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ ok: true, provider: "offline", text: null }); } });
  };
}
function fakeFetchNetworkDown() {
  return function () { return Promise.reject(new Error("network down")); };
}

function assertNoForbiddenKeys(body, label) {
  const json = JSON.stringify(body);
  assert.ok(!/heatmap/i.test(json), label + ": no heatmap/image-data key");
  assert.ok(!/\bimage\b/i.test(json), label + ": no image key");
  assert.ok(!/patient-mrn-12345/.test(json), label + ": no analysis.id / identifier value");
  assert.ok(!/\bmrn\b|\bdob\b|\bname\b/i.test(json), label + ": no identifier-shaped key");
}

(async function main() {
  // (a) + (d) — learnMore posts kind:"learn" with ONLY the safe finding shape + a de-identified findings list
  const cap1 = {};
  const res1 = await LLM.learnMore(sampleFinding, sampleAnalysis, { fetchImpl: fakeFetchOk(cap1) });
  assert.equal(cap1.body.kind, "learn", "posts kind:learn");
  assert.deepEqual(Object.keys(cap1.body).sort(), ["finding", "findings", "kind"], "learn payload has only the expected top-level keys");
  assert.deepEqual(Object.keys(cap1.body.finding).sort(), ["band", "label", "relevance", "severity"], "finding reduced to the safe shape");
  assert.equal(cap1.body.findings.length, 2, "findings list carries every engine finding");
  assertNoForbiddenKeys(cap1.body, "learn");

  // (b) — a 200 {text} response is returned as-is (provider + text pass through)
  assert.equal(res1.provider, "groq");
  assert.equal(res1.text, "This finding suggests early consolidation; correlate with WBC/CRP and exam.");

  // (c) — a fetch/network failure falls back to the deterministic, non-empty local explanation
  const res2 = await LLM.learnMore(sampleFinding, sampleAnalysis, { fetchImpl: fakeFetchNetworkDown() });
  assert.equal(res2.provider, "offline");
  assert.ok(typeof res2.text === "string" && res2.text.length > 10, "non-empty deterministic fallback on network failure");
  assert.ok(res2.text.indexOf("Right lower lobe consolidation") >= 0, "fallback text is built from the finding itself");

  // (c) — server-reported provider:"offline" (text:null) also falls back locally, never surfaces null
  const res3 = await LLM.learnMore(sampleFinding, sampleAnalysis, { fetchImpl: fakeFetchOffline() });
  assert.equal(res3.provider, "offline");
  assert.ok(typeof res3.text === "string" && res3.text.length > 10, "non-empty deterministic fallback when server itself is offline");

  // impressionNarrative — same de-identification guarantee, never includes analysis.id
  const cap2 = {};
  const res4 = await LLM.impressionNarrative(sampleAnalysis, { fetchImpl: fakeFetchOk(cap2) });
  assert.equal(cap2.body.kind, "impression");
  assertNoForbiddenKeys(cap2.body, "impression");
  assert.equal(res4.provider, "groq");

  // impressionNarrative offline fallback is non-empty (built from the deterministic report generator)
  const res5 = await LLM.impressionNarrative(sampleAnalysis, { fetchImpl: fakeFetchNetworkDown() });
  assert.equal(res5.provider, "offline");
  assert.ok(typeof res5.text === "string" && res5.text.length > 5, "impressionNarrative offline fallback is non-empty");

  // correlate — forwards only the caller-supplied de-identified clinicalData, never the raw analysis id
  const cap3 = {};
  const res6 = await LLM.correlate(sampleAnalysis, { lactateBand: "elevated", peakLactate: 4.2 }, { fetchImpl: fakeFetchOk(cap3) });
  assert.equal(cap3.body.kind, "correlate");
  assert.equal(cap3.body.context.lactateBand, "elevated");
  assertNoForbiddenKeys(cap3.body, "correlate");
  assert.equal(res6.provider, "groq");

  // correlate offline fallback is non-empty even with no clinicalData at all
  const res7 = await LLM.correlate(sampleAnalysis, null, { fetchImpl: fakeFetchNetworkDown() });
  assert.equal(res7.provider, "offline");
  assert.ok(typeof res7.text === "string" && res7.text.length > 5, "correlate offline fallback is non-empty");

  // bestDdx posts kind:"ddx" with the de-identified findings + a { history } context, no identifiers
  const cap4 = {};
  const res8 = await LLM.bestDdx(sampleAnalysis, "fever, foul sputum, IV drug use", { fetchImpl: fakeFetchOk(cap4) });
  assert.equal(cap4.body.kind, "ddx", "posts kind:ddx");
  assert.deepEqual(cap4.body.context, { history: "fever, foul sputum, IV drug use" }, "history goes in a de-identified context.history");
  assert.ok(Array.isArray(cap4.body.findings) && cap4.body.findings.length === 2, "ddx carries the de-identified findings list");
  assertNoForbiddenKeys(cap4.body, "ddx");
  assert.equal(res8.provider, "groq");
  // bestDdx offline fallback is non-empty
  const res9 = await LLM.bestDdx(sampleAnalysis, "cough", { fetchImpl: fakeFetchNetworkDown() });
  assert.equal(res9.provider, "offline");
  assert.ok(typeof res9.text === "string" && res9.text.length > 5, "bestDdx offline fallback is non-empty");

  console.log("ok");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
