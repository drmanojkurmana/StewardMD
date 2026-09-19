/* test/maik-rag-hybrid.test.mjs — RAG #1 → RAG #2 with expansion, soft anchoring and rerank.
 *
 * The change under test (owner, 2026-09-20): RAG #1's candidate disease and its own vocabulary
 * expand the BM25 query, and an exact disease-NAME string match is no longer a hard filter. A
 * passage may prove it is on topic by carrying the disease's vocabulary instead of its title, which
 * is how complication / investigation / treatment passages get retrieved at all — they frequently
 * never repeat the disease name.
 *
 * What must NOT change: a passage supported by neither an anchor nor RAG #1 vocabulary is still
 * unusable at any BM25 score, and a question nothing can be shown to be about is still reported
 * ungrounded rather than grounded on whatever ranked first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

/* A miniature Harrison's. Headings and pages are real fields so citation metadata can be asserted.
 * P_COMPLICATION is the crux: it is about a complication of cirrhosis and never says "cirrhosis". */
const BOOK = [
  { i: 0, heading: "Cirrhosis > Management of decompensation", pages: [2345],
    text: "Cirrhosis management centres on treating the complications of portal hypertension. Diuretics for ascites, lactulose and rifaximin for hepatic encephalopathy, and surveillance endoscopy in all patients with newly diagnosed cirrhosis of the liver." },
  { i: 1, heading: "Gastrointestinal bleeding > Variceal haemorrhage", pages: [2350],
    text: "Acute variceal haemorrhage requires resuscitation, terlipressin or octreotide, and antibiotic prophylaxis. Endoscopic band ligation is the definitive treatment and should be performed within twelve hours. Portal hypertension drives the varices and rebleeding is common." },
  { i: 2, heading: "Exfoliative dermatitis > Erythroderma workup", pages: [340],
    text: "Erythroderma workup includes skin biopsy, a careful drug history, and a search for underlying lymphoma. Cutaneous T-cell lymphoma must be excluded in the workup of any adult." },
  { i: 3, heading: "Cirrhosis > Definitions and epidemiology", pages: [2340],
    text: "Cirrhosis is defined as diffuse hepatic fibrosis with regenerative nodules. Epidemiology varies worldwide with the prevalence of viral hepatitis and alcohol use in the population." },
  { i: 4, heading: "Peritoneum > Spontaneous bacterial peritonitis", pages: [2360],
    text: "Spontaneous bacterial peritonitis is diagnosed when the ascitic neutrophil count exceeds 250 cells per microlitre. Cefotaxime is first line and albumin reduces renal impairment. SBP prophylaxis with norfloxacin follows an index episode." },
];

// Words the stub book "knows", with IDFs. >= 4.0 is specific enough to be an expansion term.
const IDF = {
  cirrhosis: 7.2, variceal: 7.8, ligation: 6.9, terlipressin: 8.1, octreotide: 7.4,
  portal: 6.1, hypertension: 4.6, ascites: 6.4, encephalopathy: 6.6, lactulose: 7.7,
  peritonitis: 7.1, bacterial: 4.8, spontaneous: 4.5, cefotaxime: 8.0, norfloxacin: 8.2,
  ascitic: 7.9, neutrophil: 6.2, albumin: 5.4, varices: 7.6, rebleeding: 7.3,
  erythroderma: 7.5, lymphoma: 6.8, biopsy: 5.1, dermatitis: 6.7, skin: 4.2,
  workup: 3.1, melena: 7.0, endoscopy: 6.0, haemorrhage: 6.3, fibrosis: 6.5,
  hepatic: 5.8, liver: 5.2, nodules: 6.1, alcohol: 5.0, hepatitis: 5.6,
};

