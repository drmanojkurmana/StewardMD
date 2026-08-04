// test/sknx-realvision.test.mjs — the EXPERIMENTAL on-device ONNX classifier wiring, tested end-to-end
// with an injected ORT/session/decode (no model/DOM needed): preprocessing -> classifier -> real SknX
// guardrail. The real model is exercised separately by the scratch harness (onnxruntime-node); here we
// prove the tensor build, class mapping, and that a malignant classifier output routes to referral.
import { test } from "node:test";
import assert from "node:assert";
import RV from "../sknx-realvision.js";
import ENG from "../sknx-engines.js";

// A fake ORT + session that returns caller-supplied logits, so analyze() is fully deterministic.
function fakeOrt() { return { Tensor: function (type, data, dims) { return { type, data, dims }; } }; }
function fakeSession(logits) {
  return {
    inputNames: ["input"], outputNames: ["output"],
    _lastFeeds: null,
    run(feeds) { this._lastFeeds = feeds; return Promise.resolve({ output: { data: Float32Array.from(logits) } }); }
  };
}
const fakeDecode = () => Promise.resolve(new Uint8ClampedArray(RV.SIZE * RV.SIZE * 4));

test("softmax normalizes; toProbs passes probs through and softmaxes logits", () => {
  const s = RV.softmax([0, 0, 0, 0, 5, 0, 0]);
  assert.ok(Math.abs(s.reduce((a, b) => a + b, 0) - 1) < 1e-6);
  assert.ok(s[4] > 0.9);
  const probs = [0.1, 0.1, 0.1, 0.1, 0.5, 0.05, 0.05];
  assert.deepEqual(RV.toProbs(probs), probs);              // already-normalized -> unchanged
  assert.ok(Math.abs(RV.toProbs([2, 1, 0, 0, 0, 0, 0]).reduce((a, b) => a + b, 0) - 1) < 1e-6); // logits -> softmax
});

test("rgbaToTensorData produces ImageNet-normalized NCHW [3*224*224]", () => {
  const rgba = new Uint8ClampedArray(RV.SIZE * RV.SIZE * 4);
  rgba[0] = 255; rgba[1] = 0; rgba[2] = 0; // first pixel red
  const t = RV.rgbaToTensorData(rgba);
  assert.equal(t.length, 3 * RV.SIZE * RV.SIZE);
  const plane = RV.SIZE * RV.SIZE;
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-4, "R normalized");        // (255/255-mean)/std
  assert.ok(Math.abs(t[plane] - (0 - 0.456) / 0.224) < 1e-4, "G normalized");
  assert.ok(Math.abs(t[2 * plane] - (0 - 0.406) / 0.225) < 1e-4, "B normalized");
});

test("mapProbsToRaw maps the 7 HAM classes to SknX labels + tags the experimental engine", () => {
  const raw = RV.mapProbsToRaw([0.01, 0.02, 0.03, 0.01, 0.9, 0.02, 0.01]); // mel dominant (index 4)
  assert.equal(raw.engine, "realvision-experimental");
  assert.equal(raw.generalProbs.length, 7);
  assert.equal(raw.lesionProbs[4].label, "melanoma");
  assert.equal(raw.lesionProbs[1].label, "BCC");
  assert.equal(raw.lesionProbs[5].label, "nevus");
  assert.ok(raw.lesionProbs[4].prob > 0.8);
});

test("analyze() (injected ort/session/decode) -> melanoma output -> SknX REFERS, no Rx", async () => {
  const session = fakeSession([0, 0, 0, 0, 6, 0, 0]); // melanoma dominant
  const raw = await RV.analyze({}, { ort: fakeOrt(), session, decode: fakeDecode });
  assert.equal(raw.engine, "realvision-experimental");
  // the injected model actually received a [1,3,224,224] float32 tensor
  assert.deepEqual(session._lastFeeds.input.dims, [1, 3, 224, 224]);
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
  assert.match(a.referralReason, /melanoma/i);
});

test("analyze() -> benign (nevus) output -> SknX does NOT refer, Rx-eligible", async () => {
  const session = fakeSession([0, 0, 0, 0, 0, 6, 0]); // nevus dominant (index 5)
  const raw = await RV.analyze({}, { ort: fakeOrt(), session, decode: fakeDecode });
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.referral, false);
  assert.equal(a.rxEligible, true);
  assert.equal(a.lesion.top, "nevus");
});

test("available() is false without a DOM (node) so the provider never picks real-vision in tests", () => {
  assert.equal(RV.available(), false);
});
