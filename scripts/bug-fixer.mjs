#!/usr/bin/env node
/* scripts/bug-fixer.mjs - Automated background bug watcher and fixer leveraging Muse.
 *
 * Scans debug-bugs.jsonl for new bug reports.
 * For each unprocessed bug:
 *   1. Extracts location, selector, user description, and console errors.
 *   2. Runs analysis and invokes `muse exec --yolo --trust-workspace` to inspect and fix.
 *   3. Runs reachability and regression test gates.
 *   4. If tests pass, commits with the required trailer and publishes.
 *   5. Marks the bug as resolved in debug-bugs-fixed.jsonl.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUGS_FILE = path.join(ROOT, "debug-bugs.jsonl");
const FIXED_FILE = path.join(ROOT, "debug-bugs-fixed.jsonl");
const FAILED_FILE = path.join(ROOT, "debug-bugs-failed.jsonl");
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;
const GATE_TIMEOUT_MS = 120000;
const MUSE = "/Users/diwakarkumar/.local/bin/muse";

function getProcessedIds() {
  if (!fs.existsSync(FIXED_FILE)) return new Set();
  const ids = new Set();
  const lines = fs.readFileSync(FIXED_FILE, "utf8").trim().split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const obj = JSON.parse(l);
      if (obj.id) ids.add(obj.id);
    } catch (e) {}
  }
  return ids;
}

function getRecentFailures(now = Date.now()) {
  if (!fs.existsSync(FAILED_FILE)) return new Map();
  const last = new Map();
  const lines = fs.readFileSync(FAILED_FILE, "utf8").trim().split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const obj = JSON.parse(l);
      if (obj.id && obj.failedAt) last.set(obj.id, new Date(obj.failedAt).getTime());
    } catch (e) {}
  }
  for (const [id, t] of last) {
    if (!Number.isFinite(t) || now - t >= RETRY_COOLDOWN_MS) last.delete(id);
  }
  return last;
}

function recordFailure(bug, reason) {
  const record = {
    id: bug.id,
    failedAt: new Date().toISOString(),
    location: bug.location,
    description: bug.description,
    status: "FAILED",
    reason,
  };
  fs.appendFileSync(FAILED_FILE, JSON.stringify(record) + "\n", "utf8");
}

function getUnprocessedBugs() {
  if (!fs.existsSync(BUGS_FILE)) return [];
  const processed = getProcessedIds();
  const coolingDown = getRecentFailures();
  const bugs = [];
  const lines = fs.readFileSync(BUGS_FILE, "utf8").trim().split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const b = JSON.parse(l);
      if (b.id && !processed.has(b.id) && !coolingDown.has(b.id)) bugs.push(b);
    } catch (e) {}
  }
  return bugs;
}

export { getProcessedIds, getUnprocessedBugs, getRecentFailures, recordFailure };

export async function processBugs() {
  const pending = getUnprocessedBugs();
  if (!pending.length) {
    console.log("[BUG-FIXER] No new bugs to process.");
    return [];
  }

  console.log(`[BUG-FIXER] Found ${pending.length} new bug report(s).`);
  const results = [];

  for (const bug of pending) {
    console.log(`\n=== [BUG-FIXER] Processing Bug #${bug.id} ===`);
    console.log(`Location: ${bug.location}`);
    console.log(`Description: ${bug.description}`);
    if (bug.targetElement) {
      console.log(`Target: ${bug.targetElement.selector} ("${bug.targetElement.snippet || ""}")`);
    }

    // Compose prompt for Muse
    const prompt = `Fix this reported bug in WardSynQ:
Bug ID: ${bug.id}
Location: ${bug.location}
URL: ${bug.context ? bug.context.url : "N/A"}
Target element: ${bug.targetElement ? JSON.stringify(bug.targetElement) : "N/A"}
User description: ${bug.description}
Console errors: ${bug.errors && bug.errors.length ? JSON.stringify(bug.errors, null, 2) : "None"}

Please:
1. Locate the relevant UI or backend files (check ward.js, wardsynq/site, or functions/_wardsynq).
2. Fix the bug cleanly.
3. Verify that the fix does not break reachability or any existing tests.
`;

    console.log("[BUG-FIXER] Invoking Muse to investigate and resolve...");
    try {
      const museRes = spawnSync(MUSE, ["exec", "--yolo", "--trust-workspace", "--reasoning-effort", "medium", prompt], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 180000,
        env: process.env,
      });
      console.log("[BUG-FIXER] Muse output:\n", (museRes.stdout || "").slice(-500));
      if (museRes.status !== 0) {
        const reason = museRes.error ? museRes.error.message : `muse exited with code ${museRes.status}`;
        console.error("[BUG-FIXER] Muse failed for bug #" + bug.id + ":", reason, museRes.stderr);
        recordFailure(bug, reason);
        continue;
      }

      // Run validation gates
      console.log("[BUG-FIXER] Running reachability gate...");
      const reach = spawnSync("node", ["scripts/wardsynq-reachability.mjs"], { cwd: ROOT, encoding: "utf8", timeout: GATE_TIMEOUT_MS });
      if (reach.status !== 0) {
        console.error("[BUG-FIXER] Reachability failed after Muse edit:", reach.stdout, reach.stderr);
        recordFailure(bug, "reachability gate failed");
        continue;
      }

      console.log("[BUG-FIXER] Running tests...");
      const test = spawnSync("node", ["--test", "--experimental-test-module-mocks", "test/wardsynq-reachability.test.mjs"], { cwd: ROOT, encoding: "utf8", timeout: GATE_TIMEOUT_MS });
      if (test.status !== 0) {
        console.error("[BUG-FIXER] Tests failed:", test.stderr);
        recordFailure(bug, "regression tests failed");
        continue;
      }

      // Record success
      const record = {
        id: bug.id,
        fixedAt: new Date().toISOString(),
        location: bug.location,
        description: bug.description,
        status: "RESOLVED",
      };
      fs.appendFileSync(FIXED_FILE, JSON.stringify(record) + "\n", "utf8");
      results.push(record);
      console.log(`[BUG-FIXER] Successfully resolved and verified Bug #${bug.id}`);
    } catch (err) {
      console.error(`[BUG-FIXER] Error processing bug #${bug.id}:`, err);
      try { recordFailure(bug, String((err && err.message) || err)); } catch (e) {}
    }
  }

  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  processBugs();
}
