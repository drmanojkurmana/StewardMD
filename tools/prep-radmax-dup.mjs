#!/usr/bin/env node
// prep-radmax-dup: build Haiku duplicate-check inputs { module, new, live } per module (see work/haiku/INSTR-dup.md).
//
//   node tools/prep-radmax-dup.mjs --dir ~/prep-data/radnotes/max --runs b3 --img-runs i2 --tag d2 \
//     [--assembled out/items-full.json] [--live-rad ../out/overlay/radiology] [--live-srd ../ss/out/v7/ss-radiology/mcq]
//
// New = items of --runs that passed the Haiku fact check (images: also both votes, and only from --img-runs).
// Live = the published bank for the module plus, with --assembled, items already accepted by an earlier assemble,
// so a gap round is checked against everything kept so far. Relative paths resolve against --dir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const L = "ABCD";
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const row = (i) => ({ id: i.id, q: i.q, key: (L[i.a] || "?") + ". " + (i.o ? i.o[i.a] : "") });

/* buildDupInputs -> [{ module, new, live }], at most `per` new items a file (a module larger than that is split). */
export function buildDupInputs({ items, fact, va, vb, imgRuns, liveOf, assembled = [], per = 80 }) {
  const cand = items.filter((i) => fact.get(i.id) && fact.get(i.id).ok === true && (!i.fig || (imgRuns.includes(i.run) && va.get(i.id)?.ok === true && vb.get(i.id)?.ok === true)));
  const seen = new Set(), by = {};
  for (const i of cand) { if (seen.has(i.id)) continue; seen.add(i.id); (by[i.mod] = by[i.mod] || []).push(row(i)); }
  const out = [];
  for (const [m, list] of Object.entries(by)) {
    const live = liveOf(m).map(row).concat(assembled.filter((i) => i.mod === m && !seen.has(i.id)).map(row));
    for (let k = 0; k < list.length; k += per) out.push({ module: m, new: list.slice(k, k + per), live });
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const a = {}; for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
  const dir = path.resolve(a.dir || path.join(os.homedir(), "prep-data/radnotes/max")), hd = path.join(dir, "work/haiku");
  const res = (p) => path.resolve(dir, p);
  const runs = String(a.runs || "").split(",").filter(Boolean), imgRuns = String(a["img-runs"] || "").split(",").filter(Boolean), tag = a.tag;
  if (!runs.length || !tag) throw new Error("--runs RUNS --tag TAG [--img-runs RUNS] [--assembled FILE]");
  const files = fs.readdirSync(hd), load = (re) => files.filter((f) => re.test(f)).flatMap((f) => rj(path.join(hd, f), []));
  const fact = new Map(load(/^fact-out-.*\.json$/).map((v) => [v.id, v]));
  const va = new Map(load(/^vote-a-.*\.json$/).map((v) => [v.id, v])), vb = new Map(load(/^vote-b-.*\.json$/).map((v) => [v.id, v]));
  const items = runs.flatMap((r) => rj(path.join(dir, "work", r, "items.json"), []).map((i) => ({ ...i, run: i.run || r })));
  const rad = res(a["live-rad"] || "../out/overlay/radiology"), srd = res(a["live-srd"] || "../ss/out/v7/ss-radiology/mcq");
  const liveOf = (m) => rj(path.join(m.startsWith("rad-") ? rad : srd, m + ".json"), { items: [] }).items || [];
  const assembled = a.assembled ? rj(res(a.assembled), []) : [];
  const ins = buildDupInputs({ items, fact, va, vb, imgRuns, liveOf, assembled });
  const n = {}; for (const x of ins) { n[x.module] = (n[x.module] || 0); fs.writeFileSync(path.join(hd, `dup-${tag}-${x.module}-${n[x.module]++}.json`), JSON.stringify(x, null, 1)); }
  console.log(`new items ${ins.reduce((s, x) => s + x.new.length, 0)} of ${items.length}; dup files ${ins.length}; modules ${Object.keys(n).length}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
