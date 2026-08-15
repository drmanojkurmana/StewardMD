/* POST /api/analytics — count one allow-listed product event (no PHI, no per-user detail). Public,
 * always-200 (analytics must never break a request). Read is the owner route /api/ai/admin/analytics. */
import { usageKv } from "../_usage.js";
import { recordEvent } from "../_analytics.js";

const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json().catch(() => null);
    if (b && b.event) await recordEvent(usageKv(env), b.event, Date.now());
  } catch (e) {}
  return json({ ok: true });
}
