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
test("the answer cache stays fenced to generic knowledge", () => {
  const line = API.split("\n").find((l) => l.includes("const _cacheEligible"));
  assert.ok(line, "eligibility must be explicit");
  assert.match(line, /!hasDx/, "never a computed diagnosis");
  assert.match(line, /!\(body && body\.tier\)/, "never a tier call");
  assert.match(line, /!maikWiringOn\(env\)/, "never when Connect wiring could carry PHI");
});

/* ---------------------------------------------------------------- 3. parallelise gate + re-rank */
test("the quota gate and the re-rank are started together, not serially", () => {
  const blk = API.slice(API.indexOf("const _gateP"), API.indexOf("const _gateP") + 700);
  assert.match(blk, /const _gateP = checkQuota\(/, "gate started, not awaited");
  assert.match(blk, /const _rerankP =/, "re-rank started alongside it");
  assert.ok(blk.indexOf("const _rerankP") < blk.indexOf("await _gateP"),
    "the re-rank must be kicked off BEFORE the gate is awaited, or nothing is saved");
});

test("SAFETY: the gate's refusal still precedes any answer", () => {
  const blk = API.slice(API.indexOf("const _gateP"), API.indexOf("const _gateP") + 900);
  assert.match(blk, /const gate = await _gateP;[\s\S]{0,200}if \(!gate\.ok\) return json\(\{ error: "quota"/,
    "a refused request must return before generation - parallelising must not reorder that");
});

test("a failed re-rank degrades to the original order, never to an empty list", () => {
  const blk = API.slice(API.indexOf("const _gateP"), API.indexOf("const _gateP") + 2600);
  assert.match(blk, /\.catch\(\(\) => null\)/, "a rejected re-rank resolves to null");
  assert.match(blk, /if \(_r\) pkg\.retrieved = _r;/, "null keeps the retrieved evidence untouched");
});

test("the tutor path still skips the Workers AI round trip (main's optimisation survives)", () => {
  const blk = API.slice(API.indexOf("const _gateP"), API.indexOf("const _gateP") + 2600);
  assert.match(blk, /!isTutor/, "tutor never starts the cross-encoder");
  assert.match(blk, /isTutor && pkg\.retrieved && pkg\.retrieved\.length > 1\) pkg\.retrieved = lexicalRank/,
    "tutor still gets a sensible in-memory order");
});

test("_didRerank still reports whether the round trip actually happened", () => {
  assert.match(API, /const _didRerank = !!_rerankP;/,
    "the latency breakdown must not attribute a round trip that never ran");
});
