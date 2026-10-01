// MaiK drug detector: real-transcript false positives must stay out; true positives must stay in.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
global.window = { localStorage: { getItem: () => null } };
require("../drug-lexicon.js");
require("../kb/ai/drug-fuzzy.js");
const D = require("../drug-link.js");
const F = { fuzzy: true };
const names = (q, o) => D.drugsIn(q, o).map((d) => d.generic);

test("transcript: 'protocol' is not propofol, 'location' is not cation", () => {
  assert.deepEqual(names("What is does of TCHP REGIMEN protocol", F), []);
  assert.deepEqual(names("BRCA 1 gene location on chromosome", F), []);
  for (const w of ["position", "condition", "solution", "station", "motion", "potion"]) assert.deepEqual(names("the " + w + " of it", F), [], w);
});

test("transcript: 'Zolendronic or Denosumab' finds zoledronic acid (fuzzy) and denosumab (exact)", () => {
  const d = D.drugsIn("When yo give Zolendronic or Denosumab", F);
  assert.deepEqual(d.map((x) => [x.generic, x.fuzzy]), [["zoledronic acid", true], ["denosumab", false]]);
});

test("first word of a multi-word generic is exact; shared chemistry words are not indexed", () => {
  const d = D.drugsIn("dose of zoledronic");
  assert.deepEqual(d.map((x) => [x.generic, x.fuzzy]), [["zoledronic acid", false]]);
  assert.deepEqual(names("zoledronic acid 4 mg"), ["zoledronic acid"]);
  assert.deepEqual(names("anhydrous and colloidal and methylene", F), []);
});

test("true positives survive: exact, brand, 1-edit misspelling, 2 edits on 10+ letters", () => {
  assert.deepEqual(names("dose of paracetamol"), ["paracetamol"]);
  assert.deepEqual(names("Crocin 650 mg SOS"), ["paracetamol"]);
  const p = D.drugsIn("dose of paracetomol", F);
  assert.deepEqual([p[0].generic, p[0].fuzzy], ["paracetamol", true]);
  assert.deepEqual(names("start atorvastain 40", F), ["atorvastatin"]);
  assert.deepEqual(names("give clarithomycin", F), ["clarithromycin"]);
});
