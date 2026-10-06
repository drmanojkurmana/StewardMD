// Builds tokos/decks/mcq/search.json from the topic files: an inverted index (stems of stem + options) with a short preview per item,
// so the phone searches ~1 MB instead of loading all 17 topic files. Deterministic. Run alone (node tools/tokos-build-mcq-search.mjs)
// or through tools/tokos-build-mcq.mjs. The tokeniser is the engine's own (specialty-bank.js) so build and query agree.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { tokens } = createRequire(import.meta.url)(path.join(ROOT, "specialty-bank.js"));
const MAX_DF = 0.15; // stems in more than this share of items are noise (they cost the most bytes and narrow nothing)
const PREVIEW = 80;

export function preview(q) {
  const t = String(q).replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW) return t;
  const cut = t.slice(0, PREVIEW), sp = cut.lastIndexOf(" ");
  return (sp > 45 ? cut.slice(0, sp) : cut) + "…";
}

// topics: [{id, items}] in bank order.
export function buildSearch(topics) {
  const ids = [], p = [], start = [], post = new Map();
  for (const t of topics) {
    start.push(ids.length);
    for (const it of t.items) {
      const o = ids.length;
      ids.push(it.id); p.push(preview(it.q));
      for (const w of tokens(it.q + " " + it.o.join(" "))) { if (!post.has(w)) post.set(w, []); post.get(w).push(o); }
    }
  }
  const w = {};
  for (const k of [...post.keys()].sort()) {
    const l = post.get(k);
    if (ids.length > 500 && l.length > MAX_DF * ids.length) continue;
    let prev = 0;
    w[k] = l.map((o) => { const d = o - prev; prev = o; return d.toString(36); }).join(",");
  }
  return { v: 1, deck: "mcq", n: ids.length, topics: topics.map((t) => t.id), start, ids, p, w };
}

export function buildFromDir(dir) {
  const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  const topics = ix.topics.map((t) => ({ id: t.id, items: JSON.parse(fs.readFileSync(path.join(dir, path.basename(t.file)), "utf8")).items }));
  return buildSearch(topics);
}

export function writeSearch(dir) {
  const body = JSON.stringify(buildFromDir(dir));
  fs.writeFileSync(path.join(dir, "search.json"), body);
  return Buffer.byteLength(body);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hi = process.argv.indexOf("--host");
  const sub = hi > 0 ? process.argv[hi + 1] : "tokos";
  if (!["tokos", "narke"].includes(sub)) throw new Error(`unknown --host ${sub}`);
  const dir = path.join(ROOT, sub, "decks", "mcq");
  console.log(`wrote ${path.relative(ROOT, dir)}/search.json ${(writeSearch(dir) / 1e6).toFixed(2)} MB`);
}
