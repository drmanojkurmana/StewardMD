/* test/thorex-ondevice.test.js — OD-C/OD-D: on-device (onnxruntime-web, thorex-ort.js) provider wiring.
 *
 * Stubs window.SMD_THOREX_ORT (never loads the real WASM runtime/model — that's thorex-ort.test.js's
 * job) so this file stays about the SEAM: chooseAnalyzer() prefers the on-device analyzer only when
 * smd_thorex_ondevice is ON and SMD_THOREX_ORT.available() is true; the on-device analyzer asks
 * analyzeImage() for `includeEducational: true` on v2beta (OD-D: both engines on-device) and
 * `includeEducational: false` on v1/free (clinical only); it returns whatever analyzeImage() resolves
 * unchanged (no re-shaping/fabrication here — thorex-ort.js owns the educational-failure isolation);
 * and an on-device (clinical-engine) inference failure never fabricates a result.
 */
const assert = require("assert");

const MODELS = require("../thorex-models.js");

// Mutable flag store the stub SMD_THOREX_FLAGS reads live (so tests can flip smd_thorex_ondevice
// between calls without re-requiring the module).
const flags = { smd_thorex_ondevice: false, smd_thorex_backend: false, smd_thorex_demo: false };
global.window = {
  SMD_THOREX_MODELS: MODELS,
  SMD_THOREX_FLAGS: { bool: (k) => !!flags[k], get: () => null }
  // SMD_THOREX_ORT is intentionally absent at require-time; set per-test below.
};
const P = require("../thorex-providers.js");

// Canned clinical-only analysis, shaped exactly like thorex-ort.js's analyzeImage() resolves it when
// includeEducational is falsy (already run through MODELS.makeAnalysis, single clinical engine).
function cannedClinicalAnalysis(id) {
  return MODELS.makeAnalysis({
    id: id,
    engines: [{
      engine: "torchxrayvision",
      educational: false,
      findings: [{ label: "Right lower lobe consolidation", band: "High", severity: "urgent", relevance: "diagnostic" }],
      disclaimer_key: null
    }],
    disclaimer_key: "clinical_assist_disclaimer"
  });
}

// Canned TWO-engine analysis (clinical + educational), shaped exactly like thorex-ort.js's
// analyzeImage() resolves it when includeEducational is true (OD-D).
function cannedTwoEngineAnalysis(id) {
  return MODELS.makeAnalysis({
    id: id,
    engines: [
      {
        engine: "torchxrayvision",
        educational: false,
        findings: [{ label: "Right lower lobe consolidation", band: "High", severity: "urgent", relevance: "diagnostic" }],
        disclaimer_key: null
      },
      {
        engine: "xraydar",
        educational: true,
        findings: [{ label: "Bilateral lower lobe interstitial opacities", band: "Medium", severity: "warn", relevance: "educational" }],
        disclaimer_key: "educational_not_clinical"
      }
    ],
    disclaimer_key: "clinical_assist_disclaimer"
  });
}

// Stub analyzeImage that mimics thorex-ort.js's real contract: includeEducational -> two engines,
// else clinical-only. Records the opts it was called with so tests can assert on the wiring.
function makeOrtStub() {
  var calls = [];
  return {
    calls: calls,
    available: () => true,
    analyzeImage: async (input, opts) => {
      calls.push(opts);
      return opts && opts.includeEducational ? cannedTwoEngineAnalysis(input && input.id) : cannedClinicalAnalysis(input && input.id);
    }
  };
}

