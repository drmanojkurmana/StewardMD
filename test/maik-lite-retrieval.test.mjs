/* MaiK Lite retrieval: scaffolding words are not the topic, and a treatment question prefers the
 * passage that talks treatment (2026-09-26, measured by scripts/bench-maik-lite-retrieval.mjs on the
 * real 42,176-row book: key points in the evidence 46.9% -> 48.9%, questions grounded on passages
 * with no key point 9 -> 7). The real book is not in the repo, so these pin the behaviour on a tiny
 * corpus with the production code and a lowered score floor (as test/maik-local.test.mjs does). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const RAGm = require("../kb/ai/maik-lite-rag.js");

function load(rows) {
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama: {} } },
    SMD_MAIK_RAG: Object.assign({}, RAGm, { MIN_SCORE: 0.5 }),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(new RAGm.Book(rows)) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } } },
  };
  new Function("window", SRC)(win);
  return win.SMD_MAIK_LOCAL;
}

test('"adults" is not the topic: an asthma question is not grounded on a cachexia-in-adults passage', async () => {
  const rows = [
    { i: 0, headings: ["Asthma", "Treatment of acute severe asthma"], pages: [1],
      text: "Acute severe asthma is treated with nebulised salbutamol and ipratropium, systemic corticosteroids and controlled oxygen; intravenous magnesium is given when the response is poor. ".repeat(3) },
    { i: 1, headings: ["Cachexia", "Diagnostic Criteria for Cachexia in Adults"], pages: [2],
      text: "Diagnostic criteria for cachexia in adults include weight loss of more than five percent, reduced muscle strength, fatigue and anorexia in chronic illness. ".repeat(3) },
  ];
  const g = await load(rows).retrieveGrounding("maik-lite", "treatment of asthma in adults", "", null);
  assert.ok(g, "grounded");
  assert.ok(g.passages.every((p) => !/cachexia/i.test(p.heading)), JSON.stringify(g.passages.map((p) => p.heading)));
  assert.ok(!g.anchors.includes("adults"), JSON.stringify(g.anchors));
});

test("a treatment question ranks the passage that talks treatment above an equal one that does not", () => {
  const L = load([{ i: 0, headings: ["x"], pages: [1], text: "x" }]);
  const cite = (heading, text) => ({ score: 10, p: { heading, text }, hay: (heading + " " + text).toLowerCase() });
  const pool = [
    cite("Status epilepticus", "status epilepticus is continuous seizure activity lasting longer than five minutes, a neurological emergency"),
    cite("Status epilepticus", "status epilepticus treatment: lorazepam 4 mg IV, then levetiracetam or fosphenytoin; the first-line regimen"),
  ];
  const kept = L.rerankPassages(pool, { anchors: ["epilepticus"], expansion: [], mods: [], treat: true, topk: 3 });
  assert.match(kept[0].p.text, /lorazepam/);
  const asked = L.rerankPassages(pool.map((c) => ({ ...c })), { anchors: ["epilepticus"], expansion: [], mods: [], treat: false, topk: 3 });
  assert.equal(asked[0].rank, asked[1].rank, "a non-treatment question does not get the boost");
});

// The router's package as buildPackage() makes it for "STEMI management": the matched disease, its
// knowledge pearls, and its curated regimen (pkg.treatment), trimmed to what curatedPassages reads.
const PEARLS = [
  { text: "ACS encompasses unstable angina, NSTEMI, and STEMI, and the term is generally reserved for patients with acute myocardial ischemia." },
  { text: "An ECG is recommended within 10 minutes of presentation, primarily to identify ST-segment elevation that needs immediate reperfusion." },
];
const REGIMEN = { diseaseId: "acs", default: {
  regimenLabel: "Dual antiplatelet + anticoagulation + reperfusion & secondary prevention",
  steps: ["Aspirin 300 mg + a second antiplatelet (ticagrelor/clopidogrel); analgesia, oxygen only if hypoxic.",
    "STEMI: primary PCI (or thrombolysis if PCI unavailable), time-critical."],
  dosing: [{ drug: "aspirin", dose: "300 mg loading, then 75 mg maintenance", route: "PO", freq: "once daily" }] } };
const pkgFor = (question, treatment) => ({ question, topicMatch: { matched: true, grounded: "Acute coronary syndrome" },
  grounding: [{ diseaseId: "acs", name: "Acute coronary syndrome", knowledge: PEARLS }], treatment });

test("a treatment question's curated passage is the StewardMD regimen, ahead of the pearls", () => {
  const L = load([{ i: 0, headings: ["x"], pages: [1], text: "x" }]);
  const cur = L.curatedPassages(pkgFor("acute STEMI management in the first hour", REGIMEN));
  assert.match(cur[0].heading, /Acute coronary syndrome > Management$/);
  assert.match(cur[0].text, /Aspirin 300 mg/);
  assert.match(cur[0].text, /primary PCI/);
  assert.match(cur[0].text, /aspirin 300 mg loading, then 75 mg maintenance PO, once daily/);
  assert.ok(cur[0].text.length <= 700);
  assert.match(cur[1].text, /encompasses unstable angina/, "the pearls follow");
});

test("a question that is not about treatment keeps the pearls; another disease's regimen is never used", () => {
  const L = load([{ i: 0, headings: ["x"], pages: [1], text: "x" }]);
  assert.match(L.curatedPassages(pkgFor("what is acute coronary syndrome", REGIMEN))[0].text, /encompasses unstable angina/);
  const other = { ...REGIMEN, diseaseId: "pulmonary_embolism" };
  assert.match(L.curatedPassages(pkgFor("acute STEMI management", other))[0].text, /encompasses unstable angina/);
  assert.match(L.curatedPassages(pkgFor("acute STEMI management", undefined))[0].text, /encompasses unstable angina/);
});
