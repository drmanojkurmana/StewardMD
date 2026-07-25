/* test/thorex-providers.test.js — provider seam: mock analyzer shapes engines by entitlement. */
const assert = require("assert");
global.window = { SMD_THOREX_MODELS: require("../thorex-models.js"), SMD_THOREX_FLAGS: { bool: () => false, get: () => null } };
const P = require("../thorex-providers.js");
(async () => {
  P.use(P.mockProviders());
  const free = await P.current().analyzer.analyze({ id: "i1" }, "free", () => {});
  assert.deepEqual(free.engines.map(e => e.engine), ["hf_vit"]);
  const v1 = await P.current().analyzer.analyze({ id: "i1b" }, "v1", () => {});
  assert.deepEqual(v1.engines.map(e => e.engine), ["torchxrayvision"]);
  const v2 = await P.current().analyzer.analyze({ id: "i2" }, "v2beta", () => {});
  assert.deepEqual(v2.engines.map(e => e.engine), ["torchxrayvision", "xraydar"]);
  assert.equal(v2.engines[1].educational, true, "xraydar must be educational:true");
  console.log("ok");
})();
