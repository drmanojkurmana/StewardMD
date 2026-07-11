/* POST /api/hospital-request — a clinician asks us to add their hospital's EMR/HIS to
   Ward Sync. Emails the request to the owner via Resend (https://resend.com).
   Requires Pages secret RESEND_API_KEY. Optional RESEND_FROM (a verified Resend sender);
   defaults to Resend's onboarding sender, which delivers to the Resend account owner. */

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch (e) { return J({ error: "bad-json" }, 400); }

  const hospital = String(b.hospital || "").trim().slice(0, 200);
  if (!hospital) return J({ error: "hospital-required" }, 400);
  const emr = String(b.emr || "").trim().slice(0, 200);
  const name = String(b.name || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().slice(0, 160);
  const msg = String(b.msg || "").trim().slice(0, 2000);

  const key = env.RESEND_API_KEY;
  if (!key) return J({ error: "email-not-configured" }, 500);
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
    r = await fetch("https://api.resend.com/emails", {
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
    return J({ error: "send-exception", detail: String(e).slice(0, 200) }, 502);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return J({ error: "send-failed", detail: t.slice(0, 300) }, 502);
  }
  return J({ ok: true });
}
