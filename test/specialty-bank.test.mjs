// Specialty engine question bank, ported from the Ophthalmós mcq test (deck shape) to the split bank format the
// Tokós bank uses: decks/mcq/index.json (topics with count and file) and decks/mcq/<topic>.json ({topic, items}),
// loaded one topic at a time. Items: {id, q, o:[4], a, exp (may be ""), t, d, flags?}. Ophthalmós's single-file
// shape (items in the deck, explanation "x", topics as an id -> label map) still reads. Fixture: specialty-fixture.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const B = createRequire(import.meta.url)("../specialty-bank.js");
const dir = new URL("./fixtures/specialty-fixture/decks/", import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, dir), "utf8"));
const index = read("mcq/index.json");
const all = index.topics.flatMap((t) => read(t.file).items);

test("the bank index validates: topics with a title, a count and a file; licence and citation", () => {
  assert.deepEqual(B.validateIndex(index), []);
  const e = B.validateIndex({ id: "mcq", topics: [{ id: "a", title: { hi: "x" } }, { id: "a", title: { en: "A" }, file: "mcq/a.json", count: 1 }] }).join("\n");
  for (const m of [/licence/, /citation/, /topics\[0\]\.title/, /topics\[0\]\.file/, /topics\[1\]\.id: duplicate a/]) assert.match(e, m);
  assert.deepEqual(B.validateIndex(null), ["index: needs {topics: [...]}"]);
});

test("every topic file validates, its items carry its topic, and the counts add up", () => {
  for (const t of index.topics) {
    const f = read(t.file);
    assert.equal(f.topic, t.id);
    assert.deepEqual(B.validateItems(f.items, [t.id]), [], t.id);
    assert.equal(f.items.length, t.count, t.id + " count");
  }
  assert.equal(all.length, index.counts.total);
});

test("validateItems: 4 distinct options, a valid answer index, a known topic, unique ids, d in 1..3, flags a list", () => {
  const bad = JSON.parse(JSON.stringify(all));
  bad[0].o = ["A", "a", "B", "C"]; bad[1].a = 4; bad[2].t = "nope"; bad[3].q = " "; bad[4].id = bad[5].id; bad[6].d = 7; bad[7].flags = "x";
  const e = B.validateItems(bad, ["fx-a", "fx-b"]).join("\n");
  for (const m of [/q0: 4 distinct options/, /q1: answer index/, /q2: unknown topic nope/, /q3: question/, /duplicate id q5/, /q6: d must be 1, 2 or 3/, /q7: flags a list/]) assert.match(e, m);
  const empty = all.find((x) => x.exp === "");
  assert.ok(empty, "the fixture keeps one item with no explanation");
  assert.deepEqual(B.validateItems([empty], ["fx-a", "fx-b"]), [], "an empty explanation is allowed");
});

test("topics: the list of {id, title:{en,hi}} and the older id -> label map read the same way", () => {
  assert.deepEqual(B.topics(index).map((t) => t.id), ["fx-a", "fx-b"]);
  assert.deepEqual(B.topics(index)[1].title, { en: "Topic B", hi: "विषय B" });
  assert.equal(B.topics(index)[0].file, "mcq/fx-a.json");
  assert.deepEqual(B.topics({ topics: { cornea: "Cornea" } }), [{ id: "cornea", title: { en: "Cornea" }, count: null, file: null }]);
  assert.deepEqual(B.topics({}), []);
});

test("explanation: exp (Tokós) or x (Ophthalmós); empty is empty", () => {
  assert.equal(B.explanation({ exp: "two" }), "two");
  assert.equal(B.explanation({ x: "one" }), "one");
  assert.equal(B.explanation({ exp: "" }), "");
  assert.equal(B.explanation({}), "");
});

test("search: 3 letters or more, case-insensitive over the stem and options, capped", () => {
  assert.deepEqual(B.search(all, "al"), []);
  assert.equal(B.search(all, "ALPHA 3").length, 1);
  assert.equal(B.search(all, "fixture question").length, all.length);
  assert.equal(B.search(all, "fixture question", 4).length, 4);
});

test("examPick: n distinct questions, never more than the pool; examTopics spreads the exam over topics", () => {
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const p = B.examPick(all, 5, rnd);
  assert.equal(p.length, 5);
  assert.equal(new Set(p.map((x) => x.id)).size, 5);
  assert.equal(B.examPick(all, 50, rnd).length, all.length);
  const tp = B.examTopics([{ id: "a", count: 3 }, { id: "b", count: 0 }, { id: "c", count: 9 }, { id: "d", count: 1 }], 2, rnd);
  assert.equal(tp.length, 2);
  assert.ok(!tp.includes("b"), "a topic with no questions is never picked");
  assert.ok(B.EXAM_N > 0 && B.EXAM_SEC > 0);
});

test("dueTopics: the topics holding due cards, from the topic recorded at answer time", () => {
  const store = { cards: { "mcq:q1": [1, 1, 1, 5, 1, 0], "mcq:q7": [1, 1, 1, 50, 1, 0], "learn:x": [1, 1, 1, 1, 1, 0] }, mcqT: { q1: "fx-a", q7: "fx-b" } };
  assert.deepEqual(B.dueTopics(store, "mcq", 10), ["fx-a"]);
  assert.deepEqual(B.dueTopics(store, "mcq", 60).sort(), ["fx-a", "fx-b"]);
});

test("the Ophthalmós single-file shape still reads: items in the deck are split by topic", () => {
  const one = { id: "mcq", topics: { a: "A", b: "B" }, items: [{ id: "1", t: "a" }, { id: "2", t: "b" }, { id: "3", t: "a" }] };
  assert.deepEqual(Object.keys(B.byTopic(one.items)).sort(), ["a", "b"]);
  assert.equal(B.byTopic(one.items).a.length, 2);
});

test("no em-dash anywhere in the fixture bank", () => {
  assert.ok(!JSON.stringify([index, all]).includes("—"));
});
