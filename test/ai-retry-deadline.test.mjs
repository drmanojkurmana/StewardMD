/* ai-retry-deadline.test.mjs - callGemini's retry budget (audit T16).
 * Vertex (express key) is primary, the developer key is the failover. Asserted on observed upstream
 * calls: no same-provider retry after a 4xx or a timeout, one retry on 5xx/429, failover still
 * happens, HTTP 400 fails fast, and the whole call stays inside one wall-clock deadline. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { callGemini } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const OK = { candidates: [{ content: { parts: [{ text: "fine" }] }, finishReason: "STOP" }] };

function run(vertexPlan, devPlan, env) {
  const calls = { vertex: 0, dev: 0 };
  const real = globalThis.fetch;
  const reply = (plan, n, init) => {
    const step = plan[Math.min(n, plan.length - 1)];
    if (step === "hang") return new Promise((_, rej) => { init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); });
    if (step === "net") return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(new Response(JSON.stringify(step === 200 ? OK : { error: { message: "x" } }), { status: step }));
  };
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.indexOf("aiplatform") >= 0) return reply(vertexPlan, calls.vertex++, init);
    if (u.indexOf("generativelanguage") >= 0) return reply(devPlan, calls.dev++, init);
    return Promise.resolve(new Response("{}"));
  };
  const t0 = Date.now();
  return callGemini(Object.assign({ VERTEX_API_KEY: "v", GEMINI_API_KEY: "d" }, env || {}), [{ text: "q" }], 100, {})
    .then((text) => ({ text, calls, ms: Date.now() - t0 }), (err) => ({ err, calls, ms: Date.now() - t0 }))
    .finally(() => { globalThis.fetch = real; });
}

test("5xx on Vertex: one retry, then failover to the developer key", async () => {
  const r = await run([500, 503], [200]);
  assert.equal(r.text, "fine");
  assert.deepEqual(r.calls, { vertex: 2, dev: 1 });
});

test("429 on Vertex retries once; success on the retry never touches the developer key", async () => {
  const r = await run([429, 200], [200]);
  assert.deepEqual(r.calls, { vertex: 2, dev: 0 });
});

test("a 4xx (403) on Vertex is NOT retried on Vertex, but still fails over", async () => {
  const r = await run([403], [200]);
  assert.equal(r.text, "fine");
  assert.deepEqual(r.calls, { vertex: 1, dev: 1 });
});

test("HTTP 400 (malformed request) fails fast: no retry, no failover", async () => {
  const r = await run([400], [200]);
  assert.ok(r.err);
  assert.deepEqual(r.calls, { vertex: 1, dev: 0 });
});

test("a timeout is not retried on the same provider; failover gets the remaining time", async () => {
  const r = await run(["hang"], [200], { MAIK_AI_TIMEOUT_MS: "2000", MAIK_AI_DEADLINE_MS: "6000" });
  assert.equal(r.text, "fine");
  assert.deepEqual(r.calls, { vertex: 1, dev: 1 });
  assert.ok(r.ms < 3500, "one timeout, then an immediate failover (" + r.ms + "ms)");
});

test("the whole call is bounded by ONE deadline, retries and failover included", async () => {
  const r = await run(["hang"], ["hang"], { MAIK_AI_TIMEOUT_MS: "3000", MAIK_AI_DEADLINE_MS: "4500" });
  assert.ok(r.err, "everything hung, so it must fail");
  assert.ok(r.ms < 5200, "stayed inside the 4.5s deadline (" + r.ms + "ms)");
  assert.deepEqual(r.calls, { vertex: 1, dev: 0 }, "1.5s left after the first timeout is under the 2s minimum attempt");
});

test("defaults: the deadline is 28s, under the native client's timeout", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
  assert.match(src, /MAIK_AI_DEADLINE_MS[\s\S]{0,120}: 28000/);
});
