/* ai-runware-provider.test.mjs - the Runware (OpenAI-compatible) provider in callGemini's transport.
 * Asserted on observed upstream calls: provider order by AI_PROVIDER, the request translation
 * (model AIR id, system message, image part, JSON mode, max_completion_tokens, reasoning_effort), the reply translation back to
 * Gemini's shape (text, finishReason, usage), failover, and OpenAI-format SSE parsing. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { callGemini, runwareToGemini } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const { sseFrameText, sseFrameUsage } = await import(new URL("../functions/_sse_parse.js", import.meta.url));

const GEM_OK = { candidates: [{ content: { parts: [{ text: "google" }] }, finishReason: "STOP" }] };
const RW_NATIVE_OK = { data: [{ taskType: "textInference", text: "native", finishReason: "stop", usage: { promptTokens: 9, completionTokens: 2, totalTokens: 11 } }] };
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
    if (u.indexOf("api.runware.ai") >= 0) { bodies.push(JSON.parse(init.body)); headers.push(init.headers); return reply(plans.runware || [200], calls.runware++, u.endsWith("/v1") ? RW_NATIVE_OK : RW_OK); }
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

test("request translation: GPT-6 Luna by default (a Google model name is not mapped), max_completion_tokens, reasoning none, JSON mode", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, [{ text: "hello" }],
    { system: "SYS", json: true, temperature: 0.3, model: "gemini-2.5-flash" });
  const b = r.bodies[0];
  assert.equal(b.model, "openai:gpt@6-luna");
  assert.deepEqual(b.messages, [{ role: "system", content: "SYS" }, { role: "user", content: "hello" }]);
  assert.equal(b.max_completion_tokens, 100);
  assert.equal(b.max_tokens, undefined);
  assert.equal(b.reasoning_effort, "none");
  assert.equal(b.temperature, 0.3);
  assert.deepEqual(b.response_format, { type: "json_object" });
  assert.equal(b.stream, undefined);
});

test("RUNWARE_MODEL pins the model for every call", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", RUNWARE_MODEL: "google:gemini@3.8-flash" }, {}, null, { model: "gemini-3.1-flash-lite" });
  assert.equal(r.bodies[0].model, "google:gemini@3.8-flash");
  const air = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, null, { model: "google:gemini@3.1-flash-lite" });
  assert.equal(air.bodies[0].model, "google:gemini@3.1-flash-lite");
  const off = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", RUNWARE_REASONING: "off" }, {});
  assert.equal(off.bodies[0].reasoning_effort, undefined);
});

test("an image part goes to Chat Completions (GPT-6 Luna) as an image_url data URI", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, [{ text: "read" }, { inline_data: { mime_type: "image/png", data: "QUJD" } }], { system: "S" });
  assert.equal(r.text, "runware");
  const b = r.bodies[0];
  assert.equal(b.model, "openai:gpt@6-luna");
  assert.deepEqual(b.messages, [{ role: "system", content: "S" },
    { role: "user", content: [{ type: "text", text: "read" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] }]);
});

test("an audio part goes to the native task API on Gemini 3.1 Flash Lite as inputs.audios (base64)", async () => {
  const r = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", VERTEX_API_KEY: "v", RUNWARE_MODEL: "openai:gpt@6-luna" }, {},
    [{ text: "transcribe" }, { inline_data: { mime_type: "audio/mp4", data: "QUJD" } }, { inline_data: { mime_type: "image/png", data: "SU1H" } }], { system: "S" });
  assert.equal(r.text, "native");
  assert.equal(r.calls.vertex, 0);
  const t = r.bodies[0][0];
  assert.equal(t.taskType, "textInference");
  assert.equal(t.model, "google:gemini@3.1-flash-lite");
  assert.deepEqual(t.messages, [{ role: "user", content: "transcribe" }]);
  assert.deepEqual(t.inputs, { images: ["data:image/png;base64,SU1H"], audios: ["QUJD"] });
  assert.equal(t.settings.systemPrompt, "S");
  assert.equal(t.settings.thinkingLevel, "minimal");
  assert.equal(t.settings.maxTokens, 100);
  const pin = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", RUNWARE_NATIVE_MODEL: "google:gemini@3.1-pro" }, {}, [{ inline_data: { mime_type: "application/pdf", data: "UERG" } }]);
  assert.equal(pin.bodies[0][0].model, "google:gemini@3.1-pro");
  assert.deepEqual(pin.bodies[0][0].inputs, { documents: ["UERG"] });
  const webm = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, [{ text: "t" }, { inline_data: { mime_type: "audio/webm", data: "V0VC" } }]);
  assert.deepEqual(webm.bodies[0][0].inputs, { videos: ["V0VC"] });   // Runware refuses webm as audio
});

test("live-shaped native reply (2026-11-14 capture) translates to Gemini's shape", async () => {
  const { nativeToGemini } = await import(new URL("../functions/_runware.js", import.meta.url));
  const g = nativeToGemini({ data: [{ taskUUID: "u", taskType: "textInference", text: "Blood pressure 120 over 80.", finishReason: "stop",
    usage: { promptTokens: 68, completionTokens: 11, totalTokens: 79, costBreakdown: {} } }] });
  assert.equal(g.candidates[0].content.parts[0].text, "Blood pressure 120 over 80.");
  assert.equal(g.candidates[0].finishReason, "STOP");
  assert.equal(g.usageMetadata.promptTokenCount, 68);
  const e = nativeToGemini({ data: [], errors: [{ code: "invalidModel", message: "Invalid value for 'model'." }] });
  assert.equal(e.error.message, "Invalid value for 'model'.");
});

test("a pinned caller (PrepNucleus pins vertex) still reaches Runware: first under AI_PROVIDER=runware, else after", async () => {
  const a = await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", VERTEX_API_KEY: "v" }, {}, null, { providers: ["vertex"] });
  assert.deepEqual(a.calls, { vertex: 0, dev: 0, runware: 1 });
  const b = await run({ RUNWARE_API_KEY: "rk", VERTEX_API_KEY: "v" }, { vertex: [429, 429] }, null, { providers: ["vertex"] });
  assert.equal(b.text, "runware");
  const c = await run({ VERTEX_API_KEY: "v" }, { vertex: [429, 429] }, null, { providers: ["vertex"] });
  assert.ok(c.err);
});

test("usage and finish reason are carried into opts.meta in Gemini's names", async () => {
  const meta = {};
  await run({ AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk" }, {}, null, { meta });
  assert.equal(meta.finishReason, "STOP");
  assert.equal(meta.usage.promptTokenCount, 12);
  assert.equal(meta.usage.candidatesTokenCount, 3);
  assert.equal(meta.model, "openai:gpt@6-luna");
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

test("FundX: Runware joins the vision and clinical orders; reads the image via Chat Completions", async () => {
  const fx = await import(new URL("../functions/_fundx_ai.js", import.meta.url));
  const prod = { CF_PAGES_BRANCH: "main", RUNWARE_API_KEY: "rk" };
  assert.equal(fx.visionOrder(Object.assign({ AI_PROVIDER: "runware" }, prod))[0], "runware");
  assert.equal(fx.clinicalOrder(prod).slice(-1)[0], "runware");
  assert.ok(fx.visionOrder({ CF_PAGES_BRANCH: "main" }).indexOf("runware") < 0);
  const real = globalThis.fetch; let body = null;
  globalThis.fetch = (url, init) => { body = JSON.parse(init.body); return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' }, finish_reason: "stop" }] }), { status: 200 })); };
  try {
    const out = await fx.PROVIDERS.runware.generate({ RUNWARE_API_KEY: "rk" }, { system: "S", user: "U", imageDataUrl: "data:image/jpeg;base64,QUJD" }, { maxTokens: 50 });
    assert.equal(out, '{"ok":1}');
    assert.equal(body.model, "openai:gpt@6-luna");
    assert.deepEqual(body.messages[1].content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
    assert.deepEqual(body.response_format, { type: "json_object" });
  } finally { globalThis.fetch = real; }
});
