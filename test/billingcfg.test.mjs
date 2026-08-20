/* test/billingcfg.test.mjs — live price/flag override layer: precedence, warm, set, and a real
 * resolver (costCapOn, promoUntil) honouring the KV override. Shared module cache; bypass its 30s
 * TTL by passing an increasing `now`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cfgFlag, cfgPrice, warmBillingCfg, setBillingCfg } from "../functions/_billingcfg.js";
import { costCapOn } from "../functions/_credits.js";
import { promoUntil } from "../functions/_entitlement.js";

function kv(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { m, async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } };
}
let T = 1e12;

test("empty override → env fallback", async () => {
  await warmBillingCfg(kv({}), (T += 60000));
  assert.equal(cfgFlag({ AI_COST_CAP_ON: "1" }, "AI_COST_CAP_ON"), "1");
  assert.equal(cfgPrice({ PRO_PRICE_MONTHLY: "59900" }, "PRO_PRICE_MONTHLY", 0), 59900);
  assert.equal(costCapOn({ AI_COST_CAP_ON: "1" }), true);
});

test("KV override wins over env", async () => {
  await warmBillingCfg(kv({ "billing:cfg": JSON.stringify({ flags: { AI_COST_CAP_ON: "0" }, prices: { PRO_PRICE_MONTHLY: 79900 } }) }), (T += 60000));
  assert.equal(cfgFlag({ AI_COST_CAP_ON: "1" }, "AI_COST_CAP_ON"), "0");   // KV "0" beats env "1"
  assert.equal(costCapOn({ AI_COST_CAP_ON: "1" }), false);
  assert.equal(cfgPrice({ PRO_PRICE_MONTHLY: "59900" }, "PRO_PRICE_MONTHLY", 0), 79900);
});

test("setBillingCfg writes, refreshes cache immediately, and null clears", async () => {
  const store = kv({});
  await setBillingCfg(store, { flags: { PRO_FREE_UNTIL: "2020-01-01" } });
  assert.equal(cfgFlag({}, "PRO_FREE_UNTIL"), "2020-01-01");              // cache refreshed now
  assert.equal(promoUntil({}), Date.parse("2020-01-01"));                 // resolver honours the override
  assert.equal(JSON.parse(store.m.get("billing:cfg")).flags.PRO_FREE_UNTIL, "2020-01-01");
  await setBillingCfg(store, { flags: { PRO_FREE_UNTIL: "" } });          // clear → back to env
  assert.equal(cfgFlag({ PRO_FREE_UNTIL: "envval" }, "PRO_FREE_UNTIL"), "envval");
});
