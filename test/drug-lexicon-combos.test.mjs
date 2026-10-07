// Combination brands keep EVERY ingredient (drug-lexicon.js `combos`, read by drug-link.js and
// maik-grounding.js). The source data (data/interaction-rules.json) maps each of these to ONE
// ingredient: Combiflam -> ibuprofen hid the paracetamol (double-dose risk with Crocin/Calpol), and
// Entresto -> valsartan opened the wrong monograph.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
global.window = { localStorage: { getItem: () => null } };
// The Drug Index lists combiflam under Ibuprofen; the lexicon's combination must win over it.
window.MEDDRUGS = { _list: [{ generic: "Ibuprofen", brands: ["brufen", "combiflam"] }, { generic: "Tramadol", brands: ["ultracet"] }] };
require("../drug-lexicon.js");
require("../kb/ai/drug-fuzzy.js");
const D = require("../drug-link.js");
const G = require("../kb/ai/maik-grounding.js");
const L = window.SMD_DRUG_LEXICON;

/* Clinician-confirmed by the owner, 2026-10-02. Reference: api.stewardmd.in/brand-search
 * compositions (Zituvimet is not in it; owner confirmed from practice) and drugs.js for Entresto.
 * Ingredients are sorted: that is how the Drug Index names the composition ("Ibuprofen + Paracetamol").
 * Changing this list is a clinical change: it needs the owner's sign-off again. */
const CONFIRMED = {
  combiflam: ["ibuprofen", "paracetamol"],
  deriphyllin: ["etofylline", "theophylline"],
  dynapar: ["diclofenac", "paracetamol"],
  entresto: ["sacubitril", "valsartan"],
  "pan-d": ["domperidone", "pantoprazole"],
  ultracet: ["paracetamol", "tramadol"],
  zituvimet: ["metformin", "sitagliptin"],
};

test("the lexicon's combination list is exactly the clinician-confirmed one", () => {
  assert.deepEqual(L.combos, CONFIRMED);
});

test("no combination brand maps to a single ingredient", () => {
  for (const b of Object.keys(CONFIRMED)) assert.ok(!(b in L.brands), b + " is still in brands");
  assert.equal(L.brands.crocin, "paracetamol", "single-ingredient brands are unchanged");
  assert.equal(L.brands.inspra, "eplerenone", "owner: Inspra stays eplerenone");
});

test("drug-link: a combination brand links its composition, with every ingredient", () => {
  for (const [brand, parts] of Object.entries(CONFIRMED)) {
    const d = D.drugsIn("start " + brand + " 1 tab bd");
    assert.equal(d.length, 1, brand);
    assert.equal(d[0].generic, parts.join(" + "), brand);
    assert.deepEqual(d[0].generics, parts, brand);
  }
  assert.equal(D.drugsIn("Entresto 24/26 mg BD")[0].name, "Sacubitril + Valsartan");
  assert.equal(D.drugsIn("Pan D before breakfast")[0].generic, "domperidone + pantoprazole");
  assert.deepEqual(D.drugsIn("combiflem SOS", { fuzzy: true })[0].generics, ["ibuprofen", "paracetamol"], "fuzzy keeps the ingredients");
  assert.deepEqual(D.drugsIn("Crocin 650")[0].generics, ["paracetamol"]);
});

test("grounding: a combination dose is not supported by the single ingredient's passage", () => {
  const book = [{ text: "Ibuprofen 400 mg orally every 8 hours with food." }];
  const g = G.groundAnswer("Combiflam 400 mg every 8 hours.", book, "pain", { lexicon: L });
  assert.equal(g.claims[0].status, "unsupported");
  assert.ok(g.claims[0].why.some((w) => /ibuprofen \+ paracetamol/.test(w)), "the reason names the combination");
  assert.equal(G.groundAnswer("Brufen 400 mg every 8 hours.", book, "pain", { lexicon: L }).claims[0].status, "supported");
  // R2: a name whose first word is under 4 letters ("Pan-D") is still read, so one ingredient cannot ground it.
  const dom = [{ text: "Domperidone 10 mg three times daily before meals." }];
  assert.equal(G.groundAnswer("Pan-D 10 mg three times daily before meals.", dom, "dyspepsia", { lexicon: L }).claims[0].status, "unsupported");
  assert.equal(G.groundAnswer("Pan D 10 mg three times daily before meals.", dom, "dyspepsia", { lexicon: L }).claims[0].status, "unsupported");
  // A wrong dose against a passage that names the combination is contradicted, a right one supported.
  const cf = [{ text: "Combiflam 400 mg orally every 8 hours with food." }];
  assert.equal(G.groundAnswer("Combiflam 400 mg every 8 hours.", cf, "pain", { lexicon: L }).claims[0].status, "supported");
  assert.equal(G.groundAnswer("Combiflam 800 mg every 8 hours.", cf, "pain", { lexicon: L }).claims[0].status, "contradicted");
});
