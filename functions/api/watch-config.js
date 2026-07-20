/* StewardMD — Apple Watch remote config (Cloudflare Pages Function).
 *
 * Lets watch features be enabled/disabled WITHOUT a native app update (the
 * watch app can't OTA, so it reads this on launch). Also carries a kill switch,
 * a minimum-supported-version floor, and an optional announcement banner.
 *
 *   GET  /api/watch-config   (public, no auth) -> { flags, minVersion, announcement, killSwitch }
 *   POST /api/watch-config   (owner only)      body = partial config -> merged + persisted
 *
 * Storage: KV key "watch:config" in env.CASES_KV (fallback env.GHIS_KV). If no
 * KV is bound, GET returns the baked defaults. Never cached.
 */
import { ownerOK } from "../_adminauth.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
const KEY = "watch:config";

// Baked defaults reflect what ships in the current watch build. Remote config
// can only TOGGLE these; unknown flags default off on the watch (fail-safe).
const DEFAULTS = {
  flags: {
    criticalLabs: true,
    drugLookup: true,
    codeBlue: true,
    wardSync: true,
    calculators: true,
    sepsisTimer: true,
    procedureTimer: true,
    abg: true,
    handover: true,
    antibioticSummary: false,   // Phase-3 "intelligence" — off until validated
    icuDeterioration: false,
  },
  minVersion: "1.0.0",
  announcement: null,
  killSwitch: false,
};

function merge(base, over) {
  if (!over || typeof over !== "object") return base;
  return {
    flags: Object.assign({}, base.flags, (over.flags && typeof over.flags === "object") ? over.flags : {}),
    minVersion: typeof over.minVersion === "string" ? over.minVersion : base.minVersion,
    announcement: ("announcement" in over) ? (over.announcement || null) : base.announcement,
    killSwitch: typeof over.killSwitch === "boolean" ? over.killSwitch : base.killSwitch,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const store = kv(env);
  const method = request.method;

  if (method === "GET") {
    let stored = null;
    if (store) { try { stored = await store.get(KEY, "json"); } catch (e) {} }
    return json(merge(DEFAULTS, stored));
  }

  if (method === "POST") {
    if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
    if (!store) return json({ error: "no-store" }, 501);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    let current = null;
    try { current = await store.get(KEY, "json"); } catch (e) {}
    const next = merge(merge(DEFAULTS, current), body);
    await store.put(KEY, JSON.stringify(next));
    return json({ ok: true, config: next });
  }

  return json({ error: "method-not-allowed" }, 405);
}
