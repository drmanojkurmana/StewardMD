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
