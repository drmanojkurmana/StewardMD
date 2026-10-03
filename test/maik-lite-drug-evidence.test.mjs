/* MaiK Lite drug evidence, 2026-10-02 (scripts/bench-maik-lite-retrieval.mjs --router real on the real book:
 * key points 76.7% -> 86.7%, fully covered 29 -> 38 of 54). A drug question with no router disease gets the
 * StewardMD Drug Index / Interactions / pregnancy passage built from the app's own curated data, and a
 * lab-value vignette ("k 6.8 with peaked T") reaches its protocol. Runs against the REAL data files
 * (dose-rules, interaction rules, offline gold monographs) through the bench's injectDrugData. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { injectDrugData } from "../scripts/bench-maik-lite-retrieval.mjs";

const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const RAGm = require("../kb/ai/maik-lite-rag.js");
const PROTOS = JSON.parse(readFileSync(new URL("../kb/clinical-protocols/index.json", import.meta.url), "utf8")).protocols;

function boot(extra) {
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama: {} } },
    SMD_MAIK_RAG: Object.assign({}, RAGm, { MIN_SCORE: 0.5 }),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(new RAGm.Book([{ i: 0, headings: ["x"], pages: [1], text: "x" }])) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } } },
  };
  if (extra !== "bare") injectDrugData(win);
  new Function("window", SRC)(win);
  return win;
}
const win = boot();
const L = win.SMD_MAIK_LOCAL;
const noRouter = (question) => ({ question, topicMatch: { matched: false, mode: "none", topic: "" }, grounding: [] });
const matched = (question, name) => ({
  question, topicMatch: { matched: true, grounded: name, topic: name },
  grounding: [{ diseaseId: "x", name, knowledge: [{ text: name + " is a condition. Give treatment early and monitor closely, with fluids and review." }] }],
});

test("fails open: no lexicon, a throwing lexicon, or a plain question gives no drug passage", async () => {
  assert.deepEqual(await boot("bare").SMD_MAIK_LOCAL.drugEvidence(noRouter("paracetamol dose for a child")), []);
  const bad = boot(); bad.SMD_DRUGLINK = { drugsIn: () => { throw new Error("x"); } };
  assert.deepEqual(await bad.SMD_MAIK_LOCAL.drugEvidence(noRouter("paracetamol dose")), []);
  assert.deepEqual(await L.drugEvidence(noRouter("what is hypertension")), []);
  assert.deepEqual(await L.drugEvidence(noRouter("tell me about paracetamol")), [], "one drug and no dose-shaped word is not a drug question");
});

test("paracetamol dose for a 12 kg child: the child row (mg/kg, interval, daily max), never the adult dose", async () => {
  const [p] = await L.drugEvidence(noRouter("paracetamol dose for a 12 kg child with fever"));
  assert.match(p.heading, /^StewardMD Drug Index > Paracetamol/);
  assert.match(p.text, /10-15 mg\/kg\/dose every 4-6 h/);
  assert.match(p.text, /75 mg\/kg\/day/);
  assert.doesNotMatch(p.text, /4000 mg|500-1000 mg/);
  assert.ok(p.text.length <= 700);
});

test("a child question about a drug with no child row says so instead of offering the adult dose", async () => {
  const [p] = await L.drugEvidence(noRouter("tramadol dose for a 10 kg child"));
  assert.match(p.text, /No paediatric dose is on file/);
  assert.doesNotMatch(p.text, /400 mg|100 mg/);
});

test("renal dose question leads with the monograph's renal text (metformin: contraindicated below eGFR 30)", async () => {
  const [p] = await L.drugEvidence(noRouter("metformin dose in reduced eGFR"));
  assert.match(p.text, /^Metformin[^.]*\. Renal: .*Contraindicated when eGFR is below 30/);
  assert.ok(p.text.length <= 700);
});

test("gentamicin dose: the per-kg rows and the renal / serum level monitoring text", async () => {
  const [p] = await L.drugEvidence(noRouter("how to dose gentamicin once daily"));
  assert.match(p.text, /3 mg\/kg\/day/);
  assert.match(p.text, /Monitor serum levels/);
});

test("two named drugs: the interaction rule leads (serotonin syndrome), then both drugs' index lines", async () => {
  const ps = await L.drugEvidence(noRouter("can I give tramadol to a patient on sertraline"));
  assert.match(ps[0].heading, /^StewardMD Interactions > Tramadol \+ Sertraline/);
  assert.match(ps[0].text, /Serotonin syndrome/);
  assert.match(ps[0].text, /clonus|agitation/);
  assert.match(ps[1].heading, /^StewardMD Drug Index > Tramadol, Sertraline/);
  assert.match(ps[1].text, /seizure threshold/);
  ps.forEach((p) => assert.ok(p.text.length <= 700));
});

test("warfarin + ciprofloxacin: INR rise and when to check it", async () => {
  const [p] = await L.drugEvidence(noRouter("warfarin patient needs ciprofloxacin, any interaction?"));
  assert.match(p.text, /INR/);
  assert.match(p.text, /Check INR 3-5 days/);
});

test("clarithromycin + simvastatin: the contraindicated rule leads, with myopathy and the switch", async () => {
  const [p] = await L.drugEvidence(noRouter("clarithromycin with simvastatin interaction"));
  assert.match(p.text, /^Contraindicated: .*myopathy/);
  assert.match(p.text, /Suspend simvastatin|switch/i);
  assert.ok(p.text.length <= 700);
});

test("valproate in women of childbearing age: the pregnancy passage from the gold monograph", async () => {
  const [p] = await L.drugEvidence(noRouter("valproate in women of childbearing age"));
  assert.match(p.heading, /Pregnancy$/);
  assert.match(p.text, /teratogenic/i);
  assert.match(p.text, /contraception/i);
  assert.match(p.text, /folic acid/i);
});

test("a pregnancy question with no gold bundle fails open to the dose passage only", async () => {
  const w = boot(); delete w.SMD_OFFLINE_CLINICAL;
  const ps = await w.SMD_MAIK_LOCAL.drugEvidence(noRouter("metformin in pregnancy"));
  assert.ok(ps.every((p) => p.drug !== "pregnancy"));
});

test("curatedPassages: with no router disease the drug passages lead and the budget holds", async () => {
  const q = "can I give tramadol to a patient on sertraline";
  const cur = L.curatedPassages(noRouter(q), PROTOS, await L.drugEvidence(noRouter(q)));
  assert.match(cur[0].heading, /^StewardMD Interactions/);
  assert.ok(cur.length <= 3 && cur.every((p) => p.text.length <= 700));
  assert.equal(L.curatedPassages(noRouter(q), PROTOS).length, 0, "no drug passages given, no change");
});

test("curatedPassages: a matched disease takes only the interaction passage, not a single drug's dose card", async () => {
  const two = matched("warfarin and ciprofloxacin in a patient with atrial fibrillation, treatment", "Atrial Fibrillation");
  const cur = L.curatedPassages(two, PROTOS, await L.drugEvidence(two));
  assert.match(cur[0].heading, /^StewardMD Interactions > Warfarin \+ Ciprofloxacin/);
  const one = matched("paracetamol dose in the treatment of dengue", "Dengue");
  const c1 = L.curatedPassages(one, PROTOS, await L.drugEvidence(one));
  assert.ok(c1.every((p) => !p.drug), "a single drug dose card never displaces the disease passages");
});

test("lab-value vignettes reach their protocol; ordinary values and children do not", () => {
  assert.equal(L.labProtocolId("k 6.8 with peaked T, what now"), "hyperkalaemia");
  assert.equal(L.labProtocolId("potassium 7.1 on the gas"), "hyperkalaemia");
  assert.equal(L.labProtocolId("k 4.2 this morning, what now"), "");
  assert.equal(L.labProtocolId("pt with SOB, BNP high, pedal edema, Rx?"), "acute-heart-failure");
  assert.equal(L.labProtocolId("BNP high, what does it mean"), "", "a BNP alone is not a heart failure vignette");
  const k = L.curatedPassages(noRouter("k 6.8 with peaked T, what now"), PROTOS);
  assert.match(k[0].heading, /^StewardMD Protocol > Hyperkalaemia/);
  assert.match(k[0].text, /calcium/i);
  const hf = L.curatedPassages(noRouter("pt with SOB, BNP high, pedal edema, Rx?"), PROTOS);
  assert.match(hf[0].heading, /Acute \(decompensated\) heart failure/);
  assert.equal(L.curatedPassages(noRouter("potassium 7.1 in a 6 year old, what now"), PROTOS).length, 0, "the adult lab protocol is not given for a child");
});
