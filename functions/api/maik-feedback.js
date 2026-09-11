/* POST /api/maik-feedback — "Was this helpful?" on a MaiK answer (metadata + optional doctor-typed
 * reason, no PHI). Public + unauthenticated on purpose, same reasoning as /api/clientlog: feedback
 * must never be blocked by a sign-in check, and always returns 200 so a failed report can't cascade
 * into a UI error. Reading the log (with reasons) is the admin route, not here. */
import { usageKv } from "../_usage.js";
import { recordFeedback, amendFeedbackReason, getFeedbackAgg } from "../_maik_feedback.js";

const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Two request shapes, one endpoint:
//   {helpful, question, engine, pack}  -> new rating, recorded immediately, returns {id} to amend.
//   {id, reason}                        -> attaches a doctor's typed reason to their own earlier "No"
//                                          (the id recordFeedback returned) - never a second entry.
export async function onRequestPost({ request, env }) {
  let id = null;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object") {
      const store = usageKv(env);
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
