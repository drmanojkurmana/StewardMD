// Shared checks for the Narkē explorer models (narke-models/explorer-*.js).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

export function load(id) {
  const file = fileURLToPath(new URL("../narke-models/explorer-" + id + ".js", import.meta.url));
  return { M: require(file), src: readFileSync(file, "utf8") };
}
// Every {en, hi} pair in the model.
function pairs(o, seen = new Set(), out = []) {
  if (!o || typeof o !== "object" || seen.has(o)) return out;
  seen.add(o);
  if (typeof o.en === "string" && "hi" in o) out.push(o);
  for (const k of Object.keys(o)) if (typeof o[k] === "object") pairs(o[k], seen, out);
  return out;
}
// The Narkē explorer contract: ids, review mark, sources, UMD into NARKE_MODELS, ES5, no dashes, both languages,
// ASCII numerals in Hindi, English sentences of 20 words or fewer.
export function contract(M, src, id) {
  assert.equal(M.id, id);
  assert.equal(M.kind, "explorer");
  assert.equal(M.review, "ai_drafted");
  assert.ok(["mbbs", "resident"].includes(M.level));
  assert.ok(M.title.en && M.title.hi && M.subtitle.en && M.subtitle.hi);
  assert.ok(M.sources.length >= 2 && M.sources.every((s) => s.label && (!s.url || /^https:\/\//.test(s.url))));
  assert.match(src, /Narkē/);
  assert.match(src, /root\.NARKE_MODELS\[m\.id\] = m/);
  assert.ok(!/\b(let|const|class)\s/.test(src) && !/=>/.test(src) && !/`/.test(src) && !/\.includes\(/.test(src) && !/\.\.\.\w/.test(src), "ES5");
  assert.ok(!DASH.test(src), "no em or en dash");
  const ps = pairs(M);
  assert.ok(ps.length > 5);
  for (const p of ps) {
    assert.ok(p.en.trim() && typeof p.hi === "string" && p.hi.trim(), JSON.stringify(p));
    assert.ok(!/[०-९]/.test(p.hi), "ASCII numerals in Hindi: " + p.hi);
    for (const s of p.en.split(/(?<=[.!?:;])\s+/)) assert.ok(s.split(/\s+/).length <= 20, "sentence over 20 words: " + s);
  }
}
