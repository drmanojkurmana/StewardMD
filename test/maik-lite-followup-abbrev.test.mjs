/* MaiK Lite follow-ups, abbreviations and looping lists (owner transcript, 2026-10-02):
 *   "PMRT in Breast Ca" -> "Mandatory in whom?" answered about substance-use disorder, looping one line x12;
 *   "I mean PMRT mandatory for whom" -> "prostate radiation therapy"; "TCHP" -> three invented antibiotics.
 * Production code, no mocks of the logic under test. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const RAGm = require("../kb/ai/maik-lite-rag.js");

function load({ tokens = [], rows = null } = {}) {
  const calls = { generate: [], cancel: 0 };
  let listener = null, cancelled = false;
  const Llama = {
    available: async () => ({ available: true, loaded: true }),
    load: async () => ({ loaded: true }),
    generate: async (o) => {
      calls.generate.push(o);
      let full = "";
      for (const t of tokens) {
        if (cancelled) break;
        full += t;
        if (listener) listener({ text: t });
      }
      return { text: full, ms: 1 };
    },
    cancel: async () => { calls.cancel++; cancelled = true; return {}; },
    release: async () => ({ released: true }),
    addListener: (name, cb) => { if (name === "llamaToken") listener = cb; return { remove: () => { listener = null; } }; },
  };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: Object.assign({}, RAGm, { MIN_SCORE: 0.5 }),
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } },
      pathFor: async () => "/m.gguf", totalBytes: () => 1e9 },
  };
  if (rows) win.SMD_MAIK_KB_STORE = { loadBook: () => Promise.resolve(new RAGm.Book(rows)) };
  new Function("window", SRC)(win);
  return { L: win.SMD_MAIK_LOCAL, calls };
}

const PMRT_HIST = [
  { q: "PMRT in Breast Ca", a: "PMRT (postmastectomy radiotherapy) is given after mastectomy to reduce chest wall and nodal recurrence." },
];

test("'Mandatory in whom?' after 'PMRT in Breast Ca' continues the conversation", () => {
  const { L } = load();
  assert.equal(L.continues("Mandatory in whom?", PMRT_HIST), true);
  assert.equal(L.continues("I mean PMRT mandatory for whom", PMRT_HIST), true);
  assert.equal(L.continues("Who is eligible?", PMRT_HIST), true);
  assert.equal(L.continues("When is it indicated?", PMRT_HIST), true);
});

test("a question that names a new subject still starts fresh", () => {
  const { L } = load();
  assert.equal(L.continues("Polycystic Kidney Disease", PMRT_HIST), false);
  assert.equal(L.continues("Which drug for gout?", PMRT_HIST), false);
});

test("the model sees the history AND what PMRT / Breast Ca mean", () => {
  const { L } = load();
  const p = L.buildPrompt({ question: "Mandatory in whom?", history: PMRT_HIST }, "maik-lite");
  assert.match(p, /Doctor: PMRT in Breast Ca \(PMRT = postmastectomy radiotherapy; Breast Ca = breast cancer\)/);
  assert.match(p, /Mandatory in whom\?/);
  const q = L.buildPrompt({ question: "PMRT in Breast Ca" }, "maik-lite");
  assert.match(q, /^PMRT in Breast Ca \(PMRT = postmastectomy radiotherapy; Breast Ca = breast cancer\)/);
  const t = L.buildPrompt({ question: "What is does of TCHP REGIMEN" }, "maik-lite");
  assert.match(t, /TCHP = docetaxel \+ carboplatin \+ trastuzumab \+ pertuzumab/);
});

test("a question with no abbreviation is passed through byte for byte", () => {
  const { L } = load();
  assert.match(L.buildPrompt({ question: "Treatment of pneumonia" }, "maik-lite"), /^Treatment of pneumonia\n/);
});

test("gloss and expand: abbreviation vs real word", () => {
  assert.equal(RAGm.gloss("tch in breast cancer"), "tch = docetaxel + carboplatin + trastuzumab");
  assert.equal(RAGm.gloss("which patch"), "", "no substring matches");
  assert.equal(RAGm.gloss("cancer of the breast, ca breast"), "ca breast = breast cancer");
  const [q, extra] = RAGm.expand("PMRT in Breast Ca");
  assert.match(q, /postmastectomy radiotherapy radiation therapy/);
  assert.match(extra, /breast cancer/);
  assert.match(RAGm.expand("TCHP regimen")[0], /docetaxel carboplatin trastuzumab pertuzumab/);
  assert.match(RAGm.expand("postmastectomy radiation therapy")[1], /pmrt/);
});

const LOOP = "Mandatory for all patients with a history of X use disorder";
const loopText = (n) => Array.from({ length: n }, (_, i) => "- " + LOOP.replace("X", "drug" + i)).join("\n");

test("stripReasoning collapses a looping list but keeps two and leaves prose and short bullets alone", () => {
  const { L } = load();
  const out = L.stripReasoning("PMRT is indicated as follows.\n" + loopText(12) + "\n- Short bullet\n- Short bullet\n- Short bullet");
  assert.equal(out.split("\n").filter((l) => /Mandatory for all patients/.test(l)).length, 2);
  assert.match(out, /^PMRT is indicated as follows\./);
  assert.equal(out.split("\n").filter((l) => l === "- Short bullet").length, 3);
  const clean = "- Docetaxel 75 mg/m2 on day 1\n- Carboplatin AUC 6 on day 1\n- Trastuzumab 8 mg/kg then 6 mg/kg";
  assert.equal(L.stripReasoning(clean), clean);
});

test("the stream is cancelled when a list line loops, and the answer is the collapsed text", async () => {
  const lines = ["PMRT is mandatory in selected patients.\n", ...Array.from({ length: 12 }, (_, i) => "- " + LOOP.replace("X", "drug" + i) + "\n")];
  const { L, calls } = load({ tokens: lines });
  const deltas = [];
  const r = await L.answer({ question: "Mandatory in whom?", history: PMRT_HIST }, { pack: "maik-lite" }, (t) => deltas.push(t));
  assert.equal(calls.cancel, 1, "cancelled once");
  const body = String(r.text || r.answer || "");
  assert.ok(body, JSON.stringify(r).slice(0, 200));
  assert.ok(body.split("\n").filter((l) => /Mandatory for all patients/.test(l)).length <= 2, body);
  assert.ok(deltas.length > 0);
});

test("a normal list that never repeats is not cancelled", async () => {
  const { L, calls } = load({ tokens: ["- Docetaxel 75 mg per square metre\n", "- Carboplatin AUC 6 on day one\n", "- Trastuzumab 8 mg per kg load\n"] });
  await L.answer({ question: "TCHP doses" }, { pack: "maik-lite" }, () => {});
  assert.equal(calls.cancel, 0);
});

test("retrieval for 'PMRT in breast cancer' reaches the breast-cancer disease doc text", async () => {
  const docs = JSON.parse(readFileSync(new URL("../kb/dist/kb.disease-docs.json", import.meta.url), "utf8"));
  const bc = docs.find((d) => d.id === "breast_cancer").text;
  assert.match(bc, /PMRT[^.]*MANDATORY/i);
  assert.match(bc, /docetaxel 75 mg\/m2/i);
  assert.match(bc, /1 year of HER2 therapy/);
  // The new text, cut into book-shaped rows next to an unrelated chapter, is what BM25 returns.
  const rows = [
    { i: 0, headings: ["Breast Cancer", "Radiotherapy / PMRT"], pages: [1], text: bc.slice(bc.indexOf("Radiotherapy / PMRT")).slice(0, 700) },
    { i: 1, headings: ["Prostate Cancer", "Radiation therapy"], pages: [2], text: "Prostate radiation therapy with androgen deprivation is used for localized prostate cancer and rising PSA after prostatectomy. ".repeat(4) },
  ];
  const { L } = load({ rows });
  const g = await L.retrieveGrounding("maik-lite", "PMRT in breast cancer", "", null);
  assert.ok(g, "grounded");
  assert.match(g.passages[0].heading, /Breast Cancer/);
  assert.match(g.evidenceText, /MANDATORY/);
  assert.ok(g.passages.every((p) => !/Prostate/.test(p.heading)), JSON.stringify(g.passages.map((p) => p.heading)));
});
