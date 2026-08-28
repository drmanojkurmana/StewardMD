/* test/maik-stream-deadlines.test.mjs — every stream must end, and a stalled one must say so.
 *
 * MEASURED ON DEVICE: 4 of 31 iPhone requests failed, one after a 196-SECOND hang. Cause: the
 * streaming path had no timeout anywhere. The non-streaming path goes through fetchJsonWithTimeout,
 * but geminiStreamUpstream used a bare fetch and the pump awaited reader.read() with no deadline — so
 * a stalled upstream held the SSE open until the phone gave up.
 *
 * Three bounds now: time to OPEN the upstream, time BETWEEN chunks, and TOTAL life. Whichever trips,
 * the stream closes cleanly with a done event carrying stalled:true, so the client settles
 * deterministically and can tell a complete answer from a truncated one.
 *
 * node --test test/maik-stream-deadlines.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const API = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

test("the upstream OPEN is bounded and the signal actually reaches both providers", () => {
  const blk = API.slice(API.indexOf("async function geminiStreamUpstream"), API.indexOf("function streamGeminiToSSE"));
  assert.match(blk, /new AbortController\(\)/, "connect must be abortable");
  assert.match(blk, /streamConnectMs\(env\)/, "with an explicit budget");
  assert.match(blk, /signal: ctrl\.signal/, "the signal must be passed into streamFetch");
  // A signal the provider ignores is decoration — assert both transports forward it to fetch().
  const devFetch = API.slice(API.indexOf("streamFetch: function (env, parts, maxTokens, opts)"), API.indexOf("/* ---- Vertex AI"));
  assert.match(devFetch, /signal: o\.signal/, "developer provider must forward the signal");
  const vtxFetch = API.slice(API.indexOf("streamFetch: async function (env, parts, maxTokens, opts)"), API.indexOf("/* ---- Azure OpenAI"));
  assert.match(vtxFetch, /signal: o\.signal/, "vertex provider must forward the signal");
});

test("the pump races every read against an idle/total budget — no unbounded await", () => {
  const blk = API.slice(API.indexOf("function streamGeminiToSSE"), API.indexOf("// Azure circuit breaker"));
  assert.match(blk, /Promise\.race\(\[reader\.read\(\), timeout\]\)/, "a bare await reader.read() can hang forever");
  assert.match(blk, /Math\.min\(IDLE, DEADLINE - Date\.now\(\)\)/, "budget is the smaller of idle and remaining total");
  assert.match(blk, /reader\.cancel\(\)/, "the abandoned read must be cancelled so the socket is freed");
});

test("every ending goes through one exit that ALWAYS closes the stream", () => {
  // NB: fromIndex matters — streamTextAsSSE has its own earlier `const rs = new ReadableStream`.
  const iFin = API.indexOf("function finish(controller, reason)");
  const fin = API.slice(iFin, API.indexOf("const rs = new ReadableStream", iFin));
  assert.match(fin, /controller\.close\(\)/, "must close");
  assert.match(fin, /done: true/, "must emit a done event so the client settles");
  assert.match(fin, /onText\(full\)/, "usage must still be recorded on every path");
  // the error path must use it too, rather than its own ad-hoc close
  const blk = API.slice(API.indexOf("function streamGeminiToSSE"), API.indexOf("// Azure circuit breaker"));
  assert.match(blk, /catch \(e\) \{\s*try \{ reader\.cancel\(\); \} catch \(e2\) \{\}\s*finish\(controller, "error"\);/,
    "the catch path must cancel and finish, not hand-roll a close");
});

test("SAFETY: a deadline-closed stream is marked stalled, so a partial answer cannot pass as whole", () => {
  // NB: fromIndex matters — streamTextAsSSE has its own earlier `const rs = new ReadableStream`.
  const iFin = API.indexOf("function finish(controller, reason)");
  const fin = API.slice(iFin, API.indexOf("const rs = new ReadableStream", iFin));
  assert.match(fin, /reason \? \{ done: true, stalled: true/,
    "a stream cut short by a deadline MUST be distinguishable from one that finished");
  assert.match(fin, /_tm\.endedBy = reason/, "and the reason must be observable for diagnosis");
});

test("the deadlines are explicit, env-overridable, and sane relative to each other", () => {
  const c = Number((API.match(/MAIK_STREAM_CONNECT_MS[\s\S]{0,90}?: (\d+)/) || [])[1]);
  const i = Number((API.match(/MAIK_STREAM_IDLE_MS[\s\S]{0,90}?: (\d+)/) || [])[1]);
  const t = Number((API.match(/MAIK_STREAM_TOTAL_MS[\s\S]{0,90}?: (\d+)/) || [])[1]);
  assert.ok(c > 0 && i > 0 && t > 0, "all three defaults must exist");
  assert.ok(t > i && i > 0, "total must exceed the idle gap");
  assert.ok(c <= 15000, `connect ${c}ms must stay short — it is paid before anything is shown`);
  assert.ok(t <= 90000, `total ${t}ms must remain a real bound`);
});

test("the streaming call site passes the deadlines through", () => {
  // Anchored on the call, not on a fixed distance — the call site carries extra timing fields now,
  // and a length-capped regex silently stops matching as soon as anything is added to it.
  const i = API.indexOf("streamGeminiToSSE(up,");
  assert.ok(i > 0, "the live-stream call site must exist");
  const call = API.slice(i, i + 700);
  assert.match(call, /idleMs: streamIdleMs\(env\)/, "defaults in the helper are useless if the call site does not pass them");
  assert.match(call, /totalMs: streamTotalMs\(env\)/, "both bounds must be passed");
});
