/* test/maik-native-energy.test.mjs - on-device LLM energy savings with no change to output (2026-09-25).
 *
 * 1. iOS warm-up budget floor is 1 (was 64); every real caller asks >= 120, so their budgets are unchanged.
 * 2. The speculative loop stops on a spent budget right after emitting `committed`, like the plain loop.
 * 3. Adaptive draft-off: after 8 verify steps, acceptance below 15% stops drafting for that generation.
 * 4. Native token batching: the first piece goes at once, the rest are coalesced every 40 ms and always
 *    flushed before the promise settles. maik-local.js must render a batched stream exactly as a
 *    per-token one (it only appends ev.text), so the JS half is tested end to end with a stub plugin;
 *    the native halves are pinned statically (no device, no Xcode here). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const SRC = read("maik-local.js");
const PLUG = "local-plugins/capacitor-llama/";
const ENGINE_SWIFT = read(PLUG + "ios/Sources/LlamaPlugin/LlamaEngine.swift");
const PLUGIN_SWIFT = read(PLUG + "ios/Sources/LlamaPlugin/LlamaPlugin.swift");
const PLUGIN_JAVA = read(PLUG + "android/src/main/java/in/stewardmd/llama/LlamaPlugin.java");
const JNI = read(PLUG + "android/src/main/cpp/llama_jni.cpp");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A stub Llama plugin. `events` is the list of llamaToken payloads to deliver; "|" pauses 80 ms (longer
 *  than PAINT_MS) so intermediate paints are observable. Resolves with an EMPTY text, so the answer is
 *  built from what the listener accumulated: exactly the path a batched stream must not change. */
