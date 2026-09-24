/* test/maik-about-me.test.mjs — the doctor's preferences memory and balanced offline answers
 * (owner, 2026-09-25: "build the doctor preferences memory"; "offline models answer balanced rather
 * than short"). Browser behaviour is in test/run-maik-about-me-ui.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const S = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

const me = new Function("localStorage", "maikAcctKey",
  H.slice(H.indexOf("var MAIK_ME_WORK = "), H.indexOf("function maikMeLine(")) +
  H.slice(H.indexOf("function maikMeLine("), H.indexOf("\n  }", H.indexOf("function maikMeLine(")) + 4) +
  "return { line: maikMeLine, phi: maikMeHasPHI };")({ getItem: () => null }, () => "d_x");

test("the preferences become one short line; empty preferences send nothing", () => {
  const l = me.line({ spec: "Internal Medicine", work: ["ICU", "Ward", "Hacked"], guide: "Indian", notes: "District hospital; prefer NLEM drugs" });
  assert.equal(l, "Speciality: Internal Medicine. Works in: ICU, Ward. Prefers Indian (ICMR, API, NLEM) guidelines where guidance differs; name the major alternative when it matters. Notes: District hospital; prefer NLEM drugs");
  assert.ok(l.length < 400, "roughly 50 to 100 tokens");
  assert.equal(me.line({}), ""); assert.equal(me.line({ guide: "No preference" }), "");
});

test("anything that could identify a patient is refused", () => {
  for (const s of ["MRN 12345", "UHID: 998877", "call 9876543210", "bed 12 patient", "patient's name Ravi"]) assert.equal(me.phi(s), true, s);
  for (const s of ["District hospital, 40 beds", "prefer NLEM drugs", "ICU 2 years"]) assert.equal(me.phi(s), false, s);
});

test("every clinical answer carries it, and the cloud prompt renders it", () => {
  assert.match(H, /var _me = maikMeLine\(\); if \(pkg && _me\) pkg\.doctor = _me;/);
  assert.match(S, /=== ABOUT THE CLINICIAN \(their saved preferences/);
});

function engine() {
  const calls = [];
  const Llama = { available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async (o) => { calls.push(o); return { text: "Answer. Verify against local protocol.", ms: 5 }; },
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }) };
  const passage = { heading: "Hypertension > Treatment", page: "p.1", text: "Amlodipine 5 to 10 mg once daily.", chunk: 1 };
  const book = { search: () => [[12.5, 0]], cite: () => passage, idfOf: () => 5, us: (w) => w };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return { L: win.SMD_MAIK_LOCAL, calls };
}

test("offline: a default answer is BALANCED and carries the doctor line; a teaching mode gets neither", async () => {
  const e = engine();
  await e.L.answer({ question: "treatment of hypertension", doctor: "Speciality: Internal Medicine" }, { depth: "concise", pack: "maik-lite" });
  const sys = e.calls[e.calls.length - 1].system;
  // Audit T23: this harness retrieves a passage, so Balanced follows the evidence (no word target).
  assert.match(sys, /LENGTH: BALANCED\. Open with one plain sentence that answers the question, then cover it as fully as the reference material supports/);
  assert.doesNotMatch(sys, /200 to 350 words/);
  assert.doesNotMatch(sys, /essential points only/);
  assert.match(sys, /ABOUT THE CLINICIAN .*Speciality: Internal Medicine/);
  await e.L.answer({ question: "why does the JVP rise", doctor: "Speciality: Internal Medicine" }, { depth: "concise", pack: "maik-lite", mode: "clinix-tutor" });
  const tut = e.calls[e.calls.length - 1].system;
  assert.doesNotMatch(tut, /ABOUT THE CLINICIAN|LENGTH:/);
});

test("offline: the shared prompt no longer tells a small model 'a quick question gets a few short bullets'", () => {
  assert.doesNotMatch(SRC, /a quick question gets a few short bullets/);
  assert.match(SRC, /any other question " \+\n\s*"gets a balanced answer covering the key points a clinician needs/);
});
