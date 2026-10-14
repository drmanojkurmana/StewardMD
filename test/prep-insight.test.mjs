import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const I = createRequire(import.meta.url)("../prep-insight.js");

test("aspectOf tags the question type from the stem", () => {
  const t = (q) => I.aspectOf({ q });
  assert.equal(t("A 30-year-old presents with fever. Most likely diagnosis is:"), "dx");
  assert.equal(t("Investigation of choice for renal stone is:"), "ix");
  assert.equal(t("To diagnose uterus didelphys, procedure of choice is :"), "ix");
  assert.equal(t("Treatment of choice in this case is :"), "tx");
  assert.equal(t("What is the next step in management?"), "tx");
  assert.equal(t("Mechanism of action of the drug is:"), "patho");
  assert.equal(t("Screening test of choice for ca cervix is:"), "screen");
  assert.equal(t("Nerve supply of the diaphragm is:"), "basic");
  assert.equal(t("Complication of mumps is:"), "comp");
  assert.equal(t("Zzz qqq?"), "other");
  assert.equal(I.aspectOf(null), "other");
});

test("noteAnswer keeps per-question misses, per-aspect tallies and confidence reliability", () => {
  const s = {};
  const it = { id: "q1", q: "Treatment of choice is:" };
  I.noteAnswer(s, it, false, "confident", 100, 1000);
  I.noteAnswer(s, it, false, null, 100, 2000);
  I.noteAnswer(s, it, true, "guessing", 101, 3000);
  assert.deepEqual(I.repeatsOf(s, "q1"), { wrong: 2, right: 1, lastWrong: 2000 });
  assert.deepEqual(s.ky_ty.tx, [3, 1, 1, 1]);
  assert.deepEqual(s.ky_cal[100], [1, 0]);
  assert.deepEqual(I.repeatsOf(s, "nope"), { wrong: 0, right: 0, lastWrong: 0 });
});

test("noteAnswer prunes per-question records and days", () => {
  const s = {};
  for (let i = 0; i < I.CFG.KEEP_Q + 5; i++) I.noteAnswer(s, { id: "i" + i, q: "x" }, true, null, null, i + 1);
  assert.equal(Object.keys(s.ky_q).length, I.CFG.KEEP_Q);
  assert.ok(!s.ky_q.i0 && s.ky_q["i" + (I.CFG.KEEP_Q + 4)]);
  for (let d = 0; d < I.CFG.KEEP_DAYS + 4; d++) I.noteAnswer(s, { id: "c" + d, q: "x" }, true, "confident", d, 1);
  assert.equal(Object.keys(s.ky_cal).length, I.CFG.KEEP_DAYS);
});

const mk = (q) => ({ id: q, q, o: ["a", "b", "c", "d"], a: 0, exp: "Key fact is this one. Another sentence." });
test("analyzeRun builds the grid, orders the fix list and flags repeats", () => {
  const items = [mk("Most likely diagnosis is:"), mk("Treatment of choice is:"), mk("Investigation of choice is:"), mk("Mechanism of action is:")];
  const s = {};
  I.noteAnswer(s, items[1], false, null, 1, 5); I.noteAnswer(s, items[1], false, null, 1, 6);
  const run = { items, ans: [1, 1, 0, 1], conf: ["confident", null, "guessing", "confused"] };
  const an = I.analyzeRun(run, s);
  assert.equal(an.answered, 4);
  assert.equal(an.grid.misconception, 1); assert.equal(an.grid.wrong, 1); assert.equal(an.grid.lucky, 1); assert.equal(an.grid.confused, 1);
  assert.deepEqual(an.fix.map((f) => f.oc), ["misconception", "confused", "wrong"]);
  assert.equal(an.fix[2].rep, 2);
  assert.equal(an.repeats.length, 1);
  assert.equal(an.remember.length, 1);
  assert.equal(an.remember[0].oc, "lucky");
  assert.deepEqual(an.misconceptions, [0]);
});

test("a weak type needs MIN_ASPECT answers; blanks and gone items are skipped", () => {
  const items = [mk("Treatment of choice A is:"), mk("Treatment of choice B is:"), mk("Treatment of choice C is:"), mk("Treatment of choice D is:")];
  items[3]._gone = true;
  const an2 = I.analyzeRun({ items: items.slice(0, 2), ans: [1, 1], conf: [] }, {});
  assert.equal(an2.weak.length, 0);
  const an3 = I.analyzeRun({ items, ans: [1, 1, 1, 1], conf: [] }, {});
  assert.equal(an3.answered, 3);
  assert.equal(an3.weak[0].id, "tx");
  const blank = I.analyzeRun({ items, ans: [-1, -1, -1, -1], conf: [] }, {});
  assert.equal(blank.answered, 0);
  assert.equal(I.headline(blank), "");
});

test("headline only claims what the numbers carry", () => {
  const items = [mk("Treatment of choice A is:"), mk("Treatment of choice B is:"), mk("Treatment of choice C is:")];
  const an = I.analyzeRun({ items, ans: [1, 1, 1], conf: ["confident", "confident", "confident"] }, {});
  const h = I.headline(an);
  assert.match(h, /treatment \(0 of 3\)/);
  assert.match(h, /right 0 of 3/);
  assert.match(h, /3 confident errors/);
});

test("rememberLine takes one short sentence; allTime hides thin aspects", () => {
  assert.equal(I.rememberLine({ exp: "**Key** fact is this one. Another." }, null), "Key fact is this one.");
  assert.equal(I.rememberLine({ exp: "x".repeat(400) }, null).length <= I.CFG.LINE_MAX, true);
  assert.equal(I.rememberLine({ o: ["Yes"], a: 0 }, null), "Answer: Yes");
  const s = { ky_ty: { tx: [10, 4, 2, 1], dx: [2, 2, 0, 0] } };
  const at = I.allTime(s);
  assert.equal(at.length, 1);
  assert.equal(at[0].id, "tx");
});

test("patternText is compact and carries no more than short stems", () => {
  const items = [mk("Treatment of choice is a very long stem " + "z".repeat(300))];
  const an = I.analyzeRun({ items, ans: [1], conf: ["confident"] }, {});
  const t = I.patternText(an, items, () => "Anatomy");
  assert.ok(t.length < 1500);
  assert.match(t, /confident wrong 1/);
  assert.ok(!/z{150}/.test(t));
});
