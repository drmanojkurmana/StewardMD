/* Cloudflare Pages output guard. Pages deploys the repo root, caps a site at
 * 20,000 files and 25 MiB per file, and compiles functions/ separately (they
 * do not count as site files). On 2026-10-13 the static count crossed 20,000
 * (19,734 -> 20,284) and every production build failed for days while OTA
 * kept shipping, so no server code deployed. This test replays the Pages
 * build's exclusion list (scripts/pages-build.sh, the single source of
 * truth) over `git ls-files` and fails well before either cap: at most
 * 19,000 static files and at most 24 MiB per file.
 * node --test test/pages-output.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 19000;
const MAX_BYTES = 24 * 1024 * 1024;

function pagesExclusions() {
  const src = readFileSync(join(ROOT, "scripts/pages-build.sh"), "utf8");
  const m = src.match(/rm -rf \\\n([\s\S]*?)\n\n/);
  assert.ok(m, "scripts/pages-build.sh must keep its single rm -rf list");
  return m[1].replace(/\\/g, " ").split(/\s+/).filter(Boolean);
}

function pagesOutputFiles() {
  const excluded = pagesExclusions().map((p) => p.replace(/\/$/, ""));
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0").filter(Boolean);
  return tracked.filter((f) => {
    if (f.startsWith("functions/")) return false; // compiled separately, not site files
    return !excluded.some((dir) => f === dir || f.startsWith(dir + "/"));
  });
}

test("pages output stays under 19,000 static files", () => {
  const files = pagesOutputFiles();
  assert.ok(files.length <= MAX_FILES,
    `Pages output would ship ${files.length} static files (cap 20,000, guard ${MAX_FILES}). ` +
    "Add the non-runtime directory to scripts/pages-build.sh or move the assets to R2.");
});

test("no pages output file exceeds 24 MiB", () => {
  const over = pagesOutputFiles()
    .map((f) => [f, statSync(join(ROOT, f)).size])
    .filter(([, n]) => n > MAX_BYTES);
  assert.deepEqual(over, [],
    `Files over the 24 MiB guard (Pages cap 25 MiB): ${over.map(([f, n]) => `${f} ${(n / 1048576).toFixed(1)}MiB`).join(", ")}`);
});

test("pages build keeps functions and runtime dirs", () => {
  const excluded = pagesExclusions();
  for (const kept of ["functions", "connect-agent", "atlas", "kb/dist", "prep/lessons", "data", "assets"]) {
    assert.ok(!excluded.includes(kept), `scripts/pages-build.sh must not exclude runtime path ${kept}`);
  }
});
