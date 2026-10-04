/* Adult normal values (2026-10-04): data/ref/adult-ref-values.json schema, the adult-vs-neonatal pick
 * in the Edge router, and MaiK Lite answering "normal adult potassium range?" from the table with its
 * source instead of "Not checked". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadApp } from "../scripts/edge/lib.mjs";

const require = createRequire(import.meta.url);
const DOC = JSON.parse(readFileSync(new URL("../data/ref/adult-ref-values.json", import.meta.url), "utf8"));
const REF_SRC = readFileSync(new URL("../adult-ref.js", import.meta.url), "utf8");

test("schema: every row has analyte, value, unit, a known source and the quoted source row", () => {
  assert.equal(DOC.review, "pending clinical sign-off");
  assert.match(DOC.note, /vary by laborator/i);
  assert.match(DOC.note, /own laboratory/i);
  let n = 0;
  for (const g of DOC.groups) {
    assert.ok(g.id && g.title && g.rows.length, g.id);
    for (const r of g.rows) {
      n++;
      const id = g.id + ":" + r.analyte;
      assert.ok(r.analyte, id);
      assert.ok(typeof r.value === "string" && /\d/.test(r.value), id + " value");
      assert.ok(typeof r.unit === "string", id + " unit");
      assert.ok(r.unit.length || /^(pH|Urine specific gravity)/.test(r.analyte), id + " unit empty only for unitless tests");
      assert.ok(DOC.sources[r.src], id + " source " + r.src);
      assert.ok(r.quote && r.quote.length > 5, id + " quote");
      assert.ok(!r.sex || r.sex === "male" || r.sex === "female", id + " sex");
      assert.ok(!/[—]/.test(r.value + r.unit + (r.note || "")), id + " no em-dash");
    }
  }
  for (const s of Object.values(DOC.sources)) assert.ok(s.title && s.url && s.accessed, s.title);
  assert.ok(n >= 80, "rows " + n);
});

test("match: the asked analyte, longest name wins, adults only", () => {
  const R = require("../adult-ref.js");
  assert.deepEqual(R.match("normal adult potassium range?", DOC), ["Potassium"]);
  assert.deepEqual(R.match("normal LDH range", DOC), ["LDH"]);
  assert.deepEqual(R.match("lactate dehydrogenase reference range", DOC), ["LDH"]);
  assert.deepEqual(R.match("normal 24 hour urine protein", DOC), ["Urine protein (24-hour)"]);
  assert.deepEqual(R.match("what is a normal hb in men", DOC), []);   // 2-letter aliases are too ambiguous
  assert.ok(R.match("normal haemoglobin", DOC).includes("Haemoglobin"));
  assert.equal(R.isNeonatal("normal potassium in a newborn"), true);
  assert.equal(R.isNeonatal("normal adult potassium range?"), false);
  const p = R.passage("Potassium", DOC);
  assert.match(p.text, /3\.5-5\.2 mmol\/L \(RCPA/);
  assert.match(p.text, /3\.5-5\.0 mEq\/L \(ABIM/);
  assert.match(p.text, /own laboratory range/);
});

test("Edge: a normal-range question offers the adult page, a newborn one the neonatal page", () => {
  const { E } = loadApp();
  const prevHub = globalThis.SMD_NEO_HUB, prevOpen = globalThis.SMD_MAIK_TOOL_OPENABLE;
  globalThis.SMD_NEO_HUB = { searchItems: () => [{ id: "neo:ref", title: "Normal values", sub: "Neonatal · Vitals, CSF, blood by age",
    kw: "neonatal nicu newborn reference range normal values heart rate respiratory rate csf cell count protein glucose haemoglobin platelets neutrophils" }] };
  globalThis.SMD_MAIK_TOOL_OPENABLE = () => true;
  try {
    const ids = (q) => E.candidates(q).filter((c) => c.kind === "tool").map((c) => c.id);
    for (const q of ["normal adult potassium range?", "normal potassium range", "reference range for tsh", "normal values"]) {
      assert.ok(ids(q).includes("adultref"), q + " -> " + ids(q));
      assert.ok(!ids(q).includes("neo:ref"), q + " must not offer the neonatal page");
    }
    for (const q of ["normal potassium range in a newborn", "neonatal normal values", "normal csf in neonates"]) {
      assert.ok(!ids(q).includes("adultref"), q + " -> " + ids(q));
    }
    assert.ok(ids("neonatal normal values").includes("neo:ref"));
    const ex = E.candidates("adult normal values");
    assert.equal(ex[0].id, "adultref"); assert.equal(ex[0].exact, true);
  } finally { globalThis.SMD_NEO_HUB = prevHub; globalThis.SMD_MAIK_TOOL_OPENABLE = prevOpen; }
});

/* MaiK Lite with the adult table loaded: same harness as test/maik-lite-value-q.test.mjs (real BM25 over
 * rows that hold no adult potassium range). */
const RAG = require("../kb/ai/maik-lite-rag.js");
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const ROWS = [
  ["DIALYSATE", "The potassium concentration of dialysate may be varied from 0-4 mmol/L depending on the predialysis serum potassium concentration."],
  ["Pneumonia", "Community-acquired pneumonia is treated with amoxicillin or a macrolide; severe disease needs a beta-lactam plus a macrolide."],
  ...Array.from({ length: 40 }, (_, k) => ["Chapter " + k, "General notes on history taking, examination of the patient, consent and follow up, part " + k + "."]),
].map(([h, t], i) => ({ i, headings: [h], pages: [100 + i], text: h + "\n" + t }));

function load(reply, withTable) {
  const calls = { generate: [] };
  const Llama = {
    available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async (o) => { calls.generate.push(o); return { text: reply, ms: 5 }; },
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }),
  };
  const book = new RAG.Book(ROWS);
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: RAG, SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) }, SMD_MAIK_PROTOCOLS: [],
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, pathFor: async () => "/x.gguf", totalBytes: () => 1 },
  };
  if (withTable) { new Function("window", "globalThis", "module", REF_SRC)(win, win, undefined); win.SMD_ADULT_REF.setDoc(DOC); }
  new Function("window", SRC)(win);
  return { L: win.SMD_MAIK_LOCAL, calls };
}

test("MaiK Lite: 'normal adult potassium range?' is grounded on the adult table and names its source", async () => {
  const { L, calls } = load("Normal adult serum potassium is 3.5-5.2 mmol/L [1].", true);
  const r = await L.answer({ question: "normal adult potassium range?" }, { pack: "maik-lite" }, null);
  const prompt = calls.generate[0].prompt;
  assert.match(prompt, /Reference material/);
  assert.match(prompt, /StewardMD Adult Reference Ranges > Potassium/);
  assert.match(prompt, /3\.5-5\.2 mmol\/L/);
  assert.ok(!/DIALYSATE/.test(prompt.split("Using the reference material")[0].split("[2]")[0]), "the table leads");
  assert.equal(r.grounded, true);
  assert.ok(!/Not checked/.test(r.text), r.text);
  assert.match(r.text, /Source: StewardMD adult reference ranges \(.*RCPA/);
});

test("MaiK Lite: a newborn question never gets the adult table", async () => {
  const { L, calls } = load("Potassium in a newborn is higher.", true);
  const r = await L.answer({ question: "normal potassium range in a newborn" }, { pack: "maik-lite" }, null);
  assert.ok(calls.generate.length >= 1);
  assert.ok(calls.generate.every((c) => !/Adult Reference Ranges/.test(c.prompt)));
  assert.ok(!/adult reference ranges/i.test(r.text));
});
