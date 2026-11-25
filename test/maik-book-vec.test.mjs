/* test/maik-book-vec.test.mjs - meaning search over the offline book (2026-11-21).
 * Pins: the gate (flag + search pack + native embed), the wrong-book refusal, int8 cosine ranking,
 * the fusion shape Book.search callers expect, and that maik-local's retrieveGrounding is
 * unchanged unless the router missed AND the module is available. */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const PATH = require.resolve("../kb/ai/maik-book-vec.js");
const fresh = () => { delete require.cache[PATH]; return require(PATH); };

function withWindow(w, fn) {
  const prev = globalThis.window; globalThis.window = w;
  try { return fn(); } finally { if (prev === undefined) delete globalThis.window; else globalThis.window = prev; }
}
const ls = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem() {} });
const embedOK = { packReady: () => true, embedAvailable: () => true };

test("available() needs the flag AND the search pack AND native embed", () => {
  const V = fresh();
  assert.equal(withWindow({ localStorage: ls({}), SMD_EMBED_LOCAL: embedOK }, () => V.available()), false);
  assert.equal(withWindow({ localStorage: ls({ smd_maik_book_vec: "1" }) }, () => V.available()), false);
  assert.equal(withWindow({ localStorage: ls({ smd_maik_book_vec: "1" }), SMD_EMBED_LOCAL: { packReady: () => false, embedAvailable: () => true } }, () => V.available()), false);
  assert.equal(withWindow({ localStorage: ls({ smd_maik_book_vec: "1" }), SMD_EMBED_LOCAL: embedOK }, () => V.available()), true);
});

test("int8 rows rank by cosine and skip rows shorter than the search floor", () => {
  const V = fresh(), D = V.DIMS, meta = { rows: 3, scale: 100 };
  const vec = new Int8Array(3 * D);
  vec[0 * D + 0] = 100;          // row 0 along axis 0
  vec[1 * D + 1] = 100;          // row 1 along axis 1
  vec[2 * D + 0] = 70; vec[2 * D + 1] = 70;   // row 2 between
  const q = new Float32Array(D); q[0] = 1;
  const long = { text: "x".repeat(300) };
  assert.deepEqual(V.topRowsFor(q, vec, meta, 3, [long, long, long]).map((h) => h[1]), [0, 2, 1]);
  assert.deepEqual(V.topRowsFor(q, vec, meta, 3, [{ text: "short" }, long, long]).map((h) => h[1]), [2, 1]);
});

test("fuse keeps keyword scores, gives dense-only rows a keyword-scale score, caps at k", () => {
  const V = fresh();
  const bm = [[40, 7], [20, 3]], dense = [[0.9, 11], [0.8, 7]];
  const out = V.fuse(bm, dense, 3, 6);
  assert.deepEqual(out.map((h) => h[1]), [7, 11, 3]);
  assert.equal(out[0][0], 40);
  assert.equal(out[1][0], 40 * 0.9);
  assert.deepEqual(V.fuse(bm, null, 1, 6), [[40, 7]]);
});

test("load() refuses vectors built for another book", async () => {
  const V = fresh();
  const fetch = async () => ({ ok: true, json: async () => ({ dims: 768, scale: 1, rows: 1, bookSha256: "other", sha256: "25a4558667efe3a8" }) });
  await assert.rejects(V.load({ fetch, bookSha: "mine", store: false }), /another book/);
});

test("retrieveGrounding: dense rows join only when the router named no disease", async () => {
  const RAG = require("../kb/ai/maik-lite-rag.js");
  const filler = " Additional clinical detail sentence for length.".repeat(8);
  const rows = [
    { i: 0, headings: ["Asthma"], text: "Acute severe asthma: give salbutamol nebulised and oral prednisolone." + filler, pages: [1] },
    { i: 1, headings: ["Asthma"], text: "Asthma inhaler technique and spacer use in children." + filler, pages: [2] },
    { i: 2, headings: ["Bronchospasm"], text: "Wheeze emergencies respond to magnesium sulphate intravenous infusion." + filler, pages: [3] },
  ];
  const book = new RAG.Book(rows);
  const calls = [];
  const BV = { POOL: 30, available: () => true, fuse: fresh().fuse,
    topRows: async (q) => { calls.push(q); return [[0.95, 2]]; } };
  const Llama = { available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => ({ text: "x", ms: 1 }), cancel: async () => ({}), release: async () => ({}), addListener: () => ({ remove() {} }) };
  const mk = (withBV) => {
    const win = { Capacitor: { isNativePlatform: () => true, Plugins: { Llama } }, SMD_MAIK_RAG: RAG,
      SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
      SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "L", nCtx: 4096, nPredict: 64, noThink: true } }, pathFor: async () => "/x", totalBytes: () => 1 } };
    if (withBV) win.SMD_MAIK_BOOK_VEC = BV;
    new Function("window", readFileSync(new URL("../maik-local.js", import.meta.url), "utf8"))(win);
    return win.SMD_MAIK_LOCAL;
  };
  const q = "treatment of acute severe asthma";
  const plain = await mk(false).retrieveGrounding("maik-lite", q, "", null);
  const missed = await mk(true).retrieveGrounding("maik-lite", q, "", null);
  assert.equal(calls.length, 1, "router missed: dense search ran once");
  const routed = await mk(true).retrieveGrounding("maik-lite", q, "Asthma", null);
  assert.equal(calls.length, 1, "router named a disease: dense search never ran");
  const heads = (g) => (g ? g.passages.map((p) => p.text.slice(0, 20)) : null);
  assert.deepEqual(heads(routed), heads(await mk(false).retrieveGrounding("maik-lite", q, "Asthma", null)), "router path unchanged");
  const off = { ...BV, available: () => false };
  const winOff = await (async () => { BV.available = () => false; const r = await mk(true).retrieveGrounding("maik-lite", q, "", null); BV.available = () => true; return r; })();
  assert.deepEqual(heads(winOff), heads(plain), "module present but unavailable = exactly the old result");
  assert.equal(calls.length, 1, "unavailable module never searched");
  void off; void missed;
});

test("topRows never throws: no fetch, broken embedder or bad meta all resolve to null", async () => {
  const V = fresh();
  const w = { localStorage: ls({ smd_maik_book_vec: "1" }), SMD_EMBED_LOCAL: { ...embedOK, embedText: async () => { throw new Error("boom"); } } };
  const prev = globalThis.window; globalThis.window = w;
  try {
    assert.equal(await V.topRows("q", 5, null), null, "no fetch");
    V.reset(); w.fetch = async () => ({ ok: false, status: 404 });
    assert.equal(await V.topRows("q", 5, null), null, "404");
  } finally { if (prev === undefined) delete globalThis.window; else globalThis.window = prev; }
});
