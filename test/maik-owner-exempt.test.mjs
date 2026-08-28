/* test/maik-owner-exempt.test.mjs — an owner must not be capped by a limit meant for regular users.
 *
 * THE INCONSISTENCY THIS FIXES: _usage.js checkQuota already exempts owners from its per-USER
 * throttles (rate limit, daily/monthly token caps, per-category request counts), but the SECOND cap
 * system — _ai_usage.js gateAndCount, the per-module daily cap — did not. So an owner could sail past
 * one layer and be blocked by the next.
 *
 * The exemption is deliberately NARROW, and these tests pin that: metering still runs and the
 * project-wide cost breaker still applies to everyone. Uncapped must not mean invisible.
 *
 * node --test test/maik-owner-exempt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const AIU = readFileSync(new URL("../functions/_ai_usage.js", import.meta.url), "utf8");
const USAGE = readFileSync(new URL("../functions/_usage.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("../functions/_adminauth.js", import.meta.url), "utf8");

test("the per-module daily cap does not block an owner", () => {
  assert.match(AIU, /if \(!q\.ok && !ownerExempt\) return q;/,
    "an owner must not be refused by the per-module cap");
});

test("the per-USER cost cap does not block an owner", () => {
  assert.match(AIU, /if \(costCapOn\(env\) && !ownerExempt\)/,
    "the per-user cost cap is a per-user throttle, so it follows the same rule");
});

test("SAFETY: an exempt owner is still METERED — uncapped is not invisible", () => {
  const fn = AIU.slice(AIU.indexOf("export async function gateAndCount"), AIU.indexOf("export async function gateAndCount") + 2600);
  assert.match(fn, /recordAiUsage\(env, store, buildUsageRecord/, "usage must still be recorded");
  // the recording must NOT be inside an ownerExempt guard
  const recIdx = fn.indexOf("const rec = function ()");
  const guarded = fn.slice(Math.max(0, recIdx - 220), recIdx);
  assert.doesNotMatch(guarded, /if \(ownerExempt\)/, "recording must never be skipped for owners");
});

test("SAFETY: the PROJECT-WIDE cost breaker exempts nobody, owners included", () => {
  // It lives in checkQuota and is evaluated before (and independently of) the `exempt` flag.
  const blk = USAGE.slice(USAGE.indexOf("global circuit breaker"), USAGE.indexOf("per-user rate limit"));
  assert.match(blk, /reason: "circuit-breaker"/, "the breaker must still be able to refuse");
  assert.doesNotMatch(blk, /!exempt/, "the project-wide breaker must not consult the per-user exemption");
});

test("the owner check is the SAME one checkQuota uses — one definition of 'owner'", () => {
  assert.match(API, /Promise\.resolve\(ownerOK\(request, env\)\)/, "the API must use ownerOK");
  assert.match(USAGE, /const admin = await _adminP;/, "checkQuota resolves its owner check the same way");
  assert.match(ADMIN, /export async function ownerOK/, "one shared definition");
});

test("the owner check is started in PARALLEL, so the fix costs no wall time", () => {
  const i = API.indexOf("const _ownerP =");
  assert.ok(i > 0, "the owner check must be kicked off, not awaited inline");
  const j = API.indexOf("await gateAndCount(");
  assert.ok(j > i, "it must start before the call that consumes it");
});

test("appending the parameter cannot break existing callers", () => {
  // Several tests call gateAndCount with the shorter signature; ownerExempt must be last and optional.
  assert.match(AIU, /gateAndCount\(env, store, moduleId, doctorId, subscription, now, email, waitUntil, ownerExempt\)/,
    "ownerExempt must be the LAST parameter so shorter calls still work");
});
