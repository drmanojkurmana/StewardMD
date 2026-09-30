#!/usr/bin/env node
/* StewardMD neonatal layer - provenance validator for data/neo/*.json.
 *
 *   node scripts/neo/validate.mjs [file ...]      (default: every data/neo/*.json)
 *   node scripts/neo/validate.mjs --pack          fold data/neo/sources/*.txt into sources.json.gz, then validate
 *
 * The rule the owner set (2026-09-30): no dose, threshold, score item or reference value from
 * memory. Mechanically:
 *   1. Envelope: schema 1, review.status "ai_drafted" (or a later reviewed state with by + date),
 *      and every source has title, url, licence, accessed and a snapshot file that exists.
 *   2. Any object carrying numbers carries { src, quote } (or inherits them from its nearest
 *      ancestor that does). "quote" must be a verbatim substring of the source snapshot
 *      (whitespace, quotes and dashes normalised).
 *   3. Every clinical number in that object (its own numeric leaves, and those of child objects
 *      without their own quote) appears as a number in its quote. Words "once", "twice", "one".."twelve"
 *      count as numbers. Keys in STRUCTURAL are not clinical numbers (ids, order, schema, table row
 *      indices) and are skipped.
 *   4. "table" blocks (large published tables such as LMS rows) are exempt from rule 3 but must name
 *      a snapshot ("table_src") whose text contains every row's values; see checkTable().
 * Exit 1 on any failure. test/neo-data.test.mjs runs this over the shipped files.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "data", "neo");
const STRUCTURAL = new Set(["schema", "order", "idx", "version", "rev", "row", "col", "sort", "page"]);
const WORDS = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, single: 1, double: 2 };

export function norm(s) {
  return String(s)
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-").replace(/ /g, " ")
    .replace(/\s+/g, " ").trim();
}
export function numbersIn(s) {
  const out = new Set();
  const t = norm(s).replace(/(\d),(\d{3})\b/g, "$1$2");
  (t.match(/\d*\.?\d+/g) || []).forEach((x) => out.add(Number(x)));
  // "1/2" style fractions and superscript-free powers are rare; accept the fraction value too
  (t.match(/\b(\d+)\/(\d+)\b/g) || []).forEach((x) => { const [a, b] = x.split("/").map(Number); if (b) out.add(Math.round((a / b) * 1e6) / 1e6); });
  (t.toLowerCase().match(/[a-z]+/g) || []).forEach((w) => { if (w in WORDS) out.add(WORDS[w]); });
  return out;
}
function hasNum(set, v) {
  for (const x of set) if (Math.abs(x - v) < 1e-9) return true;
  return false;
}

/* Snapshots are committed as ONE file, data/neo/sources.json.gz ({ "<name>.txt": text }), because
 * Cloudflare Pages caps a deploy at 20,000 files and 225 loose snapshots pushed the repo over it.
 * scripts/neo/snap.py writes loose files into data/neo/sources/ (gitignored); `--pack` folds them in.
 * A loose file wins over the bundle, so a fresh snapshot validates before it is packed. */
const BUNDLE = join(DIR, "sources.json.gz");
let bundle = null;
function bundled() {
  if (bundle) return bundle;
  bundle = existsSync(BUNDLE) ? JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString("utf8")) : {};
  return bundle;
}
const snapCache = new Map();
function snapshot(file) {
  if (!snapCache.has(file)) {
    const name = basename(file);
    const txt = existsSync(file) ? readFileSync(file, "utf8") : bundled()[name];
    snapCache.set(file, txt == null ? null : norm(txt));
  }
  return snapCache.get(file);
}
function snapExists(file) { return existsSync(file) || basename(file) in bundled(); }
export function pack() {
  const dir = join(DIR, "sources"), out = Object.assign({}, bundled());
  if (existsSync(dir)) readdirSync(dir).filter((f) => f.endsWith(".txt")).forEach((f) => { out[f] = readFileSync(join(dir, f), "utf8"); });
  const sorted = {}; Object.keys(out).sort().forEach((k) => { sorted[k] = out[k]; });
  writeFileSync(BUNDLE, gzipSync(Buffer.from(JSON.stringify(sorted)), { level: 9 }));
  bundle = sorted;
  return Object.keys(sorted).length;
}

