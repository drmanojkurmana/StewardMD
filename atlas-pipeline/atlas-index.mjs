// RadioAnatome search index: atlas/index.json, GENERATED from the shipped modules.
//   {"v":1,"structures":[{"s":"liver","n":"Liver","c":"viscus","m":[["ct-live-torso-axial",7,11]]}]}
// m rows are [moduleId, bestSlice (1-based i), pinnedSliceCount], in catalog order. best is the
// slice carrying the most pins of that structure; ties go to the middle of the tied slices
// (the lower one when their count is even), so a structure pinned once per slice opens at
// the middle of its own extent, not at an edge. Hidden modules and unpinned structures are
// left out: a search hit must lead somewhere. Modules may name one structure differently
// ("Abdominal aorta" on the abdomen stacks, "Aorta" on the torso stacks, which include the
// thoracic aorta); n is the name most modules use, ties to the shortest, i.e. the general one.
// cats: one {label, color} per category id. Modules disagree (csf is "CSF", "Canal" or "Cord";
// airway is two colours), so each takes the value most modules use; a tie goes to the label that
// spells the id itself (csf -> "CSF"), else to the first module alphabetically.
// Write: node atlas-pipeline/atlas-index.mjs   (test/atlas-data.test.mjs re-runs buildIndex
// and fails when the committed file is stale).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function buildIndex(root) {
  const cat = JSON.parse(readFileSync(join(root, "atlas", "modules.json"), "utf8"));
  const by = new Map(), votes = {};
  for (const mod of cat.modules) {
    if (mod.hidden) continue;
    const a = JSON.parse(readFileSync(join(root, "atlas", mod.id, "atlas.json"), "utf8"));
    for (const [c, v] of Object.entries(a.categories || {})) (votes[c] = votes[c] || []).push([mod.id, v.label, v.color]);
    const counts = new Map();                       // structure -> [[i, pins on slice i], ...]
    for (const sl of a.slices) {
      const per = new Map();
      for (const p of sl.pins) per.set(p.s, (per.get(p.s) || 0) + 1);
      for (const [s, n] of per) (counts.get(s) || counts.set(s, []).get(s)).push([sl.i, n]);
    }
    for (const [s, rows] of counts) {
      const top = Math.max(...rows.map((r) => r[1]));
      const tied = rows.filter((r) => r[1] === top).map((r) => r[0]).sort((x, y) => x - y);
      const st = a.structures[s];
      if (!by.has(s)) by.set(s, { s, n: "", c: st.category || "", m: [], names: [] });
      by.get(s).names.push(st.name);
      by.get(s).m.push([mod.id, tied[(tied.length - 1) >> 1], rows.length]);
    }
  }
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const out = [...by.values()].map(({ names, ...e }) => {
    const n = {};
    for (const nm of names) n[nm] = (n[nm] || 0) + 1;
    e.n = Object.keys(n).sort((x, y) => n[y] - n[x] || x.length - y.length || cmp(x, y))[0];
    return e;
  });
  const pick = (rows, k, id) => {
    const n = {}, first = {};
    for (const r of [...rows].sort((x, y) => cmp(x[0], y[0]))) { n[r[k]] = (n[r[k]] || 0) + 1; if (!(r[k] in first)) first[r[k]] = r[0]; }
    return Object.keys(n).sort((x, y) => n[y] - n[x] || (y.toLowerCase() === id) - (x.toLowerCase() === id) || cmp(first[x], first[y]))[0];
  };
  const cats = {};
  for (const c of Object.keys(votes).sort(cmp)) cats[c] = { label: pick(votes[c], 1, c), color: pick(votes[c], 2, c) };
  return { v: 1, cats, structures: out.sort((x, y) => cmp(x.s, y.s)) };
}

export const serialize = (idx) => JSON.stringify(idx) + "\n";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const idx = buildIndex(root);
  writeFileSync(join(root, "atlas", "index.json"), serialize(idx));
  console.log(`atlas/index.json: ${idx.structures.length} structures, ${idx.structures.reduce((t, s) => t + s.m.length, 0)} module rows`);
}
