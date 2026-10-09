// tools/prep-medcov.mjs: pure parts (topic clusters, coverage rule, level plan, format and copy gates, item shape).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clusterTopics, coverageOf, gapOf, assignLevels, fmtOk, gateQ, numbersOk, reasoningOrder, finalItem, sanitizeQ, us, kwHit, SET,
  OUT_SET, keyOpener, comboKeyAgrees, gateXAll, noteLines, applyDrops, tidyItem, readTidy, tidyPrompt,
} from "../tools/prep-medcov.mjs";

const g = (sents) => ({ sents: sents.map((tx, n) => ({ n, tx })), text: sents.join(" ") });
const rq = (o) => ({ st: "A 30-year-old man has crushing chest pain and ST elevation in the anterior leads. What is the most specific marker of myocardial necrosis?",
  key: { ot: "Cardiac troponin", wr: "Troponin is the most specific marker of myocardial necrosis." },
  dis: [{ ot: "Serum myoglobin", wr: "Myoglobin rises early but is not cardiac specific.", et: "knowledge" }, { ot: "Lactate dehydrogenase", wr: "LDH rises in many tissues.", et: "knowledge" }, { ot: "Creatine kinase MB", wr: "CK-MB is less sensitive than troponin.", et: "knowledge" }],
  kp: "Troponin is the preferred marker.", sn: [0], lv: "easy", fm: "vignette", ...o });
const ground = g(["Cardiac troponin is the most specific marker of myocardial necrosis and the preferred test.", "Myoglobin rises early but lacks cardiac specificity.", "CK-MB is less sensitive than troponin."]);

test("us folds British and American spellings; kwHit matches by 5-letter prefix", () => {
  assert.equal(us("haemoglobin oesophagus"), us("hemoglobin esophagus"));
  assert.ok(kwHit(new Set(["hyper", "ecg"].map((w) => w)), "hyperkalaemia ecg"));
  assert.ok(!kwHit(new Set(["hyper"]), "hyperkalaemia ecg"));
});

test("clusterTopics merges similar topics in a module, drops skip, keeps no question ids, drops a concept copied from the book", () => {
  const book = " " + "the quick brown fox jumps over the lazy dog every single morning" + " ";
  const tags = [
    { k: "I-1", topic: "Hyperkalaemia ECG changes", concept: "peaked T waves first", module: "med-potassium", level: "pg", kw: ["hyperkalaemia", "ecg"] },
    { k: "I-2", topic: "Hyperkalaemia ECG findings", concept: "the quick brown fox jumps over the lazy dog every", module: "med-potassium", level: "ss", kw: ["hyperkalaemia", "ecg"] },
    { k: "I-3", topic: "Ethics", concept: "x", module: "skip", level: "pg", kw: [] },
  ];
  const t = clusterTopics(tags, book);
  assert.equal(t.length, 1);
  assert.equal(t[0].n, 2);
  assert.deepEqual(t[0].concepts, ["peaked T waves first"]);
  assert.ok(!JSON.stringify(t).includes("I-1"));
  assert.match(t[0].tid, /^t-[0-9a-f]{12}$/);
});

test("coverage: the core keyword plus one more must hit; gap under 5 items, harder items needed under 2 hard ones", () => {
  const bank = [
    { mod: "med-potassium", d: 3, _s5: new Set(["hyper", "ecg", "peake"]) },
    { mod: "med-sodium", d: 1, _s5: new Set(["hyper", "ecg"]) },
    { mod: "med-potassium", d: 1, _s5: new Set(["ecg", "peake"]) },
  ];
  const c = coverageOf({ topic: "x", module: "med-potassium", kw: ["hyperkalaemia", "ecg", "peaked"] }, bank);
  assert.deepEqual(c, { all: 2, mod: 1, hard: 1 });
  assert.equal(gapOf(c), "gap");
  assert.equal(gapOf({ all: 9, hard: 1 }), "hard");
  assert.equal(gapOf({ all: 9, hard: 2 }), "");
});