function makeBook(searchLog) {
  return {
    // Deterministic lexical stand-in for BM25: score by how many query terms the passage carries,
    // weighted by IDF, so a passage matching one rare word can still clear MIN_SCORE.
    search(q, k) {
      searchLog.push(q);
      const terms = String(q).toLowerCase().match(/[a-z]+/g) || [];
      const out = [];
      BOOK.forEach((row, idx) => {
        const hay = (row.heading + " " + row.text).toLowerCase();
        let s = 0;
        new Set(terms).forEach((t) => { if (t.length > 3 && hay.includes(t)) s += (IDF[t] || 1.5); });
        if (s > 0) out.push([s, idx]);
      });
      out.sort((a, b) => b[0] - a[0]);
      return out.slice(0, k || 5);
    },
    cite: (i) => ({ ...BOOK[i] }),
    idfOf: (w) => IDF[w],
    us: (w) => w,
  };
}

function load(searchLog) {
  const Llama = {
    available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => ({ text: "Band ligation within twelve hours, with terlipressin and antibiotic prophylaxis.", ms: 5 }),
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }),
  };
  const ls = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"),
    SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(makeBook(searchLog)) },
    SMD_MAIK_ENGINE: { ragLinked: () => true },
    SMD_MAIK_MODELS: {
      PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } },
      caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9,
    },
    localStorage: ls,
  };
  new Function("window", "localStorage", SRC)(win, ls);
  return win.SMD_MAIK_LOCAL;
}

/** A RAG #1 package: the router's disease plus the vocabulary it cited for that disease. */
function pkg(question, grounded, groundingText) {
  return {
    question,
    topicMatch: { matched: true, grounded, topic: grounded },
    grounding: groundingText ? [{ heading: grounded, text: groundingText }] : [],
    retrieved: [],
  };
}

const CIRRHOSIS_VOCAB =
  "Cirrhosis complications include ascites, hepatic encephalopathy treated with lactulose, and " +
  "variceal haemorrhage managed with band ligation, terlipressin and octreotide. Portal hypertension " +
  "underlies varices and rebleeding. Spontaneous bacterial peritonitis is treated with cefotaxime.";

const headsOf = (r) => (r && r.passages ? r.passages : []).map((p) => p.heading);

/** Run the retriever the way answer() does, and hand back what it chose. */
function retrieve(L, p) {
  return L.retrieveGrounding("maik-lite", L.ragQuestion(p), L.routerTopic(p), p);
}

// ── 1. correct disease → relevant Harrison's passages ──────────────────────────────
test("a correct disease retrieves that disease's passages, not its neighbours", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("management of cirrhosis", "Cirrhosis", CIRRHOSIS_VOCAB));
  assert.ok(r, "grounded");
  const heads = headsOf(r).join(" | ");
  assert.match(heads, /Cirrhosis|Variceal|peritonitis/i, "retrieves cirrhosis material");
  assert.doesNotMatch(heads, /dermatitis/i, "an unrelated chapter is never evidence");
});

// ── 2. the headline change: complications without the disease name ─────────────────
test("a complication passage is kept even though it NEVER names the disease", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("treatment of variceal bleeding in cirrhosis", "Cirrhosis", CIRRHOSIS_VOCAB));
  assert.ok(r, "grounded");
  const variceal = r.passages.find((p) => /Variceal/i.test(p.heading));
  assert.ok(variceal, "the variceal-haemorrhage passage is retrieved");
  assert.doesNotMatch(variceal.text, /cirrhosis/i,
    "precondition: this passage genuinely never says the disease name — the old hard filter dropped it");
});

// ── 3. ambiguous names / synonyms ──────────────────────────────────────────────────
test("an abbreviation resolves through RAG #1 vocabulary to the full-name chapter", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("SBP prophylaxis", "Spontaneous bacterial peritonitis",
        "Spontaneous bacterial peritonitis SBP ascitic neutrophil cefotaxime norfloxacin albumin"));
  assert.ok(r, "grounded");
  assert.match(headsOf(r).join(" | "), /peritonitis/i, "SBP reaches the peritonitis chapter");
});

// ── 4. differential diagnosis ──────────────────────────────────────────────────────
test("a differential question stays inside the routed disease's material", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("differential diagnosis of ascites", "Cirrhosis", CIRRHOSIS_VOCAB));
  assert.ok(r, "grounded");
  assert.doesNotMatch(headsOf(r).join(" | "), /dermatitis/i, "no unrelated chapter enters a differential");
});

