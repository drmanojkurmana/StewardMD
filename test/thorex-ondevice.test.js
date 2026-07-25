/* test/thorex-ondevice.test.js — OD-C: on-device (onnxruntime-web, thorex-ort.js) provider wiring.
 *
 * Stubs window.SMD_THOREX_ORT (never loads the real WASM runtime/model — that's thorex-ort.test.js's
 * job) so this file stays about the SEAM: chooseAnalyzer() prefers the on-device analyzer only when
 * smd_thorex_ondevice is ON and SMD_THOREX_ORT.available() is true; it returns the CLINICAL engine
 * result unchanged (no re-shaping/fabrication) for both v1 and the v2beta interim (educational
 * X-Raydar is not yet on-device — OD-D); and on-device inference failure never fabricates a result.
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

// Canned clinical (torchxrayvision) analysis, shaped exactly like thorex-ort.js's analyzeImage()
// resolves it (already run through MODELS.makeAnalysis, single clinical engine, no educational engine).
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

(async () => {
  // ── 1) Flag OFF (even with ORT present+available): chooseAnalyzer must NOT pick on-device. ──────
  global.window.SMD_THOREX_ORT = { available: () => true, analyzeImage: async () => cannedClinicalAnalysis("should-not-be-used") };
  flags.smd_thorex_ondevice = false;
  var offAssembly = P.liveProviders();
  assert.notEqual(offAssembly.analyzer.kind, "ondevice", "on-device must not be picked while smd_thorex_ondevice is OFF");
  assert.equal(offAssembly.analyzer.kind, "unavailable", "with demo/backend/ondevice all off, the honest unavailable analyzer must run");

  // ── 2) Flag ON + ORT available -> on-device analyzer chosen; v1 returns the clinical result as-is. ──
  flags.smd_thorex_ondevice = true;
  var onAssembly = P.liveProviders();
  assert.equal(onAssembly.analyzer.kind, "ondevice", "chooseAnalyzer must prefer on-device when the flag is ON and SMD_THOREX_ORT.available()");

  var stages = [];
  var v1 = await onAssembly.analyzer.analyze({ id: "img-v1", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "v1", (stage, pct) => stages.push([stage, pct]));
  assert.deepEqual(v1.engines.map((e) => e.engine), ["torchxrayvision"], "on-device v1 must return the clinical torchxrayvision engine");
  assert.equal(v1.engines[0].educational, false);
  assert.ok(stages.length >= 2, "on-device analyzer must stream at least two stage callbacks (preprocess/infer)");

  // ── 3) v2beta interim: clinical engine ONLY — the educational X-Raydar engine must NOT be fabricated. ──
  var v2 = await onAssembly.analyzer.analyze({ id: "img-v2", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "v2beta", () => {});
  assert.deepEqual(v2.engines.map((e) => e.engine), ["torchxrayvision"], "on-device v2beta (interim, pre-OD-D) must return clinical-only, never a fabricated educational engine");
  assert.ok(!v2.engines.some((e) => e.educational === true), "no educational engine may appear on-device yet (OD-D not landed)");

  // ── 4) ORT throws / unavailable -> the analyzer rejects with a typed, honest error (no fabrication). ──
  global.window.SMD_THOREX_ORT = { available: () => true, analyzeImage: async () => { throw new Error("model load failed"); } };
  var rebuilt = P.liveProviders();  // fresh chooseAnalyzer() call so it re-reads the ORT stub above
  assert.equal(rebuilt.analyzer.kind, "ondevice");
  let threw = null;
  try {
    await rebuilt.analyzer.analyze({ id: "img-fail", data: { width: 2, height: 2, data: new Uint8Array(4) } }, "v1", () => {});
  } catch (e) { threw = e; }
  assert.ok(threw, "an ORT failure must reject, never resolve with a fabricated analysis");
  assert.equal(threw.code, "inference_unavailable", "on-device failure must surface the typed inference_unavailable error code");

  // ── 5) SMD_THOREX_ORT.available() === false -> chooseAnalyzer must not pick on-device even with the flag ON. ──
  global.window.SMD_THOREX_ORT = { available: () => false, analyzeImage: async () => cannedClinicalAnalysis("x") };
  var notReady = P.liveProviders();
  assert.notEqual(notReady.analyzer.kind, "ondevice", "on-device must not be picked when SMD_THOREX_ORT.available() is false");

  console.log("ok");
})();
