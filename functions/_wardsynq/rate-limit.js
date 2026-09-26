/* functions/_wardsynq/rate-limit.js - a fixed-window limiter with a pluggable store. PURE-ish.
 *
 * Token endpoints get guessed at. A limiter that lives in a gateway is a limiter the next
 * deployment forgets, so this one is in the code path, and it says what it is: a fixed window per
 * key, backed by KV when the deployment has one and by this isolate's memory when it does not.
 *
 * THE MEMORY STORE IS HONEST ABOUT ITS CEILING. Cloudflare runs many isolates; an in-memory count
 * is per isolate, so the effective limit is N times the configured one. That is still a limit -
 * it bounds a single hot connection - and it is reported as `store: "memory"` so nobody reads a
 * green dashboard as proof of a global cap. ponytail: memory store, KV binding when configured.
 */

const str = (v) => (v == null ? "" : String(v).trim());

/** Module-level memory store. Per isolate, by design and by admission. */
const MEMORY = new Map();

function memoryStore() {
  return {
    kind: "memory",
    async get(key) { const v = MEMORY.get(key); if (!v) return null; if (v.expiresAt <= Date.now()) { MEMORY.delete(key); return null; } return v; },
    async put(key, value, ttlMs) { MEMORY.set(key, { ...value, expiresAt: Date.now() + ttlMs }); },
  };
}

/** A Cloudflare KV namespace, when one is bound. Never required. */
function kvStore(kv) {
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") return null;
  return {
    kind: "kv",
    async get(key) { try { const s = await kv.get(key); return s ? JSON.parse(s) : null; } catch { return null; } },
    async put(key, value, ttlMs) { try { await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) }); } catch { /* a limiter that cannot write still refuses nothing: fail open on the STORE, never on the check */ } },
  };
}

/**
 * Checks and counts one hit.
 * @param {{store?: object, kv?: object}} deps
 * @param {{key: string, limit: number, windowMs: number, now?: number}} opts
 * @returns {Promise<{allowed: boolean, remaining: number, retryAfterSeconds: number, store: string}>}
 */
async function hit(deps, opts) {
  const store = (deps && deps.store) || kvStore(deps && deps.kv) || memoryStore();
  const key = `rl:${str(opts.key)}`;
  const limit = Math.max(1, Number(opts.limit) || 1);
  const windowMs = Math.max(1000, Number(opts.windowMs) || 60000);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const cur = await store.get(key);
  const windowStart = cur && cur.windowStart && now - cur.windowStart < windowMs ? cur.windowStart : now;
  const count = (cur && windowStart === cur.windowStart ? Number(cur.count) || 0 : 0) + 1;
  await store.put(key, { windowStart, count }, windowMs);
  const allowed = count <= limit;
  return {
    allowed, remaining: Math.max(0, limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
    store: store.kind,
  };
}

/** For tests and for a deployment that wants a clean slate. */
function resetMemory() { MEMORY.clear(); }

export { hit, memoryStore, kvStore, resetMemory };