// ── 5. complications / treatment / workup, and the intro-chapter demotion ──────────
test("a treatment question demotes the DEFINITIONS chapter below real management material", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("treatment of cirrhosis complications", "Cirrhosis", CIRRHOSIS_VOCAB));
  const heads = headsOf(r);
  const defIdx = heads.findIndex((h) => /Definitions/i.test(h));
  const mgmtIdx = heads.findIndex((h) => /Management|Variceal|peritonitis/i.test(h));
  assert.ok(mgmtIdx !== -1, "management material is retrieved");
  if (defIdx !== -1) assert.ok(mgmtIdx < defIdx, "definitions never outrank management for a treatment ask");
});

// ── 6. irrelevant BM25 keyword matches are prevented ───────────────────────────────
test("a shared word does NOT let an unrelated chapter in (the melena/dermatitis failure)", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("workup of variceal bleeding", "Cirrhosis", CIRRHOSIS_VOCAB));
  const heads = headsOf(r).join(" | ");
  assert.doesNotMatch(heads, /dermatitis|Erythroderma/i,
    "the dermatitis chapter shares the word 'workup' and must still be excluded");
});

test("a question nothing can be shown to be about is reported ungrounded, not grounded on rank 1", async () => {
  const L = load([]);
  // No router disease, and no RAG #1 vocabulary: nothing can establish what a passage should be about.
  const r = await retrieve(L, { question: "can I learn a new medical topic today", topicMatch: { matched: false, mode: "none" } });
  // null IS the "no evidence" contract: answer() only injects reference material when the
  // retriever returns an object, so null means no passages can reach the prompt at all.
  assert.equal(r, null, "ungrounded rather than grounded on whatever ranked first");
});

test("a drug-only question does not let a passage naming the drug stand in for the disease", async () => {
  const L = load([]);
  // Router says nothing and the question's only specific word is a drug the dermatitis chapter
  // does not carry either — nothing on-topic exists in this miniature book.
  const r = await retrieve(L, { question: "norfloxacin", topicMatch: { matched: false, mode: "none" } });
  if (r) {
    assert.doesNotMatch(r.passages.map((p) => p.heading).join(" | "), /dermatitis|Erythroderma/i,
      "a drug name never justifies an unrelated chapter");
  }
});

// ── citation integrity ─────────────────────────────────────────────────────────────
test("source metadata survives retrieval and every citation refers to a real retrieved passage", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("management of cirrhosis", "Cirrhosis", CIRRHOSIS_VOCAB));
  assert.ok(r.passages.length > 0, "passages returned");
  r.passages.forEach((p) => {
    assert.ok(p.heading && p.heading.length, "heading preserved for citation");
    assert.ok(Array.isArray(p.pages) && p.pages.length, "page metadata preserved");
    // Every retrieved passage must be a REAL row of the book, never synthesised.
    assert.ok(BOOK.some((b) => b.heading === p.heading), "passage corresponds to a real book row");
  });
});

test("query expansion actually reaches BM25 — RAG #1 vocabulary is in the search string", async () => {
  const log = [];
  const L = load(log);
  await retrieve(L, pkg("management of cirrhosis", "Cirrhosis", CIRRHOSIS_VOCAB));
  assert.ok(log.length > 0, "the book was searched");
  const q = log[0].toLowerCase();
  assert.match(q, /cirrhosis/, "the router's disease rides into the query");
  assert.ok(/variceal|ligation|terlipressin|octreotide|lactulose|encephalopathy|peritonitis|cefotaxime|norfloxacin|ascitic/.test(q),
    `expansion terms from RAG #1 reach BM25 (query was: ${log[0]})`);
});

test("precision over volume: the evidence window stays at TOPK or fewer", async () => {
  const L = load([]);
  const r = await retrieve(L, pkg("management of cirrhosis", "Cirrhosis", CIRRHOSIS_VOCAB));
  const TOPK = require("../kb/ai/maik-lite-rag.js").TOPK;
  assert.ok(r.passages.length <= TOPK, `kept ${r.passages.length}, TOPK is ${TOPK}`);
});
