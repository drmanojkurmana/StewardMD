#!/usr/bin/env node
// Re-release bank or overlay module files with reviewed edits, never touching answer keys.
//
//   node tools/prep-item-edits.mjs --src <dir> --out <dir> [--edits stems.json] [--img-map map.json] [--img-prefix img/radnotes/]
//       [--set <name>] [--spacing]
//
// <dir> holds module files (<module>.json, as downloaded from R2: { topic, items } or { topic, set, v, items }).
// Every file is written to --out (a release is a whole folder: a new bank version or a new overlay set folder, because
// published files are cached for good on phones). What can change, per item:
//   --edits     { "<item id>": "<new stem>" }: the stem only (o, a, x, r, exp, kp stay). Used to take out wording that gives
//               the answer away on image items (the diagnosis or the finding the image should show). Every id must be found.
//   --img-map   { "<old image path>": "<new image path>" } and { "stack:<old base>": "<new base>" }: images moved to neutral
//               names (a file name must not carry the diagnosis) or replaced by a cleaned copy (burned-in labels removed).
//   --img-prefix  a bare image name ("rn-n1-p030-3.webp") is resolved by the app against img/<set>/, so when a set moves
//               to a new folder (radnotes -> radnotes2) bare names are written out in full with this prefix.
//   --set       the overlay set name written into each file (new folder name).
//   --spacing   repair run-together words in exp, q and o (tools/prep-spacing.mjs); --known-root <bank version dir> counts
//               words over the whole bank (recommended) rather than this folder only.
// Prints a JSON report (files, items changed per kind). Deterministic: the same inputs give the same bytes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeKnown, fixSpacing } from "./prep-spacing.mjs";

export function editItem(it, o) {
  const ch = [];
  if (o.stems && Object.prototype.hasOwnProperty.call(o.stems, it.id)) {
    const q = String(o.stems[it.id] || "").trim();
    if (!q) throw new Error("empty stem for " + it.id);
    if (q !== it.q) { it.q = q; ch.push("stem"); }
  }
  if (Array.isArray(it.img)) {
    const next = it.img.map((f) => {
      let g = String(f);
      if (o.imgPrefix && g.indexOf("/") < 0) g = o.imgPrefix + g;
      if (o.imgMap && o.imgMap[g]) g = o.imgMap[g];
      return g;
    });
    if (next.join("|") !== it.img.join("|")) { it.img = next; ch.push("img"); }
  }
  if (it.stack && it.stack.base && o.imgMap && o.imgMap["stack:" + it.stack.base]) {
    const nb = o.imgMap["stack:" + it.stack.base];
    const id = /\/stack\/([a-z0-9-]+)\/$/.exec(nb);
    if (!id) throw new Error("bad stack base " + nb);
    it.stack = { ...it.stack, base: nb, id: id[1] };
    ch.push("stack");
  }
  if (o.known) {
    let sp = false;
    for (const k of ["q", "exp"]) if (typeof it[k] === "string") { const t = fixSpacing(it[k], o.known); if (t !== it[k]) { it[k] = t; sp = true; } }
    if (Array.isArray(it.o)) { const t = it.o.map((x) => (typeof x === "string" ? fixSpacing(x, o.known) : x)); if (t.join("\u0000") !== it.o.join("\u0000")) { it.o = t; sp = true; } }
    if (sp) ch.push("spacing");
  }
  return ch;
}

export function editFile(json, o) {
  const out = { ...json };
  if (o.set) out.set = o.set;
  const changes = {};
  out.items = (json.items || []).map((x) => {
    const it = JSON.parse(JSON.stringify(x)), a0 = it.a, o0 = JSON.stringify(it.o && it.o.length);
    for (const k of editItem(it, o)) (changes[k] = changes[k] || []).push(it.id);
    if (it.a !== a0 || JSON.stringify(it.o && it.o.length) !== o0) throw new Error("answer key or option count changed for " + it.id);
    return it;
  });
  return { json: out, changes };
}

function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const src = arg("--src"), out = arg("--out");
  if (!src || !out) throw new Error("--src and --out are required");
  const rd = (p) => (p ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
  const o = { stems: rd(arg("--edits")), imgMap: rd(arg("--img-map")), imgPrefix: arg("--img-prefix", null), set: arg("--set", null) };
  const files = fs.readdirSync(src).filter((f) => /\.json$/.test(f) && f !== "index.json" && f !== "search.json").sort();
  if (argv.includes("--spacing")) {
    // word counts over the whole bank (--known-root <bank version dir>, every <subject>/mcq/*.json), else this folder
    const kr = arg("--known-root", null);
    const paths = kr ? fs.readdirSync(kr).flatMap((s) => { const d = path.join(kr, s, "mcq"); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.json$/.test(f)).map((f) => path.join(d, f)) : []; })
      : files.map((f) => path.join(src, f));
    o.known = makeKnown(paths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")).items || []));
  }
  const seen = new Set(), report = { files: files.length, changed: {} };
  fs.mkdirSync(out, { recursive: true });
  for (const f of files) {
    const r = editFile(JSON.parse(fs.readFileSync(path.join(src, f), "utf8")), o);
    for (const [k, ids] of Object.entries(r.changes)) { report.changed[k] = (report.changed[k] || 0) + ids.length; if (k === "stem") ids.forEach((id) => seen.add(id)); }
    fs.writeFileSync(path.join(out, f), JSON.stringify(r.json));
  }
  if (o.stems) { const miss = Object.keys(o.stems).filter((id) => !seen.has(id)); report.stemsNotApplied = miss; }
  console.log(JSON.stringify(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
