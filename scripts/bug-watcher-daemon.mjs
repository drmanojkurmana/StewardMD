#!/usr/bin/env node
/* scripts/bug-watcher-daemon.mjs - Continuous background watcher that processes bug reports with Muse. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processBugs } from "./bug-fixer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUGS_FILE = path.join(ROOT, "debug-bugs.jsonl");

console.log("[BUG-WATCHER] Continuous background bug watcher started.");
console.log(`[BUG-WATCHER] Watching: ${BUGS_FILE}`);

let processing = false;

async function check() {
  if (processing) return;
  processing = true;
  try {
    await processBugs();
  } catch (e) {
    console.error("[BUG-WATCHER] Check error:", e);
  } finally {
    processing = false;
  }
}

// Initial check
check();

// Poll every 5 seconds for new reports
setInterval(check, 5000);
