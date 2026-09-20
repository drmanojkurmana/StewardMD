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
  "scripts", "www", "dist", "dist-wardsynq", "ios", "android", ".claude", "coverage",
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
    /* The wardsynq.com pages call through the shell's context - `c.api("/mfa/status")` - and never name
     * api/queue, so a page made only of those calls was invisible here, and its routes passed only when
     * some other screen happened to use the same word. */
    if (/api\/queue|apiGet\(|apiPost\(|\bc\.api\(\s*["'`]\//.test(text)) out.push([relative(ROOT, p), text]);
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
/* ROUTES ARE (segment, sub), NOT sub. Matching on the sub name alone let a same-named route in another
 * segment hide a gap: onco's /plan made ward/plan look reachable, and the note template id "progress"
 * made ward/progress look reachable, while neither ward route had a screen. A sub is attributed to the
 * nearest segment check before it. A sub that exists in ONE segment keeps its bare name (so the allow
 * file reads as it always has); a sub in several is labelled seg/sub. */
const segMarks = [...router.matchAll(/\bseg\s*===\s*"([a-z0-9][a-z0-9-]*)"/g)].map((m) => ({ at: m.index, seg: m[1] }));
const routePairs = [];
for (const m of router.matchAll(/\bsub\s*===\s*"([a-z0-9][a-z0-9-]*)"/g)) {
  let seg = null;
  for (const mk of segMarks) { if (mk.at < m.index) seg = mk.seg; else break; }
  routePairs.push({ seg, sub: m[1] });
}
const segsOf = new Map();
for (const { seg, sub } of routePairs) { if (!segsOf.has(sub)) segsOf.set(sub, new Set()); segsOf.get(sub).add(seg); }
const label = (seg, sub) => (segsOf.get(sub).size === 1 ? sub : seg + "/" + sub);
const routes = new Set(routePairs.map((r) => label(r.seg, r.sub)));

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
const called = new Set();
const markPair = (seg, sub) => { const segs = segsOf.get(sub); if (segs && segs.has(seg)) called.add(label(seg, sub)); };
/* A bare word counts only when it names a sub that exists in exactly one segment, or when the
 * segment is known from context. An ambiguous bare word counts for nothing. */
const markBare = (word, ctxSeg) => {
  const segs = segsOf.get(word);
  if (!segs) return;
  if (ctxSeg && segs.has(ctxSeg)) called.add(label(ctxSeg, word));
  else if (segs.size === 1) called.add(word);
};
const SEG_LIT = /["'`]\/(?:api\/queue\/)?([a-z0-9-]+)\/["'`]/;
for (const [, text] of screens) {
  /* HELPERS THAT CARRY A SEGMENT: `function oncoPost(path) { fetch(base + "/api/queue/onco" + path) }`.
   * A call `oncoPost("/plan")` is onco/plan, and nothing else. */
  const helperSeg = new Map();
  for (const h of text.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{([\s\S]{0,600})/g)) {
    const m = h[3].match(new RegExp("[\"'`]/api/queue/([a-z0-9-]+)/?[\"'`]\\s*\\+\\s*" + h[2] + "\\b"));
    if (m) helperSeg.set(h[1], m[1]);
  }
  for (const [name, seg] of helperSeg) {
    for (const c of text.matchAll(new RegExp("\\b" + name.replace(/\$/g, "\\$") + "\\(\\s*[\"'`]/?([a-z0-9-]+)", "g"))) markPair(seg, c[1]);
  }
  for (const m of text.matchAll(/["'`]\/(?:api\/queue\/)?([a-z0-9-]+)(?:\/([a-z0-9-]+))?/g)) {
    if (m[2]) markPair(m[1], m[2]); else markBare(m[1], null);
  }
  /* opd.html's helper takes the path WITHOUT a leading slash - `api("timeline/extend", ...)` - unless
   * the file's own `api` is a segment-bound helper (clinic-billing.html: `api("order")` is bill/order),
   * which the helper pass above already handled. */
  if (!helperSeg.has("api")) {
    for (const m of text.matchAll(/\bapi\(\s*["'`]([a-z0-9-]+)(?:\/([a-z0-9-]+))?/g)) {
      if (m[2]) markPair(m[1], m[2]); else markBare(m[1], null);
    }
  }
  /* Paths built by concatenation - `apiPost("/ward/" + kind)` - within sight of the call, with the
   * segment taken from the literal in the same window. The old pass accepted any quoted word near any
   * call and marked ward/progress reachable off `templateId: "progress"`. */
  const API_WINDOW = 400;
  for (const call of text.matchAll(/api(?:Get|Post)\s*\(|api\/queue/g)) {
    const win = text.slice(call.index, call.index + API_WINDOW);
    const seg = (win.match(SEG_LIT) || [])[1];
    if (!seg) continue;
    for (const m of win.matchAll(/\+\s*["'`]([a-z0-9][a-z0-9-]{2,})["'`]|["'`]([a-z0-9][a-z0-9-]{2,})["'`]\s*:\s*["'`]?/g)) markBare(m[1] || m[2], seg);
  }
  /* ROUTE LOOKUP TABLES: `var CASH_ACTION_ROUTE = { pay: "invoice-payment" }` used as
   * `apiPost("/ward/" + CASH_ACTION_ROUTE[kind])`. The segment comes from that usage. */
  for (const decl of text.matchAll(/(?:var|const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\{([^}]*)\}/g)) {
    const id = decl[1].replace(/\$/g, "\\$");
    const use = text.match(new RegExp("[\"'`]/(?:api/queue/)?([a-z0-9-]+)/[\"'`]\\s*\\+\\s*" + id + "\\b"));
    const indexed = new RegExp("\\b" + id + "\\s*\\[[^\\]]+\\]").test(text);
    if (!use && !indexed) continue;
    for (const m of decl[2].matchAll(/:\s*["'`]([a-z0-9][a-z0-9-]{2,})["'`]/g)) markBare(m[1], use ? use[1] : null);
  }
}
const orphans = [...routes].filter((r) => !called.has(r) && !byDesign.has(r)).sort();

/* ---- TESTS ---------------------------------------------------------------------------------- */
const testBlob = readAll(join(ROOT, "test"), ".mjs");
/* A test names a route by its path. For a sub that exists in several segments only the full
 * /seg/sub path counts; a unique sub may still be named bare. */
const untested = [...new Set(routePairs.map((p) => label(p.seg, p.sub)))].filter((lbl) => {
  const [seg, sub] = lbl.includes("/") ? lbl.split("/") : [null, lbl];
  return seg ? !testBlob.includes("/" + seg + "/" + sub) : (!testBlob.includes('"' + sub + '"') && !testBlob.includes("/" + sub));
}).sort();

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
