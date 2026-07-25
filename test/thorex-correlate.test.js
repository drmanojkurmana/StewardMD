/* test/thorex-correlate.test.js — thorex-correlate.js (SMD_THOREX_CORRELATE) node test.
 * Mirrors the style of test/thorex-report.test.js / test/thorex-llm.test.js. Asserts:
 *   (a) gather() never throws with no modules present, and returns an object (possibly empty)
 *   (b) the edema-vs-pneumonia rule: a diffuse-opacity/edema-ish clinical analysis + {EF:30, BNP:1800,
 *       PCT:0.1} favors cardiogenic pulmonary edema and cites BNP/EF/PCT; a consolidation analysis +
 *       {WBC:16, CRP:150, PCT:2.0} favors pneumonia
 *   (c) insufficient data -> the mandated "enter labs" message with an empty differential
 *   (d) the de-identified payload passed toward the LLM (via an injected fetchImpl) contains only
 *       values — no identifier-shaped keys
 *   (e) educational-engine findings never drive the differential (clinical engine only)
 */
const assert = require("assert");
const CORR = require("../thorex-correlate.js");

function clinicalAnalysis(labels, opts) {
  opts = opts || {};
  var engines = [
    {
      engine: "torchxrayvision",
      educational: false,
      findings: labels.map(function (label) { return { label: label, band: "High", severity: "warn" }; })
    }
  ];
  if (opts.educationalLabels) {
    engines.push({
      engine: "xraydar",
      educational: true,
      findings: opts.educationalLabels.map(function (label) { return { label: label, band: "Medium", severity: "info" }; })
    });
  }
  return { id: "tx-test", engines: engines };
}

