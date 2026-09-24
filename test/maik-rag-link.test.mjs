/* test/maik-rag-link.test.mjs — the RAG link switch (owner, 2026-09-19:
 * "give option to link and unlink RAG to model so models can act based on Rag or non rag").
 *
 * ON  = Knowledge Base connected: the book is searched, evidence enters the prompt, sources shown.
 * OFF = disconnected: no retrieval at all, the model answers from its own weights.
 *
 * The safety property under test is not just "does it skip retrieval" but "does the app stop
 * CLAIMING sources it never read". An ungrounded answer still labelled grounded is worse than a
 * slow one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const ENGINE = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");

const PASSAGE = {
  heading: "Peptic ulcer disease > Upper GI bleeding", page: "p.3", chunk: 0,
  text: "Upper GI bleeding presents with melena or hematemesis. Resuscitate, give IV pantoprazole 80 mg, and arrange endoscopy within 24 hours; a peptic ulcer is the commonest cause of upper gastrointestinal bleeding in adults.",
};

function store() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** Load the engine module alone, on its own localStorage, to exercise the switch itself.
 *  `ready` satisfies localReady() (bypass + a runtime + an installed pack) so effective() can
 *  actually return "local" — without it every discLabel() call falls back to the "rag" branch. */
function loadEngine(ready) {
  const ls = store();
  if (ready) ls.setItem("smd_maik_local_bypass", "1");
  const win = {
    localStorage: ls, addEventListener() {}, document: { querySelector: () => null },
    SMD_MAIK_LOCAL: ready ? { answer() {}, available: () => true } : undefined,
    SMD_MAIK_MODELS: ready ? { installedCached: () => true, PACKS: { "maik-lite": { label: "MAiK Lite" } } } : undefined,
  };
  const mod = { exports: {} };
  new Function("window", "localStorage", "module", ENGINE)(win, ls, mod);
  return win.SMD_MAIK_ENGINE || mod.exports;
}

/** Load the on-device engine with a book, and a RAG link state supplied by a stub engine. */
function loadLocal(linked, searched) {
  const ls = store();
  const Llama = {
    available: async () => ({ available: true, loaded: true }), load: async () => ({ loaded: true }),
    generate: async () => ({ text: "Resuscitate, IV pantoprazole 80 mg, then endoscopy within 24 hours.", ms: 5 }),
    cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }),
  };
  const book = { search: (q) => { searched.push(q); return [[20, 0]]; }, cite: () => ({ ...PASSAGE }), idfOf: () => 5, us: (w) => w };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"),
    SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_KB_STORE: { loadBook: () => Promise.resolve(book) },
    SMD_MAIK_ENGINE: { ragLinked: () => linked },
    SMD_MAIK_MODELS: {
      PACKS: { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } },
      caps: () => ({ kb: true }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1e9,
    },
    localStorage: ls,
  };
  new Function("window", "localStorage", LOCAL)(win, ls);
  return win.SMD_MAIK_LOCAL;
}

const ASK = { question: "melena workup", topicMatch: { matched: true, grounded: "Peptic ulcer disease / upper GI bleed" } };

test("default is CONNECTED — an absent key must never silently unground the model", () => {
  const E = loadEngine();
  assert.equal(E.ragLinked(), true, "no stored preference = Knowledge Base connected");
});

test("the switch round-trips and is durable in both directions", () => {
  const E = loadEngine();
  assert.equal(E.setRagLinked(false), false);
  assert.equal(E.ragLinked(), false);
  assert.equal(E.setRagLinked(true), true);
  assert.equal(E.ragLinked(), true);
});

test("CONNECTED: the book is searched and the answer is grounded", async () => {
  const searched = [];
  const r = await loadLocal(true, searched).answer(ASK, { pack: "maik-lite" }, null);
  assert.ok(searched.length > 0, "the book is searched when linked");
  assert.equal(r.grounded, true, "answer reports itself as grounded");
});

test("DISCONNECTED: the book is never touched and the answer does not claim grounding", async () => {
  const searched = [];
  const r = await loadLocal(false, searched).answer(ASK, { pack: "maik-lite" }, null);
  assert.equal(searched.length, 0, "no retrieval at all when unlinked");
  assert.notEqual(r.grounded, true, "an unlinked answer must not report itself grounded");
  assert.ok(!(r.sources && r.sources.length), "an unlinked answer must show no sources");
});

/* OWNER, 2026-09-20: "whenever toggle is off it should work based on own weights and knowledge",
 * "no guardrails too". The gates are all inside `if (grounding)` in answer(), so disconnecting the
 * book already disables them. These pin that, because the dangerous regression here is silent: a
 * gate that still ran with zero passages would strip every claim and hand back an EMPTY answer,
 * which reads to the clinician as "the app is broken", not as "guardrails are on". */
