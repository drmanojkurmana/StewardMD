/* ai-deadline-override.test.mjs - callGemini's opt-in per-call deadline (live 2026-11-27, ResearchMD
 * paper drafts failing gateway_http_502 about half the time).
 *
 * callGemini normally caps the WHOLE call at aiDeadlineMs (28 s) and each attempt at aiTimeoutMs
 * (MAIK_AI_TIMEOUT_MS = 22000 in production). opts.deadlineMs must replace BOTH for that call, so a
 * paper-writing call can use its longer budget, while a caller that passes no option keeps the MaiK
 * chat limits byte-for-byte.
 *
 * The Runware transport (functions/_runware.js) is the provider's HTTP seam: its generate() receives
 * the opts callGemini hands the provider, timeoutMs included, and is what arms the abort. It is wrapped,
 * not replaced, so the real timeout/abort path still runs and the test asserts observed values. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realRunware = await import("../functions/_runware.js");
const seen = { timeouts: [], bodies: [] };
mock.module("../functions/_runware.js", {
  namedExports: Object.assign({}, realRunware, {
    runwareGenerate: async (env, parts, o, fetchImpl) => {
      seen.timeouts.push(o.timeoutMs);
      return realRunware.runwareGenerate(env, parts, o, fetchImpl);
    },
  }),
});

const { callGemini } = await import("../functions/api/ai/[[path]].js");

const RW_OK = { choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };

/* Runware-only env so the provider order is deterministic and no Google path is touched.
 * hang: the fetch never answers until the transport's own abort fires. */
function run(env, opts, hang) {
  seen.timeouts.length = 0;
  seen.bodies.length = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).indexOf("api.runware.ai") >= 0) {
      seen.bodies.push(JSON.parse(init.body));
      if (hang) return new Promise((_, rej) => {
        init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
      return Promise.resolve(new Response(JSON.stringify(RW_OK), { status: 200 }));
    }
    return Promise.resolve(new Response("{}"));
  };
  const t0 = Date.now();
  return callGemini(env, [{ text: "q" }], 100, opts)
    .then((text) => ({ text, ms: Date.now() - t0 }), (err) => ({ err, ms: Date.now() - t0 }))
    .finally(() => { globalThis.fetch = real; });
}

test("no deadlineMs: the per-attempt cap is MAIK_AI_TIMEOUT_MS and a slower provider still fails", async () => {
  const env = { AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", MAIK_AI_TIMEOUT_MS: "2000", MAIK_AI_DEADLINE_MS: "2500" };
  const r = await run(env, {}, true);
  assert.ok(r.err, "a provider slower than the attempt cap must fail, as before");
  assert.deepEqual(seen.timeouts, [2000], "attempt cap stays aiTimeoutMs when no deadlineMs is passed");
  assert.ok(r.ms < 3500, "failed inside the chat deadline (" + r.ms + "ms)");
});

test("deadlineMs: 120000 raises the per-attempt timeout above MAIK_AI_TIMEOUT_MS (22000)", async () => {
  const env = { AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", MAIK_AI_TIMEOUT_MS: "22000", MAIK_AI_DEADLINE_MS: "28000" };
  const r = await run(env, { deadlineMs: 120000 }, false);
  assert.equal(r.text, "ok");
  assert.equal(seen.timeouts.length, 1);
  assert.ok(seen.timeouts[0] > 22000, "provider got " + seen.timeouts[0] + "ms, not the 22s chat cap");
  assert.ok(seen.timeouts[0] <= 120000, "bounded by the requested deadline");
  /* deadlineMs is a scheduling hint, never a request field. */
  assert.equal(seen.bodies[0].deadlineMs, undefined, "deadlineMs must not reach the provider's request body");
  assert.equal(seen.bodies[0].max_completion_tokens, 100);
});

test("an invalid deadlineMs (zero, negative, NaN) falls back to the unchanged chat limits", async () => {
  const env = { AI_PROVIDER: "runware", RUNWARE_API_KEY: "rk", MAIK_AI_TIMEOUT_MS: "22000", MAIK_AI_DEADLINE_MS: "28000" };
  for (const bad of [0, -5, NaN, "120000"]) {
    const r = await run(env, { deadlineMs: bad }, false);
    assert.equal(r.text, "ok");
    assert.ok(seen.timeouts[0] <= 22000, "deadlineMs=" + String(bad) + " ignored (" + seen.timeouts[0] + "ms)");
  }
});

test("the research gateway asks for the 120 s budget (wiring guard)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../functions/api/research/_gateway.js", import.meta.url), "utf8");
  assert.match(src, /LLM_CALL_DEADLINE_MS\s*=\s*120000/);
  assert.match(src, /deadlineMs:\s*LLM_CALL_DEADLINE_MS/);
});