export function validateDoc(doc, name, errs) {
  const E = (m) => errs.push(name + ": " + m);
  if (doc.schema !== 1) E("schema must be 1");
  const rv = doc.review || {};
  if (!rv.status) E("review.status missing");
  else if (rv.status !== "ai_drafted" && !(rv.by && rv.date)) E("review.status " + rv.status + " needs review.by and review.date");
  const S = doc.sources || {};
  if (!Object.keys(S).length) E("no sources");
  for (const [id, s] of Object.entries(S)) {
    for (const k of ["title", "url", "licence", "accessed"]) if (!s[k]) E(`source ${id} missing ${k}`);
    const f = join(DIR, "sources", (s.snapshot || id + ".txt").replace(/^sources\//, ""));
    if (!snapExists(f)) E(`source ${id} snapshot missing (${basename(f)})`);
  }
  const snapFor = (id) => { const s = S[id]; if (!s) return null; return snapshot(join(DIR, "sources", (s.snapshot || id + ".txt").replace(/^sources\//, ""))); };

  let quoted = 0;
  function walk(node, path, ctx) {
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, path + "[" + i + "]", ctx)); return; }
    if (!node || typeof node !== "object") return;
    if (path === "$.sources" || path === "$.review") return;
    if (node.table && node.table_src) { checkTable(node, path); return; }
    let here = ctx;
    if (typeof node.quote === "string" || node.src) {
      if (!node.src || typeof node.quote !== "string" || !node.quote.trim()) { E(`${path}: needs both src and quote`); return; }
      if (!S[node.src]) { E(`${path}: unknown src ${node.src}`); return; }
      const snap = snapFor(node.src);
      const qs = Array.isArray(node.quote) ? node.quote : [node.quote];
      if (snap != null) qs.forEach((q) => { if (snap.indexOf(norm(q)) < 0) E(`${path}: quote not found verbatim in ${node.src}: "${norm(q).slice(0, 90)}..."`); });
      here = { src: node.src, nums: numbersIn(qs.join(" ")), path };
      quoted++;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === "quote" || k === "src") continue;
      if (typeof v === "number") {
        if (STRUCTURAL.has(k) || path === "$") continue;
        if (!here) E(`${path}.${k} = ${v} has no src/quote`);
        else if (!hasNum(here.nums, v)) E(`${path}.${k} = ${v} not in its quote (${here.path})`);
      } else if (v && typeof v === "object") walk(v, path + "." + k, here);
    }
  }
  function checkTable(node, path) {
    const snap = snapFor(node.table_src);
    if (!S[node.table_src]) { E(`${path}: unknown table_src ${node.table_src}`); return; }
    if (snap == null) return;
    const nums = numbersIn(snap);
    let miss = 0;
    const cols = node.columns || [];
    (node.table || []).forEach((row) => (Array.isArray(row) ? row : Object.values(row)).forEach((v) => { if (typeof v === "number" && !hasNum(nums, v)) miss++; }));
    if (miss) E(`${path}: ${miss} table value(s) not present in ${node.table_src}`);
    if (!cols.length) E(`${path}: table needs columns`);
    quoted++;
  }
  walk(doc, "$", null);
  if (!quoted) E("no quoted items");
  return errs;
}

export function validateAll(files) {
  const errs = [];
  const list = files && files.length ? files : readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => join(DIR, f));
  for (const f of list) {
    let doc; try { doc = JSON.parse(readFileSync(f, "utf8")); } catch (e) { errs.push(basename(f) + ": bad JSON " + e.message); continue; }
    validateDoc(doc, basename(f), errs);
  }
  return { files: list.length, errs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "--pack") { console.log("packed " + pack() + " snapshots into data/neo/sources.json.gz"); process.argv.splice(2, 1); }
  const { files, errs } = validateAll(process.argv.slice(2));
  errs.forEach((e) => console.log("FAIL " + e));
  console.log(`${files} file(s), ${errs.length} problem(s)`);
  process.exit(errs.length ? 1 : 0);
}
