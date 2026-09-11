#!/usr/bin/env node
/* Build the bundled OFFLINE ICD-10 index (icd/icd10.min.json) that icd.js's
 * window.SMD_ICD.localSearch() serves when the phone is offline (maik-engine.js
 * icdCandidates() falls back to it instead of /api/icd/search).
 *
 * Source: the same GitHub repo the server's D1 table was loaded from (see
 * scripts/icd/README.md) - k4m1113/ICD-10-CSV. Two files are merged:
 *   - codes.csv       columns category,order,code(no dot),short_description,long_description,...
 *                      (the CM leaf codes - only some of these happen to land on a WHO 4-char code)
 *   - categories.csv   columns code(no dot),title (the category/subcategory tree itself, which
 *                      carries a title for WHO-level nodes codes.csv skips, e.g. "A01" itself)
 * codes.csv alone recovers ~5.7k WHO 4-char codes; categories.csv alone ~7.6k; merged ~11.8k,
 * close to WHO's own count of ICD-10 categories+subcategories (~12.4k). Where both sources have
 * the same dotted code their titles agree (verified while building this script), so plain merge
 * is lossless. Downloaded fresh every run (no vendored copy) so a refresh just means re-running
 * this script; fails loudly rather than shipping stale/fabricated rows if a source is unreachable.
 *
 * WHO 4-character rule: keep only codes with AT MOST ONE character after the dot
 * (e.g. A00.0, E11.9, or the bare 3-char category A00) - the WHO ICD-10 category/
 * subcategory set most Indian schemes and hospitals cite - and drop the deeper
 * ICD-10-CM subdivisions (E11.65, S72.001A) that make the CM set 71k rows instead
 * of ~12k. This keeps the shipped index well under 1 MB.
 *
 * Output: icd/icd10.min.json - a compact [[code,title], ...] array sorted by code.
 * Run:    node scripts/icd/build-offline-index.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_RAW = "https://raw.githubusercontent.com/k4m1113/ICD-10-CSV/master/";
const CODES_URL = REPO_RAW + "codes.csv";
const CATEGORIES_URL = REPO_RAW + "categories.csv";
const OUT_DIR = join(ROOT, "icd");
const OUT_JSON = join(OUT_DIR, "icd10.min.json");
const OUT_README = join(OUT_DIR, "README.md");

// Minimal CSV line parser - handles the double-quoted fields with embedded commas that
// codes.csv uses for descriptions ("Cholera, unspecified"); no embedded quotes in this data.
function parseCsvLine(line) {
  const fields = [];
  let i = 0, cur = "", inQ = false;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { inQ = false; } else { cur += c; }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      fields.push(cur); cur = "";
    } else {
      cur += c;
    }
    i++;
  }
  fields.push(cur);
  return fields;
}

async function fetchCsv(url, minLines) {
  console.log("• fetching", url);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error("FAILED to reach", url, "-", e.message || e);
    process.exit(1);
  }
  if (!res.ok) {
    console.error("FAILED to fetch", url, "- HTTP", res.status);
    process.exit(1);
  }
  const text = await res.text();
  const lines = text.split("\n").filter(function (l) { return l.trim().length; });
  if (lines.length < minLines) {
    console.error(url + " looks truncated (" + lines.length + " lines) - refusing to build from it");
    process.exit(1);
  }
  return lines;
}

const CODE_RE = /^[A-Z]\d\d(\.\d)?$/;
const seen = new Map(); // dotted code -> title, dedupes and lets us sort once at the end

function addRow(rawCode, title) {
  rawCode = (rawCode || "").trim().toUpperCase();
  title = (title || "").trim();
  if (!rawCode || !title) return;
  const cat = rawCode.slice(0, 3);
  const rest = rawCode.slice(3);
  if (rest.length > 1) return; // WHO 4-char rule: at most one char after the dot
  const dotted = rest ? cat + "." + rest : cat;
  if (!CODE_RE.test(dotted)) return;
  if (!seen.has(dotted)) seen.set(dotted, title);
}

// categories.csv first: it has the WHO-level category/subcategory titles codes.csv skips.
for (const line of await fetchCsv(CATEGORIES_URL, 1000)) {
  const f = parseCsvLine(line);
  addRow(f[0], f[1]);
}
// codes.csv second: only overwrites when categories.csv didn't already have the code (titles
// agree where both sources cover the same code, verified when this script was written).
for (const line of await fetchCsv(CODES_URL, 1000)) {
  const f = parseCsvLine(line);
  addRow(f[2], f[4] || f[3]);
}

const rows = Array.from(seen.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
const json = JSON.stringify(rows);
const bytes = Buffer.byteLength(json, "utf8");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_JSON, json);

console.log("• rows:", rows.length);
console.log("• size:", (bytes / 1024).toFixed(1) + " KB (" + bytes + " bytes)");
if (bytes > 1.2 * 1024 * 1024) {
  console.log("• WARNING: over 1.2 MB target - consider stripping duplicated qualifiers");
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(OUT_README,
  "# ICD-10 offline index\n\n" +
  "Generated by `scripts/icd/build-offline-index.mjs` on " + today + " from " +
  "[`k4m1113/ICD-10-CSV`](https://github.com/k4m1113/ICD-10-CSV)'s `codes.csv` + `categories.csv`\n" +
  "(same repo as the server D1 table's source, see `scripts/icd/README.md`).\n\n" +
  "**WHO 4-character rule**: only codes with at most one character after the dot are kept " +
  "(e.g. `A00.0`, `E11.9`, or the bare 3-char category `A00`) - the WHO ICD-10 set most Indian " +
  "schemes and hospitals cite. Deeper ICD-10-CM subdivisions (`E11.65`, `S72.001A`) are dropped.\n\n" +
  "Row count: **" + rows.length + "**. File size: **" + (bytes / 1024).toFixed(1) + " KB**.\n\n" +
  "Shape: a JSON array of `[code, title]` pairs, sorted by code. Consumed by `icd.js`'s\n" +
  "`window.SMD_ICD.localSearch()`, which `maik-engine.js` `icdCandidates()` falls back to when\n" +
  "offline. Shipped into the native bundle by `scripts/build-www.sh`.\n\n" +
  "Refresh: re-run the build script; it always downloads fresh, never fabricates rows, and fails\n" +
  "loudly if the source is unreachable.\n"
);
console.log("• wrote", OUT_JSON);
console.log("• wrote", OUT_README);
