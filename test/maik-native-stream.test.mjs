/* test/maik-native-stream.test.mjs — REAL token streaming on native, not a typewriter.
 *
 * REPORTED 2026-08-24: "why no negative streaming... while the LLM is giving output it should also
 * start giving output here, so the user feels the answer is coming rather than a black wait. Fake
 * streaming I don't want."
 *
 * The server has streamed all along (:streamGenerateContent?alt=sse -> text/event-stream with
 * X-Accel-Buffering: no) and reasoning.js already contained a complete, native-aware SSE reader -
 * watchdog, native first-token budget, nsBad cooldown, clean-completion requirement. All of it was
 * unreachable behind a blanket `if (isNative) return fallback();`, so native fetched the WHOLE answer
 * and then typed it out. Nothing appeared until generation had entirely finished.
 *
 * Deleting that line alone would have made it WORSE: on native window.fetch is the CapacitorHttp
 * bridge, which buffers, so a "stream" through it delivers one lump at the end. The pristine
 * window.CapacitorWebFetch is the one that can stream.
 *
 * node --test test/maik-native-stream.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const block = SRC.slice(SRC.indexOf("REAL NATIVE STREAMING"), SRC.indexOf("REAL NATIVE STREAMING") + 4200);

test("REGRESSION: native is no longer short-circuited away from streaming", () => {
  // a real statement starts its line; the phrase also appears in the comment explaining the removal
  assert.equal(/^\s*if \(isNative\) return fallback\(\);\s*$/m.test(SRC), false,
    "the blanket native bail-out must be gone");
});

test("native streams over the PRISTINE fetch, not the buffering bridge", () => {
  assert.match(block, /CapacitorWebFetch/, "the bridge buffers; this one streams");
  assert.match(block, /\.bind\(window\)/, "an unbound fetch throws Illegal invocation");
  assert.match(block, /sfetch = isNative \? pristine/, "native must use it");
});

test("if the pristine fetch is missing we keep the old behaviour rather than buffering", () => {
  assert.match(block, /if \(isNative && \(!nativeStreamOn \|\| !pristine\)\) return fallback\(\);/,
    "streaming through a buffering transport would be worse than not streaming");
});

test("it is reversible from the device", () => {
  assert.match(block, /smd_maik_native_stream/);
  assert.match(block, /!== "0"/, "default ON, '0' reverts");
});

test("SAFETY: a deadline settles even when abort is ignored (the #562 hang)", () => {
  assert.match(SRC, /hardDeadline/);
  assert.match(SRC, /HARD_MS = isNative \? 25000/);
  assert.match(SRC, /Promise\.race\(\[attempt, hardDeadline\]\)/,
    "the attempt must not be the only thing that can settle");
  // and the deadline must resolve with the proven path, not with a partial answer
  const dl = SRC.slice(SRC.indexOf("var hardDeadline"), SRC.indexOf("var hardDeadline") + 700);
  assert.match(dl, /res\(fallback\(\)\)/, "a half-answer must never look complete");
});

test("the deadline timer is cleared when the stream finishes normally", () => {
  assert.match(SRC, /function done\(\) \{ settled = true;[\s\S]{0,160}hardTimer/,
    "otherwise a dangling timer fires after a good answer");
});

test("the existing native safeguards are still in force", () => {
  assert.match(SRC, /FIRST_MS = isNative \? 6000/, "short native first-token budget");
  assert.match(SRC, /nsBad\(true\)/, "cooldown after a native stream failure");
  assert.match(SRC, /if \(acc && \(gotDone \|\| !isNative\)\)/,
    "native accepts streamed text only on CLEAN completion - never a truncated clinical answer");
});

test("the fallback typewriter is budgeted, for when streaming is unavailable", () => {
  // Streaming is the fix; this only governs the path that still fetches-then-replays.
  assert.match(SRC, /function replay\(res, waitedMs\)/);
  assert.match(SRC, /frames = w > 6000 \? 30/, "after a long wait, show it almost at once");
  assert.equal(/words\.length \/ 260/.test(SRC), false, "the flat 4.3s ceiling is gone");
});

test("the server side really does stream (the contract this relies on)", () => {
  const api = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
  assert.match(api, /streamGenerateContent\?alt=sse/, "Gemini is asked to stream");
  assert.match(api, /text\/event-stream/, "and it is relayed as SSE");
  assert.match(api, /X-Accel-Buffering/, "with proxy buffering disabled");
});

/* ── the app must recover its network after the phone sleeps ──────────────── */

test("a lost-network request is retried, then falls back to the WebView stack", () => {
  /* Measured on a Pixel 9, 2026-08-26: after the device slept, EVERY CapacitorHttp request failed
   * with `Unable to resolve host "stewardmd.in"` while the OS pinged the same host in 67ms. It
   * stayed broken until the app was force-restarted, and returned on the next sleep. A surgeon
   * tapped "write to the hospital record", the note was signed, and the send died silently on DNS.
   * Twice, in front of the owner. */
  const src = readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");
  assert.match(src, /function isNetworkLost\(e\)/);
  assert.match(src, /Unable to resolve host\|No address associated with hostname\|UnknownHostException/);
  const fn = src.slice(src.indexOf("function nativeApiFetch"), src.indexOf("if (typeof window.fetch === \"function\")"));
  assert.match(fn, /Http\.request\(reqOpts\)\.catch/, "the first failure must be caught, not surfaced");
  assert.match(fn, /CapacitorWebFetch/, "and fall back to the stack with its own resolver");
  assert.match(fn, /if \(!isNetworkLost\(err\)\) throw err/,
    "a real HTTP error must NOT be retried - only a lost network");
});

test("the failure a clinician sees says what to DO", () => {
  const src = readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");
  assert.match(src, /Close and reopen StewardMD/, '"Failed to fetch" is not actionable');
  assert.match(src, /code = "network_lost"/);
});

test("resume re-warms the resolver, so the first tap is not the failing one", () => {
  const src = readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");
  assert.match(src, /appStateChange/);
  assert.match(src, /if \(!st \|\| !st\.isActive\) return/, "only on coming to the foreground");
  assert.match(src, /catch\(function \(\) \{\}\)|catch\(function \(\)\{\}\)|\.catch\(function \(\) \{\}\)/,
    "fire and forget - the warm-up must never surface an error of its own");
});
