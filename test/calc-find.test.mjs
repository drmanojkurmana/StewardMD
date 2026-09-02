/* test/calc-find.test.mjs — MEDCALC.find(): a question that names a shipped calculator resolves to
 * it, and nothing else does.
 *
 * Reported 2026-09-02: "HACOR score" in MaiK cost a paid model turn and came back with a fabricated
 * formula while Calculators sat one tap away. The resolver is what lets MaiK answer with the
 * calculator itself. It must be conservative: a wrong hit sends a clinician to the wrong tool, and a
 * miss only costs the old behaviour (a model answer + the generic chip).
 *
 * Also pins the new HACOR entry: the H-A-C-O-R bands and the >5 threshold from Duan 2017.
 *
 * node --test test/calc-find.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const g = {
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, querySelector: () => null }), addEventListener() {}, body: { classList: { add() {}, remove() {} } }, head: { appendChild() {} } },
  localStorage: { getItem: () => null, setItem() {} }, location: { search: "" }, navigator: {},
};
g.window = g; g.self = g;
vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(ROOT, "calculators.js"), "utf8"), g, { filename: "calculators.js" });
const M = g.MEDCALC;
const id = (q) => { const r = M.find(q); return r ? r.id : null; };

test("find is exported and returns the public shape", () => {
  assert.equal(typeof M.find, "function");
  const r = M.find("curb 65 score");
  assert.equal(r.id, "curb65");
  assert.ok(r.title && r.cat && Array.isArray(r.inputs), "id/title/cat/inputs");
  assert.equal(typeof r.exact, "boolean");
});

test("THE REPORTED CASE: 'hacor score' resolves to the HACOR calculator", () => {
  assert.equal(id("hacor score"), "hacor");
  assert.equal(id("what is the HACOR score?"), "hacor");
  assert.equal(id("how do I calculate HACOR"), "hacor");
});

test("the ways a doctor actually types a score name", () => {
  assert.equal(id("curb-65"), "curb65", "hyphenated");
  assert.equal(id("curb65"), "curb65", "run together");
  assert.equal(id("calculate curb 65 for pneumonia"), "curb65", "with the title's parenthetical context");
  assert.equal(id("CHA2DS2-VASc score"), "chadsvasc", "subscripts typed as digits");
  assert.equal(id("chads vasc"), "chadsvasc");
  assert.equal(id("what is glasgow coma scale"), "gcs");
  assert.equal(id("gcs"), "gcs", "spoken abbreviation expands to the title's words");
  assert.equal(id("qsofa"), "qsofa");
  assert.equal(id("sofa score"), "sofa");
  assert.equal(id("child pugh"), "childpugh");
  assert.equal(id("calculate crcl"), "crcl", "CrCl -> Cockcroft-Gault");
  assert.equal(id("nihss"), "nihss");
  assert.equal(id("has-bled"), "hasbled");
  assert.equal(id("anion gap"), "anion_gap");
  assert.equal(id("bmi"), "bmi");
  assert.equal(id("apache ii"), "apache2");
});

test("a question ABOUT something else never resolves, even when it shares a word with a title", () => {
  assert.equal(id("treatment of pneumonia"), null, "'pneumonia' is in 'CURB-65 (pneumonia)' but the question is not about the score");
  assert.equal(id("sepsis"), null);
  assert.equal(id("fever and cough"), null);
  assert.equal(id("dose of amoxicillin"), null);
  assert.equal(id(""), null);
  assert.equal(id("score"), null, "a cue word alone names nothing");
  assert.equal(id("65"), null, "digits alone name nothing");
});

test("two calculators that fit equally is 'not sure', not a coin toss", () => {
  // Wells exists for PE and for DVT; "wells score" alone must not pick one.
  assert.equal(id("wells score"), null);
  assert.equal(id("wells score for pe"), "wells_pe");
  assert.equal(id("wells dvt"), "wells_dvt");
});

test("exact marks a question that is essentially just the calculator's name", () => {
  assert.equal(M.find("curb 65").exact, true);
  assert.equal(M.find("hacor").exact, true);
  assert.equal(M.find("calculate curb 65 for pneumonia").exact, false);
});

// ── HACOR itself ────────────────────────────────────────────────────────────────────────────────
test("HACOR: all-normal is 0/25, worst is 25/25, and the bands add", () => {
  assert.equal(M.run("hacor", { hr: "0", ph: "0", gcs: "0", pf: "0", rr: "0" }).value, 0);
  assert.equal(M.run("hacor", { hr: "1", ph: "4", gcs: "10", pf: "6", rr: "4" }).value, 25);
  // HR >120 (1) + pH 7.30-7.34 (2) + GCS 13-14 (2) + P/F 151-175 (3) + RR 31-35 (1)
  assert.equal(M.run("hacor", { hr: "1", ph: "2", gcs: "2", pf: "3", rr: "1" }).value, 9);
});
test("HACOR: the >5 threshold is where the interpretation flips", () => {
  const five = M.run("hacor", { hr: "1", ph: "2", gcs: "2", pf: "0", rr: "0" });
  const six = M.run("hacor", { hr: "1", ph: "2", gcs: "2", pf: "0", rr: "1" });
  assert.equal(five.value, 5); assert.match(five.interpretation, /lower risk/i);
  assert.equal(six.value, 6); assert.match(six.interpretation, /high risk/i);
  assert.match(six.interpretation, /Duan/, "carries its citation");
});
test("HACOR: the letters mean what the acronym says (the fabricated answer did not)", () => {
  const c = M.get("hacor");
  const labels = c.inputs.map((x) => x.label.toLowerCase());
  assert.ok(labels.some((l) => /heart rate/.test(l)), "H = heart rate");
  assert.ok(labels.some((l) => /ph/.test(l)), "A = acidosis");
  assert.ok(labels.some((l) => /glasgow/.test(l)), "C = consciousness");
  assert.ok(labels.some((l) => /pao/.test(l)), "O = oxygenation");
  assert.ok(labels.some((l) => /respiratory rate/.test(l)), "R = respiratory rate");
  assert.equal(c.inputs.length, 5);
});
