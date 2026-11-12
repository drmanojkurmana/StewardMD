#!/usr/bin/env node
/* Minify every .json file in the app bundle (build-www step; the repo keeps its pretty-printed sources).
 * The app only ever reads these with JSON.parse / response.json(), so whitespace is dead weight: about
 * 11 MB across ~5,800 files, mostly the pretty-printed PrepNucleus lessons. A file is rewritten only when
 * JSON.parse(minified) deep-equals JSON.parse(original); anything that does not parse is left untouched.
 *
 *   node scripts/minify-json.mjs <www dir>
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export function minifyText(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return null; }
  const m = JSON.stringify(o);
  if (m.length >= text.length) return null;
  if (!isDeepStrictEqual(JSON.parse(m), o)) return null;
  return m;
}

export function minifyDir(dir) {
  const out = { files: 0, before: 0, after: 0 };
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".json")) continue;
      const text = fs.readFileSync(p, "utf8");
      const m = minifyText(text);
      if (m == null) continue;
      fs.writeFileSync(p, m);
      out.files++; out.before += Buffer.byteLength(text); out.after += Buffer.byteLength(m);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const www = process.argv[2];
  if (!www) { console.error("usage: minify-json.mjs <www dir>"); process.exit(2); }
  const r = minifyDir(www);
  console.log("  json: " + r.files + " files minified, " + ((r.before - r.after) / 1e6).toFixed(1) + " MB saved");
}
