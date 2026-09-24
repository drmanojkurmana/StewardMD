/* scripts/sanitize-sources.mjs <www-dir> [--check]
 *
 * Build step (run by scripts/build-www.sh on the assembled www/, before KB encryption): the shipped app
 * must not carry specific textbook citations or page numbers (owner, 2026-09-24, copyright). The repo
 * keeps its authoring provenance; only the bundle is rewritten.
 *
 *   - a specific citation ("Harrison 22e p.302", "Braunwald's Heart Disease, 12e, p. 1400", "Nelson
 *     Textbook of Pediatrics, 22e") becomes the SUBJECT'S standard-textbook line from emoji-icons.js
 *     refFor(): cardiology entries get Braunwald/Hurst/Oxford Cardiology, genetics entries the genetics
 *     texts, and so on (the entry's `system` decides; a file's name decides for hand-written modules)
 *   - page / chapter / edition locators are removed from text; fields named page/pages/pageNo/... are
 *     emptied ("" / null / []) in knowledge-base data
 *   - reference lists that collapse to the same line are de-duplicated
 *
 * Safety (the owner's "without causing malfunction"): generated kb/dist bundles are evaluated in a
 * sandbox, rewritten as data and re-emitted in the same wrapper, and must re-evaluate to the same key
 * set; JSON must re-parse; hand-written JS is rewritten ONLY inside string literals (a small lexer that
 * skips comments, regex and template literals) and must still parse. Any file that fails a check is
 * left exactly as it was and reported. --check reports what remains without writing.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.window = globalThis.window || { localStorage: { getItem: () => null } };
const E = require("../emoji-icons.js");

const WWW = process.argv[2];
const CHECK = process.argv.includes("--check");
if (!WWW) { console.error("usage: sanitize-sources.mjs <www-dir> [--check]"); process.exit(2); }

const PAGE_KEY = /^(page|pages|pageNo|pageNum|pageStart|pageEnd|printedPage|pdfPage|pp|chapter|chapters|chapterNo)$/i;
// A value in a source field that names a book at all (short forms included) becomes the subject line.
const SOURCE_KEY = /^(source|sources|primaryRef|reference|references|refs?|editions|citation|citations|textbook|book)$/i;
const BOOKISH = /Textbook|Principles|Handbook|Manual|Synopsis|Practice of|\bGuide\b|Mandell|Harrison|Nelson|Sleisenger|Braunwald|Fitzpatrick|Sherlock|Sabiston|Bailey|Campbell|Kaplan|Robbins|Guyton|Davidson|Williams|Tintinalli|Rosen|Adams|Murray|Brenner|Rockwood|Novak|Berek|Kanski|Scott-Brown|Cummings|Kelley|Firestein|DeVita|Abeloff|Hoffman|Goldfrank|Katzung|Goodman|Oxford|Yamada|Rook|Andrews|Emery|Thompson|Hurst|Greenspan|Rudolph|Dewhurst|Apley|Parsons|Dhingra|Shafer|Burket|Peterson|reference texts?|\b\d{1,2}(?:st|nd|rd|th)?\s*(?:e|ed\.?|edition)\b/;
const SKIP = /(^|\/)(vendor|node_modules|wardsynq\/site)\/|(^|\/)vendor-[^/]*\.js$|(^|\/)emoji-icons\.js$|\.min\.js$|(^|\/)sw\.js$/;
const DATA_DIR = /^(kb|clinix|data)\//;

// ── structural walk ────────────────────────────────────────────────────────────────────────────────
function refFromCtx(sys) { return E.refFor(sys); }
function cleanString(s, ref) { return E.scrubBooks(s, { ref }); }
function dedupe(arr, ref) {
  const out = []; const seen = new Set();
  for (const v of arr) { if (typeof v === "string" && /^Standard textbooks: /.test(v)) { if (seen.has(v)) continue; seen.add(v); } out.push(v); }
  return out;
}
function walk(o, ref, dataKeys) {
  if (typeof o === "string") return cleanString(o, ref);
  if (Array.isArray(o)) return dedupe(o.map((v) => walk(v, ref, dataKeys)), ref);
  if (!o || typeof o !== "object") return o;
  const sys = [o.system, o.specialty, o.speciality, o.class && typeof o.class === "string" && /genetic|cardio|neuro/i.test(o.class) ? o.class : null].find((x) => typeof x === "string" && x);
  const r = sys ? refFromCtx(sys) : ref;
  const out = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (dataKeys && PAGE_KEY.test(k) && !(v && typeof v === "object" && !Array.isArray(v))) {
      out[k] = typeof v === "number" ? null : Array.isArray(v) ? [] : typeof v === "string" ? "" : v;
      continue;
    }
    if (dataKeys && SOURCE_KEY.test(k)) {
      const sub = (x) => (typeof x === "string" && !/^Standard textbooks: /.test(x) && BOOKISH.test(x) && !/^StewardMD\b/.test(x) ? r : walk(x, r, dataKeys));
      out[k] = Array.isArray(v) ? dedupe(v.map(sub), r) : sub(v);
      continue;
    }
    out[k] = walk(v, r, dataKeys);
  }
  return out;
}

function cleanComment(txt, ref) {
  if (!E.hasBooks(txt)) return txt;
  const m = /^(\/\/|\/\*)([\s\S]*?)(\*\/)?$/.exec(txt);
  const out = m ? m[1] + cleanString(m[2], ref) + (m[3] || "") : txt;
  // a comment must stay a comment: keep its opening/closing markers intact
  if (txt.startsWith("/*") && (!out.startsWith("/*") || !out.endsWith("*/"))) return txt;
  if (txt.startsWith("//") && (!out.startsWith("//") || /\n/.test(out))) return txt;
  return out;
}
// ── JS string-literal lexer ────────────────────────────────────────────────────────────────────────
function rewriteJsStrings(src, ref) {
  let out = "", i = 0, n = src.length, lastSig = "", changed = 0;
  const regexOk = () => !lastSig || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSig) || /\b(return|typeof|case|do|else|in|of|void|delete|throw|new)$/.test(lastSig);
  while (i < n) {
    const c = src[i], d = src[i + 1];
    // comments never execute: clean them too (a bundle that is unpacked should not read as a citation list)
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); const e = j < 0 ? n : j; out += cleanComment(src.slice(i, e), ref); i = e; continue; }
    if (c === "/" && d === "*") { const j = src.indexOf("*/", i + 2); const e = j < 0 ? n : j + 2; out += cleanComment(src.slice(i, e), ref); i = e; continue; }
    if (c === "`") { let j = i + 1; while (j < n && src[j] !== "`") { if (src[j] === "\\") j++; j++; } out += src.slice(i, j + 1); i = j + 1; lastSig = "`"; continue; }
    if (c === "/" && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== "\n") { const ch = src[j]; if (ch === "\\") { j += 2; continue; } if (ch === "[") cls = true; else if (ch === "]") cls = false; else if (ch === "/" && !cls) break; j++; }
      if (src[j] === "/") { j++; while (j < n && /[a-z]/i.test(src[j])) j++; out += src.slice(i, j); i = j; lastSig = "/re/"; continue; }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      const raw = src.slice(i + 1, j);
      let body = raw;
      if (E.hasBooks(raw.replace(/\\'/g, "'"))) {
        const plain = raw.replace(/\\'/g, "'");
        const cleaned = cleanString(plain, ref);
        if (cleaned !== plain) { body = c === "'" ? cleaned.replace(/(^|[^\\])'/g, "$1\\'") : cleaned.replace(/(^|[^\\])"/g, '$1\\"'); changed++; }
      }
      out += c + body + (src[j] === c ? c : ""); i = j + (src[j] === c ? 1 : 0); lastSig = '"';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) lastSig = (/[A-Za-z0-9_$]/.test(c) ? (lastSig + c).slice(-12) : c);
    i++;
  }
  return { out, changed };
}

