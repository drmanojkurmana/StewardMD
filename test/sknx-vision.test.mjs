// test/sknx-vision.test.mjs — the native iOS Core ML bridge, tested with an INJECTED fake plugin (no
// device/Xcode needed): flag gate -> ensure-download -> classify -> map probs -> real SknX guardrail.
import { test } from "node:test";
import assert from "node:assert";
import VIS from "../sknx-vision.js";
import ENG from "../sknx-engines.js";

// a fake `window` with the experimental flag on (or off) + an optional SknxVision plugin
function win(flagOn, plugin) {
  return {
    Capacitor: { Plugins: plugin ? { SknxVision: plugin } : {} },
    SMD_SKNX_FLAGS: { bool: (k) => (k === "smd_sknx_realvision" ? !!flagOn : false) }
  };
}
function fakePlugin(probs, opts) {
  opts = opts || {};
  return {
    calls: { available: 0, prepare: 0, classify: 0 }, lastClassify: null, lastPrepare: null,
    available() { this.calls.available++; return Promise.resolve(opts.ready ? { ready: true, path: "/docs/SknXDerm.mlpackage" } : { ready: false }); },
    prepare(a) { this.calls.prepare++; this.lastPrepare = a; return Promise.resolve({ ready: true, path: "/docs/SknXDerm.mlpackage" }); },
    classify(a) { this.calls.classify++; this.lastClassify = a; return Promise.resolve({ probs }); }
  };
}
const MEL = [0, 0, 0, 0, 0.92, 0.05, 0.03]; // melanoma dominant (HAM index 4)
const NEV = [0, 0, 0, 0, 0.02, 0.95, 0.01]; // nevus dominant (index 5)

test("available(): needs BOTH the experimental flag ON and the native plugin present", () => {
  assert.equal(VIS.available(win(true, {})), true, "flag on + plugin -> available");
  assert.equal(VIS.available(win(false, {})), false, "flag OFF + plugin -> NOT available (opt-in only)");
  assert.equal(VIS.available(win(true, null)), false, "flag on + no plugin -> not available");
  assert.equal(VIS.available(), false, "node (no window) -> not available");
});

test("analyze rejects plugin_unavailable when the plugin is absent", async () => {
  await assert.rejects(() => VIS.analyze({}, win(true, null)), /plugin_unavailable/);
});

test("mapProbs maps the 7 HAM classes to SknX labels + experimental engine tag", () => {
  const raw = VIS.mapProbs(MEL);
  assert.equal(raw.engine, "realvision-experimental");
  assert.equal(raw.lesionProbs[4].label, "melanoma");
  assert.equal(raw.lesionProbs[1].label, "BCC");
  assert.equal(raw.lesionProbs[5].label, "nevus");
  assert.ok(raw.lesionProbs[4].prob > 0.9);
});

test("analyze() melanoma classification -> SknX REFERS, no Rx (full native path, injected plugin)", async () => {
  const p = fakePlugin(MEL);
  const raw = await VIS.analyze({}, undefined, { plugin: p, base64: "AAAA" });
  assert.equal(p.calls.classify, 1);
  assert.equal(p.lastClassify.base64Image, "AAAA");
  assert.equal(p.lastClassify.modelPath, "/docs/SknXDerm.mlpackage");
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
  assert.match(a.referralReason, /melanoma/i);
});

test("analyze() benign (nevus) -> no referral, NOT Rx-eligible (H7 melanoma caveat)", async () => {
  const raw = await VIS.analyze({}, undefined, { plugin: fakePlugin(NEV), base64: "AAAA" });
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.referral, false);
  // H7 (clinical_safety.md): a pigmented/melanocytic read can be an unrecognised melanoma, so it is
  // never Rx-eligible and carries a "cannot exclude melanoma" caveat even without a red flag.
  assert.equal(a.rxEligible, false);
  assert.match(String(a.caution || ""), /melanoma/i);
  assert.equal(a.lesion.top, "nevus");
});

test("ensureModel downloads on a cold start (not ready -> prepare) then classifies; skips when warm", async () => {
  const cold = fakePlugin(NEV, { ready: false });
  await VIS.analyze({}, undefined, { plugin: cold, base64: "AAAA" });
  assert.equal(cold.calls.prepare, 1, "cold start downloads the .mlpackage once");
  assert.ok(cold.lastPrepare && typeof cold.lastPrepare.baseUrl === "string");
  const warm = fakePlugin(NEV, { ready: true });
  await VIS.analyze({}, undefined, { plugin: warm, base64: "AAAA" });
  assert.equal(warm.calls.prepare, 0, "warm start must not re-download");
});

test("a dataURL image is stripped to raw base64 for the bridge", async () => {
  const p = fakePlugin(NEV);
  await VIS.analyze("data:image/jpeg;base64,ZZZZ", undefined, { plugin: p, modelPath: "/m" });
  assert.equal(p.lastClassify.base64Image, "ZZZZ");
  assert.equal(p.lastClassify.modelPath, "/m");
});

test("warmup() preloads the model (downloads once) when flag + plugin present", async () => {
  const p = fakePlugin([0,0,0,0,0,1,0], { ready: false });
  const ok = await VIS.warmup(win(true, p));
  assert.equal(ok, true);
  assert.equal(p.calls.prepare, 1, "warmup pre-downloads the model");
});
