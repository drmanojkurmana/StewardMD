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

// ── T58: persona modes keep their voice ──
const HTN = { heading: "Hypertension > Treatment", page: "p.1", chunk: 1, text: "Amlodipine 5 to 10 mg once daily is a first-line drug for hypertension. Thiazide diuretics are an alternative." };
const BOOK = { search: () => [[12.5, 0]], cite: () => Object.assign({}, HTN), idfOf: () => 5, us: (w) => w };
test("T58: a tutor turn is never replaced by a passage or given a Source line; an unsupported dose line still goes", async () => {
  const tutor = "Good question. Think about what the drug does to the arteriole.\nWhy might a calcium channel blocker cause ankle swelling?\nSome give amlodipine 40 mg daily.";
  const e = engine({ book: BOOK, text: tutor });
  const r = await e.L.answer({ question: "why does amlodipine cause oedema in hypertension treatment" }, { pack: "maik-lite", mode: "clinix-tutor" }, null);
  assert.equal(e.calls.generate.length, 1, "no regenerate for a persona turn");
  assert.doesNotMatch(r.text, /reference passage|Source:/);
  assert.match(r.text, /Think about what the drug does to the arteriole\./);
  assert.match(r.text, /ankle swelling\?/);
  assert.doesNotMatch(r.text, /40 mg/, "an unsupported dose is removed even in teaching mode");
  assert.equal(r.checked, true);
  // The ordinary (non-persona) path still falls back as before.
  const plain = engine({ book: BOOK, text: "- Warfarin is the drug of choice." });
  const rp = await plain.L.answer({ question: "treatment of hypertension" }, { pack: "maik-lite" }, null);
  assert.match(rp.text, /reference passage on this topic instead/);
});

// ── T23: Balanced follows the evidence; curated disease grounding joins it ──
const CURATED_PKG = () => ({ question: "treatment of hypertension", topicMatch: { matched: true, topic: "Hypertension", grounded: "Hypertension" },
  grounding: [{ name: "Hypertension", diseaseId: "HTN", knowledge: [{ section: "management", text: "Start with lifestyle change. Thiazide-like diuretics such as chlorthalidone 12.5 to 25 mg once daily, ACE inhibitors or calcium channel blockers are first-line agents for most adults with hypertension." }] }] });
test("T23: the router's curated disease text joins the book passages inside the same passage budget", async () => {
  const e = engine({ book: BOOK });
  await e.L.answer(CURATED_PKG(), { pack: "maik-lite" }, null);
  const p = e.calls.generate[0].prompt;
  assert.match(p, /\[1\] \(Hypertension > Treatment\) Amlodipine/);
  assert.match(p, /\[2\] \(StewardMD Knowledge Base > Hypertension\) Start with lifestyle change\. Thiazide-like diuretics such as chlorthalidone/);
  assert.doesNotMatch(p, /\[4\]/, "never more than TOPK passages");
  const sys = e.calls.generate[0].system;
  assert.match(sys, /cover it as fully as the reference material supports/);
  assert.doesNotMatch(sys, /200 to 350 words/);
});
test("T23: curated text alone grounds the answer when the book has nothing; the claim check uses it", async () => {
  const e = engine({ text: "Chlorthalidone 12.5 to 25 mg once daily is a first-line agent.\nVerify against local protocol." });
  const r = await e.L.answer(CURATED_PKG(), { pack: "maik-lite" }, null);
  assert.equal(r.grounded, true);
  assert.match(r.text, /Chlorthalidone \*\*12\.5 to 25 mg\*\* once daily is a first-line agent\. \[1\]/);
  const none = engine();
  const r2 = await none.L.answer({ question: "treatment of hypertension", grounding: CURATED_PKG().grounding }, { pack: "maik-lite" }, null);
  assert.equal(r2.grounded, false, "no router verdict: the curated text is not used");
});
test("T23: an ungrounded Balanced answer keeps the 200 to 350 word guidance", async () => {
  const e = engine();
  await e.L.answer({ question: "treatment of hypertension" }, { pack: "maik-lite" }, null);
  assert.match(e.calls.generate[0].system, /about 200 to 350 words/);
});

// ── T24: a thread's prompt prefix is byte-stable ──
test("T24: the system prompt differs between a treatment and a definition question only at its END", async () => {
  const e = engine();
  await e.L.answer({ question: "treatment of hypertension", doctor: "Speciality: Medicine" }, { pack: "maik-mxcore" }, null);
  await e.L.answer({ question: "what is IRIS", doctor: "Speciality: Medicine" }, { pack: "maik-mxcore" }, null);
  const [a, b] = e.calls.generate.map((c) => c.system);
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  assert.ok(a.slice(i).split("\n").length <= 1 && b.slice(i).split("\n").length <= 1, "only the last line differs");
  assert.match(a.slice(0, i), /ABOUT THE CLINICIAN .*\n.*LENGTH: BALANCED/);
  assert.match(a, /first-line regimen[^\n]*$/);
  assert.match(b, /Answer the question that was asked[^\n]*$/);
});
test("T24: a past turn renders identically whether or not it is the latest", () => {
  const e = engine();
  const long = "Amlodipine is first line.\n- Amlodipine 5 mg daily\n- " + "Losartan 50 mg daily as an alternative for patients who cannot take a calcium channel blocker. ".repeat(3);
  const t1 = [{ q: "treatment of hypertension", a: long }];
  const t2 = t1.concat([{ q: "hypertension losartan side effects", a: "Hyperkalaemia and a rise in creatinine." }]);
  const p1 = e.L.buildPrompt({ question: "hypertension amlodipine dose", history: t1 }, "maik-mxcore");
  const p2 = e.L.buildPrompt({ question: "hypertension losartan dose", history: t2 }, "maik-mxcore");
  const turn1 = p1.split("\n").find((l) => l.startsWith("MaiK: "));
  assert.ok(p2.includes(turn1), "the first answer keeps its bytes when a newer turn follows it");
});

// ── T62: the web prompt asks for what the web gate checks ──
test("T62: WEB_SYS no longer tells the model to go beyond the snippets for specifics", () => {
  const W = engine().L.WEB_SYS;
  assert.doesNotMatch(W, /limit yourself to what they happen to mention/);
  assert.match(W, /take every specific - every figure, dose, duration and drug name - from the numbered WEB RESULTS/);
  assert.match(W, /Use solid, widely-accepted medical knowledge to explain/);
});