// ── kb/dist generated bundles: evaluate, clean as data, re-emit ────────────────────────────────────
function runBundle(code, seed) {
  const win = seed || {};
  const ctx = { window: win, Object, JSON };
  vm.runInNewContext(code, ctx, { timeout: 60000 });
  return win;
}
function sanitizeKbDist(rel, code) {
  const header = (code.match(/^\/\*[\s\S]*?\*\/\s*/) || [""])[0];
  const isPart2 = /Object\.assign\(\(window\.KB_ENRICHMENT = window\.KB_ENRICHMENT \|\| \{ byId: \{\} \}\)\.byId,/.test(code);
  if (isPart2) {
    const w = runBundle(code, { KB_ENRICHMENT: { byId: {} } });
    const byId = walk(w.KB_ENRICHMENT.byId, E.GENERIC_REF, true);
    const again = runBundle(header + `Object.assign((window.KB_ENRICHMENT = window.KB_ENRICHMENT || { byId: {} }).byId, ${JSON.stringify(byId)});`, { KB_ENRICHMENT: { byId: {} } });
    if (Object.keys(again.KB_ENRICHMENT.byId).length !== Object.keys(w.KB_ENRICHMENT.byId).length) throw new Error("entry count changed");
    return header + `Object.assign((window.KB_ENRICHMENT = window.KB_ENRICHMENT || { byId: {} }).byId, ${JSON.stringify(byId)});\n`;
  }
  const w = runBundle(code);
  const names = Object.keys(w);
  if (!names.length) throw new Error("no globals");
  let body = header;
  for (const g of names) {
    const val = w[g];
    if (JSON.stringify(JSON.parse(JSON.stringify(val))) !== JSON.stringify(val)) throw new Error("not pure data: " + g);
    body += `window.${g} = ${JSON.stringify(walk(val, E.GENERIC_REF, true))};\n`;
  }
  const again = runBundle(body);
  for (const g of names) {
    const a = again[g], b = w[g];
    if (Object.keys(a).join() !== Object.keys(b).join()) throw new Error("key set changed: " + g);
    if (a.byId && Object.keys(a.byId).length !== Object.keys(b.byId).length) throw new Error("entry count changed: " + g);
  }
  return body;
}

// ── driver ─────────────────────────────────────────────────────────────────────────────────────────
function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) { const p = join(dir, f); const s = statSync(p); if (s.isDirectory()) out.push(...files(p)); else out.push(p); }
  return out;
}
const report = { changed: [], failed: [], untouched: 0 };
for (const abs of files(WWW)) {
  const rel = relative(WWW, abs).split("\\").join("/");
  if (SKIP.test(rel) || !/\.(js|json|ndjson|json\.gz)$/.test(rel)) continue;
  const gz = rel.endsWith(".gz");
  let src;
  try { src = gz ? gunzipSync(readFileSync(abs)).toString("utf8") : readFileSync(abs, "utf8"); } catch (e) { continue; }
  if (!E.hasBooks(src) && !(DATA_DIR.test(rel) && /"(?:page|pages|pageNo|pageStart|pageEnd)"\s*:\s*[\d"[]/.test(src))) { report.untouched++; continue; }
  const ref = E.refFor(rel.replace(/[_\-/.]/g, " "));
  let out;
  try {
    if (/^kb\/dist\/.*\.js$/.test(rel)) out = sanitizeKbDist(rel, src);
    else if (/\.json(\.gz)?$/.test(rel)) out = JSON.stringify(walk(JSON.parse(src), ref, DATA_DIR.test(rel) || gz));
    else if (rel.endsWith(".ndjson")) out = src.split("\n").map((l) => (l.trim() ? JSON.stringify(walk(JSON.parse(l), ref, true)) : l)).join("\n");
    else {
      const r = rewriteJsStrings(src, ref);
      out = r.out;
      if (r.changed) new vm.Script(out, { filename: rel });
    }
    if (out.length && /\.json(\.gz)?$/.test(rel)) JSON.parse(out);
  } catch (e) { report.failed.push(rel + ": " + e.message); continue; }
  if (out === src) { report.untouched++; continue; }
  report.changed.push(rel);
  if (!CHECK) writeFileSync(abs, gz ? gzipSync(Buffer.from(out, "utf8")) : out);
}
console.log(`  sources: ${report.changed.length} files rewritten, ${report.failed.length} left as-is (failed a check)` + (CHECK ? " [check only]" : ""));
for (const f of report.failed) console.log("    KEPT " + f);
if (process.argv.includes("--verbose")) for (const f of report.changed) console.log("    " + f);
process.exit(0);
