/* test/maik-latency-wins.test.mjs — the three measured latency wins.
 *
 * Grounded in production measurement (n=20, ?diag=1):
 *   Gemini 5,503ms p50 / 11,564ms p95 = 89% of server time
 *   pre-Gemini 763ms p50 (gate 400 + re-rank 360, paid SERIALLY)
 *   thinking tokens 0 on every call; generation is OUTPUT-TOKEN-BOUND:
 *   gen_ms ~= 1389 + 7.8 x outputTokens  (r^2 = 0.76)
 *
 * So: shorten the FIRST answer (two-tier), skip generation entirely when the answer is already known
 * (cache), and stop paying two independent round trips end to end (parallelise). None of these
 * changes the model, the prompt, the KB, or what the clinician can ultimately read.
 *
 * node --test test/maik-latency-wins.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const API = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");

/* ---------------------------------------------------------------- 1. two-tier answers */
test("two-tier answers are ON by default, and reversible", () => {
  const fn = HOME.slice(HOME.indexOf("function maikLazyOn()"), HOME.indexOf("function maikLazyOn()") + 160);
  assert.match(fn, /!== "0"/, "default ON");
  assert.equal(/=== "1"/.test(fn), false, "the old opt-in default must be gone");
  assert.match(fn, /catch \(e\) \{ return true; \}/, "a storage failure must not silently disable it");
});

test("SAFETY: tier 1 must carry everything safety-critical — this is why shortening is legitimate", () => {
  // The server prompt is the guarantee. If this wording ever weakens, two-tier stops being safe.
  assert.match(API, /TIER 1 \(before @@MORE@@\) = the direct answer to what they asked PLUS everything safety-critical/);
  assert.match(API, /NEVER place a red flag, contraindication, or time-critical action after @@MORE@@/);
  assert.match(API, /A rushed clinician must be SAFE reading tier 1 alone/);
});

