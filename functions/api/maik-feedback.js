/* POST /api/maik-feedback — "Was this helpful?" on a MaiK answer (metadata + optional doctor-typed
 * reason, no PHI). Public + unauthenticated on purpose, same reasoning as /api/clientlog: feedback
 * must never be blocked by a sign-in check, and always returns 200 so a failed report can't cascade
 * into a UI error. Reading the log (with reasons) is the admin route, not here.
 *
 * Abuse bound (T10): FEEDBACK_PER_IP writes per CF-Connecting-IP per 10 minutes, generous so a whole
 * hospital behind one NAT is fine. Fails OPEN when KV is unavailable. Over the limit the row is
 * simply not stored ({ ok:false, limited:true }, still 200). */
import { usageKv } from "../_usage.js";
import { recordFeedback, amendFeedbackReason, getFeedbackAgg } from "../_maik_feedback.js";
import { hitLimit, clientIp } from "../_ratelimit.js";

export const FEEDBACK_PER_IP = 30;

const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Two request shapes, one endpoint:
//   {helpful, question, engine, pack}  -> new rating, recorded immediately, returns {id} to amend.
//   {id, reason}                        -> attaches a doctor's typed reason to their own earlier "No"
//                                          (the id recordFeedback returned) - never a second entry.
export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const waitUntil = typeof ctx.waitUntil === "function" ? ctx.waitUntil.bind(ctx) : null;   // unbound waitUntil throws on Workers
  let id = null;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object") {
      const store = usageKv(env);
      const rl = await hitLimit(store, "fb", clientIp(request), FEEDBACK_PER_IP, 600, waitUntil);
      if (!rl.ok) return json({ ok: false, limited: true, id: null });
      if (body.id) { await amendFeedbackReason(store, String(body.id).slice(0, 40), body.reason, Date.now()); }
      else { id = await recordFeedback(store, body, Date.now()); }
    }
  } catch (e) { /* swallow - never let feedback telemetry error out */ }
  return json({ ok: true, id });
}

// COUNTS ONLY (never the free-text reasons) - mirrors ws-feedback.js's public-GET privacy stance.
// The admin console reads the actual entries via /api/ai/admin/maik-feedback (owner-gated).
export async function onRequestGet({ env }) {
  return json({ ok: true, agg: await getFeedbackAgg(usageKv(env)) });
}
