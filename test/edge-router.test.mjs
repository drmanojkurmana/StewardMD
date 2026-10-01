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

test("flag OFF: route returns null and no model is called", async () => {
  delete store.smd_edge;
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

test("llamaAdapter: per-call grammar limited to the options offered, greedy, parses {option}", async () => {
  const calls = { load: [], gen: [], release: 0 };
  const plugin = { load: (a) => { calls.load.push(a); return Promise.resolve({ loaded: true }); },
    generate: (a) => { calls.gen.push(a); return Promise.resolve({ text: '{"option":2}' }); }, release: () => { calls.release++; return Promise.resolve(); } };
  const eng = E.llamaAdapter(plugin, { modelPath: "/m/functiongemma.gguf" });
  assert.equal(eng.available(), true);
  assert.equal(E.llamaAdapter(plugin, {}).available(), false, "no model path, not available");
  const r = await eng.complete({ prompt: "x\nOptions:\n1. a\n2. b\n3. c\n0. none of these", nOptions: 3 });
  assert.deepEqual(r, { option: 2 });
  assert.equal(calls.load[0].path, "/m/functiongemma.gguf");
  assert.equal(calls.gen[0].temperature, 0); assert.equal(calls.gen[0].stream, false);
  assert.equal(calls.gen[0].grammar, 'root ::= "{\\"option\\":" [0-3] "}"', "only 0..3 can be produced");
  assert.equal(E.optionFrom(r).option, 2);
  await eng.release(); assert.equal(calls.release, 1);
});

test("bakeoff: production runtime contract, one line per row, timeouts and garbage recorded as no option", async () => {
  const rows = [{ id: "a", prompt: "p1", n_options: 2 }, { id: "b", prompt: "slow", n_options: 2 }, { id: "c", prompt: "junk", n_options: 2 }];
  const eng = { available: () => true, load: () => Promise.resolve(), reset: () => Promise.resolve(), release: () => Promise.resolve(),
    complete: (t) => t.prompt === "slow" ? new Promise((r) => setTimeout(() => r(needleReply(1)), 300)) : Promise.resolve(t.prompt === "junk" ? { nonsense: 1 } : needleReply(2, 0.8)) };
  const out = await E.bakeoff(rows, eng, { deadlineMs: 60 });
  assert.equal(out.length, 3);
  assert.deepEqual([out[0].id, out[0].option, out[0].confidence, out[0].status], ["a", 2, 0.8, "ok"]);
  assert.equal(out[1].option, null); assert.equal(out[1].status, "timeout");
  assert.equal(out[2].option, null); assert.equal(out[2].status, "invalid:unparseable", "the slow row did not make the next one busy");
});

test("needleAdapter: configure (not init), tuned weights path, uncalibrated confidence dropped, kill only when killable", async () => {
  const calls = [];
  const plugin = { load: (a) => { calls.push(["load", a]); return Promise.resolve(); }, configure: (a) => { calls.push(["configure", JSON.parse(a.tools)[0].name]); return Promise.resolve(); },
    complete: () => Promise.resolve({ json: JSON.stringify(needleReply(3, 0.42)) }), reset: () => Promise.resolve(), kill: () => Promise.resolve() };
  const a = E.needleAdapter(plugin, { weightsPath: "/w/tuned.cact", calibrated: false, killable: false });
  await a.load();
  assert.deepEqual(calls, [["load", { path: "/w/tuned.cact" }], ["configure", "choose_option"]]);
  const r = await a.complete({ prompt: "p" });
  assert.equal(r.function_calls[0].arguments.option, 3); assert.equal(r.confidence, null, "uncalibrated: no confidence");
  assert.equal(a.kill, undefined, "not killable: the runtime waits a stuck call out");
  assert.equal(typeof E.needleAdapter(plugin, { killable: true }).kill, "function");
  assert.equal(E.needleAdapter(plugin, {}).kill, undefined, "no Capacitor platform in Node: not android, not killable");
});
