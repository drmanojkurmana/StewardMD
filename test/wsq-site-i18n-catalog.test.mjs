/* test/wsq-site-i18n-catalog.test.mjs - the staff interface's English catalog (ui-i18n-site).
 *
 * Every T()/TS() call in shell.js, pages/*.js and the Order workstation names a key and carries its
 * English inline (the fallback when a helper renders without i18n.js). The catalog in i18n.js must
 * hold exactly those keys, with exactly that English, in one contiguous block at the end of EN, so
 * translators work from one list and the English on screen cannot drift from it.
 *
 * node --test test/wsq-site-i18n-catalog.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extractKeys, loadSite } from "./wsq-site-i18n-harness.mjs";

const require = createRequire(import.meta.url);
const I18N_SRC = readFileSync(new URL("../wardsynq/site/i18n.js", import.meta.url), "utf8");
const EN = require("../wardsynq/site/i18n.js")._catalogs.en;
const START = "/* site pages keys (ui-i18n-site) */", END = "/* end site pages keys */";

test("one English per key across every staff source", () => {
  const seen = new Map(), conflicts = [];
  for (const k of extractKeys()) {
    if (seen.has(k.key) && seen.get(k.key).en !== k.en) conflicts.push(`${k.key}: "${seen.get(k.key).en}" (${seen.get(k.key).file}) vs "${k.en}" (${k.file})`);
    else seen.set(k.key, k);
  }
  assert.deepEqual(conflicts, []);
  assert.ok(seen.size > 0);
});

test("catalog strings are plain text with no dash characters", () => {
  for (const k of extractKeys()) {
    assert.ok(!/<[a-z/]|&[a-z#0-9]+;/i.test(k.en), `${k.key} carries HTML: ${k.en}`);
    assert.ok(!/[–—]/.test(k.en), `${k.key} carries an en or em dash`);
  }
});

test("i18n.js EN holds every key with byte-identical English, in one block at the end of EN", () => {
  const s = I18N_SRC.indexOf(START), e = I18N_SRC.indexOf(END);
  assert.ok(s > 0 && e > s, "the delimited block exists");
  assert.match(I18N_SRC.slice(e + END.length), /^\s*\};/, "the block is the last thing in EN");
  const block = I18N_SRC.slice(s, e);
  const inBlock = new Set([...block.matchAll(/^\s*"((?:site|order)\.[\w.-]+)":/gm)].map((m) => m[1]));
  const used = new Map(extractKeys().map((k) => [k.key, k.en]));
  const missing = [...used.keys()].filter((k) => !inBlock.has(k));
  assert.deepEqual(missing, [], "keys used in code but not in the block");
  assert.deepEqual([...inBlock].filter((k) => !used.has(k)), [], "keys in the block that no code uses");
  for (const [k, en] of used) assert.equal(EN[k], en, k);
  const outside = Object.keys(EN).filter((k) => /^(site|order)\./.test(k) && !inBlock.has(k));
  assert.deepEqual(outside, [], "site./order. keys outside the block");
});

test("a failure message in another language carries the English original underneath; in English it is plain", () => {
  const xx = loadSite({ lang: "xx" });
  const html = xx.win.WSQ.tSafe("site.test.notSaved", null, "Not saved.");
  // The fake catalog has no such key, so t falls back to English: no second line when nothing was translated.
  assert.equal(html, "Not saved.");
  const k = extractKeys()[0];
  const both = xx.win.WSQ.tSafe(k.key, null, k.en);
  assert.ok(both.startsWith("⟦") && both.includes('<span class="en-orig" lang="en">'), both);
  const en = loadSite({});
  assert.equal(en.win.WSQ.tSafe(k.key, null, k.en).indexOf("en-orig"), -1);
  assert.equal(en.win.WSQ.en("<b>x</b>"), "<b>x</b>");
  assert.equal(xx.win.WSQ.en("<b>x</b>"), '<span lang="en"><b>x</b></span>');
});
