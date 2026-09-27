/* /api/support — doctor-facing support tickets.
 *   POST {action:"create", subject, text, platform?, build?}  -> new ticket (unique complaint id)
 *   POST {action:"reply", id, text}                            -> follow-up on the doctor's OWN ticket
 *   POST {action:"bug", text, bug:{route,element,screen,ua}, shot?, platform?, build?}
 *                                                              -> bug report (shake to report): a ticket
 *                                                                 of kind "bug", fix promised in 24 h
 *   POST {action:"seen", id}                                   -> clear the doctor's unread badge
 *   GET                                                        -> the doctor's own tickets (full threads)
 *   GET ?shot=<id>                                             -> the screenshot of the doctor's OWN bug
 * Requires a signed-in doctor (so the owner's replies route back in-app). Admin side = /api/ai/admin/support*. */
import { usageKv, identify } from "../_usage.js";
import { createTicket, addMessage, getTicket, listMine, markSeen, shotKey, shotResponse, SHOT_MAX, SHOT_TTL } from "../_support.js";

const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function rands() { const a = new Uint32Array(2); crypto.getRandomValues(a); return [a[0], a[1]]; }

export const BUGS_PER_DAY = 20;   // per account: a stuck shake detector must not flood the owner's queue

// "data:image/jpeg;base64,...." -> the base64 body, or "" when it is not a JPEG/PNG or too big.
export function cleanShot(s) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ""));
  if (!m || m[2].length > SHOT_MAX) return "";
  return m[1] + ":" + m[2];
}

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
  if (b.action === "seen") {
    const t = await getTicket(store, String(b.id || ""));
    if (!t || t.owner !== who.id) return json({ error: "not-found" }, 404);
    await markSeen(store, t.id, now);
    return json({ ok: true });
  }
  if (b.action === "bug") {
    if (!String(b.text || "").trim()) return json({ error: "empty" }, 400);
    const day = new Date(now).toISOString().slice(0, 10), capK = "support:bugcap:" + who.id + ":" + day;
    let n = 0; try { n = +(await store.get(capK)) || 0; } catch (e) {}
    if (n >= BUGS_PER_DAY) return json({ error: "too-many" }, 429);
    const shot = cleanShot(b.shot);
    const text = String(b.text).trim();
    let t;
    try {
      t = await createTicket(store, who, { kind: "bug", subject: "Bug: " + text.split("\n")[0].slice(0, 80), text,
        platform: b.platform, build: b.build, bug: b.bug, hasShot: !!shot }, rands(), now);
    } catch (e) { return json({ error: "empty" }, 400); }
    if (shot) { try { await store.put(shotKey(t.id), shot, { expirationTtl: SHOT_TTL }); } catch (e) {} }
    try { await store.put(capK, String(n + 1), { expirationTtl: 2 * 86400 }); } catch (e) {}
    return json({ ok: true, ticket: t });
  }
  // create
  try {
    const t = await createTicket(store, who, b, rands(), now);
    return json({ ok: true, ticket: t });
  } catch (e) { return json({ error: "empty" }, 400); }
}

export async function onRequestGet({ request, env }) {
  const who = await identify(request, env);
  const url = new URL(request.url);
  const shotId = url.searchParams.get("shot");
  if (shotId) {
    if (!who || who.guest) return json({ error: "sign-in-required" }, 401);
    const store = usageKv(env);
    const t = await getTicket(store, shotId);
    if (!t || t.owner !== who.id) return json({ error: "not-found" }, 404);
    let raw = null; try { raw = await store.get(shotKey(t.id)); } catch (e) {}
    return shotResponse(raw) || json({ error: "not-found" }, 404);
  }
  if (!who || who.guest) return json({ ok: true, tickets: [] });
  return json({ ok: true, tickets: await listMine(usageKv(env), who.id) });
}
