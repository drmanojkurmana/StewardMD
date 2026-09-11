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
  const limit = Math.max(1, Number(opts.limit) || 1);
  const windowMs = Math.max(1000, Number(opts.windowMs) || 60000);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  /* A Workers rate-limit binding, when the deployment bound one (env.WSQ_RL): the platform counts,
   * exactly, across every isolate. Its limit and period are the binding's own configuration; the
   * caller's numbers are documentation of intent. Preferred whenever present. */
  const binding = deps && deps.binding;
  if (binding && typeof binding.limit === "function") {
    try {
      const r = await binding.limit({ key: str(opts.key) });
      const allowed = !!(r && r.success);
      return { allowed, remaining: allowed ? -1 : 0, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(windowMs / 1000)), store: "binding" };
    } catch { /* a binding that errors falls through to the store, never to "allowed" without counting */ }
  }
  const store = (deps && deps.store) || kvStore(deps && deps.kv) || memoryStore();
  /* KV is eventually consistent, so a read-modify-write on one key under-counts when two isolates
   * race. The window is keyed by its INDEX rather than reset in place, so the worst case is a brief
   * under-count inside one window and never a stuck or runaway counter. ponytail: KV under-counts
   * under concurrent bursts; the binding above is exact and is the production answer. */
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `rl:${str(opts.key)}:${windowStart}`;
  const cur = await store.get(key);
  const count = (cur ? Number(cur.count) || 0 : 0) + 1;
  await store.put(key, { windowStart, count }, windowMs * 2);
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
