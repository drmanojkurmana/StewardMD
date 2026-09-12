#!/usr/bin/env node
/* Reachability and wiring gate.
 *
 * A feature is not done because a module exists. It is done when a real user can reach it, the
 * route refuses anyone without the capability, and a test proves it. This checks the links in that
 * chain that a machine can check, and fails the build when one breaks:
 *
 *   domain handler → router → capability (fail-closed) → screen → test
 *
 * Four checks, each with its own reason for existing:
 *
 *   HANDLERS   An exported async (request, env, ctx) in functions/_wardsynq that no other file
 *              calls is a finished capability wired to nothing. This currently stands at zero and
 *              is locked there: the whole 65-route backlog is route-to-screen, not domain-to-route,
 *              and that distinction is worth keeping true.
 *
 *   CAPGUARD   Every capability map in the router must be followed by a fail-closed guard - a route
 *              with no capability named must be refused, never allowed through uncapped. This is
 *              the single most important security invariant in the file and it is one deleted line
 *              away from silently inverting, with no test that would notice.
 *
 *   SCREENS    A route no screen calls cannot be used by anybody. This is the check that found 65
 *              finished-but-unreachable routes.
 *
 *   TESTS      A route no test mentions is a route whose behaviour nobody has pinned down.
 *
 * Baselines, not ignore-lists. Today's debt is recorded so the build is green, and every list may
 * shrink but never grow: a NEW orphan fails, and a gap that gets fixed without being removed from
 * the list also fails, so the numbers can only go down.
 *
 * Usage: node scripts/wardsynq-reachability.mjs [--update-baseline]
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROUTER = join(ROOT, "functions/api/queue/[[path]].js");
const ALLOW = join(ROOT, "scripts/wardsynq-reachability-allow.json");
const DOMAIN = join(ROOT, "functions/_wardsynq");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "functions", "test", "docs", "vault", "prompts",
  "scripts", "www", "dist", "ios", "android", ".claude", "coverage",
]);

/** Any .js/.html outside the backend that talks to the API is a screen. Discovered, not listed. */
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

function readAll(dir, ext, cap = 4 * 1024 * 1024) {
  let blob = "";
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) { blob += readAll(p, ext, cap); continue; }
    if (!name.endsWith(ext) || s.size > cap) continue;
    blob += readFileSync(p, "utf8") + "\n";
  }
  return blob;
}

const cfg = JSON.parse(readFileSync(ALLOW, "utf8"));
const byDesign = new Set(Object.keys(cfg.byDesign || {}));
const knownGaps = new Set(Object.keys(cfg.knownGaps || {}));
const untestedBaseline = new Set(cfg.untestedRoutes || []);

const router = readFileSync(ROUTER, "utf8");
const routes = new Set([...router.matchAll(/\bsub\s*===\s*"([a-z0-9][a-z0-9-]*)"/g)].map((m) => m[1]));

/* ---- CAPGUARD ------------------------------------------------------------------------------ */
/* Every capability map must be followed, within the same block, by a refusal for a route the map
 * does not name. Checked by position rather than by parsing: the guard has to come after the map
 * and before the handlers, and that is exactly what "fail closed" means here. */
const capMaps = [...router.matchAll(/const capFor = \{/g)].map((m) => m.index);
const guards = [...router.matchAll(/if \(!need\)\s*return json\(\{ ok: false, error: "not_found" \}/g)].map((m) => m.index);
const unguarded = capMaps.filter((start) => {
  const next = capMaps.find((s) => s > start);
  const end = next === undefined ? router.length : next;
  return !guards.some((g) => g > start && g < end);
});

/* ---- HANDLERS ------------------------------------------------------------------------------- */
const fnBlob = readAll(join(ROOT, "functions"), ".js");
const orphanHandlers = [];
for (const f of readdirSync(DOMAIN)) {
  if (!f.endsWith(".js")) continue;
  const src = readFileSync(join(DOMAIN, f), "utf8");
  const exported = new Set();
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) exported.add(n);
    }
  }
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) exported.add(m[1]);
  /* Only handler-shaped exports count as capabilities. A constant or a pure helper exported for its
   * own unit test is not an unreachable feature, and treating it as one produced 417 findings that
   * meant nothing - which is how a checker gets switched off. */
  const handlers = new Set([...src.matchAll(/async function ([A-Za-z_$][\w$]*)\s*\(\s*request\s*,\s*env\s*,/g)].map((m) => m[1]));
  const elsewhere = fnBlob.split(src).join("");
  for (const n of exported) {
    if (!handlers.has(n)) continue;
    if (!new RegExp("\\b" + n.replace(/\$/g, "\\$") + "\\b").test(elsewhere)) orphanHandlers.push(f + " :: " + n);
  }
}

