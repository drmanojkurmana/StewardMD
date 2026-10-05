/* test/edge-start-mcq.test.mjs - Edge kind "start_mcq" (PrepNucleus LayerC Phase 4, edge-router.js).
 * "10 questions on lymphoma", "quiz me on brachial plexus", "practice cardiology MCQs", "timed test on renal physiology",
 * "show my mistakes": rules only (Layer 0, no model), resolved to { kind: "start_mcq", n, topic, mode } and run through
 * window.PREP.open({ query, n, mode }). Flag smd_prep off (PREP_LOADER.enabled() false): no start_mcq, nothing opens.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/edge-start-mcq.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = {};
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), addEventListener() {},
  getElementById: () => null, querySelector: () => null, body: { appendChild() {}, classList: { add() {}, remove() {} } }, head: { appendChild() {} } };
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.SMD_HOME_TOOLS = () => [
  { act: "antibiogram", tt: "Antibiogram", sub: "Local resistance" },
  { act: "icu", tt: "ICU", sub: "Critical care dashboard" }
];
["calculators.js", "clinical-params.js", "calc-prefill.js", "search.js", "edge-runtime.js", "edge-router.js"].forEach((f) =>
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
const E = globalThis.SMD_EDGE;

// PrepNucleus as prep-loader.js leaves it: PREP_LOADER.enabled() reads the flag, PREP.open records its options.
let prepFlag = false;
const opened = [];
globalThis.PREP_LOADER = { enabled: () => prepFlag };
globalThis.PREP = { open: (o) => { if (!prepFlag) return false; opened.push(o); return true; } };

function mock() {
  const m = { prompts: [], available: () => true, load: () => Promise.resolve(), reset: () => Promise.resolve(), release: () => Promise.resolve() };
  m.complete = (task) => { m.prompts.push(task); return Promise.resolve({ type: "call", function_calls: [{ name: "choose_option", arguments: { option: 1 } }], confidence: 0.9 }); };
  return m;
}

test("parser: the LayerC phrases resolve to n, topic and mode", () => {
  const cases = [
    ["10 questions on lymphoma", { n: 10, topic: "lymphoma", mode: "study" }],
    ["quiz me on brachial plexus", { n: null, topic: "brachial plexus", mode: "study" }],
    ["practice cardiology MCQs", { n: null, topic: "cardiology", mode: "study" }],
    ["timed test on renal physiology", { n: null, topic: "renal physiology", mode: "exam" }],
    ["show my mistakes", { n: null, topic: null, mode: "mistakes" }],
    ["show my mistakes in pharmacology", { n: null, topic: "pharmacology", mode: "mistakes" }],
    ["give me 20 question mock test on obgyn", { n: 20, topic: "obgyn", mode: "exam" }],
    ["timed test of 20 questions on renal physiology", { n: 20, topic: "renal physiology", mode: "exam" }],
    ["ten MCQs on thyroid", { n: 10, topic: "thyroid", mode: "study" }],
    ["neet pg pharmacology mcqs", { n: null, topic: "pharmacology", mode: "study" }],
    ["mcq on diseases of the liver", { n: null, topic: "diseases of the liver", mode: "study" }],
    ["lymphoma ke 10 questions do", { n: 10, topic: "lymphoma", mode: "study" }],
    ["10 mcqs", { n: 10, topic: null, mode: "study" }]
  ];
  for (const [t, want] of cases) assert.deepEqual(E.mcqParse(t), want, t);
});

test("parser: clinical questions, pasted MCQs and history questions are not a quiz", () => {
  ["what is lymphoma", "open antibiogram", "renal function test", "what questions to ask in a psychiatric history",
    "common mistakes in ecg interpretation", "explain this mcq", "review mistakes in prescribing", "crcl 72F 58kg cr 1.4",
    "Which of the following is the drug of choice for MRSA? A. vancomycin B. linezolid",
    "give me questions to ask a patient with chest pain", "icd code for lymphoma", ""].forEach((t) =>
    assert.equal(E.mcqParse(t), null, t));
  assert.equal(E.mcqParse("quiz me on " + "a ".repeat(200)), null, "over 160 characters");
  assert.equal(E.mcqParse("10 questions on the management of a patient with a very long topic here"), null, "a sentence is not a topic");
});

test("flag smd_prep OFF: no start_mcq option, nothing opens, the request goes on as before", async () => {
  prepFlag = false; delete store.smd_edge; opened.length = 0;
  assert.equal(E.mcqAsk("10 questions on lymphoma"), null);
  assert.ok(!E.candidates("10 questions on lymphoma").some((c) => c.kind === "start_mcq"));
  const r = E.rules("quiz me on brachial plexus");
  assert.ok(!r || r.kind !== "start_mcq");
  assert.equal(E.startMcq({ kind: "start_mcq", n: 10, topic: "lymphoma", mode: "study" }), false);
  assert.equal(opened.length, 0);
  // PrepNucleus not on the page at all: same.
  const PL = globalThis.PREP_LOADER; delete globalThis.PREP_LOADER;
  try { assert.equal(E.mcqAsk("show my mistakes"), null); assert.equal(E.startMcq({ kind: "start_mcq", mode: "mistakes" }), false); }
  finally { globalThis.PREP_LOADER = PL; }
  assert.equal(opened.length, 0);
});

test("flag ON: Layer 0 rules answer with the start_mcq action, no model call", async () => {
  prepFlag = true; delete store.smd_edge;
  const m = mock(); E.setEngine(m);
  const c = E.candidates("10 questions on lymphoma");
  assert.equal(c.length, 1); assert.equal(c[0].kind, "start_mcq"); assert.equal(c[0].exact, true);
  assert.equal(c[0].title, "10 questions on lymphoma");
  const r0 = E.rules("10 questions on lymphoma");
  assert.equal(r0.kind, "start_mcq"); assert.equal(r0.source, "rules");
  assert.deepEqual({ n: r0.n, topic: r0.topic, mode: r0.mode }, { n: 10, topic: "lymphoma", mode: "study" });
  const r = await E.route("timed test on renal physiology");
  assert.equal(r.kind, "start_mcq"); assert.equal(r.source, "rules");
  assert.deepEqual({ n: r.n, topic: r.topic, mode: r.mode }, { n: null, topic: "renal physiology", mode: "exam" });
  assert.equal(r.title, "Timed test on renal physiology");
  const mk = E.rules("show my mistakes");
  assert.deepEqual({ kind: mk.kind, topic: mk.topic, mode: mk.mode, title: mk.title }, { kind: "start_mcq", topic: null, mode: "mistakes", title: "Your mistakes" });
  assert.equal(m.prompts.length, 0, "rules only, the engine is never asked");
  E.setEngine(null);
});

test("startMcq opens PrepNucleus with { query, n, mode }", () => {
  prepFlag = true; opened.length = 0;
  assert.equal(E.startMcq(E.rules("10 questions on lymphoma")), true);
  assert.equal(E.startMcq(E.rules("show my mistakes")), true);
  assert.equal(E.startMcq(E.rules("practice cardiology MCQs")), true);
  assert.deepEqual(opened, [
    { query: "lymphoma", n: 10, mode: "study" },
    { query: null, n: null, mode: "mistakes" },
    { query: "cardiology", n: null, mode: "study" }
  ]);
  // Anything that is not a start_mcq action is refused.
  assert.equal(E.startMcq({ kind: "tool", id: "antibiogram" }), false);
  assert.equal(E.startMcq(null), false);
  assert.equal(opened.length, 3);
  // PREP.open throwing never escapes.
  const P = globalThis.PREP; globalThis.PREP = { open: () => { throw new Error("boom"); } };
  try { assert.equal(E.startMcq({ kind: "start_mcq", topic: "x", mode: "study" }), false); } finally { globalThis.PREP = P; }
});

test("guards: a negation still passes; a drug in the topic is not a clinical order; Edge off is off", () => {
  prepFlag = true;
  assert.equal(E.rules("don't quiz me on lymphoma"), null);
  assert.equal(E.rules("10 questions on lymphoma mat karo"), null);
  // "start" + a named drug is the clinical-order guard (edge19); a quiz request is exempt from it.
  globalThis.SMD_DRUGLINK = { drugsIn: (t) => (/digoxin/i.test(t) ? [{ generic: "digoxin", name: "Digoxin", typed: "digoxin" }] : []) };
  try {
    assert.equal(E.negated("start digoxin 0.25 mg"), true, "an order is still guarded");
    assert.equal(E.negated("start digoxin"), true);
    const d = E.rules("start 10 mcqs on digoxin toxicity");
    assert.equal(d.kind, "start_mcq"); assert.equal(d.topic, "digoxin toxicity");
    assert.equal(E.negated("start 10 mcqs on digoxin toxicity"), false);
    prepFlag = false;
    assert.equal(E.negated("start 10 mcqs on digoxin toxicity"), true, "flag off: the guard is exactly as before");
    prepFlag = true;
  } finally { delete globalThis.SMD_DRUGLINK; }
  store.smd_edge = "0";
  assert.equal(E.rules("10 questions on lymphoma"), null);
  delete store.smd_edge;
});

test("frozen sets: with the flag ON no row is read as a quiz (rules coverage unchanged)", () => {
  prepFlag = true;
  const dir = path.join(ROOT, "vault/plans/edge-data");
  let n = 0;
  for (const f of ["dataset/test.jsonl", "dataset/test3.jsonl", "dataset/test4.jsonl", "kb/kb-nav.jsonl"]) {
    const p = path.join(dir, f); if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line), t = r.input_text || r.text || "";
      n++;
      assert.equal(E.mcqAsk(t), null, t);
    }
  }
  assert.ok(n > 1000, "the frozen sets were read (" + n + " rows)");
});
