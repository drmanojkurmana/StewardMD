/* /api/support — doctor-facing support tickets.
 *   POST {action:"create", subject, text, platform?, build?}  -> new ticket (unique complaint id)
 *   POST {action:"reply", id, text}                            -> follow-up on the doctor's OWN ticket
 *   GET                                                        -> the doctor's own tickets (full threads)
 * Requires a signed-in doctor (so the owner's replies route back in-app). Admin side = /api/ai/admin/support*. */
import { usageKv, identify } from "../_usage.js";
import { createTicket, addMessage, getTicket, listMine } from "../_support.js";

const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function rands() { const a = new Uint32Array(2); crypto.getRandomValues(a); return [a[0], a[1]]; }

export async function onRequestPost({ request, env }) {
  const who = await identify(request, env);
  if (!who || who.guest) return json({ error: "sign-in-required" }, 401);   // need an identity so replies route back in-app
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const store = usageKv(env);
  const now = Date.now();

  if (b.action === "reply") {
    const t = await getTicket(store, String(b.id || ""));
    if (!t || t.owner !== who.id) return json({ error: "not-found" }, 404);   // can only reply to your own ticket
    if (!String(b.text || "").trim()) return json({ error: "empty" }, 400);
    const u = await addMessage(store, t.id, "user", b.text, now);
    return json({ ok: true, ticket: u });
  }
  // create
  try {
    const t = await createTicket(store, who, b, rands(), now);
    return json({ ok: true, ticket: t });
  } catch (e) { return json({ error: "empty" }, 400); }
}

export async function onRequestGet({ request, env }) {
  const who = await identify(request, env);
  if (!who || who.guest) return json({ ok: true, tickets: [] });
  return json({ ok: true, tickets: await listMine(usageKv(env), who.id) });
}
