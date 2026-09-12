#!/usr/bin/env node
// Reachability checker: a route that exists in the router but that no screen ever
// calls is dead weight. This session found eight such modules by hand; this finds
// them in a second. Run it in CI so a ninth never happens.
//
// Screens are discovered, not listed, so a new screen file is covered automatically.
//
// Two kinds of exemption live in wardsynq-reachability-allow.json:
//   byDesign  - machine-to-machine endpoints no screen should ever call.
//   knownGaps - routes that genuinely need a screen and do not have one yet.
//               This list is a worklist. It may shrink, never grow: a new orphan
//               fails the build, which is the whole point.
//
// Usage: node scripts/wardsynq-reachability.mjs [--update-baseline]
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROUTER = join(ROOT, "functions/api/queue/[[path]].js");
const ALLOW = join(ROOT, "scripts/wardsynq-reachability-allow.json");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "functions", "test", "docs", "vault", "prompts",
  "scripts", "www", "dist", "ios", "android", ".claude", "coverage",
]);

// Any .js/.html outside the backend that talks to the API is a screen.
function findScreens(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) { findScreens(p, out); continue; }
    if (!/\.(js|html)$/.test(name)) continue;
    if (s.size > 4 * 1024 * 1024) continue;
    const text = readFileSync(p, "utf8");
    if (/api\/queue|apiGet\(|apiPost\(/.test(text)) out.push([relative(ROOT, p), text]);
  }
  return out;
}

const cfg = JSON.parse(readFileSync(ALLOW, "utf8"));
const byDesign = new Set(Object.keys(cfg.byDesign || {}));
const knownGaps = new Set(Object.keys(cfg.knownGaps || {}));

const router = readFileSync(ROUTER, "utf8");
const routes = new Set();
for (const m of router.matchAll(/\bsub\s*===\s*"([a-z0-9][a-z0-9-]*)"/g)) routes.add(m[1]);

const screens = findScreens(ROOT, []);
const blob = screens.map((s) => s[1]).join("\n");

// A route counts as called if a screen names it inside a quoted path, or as the
// tail of a path built by concatenation ("/ward/" + kind).
const called = new Set();
for (const m of blob.matchAll(/["'`]\/(?:api\/queue\/)?([a-z0-9-]+)(?:\/([a-z0-9-]+))?/g)) {
  called.add(m[1]);
  if (m[2]) called.add(m[2]);
}
for (const m of blob.matchAll(/["'`]([a-z0-9][a-z0-9-]{2,})["'`]/g)) called.add(m[1]);

const orphans = [...routes].filter((r) => !called.has(r) && !byDesign.has(r)).sort();

if (process.argv.includes("--update-baseline")) {
  const gaps = {};
  for (const o of orphans) gaps[o] = cfg.knownGaps?.[o] || "No screen calls this yet.";
  cfg.knownGaps = gaps;
  writeFileSync(ALLOW, JSON.stringify(cfg, null, 2) + "\n");
  console.log("Baseline updated: " + orphans.length + " known gaps.");
  process.exit(0);
}

const isNew = orphans.filter((r) => !knownGaps.has(r));
// A gap that got wired up, or a route that was deleted, should leave the worklist.
const fixed = [...knownGaps].filter((r) => !orphans.includes(r)).sort();
const staleByDesign = [...byDesign].filter((r) => !routes.has(r)).sort();

console.log("Screens: " + screens.length + " | routes: " + routes.size
  + " | reachable: " + (routes.size - orphans.length - byDesign.size)
  + " | machine-only: " + byDesign.size
  + " | waiting for a screen: " + orphans.length);

let bad = false;

if (isNew.length) {
  bad = true;
  console.error("\nNew unreachable routes: " + isNew.length);
  console.error("You added a route that no screen calls. Wire up a screen, or");
  console.error("record it in " + relative(ROOT, ALLOW) + " under byDesign with a reason.\n");
  for (const o of isNew) console.error("  " + o);
}

if (fixed.length) {
  bad = true;
  console.error("\nThese are no longer unreachable. Remove them from knownGaps:");
  for (const o of fixed) console.error("  " + o);
  console.error("\n  node scripts/wardsynq-reachability.mjs --update-baseline");
}

if (staleByDesign.length) {
  bad = true;
  console.error("\nbyDesign entries for routes that no longer exist:");
  for (const s of staleByDesign) console.error("  " + s);
}

if (bad) { console.error(""); process.exit(1); }
console.log(orphans.length ? "No new gaps. " + orphans.length + " still on the worklist." : "Every route has a screen.");
