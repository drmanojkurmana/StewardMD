/* test/maik-rag-router.test.mjs — two RAGs chained on device (owner, 2026-09-19: "use both").
 * The cloud package's topicMatch routes; the on-device BOOK supplies the passages. Pinned against the
 * live failure: "melena workup" grounded on a dermatitis chunk because it contained "workup". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

const DERM = { heading: "Exfoliative dermatitis > Erythroderma workup", page: "p.9", text: "Erythroderma workup: skin biopsy, drug history, and a search for underlying lymphoma. Cutaneous T-cell lymphoma must be excluded.", chunk: 0 };
const PUD = { heading: "Peptic ulcer disease > Upper GI bleeding", page: "p.3", text: "Upper GI bleeding presents with melena or hematemesis. Resuscitate, give IV pantoprazole 80 mg, and arrange endoscopy within 24 hours; a peptic ulcer is the commonest cause.", chunk: 1 };

function load(searched) {
  const Llama = { available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => ({ text: "Resuscitate, IV pantoprazole 80 mg, endoscopy within 24 hours.", ms: 5 }), cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }) };
  // BM25 stand-in: the dermatitis chunk outranks on the raw question (it contains "workup"); the PUD
  // chunk only scores when the router's disease words are in the query.
  const book = {
    search: (q) => { searched.push(q); return /peptic|ulcer|bleed/i.test(q) ? [[14, 1], [12, 0]] : [[12, 0]]; },
    cite: (i) => (i === 1 ? { ...PUD } : { ...DERM }), idfOf: () => 5, us: (w) => w
  };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return win.SMD_MAIK_LOCAL;
}

test("router topic from the cloud package: matched -> grounded name; assume -> nearest; none -> nothing", () => {
  const L = load([]);
  assert.equal(L.routerTopic({ topicMatch: { matched: true, grounded: "Peptic ulcer disease / upper GI bleed" } }), "Peptic ulcer disease / upper GI bleed");
  assert.equal(L.routerTopic({ topicMatch: { matched: false, mode: "assume", nearest: "Acute cholangitis", assume: { name: "Acute cholangitis" } } }), "Acute cholangitis");
  assert.equal(L.routerTopic({ topicMatch: { matched: false, mode: "none" } }), "");
  assert.deepEqual(L.routerToks("Peptic ulcer disease / upper GI bleed"), ["peptic", "ulcer", "bleed"]);
});

test("'melena workup' with the router saying upper GI bleed: the BOOK is searched for that disease and the dermatitis chunk is dropped", async () => {
  const searched = [];
  const L = load(searched);
  const r = await L.answer({ question: "melena workup", topicMatch: { matched: true, grounded: "Peptic ulcer disease / upper GI bleed" } }, { pack: "maik-lite" }, null);
  assert.match(searched[0], /melena workup peptic ulcer bleed/, "router words ride along in the book query");
  assert.equal(r.grounded, true);
  assert.doesNotMatch(r.text, /biopsy|lymphoma|Erythroderma/i, "the chunk that merely contains 'workup' is not the evidence");
  assert.match(r.text.replace(/\*\*/g, ""), /pantoprazole 80 mg/);
});

test("router says none: behaviour unchanged (the question's own anchors decide)", async () => {
  const searched = [];
  const L = load(searched);
  await L.answer({ question: "melena workup", topicMatch: { matched: false, mode: "none" } }, { pack: "maik-lite" }, null);
  assert.equal(searched[0], "melena workup");
});