(async () => {
  // ── 1) Flag OFF (even with ORT present+available): chooseAnalyzer must NOT pick on-device. ──────
  global.window.SMD_THOREX_ORT = { available: () => true, analyzeImage: async () => cannedClinicalAnalysis("should-not-be-used") };
  flags.smd_thorex_ondevice = false;
  var offAssembly = P.liveProviders();
  assert.notEqual(offAssembly.analyzer.kind, "ondevice", "on-device must not be picked while smd_thorex_ondevice is OFF");
  assert.equal(offAssembly.analyzer.kind, "unavailable", "with demo/backend/ondevice all off, the honest unavailable analyzer must run");

  // ── 2) Flag ON + ORT available -> on-device analyzer chosen; v1 asks for clinical ONLY. ──────────
  flags.smd_thorex_ondevice = true;
  var stub = makeOrtStub();
  global.window.SMD_THOREX_ORT = stub;
  var onAssembly = P.liveProviders();
  assert.equal(onAssembly.analyzer.kind, "ondevice", "chooseAnalyzer must prefer on-device when the flag is ON and SMD_THOREX_ORT.available()");

  var stages = [];
  var v1 = await onAssembly.analyzer.analyze({ id: "img-v1", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "v1", (stage, pct) => stages.push([stage, pct]));
  assert.deepEqual(v1.engines.map((e) => e.engine), ["torchxrayvision"], "on-device v1 must return the clinical torchxrayvision engine only");
  assert.equal(v1.engines[0].educational, false);
  assert.ok(stages.length >= 2, "on-device analyzer must stream at least two stage callbacks (preprocess/infer)");
  assert.equal(stub.calls[stub.calls.length - 1].includeEducational, false, "v1 must call analyzeImage with includeEducational: false");

  // ── 3) OD-D: v2beta asks analyzeImage() for BOTH engines on-device (includeEducational: true). ────
  var v2 = await onAssembly.analyzer.analyze({ id: "img-v2", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "v2beta", () => {});
  assert.equal(stub.calls[stub.calls.length - 1].includeEducational, true, "v2beta must call analyzeImage with includeEducational: true (OD-D)");
  assert.deepEqual(v2.engines.map((e) => e.engine), ["torchxrayvision", "xraydar"], "on-device v2beta must return BOTH the clinical and educational engines, clinical first");
  assert.equal(v2.engines[0].educational, false, "clinical engine must have educational: false");
  assert.equal(v2.engines[1].educational, true, "educational engine must have educational: true");
  assert.equal(v2.engines[1].disclaimerKey, "educational_not_clinical", "educational engine must carry the educational_not_clinical disclaimer");

  // ── 4) free -> clinical only too (same as v1; only v2beta gets includeEducational: true). ─────────
  var free = await onAssembly.analyzer.analyze({ id: "img-free", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "free", () => {});
  assert.equal(stub.calls[stub.calls.length - 1].includeEducational, false, "free must call analyzeImage with includeEducational: false");
  assert.deepEqual(free.engines.map((e) => e.engine), ["torchxrayvision"], "on-device free must return the clinical engine only");

  // ── 5) Educational-engine failure isolation is thorex-ort.js's job: the on-device analyzer here ───
  //    must simply pass through whatever analyzeImage() resolves — including a clinical-only result
  //    even when v2beta asked for includeEducational: true (i.e., it must NOT re-fabricate an
  //    educational engine or treat the missing engine as an error).
  var isolatedStub = {
    available: () => true,
    analyzeImage: async (input, opts) => cannedClinicalAnalysis(input && input.id) // pretend the edu engine failed and was isolated
  };
  global.window.SMD_THOREX_ORT = isolatedStub;
  var isolatedAssembly = P.liveProviders();
  var v2Isolated = await isolatedAssembly.analyzer.analyze({ id: "img-v2-edu-fail", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "v2beta", () => {});
  assert.deepEqual(v2Isolated.engines.map((e) => e.engine), ["torchxrayvision"], "on-device v2beta must resolve clinical-only (not reject) when the educational engine was isolated inside analyzeImage()");

  // ── 6) ORT throws / unavailable -> the analyzer rejects with a typed, honest error (no fabrication). ──
  global.window.SMD_THOREX_ORT = { available: () => true, analyzeImage: async () => { throw new Error("model load failed"); } };
  var rebuilt = P.liveProviders();  // fresh chooseAnalyzer() call so it re-reads the ORT stub above
  assert.equal(rebuilt.analyzer.kind, "ondevice");
  let threw = null;
  try {
    await rebuilt.analyzer.analyze({ id: "img-fail", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "v1", () => {});
  } catch (e) { threw = e; }
  assert.ok(threw, "an ORT failure must reject, never resolve with a fabricated analysis");
  assert.equal(threw.code, "inference_unavailable", "on-device failure must surface the typed inference_unavailable error code");

  // ── 7) SMD_THOREX_ORT.available() === false -> chooseAnalyzer must not pick on-device even with the flag ON. ──
  global.window.SMD_THOREX_ORT = { available: () => false, analyzeImage: async () => cannedClinicalAnalysis("x") };
  var notReady = P.liveProviders();
  assert.notEqual(notReady.analyzer.kind, "ondevice", "on-device must not be picked when SMD_THOREX_ORT.available() is false");

  console.log("ok");
})();
