/* ai-runware-provider.test.mjs - the Runware (OpenAI-compatible) provider in callGemini's transport.
 * Asserted on observed upstream calls: provider order by AI_PROVIDER, the request translation
 * (model AIR id, system message, image part, JSON mode, max_tokens), the reply translation back to
 * Gemini's shape (text, finishReason, usage), failover, and OpenAI-format SSE parsing. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { callGemini, runwareToGemini } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const { sseFrameText, sseFrameUsage } = await import(new URL("../functions/_sse_parse.js", import.meta.url));

const GEM_OK = { candidates: [{ content: { parts: [{ text: "google" }] }, finishReason: "STOP" }] };
const RW_OK = { choices: [{ message: { role: "assistant", content: "runware" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } };

function run(env, plans, parts, opts) {
  const calls = { vertex: 0, dev: 0, runware: 0 }, bodies = [], headers = [];
  const real = globalThis.fetch;
  const reply = (plan, n, okBody) => {
    const step = plan[Math.min(n, plan.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(step === 200 ? okBody : { error: { message: "x" } }), { status: step }));
  };
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.indexOf("aiplatform") >= 0) return reply(plans.vertex || [200], calls.vertex++, GEM_OK);
    if (u.indexOf("generativelanguage") >= 0) return reply(plans.dev || [200], calls.dev++, GEM_OK);
    if (u.indexOf("api.runware.ai") >= 0) { bodies.push(JSON.parse(init.body)); headers.push(init.headers); return reply(plans.runware || [200], calls.runware++, RW_OK); }
    return Promise.resolve(new Response("{}"));
  };
  return callGemini(env, parts || [{ text: "q" }], 100, opts || {})
    .then((text) => ({ text, calls, bodies, headers }), (err) => ({ err, calls, bodies, headers }))
    .finally(() => { globalThis.fetch = real; });
}

test("AI_PROVIDER=runware: Runware answers first, Google is never called", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", VERTEX_API_KEY: "v", GEMINI_API_KEY: "d" }, {});
  assert.equal(r.text, "runware");
  assert.deepEqual(r.calls, { vertex: 0, dev: 0, runware: 1 });
  assert.equal(r.headers[0].Authorization, "Bearer rk");
});

test("no RUNWARE_API_KEY: Runware is never in the order", async () => {
  const r = await run({ AI_PROVIDER: "runware", VERTEX_API_KEY: "v" }, {});
  assert.equal(r.text, "google");
  assert.equal(r.calls.runware, 0);
});

test("default order: Vertex and developer exhausted (429/403) -> Runware is the last resort", async () => {
  const r = await run({ RUNWARE_API_KEY: "rk", VERTEX_API_KEY: "v", GEMINI_API_KEY: "d" }, { vertex: [429, 429], dev: [403] });
  assert.equal(r.text, "runware");
  assert.deepEqual(r.calls, { vertex: 2, dev: 1, runware: 1 });
});

test("Runware failing (402/5xx) fails over to Google", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", VERTEX_API_KEY: "v" }, { runware: [402] });
  assert.equal(r.text, "google");
  assert.deepEqual(r.calls, { vertex: 1, dev: 0, runware: 1 });
});

test("request translation: AIR model id, system message, max_tokens, temperature, JSON mode", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, [{ text: "hello" }],
    { system: "SYS", json: true, temperature: 0.3, model: "gemini-3.5-flash-lite" });
  const b = r.bodies[0];
  assert.equal(b.model, "google:gemini@3.5-flash-lite");
  assert.deepEqual(b.messages, [{ role: "system", content: "SYS" }, { role: "user", content: "hello" }]);
  assert.equal(b.max_tokens, 100);
  assert.equal(b.temperature, 0.3);
  assert.deepEqual(b.response_format, { type: "json_object" });
  assert.equal(b.stream, undefined);
});

test("RUNWARE_MODEL pins the model for every call", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", RUNWARE_MODEL: "google:gemini@3.8-flash" }, {}, null, { model: "gemini-3.1-flash-lite" });
  assert.equal(r.bodies[0].model, "google:gemini@3.8-flash");
});

test("an image part becomes an image_url data URL", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, [{ text: "read" }, { inline_data: { mime_type: "image/png", data: "QUJD" } }]);
  assert.deepEqual(r.bodies[0].messages[0].content, [{ type: "text", text: "read" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }]);
});

test("an audio part is not sent to Runware; the call fails over to Google", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", VERTEX_API_KEY: "v" }, {}, [{ text: "t" }, { inline_data: { mime_type: "audio/webm", data: "QUJD" } }]);
  assert.equal(r.text, "google");
  assert.equal(r.calls.runware, 0);
});

test("usage and finish reason are carried into opts.meta in Gemini's names", async () => {
  const meta = {};
  await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, null, { meta });
  assert.equal(meta.finishReason, "STOP");
  assert.equal(meta.usage.promptTokenCount, 12);
  assert.equal(meta.usage.candidatesTokenCount, 3);
  assert.equal(meta.model, "google:gemini@3.1-flash-lite");
});

test("runwareToGemini maps length -> MAX_TOKENS and errors to { error }", () => {
  const g = runwareToGemini({ choices: [{ message: { content: "cut" }, finish_reason: "length" }] });
  assert.equal(g.candidates[0].finishReason, "MAX_TOKENS");
  assert.equal(runwareToGemini({ errors: [{ message: "insufficient credits" }] }).error.message, "insufficient credits");
});

test("SSE parser reads OpenAI-format frames and still reads Gemini frames", () => {
  assert.equal(sseFrameText('data: {"choices":[{"delta":{"content":"Hi"}}]}'), "Hi");
  assert.equal(sseFrameText('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}'), "");
  assert.equal(sseFrameText("data: [DONE]"), "");
  assert.equal(sseFrameUsage('data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}').candidatesTokenCount, 7);
  assert.equal(sseFrameText('data: {"candidates":[{"content":{"parts":[{"text":"G"}]}}]}'), "G");
});
