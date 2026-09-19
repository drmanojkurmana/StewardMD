/* test/drug-dose.test.mjs — the dose router answers from the drug database, never from a model.
 * Owner, 2026-09-18: "tell me dose of ondansetron … we already have the drug database it can
 * redirect … dose of parecetmal it should understand correct spelling". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../kb/ai/drug-dose.js");
const Fuzzy = require("../kb/ai/drug-fuzzy.js");

// A stand-in for the live MEDAPI: composition search, brand search, structured records.
const COMPS = ["Ondansetron", "Ondansetron (4mg)", "Paracetamol", "Paracetamol + Caffeine", "Amoxicillin", "Vancomycin"];
const STRUCT = {
  ondansetron: { found: true, data: { adult_dose: "8 mg IV/PO 30 minutes before chemotherapy, then 8 mg 8-hourly.", ped_dose: "0.15 mg/kg per dose, max 8 mg.", renal_adjust: "No adjustment; max 8 mg/day in severe hepatic impairment." } },
  paracetamol: { found: true, data: { gold: JSON.stringify({
    dosage: [{ c: "Fever / pain (adult)", r: "PO", d: "500 mg to 1 g", t: "every 4-6 h, max 4 g/day", n: "" },
             { c: "Children", r: "PO", d: "15 mg/kg per dose", t: "every 6 h", n: "Max 60 mg/kg/day" }],
    renal: "CrCl < 30 mL/min: extend the interval to 8 hours.", hepatic: "Avoid in severe hepatic impairment." }) } },
  pantoprazole: { found: true, data: { adult_dose: "40 mg PO once daily before breakfast." } }
};
const MEDAPI = {
  // Full-text PREFIX search, like the live /search: a misspelled whole word matches nothing.
  searchCompositions: async (q) => ({ results: COMPS.filter((c) => c.toLowerCase().replace(/[^a-z]/g, "").startsWith(String(q).toLowerCase().replace(/[^a-z]/g, ""))).map((c) => ({ composition: c })) }),
  searchBrands: async (q) => (/pantocid/i.test(q) ? { results: [{ brand: "Pantocid", composition: "Pantoprazole (40mg)" }] } : { results: [] }),
  structured: async (name) => STRUCT[name.toLowerCase().replace(/[^a-z]/g, "")] || { found: false }
};
const deps = { MEDAPI, DrugFuzzy: Fuzzy };

test("intent: the shapes clinicians type, and the section they asked for", () => {
  assert.deepEqual(D.intent("tell me dose of ondansetron"), { name: "ondansetron", section: "adult" });
  assert.deepEqual(D.intent("What is the paediatric dose of paracetamol?"), { name: "paracetamol", section: "ped" });
  assert.deepEqual(D.intent("vancomycin dosing in renal failure"), { name: "vancomycin", section: "renal" });
  assert.equal(D.intent("dose of paracetamol in pregnancy").section, "pregnancy");
  assert.deepEqual(D.intent("how much paracetamol can I give"), { name: "paracetamol", section: "adult" });
});

test("OWNER TRANSCRIPT 2026-09-19: the home.js follow-up rewrite, abbreviations, and leading request words", () => {
  // "Ondansetron dose" mid-conversation arrives rewritten; the frame's "renal-adjustment principles"
  // must not turn an adult-dose ask into the renal section.
  assert.deepEqual(D.intent("Adult dosing of Ondansetron for dose of Pcm — dose, route, titration and renal-adjustment principles. Verify locally."), { name: "Ondansetron", section: "adult" });
  assert.deepEqual(D.intent("Paediatric dosing of paracetamol for fever — dose, route, titration and renal-adjustment principles. Verify locally."), { name: "paracetamol", section: "ped" });
  assert.deepEqual(D.intent("Renal-adjusted dosing of vancomycin for sepsis — dose, route, titration and renal-adjustment principles. Verify locally."), { name: "vancomycin", section: "renal" });
  assert.deepEqual(D.intent("Dose of Pcm?"), { name: "paracetamol", section: "adult" });
  assert.deepEqual(D.intent("Tell me Ondansetron dose"), { name: "Ondansetron", section: "adult" });
  assert.deepEqual(D.intent("give me the dose of mtx"), { name: "methotrexate", section: "adult" });
});

test("NOT a database lookup: a clinical question that merely contains the word dose falls through", async () => {
  assert.equal(D.intent("treatment of hypertension"), null);
  assert.equal(D.intent("tell me doses"), null, "a bare follow-up carries no drug; continuity handles it");
  // "steroids" parses as a name but is a CLASS, not a molecule: no database row, so answer() is null
  // and the grounded model answers the real question.
  assert.equal(await D.answer("what is the dose of steroids in septic shock with vasopressors", deps), null);
});

test("answers from the database: plain structured record, with the renal line a dose question needs", async () => {
  const r = await D.answer("tell me dose of ondansetron", deps);
  assert.equal(r.drug, "Ondansetron");
  assert.match(r.text, /\*\*Ondansetron\*\* - Adult dose/);
  assert.match(r.text, /8 mg IV\/PO 30 minutes before chemotherapy/);
  assert.match(r.text, /\*\*Renal:\*\* No adjustment/);
  assert.match(r.text, /Verify against your local formulary/);
});

test("spelling: 'parecetmal' resolves to Paracetamol and the correction is STATED, never silent", async () => {
  const r = await D.answer("dose of parecetmal", deps);
  assert.equal(r.drug, "Paracetamol");
  assert.match(r.text, /You typed "parecetmal" - showing Paracetamol/);
  assert.match(r.text, /500 mg to 1 g/);
});

test("gold monograph: the paediatric ask returns the paediatric row, not the adult one", async () => {
  const r = await D.answer("paediatric dose of paracetamol", deps);
  assert.match(r.text, /15 mg\/kg per dose/);
  assert.doesNotMatch(r.text, /500 mg to 1 g/);
  assert.equal(r.section, "ped");
});

test("renal ask returns the adjustment text", async () => {
  const r = await D.answer("dose of paracetamol in renal failure", deps);
  assert.match(r.text, /CrCl < 30 mL\/min/);
});

test("a brand name lands on its molecule and says so", async () => {
  const r = await D.answer("dose of pantocid", deps);
  assert.equal(r.drug, "Pantoprazole");
  assert.match(r.text, /Pantocid is Pantoprazole/);
  assert.match(r.text, /40 mg PO once daily/);
});

test("FAILS OPEN: unknown molecule, or a record with no dose text, returns null so MaiK answers normally", async () => {
  assert.equal(await D.answer("dose of zzzqqxdrug", deps), null);
  assert.equal(await D.answer("dose of vancomycin", deps), null, "found:false record -> model answers");
  assert.equal(await D.answer("treatment of pneumonia", deps), null);
  assert.equal(await D.answer("dose of ondansetron", { MEDAPI: null }), null, "no database -> model answers");
});
