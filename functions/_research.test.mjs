import assert from "node:assert";
import test from "node:test";

import { normalizeResearchQuery, researchCacheKey, researchConsumesSlot, RESEARCH_CACHE_PREFIX, RESEARCH_PUBTYPE_FILTER } from "../functions/_research.js";
import { sha256hex } from "../functions/_usage.js";
import { AI_MODULES, moduleDailyLimit, resolveLimit, checkModuleQuota, gateAndCount } from "../functions/_ai_usage.js";

// Minimal KV double: module counters are plain strings (Number-parsed); json for the rest.
function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    _m: m,
  };
}
const DAY = "2026-07-31T10:00:00.000Z"; // fixed "now" so the day-key is stable
// Per-module daily caps are OPT-IN since #596 (launch default = unlimited for every account),
// so the cap tests below must ask for them explicitly, exactly as test/ai-usage.test.mjs does.
const CAPS_ON = { MAIK_ENFORCE_CAPS: "1" };

// ── Registry ────────────────────────────────────────────────────────────────
test("AI_MODULES.research is registered with a 2/day cap in the MaiK group", () => {
  const r = AI_MODULES.research;
  assert.ok(r, "research module missing from AI_MODULES");
  assert.equal(r.id, "research");
  assert.equal(r.daily, 2);
  assert.equal(r.group, "MaiK");
  assert.equal(r.provider, "vertex");
  assert.equal(r.label, "Evidence Review");
});
test("research daily limit honours env AI_LIMIT_RESEARCH + admin KV override", () => {
  assert.equal(moduleDailyLimit({}, "research"), 2);
  assert.equal(moduleDailyLimit({ AI_LIMIT_RESEARCH: "5" }, "research"), 5);
  assert.equal(resolveLimit({}, "research", { research: 1 }), 1); // admin KV override wins
});

// ── Normalize + cache key (the "normalize+sha" the handler uses) ─────────────
test("normalizeResearchQuery collapses trivial variants to one key input", () => {
  const a = normalizeResearchQuery("  Sepsis   FLUIDS? ");
  const b = normalizeResearchQuery("sepsis fluids");
  const c = normalizeResearchQuery("Sepsis fluids.");
  assert.equal(a, "sepsis fluids");
  assert.equal(a, b);
  assert.equal(a, c);
});
test("researchCacheKey builds the maik:research:v1:<hash> key deterministically", async () => {
  assert.equal(RESEARCH_CACHE_PREFIX, "maik:research:v1:");
  const h1 = await sha256hex(normalizeResearchQuery("Sepsis fluids?"));
  const h2 = await sha256hex(normalizeResearchQuery("  sepsis   fluids "));
  assert.equal(h1, h2, "normalized variants must hash identically");
  const key = researchCacheKey(h1);
  assert.ok(key.startsWith("maik:research:v1:"));
  assert.equal(key, "maik:research:v1:" + h1);
});
test("RESEARCH_PUBTYPE_FILTER keeps evidence retrieval to guideline/SR/meta-analysis", () => {
  assert.match(RESEARCH_PUBTYPE_FILTER, /Practice Guideline\[ptyp\]/);
  assert.match(RESEARCH_PUBTYPE_FILTER, /systematic review\[ptyp\]/);
  assert.match(RESEARCH_PUBTYPE_FILTER, /Meta-Analysis\[ptyp\]/);
});

// ── 2/day cap via the existing usage machinery ──────────────────────────────
test("gateAndCount enforces exactly 2 research requests per user per day", async () => {
  const kv = fakeKv();
  const g1 = await gateAndCount(CAPS_ON, kv, "research", "doc1", "unknown", DAY);
  const g2 = await gateAndCount(CAPS_ON, kv, "research", "doc1", "unknown", DAY);
  const g3 = await gateAndCount(CAPS_ON, kv, "research", "doc1", "unknown", DAY);
  assert.equal(g1.ok, true);
  assert.equal(g2.ok, true);
  assert.equal(g3.ok, false, "3rd request must be blocked");
  assert.equal(g3.reason, "module-daily");
  assert.equal(g3.limit, 2);
});

// ── The behaviour the handler relies on: a cache HIT must NOT burn a slot ────
test("cache HIT is served without consuming a daily slot; MISS at cap is blocked", async () => {
  const key = researchCacheKey(await sha256hex(normalizeResearchQuery("dka fluids")));
  // Seed the doctor at the cap (used = 2 today) AND a cached answer for this query.
  const kv = fakeKv({
    "aiu:mod:doc9:research:2026-07-31": "2",
    [key]: JSON.stringify({ text: "cached synthesis", sources: [{ n: 1, title: "X (2021)" }] }),
  });

  // Handler decision: check cache FIRST. It hits -> serve, do NOT gate/count.
  const cached = await kv.get(key, "json");
  assert.ok(cached && cached.text, "cache should hit");
  assert.equal(researchConsumesSlot(!!cached), false, "a cache hit must not consume a slot");
  // Read-only quota check for the "used of 2" counter must NOT increment.
  const q = await checkModuleQuota(CAPS_ON, kv, "research", "doc9", DAY);
  assert.equal(q.used, 2);
  assert.equal(await kv.get("aiu:mod:doc9:research:2026-07-31"), "2", "counter unchanged on cache hit");

  // A genuine MISS at the cap DOES gate -> blocked (no slot beyond the cap is granted).
  assert.equal(researchConsumesSlot(false), true);
  const miss = await gateAndCount(CAPS_ON, kv, "research", "doc9", "unknown", DAY);
  assert.equal(miss.ok, false, "a miss at the cap must be blocked");
  assert.equal(miss.reason, "module-daily");
});

// The launch default is the other half of the contract: with caps opt-in, research is unlimited.
test("launch default (no MAIK_ENFORCE_CAPS): research is unlimited, not capped at 2", async () => {
  const kv = fakeKv();
  const q = await checkModuleQuota({}, kv, "research", "doc2", DAY);
  assert.equal(q.ok, true);
  assert.equal(q.unlimited, true);
  assert.equal(q.limit, 0);
});
