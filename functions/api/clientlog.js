/* POST /api/clientlog — receive one client crash/error report and store it (metadata only, no PHI).
 * Public + unauthenticated on purpose: errors can happen before sign-in, and telemetry must never be
 * blocked. Always returns 200 so a reporting failure can't cascade into another client error. */
import { usageKv } from "../_usage.js";
import { recordClientError } from "../_clientlog.js";

const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object") {
      await recordClientError(usageKv(env), body, Date.now());
    }
  } catch (e) { /* swallow — never let telemetry error out */ }
  return json({ ok: true });
}

// A GET is harmless (health check); reading the log is the admin route, not here.
export async function onRequestGet() { return json({ ok: true, endpoint: "clientlog" }); }
