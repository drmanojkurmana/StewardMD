// tools/prep-radmax.mjs pure helpers: page segments, draft parsing (key by text), code gates, key shuffle, image votes.
// No PDF text here: the fixtures are made-up radiology sentences.
import test from "node:test";
import assert from "node:assert/strict";
import { segments, cleanPage, draftToItem, gates, shuffle, tallyVotes, slate, itemsFor, isAnswerPage, EXAMISH, readReview, L, fixCandidates, collectLessons } from "../tools/prep-radmax.mjs";
import { buildDupInputs } from "../tools/prep-radmax-dup.mjs";

const SRC = "Pleural effusion blunts the costophrenic angle on an erect radiograph. About 200 ml of fluid is needed before the lateral angle blunts. A subpulmonic effusion mimics a raised hemidiaphragm. Ultrasound detects small effusions and guides aspiration.";
const unit = { uid: "notes1-p5", src: "notes1", kind: "text", pages: [5], header: "", segs: segments(5, SRC), want: [] };

function raw(over) {
  return Object.assign({
    fmt: "recognition", dif: "Easy", mod: "rad-chest", topic: "Chest", sub: "Pleural effusion",
    q: "On an erect frontal chest radiograph, which finding first suggests a small pleural collection?",
    o: ["Blunted costophrenic angle", "Raised hemidiaphragm", "Widened mediastinum", "Tracheal deviation"],
    kt: "Blunted costophrenic angle",
    ky: "Blunted costophrenic angle is the earliest erect film sign because fluid collects in the most dependent recess first.",
    ot: [{ opt: "Raised hemidiaphragm", why: "A subpulmonic collection can mimic it, but it is not the first sign." }, { opt: "Widened mediastinum", why: "This points to a mediastinal process, not fluid." }, { opt: "Tracheal deviation", why: "Seen with large collections or collapse." }],
    clue: "Dependent fluid fills the lateral recess first on an erect film.", lp: "Ultrasound picks up small collections and guides aspiration.",
    nt: "## Pleural fluid on radiographs\n- **Blunting** of the lateral recess appears once enough fluid collects.\n- A **subpulmonic** collection can look like a raised hemidiaphragm.\n- **Ultrasound** is more sensitive for small collections and is used to guide aspiration.\n- Compare erect and supine films because fluid layers posteriorly when the patient lies flat, which makes the lung look hazy rather than giving a meniscus.",
    ev: ["5.1", "5.2"],
  }, over || {});
}

test("segments: numbered by page, exam-tagged lines dropped", () => {
  const s = segments(7, SRC + " This was asked in NEET 2019 as a recall question.");
  assert.equal(s[0].id, "7.1");
  assert.ok(s.every((x) => !EXAMISH.test(x.tx)));
  assert.equal(cleanPage("ﬁbrosis of the le-\nsion"), "fibrosis of the lesion");
});

test("draftToItem: the key comes from kt text, not a position", () => {
  const d = draftToItem(raw({ o: ["Raised hemidiaphragm", "Blunted costophrenic angle", "Widened mediastinum", "Tracheal deviation"], a: 0 }), unit);
  assert.equal(d.it.a, 1);
  assert.deepEqual(Object.keys(d.it.others).sort(), ["A", "C", "D"]);
  assert.equal(d.it.r[1], d.it.ky);
  assert.match(draftToItem(raw({ kt: "Something else" }), unit).why, /matches no option/);
});

test("gates: a clean item passes; invented numbers, copying and named sources fail", () => {
  const ok = draftToItem(raw(), unit).it;
  assert.deepEqual(gates(ok, unit), []);
  const num = draftToItem(raw({ ky: "Blunted costophrenic angle appears after 75 ml of fluid collects in the recess." }), unit).it;
  assert.ok(gates(num, unit).some((g) => /numbers/.test(g)));
  const copy = draftToItem(raw({ lp: "About 200 ml of fluid is needed before the lateral angle blunts on films." }), unit).it;
  assert.ok(gates(copy, unit).some((g) => /copies/.test(g)));
  const src = draftToItem(raw({ lp: "As figure 2 shows, ultrasound guides aspiration." }), unit).it;
  assert.ok(gates(src, unit).some((g) => /names a source/.test(g)));
  const ev = draftToItem(raw({ ev: ["9.9"] }), unit).it;
  assert.ok(gates(ev, unit).some((g) => /evidence/.test(g)));
});

test("draftToItem: true-false statements are put on their own lines", () => {
  const d = draftToItem(raw({ fmt: "true-false", q: "Consider: 1. Ultrasound guides aspiration. 2. Subpulmonic fluid raises the diaphragm. 3. Blunting needs no fluid. Which are true?", o: ["1 and 2 only", "2 and 3 only", "1 and 3 only", "3 only"], kt: "1 and 2 only", ot: [{ opt: "2 and 3 only", why: "3 is false." }, { opt: "1 and 3 only", why: "3 is false." }, { opt: "3 only", why: "3 is false." }] }), unit);
  assert.equal((d.it.q.match(/^[1-3]\. /gm) || []).length, 3);
  assert.ok(!gates(d.it, unit).some((g) => /numbered statements/.test(g)));
});