test("assignLevels: harder-only topics get hard and very hard; the plan meets the target shares", () => {
  const topics = [{ gap: "hard", nSlots: 2 }, ...Array.from({ length: 10 }, () => ({ gap: "gap", nSlots: 4 }))];
  const have = assignLevels(topics);
  assert.deepEqual(topics[0].slots.map((s) => s.lv), ["hard", "vhard"]);
  assert.equal(have.easy + have.hard + have.vhard, 42);
  assert.equal(have.easy, Math.round(42 * 0.4));
  topics.forEach((t) => assert.equal(t.slots.length, t.nSlots));
});

test("gateQ passes a grounded question; rejects an invented number, a copied book phrase and a missing citation", () => {
  assert.equal(gateQ(rq(), ground, ""), null);
  assert.equal(gateQ(rq({ st: rq().st.replace("anterior leads", "anterior leads with a heart rate of 132") }), ground, ""), "number not in grounding");
  const book = " " + "a 30 year old man has crushing chest pain and st elevation in the anterior leads" + " ";
  assert.equal(gateQ(rq(), ground, book), "copies the book");
  assert.equal(gateQ(rq({ sn: [9] }), ground, ""), "no cited sentence");
  assert.equal(gateQ(rq({ kp: "Troponin — the preferred marker." }), ground, ""), "banned word or dash");
});

test("numbersOk ignores the patient's age only", () => {
  assert.ok(numbersOk("A 45-year-old woman", "no numbers"));
  assert.ok(!numbersOk("A 45-year-old woman with potassium 7.2", "no numbers"));
  assert.ok(numbersOk("potassium 7.2", "potassium above 7.2 is dangerous"));
});

test("format shapes: statements, matching and assertion-reason", () => {
  assert.ok(fmtOk({ fm: "tf", st: "Statements:\n1. a\n2. b\n3. c\nWhich are correct?", key: { ot: "1 and 2 only" }, dis: [{ ot: "1 only" }, { ot: "2 and 3" }, { ot: "All" }] }));
  assert.ok(!fmtOk({ fm: "tf", st: "Which is correct?", key: { ot: "x" }, dis: [{ ot: "y" }, { ot: "z" }, { ot: "w" }] }));
  const m = { fm: "match", st: "Match:\na. X\nb. Y\nc. Z\nd. W\n1. p\n2. q\n3. r\n4. s", key: { ot: "a-2, b-1, c-4, d-3" }, dis: [{ ot: "a-1, b-2, c-3, d-4" }, { ot: "a-3, b-4, c-1, d-2" }, { ot: "a-4, b-3, c-2, d-1" }] };
  assert.ok(fmtOk(m));
  assert.ok(!fmtOk({ ...m, key: { ot: "X with p" } }));
});

test("reasoningOrder puts the four assertion-reason options in the standard order and finds the key", () => {
  const r = { key: { ot: "A is true, but R is false", wr: "k" }, dis: [
    { ot: "A is false, but R is true", wr: "d1" }, { ot: "Both A and R are true, and R explains A", wr: "d2" }, { ot: "Both A and R are true, but R does not explain A", wr: "d3" }] };
  const sh = reasoningOrder(r);
  assert.equal(sh.a, 2);
  assert.match(sh.o[0], /explains A/);
  assert.match(sh.o[1], /does not explain/);
  assert.equal(sh.r[2], "k");
  assert.equal(reasoningOrder({ key: { ot: "Something else", wr: "" }, dis: r.dis }), null);
});

test("sanitizeQ keeps line breaks in the stem and our fields", () => {
  const out = sanitizeQ({ q: [{ ...rq({ st: "Statements:\n1. a\n2. b\n3. c" }), lv: "vhard", fm: "tf", sn: [0, 1] }] });
  assert.equal(out.length, 1);
  assert.match(out[0].st, /\n1\. a/);
  assert.equal(out[0].lv, "vhard");
  assert.deepEqual(out[0].sn, [0, 1]);
});

test("finalItem: bank shape, set medcov, very hard flagged vh with d 3, no source label", () => {
  const it = { id: "mc-abc", q: "Q", o: ["a", "b", "c", "d"], a: 1, t: "med-acs", d: 3, lv: "vhard", fm: "vignette" };
  const x = { key: "b because", notes: "## N\n- n", others: { A: "no a", C: "no c", D: "no d" }, pearl: "p" };
  const f = finalItem(it, x);
  assert.equal(f.set, SET);
  assert.equal(f.d, 3);
  assert.equal(f.vh, true);
  assert.deepEqual(f.r, ["no a", "b because", "no c", "no d"]);
  assert.equal(f.exp, "b because");
  assert.ok(!("src" in f) && !("tid" in f));
  assert.equal(finalItem({ ...it, lv: "hard" }, x).vh, undefined);
});

