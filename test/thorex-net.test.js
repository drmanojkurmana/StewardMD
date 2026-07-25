/* test/thorex-net.test.js — ThoreXApiClient: entitlement-aware FormData upload, decode via makeAnalysis.
 * Injects a fake fetchImpl to assert the `entitlement` value is forwarded in the posted FormData and
 * that a successful JSON response is normalized through SMD_THOREX_MODELS.makeAnalysis.
 */
const assert = require("assert");
global.window = { SMD_THOREX_MODELS: require("../thorex-models.js") };
global.FormData = class { constructor(){ this.f = {}; } append(k, v){ this.f[k] = v; } };
global.Blob = class { constructor(p){ this.p = p; } };
const NET = require("../thorex-net.js");
(async () => {
  let sentEnt = null;
  const fetchImpl = async (url, opts) => { sentEnt = opts.body.f.entitlement;
    return { ok: true, status: 200, json: async () => ({ engines: [{ engine: "hf_vit", educational: false, findings: [] }] }) }; };
  const client = NET.makeApiClient({ fetchImpl });
  const a = await client.analyze({ blob: new Blob(["x"]) }, "free", () => {});
  assert.equal(sentEnt, "free", "entitlement forwarded to backend");
  assert.equal(a.engines[0].engine, "hf_vit");
  console.log("ok");
})();
