/* GET /api/config — the client polls this on boot for the force-upgrade floor, maintenance state,
 * remote banners, and server flags. Public (no auth), short-cached at the edge so it's cheap at fleet
 * scale but still updates within ~a minute of an admin change. Setting it is the owner route
 * /api/ai/admin/config. */
import { usageKv } from "../_usage.js";
import { getRemoteConfig } from "../_remoteconfig.js";

export async function onRequestGet({ env }) {
  var cfg;
  try { cfg = await getRemoteConfig(usageKv(env)); } catch (e) { cfg = { minBuild: null, maintenance: { on: false }, banners: [], flags: {} }; }
  return new Response(JSON.stringify(cfg), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
