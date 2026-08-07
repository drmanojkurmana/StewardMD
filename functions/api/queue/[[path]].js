/* functions/api/queue/[[path]].js — Smart OPD Queue router (Phase 0 skeleton).
 *
 * Feature is OFF unless env QUEUE_ENABLED === "1". Only /ready is live in Phase 0; the queue engine
 * (doctor endpoints) and the patient portal land in later phases. Same CORS/JSON posture as
 * /api/followcare. No PHI ever appears in a URL, a query, or a log.
 */
import { queueEnabled, isQueueConfigured } from "../../_queue.js";

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || "";
  const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token, X-Admin-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) }); }

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/queue\/?/, "").replace(/\/+$/, "").split("/")[0] || "";

  // Readiness — safe to expose: reveals only enabled/configured booleans, never PHI.
  if (request.method === "GET" && seg === "ready") {
    return json({ ok: true, enabled: queueEnabled(env), configured: isQueueConfigured(env) }, 200, request);
  }

  if (!queueEnabled(env)) return json({ ok: false, error: "disabled" }, 404, request);

  // Engine (doctor) + patient portal routes land in Phase 1 / Phase 2.
  return json({ ok: false, error: "not_found" }, 404, request);
}