(async function main() {
  // ── (a) gather() never throws with no browser modules present; returns an object ──
  delete global.window;
  var g;
  assert.doesNotThrow(function () { g = CORR.gather(); }, "gather() must never throw");
  assert.ok(g && typeof g === "object", "gather() should return an object");
  assert.deepEqual(Object.keys(g), [], "gather() should degrade to an empty object with no modules present");

  // ── (b) edema-vs-pneumonia rule ──
  const edemaAnalysis = clinicalAnalysis(["Bilateral diffuse airspace opacities"]);
  const edemaRule = CORR.reason(edemaAnalysis, { ef: 30, bnp: 1800, pct: 0.1 });
  assert.equal(edemaRule.insufficientData, false, "edema case should not be insufficient data");
  assert.ok(edemaRule.differential.length >= 1, "edema case should produce a differential");
  assert.equal(edemaRule.differential[0].condition, "Cardiogenic pulmonary edema", "edema case should rank cardiogenic pulmonary edema first");
  const edemaJust = edemaRule.differential[0].justification;
  assert.ok(/BNP/.test(edemaJust), "edema justification cites BNP");
  assert.ok(/EF/.test(edemaJust), "edema justification cites EF");
  assert.ok(/PCT/.test(edemaJust), "edema justification cites PCT");
  assert.ok(!/Pneumonia/.test(edemaRule.differential.map(function (d) { return d.condition; }).join(",")), "edema case should not favor pneumonia");

  const pneumoniaAnalysis = clinicalAnalysis(["Right lower lobe consolidation"]);
  const pneumoniaRule = CORR.reason(pneumoniaAnalysis, { wbc: 16, crp: 150, pct: 2.0 });
  assert.equal(pneumoniaRule.insufficientData, false, "pneumonia case should not be insufficient data");
  assert.equal(pneumoniaRule.differential[0].condition, "Pneumonia / infective consolidation", "pneumonia case should rank pneumonia first");
  const pneuJust = pneumoniaRule.differential[0].justification;
  assert.ok(/WBC/.test(pneuJust), "pneumonia justification cites WBC");
  assert.ok(/CRP/.test(pneuJust), "pneumonia justification cites CRP");
  assert.ok(/PCT/.test(pneuJust), "pneumonia justification cites PCT");

  // ── (c) insufficient data ──
  const insufficient = CORR.reason(edemaAnalysis, {});
  assert.equal(insufficient.insufficientData, true, "no clinicalData at all should be insufficient");
  assert.deepEqual(insufficient.differential, [], "insufficient data -> empty differential");
  assert.equal(insufficient.reasoning[0], "Insufficient correlating data — enter labs/ABG to refine.", "insufficient data message must match exactly");

  const noRuleMatch = CORR.reason(clinicalAnalysis(["No acute cardiopulmonary abnormality"]), { ef: 55, wbc: 6 });
  assert.equal(noRuleMatch.insufficientData, true, "a finding with no matching pattern should also be insufficient");

  // ── (d) de-identified payload toward the LLM contains only values, no identifier keys ──
  const cap = {};
  const fakeFetchOk = function (url, opts) {
    cap.body = JSON.parse(opts.body);
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ ok: true, provider: "groq", text: "Correlated narrative." }); } });
  };
  const corrRes = await CORR.correlate(edemaAnalysis, { ef: 30, bnp: 1800, pct: 0.1, history: "Dyspnea 2 days" }, { fetchImpl: fakeFetchOk });
  assert.equal(corrRes.narrative, "Correlated narrative.", "narrative comes from the LLM when it succeeds");
  assert.equal(corrRes.narrativeProvider, "groq");
  assert.ok(cap.body && cap.body.context, "correlate posts a context object toward the LLM");
  const ctxJson = JSON.stringify(cap.body);
  assert.ok(!/\bmrn\b|\bdob\b|\bname\b/i.test(ctxJson), "payload has no identifier-shaped key");
  assert.ok(!/tx-test/.test(ctxJson), "payload never carries the analysis id");
  const ctxKeys = Object.keys(cap.body.context).sort();
  ctxKeys.forEach(function (k) {
    assert.ok(["ef", "bnp", "ntProBnp", "pct", "crp", "wbc", "troponin", "abg", "na", "k", "temp", "spo2", "history"].indexOf(k) >= 0,
      "context key \"" + k + "\" should be one of the de-identified clinicalData value fields");
  });

  // correlate() falls back to the deterministic rule reasoning as the narrative when the LLM is offline/unavailable
  const offlineRes = await CORR.correlate(edemaAnalysis, { ef: 30, bnp: 1800, pct: 0.1 }, { fetchImpl: function () { return Promise.reject(new Error("network down")); } });
  assert.equal(offlineRes.narrativeProvider, "offline");
  assert.equal(offlineRes.narrative, offlineRes.reasoning.join(" "), "offline narrative falls back to the deterministic rule reasoning, not a generic message");

  // ── (e) educational findings never drive the differential ──
  const eduOnly = clinicalAnalysis(["No acute cardiopulmonary abnormality"], { educationalLabels: ["Right lower lobe consolidation"] });
  const eduRule = CORR.reason(eduOnly, { wbc: 16, crp: 150, pct: 2.0, temp: 39 });
  assert.equal(eduRule.insufficientData, true, "a consolidation label ONLY in the educational engine must not trigger the pneumonia rule");
  assert.deepEqual(eduRule.differential, [], "educational-only consolidation must not produce a differential");

  const eduVsClinical = clinicalAnalysis(["Bilateral diffuse airspace opacities"], { educationalLabels: ["Right lower lobe consolidation"] });
  const eduVsClinicalRule = CORR.reason(eduVsClinical, { ef: 30, bnp: 1800, pct: 0.1, wbc: 16, crp: 150 });
  assert.equal(eduVsClinicalRule.differential[0].condition, "Cardiogenic pulmonary edema",
    "clinical-engine edema pattern must win even though the educational engine mentions consolidation");
  assert.ok(eduVsClinicalRule.differential.every(function (d) { return d.condition !== "Pneumonia / infective consolidation"; }),
    "pneumonia must not appear — the consolidation label lives only in the educational engine");

  console.log("ok");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
