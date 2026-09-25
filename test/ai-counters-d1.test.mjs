/* ai-counters-d1.test.mjs - hot global AI rollups move to atomic D1 counters (T53).
 * Uses node:sqlite behind a minimal D1-shaped shim (prepare/bind/run/first/all/batch). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordAiUsage, globalUsageReport } from "../functions/_ai_usage.js";
import { recordFeedback, getFeedback, getFeedbackAgg, FEEDBACK_KEY } from "../functions/_maik_feedback.js";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { await new Promise((r) => setTimeout(r, 1)); db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}
/* A KV whose get/put yield, like the real thing: concurrent read-modify-writes interleave. */
function slowKv() {
  const m = new Map();
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  return { _m: m, get: async (k, t) => { await tick(); return m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null; }, put: async (k, v) => { await tick(); m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
const NOW = Date.parse("2026-09-25T10:00:00Z");
const rec = (i) => ({ doctorId: "em:doc" + (i % 5) + "@x.com", module: "maik", model: "gemini-3.5-flash", status: "success", estCostInr: 0.5, totalTokens: 10 });

test("with D1: 60 concurrent records are counted exactly (KV lost updates)", { skip: SKIP }, async () => {
  const env = { UPDATES_DB: d1() };
  const kv = slowKv();
  await Promise.all(Array.from({ length: 60 }, (_, i) => recordAiUsage(env, kv, rec(i), NOW)));
  const r = await globalUsageReport(env, kv, NOW);
  assert.equal(r.req, 60);
  assert.equal(r.estCostInr, 30);
  assert.equal(r.byModule.maik, 60);
  assert.equal(r.byModel["gemini-3.5-flash"], 60, "model names with dots survive the flat keys");
  assert.equal(r.activeDoctors, 5);
  assert.equal(kv._m.has("aiu:global:2026-09-25"), false, "the hot KV key is no longer written");
});

test("without D1 the KV fallback still works (and is what loses updates)", async () => {
  const kv = slowKv();
  await Promise.all(Array.from({ length: 30 }, (_, i) => recordAiUsage({}, kv, rec(i), NOW)));
  const r = await globalUsageReport({}, kv, NOW);
  assert.ok(r.req >= 1 && r.req <= 30, "KV path still reports: " + r.req);
});

test("reports sum pre-existing KV (deploy day) and D1", { skip: SKIP }, async () => {
  const env = { UPDATES_DB: d1() };
  const kv = slowKv();
  await kv.put("aiu:global:2026-09-25", JSON.stringify({ req: 7, cost: 1, fail: 0, byModule: { maik: 7 }, byModel: {}, docs: { a: 7 } }));
  await recordAiUsage(env, kv, rec(0), NOW);
  const r = await globalUsageReport(env, kv, NOW);
  assert.equal(r.req, 8);
  assert.equal(r.byModule.maik, 8);
});

test("feedback is written to shards and read back merged with the legacy key", async () => {
  const kv = slowKv();
  await kv.put(FEEDBACK_KEY, JSON.stringify([{ id: "old", ts: 1, helpful: "up", question: "legacy" }]));
  await kv.put(FEEDBACK_KEY.replace("recent", "agg"), JSON.stringify({ up: 1, down: 0, withReason: 0, total: 1 }));
  for (let i = 0; i < 12; i++) await recordFeedback(kv, { helpful: i % 2 ? "up" : "down", question: "q" + i }, NOW + i);
  const list = await getFeedback(kv);
  assert.equal(list.length, 13);
  assert.equal(list[0].question, "q11", "newest first across shards");
  const agg = await getFeedbackAgg(kv);
  assert.equal(agg.total, 13);
  assert.ok([...kv._m.keys()].some((k) => /^maikfb:recent:\d$/.test(k)));
});
