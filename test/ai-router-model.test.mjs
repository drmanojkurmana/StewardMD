/* ai-router-model.test.mjs - the /refine router uses the answer model, JSON mode and a 512 cap (T42). */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));

async function route(env, q) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).indexOf("generateContent") >= 0) {
      seen.push({ url: String(u), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"primaryConcept":"Atrial fibrillation","intent":"treatment"}' }] } }] }));
    }
    return new Response("{}");
  };
  try {
    const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) }), env: Object.assign({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k" }, env), params: { path: ["refine"] }, waitUntil: () => {} });
    return { out: await r.json(), seen };
  } finally { globalThis.fetch = real; }
}

test("router defaults to the configured answer model, in JSON mode, with a 512-token cap", async () => {
  const { out, seen } = await route({ GEMINI_MODEL: "gemini-3.5-flash" }, "af rate control options");
  assert.equal(out.primaryConcept, "Atrial fibrillation");
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /models\/gemini-3\.5-flash:generateContent/);
  assert.equal(seen[0].body.generationConfig.responseMimeType, "application/json");
  assert.equal(seen[0].body.generationConfig.maxOutputTokens, 512);
});

test("MAIK_ROUTER_MODEL still pins the router model", async () => {
  const { seen } = await route({ GEMINI_MODEL: "gemini-3.5-flash", MAIK_ROUTER_MODEL: "gemini-2.5-flash" }, "dvt prophylaxis in pregnancy");
  assert.match(seen[0].url, /models\/gemini-2\.5-flash:generateContent/);
});
