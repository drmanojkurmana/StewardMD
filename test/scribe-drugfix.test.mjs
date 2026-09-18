import { test } from "node:test"; import assert from "node:assert/strict";
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const F = require("../scribe-drugfix.js");

// Shaped exactly like window.MEDDRUGS._list entries (drugs.js).
const DRUGS = [
  { cat: "Gastrointestinal", generic: "Pantoprazole", cls: "PPI", brands: ["pan", "pantop", "pantocid", "ppi"], dose: "40 mg" },
  { cat: "Gastrointestinal", generic: "Omeprazole", cls: "PPI", brands: ["omez", "omecip", "ppi"], dose: "20 mg" },
  { cat: "Cardiac", generic: "Atorvastatin", cls: "Statin", brands: ["atorva", "lipitor", "statin"], dose: "20 mg" },
  { cat: "Antibiotic", generic: "Amoxiclav", cls: "Beta-lactam", brands: ["augmentin", "advent"], dose: "625 mg" },
  { cat: "Analgesia", generic: "Tranexamic acid", cls: "Antifibrinolytic", brands: ["txa", "trapic"], dose: "1 g" }
];
const O = { drugs: DRUGS };

test("brand -> generic, reported, numbers untouched", () => {
  const r = F.correct("tab pan 40 one before food", O);
  assert.equal(r.text, "tab Pantoprazole 40 one before food");
  assert.equal(r.corrections.length, 1);
  assert.deepEqual(r.corrections[0], { from: "pan", to: "Pantoprazole", confidence: 1, index: 4 });
});

test("phonetic near-miss corrected via the shared DrugFuzzy matcher", () => {
  const r = F.correct("atorvastain 20 mg at night", O);
  assert.equal(r.text, "Atorvastatin 20 mg at night");
  assert.equal(r.corrections[0].from, "atorvastain");
  assert.ok(r.corrections[0].confidence > 0.8 && r.corrections[0].confidence < 1,
    "a fuzzy hit must report below-certain confidence, got " + r.corrections[0].confidence);
});

test("two-word mishearing folded into one name", () => {
  const r = F.correct("amoxy clav 625 BD for 5 days", O);
  assert.equal(r.text, "Amoxiclav 625 BD for 5 days");
  assert.equal(r.corrections[0].from, "amoxy clav");
});

test("SAFETY: a class alias claimed by two generics is left alone", () => {
  const r = F.correct("start ppi today", O);
  assert.equal(r.text, "start ppi today");
  assert.deepEqual(r.corrections, []);
});

test("SAFETY: a name equidistant from two real drugs is left alone", () => {
  // "nidipine" is 2 edits from BOTH nifedipine and nimodipine. A tie must change nothing.
  const drugs = DRUGS.concat([
    { generic: "Nifedipine", brands: [], dose: "" },
    { generic: "Nimodipine", brands: [], dose: "" }
  ]);
  const r = F.correct("tab nidipine 10 BD", { drugs });
  assert.equal(r.text, "tab nidipine 10 BD");
  assert.deepEqual(r.corrections, []);
});

test("SAFETY: a neighbouring word is never swallowed into a drug name", () => {
  const r = F.correct("give omeprazol at night", O);
  assert.equal(r.text, "give Omeprazole at night");
  assert.equal(r.corrections.length, 1);
});

test("SAFETY: ordinary prose is never bent into a drug", () => {
  const r = F.correct("patient reviewed in clinic and reassured", O);
  assert.deepEqual(r.corrections, []);
});

test("SAFETY: numbers, units and strengths are never rewritten", () => {
  const r = F.correct("pan 40 mg, txa 1 g IV, 5 ml syrup", O);
  assert.ok(/40 mg/.test(r.text) && /1 g/.test(r.text) && /5 ml/.test(r.text), r.text);
  assert.ok(r.corrections.every((c) => !/\d/.test(c.from)), "no correction may contain a digit");
});

test("a name already canonical produces no correction noise", () => {
  const r = F.correct("Pantoprazole 40 OD", O);
  assert.equal(r.text, "Pantoprazole 40 OD");
  assert.deepEqual(r.corrections, []);
});

test("multi-word generic reached through its brand", () => {
  assert.equal(F.correct("inj trapic 1 g", O).text, "inj Tranexamic acid 1 g");
});

test("empty input and a missing drug list degrade quietly", () => {
  assert.deepEqual(F.correct("", O), { text: "", corrections: [] });
  assert.deepEqual(F.correct(null, O), { text: "", corrections: [] });
  assert.deepEqual(F.correct("tab pan 40", {}), { text: "tab pan 40", corrections: [] });
  assert.deepEqual(F.correct("tab pan 40"), { text: "tab pan 40", corrections: [] });
});

test("no fuzzy engine injected: exact aliases still work, near-misses do not", () => {
  const noFuzzy = { drugs: DRUGS, fuzzy: {} };
  assert.equal(F.correct("tab pan 40", noFuzzy).text, "tab Pantoprazole 40");
  assert.equal(F.correct("atorvastain 20", noFuzzy).text, "atorvastain 20");
});

test("several corrections in one transcript, each with its own index into the input", () => {
  const src = "tab pan 40 OD and tab atorva 20 HS";
  const r = F.correct(src, O);
  assert.equal(r.corrections.length, 2);
  assert.deepEqual(r.corrections.map((c) => c.to), ["Pantoprazole", "Atorvastatin"]);
  r.corrections.forEach((c) => assert.equal(src.slice(c.index, c.index + c.from.length), c.from));
});
