/* POST /api/email-test — owner-only: send a REAL onboarding email to any address, to preview copy.
   Auth: owner Google login OR X-Admin-Token (via ownerOK). Body: { kind:"welcome"|"upsell", email, name? }.
   Returns { ok, sent, kind, email } — ok reflects the actual Resend send result. */
import { ownerOK } from "../_adminauth.js";
import { lookupUidByEmail } from "../_fbadmin.js";
import { emailWelcome, emailProUpsell } from "../_email.js";
import { promoActive, promoUntil } from "../_entitlement.js";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (!(await ownerOK(request, env))) return J({ error: "unauthorised" }, 401);
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const email = String(b.email || "").trim();
  if (!email) return J({ error: "email-required" }, 400);
  const name = String(b.name || "").slice(0, 120);
  const kind = String(b.kind || "welcome").toLowerCase();

  // Both kinds are marketing mail, which carries the Unsubscribe link and List-Unsubscribe headers
  // only when a uid is passed. Without one the test copy had neither (owner 2026-09-30: it landed in
  // Gmail spam), so it was not the mail a real sign-up gets. Use the account's uid when the address
  // belongs to one, else the same placeholder /api/email-preview uses.
  let uid = "preview-uid";
  try { const u = await lookupUidByEmail(env, email); if (u && u.uid) uid = u.uid; } catch (e) {}

  let r;
  if (kind === "upsell" || kind === "pro") {
    let untilStr = "";
    try { untilStr = new Date(promoUntil(env)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); } catch (e) {}
    r = await emailProUpsell(env, { email, name, uid, promoActive: promoActive(env), promoUntilStr: untilStr });
  } else {
    r = await emailWelcome(env, { email, name, uid });
  }
  const ok = !!(r && r.ok);
  return J({ ok, sent: ok, kind: (kind === "upsell" || kind === "pro") ? "upsell" : "welcome", email });
}
