// drug-link.js detection (pure part) + drug-lexicon.js generation rules.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = new Map();
global.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) } };
require("../drug-lexicon.js");
require("../kb/ai/drug-fuzzy.js");
const D = require("../drug-link.js");
const L = window.SMD_DRUG_LEXICON;
const names = (q, o) => D.drugsIn(q, o).map((d) => d.generic);

test("lexicon: common drugs present, lab analytes and allergen extracts absent", () => {
  const G = new Set(L.generics);
  for (const n of ["paracetamol", "amoxicillin", "aspirin", "warfarin", "ceftriaxone", "insulin", "insulin glargine", "metformin",
    "linezolid", "digoxin", "morphine", "clopidogrel", "prednisolone", "heparin", "vancomycin", "clavulanate"]) assert.ok(G.has(n), n);
  for (const n of ["potassium", "sodium", "glucose", "iron", "water", "oxygen", "nickel"]) assert.ok(!G.has(n), n);
  assert.ok(!L.generics.some((g) => /pollen|allergenic|extract/.test(g)));
  assert.equal(L.brands.acetaminophen, "paracetamol");
});

test("THE OWNER'S CASE: 'dose of paracetomol' finds paracetamol (misspelt), marked fuzzy", () => {
  const d = D.drugsIn("dose of paracetomol", { fuzzy: true });
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].generic, d[0].name, d[0].typed, d[0].fuzzy], ["paracetamol", "Paracetamol", "paracetomol", true]);
  assert.deepEqual(names("dose of paracetomol"), [], "fuzzy is opt-in: never on highlighted answer text");
});

test("exact, brand, multi-word and hyphenated combinations", () => {
  assert.deepEqual(names("Dose of Paracetamol?"), ["paracetamol"]);
  assert.deepEqual(names("Crocin 650 mg SOS"), ["paracetamol"], "brand maps to its generic");
  assert.deepEqual(names("start insulin glargine 10 units and metformin 500 mg bd"), ["insulin glargine", "metformin"]);
  assert.deepEqual(names("amoxicillin-clavulanate 625 mg"), ["amoxicillin", "clavulanate"]);
  assert.deepEqual(names("Ceftriaxone 2 g IV plus azithromycin"), ["ceftriaxone", "azithromycin"]);
});

test("no false drugs in lab values, symptoms or plain questions", () => {
  for (const q of ["potassium 3.2, sodium 138, glucose 90", "patients with fever and cough", "how to treat DKA",
    "signs of meningitis", "CURB-65 score", "chest pain with ST elevation"]) assert.deepEqual(names(q, { fuzzy: true }), [], q);
});

test("offsets point at the original text; learn() adds tagger names", () => {
  const s = "Give WARFARIN 5 mg";
  const h = D.find(s)[0];
  assert.equal(s.slice(h.start, h.end), "WARFARIN");
  assert.deepEqual(names("start zyxoprel 5 mg"), []);
  D.learn(["zyxoprel"]);
  assert.deepEqual(names("start zyxoprel 5 mg"), ["zyxoprel"]);
});

test("flags: smd_druglink=0 turns it off; smd_druglink_ask=0 keeps highlighting but skips the prompt", () => {
  assert.equal(D.enabled(), true); assert.equal(D.askEnabled(), true);
  store.set("smd_druglink_ask", "0"); assert.equal(D.enabled(), true); assert.equal(D.askEnabled(), false);
  store.set("smd_druglink", "0"); assert.equal(D.enabled(), false); assert.equal(D.askEnabled(), false);
  store.clear();
});
