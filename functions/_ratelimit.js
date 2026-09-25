/* functions/_ratelimit.js - fixed-window request counter on KV, keyed by an opaque hash.
 *
 * Used for the per-IP guest burst limit on /api/ai/explain + /research, the per-IP limit on
 * /api/maik-feedback, and the daily /figures cap. The raw IP / id never lands in a key (sha256hex).
 *
 * FAIL-OPEN by design: no store, a read error or a missing id all ALLOW. A limiter that can take the
 * clinical AI down when KV hiccups is worse than the abuse it guards against. The read gates; the
 * increment can be deferred with waitUntil so it adds no latency in front of an answer.
 * ponytail: KV read-modify-write, so a concurrent burst can under-count by a few. Fine for a burst
 * speed-bump; move to a Durable Object if an exact limit is ever needed.
 */
import { sha256hex } from "./_usage.js";

export function clientIp(request) {
  return (request && request.headers && (request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For"))) || "";
}

/* -> { ok, used, limit }. windowSec >= 60 (KV's minimum TTL). */
export async function hitLimit(store, bucket, id, limit, windowSec, waitUntil, now) {
  if (!store || !id || !(limit > 0)) return { ok: true };
  try {
    const win = Math.max(60, windowSec | 0);
    const slot = Math.floor((now || Date.now()) / 1000 / win);
    const key = "rl:" + bucket + ":" + (await sha256hex(id)) + ":" + slot;
    const used = Number(await store.get(key)) || 0;
    if (used >= limit) return { ok: false, used, limit };
    const put = () => store.put(key, String(used + 1), { expirationTtl: win + 60 });
    if (typeof waitUntil === "function") { try { waitUntil(put().catch(() => {})); } catch (e) {} }
    else await put();
    return { ok: true, used: used + 1, limit };
  } catch (e) { return { ok: true }; }
}
