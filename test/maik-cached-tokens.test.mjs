/* Implicit prompt caching (audit section 7, 2026-09-25): Vertex bills cached input tokens at a 90%
 * discount and reports them as usageMetadata.cachedContentTokenCount. recordUsage prices them at 10%
 * and counts them so the admin report shows the hit rate. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordUsage, usageConfig } from "../functions/_usage.js";

function kv() {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }), _m: m };
}
function gate() {
  return { meter: true, store: kv(), cfg: usageConfig({}), env: {}, id: "t", costKey: "t", type: "general", _day: "2026-09-25", _month: "2026-09",
    u: { general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: 0 }, m: { tokens: 0 }, g: { cost: 0, req: 0, blocked: 0 } };
}

test("cached input tokens cost a tenth of uncached ones", async () => {
  const a = await recordUsage(gate(), { inTok: 4000, outTok: 0, cachedTok: 0, status: "success" });
  const b = await recordUsage(gate(), { inTok: 4000, outTok: 0, cachedTok: 4000, status: "success" });
  assert.ok(a.cost > 0);
  assert.ok(Math.abs(b.cost - a.cost * 0.1) < 1e-9, `${b.cost} vs ${a.cost}`);
});

test("cached tokens are counted for the report, never above the input count", async () => {
  const g = gate();
  await recordUsage(g, { inTok: 3000, outTok: 100, cachedTok: 2048, status: "success" });
  await recordUsage(g, { inTok: 1000, outTok: 100, cachedTok: 5000, status: "success" });
  assert.equal(g.g.inTok, 4000);
  assert.equal(g.g.cachedTok, 3048);
});

test("a call without usage metadata counts no cached tokens", async () => {
  const g = gate();
  await recordUsage(g, { inTok: 1500, outTok: 10, status: "success" });
  assert.equal(g.g.cachedTok, 0);
});
