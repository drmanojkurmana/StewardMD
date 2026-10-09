// Re-releases with reviewed edits (tools/prep-item-edits.mjs), run-together word repair (tools/prep-spacing.mjs) and the
// named subject search index (prep.js searchFile, route search-<hash>.json).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { editFile, editItem } from "../tools/prep-item-edits.mjs";
import { fixSpacing, makeKnown } from "../tools/prep-spacing.mjs";
import { bankPath } from "../functions/api/prep/bank/[[path]].js";

const require = createRequire(import.meta.url);
const P = require("../prep.js");
const WORDS = new Set("fissure the chorda tympani cycle phase drugs muscle medial border nodes outer cortex mac conkey agar cervix body ratio endo hyper parathyroidism thick bowel wall thin strictures common gene xpert sputum".split(" "));
const known = (w) => WORDS.has(String(w).toLowerCase());

test("spacing: a lost line break between two known words gets a space, nothing else changes", () => {
  assert.equal(fixSpacing("petrotympanic fissureThe chorda tympani", known), "petrotympanic fissure The chorda tympani");
  assert.equal(fixSpacing("phase of cell cycle.Phase of cycle", known), "phase of cell cycle. Phase of cycle");
  assert.equal(fixSpacing("Thick bowel wallThin bowel wallStrictures common", known), "Thick bowel wall Thin bowel wall Strictures common");
  assert.equal(fixSpacing("muscleMedial border", known), "muscle Medial border");
});

test("spacing: products, eponyms, prefixes, ratios, units and abbreviations stay as written", () => {
  for (const s of ["MacConkey agar", "GeneXpert on sputum", "endoCervix", "hyperParathyroidism", "Cervix:Body ratio", "e.g.The", "120 mmHgb", "fissureXyz", "pH 7.4", "IgG"]) assert.equal(fixSpacing(s, known), s, s);
  assert.equal(fixSpacing("", known), "");
  assert.equal(fixSpacing(null, known), null);
});

test("spacing: known words come from the bank text (20 or more uses) or the word list", () => {
  const items = Array.from({ length: 20 }, () => ({ q: "Xylocaine dose", exp: "" }));
  const k = makeKnown([items], "/nonexistent-word-list");
  assert.equal(k("xylocaine"), true);
  assert.equal(k("dose"), true);
  assert.equal(k("rare"), false);
});

test("item edits: stem, image paths and stack move; answer key, options and explanation never change", () => {
  const it = { id: "x1", q: "Old stem names the answer.", o: ["A", "B", "C", "D"], a: 2, exp: "why", img: ["rn-n2-p090-3.webp"], stack: { id: "rad-rcc-01", base: "v6/ss-radiology/stack/rad-rcc-01/", n: 3, w: ["soft"] } };
  const ch = editItem(it, { stems: { x1: "The image is shown. What is the most likely diagnosis?" }, imgPrefix: "img/radnotes/",
    imgMap: { "img/radnotes/rn-n2-p090-3.webp": "img/radnotes/rn-n2-p090-3-nl.webp", "stack:v6/ss-radiology/stack/rad-rcc-01/": "v11/ss-radiology/stack/s-0123abcd/" } });
  assert.deepEqual(ch, ["stem", "img", "stack"]);
  assert.equal(it.q, "The image is shown. What is the most likely diagnosis?");
  assert.deepEqual(it.img, ["img/radnotes/rn-n2-p090-3-nl.webp"]);
  assert.deepEqual([it.stack.id, it.stack.base, it.stack.n], ["s-0123abcd", "v11/ss-radiology/stack/s-0123abcd/", 3]);
  assert.deepEqual([it.a, it.o, it.exp], [2, ["A", "B", "C", "D"], "why"]);
  assert.throws(() => editItem({ id: "y", q: "q", o: ["a"], a: 0 }, { stems: { y: " " } }), /empty stem/);
});

test("item edits: a file keeps its shape, takes the new set name, and reports what changed per kind", () => {
  const src = { topic: "rad-gi", set: "radnotes", v: 1, items: [{ id: "a", q: "s", o: ["p", "q"], a: 1, img: ["rn-1.webp"] }, { id: "b", q: "t", o: ["p", "q"], a: 0 }] };
  const r = editFile(src, { set: "radnotes2", imgPrefix: "img/radnotes/", stems: { b: "new" } });
  assert.equal(r.json.set, "radnotes2");
  assert.deepEqual(r.json.items.map((x) => x.q), ["s", "new"]);
  assert.deepEqual(r.json.items[0].img, ["img/radnotes/rn-1.webp"], "a bare name is written out in full, the new folder is not an image folder");
  assert.deepEqual(r.changes, { img: ["a"], stem: ["b"] });
  assert.equal(src.items[1].q, "t", "the input is not mutated");
});

test("named search index: the subject index may name search-<hash>.json; anything else reads search.json", () => {
  assert.equal(P.searchFile({ search: "search-2fc5fc18.json" }), "search-2fc5fc18.json");
  for (const bad of [null, {}, { search: "search.json" }, { search: "../x.json" }, { search: "search-2FC5FC18.json" }, { search: 5 }]) assert.equal(P.searchFile(bad), "search.json");
  assert.equal(bankPath({ path: ["v5", "radiology", "search-2fc5fc18.json"] }), "v5/radiology/search-2fc5fc18.json");
  assert.equal(bankPath({ path: ["v5", "radiology", "search-2fc5fc1.json"] }), null);
  assert.equal(bankPath({ path: ["v5", "radiology", "search-2fc5fc18x.json"] }), null);
});
