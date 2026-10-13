#!/usr/bin/env node
// PrepNucleus overlay counts: how many usable items each overlay set adds to each module, so the module and subject
// counts on screen match what practice draws (prep.js loadModule merges the bank file with its overlay files).
// Reads OVERLAYS and the bank version from prep.js, each listed subject's committed index (prep/bank/<ver>/<sid>/index.json),
// asks the bank API for overlay/<set>/<sid>/<module>.json (a 404 adds nothing) and writes prep/bank/overlay-counts.json:
//   { v: 1, gen: "<iso date>", sets: { <set>: { <subject>: { <module>: n } } } }
// An item counts when it has an id and no flags (the app's usable()). Run after an overlay set is uploaded or replaced.
// USAGE: node tools/prep-overlay-counts.mjs [--api https://stewardmd.in/api/prep/bank/] [--out prep/bank/overlay-counts.json] [--pub-root ~/prep-data/qgen/publish]
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg("--api", "https://stewardmd.in/api/prep/bank/").replace(/\/?$/, "/");
const OUT = arg("--out", join(ROOT, "prep/bank/overlay-counts.json"));
const PUB = arg("--pub-root", join(process.env.HOME || "", "prep-data/qgen/publish"));

/* overlaysOf(src, extra) -> { subject: [set, ...] } from prep.js's OVERLAYS default plus any extra sets. */
export function overlaysOf(src, extra) {
  const m = /var OVERLAYS = G\.SMD_PREP_OVERLAYS \|\| (\{[^\n]*?\});/.exec(src);
  if (!m) throw new Error("OVERLAYS not found in prep.js");
  const ov = JSON.parse(m[1].replace(/([{,]\s*)([a-z][a-z0-9-]*)\s*:/gi, '$1"$2":'));
  if (extra && typeof extra === "object") {
    for (const [sid, list] of Object.entries(extra)) {
      const cur = ov[sid] || (ov[sid] = []);
      for (const s of list) if (!cur.includes(s)) cur.push(s);
    }
  }
  return ov;
}
/* usableCount(file) -> items with an id and no flags, each id once. */
export function usableCount(file) {
  const seen = new Set();
  for (const it of (file && file.items) || []) if (it && it.id && !(it.flags && it.flags.length)) seen.add(it.id);
  return seen.size;
}
/* poolCounts(file) -> { tag: usable items carrying that ex tag }. Pool tags are profile ids (bank.pool); the legacy
 * "usmle" vignette tag is not a pool and is skipped, so the usmle count rule in prep.js never changes. */
export function poolCounts(file) {
  const out = {};
  for (const it of (file && file.items) || []) {
    if (!it || !it.id || (it.flags && it.flags.length)) continue;
    for (const t of (it.ex && it.ex.length ? it.ex : [])) {
      if (t === "usmle" || typeof t !== "string") continue;
      out[t] = (out[t] || 0) + 1;
    }
  }
  return out;
}

async function main() {
  const src = fs.readFileSync(join(ROOT, "prep.js"), "utf8");
  const ver = (/VER = G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(src) || [])[1];
  const tax = JSON.parse(fs.readFileSync(join(ROOT, "prep/taxonomy.json"), "utf8"));
  const bv = {}; for (const b of tax.branches) for (const s of b.subjects) bv[s.id] = s.bv || ver;
  let extraSets = null;
  const pubIdx = join(PUB, "maik/index.json");
  if (fs.existsSync(pubIdx)) {
    try { extraSets = JSON.parse(fs.readFileSync(pubIdx, "utf8")).sets; } catch (e) {}
  }
  const ov = overlaysOf(src, extraSets), sets = {}, pools = {};
  for (const [sid, list] of Object.entries(ov)) {
    if (!bv[sid]) continue;
    const indexPath = join(ROOT, "prep/bank", bv[sid], sid, "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const ix = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    for (const set of list) {
      const jobs = ix.topics.map(async (t) => {
        let fileData = null;
        const localFile = join(PUB, set, sid, t.id + ".json");
        if (fs.existsSync(localFile)) {
          try { fileData = JSON.parse(fs.readFileSync(localFile, "utf8")); } catch (_) {}
        }
        if (!fileData) {
          const r = await fetch(API + "overlay/" + set + "/" + sid + "/" + t.id + ".json");
          if (r.status === 404) return;
          if (!r.ok) throw new Error(set + "/" + sid + "/" + t.id + ": HTTP " + r.status);
          fileData = await r.json();
        }
        const n = usableCount(fileData);
        if (n) ((sets[set] ||= {})[sid] ||= {})[t.id] = n;
        for (const [tag, c] of Object.entries(poolCounts(fileData))) {
          ((pools[tag] ||= {})[sid] ||= {})[t.id] = (pools[tag][sid][t.id] || 0) + c;
        }
      });
      await Promise.all(jobs);
    }
  }
  // stable order: sets, subjects and modules sorted
  const sort3 = (o) => { const s = {}; for (const a of Object.keys(o).sort()) { s[a] = {}; for (const b of Object.keys(o[a]).sort()) { s[a][b] = {}; for (const c of Object.keys(o[a][b]).sort()) s[a][b][c] = o[a][b][c]; } } return s; };
  const sorted = sort3(sets), sortedPools = sort3(pools);
  fs.mkdirSync(dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, gen: new Date().toISOString().slice(0, 10), sets: sorted, pools: sortedPools }) + "\n");
  for (const set of Object.keys(sorted)) for (const sid of Object.keys(sorted[set])) {
    const m = sorted[set][sid]; console.log(set + " " + sid + ": " + Object.values(m).reduce((a, b) => a + b, 0) + " items in " + Object.keys(m).length + " modules");
  }
  for (const tag of Object.keys(sortedPools)) for (const sid of Object.keys(sortedPools[tag])) {
    const m = sortedPools[tag][sid]; console.log("pool " + tag + " " + sid + ": " + Object.values(m).reduce((a, b) => a + b, 0) + " items in " + Object.keys(m).length + " modules");
  }
  console.log("wrote " + OUT);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
