/* POST /api/welcome — sends the branded welcome email to a newly-signed-up user.
   Auth: Firebase ID token (Authorization: Bearer <idToken>) so we only ever email the
   token's OWN verified address (no open email-relay abuse). Called once by the client on
   first sign-in. */
import { verifyFirebaseToken } from "../_fbauth.js";
import { emailWelcome } from "../_email.js";
import { markFirstSeen } from "../_lifecycle.js";

function decodePayload(jwt) {
  try {
    const s = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 ? s + "=".repeat(4 - (s.length % 4)) : s;
    return JSON.parse(atob(pad));
  } catch (e) { return {}; }
}
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return J({ error: "no-token" }, 401);
  const uid = await verifyFirebaseToken(tok, env);
  if (!uid) return J({ error: "bad-token" }, 401);
  const p = decodePayload(tok);
  const email = p.email || "";
  if (!email) return J({ error: "no-email" }, 400);
  let name = p.name || "";
  try { const b = await request.json(); if (b && b.name) name = String(b.name).slice(0, 120); } catch (e) {}
  await emailWelcome(env, { email, name });
  // Record first sign-in so the day-3 Pro-upsell sweep can find non-verifiers (idempotent).
  try { await markFirstSeen(env, uid, { email, name }); } catch (e) {}
  return J({ ok: true });
}
