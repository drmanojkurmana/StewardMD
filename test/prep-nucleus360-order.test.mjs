// Nucleus360 ordering, coverage, offline gaps, summary and topic search (prep-nucleus360.js).
// All items synthetic.
// node --test test/prep-nucleus360-order.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const N = require("../prep-nucleus360.js");

const OUTLINE = N.outlineOf({ id: "t1", title: "Pancreatic adenocarcinoma" });
const ASSIGN = { "def-epi": ["a", "b", "c", "d"], aet: ["e"], path: [], clin: ["f", "g"], comp: ["h"], inv: ["i", "j", "k", "l"], dx: ["m"], ddx: [], rx: ["n", "o", "p"], prog: ["q"], prev: [], guide: [], pearl: ["r"], img: [] };

test("learn order follows the chapter, core concepts take more", () => {
  const rows = N.orderForStudy(OUTLINE, ASSIGN, "learn");
  assert.deepEqual(rows.map((r) => r.concept.id), ["def-epi", "aet", "clin", "comp", "inv", "dx", "rx", "prog", "pearl"]);
  assert.deepEqual(rows[0].items, ["a", "b", "c"], "core capped at 3");
  assert.deepEqual(rows[1].items, ["e"]);
  assert.deepEqual(rows.find((r) => r.concept.id === "pearl").items, ["r"], "extra capped at 1");
  assert.ok(!rows.some((r) => r.concept.id === "path"), "empty concepts are skipped, not padded");
});

test("test order is seeded-shuffled and stable; revise keeps weak only", () => {
  const t1 = N.orderForStudy(OUTLINE, ASSIGN, "test", "seed1");
  const t2 = N.orderForStudy(OUTLINE, ASSIGN, "test", "seed1");
  assert.deepEqual(t1._shuffled, t2._shuffled);
  const flat = [];
  t1.forEach((r) => r.items.forEach((id) => flat.push(id)));
  assert.equal(flat.length, t1._shuffled.length);
  const t3 = N.orderForStudy(OUTLINE, ASSIGN, "test", "other");
  assert.notDeepEqual(t1._shuffled, t3._shuffled, "a different seed shuffles differently");
  const rev = N.orderForStudy(OUTLINE, ASSIGN, "revise", null, ["inv", "rx"]);
  assert.deepEqual(rev.map((r) => r.concept.id), ["inv", "rx"]);
});

test("coverage meter counts honestly, gaps are named", () => {
  const c = N.coverage(OUTLINE, ASSIGN);
  assert.equal(c.total, 14);
  assert.equal(c.covered, 9);
  assert.deepEqual(c.gaps, ["path", "ddx", "prev", "guide", "img"]);
  assert.equal(c.per.find((p) => p.id === "inv").n, 4);
  const gaps = N.offlineGaps(c);
  assert.ok(gaps.every((g) => g.offline && g.label === "will be added when you are online"));
});

test("summary aggregates right/wrong/guess; revise threshold is 60%", () => {
  const order = N.orderForStudy(OUTLINE, ASSIGN, "learn");
  const results = { a: { ok: true, conf: "sure" }, b: { ok: true, conf: "sure" }, c: { ok: false, conf: "guess" }, e: { ok: false, conf: "sure" }, i: { ok: true, conf: "unsure" }, j: { ok: true, conf: "sure" }, k: { ok: true, conf: "sure" } };
  const s = N.summaryFor(order, results);
  const def = s.per.find((p) => p.id === "def-epi");
  assert.deepEqual([def.right, def.wrong, def.guess, def.n], [2, 1, 1, 3]);
  assert.ok(def.revise, "a guess marks revise even at 67%");
  const inv = s.per.find((p) => p.id === "inv");
  assert.ok(inv.revise, "unsure counts as guess");
  const aet = s.per.find((p) => p.id === "aet");
  assert.ok(aet.revise, "0% revises");
  assert.ok(s.revise.includes("def-epi") && s.revise.includes("aet"));
  const lines = N.revisionList(s, { "def-epi": [{ title: "Lesson: Pancreas" }] });
  assert.ok(lines.some((l) => /Definition and epidemiology: 67% \(2\/3\), 1 guessed -> revise with Lesson: Pancreas/.test(l)));
});

test("rail text and chapter note are short and claim-free", () => {
  assert.equal(N.railText(3, 12, { title: "Investigations" }), "Concept 4 of 12: Investigations");
  const note = N.chapterNote({ tier: "core" }, 3, 12, [{ title: "Lesson: Pancreas" }]);
  assert.ok(note.split(". ").length <= 3, "2-3 lines");
  assert.match(note, /Core concept, concept 4 of 12/);
  assert.match(note, /Revise: Lesson: Pancreas/);
});

test("findTopic resolves a name to the topic", () => {
  const topics = [{ id: "ca-pancreas", title: "Pancreatic adenocarcinoma", aliases: ["CA pancreas", "cancer head of pancreas"] }, { id: "gall", title: "Gallstone disease" }];
  assert.equal(N.findTopic("Pancreatic adenocarcinoma", topics).id, "ca-pancreas");
  assert.equal(N.findTopic("ca pancreas", topics).id, "ca-pancreas");
  assert.equal(N.findTopic("xyzzy nothing", topics), null);
  assert.equal(N.findTopic("", topics), null);
});
