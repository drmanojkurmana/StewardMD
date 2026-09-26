/* MaiK Lite never talks to the doctor about its reference material either (owner, 2026-09-26: "why is
 * agent tell the passage yu sent is irrelavant?"). maik-local.js carries an ES5 copy of MaiK Cloud's
 * filter (functions/_maik_metatalk.js); this pins the copy to the original case by case, and pins where
 * answer() runs it: after the NO_COVERAGE check, so a "not covered" verdict still re-asks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scrubMetaTalk } from "../functions/_maik_metatalk.js";
import { DROPPED, REWRITTEN, KEPT } from "./fixtures/maik-metatalk-cases.mjs";

const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

// The fake-plugin harness of test/maik-local.test.mjs loadWithRag(): one canned pneumonia passage.
function load(reply) {
  const calls = { generate: [] };
  const Llama = {
    available: async () => ({ available: true, loaded: true }),
    load: async () => ({ loaded: true }),
    generate: async (o) => { calls.generate.push(o); return { text: reply, ms: 500 }; },
    cancel: async () => ({}), release: async () => ({ released: true }),
    addListener: () => ({ remove: () => {} })
  };
  const passage = { heading: "Pneumonia > Treatment", page: "p.1769", text: "For penicillin allergy, use doxycycline monotherapy or a respiratory fluoroquinolone.", chunk: 17689 };
  const book = { search: () => [[12.5, 0]], cite: () => passage, idfOf: () => 5, us: (w) => w };
  const RAG = {
    TOPK: 3, MIN_SCORE: 6.0,
    toks: (s) => String(s || "").toLowerCase().match(/[a-z]+/g) || [],
    expand: (q) => [q, ""],
    evidenceGate: () => ({ ok: true, nums: [], drugs: [] })
  };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: RAG, SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } },
      pathFor: async () => "/var/mobile/Data/maik-models/maik-lite.gguf", totalBytes: () => 1.1e9 }
  };
  new Function("window", SRC)(win);
  return { L: win.SMD_MAIK_LOCAL, calls };
}
const lite = load("").L.scrubMetaTalk;

test("the Lite copy gives byte-identical output to MaiK Cloud's filter on every case", () => {
  const corpus = [
    ...DROPPED.map((s) => "Start with an ANA and anti-CCP.\n" + s + "\nCheck a CBC."),
    ...REWRITTEN.map(([inp]) => inp),
    ...KEPT,
    "- The provided StewardMD knowledge focuses on Factor XII deficiency [1]. This is not directly relevant to the presentation.\n- Order ANA and anti-CCP. This is the key first step.",
    "Start with ANA.\nThe passage you sent is irrelevant. Check anti-CCP.\n- Based on the text provided, treat early.\n@@REFINE: a | b@@",
    // sentence-split edge cases, where the Lite split (no lookbehind) must match the server's
    'He said "stop." The provided sources do not cover this. (See above.) Next!',
    "Really?! The retrieved passages discuss gout.  Treat the pain.\n\n\n\nReview in 48 h.",
    "", "**Amoxicillin** 500 mg TDS for 5 days.\n\n- Review at 48 h.",
    "The provided sources focus on gout. [2] Treat the pain. [1]",
  ];
  for (const c of corpus) assert.equal(lite(c), scrubMetaTalk(c), JSON.stringify(c));
});

test("maik-local.js has no lookbehind, which an older iOS WebView rejects when it parses the file", () => {
  assert.ok(!/\(\?<[=!]/.test(SRC));
});

test("a Lite answer loses the talk about the material and keeps the medicine, without a re-ask", async () => {
  const { L, calls } = load("For penicillin allergy, use doxycycline monotherapy. The passage you sent is irrelevant to this question.");
  const r = await L.answer({ question: "Treatment of Pneumonia?" }, { pack: "maik-lite" }, null);
  assert.ok(!/passage you sent/i.test(r.text), r.text);
  assert.match(r.text.replace(/\*\*/g, ""), /doxycycline monotherapy/);   // drug names come back bolded
  assert.equal(calls.generate.length, 1);
});

test("an answer that is ONLY talk about the material is a retrieval miss: re-asked without the material", async () => {
  const { L, calls } = load("The retrieved passages discuss a different condition.");
  await L.answer({ question: "Treatment of Pneumonia?" }, { pack: "maik-lite" }, null);
  assert.equal(calls.generate.length, 2);
  assert.match(calls.generate[0].prompt, /Reference material/);
  assert.doesNotMatch(calls.generate[1].prompt, /Reference material/);
});

test("a 'not covered' verdict still reaches the no-coverage re-ask (the scrub runs after it)", async () => {
  const { L, calls } = load("Pneumonia treatment is not addressed in the provided reference material. The evidence covers diverticular disease.");
  const r = await L.answer({ question: "Treatment of Pneumonia?" }, { pack: "maik-lite" }, null);
  assert.equal(calls.generate.length, 2);
  assert.equal(r.grounded, false);
});
