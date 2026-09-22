import test from "node:test";
import assert from "node:assert/strict";
import { createConnectAi, routeDiscovery, suggestMappingsWithGemini } from "../../connect-agent/decision-router.mjs";

test("decision router is fail-open to deterministic AgentConnect when keys are absent", async () => {
  const ai = await createConnectAi({ env: {}, fetchFn: async () => { throw new Error("must not call network"); } });
  assert.equal(ai.enabled, false);
  assert.equal(await ai.routeDiscovery({ events: [] }), null);
  assert.equal(await ai.suggestMapping({ operationType: "list_results", resource: "observations", sanitizedShape: {}, unmappedFields: ["code.text"] }), null);
});

test("Jev receives only discovery metadata, never patient values", async () => {
  let body;
  const out = await routeDiscovery({
    spec: {
      events: [{ method: "GET", origin: "https://emr.example", path: "/api/results", status: 200, contentType: "application/json", responseShape: { type: "array" } }]
    },
    apiKey: "test",
    fetchFn: async (_url, opts) => {
      body = JSON.parse(opts.body);
      return new Response(JSON.stringify({ data: { route: "proceed_fast" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(out.route, "proceed_fast");
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("patient"), false);
  assert.equal(serialized.includes("mrn"), false);
  assert.equal(serialized.includes("value"), false);
});

test("Gemini receives a value-free shape and returns bounded mapping JSON", async () => {
  let body;
  const out = await suggestMappingsWithGemini({
    operationType: "list_results",
    resource: "observations",
    sanitizedShape: { type: "object", keys: { test: { type: "string" }, value: { type: "number" } } },
    fixture: { test: "synthetic" },
    unmappedFields: ["code.text"],
    apiKey: "test",
    fetchFn: async (_url, opts) => {
      body = JSON.parse(opts.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ fields: { "code.text": { op: "pick", path: "test" } } }) }] } }] }), { status: 200 });
    }
  });
  assert.equal(out.fields["code.text"].path, "test");
  assert.deepEqual(body.contents[0].parts[0].text.includes("synthetic"), true);
  assert.equal(body.contents[0].parts[0].text.includes("real-patient"), false);
});