test("DISCONNECTED: the model's own answer survives verbatim — no gate, no rewrite, no blanking", async () => {
  const r = await loadLocal(false, []).answer(ASK, { pack: "maik-lite" }, null);
  const plain = String(r.text || "").replace(/\*\*/g, "");
  assert.ok(plain.trim().length > 0, "an unlinked answer must never come back empty");
  assert.match(plain, /pantoprazole 80 mg/i, "the model's own words reach the clinician unaltered");
  assert.doesNotMatch(plain, /could not be verified/i, "the evidence gate must not run with no evidence");
  assert.doesNotMatch(plain, /Source: StewardMD Knowledge Base/i, "no source line for a book it never read");
  assert.doesNotMatch(plain, /reference passage on this topic/i, "no passage substitution when unlinked");
  assert.ok(!r.grounding || !r.grounding.removed, "nothing is reported as removed by a gate that did not run");
});

test("the switch is scoped to on-device only — MaiK Cloud and KB only are never ungrounded by it", () => {
  const E = loadEngine(true);
  E.setRagLinked(false);
  // Cloud costs tokens and is always grounded server-side; the link must not touch its wording.
  E.setPref("cloud");
  assert.match(E.discLabel(), /Grounded/, "cloud stays grounded with the link off");
  E.setPref("rag");
  assert.match(E.discLabel(), /knowledge base/i, "KB only stays on the knowledge base with the link off");
  // And the local engine is the only consumer of the switch.
  assert.match(readFileSync(new URL("../maik-local.js", import.meta.url), "utf8"),
    /ragLinkedPref\(\)/, "maik-local.js is where the link is honoured");
});

test("the header disclaimer tells the truth in each state, and never says 'no sources' while grounded", () => {
  const E = loadEngine(true);
  E.setPref("local");
  assert.equal(E.effective(), "local", "harness must actually be on the on-device engine");
  E.setRagLinked(true);
  const on = E.discLabel();
  E.setRagLinked(false);
  const off = E.discLabel();

  assert.notEqual(on, off, "the disclaimer must change with the switch");
  assert.match(on, /Knowledge Base/i, "connected: names the Knowledge Base");
  assert.doesNotMatch(on, /no sources/i, "connected: must not claim it read nothing");
  assert.match(off, /no sources/i, "disconnected: says plainly that nothing was read");
  assert.doesNotMatch(off, /Knowledge Base/i, "disconnected: must not imply the KB was used");
});

/* REQUIREMENT 11 (owner, 2026-09-20): with the link off, buildPackage() must not run at all.
 * home.js is a 9k-line UI module with no unit harness, so this asserts the guard at source level -
 * the same approach maik-engine.test.mjs uses for its source invariants. What matters is that the
 * short-circuit exists, is gated on BOTH "local" and "not linked", and yields the same shape the
 * timeout/reject arms already return so nothing downstream changes behaviour. */
test("RAG off short-circuits buildPackage in home.js and never fabricates a topicMatch", () => {
  const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
  const i = HOME.indexOf("var _ragOff");
  assert.ok(i > 0, "the short-circuit guard exists");
  const block = HOME.slice(i, i + 900);
  assert.match(block, /effective\(\)\s*===\s*"local"/, "gated on the on-device engine");
  assert.match(block, /ragLinked\s*&&\s*!_E\.ragLinked\(\)/, "gated on the link being OFF");
  assert.match(block, /_ragOff[\s\S]{0,120}\?\s*Promise\.resolve\(\{ question: question, grounding: \[\] \}\)/,
    "returns the existing no-KB stand-in shape rather than a new one");
  // The stand-in must NOT carry a topicMatch: the web-research tier fires on `tm.matched === false`,
  // so inventing one would send an offline clinician to a tier that needs the network.
  assert.doesNotMatch(block.split("groundP")[1] || "", /topicMatch/,
    "no topicMatch is fabricated for the ungrounded stand-in");
  // And the real call must still be the fallback when the link is ON.
  assert.match(block, /StewardRAG\.buildPackage/, "the linked path still builds the package");
});

test("the toggle renders as a real switch with the app's own markup and an accessible name", () => {
  const E = loadEngine();
  E.setRagLinked(true);
  const html = E.ragLinkHTML();
  assert.match(html, /role="switch"/, "uses switch semantics, not a bare button");
  assert.match(html, /aria-checked="true"/, "state is exposed to assistive tech");
  assert.match(html, /aria-label="[^"]+"/, "the control has an accessible name");
  assert.match(html, /class="smd-nav-sw on"/, "reuses the app's switch component");
  // A positive label, on or off (owner, 2026-09-21): "Connected / Disconnected" read backwards on
  // a phone. The label names the check; the sub-label states what the current side costs.
  assert.match(html, />Check answers against the Knowledge Base</, "label names the check");
  assert.match(html, /safer default/, "on: says why it is the default");

  E.setRagLinked(false);
  const off = E.ragLinkHTML();
  assert.match(off, /aria-checked="false"/);
  assert.match(off, /shows no sources/, "off: says what it costs");
  assert.doesNotMatch(off, /Disconnected/);
  assert.doesNotMatch(off, /class="smd-nav-sw on"/, "off state is not painted as on");
});
