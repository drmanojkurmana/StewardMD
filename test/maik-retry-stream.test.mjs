/* test/maik-retry-stream.test.mjs - on-device answer retries and the live stream (audit T56, T57).
 *
 * T57: a retry recursed into answer() with the first attempt's token listener still attached, so the
 * screen alternated between the two attempts; the regenerate retrieved again from a package already
 * stripped of its grounding; the blank-answer retry was always ungrounded. Retries now detach the
 * first attempt and reuse its evidence, so every retry is claim-checked.
 * T56: while streaming, complete lines are claim-checked and shown in their checked form (or not at
 * all); only the line being written is shown raw. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** attempts: one array of streamed pieces per generate() call. A piece "|" means "pause 80 ms"
 *  (longer than the 66 ms paint interval), so the screen state between pieces can be observed. */
function engine(attempts) {
  const calls = { generate: [], search: 0 };
  const listeners = new Set();
  let n = 0;
  const Llama = {
    available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async (o) => {
      calls.generate.push(o);
      const pieces = attempts[Math.min(n++, attempts.length - 1)];
      let full = "";
      for (const p of pieces) {
        if (p === "|") { await sleep(80); continue; }
        full += p;
        for (const l of [...listeners]) l({ text: p });
      }
      return { text: full, ms: 5 };
    },
    cancel: async () => ({}), release: async () => ({ released: true }),
    addListener: (name, cb) => { if (name !== "llamaToken") return { remove: () => {} }; listeners.add(cb); return { remove: () => listeners.delete(cb) }; }
  };
  const passage = { heading: "Hypertension > Treatment", page: "p.1", chunk: 1,
    text: "Amlodipine 5 to 10 mg once daily is a first-line drug for hypertension. Thiazide diuretics are an alternative." };
  const book = { search: () => { calls.search++; return [[12.5, 0]]; }, cite: () => Object.assign({}, passage), idfOf: () => 5, us: (w) => w };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_DRUG_LEXICON: require("../drug-lexicon.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return { L: win.SMD_MAIK_LOCAL, calls, listeners };
}
const Q = { question: "treatment of hypertension" };
const GOOD = ["Amlodipine 5 to 10 mg once daily is first line for hypertension.", "\n", "Verify against local protocol."];

test("T57: a no-coverage retry detaches the first attempt; its text never reappears on screen", async () => {
  const e = engine([["The treatment is not addressed in the provided reference material.", "|"], ["Amlodipine", "|", " is used for hypertension."]]);
  const seen = [];
  const r = await e.L.answer(Q, { pack: "maik-lite" }, (t) => seen.push(t));
  const firstRetryPaint = seen.findIndex((t) => /^Amlodipine/.test(t));
  assert.ok(firstRetryPaint > 0, "the retry streamed");
  assert.ok(seen.slice(firstRetryPaint).every((t) => !/not addressed/.test(t)), "no paint after the retry started mixes in the first attempt: " + JSON.stringify(seen));
  assert.equal(e.listeners.size, 0, "every listener is removed at the end");
  assert.equal(r.grounded, false, "the no-coverage retry is deliberately ungrounded");
});

test("T57: the regenerate reuses the first attempt's passages (no second retrieval) and is claim-checked", async () => {
  const e = engine([["- Warfarin is the drug of choice.", "\n", "Verify against local protocol."], GOOD]);
  const r = await e.L.answer(Q, { pack: "maik-lite" }, () => {});
  assert.equal(e.calls.generate.length, 2, "one regenerate");
  assert.equal(e.calls.search, 1, "retrieval ran once; the regenerate did not search a stripped package");
  assert.match(e.calls.generate[1].prompt, /Reference material from the StewardMD Knowledge Base:\n\[1\]/);
  assert.match(e.calls.generate[1].prompt, /State only the drugs, doses and figures that appear in the reference material/);
  assert.equal(r.checked, true);
  assert.match(r.text, /\[1\]/);
  assert.match(r.text, /Source: StewardMD Knowledge Base/);
});

test("T57: the blank-answer retry is grounded and checked, not a bare ungrounded answer", async () => {
  const e = engine([["<think>deliberating"], GOOD]);
  const r = await e.L.answer(Q, { pack: "maik-lite" }, () => {});
  assert.equal(e.calls.generate.length, 2);
  assert.equal(e.calls.search, 1);
  assert.match(e.calls.generate[1].prompt, /Reference material from the StewardMD Knowledge Base/);
  assert.match(e.calls.generate[1].prompt, /no deliberation/);
  assert.equal(r.grounded, true);
  assert.equal(r.checked, true);
  assert.match(r.text, /Source: StewardMD Knowledge Base/);
});

test("T56: a completed line the check removes is never painted as settled; a supported line shows its [n]", async () => {
  const e = engine([["Amlodipine 5 to 10 mg once daily is first line for hypertension.", "|", "\n", "|", "- Warfarin", "|", " is added.", "|", "\n", "|", "Verify against local protocol.", "|"]]);
  const seen = [];
  await e.L.answer(Q, { pack: "maik-lite" }, (t) => seen.push(t));
  const afterWarfarinLine = seen.findIndex((t) => /Verify against/.test(t));
  assert.ok(afterWarfarinLine > 0);
  assert.ok(seen.slice(afterWarfarinLine).every((t) => !/Warfarin/.test(t)), "once its line is complete, the unsupported line is gone: " + JSON.stringify(seen));
  assert.ok(seen.some((t) => /^Amlodipine 5 to 10 mg once daily is first line for hypertension\. \[1\]/.test(t)), "a complete supported line is shown in its checked form");
  assert.ok(seen.some((t) => /- Warfarin$/.test(t)), "the line being written is shown raw at the end, where the caret is");
});

test("T56: an ungrounded answer streams exactly as before (accumulated text, no check)", async () => {
  const e = engine([["Hel", "|", "lo ", "|", "world"]]);
  const seen = [];
  await e.L.answer({ question: "hi" }, { pack: "maik-lite" }, (t) => seen.push(t));
  assert.deepEqual(seen, ["Hel", "Hello", "Hello world"]);
});
