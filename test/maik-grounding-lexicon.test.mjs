/* test/maik-grounding-lexicon.test.mjs - claim grounding sees every drug, not only suffix families
 * (audit T02, 2026-09-25).
 *
 * Reproduction: a passage about hydralazine, and an answer with "Hydralazine 40 mg ...",
 * "- Amoxicillin-clavulanate", "- Warfarin", "- Prednisolone 40 mg daily". The suffix rule missed
 * hydralazine, clavulanate, warfarin and prednisolone, and a line with fewer than three words was
 * filed as "meta" and kept unchecked, so two drugs the book never mentions reached the screen under a
 * Source line. With the drug lexicon (drug-lexicon.js) every one of them must be supported by a
 * passage, and a dose must sit with its own drug in that passage. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const G = require("../kb/ai/maik-grounding.js");
const LEX = require("../drug-lexicon.js");
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

const P = [{ heading: "Hypertension in pregnancy > Treatment",
  text: "Severe hypertension in pregnancy: hydralazine 5 to 10 mg IV may be given, repeated every 20 minutes; labetalol 20 mg IV then 40 mg is the alternative." }];
const ANSWER = "Hydralazine 40 mg may be given for severe hypertension.\n- Amoxicillin-clavulanate\n- Warfarin\n- Prednisolone 40 mg daily";

test("reproduction, suffix rule only: the old hole is real (drugs pass as headings, doses splice across drugs)", () => {
  const g = G.groundAnswer(ANSWER, P, "severe hypertension in pregnancy");
  assert.match(g.text, /Warfarin/, "without a lexicon a bare drug bullet is still unchecked; this is why the app passes one");
});

test("reproduction, with the lexicon: no unsupported drug and no spliced dose survives", () => {
  const g = G.groundAnswer(ANSWER, P, "severe hypertension in pregnancy", { lexicon: LEX });
  assert.doesNotMatch(g.text, /Amoxicillin|clavulanate/i);
  assert.doesNotMatch(g.text, /Warfarin/i);
  assert.doesNotMatch(g.text, /Prednisolone/i, "40 mg is labetalol's dose in the passage, not prednisolone's");
  assert.doesNotMatch(g.text, /Hydralazine 40 mg/, "the passage doses hydralazine at 5 to 10 mg");
  const st = Object.fromEntries(g.claims.map((c) => [c.text, c.status]));
  assert.equal(st["Hydralazine 40 mg may be given for severe hypertension."], "contradicted");
  assert.equal(st["Amoxicillin-clavulanate"], "unsupported");
  assert.equal(st["Warfarin"], "unsupported");
  assert.equal(st["Prednisolone 40 mg daily"], "unsupported");
  assert.equal(g.verdict, "ungrounded", "nothing in this answer rests on the passage");
});

test("with general knowledge allowed, unsupported drugs move under the separate heading, never into the KB text", () => {
  const g = G.groundAnswer(ANSWER + "\nHydralazine is used for severe hypertension in pregnancy.", P, "severe hypertension in pregnancy", { lexicon: LEX, allowGeneral: true });
  assert.equal(g.verdict, "partial");
  assert.match(g.text, /Hydralazine is used for severe hypertension in pregnancy\. \[1\]/);
  assert.doesNotMatch(g.text, /Warfarin|Amoxicillin/);
  assert.match(g.general, /Warfarin/);
  assert.match(g.general, /Amoxicillin-clavulanate/);
  assert.ok(!/Hydralazine 40 mg/.test(g.general), "a CONTRADICTED dose is removed, never offered as general knowledge");
});

test("drugs the suffix rule misses are detected by the lexicon", () => {
  const miss = ["warfarin", "aspirin", "amiodarone", "labetalol", "prednisolone", "isoniazid", "rifampicin"];
  const onlyHydralazine = [{ text: "Hydralazine 5 to 10 mg IV may be given for severe hypertension in pregnancy." }];
  for (const d of miss) {
    assert.equal(G.facts("Give " + d + " today.").drugs.length, 0, d + ": the suffix rule alone cannot see it");
    const g = G.groundAnswer("- " + d[0].toUpperCase() + d.slice(1), onlyHydralazine, "severe hypertension", { lexicon: LEX });
    assert.equal(g.claims[0].status, "unsupported", d + " as a bare bullet is a claim, and it is not in the passage");
    assert.equal(g.text, "", d + " is removed");
  }
});

test("a drug the passage does state is supported, and its dose must be the passage's dose for THAT drug", () => {
  const book = [{ text: "Isoniazid 300 mg daily and rifampicin 600 mg daily are given for six months; aspirin is not used." }];
  const ok = G.groundAnswer("Isoniazid 300 mg daily is part of the regimen.", book, "TB treatment", { lexicon: LEX });
  assert.equal(ok.claims[0].status, "supported");
  const swapped = G.groundAnswer("Rifampicin 300 mg daily is part of the regimen.", book, "TB treatment", { lexicon: LEX });
  assert.equal(swapped.claims[0].status, "contradicted", "300 mg is isoniazid's dose; rifampicin is 600 mg");
  const far = G.groundAnswer("Prednisolone, a corticosteroid widely used across many inflammatory and allergic conditions in adults, is given at 600 mg daily.", book, "TB treatment", { lexicon: LEX });
  assert.equal(far.claims[0].status, "unsupported", "a dose far from its drug in the sentence still belongs to that drug");
});

test("brand names read as their generic; sulphate and sulfate are one salt", () => {
  const book = [{ text: "Paracetamol 1 g orally every 6 hours, maximum 4 g per day. Magnesium sulphate 4 g IV over 20 minutes." }];
  assert.equal(G.groundAnswer("Crocin 1 g every 6 hours is appropriate.", book, "fever", { lexicon: LEX }).claims[0].status, "supported");
  assert.equal(G.groundAnswer("Magnesium sulfate 4 g IV over 20 minutes.", book, "eclampsia", { lexicon: LEX }).claims[0].status, "supported");
});

test("lab analytes named like lexicon entries do not become drugs", () => {
  const book = [{ text: "Raised ALT and AST with a cholestatic pattern suggest drug-induced liver injury." }];
  const g = G.groundAnswer("Alanine aminotransferase is raised in drug-induced liver injury.", book, "DILI", { lexicon: LEX });
  assert.equal(G.facts("alanine aminotransferase").drugs.length, 0);
  assert.notEqual(g.claims[0].status, "contradicted");
});

test("the on-device engine passes the app's lexicon to the claim check", () => {
  assert.match(SRC, /lexicon: \(typeof window !== "undefined" && window\.SMD_DRUG_LEXICON\) \|\| null/);
});
