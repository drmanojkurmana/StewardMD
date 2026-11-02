// Knowledge Library reader shows proper medical symbols (reasoning.js medSym), display only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const medSym = new Function(src.slice(src.indexOf("var GREEK ="), src.indexOf("// The open article")) + "; return medSym;")();

test("medSym: comparison, Greek, subscript and ion symbols", () => {
  assert.equal(medSym("LVEF <=40% and >=50%"), "LVEF ≤40% and ≥50%");
  assert.equal(medSym("IL-1 beta, IL-1beta, TNF-alpha"), "IL-1β, IL-1β, TNF-α");
  assert.equal(medSym("beta-blockers, beta2 agonists"), "β-blockers, β2 agonists");
  assert.equal(medSym("VO2max, PaCO2, SpO2."), "VO₂max, PaCO₂, SpO₂.");
  assert.equal(medSym("HCO3- and Ca2+"), "HCO₃⁻ and Ca²⁺");
});
test("medSym: leaves look-alikes alone", () => {
  for (const s of ["H2 blockers", "COVID2", "Beta thalassaemia trait at sentence start", "p53 and 2.5 mg"]) assert.equal(medSym(s), s);
});
