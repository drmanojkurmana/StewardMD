/* test/maik-prompt-budget.test.mjs — the on-device answer() prompt may not silently regrow.
 *
 * WHY THIS EXISTS. Prefill cost IS the on-device latency story: grounding once measured 94% of
 * time-to-first-word on a Pixel 9 (1799 prompt tokens -> ~130 s at a flat ~14 tok/s). We put the
 * book back on-device anyway, so the only thing keeping MaiK Lite usable is that the grounded
 * prompt stays small. answer() does NOT call windowBudget(); its budget is the TOPK/clip caps in
 * retrieveGrounding() plus the history clips. Nothing enforced that but a comment, until now.
 *
 * This pins the worst realistic case: 3 oversized passages, a full two-turn history, a long
 * question. If someone raises TOPK, the 700-char passage clip, HISTORY_CLIP or CARRY_CAP, this
 * fails and makes them price the latency before they spend it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

// Passages far longer than the 700-char clip, so the clip is what bounds the prompt, not the input.
const LONG = (head, word) => ({
  heading: head,
  page: "p.1",
  text: (word + " management with antibiotics, fluids and monitoring of the septic patient. ").repeat(40),
  chunk: 0,
});
const P = [LONG("Peptic ulcer disease > Bleeding", "peptic ulcer bleed"),
           LONG("Peptic ulcer disease > Endoscopy", "peptic ulcer endoscopy"),
           LONG("Peptic ulcer disease > Rebleeding", "peptic ulcer rebleed")];

function load(captured) {
  const Llama = {
    available: async () => ({ available: true, loaded: true }),
    load: async () => ({ loaded: true }),
    generate: async (o) => { captured.push(o); return { text: "Pantoprazole 80 mg IV then endoscopy.", ms: 5 }; },
    cancel: async () => ({}), release: async () => ({ released: true }),
    addListener: () => ({ remove: () => {} }),
  };
  const book = {
    search: () => [[20, 0], [18, 1], [16, 2]],
    cite: (i) => ({ ...P[i] }), idfOf: () => 5, us: (w) => w,
  };
  // The real maik-lite system prompt length is what the pack ships; approximate it faithfully so the
  // budget covers system + prompt the way the device does.
  const SYSTEM = "You are MaiK, StewardMD's clinical decision support for doctors, answering from the StewardMD Knowledge Base built on standard medical resources.\n".repeat(6);
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"),
    SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: {
      PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 768, noThink: true, system: SYSTEM } },
      caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9,
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return win.SMD_MAIK_LOCAL;
}

test("a fully grounded answer prompt leaves room for nPredict inside n_ctx", async () => {
  const captured = [];
  const L = load(captured);
  const history = [
    { role: "user", text: "A 60 year old with melena and a haemoglobin of 7. " + "background detail ".repeat(40) },
    { role: "assistant", text: "Resuscitate first, then endoscopy. " + "further reasoning ".repeat(60) },
    { role: "user", text: "and the dose?" },
  ];
  await L.answer({
    question: "In upper GI bleeding from a peptic ulcer, what is the proton pump inhibitor dose and the timing of endoscopy?",
    history,
    topicMatch: { matched: true, grounded: "Peptic ulcer disease / upper GI bleed" },
  }, { pack: "maik-lite" }, null);

  // May be more than one: claim-level grounding can ask for a regenerate on the same evidence, and
  // that second prompt carries REGEN_NUDGE, so it is the LARGEST one. Budget the worst of them.
  assert.ok(captured.length >= 1, "at least one generate call");
  const worst = captured.reduce((a, b) =>
    L.estTokens(b.prompt) + L.estTokens(b.system || "") > L.estTokens(a.prompt) + L.estTokens(a.system || "") ? b : a);
  const { prompt, system, nPredict } = worst;
  const tokens = L.estTokens(prompt) + L.estTokens(system || "");
  const nCtx = 4096;

  // The hard invariant: prompt + the answer we ask for must fit, with margin for the chat template.
  assert.ok(tokens + nPredict + 160 < nCtx,
    `prompt ${tokens} + nPredict ${nPredict} + 160 template margin must fit n_ctx ${nCtx}`);

  // The latency invariant: this is what keeps time-to-first-word bearable. 1500 is already generous
  // against the ~1799-token prompt that cost ~130 s of prefill.
  assert.ok(tokens <= 1500, `grounded prompt is ${tokens} tokens; budget is 1500 (prefill is the latency)`);
});

test("evidence is capped at TOPK passages, each clipped, however long the source chunks are", async () => {
  const captured = [];
  const L = load(captured);
  await L.answer({
    question: "peptic ulcer bleeding management",
    topicMatch: { matched: true, grounded: "Peptic ulcer disease / upper GI bleed" },
  }, { pack: "maik-lite" }, null);

  const prompt = captured[0].prompt;
  const marks = prompt.match(/\[\d+\]/g) || [];
  assert.ok(marks.length <= 3, `at most TOPK(3) evidence blocks, got ${marks.length}`);
  // Each source chunk is ~3000 chars; the clip must bite.
  assert.ok(prompt.length < 3600, `evidence must be clipped, prompt is ${prompt.length} chars`);
});

test("an ungrounded prompt stays tiny, so a greeting never pays prefill for the book", async () => {
  const captured = [];
  const L = load(captured);
  await L.answer({ question: "hello" }, { pack: "maik-lite" }, null);
  const prompt = captured[0].prompt;
  assert.doesNotMatch(prompt, /Reference material/, "a greeting retrieves nothing");
  assert.ok(L.estTokens(prompt) < 60, `greeting prompt is ${L.estTokens(prompt)} tokens`);
});
