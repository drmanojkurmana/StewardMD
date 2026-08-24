/* test/maik-router-latency.test.mjs — the semantic router must not be paid for twice, and must not
 * be paid for while the clinician waits.
 *
 * MEASURED (production, 2026-08-24): /api/ai/refine costs 6.0-7.7s and runs BEFORE the answer call on
 * every new question. Answer TTFV is ~3.7s on the iPhone, so a new question waited ~9.7s — which is
 * exactly the 9.2s observed on device. The router, not Gemini, was the dominant bottleneck.
 *
 * Two fixes, both of which leave ROUTING QUALITY untouched (same router, same text, same result):
 *   1. server: cache the parse (7.695s -> 1.557s measured, cached:"kv")
 *   2. client: warm it while the clinician is still typing
 *
 * node --test test/maik-router-latency.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const API = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");

/* ---------------------------------------------------------------- server: router cache */

test("the cache is consulted BEFORE the router model call, or it saves nothing", () => {
  const iSeg = API.indexOf('if (seg === "refine" || seg === "route")');
  assert.ok(iSeg > 0, "router handler must exist");
  const iMem = API.indexOf("_routeMem.get(_rkey)", iSeg);
  const iCall = API.indexOf("callGemini(env, [{ text: sys }]", iSeg);
  assert.ok(iMem > iSeg, "in-isolate lookup must be in the router handler");
  assert.ok(iCall > iMem, "the model call must come AFTER the cache lookup");
});

test("the firewall still short-circuits before any cache or model work", () => {
  const iSeg = API.indexOf('if (seg === "refine" || seg === "route")');
  const iFw = API.indexOf("firewallBlock(q)", iSeg);
  const iMem = API.indexOf("_routeMem.get(_rkey)", iSeg);
  assert.ok(iFw > iSeg && iFw < iMem, "a non-medical query must be refused deterministically, first");
});

test("PHI: the raw query is never stored — the KV key is a hash and the value is parser output", () => {
  const blk = API.slice(API.indexOf('if (seg === "refine" || seg === "route")'), API.indexOf('if (seg === "viva-judge")'));
  assert.match(blk, /"maik:route:" \+ \(await sha256hex\(_rkey\)\)/, "key must be a SHA-256, not the query");
  assert.doesNotMatch(blk, /put\(_rkvKey, JSON\.stringify\(\{[^}]*q\b/, "the query text must never be written into the cached value");
  assert.match(blk, /routeMemPut\(_rkey, _routeOut\)/, "only the parsed output is cached");
});

test("a failed or empty parse is never cached — one blip must not be pinned for everyone", () => {
  const blk = API.slice(API.indexOf("const _routeOut = {"), API.indexOf("const _routeOut = {") + 1800);
  assert.match(blk, /if \(_routeOut\.primaryConcept \|\| _routeOut\.ambiguous \|\| _routeOut\.outOfScope\)/,
    "cache only a parse that actually resolved something");
});

test("the in-isolate cache is bounded and oldest-out", () => {
  const fn = API.slice(API.indexOf("function routeMemPut("), API.indexOf("function routeMemPut(") + 420);
  assert.match(fn, /while \(_routeMem\.size > ROUTE_MEM_MAX\)/, "must be bounded — an isolate must not grow without limit");
  assert.match(fn, /_routeMem\.delete\(_routeMem\.keys\(\)\.next\(\)\.value\)/, "oldest-out eviction");
  const m = API.match(/const ROUTE_MEM_MAX = (\d+);/);
  assert.ok(m && Number(m[1]) > 0 && Number(m[1]) <= 2000, "a sane bound");
});

/* ---------------------------------------------------------------- client: route prefetch */

test("the router is warmed while the clinician types, and stays bounded", () => {
  const i = HOME.indexOf("ROUTE PREFETCH");
  assert.ok(i > 0, "the prefetch must exist");
  const blk = HOME.slice(i, i + 1800);
  assert.match(blk, /qEl\.addEventListener\("input"/, "warmed from the composer, not from send");
  assert.match(blk, /getRoute\(cur\)/, "must call the SAME router — routing quality is unchanged, only earlier");
  assert.match(blk, /_preN >= 3/, "bounded: a long edit must not fan out into many metered router calls");
  assert.match(blk, /q\.length < 15/, "needs a reasonably complete question before spending a call");
  assert.match(blk, /setTimeout\(function \(\)[\s\S]{0,320}\}, 1000\)/, "debounced on a real typing pause");
});

test("SAFETY: prefetch is fire-and-forget — send-time routing is unconditional", () => {
  // If a prefetch failure could skip routing at send time, an ambiguous query might get answered
  // instead of disambiguated. Send-time must still call getRoute() exactly as before.
  assert.match(HOME, /var _routeP = _kbOn \? getRoute\(question\)\.catch/,
    "send-time still routes unconditionally; the prefetch only populates the cache");
  const blk = HOME.slice(HOME.indexOf("ROUTE PREFETCH"), HOME.indexOf("ROUTE PREFETCH") + 1800);
  assert.match(blk, /try \{ getRoute\(cur\); \} catch \(e\) \{\}/, "a prefetch error must never surface or block");
});
