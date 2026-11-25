/* test/maik-models-retired.test.mjs - the StewardMD Edge FunctionGemma picker was removed (owner
 * 2026-11-22). A phone that downloaded it gets the file and its markers deleted once at startup;
 * EmbeddingGemma 2 (the On-phone search pack) is untouched. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../maik-models.js", import.meta.url), "utf8");

function boot(native, preset = {}) {
  const m = new Map(Object.entries(preset)), deleted = [];
  const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const Llama = { modelDelete: async (a) => { deleted.push(a.name); } };
  const win = { Capacitor: { isNativePlatform: () => native, Plugins: { Llama } } };
  const mod = { exports: {} };
  new Function("window", "localStorage", "module", "setTimeout", SRC)(win, ls, mod, () => 0);
  return { M: mod.exports, m, deleted };
}

test("FunctionGemma is gone from the packs; EmbeddingGemma 2 search pack stays", () => {
  const { M } = boot(false);
  assert.equal(M.EDGE_FG_ID, undefined);
  assert.throws(() => M.pack("edge-functiongemma"), /unknown pack/);
  assert.match(M.pack(M.EMBED_ID).actual, /EmbeddingGemma 2/);
});

test("purgeRetired deletes the old file and markers once, only on a phone", async () => {
  const { M, m, deleted } = boot(true, { "smd_maik_pack_edge-functiongemma": "1", "smd_maik_packsha_edge-functiongemma": "x", "smd_maik_pack_embedding-gemma-2": "1" });
  assert.equal(await M.purgeRetired(), true);
  assert.deepEqual(deleted, ["functiongemma-270m-it-q8_0.gguf"]);
  assert.equal(m.has("smd_maik_pack_edge-functiongemma"), false);
  assert.equal(m.get("smd_maik_pack_embedding-gemma-2"), "1", "search pack marker untouched");
  assert.equal(await M.purgeRetired(), false, "runs once");
  const web = boot(false);
  assert.equal(await web.M.purgeRetired(), false, "nothing to do off-phone");
});
