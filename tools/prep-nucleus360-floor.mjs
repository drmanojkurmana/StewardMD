#!/usr/bin/env node
/* LINKS-100 guarantee floor: module -> Nucleus360 topic map for items with no target at/above the bar.
 *
 *   node tools/prep-nucleus360-floor.mjs --topics prep/nucleus360/topics.json --modules a,b --out /tmp/floor.json
 *   node tools/prep-nucleus360-floor.mjs --gaps          plan over the current gap report, $0
 *
 * Honesty rule: DIRECT membership only. A module maps to a topic only when the topic's own modules list
 * names that (subject, module) pair. Title-term overlap guesses never ship: a wrong walkthrough link is
 * worse than none. Modules with no covering topic stay unmapped until the Nucleus360 topic pipeline
 * (prep/nucleus360/topics.json, #1523 pattern) covers them; lessons keep shrinking that remainder.
 *
 * The answered-MCQ row (#1518) renders the fallback as "Cover this topic with Nucleus360" (a topic
 * walkthrough, labelled honestly, never as a lesson) via the n360-topic route. This file owns the map;
 * prep-reason.js stays with its workers (hook documented in LINKS-100-DONE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

/* floorTopicFor(mid, sid, topicsDoc) -> topic id or null. Direct membership only. */
export function floorTopicFor(mid, sid, topicsDoc) {
  for (const t of (topicsDoc && topicsDoc.topics) || []) {
    for (const [s, m] of t.modules || []) if (m === mid && (!sid || s === sid)) return t.id;
  }
  return null;
}
/* buildFloorMap(entries, topicsDoc) -> { map, uncovered }: entries = [{ mid, sid }]. */
export function buildFloorMap(entries, topicsDoc) {
  const map = {}, uncovered = [];
  for (const e of entries || []) {
    const tid = floorTopicFor(e.mid, e.sid, topicsDoc);
    if (tid) map[e.mid] = tid;
    else uncovered.push(e.mid);
  }
  return { map, uncovered };
}

async function main() {
  const topicsDoc = readJ(path.join(ROOT, arg("--topics", "prep/nucleus360/topics.json"))) || readJ(arg("--topics", ""));
  if (!topicsDoc) { console.error("no topics.json (PR #1523 not in this tree?)"); process.exit(2); }
  if (argv.includes("--gaps")) {
    const gaps = readJ("/tmp/gap-full.json");
    const rows = gaps ? gaps.rows : [];
    const entries = rows.map((r) => ({ mid: r.mid, sid: r.sids.split(",")[0] }));
    const { map, uncovered } = buildFloorMap(entries, topicsDoc);
    console.log(JSON.stringify({ gapModules: entries.length, floored: Object.keys(map).length, uncovered: uncovered.length }));
    return;
  }
  const want = arg("--modules", "all");
  const gaps = readJ("/tmp/gap-full.json");
  let entries = (gaps ? gaps.rows : []).map((r) => ({ mid: r.mid, sid: r.sids.split(",")[0] }));
  if (want !== "all") { const set = new Set(want.split(",")); entries = entries.filter((e) => set.has(e.mid)); }
  const { map, uncovered } = buildFloorMap(entries, topicsDoc);
  const out = { v: 1, gen: new Date().toISOString().slice(0, 10), topics: (topicsDoc.topics || []).length, map };
  const dest = arg("--out", "");
  if (dest) { fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n"); }
  console.log(JSON.stringify({ mapped: Object.keys(map).length, uncovered: uncovered.length, uncoveredSample: uncovered.slice(0, 10) }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
