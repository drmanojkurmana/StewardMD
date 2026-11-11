/* text-highlight.js pure anchoring helpers + the opt-in wiring in the two readers. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const HL = require("../text-highlight.js");
const { locate, quote, trimRange } = HL._pure;

test("quote keeps 32 chars of context either side", () => {
  const t = "x".repeat(50) + "TARGET" + "y".repeat(50);
  const q = quote(t, 50, 56);
  assert.equal(q.q, "TARGET"); assert.equal(q.pre.length, 32); assert.equal(q.suf.length, 32);
});

test("locate picks the occurrence whose context matches", () => {
  const t = "Give aspirin now. Later, give aspirin again after the scan.";
  const second = t.lastIndexOf("aspirin");
  const rec = quote(t, second, second + 7);
  assert.equal(locate(t, rec), second);
  const first = t.indexOf("aspirin");
  assert.equal(locate(t, quote(t, first, first + 7)), first);
});

test("locate survives a changed surrounding and fails cleanly when the words are gone", () => {
  const rec = quote("alpha beta gamma delta", 6, 16);   // "beta gamma"
  assert.equal(locate("NEW alpha beta gamma delta", rec), 10);
  assert.equal(locate("alpha delta", rec), -1);
  assert.equal(locate("anything", { q: "" }), -1);
});

test("trimRange drops edge whitespace", () => {
  assert.deepEqual(trimRange("  ab  ", 0, 6), [2, 4]);
  assert.deepEqual(trimRange("   ", 0, 3), [3, 3]);
});

test("Learn lesson text and the KB disease reader opt in with data-hl-key", () => {
  const ls = fs.readFileSync(new URL("../prep-lessons.js", import.meta.url), "utf8");
  assert.match(ls, /class="pn-lsn-tx" data-hl-key="' \+ escH\("ls:" \+ L\.key/);
  assert.match(ls, /if \(selecting\(el\)\) return;/, "a selection drag does not turn the page");
  const rs = fs.readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
  assert.match(rs, /class="kbr-read" data-hl-key="' \+ esc\("kb:" \+ id\)/);
  const ix = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(ix, /<script src="\/text-highlight\.js\?v=hl\d+" defer>/);
  assert.match(ix, /<link rel="stylesheet" href="\/text-highlight\.css\?v=hl\d+">/);
});

test("no em or en dash in app-facing strings", () => {
  const src = fs.readFileSync(new URL("../text-highlight.js", import.meta.url), "utf8");
  const strings = src.match(/"[^"\n]*"|'[^'\n]*'/g) || [];
  assert.ok(!strings.some((s) => /[–—]/.test(s)));
});