test("shuffle moves options, reasons and the key together", () => {
  const it = draftToItem(raw(), unit).it;
  for (const pos of [0, 1, 2, 3]) {
    const s = shuffle(it, "seed", pos);
    assert.equal(s.a, pos);
    assert.equal(s.o[pos], "Blunted costophrenic angle");
    assert.equal(s.r[pos], it.ky);
    for (const k of [0, 1, 2, 3]) if (k !== pos) assert.equal(s.others[L[k]], s.r[k]);
  }
});

test("tallyVotes: only two literal yes votes pass", () => {
  const t = tallyVotes(["a", "b", "c"], [{ id: "a", ok: true }, { id: "b", ok: true }, { id: "c", ok: false, why: "label gives it away" }], [{ id: "a", ok: true }, { id: "c", ok: true }]);
  assert.equal(t.get("a").ok, true);
  assert.equal(t.get("b").ok, false);
  assert.match(t.get("c").why, /label/);
});

test("slate, itemsFor, answer pages, review parsing", () => {
  assert.equal(slate(5, "x").length, 5);
  assert.deepEqual(slate(3, "x"), slate(3, "x"));
  assert.equal(itemsFor(100), 0); assert.equal(itemsFor(1000), 1); assert.equal(itemsFor(5000), 3);
  assert.ok(isAnswerPage("1.\n(a)\nTrue\n(b)\nFalse - no\n(c)\nTrue"));
  const r = readReview(JSON.stringify({ g: [{ i: 0, g4: true, g6: true, g7: true, g8: true, g9: true, gx: true, g10: true, gf: true, gl: true, why: "" }, { i: 1, g4: true, g6: true, g7: true, g8: true, g9: false, gx: true, g10: true, gf: true, gl: true, why: "not in source" }] }), 3);
  assert.equal(r[0].pass, true); assert.equal(r[1].pass, false); assert.equal(r[2].pass, false);
});

test("fixCandidates: rewrites failed first-round text items, never doubted keys, images or second rounds", () => {
  const items = [{ id: "a", tag: "g1" }, { id: "b", tag: "g1" }, { id: "c", tag: "g2" }, { id: "d", tag: "g1", fig: { id: "f" } }, { id: "e", tag: "g1" }, { id: "g", tag: "g1" }];
  const fact = new Map([["a", { ok: false, key: true, why: "invented age" }], ["b", { ok: false, key: false, why: "key wrong" }], ["c", { ok: false, key: true }], ["d", { ok: false, key: true }], ["e", { ok: true, key: true }]]);
  assert.deepEqual(fixCandidates(items, fact).map((i) => i.id), ["a"]);
});

test("collectLessons: distinct reasons per unit, skips bookkeeping reasons", () => {
  const m = collectLessons([{ uid: "u1", why: "fact check: invented age" }, { uid: "u1", why: "fact check: invented age" }, { uid: "u1", why: "image item superseded by the figure-checked regeneration" }, { uid: "u2", why: "" }, { uid: "u3", why: "blind solver disagreed" }]);
  assert.deepEqual(m.get("u1"), ["fact check: invented age"]);
  assert.equal(m.has("u2"), false);
  assert.deepEqual(m.get("u3"), ["blind solver disagreed"]);
});

test("buildDupInputs: only checked items are new; live includes the bank and earlier accepted items", () => {
  const it = (id, mod, extra = {}) => ({ id, mod, q: "q " + id, o: ["a", "b", "c", "d"], a: 1, ...extra });
  const items = [it("n1", "m1", { run: "b3" }), it("n2", "m1", { run: "b3" }), it("n3", "m1", { run: "b3", fig: { id: "f" } }), it("n4", "m1", { run: "i2", fig: { id: "g" } })];
  const fact = new Map(["n1", "n3", "n4"].map((id) => [id, { ok: true }]).concat([["n2", { ok: false }]]));
  const va = new Map([["n3", { ok: true }], ["n4", { ok: true }]]), vb = new Map([["n3", { ok: true }], ["n4", { ok: true }]]);
  const out = buildDupInputs({ items, fact, va, vb, imgRuns: ["i2"], liveOf: () => [it("L1", "m1")], assembled: [it("k1", "m1"), it("k2", "m2")] });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].new.map((x) => x.id), ["n1", "n4"]);
  assert.deepEqual(out[0].live.map((x) => x.id), ["L1", "k1"]);
  assert.equal(out[0].new[0].key, "B. b");
});
