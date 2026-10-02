/* MaiK Lite evidence, 2026-10-02 (scripts/bench-maik-lite-retrieval.mjs --router real on the real book:
 * key points in the evidence 63.4% -> 76.7%, fully covered 19 -> 29 of 54):
 *   - a treatment question's first curated passage is the matching StewardMD clinical protocol summary
 *     (kb/clinical-protocols/index.json), which the Knowledge Library showed and MaiK never read,
 *   - infective regimens (no steps, only dosing lines) still give a regimen passage,
 *   - the curated notes lead with their management sentences,
 *   - back-of-book index rows are never evidence,
 *   - "a 50 year old man" is not a child. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const RAGm = require("../kb/ai/maik-lite-rag.js");
const PROTOS = JSON.parse(readFileSync(new URL("../kb/clinical-protocols/index.json", import.meta.url), "utf8")).protocols;
const win = {
  Capacitor: { isNativePlatform: () => true, Plugins: { Llama: {} } },
  SMD_MAIK_RAG: Object.assign({}, RAGm, { MIN_SCORE: 0.5 }),
  SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(new RAGm.Book([{ i: 0, headings: ["x"], pages: [1], text: "x" }])) },
  SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } } },
};
new Function("window", SRC)(win);
const L = win.SMD_MAIK_LOCAL;

const pkg = (question, grounded, extra) => Object.assign({
  question, topicMatch: grounded ? { matched: true, grounded, topic: grounded } : { matched: false, mode: "none", topic: "" },
  grounding: grounded ? [{ diseaseId: "x", name: grounded, knowledge: [{ text: grounded + " is defined by a set of diagnostic criteria. Give treatment early and monitor closely." }] }] : [],
}, extra || {});

test("severe pre-eclampsia: the protocol summary leads, with magnesium sulphate", () => {
  const cur = L.curatedPassages(pkg("severe preeclampsia management", "Pre-eclampsia"), PROTOS);
  assert.match(cur[0].heading, /^StewardMD Protocol > Pre-eclampsia/);
  assert.match(cur[0].text, /magnesium/i);
  assert.ok(cur[0].text.length <= 700);
});

test("a child with dehydration gets the paediatric protocol, an adult question does not", () => {
  const kid = L.curatedPassages(pkg("management of acute diarrhoea with some dehydration in a child", "Acute Infectious Diarrheal Diseases"), PROTOS);
  assert.match(kid[0].heading, /children/i);
  assert.match(kid[0].text, /\bORS\b|oral rehydration/i);
  assert.equal(L.isChildQ("first line drug for hypertension in a 50 year old Indian man"), false);
  assert.equal(L.isChildQ("paracetamol dose for a 12 kg child"), true);
  assert.equal(L.isChildQ("fever in a 6 year old"), true);
});

test("septic shock: the infective regimen (dosing lines, no steps) still makes a regimen passage", () => {
  const tx = { diseaseId: "x", default: { line: "empiric", steps: null, dosing: [
    { drug: "piperacillin-tazobactam or meropenem", label: "Piperacillin-tazobactam or Meropenem", dose: "Pip-tazo 4.5 g IV q6-8h or Meropenem 1-2 g IV q8h", route: "IV", freq: "as above" }] } };
  const cur = L.curatedPassages(pkg("how to manage septic shock", "Septic Shock", { treatment: tx }), []);
  assert.match(cur[0].heading, /Septic Shock > Management$/);
  assert.match(cur[0].text, /Empiric antimicrobials/);
  assert.match(cur[0].text, /Meropenem 1-2 g IV q8h/);
  assert.ok(!/as above/.test(cur[0].text), "placeholder frequencies are not copied");
});

test("no router disease: a treatment question naming a protocol still gets it; a definition question does not", () => {
  assert.match(L.curatedPassages(pkg("first line drug for hypertension in a 50 year old Indian man"), PROTOS)[0].heading, /Hypertension/);
  assert.equal(L.curatedPassages(pkg("what is hypertension"), PROTOS).length, 0);
});

test("the curated notes lead with management sentences on a treatment question", () => {
  const p = pkg("septic shock treatment", "Septic Shock");
  p.grounding[0].knowledge = [{ text: "Septic shock is a subset of sepsis with circulatory failure. Sepsis-3 abandoned SIRS. Give 30 mL/kg crystalloid and start noradrenaline to a MAP of 65." }];
  const cur = L.curatedPassages(p, []);
  assert.match(cur[0].text, /^Give 30 mL\/kg crystalloid/);
  assert.match(L.curatedPassages(pkg("what is septic shock", "Septic Shock"), [])[0].text, /^Septic Shock is defined/, "a non-treatment question keeps the original order");
});

test("back-of-book index rows are not evidence", () => {
  assert.equal(L.isIndexPage("Sepsis/septic shock anaerobic bacteremia and, 1377 without clear focus, 990, 991t clinical features of, 990, 991t, 993, 2320 clostridial, 1239t, 1243 complications of acute lung injury, 2323 AKI, 2323 cardiovascular, 2322-2323"), true);
  assert.equal(L.isIndexPage("In patients with septic shock, give 30 mL/kg crystalloid within 3 hours, start noradrenaline for a MAP of 65 mmHg, and repeat lactate within 2 to 4 hours."), false);
});