/* ---- SCREENS -------------------------------------------------------------------------------- */
const screens = findScreens(ROOT, []);
const blob = screens.map((s) => s[1]).join("\n");
const called = new Set();
for (const m of blob.matchAll(/["'`]\/(?:api\/queue\/)?([a-z0-9-]+)(?:\/([a-z0-9-]+))?/g)) {
  called.add(m[1]);
  if (m[2]) called.add(m[2]);
}
/* Paths built by concatenation - `apiPost("/ward/" + kind)` - cannot be read off a literal, so bare
 * strings count too. But ONLY within sight of an actual API call.
 *
 * This used to accept any quoted word anywhere in any screen file, and that produced FALSE GREENS:
 * the word "discharge" appearing inside the sentence "At discharge" on an unrelated form marked the
 * /ward/discharge route reachable, so a route nobody could reach dropped off the backlog on its
 * own. A checker that reports work as done when it is not is worse than no checker, so the window
 * is the fix: a string has to sit beside the call that might use it. */
const API_WINDOW = 400;
for (const call of blob.matchAll(/api(?:Get|Post)\s*\(|api\/queue/g)) {
  const window = blob.slice(call.index, call.index + API_WINDOW);
  for (const m of window.matchAll(/["'`]([a-z0-9][a-z0-9-]{2,})["'`]/g)) called.add(m[1]);
}
/* ROUTE LOOKUP TABLES. A screen that routes through a map - `var CASH_ACTION_ROUTE = { pay:
 * "invoice-payment", ... }` used later as `apiPost("/ward/" + route)` - declares its route names
 * far from the call, so the window above cannot see them. The table is followed instead of widening
 * the window, because widening it brings back the bare-word false greens this replaced: the word
 * "discharge" used as a STAGE VALUE is not a call to /ward/discharge, and treating it as one is how
 * a route nobody can reach quietly drops off the backlog. */
for (const decl of blob.matchAll(/(?:var|const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\{([^}]*)\}/g)) {
  const ident = decl[1];
  const usedAsPath = new RegExp(
    "[\"'`]/[a-z0-9-]+/?[\"'`]\\s*\\+\\s*" + ident.replace(/\$/g, "\\$") + "\\b"
    + "|\\b" + ident.replace(/\$/g, "\\$") + "\\s*\\[[^\\]]+\\]",
  ).test(blob);
  if (!usedAsPath) continue;
  for (const m of decl[2].matchAll(/["'`]([a-z0-9][a-z0-9-]{2,})["'`]/g)) called.add(m[1]);
}
const orphans = [...routes].filter((r) => !called.has(r) && !byDesign.has(r)).sort();

/* ---- TESTS ---------------------------------------------------------------------------------- */
const testBlob = readAll(join(ROOT, "test"), ".mjs");
const untested = [...routes].filter((r) => !testBlob.includes('"' + r + '"') && !testBlob.includes("/" + r)).sort();

/* ---- baseline update ------------------------------------------------------------------------ */
if (process.argv.includes("--update-baseline")) {
  const gaps = {};
  for (const o of orphans) gaps[o] = cfg.knownGaps?.[o] || "No screen calls this yet.";
  cfg.knownGaps = gaps;
  cfg.untestedRoutes = untested;
  writeFileSync(ALLOW, JSON.stringify(cfg, null, 2) + "\n");
  console.log("Baseline updated: " + orphans.length + " without a screen, " + untested.length + " without a test.");
  process.exit(0);
}

console.log(
  "Screens: " + screens.length + " | routes: " + routes.size
  + " | reachable: " + (routes.size - orphans.length - byDesign.size)
  + " | machine-only: " + byDesign.size
  + " | waiting for a screen: " + orphans.length
  + " | waiting for a test: " + untested.length,
);

let bad = false;
const fail = (title, lines, hint) => {
  bad = true;
  console.error("\n" + title);
  if (hint) console.error(hint);
  for (const l of lines) console.error("  " + l);
};

if (unguarded.length) {
  fail(
    "A capability map is not fail-closed: " + unguarded.length,
    unguarded.map((i) => "at character " + i + " of " + relative(ROOT, ROUTER)),
    "Every capability map must be followed by:\n"
    + '  const need = capFor[sub]; if (!need) return json({ ok: false, error: "not_found" }, 404, request);\n'
    + "Without it a route nobody assigned a capability runs UNCAPPED. This is the file's most\n"
    + "important security invariant and nothing else tests it.",
  );
}

if (orphanHandlers.length) {
  fail(
    "Domain capabilities nothing calls: " + orphanHandlers.length,
    orphanHandlers,
    "These are finished handlers with no route. Wire one, or delete the handler.",
  );
}

const newOrphans = orphans.filter((r) => !knownGaps.has(r));
if (newOrphans.length) {
  fail(
    "New unreachable routes: " + newOrphans.length,
    newOrphans,
    "You added a route no screen calls. Wire up a real screen - not a placeholder - or record it\n"
    + "in " + relative(ROOT, ALLOW) + " under byDesign with a reason.",
  );
}

const fixed = [...knownGaps].filter((r) => !orphans.includes(r)).sort();
if (fixed.length) {
  fail(
    "No longer unreachable - trim the worklist: " + fixed.length,
    fixed,
    "  node scripts/wardsynq-reachability.mjs --update-baseline",
  );
}

const newUntested = untested.filter((r) => !untestedBaseline.has(r));
if (newUntested.length) {
  fail(
    "New routes no test mentions: " + newUntested.length,
    newUntested,
    "Add a test that exercises the route, or record it in the baseline with --update-baseline\n"
    + "only if you have decided it genuinely does not need one.",
  );
}

const staleByDesign = [...byDesign].filter((r) => !routes.has(r)).sort();
if (staleByDesign.length) fail("byDesign entries for routes that no longer exist:", staleByDesign);

if (bad) { console.error(""); process.exit(1); }
console.log(
  orphans.length || untested.length
    ? "No new gaps. Worklist: " + orphans.length + " without a screen, " + untested.length + " without a test."
    : "Every route has a screen and a test.",
);
