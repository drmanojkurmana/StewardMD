import { test } from "node:test";
import assert from "node:assert";
import PROV from "../sknx-providers.js";
import ENG from "../sknx-engines.js";

test("mock analyze resolves an engine-shaped analysis and walks the stages", async () => {
  const stages = [];
  const a = await PROV.analyze({}, "v2beta", (s) => stages.push(s), {
    vision: { available: () => false, analyze: () => Promise.reject(new Error("plugin_unavailable")) },
    engines: ENG
  });
  assert.ok(Array.isArray(a.differential));
  assert.equal(typeof a.referral, "boolean");
  assert.deepEqual(stages, ["quality", "detect", "segment", "classify", "report"]);
});

test("capture wrapper { data } is unwrapped: the vision provider gets the raw image, not the {id,source,data} object", async () => {
  let received;
  await PROV.analyze({ id: "sknx-1", source: "camera", data: "data:image/jpeg;base64,ZZZ" }, "v2beta", () => {}, {
    vision: { available: () => true, analyze: (img) => { received = img; return Promise.resolve({ generalProbs: [{ label: "eczema", prob: 0.6 }], lesionProbs: [], features: {}, engine: "t" }); } },
    engines: ENG
  });
  assert.equal(received, "data:image/jpeg;base64,ZZZ", "vision must receive image.data (raw), not the wrapper");
});

test("a raw image (no wrapper) is passed through unchanged", async () => {
  let received;
  await PROV.analyze("data:image/png;base64,AAAA", "v2beta", () => {}, {
    vision: { available: () => true, analyze: (img) => { received = img; return Promise.resolve({ generalProbs: [], lesionProbs: [], features: {}, engine: "t" }); } },
    engines: ENG
  });
  assert.equal(received, "data:image/png;base64,AAAA");
});

test("a mock melanoma case routes to referral through the real engine logic", async () => {
  const a = await PROV.analyze({ __mock: "melanoma" }, "v2beta", () => {}, {
    vision: { available: () => false, analyze: () => Promise.reject(new Error("x")) },
    engines: ENG
  });
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
});
