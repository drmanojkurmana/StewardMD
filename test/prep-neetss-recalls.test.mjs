import test from "node:test";
import assert from "node:assert/strict";
import { parsePdf, build, toItem, SET, MODULE } from "../tools/prep-neetss-recalls.mjs";

/* Synthetic text in the pdftotext -layout shape of the recall PDF (made-up questions, no real recall text). */
const TXT = [
  "   PART I - MEDICAL ONCOLOGY",
  "   Q1. Made-up drug target [HIGH CONFIDENCE]",
  "   Which made-up drug blocks the made-up receptor in a made-up tumour?",
  "    A. Alphaxib",
  "    B. Betamab",
  "    C. Gammatinib",
  "    D. Deltavir",
  "",
  "   B. Betamab.",
  "",
  "   Explanation: Betamab blocks the made-up receptor.",
  "   Evidence refs: [S1]",
  "   Q2. Made-up stage question [RECONSTRUCTED / AMBIGUOUS]",
  "   A made-up patient has a made-up stage. What is next?",
  "    A. One",
  "    B. Two",
  "    C. Three",
  "    D. Four",
  "",
  "   D is the most likely answer here, but the original wording is lost.",
  "   Recall caveat: Wording was not kept",
  "   in full.",
  "   PART II - GENERAL MEDICINE",
].join("\n");
const J = {
  format: "stewardmd-mcq-v1",
  questions: [
    { q: "Which made-up drug blocks the made-up receptor in a made-up tumour?", options: ["Alphaxib", "Betamab", "Gammatinib", "Deltavir"], answer: "B", explanation: "Betamab blocks the made-up receptor.", why_wrong: ["x is not the best answer because it does not match the defining feature", "", "", ""], key_point: "Betamab blocks the made-up receptor.", difficulty: 1 },
    { q: "A made-up patient has a made-up stage — what is next?", options: ["One", "Two", "Three", "Four"], answer: "D", explanation: "Four is next.", why_wrong: ["", "", "", ""], difficulty: 3 },
  ],
};

test("parsePdf reads confidence, caveat across lines, and stem", () => {
  const p = parsePdf(TXT);
  assert.equal(p[1].conf, "high");
  assert.equal(p[2].conf, "reconstructed");
  assert.equal(p[2].caveat, "Wording was not kept in full.");
  assert.match(p[1].stem, /^Which made-up drug/);
});

test("build gives overlay items: ids, set, module, no template why-wrong, caveat in exp, no em dash", () => {
  const { items, errors } = build(J, TXT);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "nssrec-01");
  assert.equal(items[0].set, SET);
  assert.equal(items[0].t, MODULE);
  assert.equal(items[0].a, 1);
  assert.equal(items[0].r, undefined);
  assert.equal(items[0].kp, undefined, "a key point that repeats the explanation is dropped");
  assert.match(items[1].exp, /Recall note: Wording was not kept in full\.$/);
  assert.match(items[1].source, /reconstructed, wording uncertain/);
  assert.ok(!/—/.test(items[1].q));
});

test("build fails on an answer that disagrees with the PDF, a missing PDF record and a bad option count", () => {
  const bad = JSON.parse(JSON.stringify(J));
  bad.questions[0].answer = "A";
  assert.ok(build(bad, TXT).errors.some((e) => /PDF banner says B/.test(e)));
  const extra = JSON.parse(JSON.stringify(J));
  extra.questions.push(extra.questions[0]);
  assert.ok(build(extra, TXT).errors.some((e) => /Q3: not found in the PDF/.test(e)));
  assert.equal(toItem({ q: "x?", options: ["a", "b", "c"], answer: "A", explanation: "e" }, 9, null, []), null);
});
