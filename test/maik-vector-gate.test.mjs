/* test/maik-vector-gate.test.mjs - the hybrid retrieval vector hop obeys the engine policy (audit T07).
 *
 * StewardRAG.buildPackage() runs on the phone for every engine. Its vector arm POSTs the question to
 * /api/retrieve (a server-side AI embedder) under the doctor's Firebase token, and it used to do so in
 * Local mode too. It is a cloud AI call, so it now asks SMD_MAIK_ENGINE.cloudAllowed() first, like
 * image-engine.js and voice.js (test/maik-bypass-gates.test.mjs). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../kb/ai/steward-ai.browser.js", import.meta.url), "utf8");
const body = SRC.slice(SRC.indexOf("function vectorAllowed()"), SRC.indexOf("var TOP_N = 5;"));

function load({ engine, hybrid = null }) {
  const posts = [];
  const win = engine === undefined ? {} : { SMD_MAIK_ENGINE: engine };
  const ls = { getItem: (k) => (k === "smd_hybrid" ? hybrid : null) };
  const fetch = async (url, o) => { posts.push({ url, body: o && o.body }); return { ok: true, json: async () => ({ matches: [{ diseaseId: "dka", score: 0.9 }] }) }; };
  const api = new Function("window", "localStorage", "fetch", "firebase", body + "\nreturn { vectorDiseaseIds: vectorDiseaseIds, smdHybridOn: smdHybridOn };")(win, ls, fetch, undefined);
  return { api, posts };
}

test("Local or KB-only engine: the vector hop is off and nothing is POSTed", async () => {
  for (const pol of [false]) {
    const { api, posts } = load({ engine: { cloudAllowed: () => pol } });
    assert.equal(api.smdHybridOn(), false);
    assert.deepEqual(await api.vectorDiseaseIds("first-line treatment of DKA", 8), []);
    assert.equal(posts.length, 0, "no question left the phone");
  }
});

test("Cloud engine: the vector hop runs as before; smd_hybrid=0 still turns it off", async () => {
  const on = load({ engine: { cloudAllowed: () => true } });
  assert.equal(on.api.smdHybridOn(), true);
  assert.deepEqual(await on.api.vectorDiseaseIds("first-line treatment of DKA", 8), ["dka"]);
  assert.equal(on.posts.length, 1);
  assert.equal(load({ engine: { cloudAllowed: () => true }, hybrid: "0" }).api.smdHybridOn(), false);
});

test("no engine module (a harness): unchanged behaviour; a throwing policy fails closed", async () => {
  assert.equal(load({ engine: undefined }).api.smdHybridOn(), true);
  const bad = load({ engine: { cloudAllowed: () => { throw new Error("x"); } } });
  assert.equal(bad.api.smdHybridOn(), false);
});

test("the comment no longer claims the flag defaults OFF", () => {
  assert.doesNotMatch(SRC, /smd_hybrid, default OFF/);
});
