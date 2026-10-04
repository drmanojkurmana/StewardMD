/* MaiK Lite value questions (2026-10-04, live on the iPhone 15 Pro, OTA v177): "normal adult potassium
 * range?" grounded on a dialysate passage and Lite said "No specific normal serum potassium range is given
 * in the evidence"; "INR target mechanical mitral valve" grounded on a bridging list instead of the book's
 * "target INR of 2.5-3.5" passage. Real BM25 (kb/ai/maik-lite-rag.js) over a few real book rows. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAG = require("../kb/ai/maik-lite-rag.js");
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

const ROWS = [
  ["DIALYSATE", "The potassium concentration of dialysate may be varied from 0-4 mmol/L depending on the predialysis serum potassium concentration. The use of 0- or 1-mmol/L potassium dialysate is becoming much less common owing to data suggesting that patients who undergo treatments with very low potassium dialysate have an increased risk of sudden death."],
  ["Acute Adrenal Insufficiency", "Mineralocorticoid replacement in primary adrenal insufficiency should be initiated at a dose of 100-150 μg fludrocortisone. In addition, serum sodium, potassium, and plasma renin should be measured regularly. Renin levels should be kept in the upper normal reference range."],
  ["TABLE 416-9 Management of Diabetic Ketoacidosis (DKA)", "Potassium stores are depleted in DKA (estimated deficit 3-5 mmol/kg). Thus, potassium repletion should commence as soon as adequate urine output and a normal serum potassium are documented (Table 416-9)."],
  ["ORAL ANTICOAGULANTS", "For most indications, warfarin is administered in doses that produce a target INR of 2.0-3.0. An exception is patients with mechanical heart valves, particularly those in the mitral position or older ball and cage valves in the aortic position, and valves in any position associated with atrial fibrillation, where a target INR of 2.5-3.5 is recommended."],
  ["ACUTE GASTROINTESTINAL HEMORRHAGE", "Bridging therapy with low-molecular-weight heparin should be considered for patients discontinuing warfarin who are at high risk for thromboembolism, including those with (1) prosthetic metal heart valve, (2) atrial fibrillation, mitral stenosis, prosthetic valve or history of stroke; (3) mechanical mitral valve; (4) mechanical aortic valve with other thromboembolic risk factors."],
  ["Exercise", "A high-pitched apical systolic murmur in patients with a mechanical mitral prosthesis and a diastolic decrescendo murmur in patients with a mechanical aortic prosthesis indicate paravalvular regurgitation. Mechanical valve dysfunction may first be suggested by a decrease in the intensity of the closing sound."],
  // Lexically closer than the answer (the bigrams "mechanical mitral" and "mitral valve"), but no target.
  ["Prosthetic Valve Thrombosis", "A mechanical mitral valve is the most thrombogenic prosthesis. Mechanical mitral valve thrombosis presents with dyspnoea; check the INR and image the mechanical mitral valve at once."],
  ["Prosthetic Valve Follow Up", "Patients with a mechanical mitral valve need lifelong INR checks at an anticoagulation clinic, and endocarditis prophylaxis before dental work on a mechanical mitral valve."],
  ["Pneumonia", "Community-acquired pneumonia is treated with amoxicillin or a macrolide; severe disease needs a beta-lactam plus a macrolide and admission to hospital for oxygen and fluids."],
  ["Asthma", "Acute asthma is treated with inhaled salbutamol, oxygen and systemic corticosteroids; magnesium sulphate is given for severe attacks that do not respond."],
  // Filler chapters, so the clinical words are rare enough to score like they do in the real book.
  ...Array.from({ length: 60 }, (_, k) => ["Chapter " + k, "General notes on history taking, examination of the patient, the doctor's communication with families, consent, documentation and follow up, part " + k + " of the introductory section of this textbook."]),
].map(([h, t], i) => ({ i, headings: [h], pages: [100 + i], text: h + "\n" + t }));

function load(reply) {
  const calls = { generate: [] };
  const Llama = {
    available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async (o) => { calls.generate.push(o); return { text: reply, ms: 5 }; },
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }),
  };
  const book = new RAG.Book(ROWS);
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: RAG, SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_PROTOCOLS: [],
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } },
      pathFor: async () => "/x.gguf", totalBytes: () => 1 },
  };
  new Function("window", SRC)(win);
  return { L: win.SMD_MAIK_LOCAL, calls };
}

// The INR miss itself needs the real book's pool (the expansion "valve" pushed the passage out); the
// Lite bench pins it on the real book (L-62 in test/maik-eval/live-cases.json). This pins the order.
test("a target question leads with the passage that states the target", async () => {
  const g = await load("").L.retrieveGrounding("maik-lite", "INR target mechanical mitral valve", "", null);
  assert.ok(g, "grounded");
  assert.match(g.passages[0].text, /target INR of 2\.5-3\.5/);
});

test("a normal-range question the book cannot answer is not grounded on dialysate", async () => {
  const g = await load("").L.retrieveGrounding("maik-lite", "normal adult potassium range?", "", null);
  assert.equal(g, null, "a table number (416-9) and a dialysate range are not a normal range");
});

test("so the model answers it from its own knowledge, labelled as not checked", async () => {
  const { L, calls } = load("Normal adult serum potassium is 3.5 to 5.0 mmol/L.");
  const r = await L.answer({ question: "normal adult potassium range?" }, { pack: "maik-lite" }, null);
  assert.equal(calls.generate.length, 1);
  assert.ok(!/Reference material/.test(calls.generate[0].prompt));
  assert.equal(r.grounded, false);
  assert.match(r.text, /3\.5 to 5\.0[\s\S]*Not checked against the StewardMD Knowledge Base\.$/);
});

test("a non-value question keeps its grounding and is not labelled", async () => {
  const { L, calls } = load("Dialysate potassium is chosen by the predialysis serum potassium.");
  const g = await L.retrieveGrounding("maik-lite", "dialysate potassium concentration", "", null);
  assert.match(g.passages[0].heading, /DIALYSATE/);
  const r = await L.answer({ question: "dialysate potassium concentration" }, { pack: "maik-lite" }, null);
  assert.ok(/Reference material/.test(calls.generate[0].prompt));
  assert.ok(!/Not checked/.test(r.text));
});

test("'is given in the evidence' is a no-coverage verdict: re-asked ungrounded, labelled", async () => {
  const { L, calls } = load("No specific normal serum potassium range is given in the evidence.");
  const r = await L.answer({ question: "dialysate potassium concentration" }, { pack: "maik-lite" }, null);
  assert.equal(calls.generate.length, 2);
  assert.ok(!/Reference material/.test(calls.generate[1].prompt));
  assert.match(r.text, /Not checked against the StewardMD Knowledge Base\.$/);
});