function engine(events) {
  const listeners = new Set();
  const Llama = {
    available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => {
      for (const ev of events) {
        if (ev === "|") { await sleep(80); continue; }
        for (const l of [...listeners]) l(ev);
      }
      return { text: "", ms: 5 };
    },
    cancel: async () => ({}), release: async () => ({ released: true }),
    addListener: (name, cb) => { if (name !== "llamaToken") return { remove: () => {} }; listeners.add(cb); return { remove: () => listeners.delete(cb) }; }
  };
  const passage = { heading: "Hypertension > Treatment", page: "p.1", chunk: 1,
    text: "Amlodipine 5 to 10 mg once daily is a first-line drug for hypertension. Thiazide diuretics are an alternative." };
  const book = { search: () => [[12.5, 0]], cite: () => Object.assign({}, passage), idfOf: () => 5, us: (w) => w };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_DRUG_LEXICON: require("../drug-lexicon.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_MODELS: { PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } }, caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return { L: win.SMD_MAIK_LOCAL, listeners };
}

/** Per-token events, one piece each (the old native behaviour). */
const perToken = (pieces) => pieces.map((p) => (p === "|" ? p : { text: p }));
/** The same pieces coalesced the way TokenBatcher does: first piece alone, then groups, `count` carried. */
function batched(pieces, size) {
  const out = [];
  let buf = "", n = 0, first = true;
  const flush = () => { if (n) { out.push({ text: buf, count: n }); buf = ""; n = 0; } };
  for (const p of pieces) {
    if (p === "|") { flush(); out.push(p); continue; }
    buf += p; n++;
    if (first) { first = false; flush(); } else if (n >= size) flush();
  }
  flush();
  return out;
}

async function run(events, q) {
  const e = engine(events);
  const seen = [];
  const r = await e.L.answer(q, { pack: "maik-lite" }, (t) => seen.push(t));
  assert.equal(e.listeners.size, 0, "listener removed");
  return { r, last: seen[seen.length - 1], seen };
}

// Multi-byte characters (T54) and a reasoning block split across pieces (stripReasoning on the accumulated text).
const UNGROUNDED = ["<thi", "nk>weigh", "ing</th", "ink>", "He", "llo", " wor", "ld, ", "BP ", "≥", " 140", " at 37", " °C", ".", "|", " Mo", "re", " text", " µg", "."];
const GROUNDED = ["Amlo", "dipine 5 to 10 mg once", " daily is first line", " for hypertension.", "|", "\n", "- Warf", "arin is added.", "\n", "|", "Verify against", " local protocol."];

for (const [name, pieces, q] of [["ungrounded", UNGROUNDED, { question: "hi" }], ["grounded + claim-checked (T56)", GROUNDED, { question: "treatment of hypertension" }]]) {
  for (const size of [2, 3, 7]) {
    test(`batching: a ${name} stream batched ${size} at a time renders exactly like per-token events`, async () => {
      const a = await run(perToken(pieces), q);
      const b = await run(batched(pieces, size), q);
      assert.ok(batched(pieces, size).length < perToken(pieces).length, "the batched stream really has fewer events");
      assert.equal(b.r.text, a.r.text, "final answer text identical");
      if (q.question !== "hi") assert.equal(a.r.checked, true, "the grounded case really runs the claim check");
      assert.equal(b.r.checked, a.r.checked);
      assert.equal(b.r.grounded, a.r.grounded);
      assert.equal(b.last, a.last, "final painted text identical");
      assert.equal(b.seen[0], a.seen[0], "first paint identical (the first piece is never batched)");
    });
  }
}

test("batching: the ungrounded answer is the concatenation, with reasoning stripped", async () => {
  const b = await run(batched(UNGROUNDED, 4), { question: "hi" });
  assert.equal(b.r.text.includes("weighing"), false);
  assert.match(b.r.text, /Hello world, BP ≥ 140 at 37 °C\. More text µg\./);
});

// ---- native pins ----------------------------------------------------------------------------------

test("1. iOS budget floor is 1 (warm-up asks 1); Android already honours the requested budget", () => {
  assert.match(ENGINE_SWIFT, /return max\(1, b\)/);
  assert.doesNotMatch(ENGINE_SWIFT, /max\(64, b\)/);
  assert.match(JNI, /const int budget = \(nPredict > 0\) \? nPredict : 512;/);
  assert.match(SRC, /nPredict: 1, temperature: 0, stream: false/, "the warm-up call");
});

test("1. every real JS caller asks >= 120 tokens, so the lower floor changes none of their output", () => {
  const lits = [...SRC.matchAll(/generate(?:JSON|Text)\([^\n]*?,\s*(\d+),\s*(?:opts|bg|o2)\)/g)].map((m) => Number(m[1]));
  assert.ok(lits.length >= 12, "found the literal-budget callers: " + lits.length);
  for (const n of lits) assert.ok(n >= 120, "caller budget " + n);
  assert.match(SRC, /TRANSLATE_SYS, Math\.min\(1000, Math\.max\(120, /, "translate floors at 120");
  assert.match(SRC, /var WEB_MAX = 0;/, "web answers use openBudget (>= pack nPredict)");
  assert.match(SRC, /return Math\.max\(\(pk && pk\.nPredict\) \|\| 512, /, "openBudget floor");
});

test("2. speculative loop stops on a spent budget right after emitting committed (both platforms)", () => {
  assert.match(ENGINE_SWIFT, /emit\(committed\)\n\s*\/\/[^\n]*\n\s*if produced >= budget \{ break \}/);
  assert.match(JNI, /emit\(committed\);\n\s*\/\/[^\n]*\n\s*if \(produced >= budget\) break;/);
});

test("3. adaptive draft-off: >= 8 verify steps and < 15% acceptance turns drafting off (both platforms)", () => {
  assert.match(ENGINE_SWIFT, /static let draftMinSteps = 8/);
  assert.match(ENGINE_SWIFT, /static let draftMinAccept = 0\.15/);
  assert.match(ENGINE_SWIFT, /if draftOK && verifySteps >= Self\.draftMinSteps && stats\.draftProposed > 0\s*&& Double\(stats\.draftAccepted\) \/ Double\(stats\.draftProposed\) < Self\.draftMinAccept \{\s*draftOK = false/);
  assert.match(JNI, /constexpr int DRAFT_MIN_STEPS = 8;/);
  assert.match(JNI, /constexpr double DRAFT_MIN_ACCEPT = 0\.15;/);
  assert.match(JNI, /if \(draftOK && verifySteps >= DRAFT_MIN_STEPS && st\.draftProposed > 0\s*&& \(double\) st\.draftAccepted \/ \(double\) st\.draftProposed < DRAFT_MIN_ACCEPT\) \{\s*draftOK = false;/);
  // The perf line's draft=a/p still counts every proposal: the tally runs before the decision.
  assert.ok(ENGINE_SWIFT.indexOf("stats.draftProposed += drafts.count") < ENGINE_SWIFT.indexOf("verifySteps >= Self.draftMinSteps"));
  assert.ok(JNI.indexOf("st.draftProposed += (int) drafts.size()") < JNI.indexOf("verifySteps >= DRAFT_MIN_STEPS"));
});

test("4. iOS: tokens go through TokenBatcher (40 ms, first piece immediate) and flush before the promise settles", () => {
  assert.match(PLUGIN_SWIFT, /static let intervalMs = 40/);
  assert.match(PLUGIN_SWIFT, /if !sentFirst \{ sentFirst = true; flushLocked\(\); return \}/);
  assert.match(PLUGIN_SWIFT, /notifyListeners\("llamaToken", data: \["text": text, "count": count\]\)/);
  assert.doesNotMatch(PLUGIN_SWIFT, /data: \["text": piece\]/, "no per-token event left");
  // In both generate and generateWithImage the flush is the first thing the completion does.
  const flushes = [...PLUGIN_SWIFT.matchAll(/\{ \[weak self\] result in\n\s*batcher\?\.flush\(\)/g)];
  assert.equal(flushes.length, 2);
});

test("4. Android: tokens go through TokenBatcher (40 ms, first piece immediate) and flush before resolve/reject", () => {
  assert.match(PLUGIN_JAVA, /static final int TOKEN_FLUSH_MS = 40;/);
  assert.match(PLUGIN_JAVA, /if \(!sentFirst\) \{ sentFirst = true; flush\(\); return; \}/);
  assert.match(PLUGIN_JAVA, /notifyListeners\("llamaToken", new JSObject\(\)\.put\("text", text\)\.put\("count", n\)\)/);
  assert.doesNotMatch(PLUGIN_JAVA, /put\("text", piece\)/, "no per-token event left");
  const flushes = [...PLUGIN_JAVA.matchAll(/finally \{ if \(sink != null\) sink\.flush\(\); \}/g)];
  assert.equal(flushes.length, 2);
});
