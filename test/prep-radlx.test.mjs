/* PrepNucleus interactive lessons: the reader's pure helpers (prep-lessons.js) and the radbook interactive pass
 * (tools/prep-radlx.mjs). What must hold: a malformed spot, label set, compare or quick check is dropped by tidyLesson
 * and the rest of the lesson stays; a file with every new part still passes the old checkLesson (older readers show the
 * figures); a tap within 4% of the box counts; pages are the steps, then the sign cards, then the key points; a compare
 * gets the slider only when both shapes are within 12%; every image of a compare is prefetched; the generator's model
 * boxes ([ymin, xmin, ymax, xmax] on 0..1000) become [x, y, w, h] and too small or too large ones are refused; marks
 * too close together or off the image are dropped; text gates refuse dashes, source names and numbers not in the
 * source; a quick check needs a valid key and distinct options; figure uses need two yes votes; the lesson builder keeps
 * kept figures, adds voted overlays only, inserts voted figure steps, and stays under the old reader's limits; the index
 * marks revised lessons "r": 2 without touching the rest.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-radlx.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as X from "../tools/prep-radlx.mjs";

const req = createRequire(import.meta.url);
const P = req("../prep-lessons.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(fs.readFileSync(join(ROOT, "test/fixtures/prep-lx/api/v2/lessons/radbook-fx-ix.json"), "utf8"));
const OLD = JSON.parse(fs.readFileSync(join(ROOT, "test/fixtures/prep-lx/api/v1/lessons/radbook-fx-plain.json"), "utf8"));

test("reader: tidyLesson drops malformed optional parts, keeps the lesson", () => {
  const t = P.tidyLesson(FX);
  assert.equal(t.steps.length, 5);
  assert.ok(t.steps[0].vis.spot && t.steps[1].vis.marks && t.steps[2].vis.pair && t.steps[3].vis.pair);
  assert.equal(t.steps[3].qc, undefined, "the broken quick check (1 option, key 3) is dropped");
  assert.ok(t.steps[1].qc && t.steps[2].qc);
  assert.deepEqual(P.checkLesson(t), []);
  const bad = JSON.parse(JSON.stringify(FX));
  bad.steps[0].vis.spot.box = [0.9, 0.1, 0.3, 0.2];             // runs off the image
  bad.steps[1].vis.marks = [{ x: 1.4, y: 0.2, label: "Off" }];
  bad.steps[2].vis.pair.src = "../evil.webp";
  bad.steps[0].vis.ar = 40;
  bad.cards = [{ f: "", b: "x" }]; bad.keys = ["", 3];
  const u = P.tidyLesson(bad);
  assert.equal(u.steps[0].vis.spot, undefined); assert.equal(u.steps[1].vis.marks, undefined); assert.equal(u.steps[2].vis.pair, undefined);
  assert.equal(u.steps[0].vis.ar, undefined); assert.equal(u.cards, undefined); assert.equal(u.keys, undefined);
  assert.deepEqual(P.checkLesson(u), [], "still a drawable lesson");
  assert.equal(bad.steps[0].vis.spot.box[0], 0.9, "the input is not mutated");
});
test("reader: one interaction a figure (spot wins, then labels)", () => {
  const l = JSON.parse(JSON.stringify(FX));
  l.steps[0].vis.marks = [{ x: 0.2, y: 0.2, label: "A" }]; l.steps[0].vis.pair = l.steps[2].vis.pair;
  const t = P.tidyLesson(l);
  assert.ok(t.steps[0].vis.spot && !t.steps[0].vis.marks && !t.steps[0].vis.pair);
});
test("reader: the new parts still pass the old checkLesson (graceful fallback)", () => {
  assert.deepEqual(P.checkLesson(FX), []);
  for (const s of FX.steps) if (s.vis) assert.equal(P.checkVis(s.vis), "");
});
test("reader: hitBox, pages, interactions, sliderPair, prefetch list", () => {
  const b = [0.5, 0.5, 0.1, 0.1];
  assert.ok(P.hitBox(b, 0.55, 0.55)); assert.ok(P.hitBox(b, 0.62, 0.47), "within 4% of the edge");
  assert.ok(!P.hitBox(b, 0.65, 0.55)); assert.ok(!P.hitBox(b, 0.3, 0.3));
  assert.deepEqual(P.pages(FX), [0, 1, 2, 3, 4, "cards", "keys"]);
  assert.deepEqual(P.pages(OLD), [0, 1, 2, 3]);
  assert.deepEqual(P.interactions(P.tidyLesson(FX)), { spot: 1, marks: 1, pair: 2, qc: 2, cards: 1 });
  assert.ok(P.sliderPair(FX.steps[2].vis)); assert.ok(!P.sliderPair(FX.steps[3].vis)); assert.ok(!P.sliderPair(FX.steps[0].vis));
  assert.deepEqual(P.lessonImages(FX), ["v1/lessons/media/rb-fx-ix-a.webp", "v1/lessons/media/rb-fx-ix-c.webp", "v1/lessons/media/rb-fx-ix-b.webp"]);
  assert.ok(P.isTF(FX.steps[1].qc)); assert.ok(!P.isTF(FX.steps[2].qc));
  assert.match(P.visText(FX.steps[0].vis), /Bright blob/);
});
test("generator: model boxes and marks", () => {
  assert.deepEqual(X.boxOf([280, 580, 480, 780]), [0.58, 0.28, 0.2, 0.2]);
  assert.equal(X.boxOf([0, 0, 5, 5]), null, "too small");
  assert.equal(X.boxOf([0, 0, 900, 900]), null, "too large");
  assert.equal(X.boxOf([500, 500, 400, 600]), null, "inverted");
  assert.equal(X.boxOf([0, 0, 1200, 100]), null, "off the image");
  assert.equal(X.boxOf("x"), null);
  const m = X.marksOf([{ pt: [500, 500], label: "Aorta" }, { pt: [510, 505], label: "Too close" }, { pt: [100, 2000], label: "Off" }, { pt: [200, 800], label: "Left – dash" }, { pt: [800, 200], label: "Right atrium" }]);
  assert.deepEqual(m.map((x) => x.label), ["Aorta", "Right atrium"]);
  assert.deepEqual([m[1].x, m[1].y], [0.2, 0.8]);
});
test("generator: text gates and quick checks", () => {
  const g = "The cavity wall is 4 mm thick in post primary tuberculosis.";
  assert.equal(X.textOk("A thick walled cavity in the upper lobe", 3, 20, g), "");
  assert.match(X.textOk("A cavity — upper lobe", 3, 20, g), /dash/);
  assert.match(X.textOk("As the book says a cavity forms", 3, 20, g), /source/);
  assert.match(X.textOk("The wall is 7 mm thick here", 3, 20, g), /numbers/);
  assert.match(X.textOk("Short", 3, 20, g), /words/);
  const ok = X.qcOf({ q: "Post primary tuberculosis cavities have thick walls.", o: ["true", "false"], a: 0, why: "The wall measures 4 mm in post primary disease, so it is thick." }, g);
  assert.deepEqual(ok.o, ["True", "False"]); assert.equal(ok.a, 0);
  assert.ok(X.qcOf({ q: "Which wall is thick in this disease?", o: ["A", "A", "B"], a: 0, why: "Because the cavity wall is thick here." }, g).bad);
  assert.ok(X.qcOf({ q: "Which wall is thick in this disease?", o: ["A", "B", "C"], a: 3, why: "Because the cavity wall is thick here." }, g).bad);
  assert.ok(X.qcOf({ q: "Which wall is thick in this disease?", o: ["A", "B"], a: 0, why: "Because the cavity wall is thick here." }, g).bad, "two options must be True and False");
});
test("generator: relevance and query", () => {
  assert.equal(X.queryOf("Radiological Features of Pulmonary Tuberculosis"), "Pulmonary Tuberculosis");
  assert.ok(X.relevant("Chest radiograph showing pulmonary cavities", "Radiological Features of Pulmonary Tuberculosis"));
  assert.ok(!X.relevant("Ultrasound images of kidneys", "Chest Radiograph Views and Anatomy Basics"));
});
test("generator: votes need two yes", () => {
  assert.ok(X.agree({ ok: true }, { ok: true }));
  assert.ok(!X.agree({ ok: true }, { ok: false })); assert.ok(!X.agree({ ok: true }, undefined)); assert.ok(!X.agree(null, { ok: true }));
});

const les = {
  v: 1, id: "radbook-x", module: "rad-chest", title: "T", minutes: 4, gen: "AI", quiz: [],
  steps: [0, 1, 2, 3].map((i) => ({ tx: "Step " + i + " **term** " + "word ".repeat(45).trim() + ".", say: "Step " + i + " term " + "word ".repeat(45).trim() + ".", vis: i === 0 ? { kind: "image", src: "v1/lessons/media/rb-a.webp", alt: "A", caption: "Kept caption here." } : i === 3 ? { kind: "table", cols: ["a", "b"], rows: [["1", "2"], ["3", "4"]] } : null })),
};
const pool = { used: { 0: "C1" }, cands: [
  { cid: "C1", kind: "pdf", name: "rb-a.webp", file: "/a", cap: "a", w: 800, h: 1000 },
  { cid: "C2", kind: "pdf", name: "rb-b.webp", file: "/b", cap: "b", w: 1000, h: 800 },
  { cid: "C3", kind: "openi", name: "rb-oi-c.webp", file: "/c", cap: "c", w: 800, h: 1000, credit: { title: "T", authors: "A", lic: { code: "CC BY 4.0" } } },
  { cid: "C4", kind: "pdf", name: "rb-d.webp", file: "/d", cap: "d", w: 800, h: 1000 }] };
const gated = { figs: { 0: { c: "C1", cap: "New caption for the kept figure." }, 1: { c: "C2", cap: "Second figure caption here." } },
  add: [{ after: 1, c: "C4", tx: "An added **figure** step " + "word ".repeat(50).trim() + ".", cap: "Added figure caption." }],
  spot: [{ c: "C1", q: "Tap the cavity", box: [0.1, 0.1, 0.2, 0.2], label: "Cavity", why: "A thick wall." }], reveal: [{ c: "C2", marks: [{ x: 0.2, y: 0.2, label: "A" }, { x: 0.6, y: 0.6, label: "B" }, { x: 0.8, y: 0.3, label: "C" }] }],
  pair: { a: "C4", b: "C3", la: "Disease", lb: "Normal", why: "Look at the wall." }, qc: [{ after: 2, q: "Q?", o: ["True", "False"], a: 1, why: "Why." }, { after: 0, q: "Q2?", o: ["A", "B", "C"], a: 2, why: "Why." }],
  cards: [{ f: "Sign A", b: "Meaning A here." }, { f: "Sign B", b: "Meaning B here." }], keys: ["Key one.", "Key two.", "Key three."] };
test("generator: buildLesson applies only what both votes passed", () => {
  const votes = { uses: { "fig:0": { fig: true, overlay: false }, "fig:1": { fig: true, overlay: true }, "add:0": { fig: true, overlay: true }, pair: { fig: true } },
    marks: { "fig:1": [true, false, true] }, qc: [true, false], cards: [true, true], keys: [true, false, true] };
  const { lesson, media } = X.buildLesson(les, pool, gated, votes);
  assert.equal(lesson.steps.length, 5, "one figure step inserted after step 1");
  assert.equal(lesson.steps[0].vis.spot, undefined, "a spot whose box failed a vote is left out, the figure stays");
  assert.equal(lesson.steps[0].vis.caption, "New caption for the kept figure.");
  assert.equal(lesson.steps[0].vis.ar, 0.8);
  assert.deepEqual(lesson.steps[1].vis.marks.map((m) => m.label), ["A", "C"], "a label one vote refused is dropped");
  assert.equal(lesson.steps[2].vis.src, "v1/lessons/media/rb-d.webp"); assert.equal(lesson.steps[2].vis.pair.src, "v1/lessons/media/rb-oi-c.webp");
  assert.equal(lesson.steps[2].say.indexOf("**"), -1);
  assert.equal(lesson.steps[0].qc, undefined, "a quick check one vote refused is dropped");
  assert.ok(lesson.steps[3].qc, "a quick check stays on its step after the insert");
  assert.equal(lesson.steps[4].vis.kind, "table");
  assert.deepEqual(lesson.keys, ["Key one.", "Key three."]); assert.equal(lesson.cards.length, 2);
  assert.deepEqual([...media.keys()].sort(), ["rb-a.webp", "rb-b.webp", "rb-d.webp", "rb-oi-c.webp"]);
  assert.deepEqual(P.checkLesson(lesson), [], "the old reader's limits hold");
  assert.deepEqual(X.lessonCounts(lesson), { images: 4, interactive: 4 });
  const none = X.buildLesson(les, pool, gated, { uses: {}, marks: {}, qc: [], cards: [], keys: [] }).lesson;
  assert.equal(none.steps.length, 4); assert.equal(none.steps[1].vis, null, "an unvoted figure never ships");
  assert.equal(none.steps[0].vis.src, "v1/lessons/media/rb-a.webp", "the kept figure stays as it was");
});
test("generator: gateLesson keeps kept figures, refuses reuse and bad boxes", () => {
  const ground = "word term figure cavity";
  const p = { used: { 0: "C1" }, cands: pool.cands };
  const pl = { figs: [{ i: 0, c: "C2", cap: "Replaces the kept figure wrongly." }, { i: 1, c: "C2", cap: "A fine caption for this figure." }, { i: 2, c: "C2", cap: "Reuses a figure in the lesson." }, { i: 3, c: "C4", cap: "Tables stay as they are now." }],
    add: [], spot: [{ c: "C2", q: "Tap the cavity", box: [100, 100, 300, 300], label: "Cavity", why: "The cavity has a thick wall and sits in the upper zone of the lung." }, { c: "C1", q: "Tap the cavity", box: [0, 0, 2, 2], label: "Cavity", why: "The cavity has a thick wall and sits in the upper zone of the lung." }],
    reveal: [], pair: [], qc: [], cards: [], keys: [] };
  const { g } = X.gateLesson(les, p, pl, ground);
  assert.equal(g.figs[0].c, "C1", "a kept figure is not replaced");
  assert.equal(g.figs[1].c, "C2"); assert.equal(g.figs[2], undefined, "a figure is used once"); assert.equal(g.figs[3], undefined, "tables stay");
  assert.equal(g.spot.length, 1); assert.deepEqual(g.spot[0].box, [0.1, 0.1, 0.2, 0.2]);
});
test("generator: indexWith marks revised lessons r 2", () => {
  const live = { v: 1, modules: { a: { title: "A", steps: 4, minutes: 4, set: "radbook" }, b: { title: "B", steps: 5 } } };
  const ix = X.indexWith(live, [{ id: "a", steps: [1, 2, 3, 4, 5], minutes: 7 }, { id: "zz", steps: [] }]);
  assert.deepEqual(ix.modules.a, { title: "A", steps: 5, minutes: 7, set: "radbook", r: 2 });
  assert.deepEqual(ix.modules.b, live.modules.b); assert.equal(ix.modules.zz, undefined);
});
test("generator: parseList reads the detection reply", () => {
  assert.deepEqual(X.parseList('```json\n[{"box_2d":[1,2,3,4],"label":"x"}]\n```'), [{ box_2d: [1, 2, 3, 4], label: "x" }]);
  assert.deepEqual(X.parseList('{"items":[{"label":"y"}]}'), [{ label: "y" }]);
  assert.deepEqual(X.parseList("no json"), []);
});
test("generator: a kept figure is never put on a second step", () => {
  const p = { used: { 1: "C1" }, cands: pool.cands };
  const { g } = X.gateLesson(les, p, { figs: [{ i: 0, c: "C1", cap: "Puts the kept figure on step one." }, { i: 1, c: "C1", cap: "Keeps the figure on its own step." }], add: [], spot: [], reveal: [], pair: [], qc: [], cards: [], keys: [] }, "word");
  assert.equal(g.figs[0], undefined); assert.equal(g.figs[1].c, "C1");
});