test("sanitizeQ builds a match stem from the two columns and puts one-line statements on their own lines", () => {
  const m = sanitizeQ({ q: [{ ...rq(), fm: "match", st: "Match the drugs with their effects.", ci: ["W", "X", "Y", "Z"], cii: ["p", "q", "r", "s"], key: { ot: "a-2, b-1, c-4, d-3", wr: "k" } }] })[0];
  assert.match(m.st, /\nColumn I\na\. W\nb\. X\nc\. Y\nd\. Z\nColumn II\n1\. p\n2\. q\n3\. r\n4\. s$/);
  const t = sanitizeQ({ q: [{ ...rq(), fm: "tf", st: "1. Alpha is true. 2. Beta is false. 3. Gamma holds. Which of the above are correct?" }] })[0];
  assert.equal(t.st, "1. Alpha is true.\n2. Beta is false.\n3. Gamma holds.\nWhich of the above are correct?");
  assert.ok(!fmtOk({ fm: "match", st: m.st, key: { ot: "a-1, b-2, c-3, d-4" }, dis: [{ ot: "a-2, b-1, c-4, d-3" }, { ot: "a-3, b-4, c-1, d-2" }, { ot: "a-4, b-3, c-2, d-1" }] }), "the identity matching is never the key");
});

test("tidy: key opener cut only when the line still names the answer; keys, options and stems untouched", () => {
  const it = { o: ["Cardiac troponin", "Myoglobin", "LDH", "CK-MB"], a: 0 };
  assert.equal(keyOpener("Cardiac troponin is the correct answer because it is the most specific marker.", it), "Cardiac troponin: It is the most specific marker.");
  assert.equal(keyOpener("Cardiac troponin is the correct marker as it rises in necrosis only.", it), "Cardiac troponin: It rises in necrosis only.");
  assert.equal(keyOpener("The correct answer is cardiac troponin because it is specific to the heart.", it), "Cardiac troponin: It is specific to the heart.");
  assert.equal(keyOpener("A is correct because it is specific to the heart.", it), "A (Cardiac troponin): It is specific to the heart.", "a bare letter gets the option text");
  assert.equal(keyOpener("C is correct because it is specific to the heart.", it), "C is correct because it is specific to the heart.", "a wrong letter: kept");
  assert.equal(keyOpener("Troponin rises within hours of necrosis.", it), "Troponin rises within hours of necrosis.");
  assert.equal(OUT_SET, "medcov3", "a changed release goes to a new immutable folder");
});

