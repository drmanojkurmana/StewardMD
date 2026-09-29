// Tokós question bank search index: builder, engine search function, exam draw, and the shipped search.json against the topic files.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSearch, preview } from "../tools/tokos-build-mcq-search.mjs";

const B = createRequire(import.meta.url)("../specialty-bank.js");
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tokos", "decks", "mcq");
const it = (id, q, o, t) => ({ id, q, o, a: 0, exp: "", t, d: 1 });
const topics = [
  { id: "a", items: [it("a1", "Eclampsia is treated with", ["Magnesium sulphate", "Diazepam", "Phenytoin", "Labetalol"], "a"), it("a2", "Fibroids in pregnancy", ["Red degeneration", "Torsion", "Cyst", "Abscess"], "a")] },
  { id: "b", items: [it("b1", "Drug of choice in eclampsia seizures", ["MgSO4", "Lorazepam", "Valproate", "Nifedipine"], "b")] },
];

test("tokens: lowercase stems, stopwords and single letters removed, distinct", () => {
  assert.deepEqual(B.tokens("The Fibroids are treated with Magnesium, magnesium A"), ["fibroid", "treat", "magnesium"]);
});

test("buildSearch is deterministic and numbers items in topic order", () => {
  const x = buildSearch(topics), y = buildSearch(topics);
  assert.equal(JSON.stringify(x), JSON.stringify(y));
  assert.deepEqual(x.ids, ["a1", "a2", "b1"]);
  assert.deepEqual(x.start, [0, 2]);
  assert.equal(x.n, 3);
});

test("searchIndex: prefix and stem match, all words must hit, topic and preview returned, capped", () => {
  const sx = buildSearch(topics);
  assert.deepEqual(B.searchIndex(sx, "eclamp").map((h) => h.id), ["a1", "b1"]);
  assert.deepEqual(B.searchIndex(sx, "eclampsia magnesium").map((h) => [h.id, h.t]), [["a1", "a"]]);
  assert.equal(B.searchIndex(sx, "fibroid")[0].p, "Fibroids in pregnancy");
  assert.equal(B.searchIndex(sx, "eclampsia", 1).length, 1);
  assert.deepEqual(B.searchIndex(sx, "ec"), []);
  assert.deepEqual(B.searchIndex(sx, "zzzzz"), []);
  assert.equal(B.searchIndex(sx, "b1seizures")[0], undefined);
});

test("preview: short stems stay, long ones cut at a word", () => {
  assert.equal(preview("Short?"), "Short?");
  const p = preview("word ".repeat(40));
  assert.ok(p.length <= 82 && p.endsWith("…"));
});

test("examDraw loads at most two topics at a time and takes a quota from each", async () => {
  let live = 0, peak = 0;
  const load = async (id) => { live++; peak = Math.max(peak, live); await null; live--; return Array.from({ length: 20 }, (_, i) => ({ id: id + i })); };
  const out = await B.examDraw(["t1", "t2", "t3", "t4", "t5", "t6", "t7"], load, (l) => l, 30, 6, () => 0.5);
  assert.equal(out.length, 30);
  assert.ok(peak <= 2);
  assert.equal(new Set(out.map((x) => x.id)).size, 30);
  // a short pool pulls in later topics
  const small = await B.examDraw(["t1", "t2", "t3", "t4"], async (id) => [{ id: id + 0 }], (l) => l, 30, 6);
  assert.equal(small.length, 4);
});

test("shipped search.json matches the topic files: every id exists in its topic, counts agree", () => {
  const ix = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
  const sx = JSON.parse(fs.readFileSync(path.join(DIR, "search.json"), "utf8"));
  assert.deepEqual(sx.topics, ix.topics.map((t) => t.id));
  assert.equal(sx.n, ix.counts.total);
  assert.equal(sx.ids.length, sx.n);
  assert.equal(sx.p.length, sx.n);
  ix.topics.forEach((t, j) => {
    const items = JSON.parse(fs.readFileSync(path.join(DIR, path.basename(t.file)), "utf8")).items;
    const end = j + 1 < sx.start.length ? sx.start[j + 1] : sx.n;
    assert.equal(end - sx.start[j], t.count, t.id + " count");
    assert.deepEqual(sx.ids.slice(sx.start[j], end), items.map((x) => x.id), t.id + " ids in order");
  });
  assert.ok(fs.statSync(path.join(DIR, "search.json")).size < 1.5e6, "under 1.5 MB");
  // regenerating from the topic files gives the same bytes
  const again = JSON.stringify(buildSearch(ix.topics.map((t) => ({ id: t.id, items: JSON.parse(fs.readFileSync(path.join(DIR, path.basename(t.file)), "utf8")).items }))));
  assert.equal(again, fs.readFileSync(path.join(DIR, "search.json"), "utf8"));
  assert.ok(B.searchIndex(sx, "eclampsia").length > 0);
});
