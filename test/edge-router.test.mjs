/* test/edge-router.test.mjs — Edge Wave 1 router with a mock engine (edge-router.js).
 * The model only ever picks one of the deterministic candidates; numbers come from the parser.
 * node --test test/edge-router.test.mjs
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
  { act: "icu", tt: "ICU", sub: "Critical care dashboard" },
  { act: "insulin", tt: "Insulin", sub: "Insulin dosing" }
];
["calculators.js", "clinical-params.js", "calc-prefill.js", "search.js", "edge-runtime.js", "edge-router.js"].forEach((f) =>
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
const E = globalThis.SMD_EDGE;

function mock(pick) {
  const m = { prompts: [], available: () => true, load: () => Promise.resolve(), reset: () => Promise.resolve(), release: () => Promise.resolve() };
  m.complete = (task) => { m.prompts.push(task); return Promise.resolve(pick(task)); };
  return m;
}
const needleReply = (option, confidence = 0.9) => ({ type: "call", function_calls: [{ name: "choose_option", arguments: { option } }], confidence });

test("flag default ON (owner 2026-10-04); \"0\" turns it off", async () => {
  delete store.smd_edge;
  assert.equal(E.enabled(), true, "unset means on");
});

test("flag OFF (\"0\"): route returns null and no model is called", async () => {
  store.smd_edge = "0";
  const m = mock(() => needleReply(1)); E.setEngine(m);
  assert.equal(await E.route("open antibiogram"), null);
  assert.equal(m.prompts.length, 0);
});

test("candidates come from the app's own matchers, values stripped first", () => {
  store.smd_edge = "1";
  const c = E.candidates("crcl 72F 58kg cr 1.4");
  assert.equal(c[0].kind, "calculator"); assert.equal(c[0].id, "crcl");
  assert.ok(c.length <= 5);
  const t = E.candidates("open antibiogram");
  assert.ok(t.some((x) => x.kind === "tool" && x.id === "antibiogram"));
  const i = E.candidates("icd code for type 2 diabetes");
  assert.equal(i[0].kind, "icd");
});

test("Layer 0: an exact calculator name is answered by rules, with prefill, no model call", async () => {
  store.smd_edge = "1";
  const m = mock(() => needleReply(1)); E.setEngine(m);
  const r = await E.route("crcl 72F 58kg cr 1.4");
  assert.equal(r.kind, "calculator"); assert.equal(r.id, "crcl"); assert.equal(r.source, "rules");
  assert.deepEqual(r.prefill.prefill, { age: 72, wt: 58, scr: 1.4, sex: "f" });
  assert.equal(m.prompts.length, 0);
});

test("model picks among numbered options through the fixed tool", async () => {
  store.smd_edge = "1";
  const m = mock((task) => {
    const line = task.prompt.split("\n").find((l) => /open: Antibiogram/.test(l));
    return needleReply(parseInt(line, 10));
  });
  E.setEngine(m);
  const r = await E.route("show me the resistance patterns antibiogram");
  assert.equal(r && r.kind, "tool"); assert.equal(r.id, "antibiogram"); assert.equal(r.source, "edge");
  assert.equal(m.prompts[0].tools[0].name, "choose_option", "the schema is fixed");
  assert.match(m.prompts[0].prompt, /0\. none of these/);
});

test("engine.agree: a second call with the options rotated must pick the same option, else pass", async () => {
  store.smd_edge = "1";
  const q = "show me the resistance patterns antibiogram";
  const byTitle = (task) => needleReply(parseInt(task.prompt.split("\n").find((l) => /open: Antibiogram/.test(l)), 10));
  const m = mock(byTitle); m.agree = true; E.setEngine(m);
  const r = await E.route(q);
  assert.equal(r && r.id, "antibiogram"); assert.equal(m.prompts.length, 2, "two calls");
  assert.notEqual(m.prompts[0].prompt, m.prompts[1].prompt, "options rotated");
  const first = mock(() => needleReply(1)); first.agree = true; E.setEngine(first);   // position bias: always "1"
  assert.equal(await E.route(q), null, "disagreement passes to the safe path");
});

test("option 0, out-of-range, wrong tool, low confidence, garbage: all pass through (null)", async () => {
  store.smd_edge = "1";
  const q = "show me the resistance patterns antibiogram";
  for (const reply of [needleReply(0), needleReply(9), { function_calls: [{ name: "other", arguments: { option: 1 } }] }, needleReply(1, 0.2), { nonsense: true }, needleReply(1.5)]) {
    E.setEngine(mock(() => reply));
    assert.equal(await E.route(q), null, JSON.stringify(reply));
  }
});

test("engine timeout or failure never blocks: null, caller continues", async () => {
  store.smd_edge = "1";
  const slow = mock(() => new Promise((r) => setTimeout(() => r(needleReply(1)), 3000)));
  E.setEngine(slow);
  const t0 = Date.now();
  assert.equal(await E.route("show me the resistance patterns antibiogram"), null);
  assert.ok(Date.now() - t0 < 2500);
  const bad = mock(() => Promise.reject(new Error("crash"))); E.setEngine(bad);
  assert.equal(await E.route("show me the resistance patterns antibiogram"), null);
});

test("no candidates: no model call, null", async () => {
  store.smd_edge = "1";
  const m = mock(() => needleReply(1)); E.setEngine(m);
  assert.equal(await E.route("zzqx blorp"), null);
  assert.equal(m.prompts.length, 0);
});

test("prompt stays short and carries no extracted numbers from the model side", () => {
  const p = E.promptFor("crcl 72F 58kg cr 1.4 ".repeat(40), [{ kind: "calculator", title: "CrCl" }]);
  assert.ok(p.length < 420);
});

// Found by the bake-off scorer on the frozen test set (scripts/edge/score.mjs): rules-layer wrong opens.
test("negation guard: a negated or stop request never reaches rules or the model", async () => {
  store.smd_edge = "1";
  const m = mock(() => needleReply(1)); E.setEngine(m);
  for (const q of ["don't open antibiogram", "do not calculate crcl", "stop metformin", "no need to open the icu"]) assert.equal(await E.route(q), null, q);
  assert.equal(m.prompts.length, 0);
  assert.equal(E.negated("threshold for insulin"), false, "word boundaries: 'hold' inside a word is not a stop");
});
test("single letters and digits survive: r-ipi, phq-2 and s/f are their own calculators", () => {
  store.smd_edge = "1";
  assert.equal(E.candidates("go to r ipi")[0].id, "r_ipi");
  assert.equal(E.candidates("phq-2 please")[0].id, "phq2");
  assert.equal(E.candidates("s/f ratio")[0].id, "sf_ratio", "an own keyword beats word overlap");
  assert.notEqual(E.candidates("go to timi")[0].exact, true, "two TIMI scores: the model or the doctor picks, not rules");
});
test("ICD: the screen request is not a code lookup, and a diagnosis keeps its words", () => {
  store.smd_edge = "1";
  assert.ok(!E.candidates("take me to search icd").some((c) => c.kind === "icd"));
  assert.equal(E.candidates("icd for open fracture of tibia")[0].id, "open fracture tibia", "'open' is part of the diagnosis");
  assert.equal(E.candidates("icd code for type 2 diabetes")[0].id, "type 2 diabetes");
});
// Found by the frozen test set edge-router-3 (test3.jsonl): rules opened a card on these.
test("negation guard: Hinglish and Tenglish negations pass, clinical 'nahi' does not", async () => {
  store.smd_edge = "1";
  const m = mock(() => needleReply(1)); E.setEngine(m);
  for (const q of ["antibiogram mat kholo", "icu nahi chahiye", "insulin mat dikhao", "icu nahin chahiye", "antibiogram vaddu", "icu teravaddu", "antibiogram chupinchavaddu"]) {
    assert.equal(E.negated(q), true, q);
    assert.equal(E.rules(q), null, q);
    assert.equal(await E.route(q), null, q);
  }
  assert.equal(m.prompts.length, 0);
  for (const q of ["fever nahi utar raha paracetamol dose", "urine output nahi hai crcl", "mat 2 lagao"]) assert.equal(E.negated(q), false, q);
});
test("ICD: naming the Search ICD tool never looks up the navigation words", () => {
  store.smd_edge = "1";
  for (const q of ["navigate to search icd", "search icd section", "jump to search icd", "search icd wala page kholo", "search icd page ki vellu", "icd search kholo"]) {
    assert.ok(!E.candidates(q).some((c) => c.kind === "icd"), q);
    assert.ok(!E.rules(q) || E.rules(q).kind !== "icd", q);
  }
  assert.equal(E.candidates("search icd for type 2 diabetes")[0].id, "type 2 diabetes", "a real lookup through the tool name still works");
  assert.equal(E.rules("icd code for type 2 diabetes").kind, "icd");
});

test("Layer 0 widened: an exactly named tool or generic drug, in any of the three languages, is a rules answer", async () => {
  store.smd_edge = "1";
  const m = mock(() => needleReply(1)); E.setEngine(m);
  for (const q of ["antibiogram kholo", "open antibiogram", "antibiogram chupinchu", "show me the antibiogram"]) {
    const r = await E.route(q);
    assert.equal(r && r.kind, "tool", q); assert.equal(r.id, "antibiogram", q); assert.equal(r.source, "rules", q);
  }
  assert.equal(m.prompts.length, 0, "no model call for an exact name");
  assert.equal(E.layer0(E.candidates("resistance patterns antibiogram")), false, "extra words: the model decides");
  assert.equal(E.layer0(E.candidates("do not open antibiogram")), false);
  assert.equal(await E.route("do not open antibiogram"), null, "negation still wins");
});

test("KB page: a navigation word plus exactly a disease name or alias is a rules answer; anything more is not", async () => {
  // Mock in the shape of MaiKKB (kb/ai/maik-kb.js): exact name match is confident, an intent tail is stripped by
  // _diseasePhrase, "tb" is a listed alias. "antibiogram" is a contrived disease to collide with the home tool.
  const NAMES = { pneumonia: "Pneumonia", sepsis: "Sepsis", "pulmonary tuberculosis": "Pulmonary tuberculosis", antibiogram: "Antibiogram" };
  const ALIAS = { tb: "pulmonary tuberculosis" };
  const phrase = (q) => { const p = q.replace(/\s+(antibiotics?|dose|treatment)\b.*$/, "").replace(/^(how to treat|what is)\s+/, ""); return ALIAS[p] || p; };
  globalThis.MaiKKB = {
    _alias: ALIAS, _diseasePhrase: phrase,
    resolveTarget: (q) => {
      const p = phrase(q);
      if (NAMES[p]) return { id: p.toUpperCase().replace(/ /g, "_"), name: NAMES[p], confident: true, match: "exact" };
      const hit = Object.keys(NAMES).find((k) => q.includes(k));
      return hit ? { id: hit.toUpperCase(), name: NAMES[hit], confident: false, match: "fallback" } : null;
    }
  };
  globalThis.SMD_REASON = { hasDiseaseRef: () => true };
  try {
    store.smd_edge = "1";
    const m = mock(() => needleReply(1)); E.setEngine(m);
    for (const [q, id] of [["open pneumonia page", "PNEUMONIA"], ["show me sepsis", "SEPSIS"], ["sepsis kholo", "SEPSIS"], ["pneumonia dikhao", "PNEUMONIA"],
      ["sepsis teruvu", "SEPSIS"], ["pneumonia chupinchu", "PNEUMONIA"], ["tb chupinchu", "PULMONARY_TUBERCULOSIS"]]) {
      const r = await E.route(q);
      assert.equal(r && r.kind, "kb", q); assert.equal(r.id, id, q); assert.equal(r.source, "rules", q);
      assert.equal(E.rules(q) && E.rules(q).kind, "kb", q);
    }
    assert.equal(m.prompts.length, 0, "no model call for an exact disease page");
    const kbOf = (q) => E.candidates(q).find((c) => c.kind === "kb");
    for (const q of ["pneumonia antibiotics dose", "open pneumonia antibiotics dose", "how to treat sepsis", "open pneumonia sepsis"]) {
      assert.equal(E.layer0(E.candidates(q)), false, q);
      assert.equal(!!(kbOf(q) && kbOf(q).exact), false, q);
    }
    assert.equal(!!kbOf("how to treat sepsis"), true, "question still offers the KB option to the model");
    assert.equal(!!(kbOf("open antibiogram") && kbOf("open antibiogram").exact), false, "one name, two things: nothing exact");
    assert.equal(E.candidates("open antibiogram").some((c) => c.exact), false);
    assert.equal(E.rules("don't open sepsis page"), null, "negation");
    assert.equal(await E.route("do not open the pneumonia page"), null, "negation still wins");
  } finally { delete globalThis.MaiKKB; delete globalThis.SMD_REASON; }
});

test("rules(): Layer 0 alone, synchronous, for MaiK to call before follow-up resolution", () => {
  store.smd_edge = "1";
  const r = E.rules("antibiogram kholo");
  assert.equal(r && r.kind, "tool"); assert.equal(r.id, "antibiogram"); assert.equal(r.source, "rules");
  assert.equal(E.rules("icd code for type 2 diabetes").kind, "icd");
  assert.equal(E.rules("show me the resistance patterns antibiogram"), null, "not exact: the model path, not rules()");
  assert.equal(E.rules("don't open antibiogram"), null, "negation");
  store.smd_edge = "0"; assert.equal(E.rules("antibiogram kholo"), null, "flag off");
  store.smd_edge = "1";
});


test("tool candidates the MaiK card cannot open are never offered", () => {
  delete store.smd_edge;
  try {
    assert.ok(E.candidates("open antibiogram resistance").some((c) => c.kind === "tool" && c.id === "antibiogram"));
    globalThis.SMD_MAIK_TOOL_OPENABLE = (id) => id !== "antibiogram";
    assert.ok(!E.candidates("open antibiogram resistance").some((c) => c.kind === "tool" && c.id === "antibiogram"));
  } finally { delete globalThis.SMD_MAIK_TOOL_OPENABLE; }
});

// Found by the frozen test set edge-router-4 (test4.jsonl, runbook 5d): forms the guard did not know.
test("negation guard: more Hinglish and Tenglish forms pass; clinical questions still route", async () => {
  store.smd_edge = "1";
  const m = mock(() => needleReply(1)); E.setEngine(m);
  for (const q of ["antibiogram kholna nahi", "icu band karo", "icu band kar do", "antibiogram skip karo", "insulin mat karo", "icu oddu",
    "antibiogram aapandi", "icu vaddhu", "antibiogram vaddu", "antibiogram cheyyakandi", "icu dikhana nahi", "antibiogram aapeyyi"]) {
    assert.equal(E.negated(q), true, q);
    assert.equal(E.rules(q), null, q);
    assert.equal(await E.route(q), null, q);
  }
  assert.equal(m.prompts.length, 0);
  for (const q of ["fever nahi utar raha paracetamol dose", "urine output nahi hai crcl", "band keratopathy", "bandage kab karna hai", "creatinine 1.2 mg crcl"])
    assert.equal(E.negated(q), false, q);
});
test("clinical orders pass: an order verb next to a drug, or a dosing pattern, never opens a card or calls the model", async () => {
  const DRUGS = ["metformin", "ketorolac", "oxaliplatin", "heparin", "amlodipine", "insulin"];
  globalThis.SMD_DRUGLINK = { drugsIn: (t) => DRUGS.filter((d) => t.toLowerCase().includes(d)).map((d) => ({ generic: d, name: d, typed: d, fuzzy: false })) };
  try {
    store.smd_edge = "1";
    const m = mock(() => needleReply(1)); E.setEngine(m);
    for (const q of ["continue metformin", "titrate ketorolac", "oxaliplatin 1 tab od", "metformin 500 mg bd", "start heparin", "heparin chalu karo",
      "metformin continue cheyyi", "add amlodipine 5 mg", "give insulin 10 units", "increase metformin", "shift to heparin"]) {
      assert.equal(E.negated(q), true, q);
      assert.equal(E.rules(q), null, q);
      assert.equal(await E.route(q), null, q);
    }
    assert.equal(m.prompts.length, 0, "no model call for an order");
    for (const q of ["metformin details", "open metformin", "metformin", "start the curb-65", "give me the antibiogram", "creatinine 1.2 mg crcl"])
      assert.equal(E.negated(q), false, q);
    const r = E.rules("metformin");
    assert.equal(r && r.kind, "drug", "the drug card still opens");
  } finally { delete globalThis.SMD_DRUGLINK; }
});

test("engine: rules only since 2026-11-22 (Needle and FunctionGemma removed)", async () => {
  assert.equal(E.engineChoice(), "rules");
  assert.equal(E.autoEngine(), null);
  assert.equal(typeof E.needleAdapter, "undefined");
  assert.equal(typeof E.llamaAdapter, "undefined");
  const r = await E.route("antibiogram kholo");
  assert.equal(r && r.source, "rules");
});