test("tidy: applyDrops removes whole lines only, trailing lines only, headings and empty tables follow, refuses big cuts", () => {
  const filler = Array.from({ length: 6 }, (_, k) => "- Point " + k + " about the tested condition and how it is diagnosed and treated well.").join("\n");
  const notes = "## Topic\n" + filler + "\n- Off topic line about another disease entirely here.\n\n| A | B |\n| --- | --- |\n| x | y |\n\n1. First step.\n2. Second step.\n3. Third step.\n\n## Other\n- Unrelated bullet.";
  const L = noteLines(notes);
  const ix = (re) => L.findIndex((l) => re.test(l.t));
  assert.equal(L[0].kind, "h"); assert.equal(L[ix(/^\| A/)].kind, "th"); assert.equal(L[ix(/^\| ---/)].kind, "ts"); assert.equal(L[ix(/^\| x/)].kind, "tr");
  const out = applyDrops(notes, [ix(/Off topic/), ix(/^\| x/), ix(/^3\./), ix(/Unrelated/), 0]);
  assert.ok(out, "gates pass");
  assert.doesNotMatch(out, /Off topic|Unrelated|## Other/, "dropped lines and the empty heading go");
  assert.match(out, /\| x \| y \|/, "a table keeps its last row");
  assert.match(out, /^## Topic/, "a heading is never dropped on its own");
  assert.match(out, /1\. First step\.\n2\. Second step\.$/m, "the last step goes"); assert.doesNotMatch(out, /Third/);
  for (const l of out.split("\n")) assert.ok(notes.split("\n").includes(l), "no new text: " + l);
  assert.equal(applyDrops(notes, []), null);
  assert.equal(applyDrops(notes, [ix(/Point 2/)]), null, "a line in the middle of its block stays");
  assert.doesNotMatch(applyDrops(notes, [ix(/Point 2/), ix(/Off topic/)]), /Off topic/, "the trailing line goes");
  assert.match(applyDrops(notes, [ix(/Point 2/), ix(/Off topic/)]), /Point 2/, "the middle one stays");
  assert.equal(applyDrops(notes, [1, 2, 3, 4, 5]), null, "more than 45% of the words: refused");
});

test("tidy: tidyItem follows the key line into exp and the right option's reason; readTidy and the prompt", () => {
  const it = { id: "mc-1", q: "Q?", o: ["Cardiac troponin", "Myoglobin", "LDH", "CK-MB"], a: 0, exp: "Cardiac troponin is correct because it is specific.", r: ["Cardiac troponin is correct because it is specific.", "no", "no", "no"],
    x: { key: "Cardiac troponin is correct because it is specific.", notes: "## N\n- n", others: { B: "no", C: "no", D: "no" }, pearl: "p" } };
  const t = tidyItem(it, null);
  assert.equal(t.x.key, "Cardiac troponin: It is specific."); assert.equal(t.exp, t.x.key); assert.equal(t.r[0], t.x.key);
  assert.deepEqual([t.q, t.o, t.a, t.r.slice(1)], [it.q, it.o, it.a, it.r.slice(1)]);
  assert.equal(it.x.key, "Cardiac troponin is correct because it is specific.", "input untouched");
  assert.deepEqual(readTidy('{"r":[{"i":1,"drop":[3,4]},{"i":9,"drop":[1]}]}', 2), [null, { drop: [3, 4] }]);
  const p = tidyPrompt([it]);
  assert.match(p.user, /\(0, keep\) ## N/); assert.match(p.user, /\[1\] - n/);
});

test("loose combo key line: letter with the right ka, statement set, matching pairs or the A/R verdict; never for single answers", () => {
  const m = { fm: "match", o: ["a-1, b-2, c-3, d-4", "a-2, b-1, c-4, d-3", "a-3, b-4, c-1, d-2", "a-4, b-3, c-2, d-1"], a: 1 };
  assert.ok(comboKeyAgrees("B is correct because the drugs match their effects.", m, "B"));
  assert.ok(comboKeyAgrees("Option B matches each drug to its effect.", m, "B"));
  assert.ok(!comboKeyAgrees("B is correct because the drugs match.", m, "C"), "ka must agree");
  assert.ok(!comboKeyAgrees("C is correct because the drugs match.", m, "C"), "the wrong letter");
  assert.ok(comboKeyAgrees("The right pairs are d-3, a-2, c-4 and b-1.", m, ""));
  assert.ok(!comboKeyAgrees("The right pairs are a-2, b-1, c-3, d-4.", m, ""));
  const t = { fm: "tf", o: ["1 and 2 only", "1 and 3 only", "2 and 3 only", "1, 2 and 3"], a: 1 };
  assert.ok(comboKeyAgrees("Statements 3 and 1 are correct since both hold.", t, ""));
  assert.ok(!comboKeyAgrees("Statements 1 and 2 are correct since both hold.", t, ""));
  const r = { fm: "reasoning", o: ["Both A and R are true, and R explains A", "Both A and R are true, but R does not explain A", "A is true, but R is false", "A is false, but R is true"], a: 2 };
  assert.ok(comboKeyAgrees("The assertion is true here but the reason is wrong: A is true and R is false.", r, ""));
  assert.ok(!comboKeyAgrees("Both A and R are true and R explains A.", r, ""));
  assert.ok(!comboKeyAgrees("B is correct.", { o: ["x", "y", "z", "w"], a: 1 }, "B"), "single-answer formats stay strict");
  assert.equal(keyOpener("B is the correct match because each drug fits its effect.", m), "B (a-2, b-1, c-4, d-3): Each drug fits its effect.");
});
