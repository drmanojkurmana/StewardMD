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
  assert.equal(E.needleAdapter({}, { agree: true }).agree, true);
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
  assert.equal(calls.load[0].nThreadsBatch, 4, "prefill on the big cores only, not every core");
  assert.equal(calls.gen[0].temperature, 0); assert.equal(calls.gen[0].stream, false);
  assert.equal(calls.gen[0].grammar, 'root ::= "{\\"option\\":" [0-3] "}"', "only 0..3 can be produced");
  assert.equal(E.optionFrom(r).option, 2);
  await eng.release(); assert.equal(calls.release, 1);
});

test("llamaAdapter: FunctionGemma load args fit the +400 MB budget (small context, small batches, q8 KV)", async () => {
  const load = [];
  const plugin = { load: (a) => { load.push(a); return Promise.resolve({ loaded: true }); }, generate: () => Promise.resolve({ text: '{"option":1}' }) };
  await E.llamaAdapter(plugin, { modelPath: "/m/fg.gguf" }).load();
  assert.deepEqual(load[0], { path: "/m/fg.gguf", nCtx: 512, nBatch: 64, nUbatch: 64, nThreadsBatch: 4, kvQ8: true });
});

test("llamaAdapter: forced prefix + digit pick, confidence from the plugin, grammar kept as the fallback", async () => {
  let reply = { text: '{"option":1}', p: 0.42 };
  const gen = [];
  const plugin = { load: () => Promise.resolve({ loaded: true }), generate: (a) => { gen.push(a); return Promise.resolve(reply); } };
  const eng = E.llamaAdapter(plugin, { modelPath: "/m/fg.gguf" });
  const r = await eng.complete({ prompt: "x\nOptions:\n1. a\n2. b\n0. none of these", nOptions: 2 });
  assert.deepEqual(gen[0].pick, { prefix: '{"option":', choices: ["0", "1", "2"], suffix: "}" }, "same text as the llama-json target");
  assert.equal(gen[0].grammar, 'root ::= "{\\"option\\":" [0-2] "}"', "an older plugin ignores pick and runs the grammar");
  assert.deepEqual(r, { option: 1, confidence: 0.42 });
  assert.deepEqual(E.optionFrom(r), { ok: true, option: 1, confidence: 0.42 }, "below the 0.5 floor, so the router passes");
  reply = { text: '{"option":2}' };   // grammar fallback: no p, no confidence
  assert.deepEqual(await eng.complete({ prompt: "y", nOptions: 2 }), { option: 2 });
  await eng.complete({ prompt: "z", nOptions: 9 });
  assert.equal(gen[2].pick.choices.length, 6, "never more digits than MAX_OPTIONS allows");
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

// Pixel 9, 2026-10-04: a loaded engine that only ever sees needle_complete never returns from its
// ~49th-57th call (2 cores spinning for 10+ min); needle_reset does not prevent it, needle_init does.
test("needleAdapter: every complete() starts from a fresh needle_init (configure), not just the first", async () => {
  const calls = [];
  const plugin = { load: () => { calls.push("load"); return Promise.resolve(); }, configure: () => { calls.push("configure"); return Promise.resolve(); },
    complete: () => { calls.push("complete"); return Promise.resolve({ json: JSON.stringify(needleReply(1, 0.9)) }); } };
  const a = E.needleAdapter(plugin, {});
  await a.load();
  await a.complete({ prompt: "p1" }); await a.complete({ prompt: "p2" }); await a.complete({ prompt: "p3" });
  assert.deepEqual(calls, ["load", "configure", "configure", "complete", "configure", "complete", "configure", "complete"]);
});

// Pixel 9, OTA v174: :edge died outside the runtime (low-memory killer; Needle.kill() by hand) and
// restarted empty. Every later configure failed "needle_init: no model loaded" and Edge stayed dead
// until the app restarted, because the runtime still believed loaded = true.
test("needleAdapter + runtime: a restarted :edge with no weights reloads once and the call still runs", async () => {
  let model = false, loads = 0, configures = 0;
  const plugin = {
    load: () => { loads++; model = true; return Promise.resolve({ rc: 0 }); },
    configure: () => { configures++; if (!model) { const e = new Error("needle_init: no model loaded"); e.code = "ENGINE_ERROR"; return Promise.reject(e); } return Promise.resolve({ rc: 0 }); },
    complete: () => Promise.resolve({ json: JSON.stringify(needleReply(1, 0.9)) })
  };
  const rt = globalThis.SMD_EDGE_RUNTIME.create({ engine: E.needleAdapter(plugin, { killable: true }) });
  assert.equal((await rt.run({ prompt: "p1" })).status, "ok");
  assert.equal(loads, 1);
  model = false;                                      // process died and came back with no model
  const r = await rt.run({ prompt: "p2" });
  assert.equal(r.status, "ok", "reloaded and ran, not error");
  assert.equal(r.result.function_calls[0].arguments.option, 1);
  assert.equal(loads, 2);
  assert.equal(rt.status().loaded, true);
  // No loop: weights that never stick give one reload attempt, then the call gives up.
  plugin.load = () => { loads++; return Promise.resolve({ rc: 0 }); };
  model = false; const before = loads;
  assert.equal((await rt.run({ prompt: "p3" })).status, "unavailable", "the reload itself fails: rules path");
  assert.equal(loads - before, 1, "exactly one reload per call");
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

test("back-off (plan A0.5): low memory, MaiK generating or Whisper decoding skip the model; heat only warns", async () => {
  store.smd_edge = "1";
  const pick = (task) => needleReply(parseInt(task.prompt.split("\n").find((l) => /open: Antibiogram/.test(l)), 10));
  const ask = "show me the resistance patterns antibiogram";
  let dev = {};
  globalThis.Capacitor = { Plugins: { Needle: { available: () => Promise.resolve(dev) } } };
  const reads = async (d) => { dev = d; await E.refreshDevice(); };
  const runs = async () => { const m = mock(pick); E.setEngine(m); const r = await E.route(ask); return { r, calls: m.prompts.length }; };
  try {
    await reads({ thermal: 0, lowMemory: false, availMB: 900 });
    let o = await runs(); assert.equal(o.calls, 1); assert.equal(o.r && o.r.id, "antibiogram", "all clear: the model answers");
    for (const t of [3, 4]) {
      await reads({ thermal: t, lowMemory: false, availMB: 900, rendererGone: false }); o = await runs();
      assert.equal(o.calls, 1, "owner 2026-10-04: a hot phone still runs the model"); assert.equal(E.hot(), true, "and MaiK shows the hot note");
    }
    await reads({ thermal: 0 }); assert.equal(E.hot(), false);
    for (const d of [{ thermal: 0, lowMemory: true }, { lowMemory: false, availMB: 200 }, { rendererGone: true }]) {
      await reads(d); o = await runs();
      assert.equal(o.calls, 0, "skipped for " + JSON.stringify(d)); assert.equal(o.r, null, "the caller continues (rules / MaiK)");
    }
    await reads({ thermal: 0, lowMemory: false, availMB: 600, rendererGone: true });
    assert.equal((await runs()).calls, 0, "renderer gone: Edge is off for the session even with memory and heat fine");
    assert.equal(E.backoff().device.rendererGone, true);
    await reads({ thermal: 2, lowMemory: false, availMB: 600, rendererGone: false }); assert.equal((await runs()).calls, 1, "MODERATE is not SEVERE");
    globalThis.SMD_MAIK_LOCAL = { queueState: () => ({ running: true, waiting: 0 }) };
    assert.equal((await runs()).calls, 0, "never during a MaiK generation");
    globalThis.SMD_MAIK_LOCAL = { queueState: () => ({ running: false, waiting: 2 }) };
    assert.equal((await runs()).calls, 1, "queued MaiK work is not generating yet");
    globalThis.SMD_NATIVE = { whisperBusy: () => true };
    assert.equal((await runs()).calls, 0, "never during a Whisper decode");
    globalThis.SMD_NATIVE = { whisperBusy: () => false };
    assert.equal((await runs()).calls, 1);
    assert.deepEqual(Object.keys(E.backoff()).sort(), ["device", "memoryOk", "othersBusy", "thermalOk"]);
    // Layer 0 (rules) is untouched by the back-off: an exact name still answers while busy.
    globalThis.SMD_NATIVE = { whisperBusy: () => true };
    const m = mock(pick); E.setEngine(m);
    const r0 = await E.route("open antibiogram");
    assert.equal(r0 && r0.source, "rules"); assert.equal(m.prompts.length, 0);
  } finally {
    delete globalThis.Capacitor; delete globalThis.SMD_MAIK_LOCAL; delete globalThis.SMD_NATIVE;
    await E.refreshDevice(); dev = {};
  }
});

test("renderer gone before the first request (A0.5): the FIRST model-routed request already skips the model", async () => {
  // A fresh SMD_EDGE, as after the activity recreate: no device reading taken yet.
  const prev = globalThis.SMD_EDGE;
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "edge-router.js"), "utf8"), { filename: "edge-router.js" });
  const F = globalThis.SMD_EDGE;
  store.smd_edge = "1";
  globalThis.Capacitor = { Plugins: { Needle: { available: () => Promise.resolve({ thermal: 0, lowMemory: false, availMB: 1800, rendererGone: true }) } } };
  try {
    const m = mock(() => needleReply(1)); F.setEngine(m);
    assert.equal(await F.route("show me the resistance patterns antibiogram"), null);
    assert.equal(m.prompts.length, 0, "first request: no model call");
    assert.equal(F.backoff().device.rendererGone, true);
    const r = await F.route("antibiogram kholo");
    assert.equal(r && r.source, "rules", "rules still answer"); assert.equal(m.prompts.length, 0);
  } finally {
    delete globalThis.Capacitor; globalThis.SMD_EDGE = prev;
  }
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

// Engine choice (owner, 2026-10-04): smd_edge_engine = needle (default) | functiongemma | rules.
function nativeWith({ fgFile = false } = {}) {
  const calls = { needleRelease: 0, llamaLoad: [] };
  const Needle = { available: () => Promise.resolve({ thermal: 0, lowMemory: false, availMB: 4000 }), load: () => Promise.resolve(),
    configure: () => Promise.resolve(), complete: () => Promise.resolve({ json: JSON.stringify(needleReply(1, 0.9)) }), release: () => { calls.needleRelease++; return Promise.resolve(); } };
  const Llama = { load: (a) => { calls.llamaLoad.push(a); return Promise.resolve({ loaded: true }); },
    generate: () => Promise.resolve({ text: '{"option":1}', p: 0.9 }), release: () => Promise.resolve() };
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { Needle, Llama } };
  globalThis.SMD_MAIK_MODELS = { installedCached: (id) => fgFile && id === "edge-functiongemma", pathFor: () => Promise.resolve("/data/maik-models/functiongemma-270m-it-q8_0.gguf") };
  return calls;
}
function cleanNative() { delete globalThis.Capacitor; delete globalThis.SMD_MAIK_MODELS; delete globalThis.SMD_LLAMA_HOLDER; delete store.smd_edge_engine; E.setEngine(null); }

test("engine choice: default is needle", () => {
  delete store.smd_edge; delete store.smd_edge_engine; nativeWith();
  try {
    assert.equal(E.engineChoice(), "needle");
    assert.equal(E.autoEngine().name, "needle");
    store.smd_edge_engine = "nonsense";
    assert.equal(E.engineChoice(), "needle", "an unknown value is the default");
  } finally { cleanNative(); }
});

test("engine choice: functiongemma with no file on the phone gives no engine, and the rules still answer", async () => {
  delete store.smd_edge; nativeWith({ fgFile: false });
  try {
    assert.equal(E.setEngineChoice("functiongemma"), "functiongemma");
    assert.equal(E.autoEngine(), null);
    assert.equal(E.engineName(), null); assert.equal(E.available(), false);
    const r = await E.route("antibiogram kholo");
    assert.equal(r && r.source, "rules"); assert.equal(r.id, "antibiogram");
  } finally { cleanNative(); }
});

test("engine choice: functiongemma with the file gives the llama adapter on the downloaded path", async () => {
  delete store.smd_edge; const calls = nativeWith({ fgFile: true });
  try {
    E.setEngineChoice("functiongemma");
    assert.equal(E.engineName(), "llama");
    const r = await E.autoEngine().complete({ prompt: "x", nOptions: 2 });
    assert.deepEqual(r, { option: 1, confidence: 0.9 });
    assert.equal(calls.llamaLoad[0].path, "/data/maik-models/functiongemma-270m-it-q8_0.gguf");
    assert.equal(globalThis.SMD_LLAMA_HOLDER, "edge", "MaiK sees another holder and reloads its pack");
  } finally { cleanNative(); }
});

test("engine choice: rules gives no engine", () => {
  delete store.smd_edge; nativeWith({ fgFile: true });
  try {
    store.smd_edge_engine = "rules";
    assert.equal(E.autoEngine(), null);
    E.setEngineChoice("rules"); assert.equal(E.engineName(), null);
  } finally { cleanNative(); }
});

test("setEngineChoice switches live, releasing the old engine", async () => {
  delete store.smd_edge; const calls = nativeWith({ fgFile: true });
  try {
    E.setEngineChoice("needle"); assert.equal(E.engineName(), "needle");
    E.setEngineChoice("functiongemma"); assert.equal(E.engineName(), "llama");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.needleRelease, 1, "Needle released on the switch");
    E.setEngineChoice("rules"); assert.equal(E.engineName(), null);
    E.setEngineChoice("needle"); assert.equal(E.engineName(), "needle");
    assert.equal(store.smd_edge_engine, "needle");
  } finally { cleanNative(); }
});

test("llamaAdapter never picks with, or releases, a model MaiK loaded", async () => {
  const calls = { gen: 0, release: 0 };
  let maikTakes = false;
  const plugin = { load: () => { if (maikTakes) globalThis.SMD_LLAMA_HOLDER = "maik"; return Promise.resolve(); },
    generate: () => { calls.gen++; return Promise.resolve({ text: '{"option":1}' }); }, release: () => { calls.release++; return Promise.resolve(); } };
  try {
    const eng = E.llamaAdapter(plugin, { modelPath: "/m/fg.gguf" });
    maikTakes = true;   // MaiK loads its pack while ours is loading
    await assert.rejects(eng.complete({ prompt: "x", nOptions: 2 }), /taken by MaiK/);
    assert.equal(calls.gen, 0, "no pick with MaiK's model");
    await eng.release(); assert.equal(calls.release, 0, "MaiK's pack is not unloaded");
    maikTakes = false;
    await eng.complete({ prompt: "x", nOptions: 2 }); assert.equal(calls.gen, 1, "reloads and picks once it holds the plugin");
    globalThis.SMD_LLAMA_HOLDER = "maik";   // MaiK answered in between
    await eng.complete({ prompt: "y", nOptions: 2 }); assert.equal(globalThis.SMD_LLAMA_HOLDER, "edge", "reloaded, not reused");
  } finally { delete globalThis.SMD_LLAMA_HOLDER; }
});
