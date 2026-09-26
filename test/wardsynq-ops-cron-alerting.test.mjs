/* test/wardsynq-ops-cron-alerting.test.mjs - OPS-05/F5: a failed/erroring scheduled cron tick (including
 * the one that escalates unacknowledged critical lab results every 5 minutes) must not be silently
 * swallowed. worker/src/index.js's scheduled() cannot be imported directly here - it is a separate
 * Cloudflare Worker package (worker/package.json) whose "jose" dependency is not installed in this
 * worktree's shared node_modules - so this checks the actual source text, the same way
 * test/opd-day-close-whatsapp.test.mjs already asserts on this file's cron wiring.
 *
 * node --test test/wardsynq-ops-cron-alerting.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");

test("OPS-05/F5: the scheduled POST helper checks the response status, logs loudly, and never swallows a failure", () => {
  // Before the fix: `const post = (p) => fetch(...).catch(() => {})` — fetch() only rejects on a
  // network-level failure, so a 401 (rotated admin token), a 500, or the handler's own ok:false body
  // (still HTTP 200) all resolved normally and were never inspected.
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(SRC), "no bare catch-and-discard remains on the scheduled POST");
  const scheduledBody = SRC.slice(SRC.indexOf("async scheduled(event, env, ctx)"));
  assert.match(scheduledBody, /res\.ok/, "the response status is actually checked");
  assert.match(scheduledBody, /console\.error/, "a failure is logged, not silently discarded");
  // A checked-but-unthrown failure would still leave ctx.waitUntil's promise resolved (no ops signal).
  // Rejecting it is what surfaces through Cloudflare's own Worker-error path (dashboard/Logpush/Tail).
  const postFn = scheduledBody.slice(scheduledBody.indexOf("const post ="), scheduledBody.indexOf("if (event.cron"));
  assert.match(postFn, /throw /, "a failed POST rejects, so ctx.waitUntil surfaces it as a Worker error");
});
