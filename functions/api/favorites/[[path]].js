/* StewardMD — Favorites store (Cloudflare Pages Function).
 *
 * Cross-device favorites (pinned calculators / drugs) so they follow a clinician
 * and can be bridged to the Apple Watch. Scoped PER AUTHENTICATED USER; a user
 * only ever reads/writes their own. Mirrors functions/api/cases/[[path]].js.
 *
 *   GET    /api/favorites       -> { enabled, favorites:[{id,kind,label}] }
 *   PUT    /api/favorites/:id   body={ kind, label } -> { ok, favorites }
 *   DELETE /api/favorites/:id   -> { ok, favorites }
 *
 * Storage: env.CASES_KV (preferred) or env.GHIS_KV, key "fav:index:<uid>".
 * Signed-out GET degrades to { enabled:false } (client uses on-device favorites);
 * writes require auth. Not Pro-gated — favorites are lightweight. Never cached.
 */
import { identify } from "../../_fbauth.js";

const MAX = 50;
const KINDS = { calculator: 1, drug: 1 };

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
function key(uid) { return "fav:index:" + uid; }
async function read(store, uid) { try { return (await store.get(key(uid), "json")) || []; } catch (e) { return []; } }

export async function onRequest(context) {
  const { request, env, params } = context;
  const store = kv(env);
  const rawId = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const id = rawId.slice(0, 80);   // cap id length (parity with label)
  const method = request.method;

  if (!store) {
    if (method === "GET" && !id) return json({ enabled: false, favorites: [] });
    return json({ enabled: false, error: "no-store" }, 501);
  }

  const uid = await identify(request, env);
  if (!uid) {
    if (method === "GET" && !id) return json({ enabled: false, favorites: [] });
    return json({ enabled: false, error: "auth-required" }, 401);
  }

  try {
    if (method === "GET" && !id) {
      return json({ enabled: true, favorites: await read(store, uid) });
    }
    if (method === "PUT" && id) {
      let body = {}; try { body = await request.json(); } catch (e) {}
      const kind = KINDS[body.kind] ? body.kind : "calculator";
      const entry = { id, kind, label: String(body.label || id).slice(0, 80) };
      let list = await read(store, uid);
      list = list.filter((e) => e.id !== id);
      list.push(entry);
      if (list.length > MAX) list = list.slice(-MAX);   // keep most-recent MAX
      await store.put(key(uid), JSON.stringify(list));
      return json({ ok: true, favorites: list });
    }
    if (method === "DELETE" && id) {
      let list = await read(store, uid);
      list = list.filter((e) => e.id !== id);
      await store.put(key(uid), JSON.stringify(list));
      return json({ ok: true, favorites: list });
    }
    return json({ error: "bad-request", method, id }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
