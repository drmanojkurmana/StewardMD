/* test/maik-cache.test.mjs — MaiK answer cache: flag gate, safe keying, roundtrip. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerCacheOn, answerCacheKey, getCachedAnswer, putCachedAnswer, cacheTtl } from "../functions/_maik_cache.js";
import { readFileSync } from "node:fs";

// deterministic fake hash so key logic is testable without crypto
const fakeHash = async (s) => Buffer.from(String(s)).toString("base64");   // injective stand-in for sha256hex
const store = () => { const m = new Map(); return { get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); return Promise.resolve(); }, _m: m }; };

test("flag is OFF by default, ON only for truthy env", () => {
  assert.equal(answerCacheOn({}), false);
  assert.equal(answerCacheOn({ MAIK_ANSWER_CACHE: "" }), false);
  assert.equal(answerCacheOn({ MAIK_ANSWER_CACHE: "1" }), true);
  assert.equal(answerCacheOn({ MAIK_ANSWER_CACHE: "true" }), true);
});

test("vague/short questions do NOT get a key (never cache ambiguous)", async () => {
  assert.equal(await answerCacheKey(fakeHash, {}, { question: "dose" }), null);   // 1 word
  assert.equal(await answerCacheKey(fakeHash, {}, { question: "hi" }), null);      // too short
  assert.equal(await answerCacheKey(fakeHash, {}, { question: "" }), null);
  assert.ok(await answerCacheKey(fakeHash, {}, { question: "dose of ceftriaxone" }));
});

test("key is stable for same inputs, differs by depth / audience / model / version", async () => {
  const base = { question: "management of DKA", depth: "std", audience: "consultant", model: "gemini-x" };
  const k1 = await answerCacheKey(fakeHash, { MAIK_CACHE_VERSION: "1" }, base);
  const k2 = await answerCacheKey(fakeHash, { MAIK_CACHE_VERSION: "1" }, base);
  assert.equal(k1, k2);
  assert.ok(k1.startsWith("maik:ans:"));
  assert.notEqual(k1, await answerCacheKey(fakeHash, { MAIK_CACHE_VERSION: "1" }, { ...base, depth: "detailed" }));
  assert.notEqual(k1, await answerCacheKey(fakeHash, { MAIK_CACHE_VERSION: "1" }, { ...base, audience: "student" }));
  assert.notEqual(k1, await answerCacheKey(fakeHash, { MAIK_CACHE_VERSION: "1" }, { ...base, model: "gemini-y" }));
  assert.notEqual(k1, await answerCacheKey(fakeHash, { MAIK_CACHE_VERSION: "2" }, base));   // version bump invalidates
});

test("normalization: punctuation/case/whitespace don't fork the key", async () => {
  const a = await answerCacheKey(fakeHash, {}, { question: "Management of  DKA?" });
  const b = await answerCacheKey(fakeHash, {}, { question: "management of dka" });
  assert.equal(a, b);
});

test("put then get roundtrips; empty text is never stored", async () => {
  const s = store();
  const key = await answerCacheKey(fakeHash, {}, { question: "dose of adrenaline in anaphylaxis" });
  assert.equal(await putCachedAnswer(s, key, { text: "0.5 mg IM 1:1000" }, {}), true);
  const hit = await getCachedAnswer(s, key);
  assert.equal(hit.text, "0.5 mg IM 1:1000");
  assert.equal(await putCachedAnswer(s, key, { text: "" }, {}), false);   // don't cache empties
  assert.equal(await getCachedAnswer(s, "maik:ans:missing"), null);
});

test("TTL: default 14d, clamps to 1..90, invalid → default", () => {
  assert.equal(cacheTtl({}), 14 * 86400);
  assert.equal(cacheTtl({ MAIK_CACHE_TTL_DAYS: "1000" }), 90 * 86400);   // clamp high
  assert.equal(cacheTtl({ MAIK_CACHE_TTL_DAYS: "2" }), 2 * 86400);       // honored
  assert.equal(cacheTtl({ MAIK_CACHE_TTL_DAYS: "0" }), 14 * 86400);      // 0 is invalid → default 14
});

/* The cache was correct but UNREACHABLE: it sat below the live-stream early return, so with
 * MAIK_LIVE_STREAM (or ?livestream=1) on, /explain returned the SSE response before ever touching
 * it - "maik:ans:* stays empty though the KV binding is proven". Pin the wiring, not just the unit. */
const HANDLER = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

test("the answer cache is consulted BEFORE the live-stream early return", () => {
  const cache = HANDLER.indexOf("// \u2500\u2500 Answer cache (flag MAIK_ANSWER_CACHE");
  const stream = HANDLER.indexOf("if (wantStream && liveStream) {");
  assert.ok(cache > 0, "answer-cache block not found in the handler");
  assert.ok(stream > 0, "live-stream block not found in the handler");
  assert.ok(cache < stream, "the answer cache must be read before /explain can return a live stream");
});

test("both answer paths WRITE the cache (stream via waitUntil, non-stream inline)", () => {
  assert.match(HANDLER, /context\.waitUntil\(putCachedAnswer\(/, "the stream path never writes the answer cache");
  assert.match(HANDLER, /if \(_ckey && text\) \{ try \{ await putCachedAnswer\(/, "the non-stream path never writes the answer cache");
});
