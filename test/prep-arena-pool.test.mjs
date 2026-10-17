/* Arena question pool: subjects whose questions live only in overlays used to leave a pairing with nothing to ask
 * (the Worker told both players "nobody"); drawFromPool fills the 7 questions from prep-bank/arena/pool-<exam>.json. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawFromPool, drawItems, bankFrom } from "../functions/_prep-arena.js";
import { usable } from "../tools/prep-arena-pool.mjs";

const item = (i, s) => ({ id: s + i, q: "A stem number " + i + " long enough to be a real question", o: ["a", "b", "c", "d"], a: i % 4, s, m: "m" + (i % 3) });
const poolOf = (n, subs) => ({ v: 1, exam: "neet-ss", items: Array.from({ length: n }, (_, i) => item(i, subs[i % subs.length])) });
const bankWith = (pool) => ({ pool: async () => pool, index: async () => null, module: async () => null });

test("a bank with no questions yields none, the pool yields seven spread across subjects", async () => {
  const bank = bankWith(poolOf(60, ["ss-a", "ss-b", "ss-c", "ss-d"]));
  assert.equal((await drawItems(bank, "neet-ss", 7, "seed")).length, 0);
  const got = await drawFromPool(bank, "neet-ss", 7, "seed");
  assert.equal(got.length, 7);
  assert.equal(new Set(got.map((x) => x.id)).size, 7, "no repeats");
  assert.ok(new Set(got.map((x) => x.s)).size >= 4, "spread over the subjects");
  for (const it of got) assert.ok(it.o.length === 4 && it.a >= 0 && it.a < 4);
});
test("the draw is deterministic for a battle id and differs between battles", async () => {
  const bank = bankWith(poolOf(200, ["ss-a", "ss-b", "ss-c"]));
  const a = await drawFromPool(bank, "neet-ss", 7, "b1"), b = await drawFromPool(bank, "neet-ss", 7, "b1"), c = await drawFromPool(bank, "neet-ss", 7, "b2");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map((x) => x.id), c.map((x) => x.id));
});
test("no pool, or fewer than n usable questions, gives none (the Worker then says nobody, as before)", async () => {
  assert.deepEqual(await drawFromPool({ pool: async () => null }, "neet-ss", 7, "x"), []);
  assert.deepEqual(await drawFromPool({}, "neet-ss", 7, "x"), []);
  assert.deepEqual(await drawFromPool(bankWith(poolOf(5, ["a"])), "neet-ss", 7, "x"), []);
  const bad = { v: 1, items: Array.from({ length: 20 }, (_, i) => ({ ...item(i, "s"), o: ["only", "two"] })) };
  assert.deepEqual(await drawFromPool(bankWith(bad), "neet-ss", 7, "x"), []);
});
test("bankFrom reads the pool from R2 and ignores unsafe exam names", async () => {
  const seen = [];
  const r2 = { get: async (k) => { seen.push(k); return k === "prep-bank/arena/pool-neet-ss.json" ? { text: async () => JSON.stringify(poolOf(10, ["a"])) } : null; } };
  const bank = bankFrom(r2);
  assert.equal((await bank.pool("neet-ss")).items.length, 10);
  assert.equal(await bank.pool("../secret"), null);
  assert.ok(!seen.some((k) => k.includes("..")));
});
test("the pool builder keeps only usable text questions", () => {
  const ok = { q: "A patient presents with a long enough stem about fever and rash", o: ["a", "b", "c", "d"], a: 2 };
  assert.ok(usable(ok));
  assert.ok(!usable({ ...ok, img: "x.webp" }));
  assert.ok(!usable({ ...ok, q: "Identify the finding shown in the ECG above this line please" }));
  assert.ok(!usable({ ...ok, o: ["a", "b", "c"] }));
  assert.ok(!usable({ ...ok, a: 4 }));
  assert.ok(!usable({ ...ok, q: "short" }));
});
