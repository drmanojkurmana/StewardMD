/* test/maik-opd-dose-check.test.mjs - offline OPD suggestions: treatment doses are checked against the
 * Knowledge Base like answer doses are (audit T34, 2026-09-25).
 *
 * opdSuggest() used to return drug + dose + route + frequency from the model's weights with no
 * evidence and no number check. Now each dosed treatment line is claim-checked against the book
 * passages for the provisional diagnosis; an unsupported dose is dropped and the drug kept with
 * "(dose: verify in Drug Index)". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

function engine({ json, passage = null, noBook = false }) {
  const Llama = { available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => ({ text: JSON.stringify(json), ms: 5 }),
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }) };
  const p = passage || { heading: "Pyelonephritis > Treatment", page: "p.1", chunk: 1,
    text: "Acute pyelonephritis: ceftriaxone 1 g IV once daily, then oral therapy guided by culture. Paracetamol for fever." };
  const book = { search: () => [[12.5, 0]], cite: () => Object.assign({}, p), idfOf: () => 5, us: (w) => w };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_DRUG_LEXICON: require("../drug-lexicon.js"),
    SMD_MAIK_KB_STORE: noBook ? undefined : { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return win.SMD_MAIK_LOCAL;
}

const JSON1 = { provisionalDx: "Acute pyelonephritis", ddx: [{ dx: "Acute pyelonephritis", why: "fever, flank pain" }],
  investigations: ["Urine culture"], redFlags: ["Sepsis"],
  treatment: ["Ceftriaxone 1 g IV once daily", "Gentamicin 7 mg/kg IV once daily", "Oral fluids", "Paracetamol 650 mg PO every 6 hours for fever"] };

test("a dose the book supports is kept; an unsupported one loses its figure and keeps the drug", async () => {
  const L = engine({ json: JSON1 });
  const r = await L.opdSuggest("Fever 3 days, flank pain, dysuria", { pack: "maik-lite" });
  assert.equal(r.treatment[0], "Ceftriaxone 1 g IV once daily", "same drug, same dose as the passage");
  assert.equal(r.treatment[1], "Gentamicin (dose: verify in Drug Index)", "gentamicin is not in the evidence");
  assert.equal(r.treatment[2], "Oral fluids", "no figure, nothing to check");
  assert.equal(r.treatment[3], "Paracetamol (dose: verify in Drug Index)", "the book names paracetamol but gives no 650 mg");
  assert.deepEqual(r.doseCheck, { evidence: 1, stripped: 2 });
  assert.ok(!/—/.test(r.treatment.join(" ")), "no em-dash in app-facing text");
});

test("a dose the book states for a DIFFERENT drug is not support", async () => {
  const L = engine({ json: Object.assign({}, JSON1, { treatment: ["Amikacin 1 g IV once daily"] }) });
  const r = await L.opdSuggest("Fever, flank pain", { pack: "maik-lite" });
  assert.equal(r.treatment[0], "Amikacin (dose: verify in Drug Index)");
});

test("a figure the clinician entered in the assessment counts as theirs", async () => {
  const L = engine({ json: Object.assign({}, JSON1, { treatment: ["Continue metformin 500 mg twice daily"] }) });
  const r = await L.opdSuggest("Known diabetic on metformin 500 mg twice daily; fever, flank pain", { pack: "maik-lite" });
  assert.equal(r.treatment[0], "Continue metformin 500 mg twice daily");
});

test("no evidence at all: no dose is supported, every dosed line is stripped", async () => {
  const L = engine({ json: JSON1, noBook: true });
  const r = await L.opdSuggest("Fever 3 days, flank pain", { pack: "maik-lite" });
  assert.equal(r.treatment[0], "Ceftriaxone (dose: verify in Drug Index)");
  assert.equal(r.doseCheck.evidence, 0);
  assert.equal(r.doseCheck.stripped, 3);
});
