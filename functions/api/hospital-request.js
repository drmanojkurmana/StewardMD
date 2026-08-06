/* POST /api/hospital-request — a clinician asks us to add their hospital's EMR/HIS to
   Ward Sync. Emails the request to the owner via Resend (https://resend.com).
   Requires Pages secret RESEND_API_KEY. Optional RESEND_FROM (a verified Resend sender);
   defaults to Resend's onboarding sender, which delivers to the Resend account owner.

   Login-free by design (a doctor requests before they have access), so it is protected by a
   per-IP rate limit + a same-origin/app CORS allow-list to stop anonymous email-flooding and
   Resend-quota exhaustion — NOT by auth (which would break the legitimate request flow). */

import { fetchWithTimeout } from "../_fetch.js";

const ORIGINS = ["https://stewardmd.in", "https://www.stewardmd.in", "https://stewardmd.pages.dev", "https://localhost", "http://localhost", "capacitor://localhost", "ionic://localhost"];
function corsOrigin(request) { const o = request.headers.get("Origin") || ""; return ORIGINS.indexOf(o) > -1 ? o : ""; }

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function J(obj, status, origin) {
  const h = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
  if (origin) h["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

// Per-IP rate limit (best-effort; needs a bound KV). Legit use is a single submit, so 3 / 10 min per IP
// plus a coarse global daily cap protects the shared Resend quota without affecting real requests.
async function rateLimited(env, request) {
  const kv = env.UPDATES_KV || env.MAIK_KV || env.GHIS_KV || env.PUSH_KV;
  if (!kv) return false;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  try {
    const ipKey = "hreq:ip:" + ip, n = parseInt((await kv.get(ipKey)) || "0", 10);
    if (n >= 3) return true;
    await kv.put(ipKey, String(n + 1), { expirationTtl: 600 });
    const dayKey = "hreq:day:" + new Date().toISOString().slice(0, 10), g = parseInt((await kv.get(dayKey)) || "0", 10);
    if (g >= 200) return true;                                  // global safety cap / day
    await kv.put(dayKey, String(g + 1), { expirationTtl: 86400 });
  } catch (e) { /* KV hiccup → fail open (validation + CORS still apply) */ }
  return false;
}

export async function onRequestOptions({ request }) {
  const origin = corsOrigin(request);
  return new Response(null, {
    headers: Object.assign(
      { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" },
      origin ? { "Access-Control-Allow-Origin": origin } : {}
    ),
  });
}

export async function onRequestPost({ request, env }) {
  const origin = corsOrigin(request);
  if (await rateLimited(env, request)) return J({ error: "rate_limited" }, 429, origin);

  let b;
  try { b = await request.json(); } catch (e) { return J({ error: "bad-json" }, 400, origin); }

  const hospital = String(b.hospital || "").trim().slice(0, 200);
  if (!hospital) return J({ error: "hospital-required" }, 400, origin);
  const emr = String(b.emr || "").trim().slice(0, 200);
  const name = String(b.name || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().slice(0, 160);
  const msg = String(b.msg || "").trim().slice(0, 2000);

  const key = env.RESEND_API_KEY;
  if (!key) return J({ error: "email-not-configured" }, 500, origin);
  const from = env.RESEND_FROM || "StewardMD Ward Sync <onboarding@resend.dev>";
  const to = env.HOSPITAL_REQUEST_TO || "drmanojkurmana@gmail.com";

  const html =
    "<h2>New Ward Sync / EMR integration request</h2>" +
    "<p><b>Hospital:</b> " + esc(hospital) + "</p>" +
    "<p><b>EMR / HIS:</b> " + (esc(emr) || "—") + "</p>" +
    "<p><b>Requested by:</b> " + (esc(name) || "—") + " &lt;" + (esc(email) || "no email") + "&gt;</p>" +
    "<p><b>Notes:</b><br>" + (esc(msg).replace(/\n/g, "<br>") || "—") + "</p>" +
    "<hr><p style='color:#888;font-size:12px'>Sent from StewardMD Ward Sync &rarr; Add your hospital.</p>";

  let r;
  try {
    r = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: from,
        to: [to],
        reply_to: email || undefined,
        subject: "StewardMD Ward Sync request: " + hospital,
        html: html,
      }),
    });
  } catch (e) {
    return J({ error: "send-exception" }, 502, origin);
  }
  if (!r.ok) {
    try { console.warn("[hospital-request] resend failed", r.status); } catch (x) {}
    return J({ error: "send-failed" }, 502, origin);
  }
  return J({ ok: true }, 200, origin);
}
