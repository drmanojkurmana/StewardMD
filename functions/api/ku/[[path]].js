/* StewardMD — Knowledge Units (KU) endpoint (Cloudflare Pages Function).
 *
 * Server-authoritative, identity-verified points ledger. Identity is derived by
 * reusing _usage.js `identify()` (verified Firebase ID token → "fb:<uid>", or
 * Cf-Access email; unverified/guest → rejected). The client's claimed uid is
 * never trusted. Balance lives in KV (usageKv), so localStorage tampering is
 * display-only. KU gate future subscription discounts — see the design spec.
 *
 * Routes:
 *   POST /api/ku/award   body { events:[{type,refId}] }  -> { todayEarned, ...summary }
 *   GET  /api/ku/summary                                 -> summary
 * Both require a signed-in, verified identity (401 signin-required for guests).
 */
import { usageKv, identify } from "../../_usage.js";
import { freshDoc, applyEvents, summarize, dayStr } from "./ledger.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const KEY_TTL = 60 * 60 * 24 * 400; // ~400 days; refreshed on every write

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");

  const store = usageKv(env);
  if (!store) return json({ error: "unavailable" }, 503);       // fail-closed: never grant KU without a ledger

  const who = await identify(request, env);
  if (!who || who.guest) return json({ error: "signin-required" }, 401);
  const key = "ku:" + who.id;

  try {
    if (request.method === "POST" && seg === "award") {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
      const doc = (await store.get(key, "json")) || freshDoc();
      const todayEarned = applyEvents(doc, events, dayStr(new Date()));
      await store.put(key, JSON.stringify(doc), { expirationTtl: KEY_TTL });
      return json(Object.assign({ todayEarned: todayEarned }, summarize(doc)));
    }
    if (request.method === "GET" && seg === "summary") {
      const doc = (await store.get(key, "json")) || freshDoc();
      return json(summarize(doc));
    }
    return json({ error: "not-found" }, 404);
  } catch (e) {
    return json({ error: "server", detail: String((e && e.message) || e).slice(0, 120) }, 500);
  }
}
