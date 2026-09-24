/* test/maik-offline-b.test.mjs - offline MaiK quality, speed and battery fixes (audit group B,
 * 2026-09-25). One section per item; each names the audit id it pins. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

/** A maik-local harness. ls: localStorage values; nav: navigator; models: overrides for SMD_MAIK_MODELS. */
function engine({ ls = {}, nav = {}, models = {}, text = "Answer. Verify against local protocol.", book = null, loaded = true, extra = {} } = {}) {
  const calls = { generate: [], ensure: [], load: [], listeners: {} };
  const Llama = {
    available: async () => ({ available: true, loaded }), load: async (o) => { calls.load.push(o); loaded = true; return { loaded: true }; },
    generate: async (o) => { calls.generate.push(o); return { text: typeof text === "function" ? text(o) : text, ms: 5 }; },
    cancel: async () => ({}), release: async () => { loaded = false; return { released: true }; },
    addListener: (name, cb) => { (calls.listeners[name] = calls.listeners[name] || []).push(cb); return { remove: () => {} }; }
  };
  const store = Object.assign({}, ls);
  const win = Object.assign({
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_DRUG_LEXICON: require("../drug-lexicon.js"),
    SMD_MAIK_KB_STORE: book ? { loadBook: () => Promise.resolve(book) } : undefined,
    SMD_MAIK_MODELS: Object.assign({
      PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true }, "maik-mxcore": { label: "MAiK MxCore", nCtx: 4096, nPredict: 512 } },
      caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9,
      hasDraft: () => true, draftIdOf: (id) => id + "#draft", installedCached: () => false,
      ensure: (id) => { calls.ensure.push(id); return Promise.resolve(); }
    }, models),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
  }, extra);
  new Function("window", "localStorage", "navigator", SRC)(win, win.localStorage, nav);
  return { L: win.SMD_MAIK_LOCAL, calls, win, store, Llama };
}

// ── T26: speculative drafts ──
test("T26: a draft over 15% of its target is off; MxCore and Neural keep theirs", () => {
  const M = require("../maik-models.js");
  for (const id of ["bonsai-8b", "bonsai-ternary-8b", "maik-apex"]) assert.equal(M.hasDraft(id), false, id);
  for (const id of ["maik-mxcore", "maik-neural"]) assert.equal(M.hasDraft(id), true, id);
  assert.ok(M.PACKS["maik-mxcore"].draft.bytes / M.totalBytes("maik-mxcore") < 0.15);
});

test("T26: the draft download is opt-in and never on a metered connection", async () => {
  const off = engine({ loaded: false });
  await off.L.answer({ question: "hi" }, { pack: "maik-mxcore" }, null);
  assert.deepEqual(off.calls.ensure, [], "default: no silent 290 MB download");
  const on = engine({ loaded: false, ls: { smd_maik_draft: "1" } });
  await on.L.answer({ question: "hi" }, { pack: "maik-mxcore" }, null);
  assert.deepEqual(on.calls.ensure, ["maik-mxcore#draft"], "opted in on an unmetered link: queued once");
  const cell = engine({ loaded: false, ls: { smd_maik_draft: "1" }, nav: { connection: { type: "cellular" } } });
  await cell.L.answer({ question: "hi" }, { pack: "maik-mxcore" }, null);
  assert.deepEqual(cell.calls.ensure, [], "cellular: never");
  const save = engine({ loaded: false, ls: { smd_maik_draft: "1" }, nav: { connection: { saveData: true } } });
  await save.L.answer({ question: "hi" }, { pack: "maik-mxcore" }, null);
  assert.deepEqual(save.calls.ensure, [], "Save-Data: never");
});
