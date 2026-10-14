// links-relabel: the index carries the item-evidence flag (ev) on kt/lt rows so the client
// renders plain module/subject fallbacks as "Learn this module".
// node --test test/prep-links-relabel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { addTopicLinks, shardRow } from "../tools/prep-links.mjs";

const CTX = (over = {}) => Object.assign({ mid: "m0", sid: "s", topics: {}, lessons: new Map(),
  lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map() }, over);

test("shardRow: specific rows stay short; kt/lt rows carry ev fifth", () => {
  assert.deepEqual(shardRow(0, { k: "kb", id: "a", title: "A", c: 92, v: "k", sec: "causes" }), [0, 92, "k", "causes"]);
  assert.deepEqual(shardRow(1, { k: "kb", id: "b", title: "B", c: 80, v: "q", sec: "" }), [1, 80, "q"]);
  assert.deepEqual(shardRow(2, { k: "kb", id: "c", title: "C", c: 75, v: "kt", sec: "", ev: 0 }), [2, 75, "kt", "", 0]);
  assert.deepEqual(shardRow(2, { k: "kb", id: "c", title: "C", c: 75, v: "kt", sec: "mgmt", ev: 1 }), [2, 75, "kt", "mgmt", 1]);
  assert.deepEqual(shardRow(3, { k: "ls", id: "m", title: "M", c: 75, v: "lt", sec: "", ev: 0 }), [3, 75, "lt", "", 0]);
  assert.deepEqual(shardRow(2, { k: "kb", id: "c", title: "C", c: 75, v: "kt", sec: "" }), [2, 75, "kt", ""],
    "an unclassified kt row reserves the sec slot but carries no flag (legacy rule: fallback)");
  assert.deepEqual(shardRow(4, { k: "ls", id: "s", title: "S", c: 85, v: "li", sec: "2", ev: 1 }), [4, 85, "li", "2"],
    "specific rows never grow: old clients read them unchanged");
});

test("addTopicLinks: own and subject lessons are fallbacks (ev 0)", () => {
  const lessons = new Map([["m1", [{ key: "m1", title: "Liver Masses", own: true }]]]);
  const ls = addTopicLinks([], { q: "Q?" }, CTX({ mid: "m1", lessons, lessonMeta: new Map([["m1", { title: "Liver Masses" }]]) }));
  assert.deepEqual(ls, [{ k: "ls", id: "m1", title: "Liver Masses", c: 75, v: "lt", sec: "", ev: 0 }]);
  const sub = addTopicLinks([], { q: "Q?" }, CTX({ subjectLesson: { key: "s-mixed", title: "Rapid review" } }));
  assert.deepEqual(sub, [{ k: "ls", id: "s-mixed", title: "Rapid review", c: 75, v: "lt", sec: "", ev: 0 }]);
});

test("addTopicLinks: mapped articles are evidenced only when the item names them", () => {
  const topics = { m0: { kb: [["cataract", "Cataract"]] } };
  const named = addTopicLinks([], { q: "Cataract clouds the lens. What is the treatment?", o: ["Cataract", "Glaucoma"], a: 0 }, CTX({ topics }));
  assert.deepEqual(named.map((l) => [l.id, l.v, l.ev]), [["cataract", "kt", 1]]);
  const other = addTopicLinks([], { q: "Red eye after welding. What is the cause?", o: ["Arc eye", "Glaucoma"], a: 0 }, CTX({ topics }));
  assert.deepEqual(other.map((l) => [l.id, l.v, l.ev]), [["cataract", "kt", 0]]);
  const wrongOpt = addTopicLinks([], { q: "Red eye after welding. Which of these is unrelated?", o: ["Arc eye", "Cataract"], a: 0 }, CTX({ topics }));
  assert.deepEqual(wrongOpt.map((l) => [l.id, l.v, l.ev]), [["cataract", "kt", 0]],
    "a wrong-option-only mention never counts as item evidence");
});

test("addTopicLinks: stem-evidenced upgrades and per-item promotions are ev 1", () => {
  const topics = { m0: { kb: [["cholera", "Cholera"]] } };
  const it = { q: "Cholera causes rice-water stools. What is the cause?", o: ["Cholera", "Rotavirus"], a: 0 };
  const weak = [{ k: "kb", id: "cholera", title: "Cholera", c: 70, v: "s", sec: "" }];
  addTopicLinks(weak, it, CTX({ topics }));
  assert.deepEqual(weak.map((l) => [l.v, l.c, l.ev]), [["kt", 75, 1]]);
  const it2 = { q: "Cholera causes rice-water stools. What is it?", o: ["Cholera", "Rotavirus"], a: 0 };
  const cand = [{ k: "kb", id: "cholera", title: "Cholera", c: 70, v: "s", sec: "" }];
  addTopicLinks(cand, it2, CTX({}));
  assert.deepEqual(cand.map((l) => [l.v, l.c, l.ev]), [["kt", 75, 1]], "the per-item topic target is item-evidenced");
});

test("addTopicLinks: the image-step lesson is item-evidenced (ev 1)", () => {
  const lessons = new Map([["m1", [{ key: "m1", title: "Liver Masses", own: true }]]]);
  const img = addTopicLinks([], { img: ["v1/x/a.webp"] }, CTX({ mid: "m1", topics: {}, lessons,
    lessonMeta: new Map([["m1", { title: "Liver Masses" }], ["c9", { title: "Step" }]]),
    images: new Map([["a.webp", { l: "c9", step: 2 }]]) }));
  assert.deepEqual(img.map((l) => [l.id, l.v, l.ev]), [["m1", "lt", 0], ["c9", "li", 1]]);
});
