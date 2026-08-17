/* functions/_billingcfg.js — live (no-redeploy) overrides for billing prices + enforcement flags.
 *
 * The owner edits prices/flags from /admin; we store them in KV `billing:cfg` = { prices:{}, flags:{} }
 * and the resolvers prefer the KV value over the wrangler.toml env default. A short module-global cache
 * (30s) keeps hot paths (proFromRequest / gateAndCount) from hitting KV every request; call warmBillingCfg
 * at an async entry point that has a KV store, then the sync cfgFlag/cfgPrice read from the cache. If no
 * warm has run in a cold isolate, both fall through to env — the committed default, always safe.
 *
 * Precedence: KV override (if the key is present) > env > caller default. Setting a key to null/"" clears it.
 */
let _c = { flags: {}, prices: {}, at: 0 };
const TTL_MS = 30000;

export function cfgFlag(env, name) {
  if (Object.prototype.hasOwnProperty.call(_c.flags, name)) return _c.flags[name];
  return env && env[name];
}
export function cfgPrice(env, key, dflt) {
  const raw = Object.prototype.hasOwnProperty.call(_c.prices, key) ? _c.prices[key] : (env && env[key]);
  const n = +raw;
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export async function warmBillingCfg(store, now) {
  now = now || Date.now();
  if (now - _c.at < TTL_MS) return _c;
  try {
    const j = store ? await store.get("billing:cfg", "json") : null;
    _c = { flags: (j && j.flags) || {}, prices: (j && j.prices) || {}, at: now };
  } catch (e) { _c.at = now; }
  return _c;
}

export async function getBillingCfg(store) {
  try { return (store ? await store.get("billing:cfg", "json") : null) || { flags: {}, prices: {} }; }
  catch (e) { return { flags: {}, prices: {} }; }
}

// Merge a patch { prices?:{}, flags?:{} } into the stored config; null/"" values delete a key. Owner-gated.
export async function setBillingCfg(store, patch) {
  patch = patch || {};
  const cur = await getBillingCfg(store);
  const next = { flags: Object.assign({}, cur.flags, patch.flags || {}), prices: Object.assign({}, cur.prices, patch.prices || {}) };
  ["flags", "prices"].forEach((sec) => Object.keys(next[sec]).forEach((k) => { if (next[sec][k] === null || next[sec][k] === "") delete next[sec][k]; }));
  if (store) await store.put("billing:cfg", JSON.stringify(next));
  _c = { flags: next.flags, prices: next.prices, at: Date.now() };   // refresh THIS isolate immediately
  return next;
}
