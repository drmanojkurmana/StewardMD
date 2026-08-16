/* test/pool-roles.test.mjs — co-resident shared AI pool + extended billing roles. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateAndCount, poolKeyFor } from "../functions/_ai_usage.js";
import { ROLES, normalizeRole, roleToTier } from "../functions/_entitlements.js";

function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
const now = Date.parse("2026-10-01T10:00:00Z");
const DAY = "2026-10-01";

test("roles: new billing roles accepted; trainee roles map to v2beta", () => {
  ["physician", "physician_pro", "resident", "co_resident", "intern", "student"].forEach((r) => assert.equal(normalizeRole(r), r));
  assert.equal(normalizeRole("nonsense"), null);
  assert.equal(roleToTier("physician_pro"), "v1");
  assert.equal(roleToTier("co_resident"), "v2beta");
  assert.equal(roleToTier("intern"), "v2beta");
  assert.ok(ROLES.includes("co_resident"));
});

test("poolKeyFor resolves a linked account to its pool owner", async () => {
  const kv = fakeKv({ "ai:pool:em:b@x.in": "em:a@x.in" });
  assert.equal(await poolKeyFor(kv, "em:b@x.in"), "em:a@x.in");
  assert.equal(await poolKeyFor(kv, "em:a@x.in"), "em:a@x.in");   // unlinked → self
});

test("co-resident pair meters into ONE bucket", async () => {
  const kv = fakeKv({ "ai:pool:em:b@x.in": "em:a@x.in" });
  const env = {};   // caps off → gate records the attempt, both under the pooled key
  await gateAndCount(env, kv, "maik", "em:a@x.in", "unknown", now, "a@x.in");
  await gateAndCount(env, kv, "maik", "em:b@x.in", "unknown", now, "b@x.in");   // b pools to a
  const owner = await kv.get("aiu:doc:em:a@x.in:" + DAY, "json");
  assert.equal(owner.req, 2, "both calls landed on the owner's bucket");
  assert.equal(await kv.get("aiu:doc:em:b@x.in:" + DAY, "json"), null, "no separate bucket for the linked account");
});