test("tier 1 is a bottom-line-only instruction, and tier 2 still returns the full depth", () => {
  assert.match(API, /OUTPUT MODE — BOTTOM LINE ONLY/);
  assert.match(API, /body\.tier === 2/, "the depth call exists");
  assert.match(API, /OUTPUT MODE — DETAIL ONLY/);
  // the client must actually be able to fetch tier 2, or tier 1 would be a real content loss
  assert.match(HOME, /explainGrounded\(_ctx\.pkg, \{ tier: 2/, "the 'more' control fetches the depth");
});

/* ---------------------------------------------------------------- 2. answer cache */
/* This used to require `!(body && body.tier)` — "never a tier call". That fence was too wide and it
 * silently disabled the cache for EVERY real user: home.js `maikLazyOn()` is
 * `localStorage.getItem("smd_maik_lazy") !== "0"`, so the app sends `tier: 1` on essentially every
 * question. `maik:ans:*` was still empty in production hours after the reachability fix, and a
 * repeated question still came back slow, because of this line rather than the streaming path.
 *
 * The PHI fences are untouched. What the tier fence actually protected was CORRECTNESS, and only for
 * one tier: tier 1 appends "BOTTOM LINE ONLY" and is a pure function of the question, while tier 2
 * embeds `body.priorLead` verbatim in the prompt — request-specific state that is not in the key, so
 * two callers asking the same thing can legitimately need different detail.
 *
 * So the invariant is now stated properly rather than approximated: cache tier 1 and untiered, never
 * anything carrying priorLead, and put the tier IN THE KEY so a truncated lead can never be served
 * to a request that asked for the whole answer. Behaviour is pinned in
 * test/maik-cache-wiring.test.mjs, which exercises it rather than reading it. */
test("the answer cache stays fenced to generic knowledge", () => {
  const line = API.split("\n").find((l) => l.includes("const _cacheEligible"));
  assert.ok(line, "eligibility must be explicit");
  assert.match(line, /!hasDx/, "never a computed diagnosis");
  assert.match(line, /!maikWiringOn\(env\)/, "never when Connect wiring could carry PHI");
  assert.match(line, /_tierCacheable/, "tier eligibility must be decided explicitly, not inlined");

  const tier = API.split("\n").find((l) => l.includes("const _tierCacheable"));
  assert.ok(tier, "the tier rule must be its own named line");
  assert.match(tier, /_tier === 0 \|\| _tier === 1/, "only untiered and the bottom-line tier");
  assert.match(tier, /priorLead/, "never a follow-up conditioned on the lead already shown");
});

test("the cache key carries the tier, so a bottom line cannot be served as a full answer", () => {
  const CACHE = readFileSync(new URL("../functions/_maik_cache.js", import.meta.url), "utf8");
  assert.match(CACHE, /o\.tier/, "answerCacheKey must take the tier into account");
  assert.match(CACHE, /tier \? \[/, "and only append it when set, so pre-tier entries still hit");
});

/* ---------------------------------------------------------------- 3. parallelise gate + re-rank */
/* These are ORDERING invariants, so assert on positions rather than fixed-size slices — a slice
 * window silently stops covering the code when anything above it grows, which is exactly how these
 * four broke when the gate was bounded. */
const iGateStart = API.indexOf("const _gateP = checkQuota(");
const iRerank = API.indexOf("const _rerankP =");
const iAwait = API.indexOf("const gate = await");

test("the quota gate and the re-rank are started together, not serially", () => {
  assert.ok(iGateStart >= 0, "gate started, not awaited");
  assert.ok(iRerank > iGateStart, "re-rank started alongside it");
  assert.ok(iAwait > iRerank,
    "the re-rank must be kicked off BEFORE the gate is awaited, or nothing is saved");
});

test("SAFETY: the gate's refusal still precedes any answer", () => {
  const blk = API.slice(iAwait, iAwait + 900);
  assert.match(blk, /if \(!gate\.ok\) return json\(\{ error: "quota"/,
    "a refused request must return before generation - neither parallelising nor bounding may reorder that");
  const iRefuse = API.indexOf('if (!gate.ok) return json({ error: "quota"', iAwait);
  assert.ok(iRefuse > iAwait, "the refusal check must come after the gate resolves");
});

test("SAFETY: bounding the gate fails OPEN only on timeout, and says so", () => {
  const blk = API.slice(iAwait - 200, iAwait + 900);
  assert.match(blk, /GATE_MS/, "the bound must be an explicit named budget");
  assert.match(blk, /res\(\{ ok: true, id: null, meter: false, _slow: true \}\)/,
    "a timed-out gate allows the request and marks itself unmetered - it must never fabricate a refusal");
  assert.match(blk, /if \(gate\._slow\) _mark\.gateSlow = true;/,
    "a slow gate must be observable in the diagnostics, not silent");
  const m = API.match(/const GATE_MS = (\d+);/);
  assert.ok(m && Number(m[1]) <= 2000, `gate budget ${m && m[1]}ms must stay small - it is pure dead time`);
});

test("a failed re-rank degrades to the original order, never to an empty list", () => {
  const blk = API.slice(iGateStart, iGateStart + 4000);
  assert.match(blk, /\.catch\(\(\) => null\)/, "a rejected re-rank resolves to null");
  assert.match(blk, /if \(_r\) pkg\.retrieved = _r;/, "null keeps the retrieved evidence untouched");
});

test("the tutor path still skips the Workers AI round trip (main's optimisation survives)", () => {
  const blk = API.slice(iGateStart, iGateStart + 4000);
  assert.match(blk, /!isTutor/, "tutor never starts the cross-encoder");
  assert.match(blk, /isTutor && pkg\.retrieved && pkg\.retrieved\.length > 1\) pkg\.retrieved = lexicalRank/,
    "tutor still gets a sensible in-memory order");
});

test("_didRerank still reports whether the round trip actually happened", () => {
  assert.match(API, /const _didRerank = !!_rerankP;/,
    "the latency breakdown must not attribute a round trip that never ran");
});
