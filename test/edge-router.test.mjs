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
