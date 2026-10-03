/* test/edge-runtime.test.mjs — the Edge runtime contract with a mock engine.
 * node --test test/edge-runtime.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../edge-runtime.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mockEngine(o = {}) {
  const e = { loads: 0, calls: 0, resets: 0, kills: 0, delay: o.delay || 5, killable: !!o.killable };
  e.available = () => o.available !== false;
  e.load = () => { e.loads++; return sleep(o.loadMs || 1); };
  e.complete = (task) => { e.calls++; const d = typeof e.delay === "function" ? e.delay(task) : e.delay; return sleep(d).then(() => ({ echo: task.prompt })); };
  e.reset = () => { e.resets++; return Promise.resolve(); };
  if (o.killable) e.kill = () => { e.kills++; return Promise.resolve(); };
  return e;
}

test("ok path returns the engine result", async () => {
  const rt = R.create({ engine: mockEngine() });
  const r = await rt.run({ prompt: "a" });
  assert.equal(r.status, "ok"); assert.equal(r.result.echo, "a");
});

test("unavailable engine resolves (never rejects)", async () => {
  const rt = R.create({ engine: mockEngine({ available: false }) });
  assert.equal((await rt.run({ prompt: "a" })).status, "unavailable");
});

test("queue is 1 running + 1 waiting; a newer request supersedes the waiting one", async () => {
  const eng = mockEngine({ delay: 40 });
  const rt = R.create({ engine: eng });
  await rt.run({ prompt: "warm" });
  const a = rt.run({ prompt: "a" }); await sleep(5);
  const b = rt.run({ prompt: "b" }); await sleep(1);
  const c = rt.run({ prompt: "c" });
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(ra.status, "ok"); assert.equal(rb.status, "superseded"); assert.equal(rc.status, "ok");
  assert.equal(rc.result.echo, "c");
});

test("deadline on a non-killable engine: timeout now, busy until the stuck call returns", async () => {
  const eng = mockEngine({ delay: (t) => (t.prompt === "slow" ? 120 : 5) });
  const rt = R.create({ engine: eng, deadlineMs: 30 });
  await rt.run({ prompt: "warm" });
  const t0 = Date.now();
  const r = await rt.run({ prompt: "slow" });
  assert.equal(r.status, "timeout");
  assert.ok(Date.now() - t0 < 100, "the caller is answered at the deadline, not when the engine finishes");
  assert.equal((await rt.run({ prompt: "x" })).status, "busy");
  await sleep(120);
  assert.equal((await rt.run({ prompt: "y" })).status, "ok", "accepts work again once the stuck call returns");
});

test("deadline on a killable engine: kill, then the next call is a cold load", async () => {
  const eng = mockEngine({ killable: true, delay: (t) => (t.prompt === "slow" ? 200 : 5) });
  const rt = R.create({ engine: eng, deadlineMs: 30 });
  await rt.run({ prompt: "warm" });
  assert.equal((await rt.run({ prompt: "slow" })).status, "timeout");
  assert.equal(eng.kills, 1);
  const loadsBefore = eng.loads;
  assert.equal((await rt.run({ prompt: "next" })).status, "ok");
  assert.equal(eng.loads, loadsBefore + 1);
});

test("patient switch: in-flight result is stale, engine reset before the next call", async () => {
  const eng = mockEngine({ delay: 30 });
  const rt = R.create({ engine: eng });
  rt.setSession("bed-12");
  await rt.run({ prompt: "warm" });
  const p = rt.run({ prompt: "bed 12 request" });
  await sleep(5);
  rt.setSession("bed-14");
  assert.equal((await p).status, "stale", "a bed-12 result never reaches bed 14");
  const resetsBefore = eng.resets;
  assert.equal((await rt.run({ prompt: "bed 14 request" })).status, "ok");
  assert.equal(eng.resets, resetsBefore + 1);
});

test("patient switch drops the waiting job too", async () => {
  const rt = R.create({ engine: mockEngine({ delay: 30 }) });
  await rt.run({ prompt: "warm" });
  const a = rt.run({ prompt: "a" }); await sleep(2);
  const b = rt.run({ prompt: "b" }); await sleep(1);
  rt.setSession("other");
  assert.equal((await b).status, "stale");
  assert.equal((await a).status, "stale");
});

test("back-off: low memory, heat or another heavy job means skipped", async () => {
  let mem = true, heat = true, other = false;
  const rt = R.create({ engine: mockEngine(), env: { memoryOk: () => mem, thermalOk: () => heat, othersBusy: () => other } });
  mem = false; assert.equal((await rt.run({ prompt: "a" })).status, "skipped");
  mem = true; heat = false; assert.equal((await rt.run({ prompt: "a" })).status, "skipped");
  heat = true; other = true; assert.equal((await rt.run({ prompt: "a" })).status, "skipped");
  other = false; assert.equal((await rt.run({ prompt: "a" })).status, "ok");
});

test("cold load failure is 'unavailable', not a crash", async () => {
  const eng = mockEngine(); eng.load = () => Promise.reject(new Error("no weights"));
  const rt = R.create({ engine: eng });
  assert.equal((await rt.run({ prompt: "a" })).status, "unavailable");
});

test("engine error resolves 'error' and the queue keeps working", async () => {
  const eng = mockEngine(); let n = 0;
  eng.complete = () => (++n === 2 ? Promise.reject(new Error("boom")) : Promise.resolve({ ok: 1 }));
  const rt = R.create({ engine: eng });
  assert.equal((await rt.run({})).status, "ok");
  assert.equal((await rt.run({})).status, "error");
  assert.equal((await rt.run({})).status, "ok");
});

test("the runtime never touches the network", async () => {
  const orig = globalThis.fetch; let hits = 0;
  globalThis.fetch = () => { hits++; return Promise.reject(new Error("blocked")); };
  try {
    const rt = R.create({ engine: mockEngine() });
    await rt.run({ prompt: "a" }); rt.setSession("s"); await rt.run({ prompt: "b" }); await rt.release();
    assert.equal(hits, 0);
  } finally { globalThis.fetch = orig; }
});
