/* GET /api/email-preview?kind=<kind>   owner-only: render any email as HTML in the browser.
 * POST /api/email-preview { kind, email, name? }   owner-only: send a REAL copy to any address.
 *
 * kinds: welcome, upsell, verified, reminder, failed, pro, otp, reset, temp, alert,
 *        promo:<edition> (maik | bedside | imaging | reason | prescribe | practice | annual)
 *
 * Auth: owner Google login OR X-Admin-Token (ownerOK). The GET renders with sendBranded stubbed, so
 * nothing is sent; the POST goes through Resend. Supersedes /api/email-test for previews.
 */
import { ownerOK } from "../_adminauth.js";
import * as E from "../_email.js";
import { promoEdition, emailPromo, PROMO_EDITIONS } from "../_promo.js";
import { promoActive, promoUntil } from "../_entitlement.js";
import { warmBillingCfg } from "../_billingcfg.js";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function untilStr(env) { try { return new Date(promoUntil(env)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; } }

// Build the sendBranded options for a kind WITHOUT sending: the real template functions run
// against an env that captures what they pass to sendBranded.
export async function buildPreview(env, kind, { email, name, uid }) {
  kind = String(kind || "welcome").toLowerCase();
  const args = { email: email || "doctor@example.org", name: name || "Asha Rao", uid: uid || "preview-uid" };
  if (kind.indexOf("promo:") === 0) {
    const e = promoEdition(env, kind.slice(6));
    if (!e) return null;
    return { kind: "marketing", uid: args.uid, subject: e.subject, title: e.title, subtitle: e.subtitle, preheader: e.preheader, bodyHtml: e.bodyHtml };
  }
  // Every template ends in sendBranded(env, opts); an env carrying __EMAIL_CAPTURE receives opts
  // instead of sending (see functions/_email.js sendBranded).
  let captured = null;
  const rec = Object.assign({}, env, { __EMAIL_CAPTURE: (o) => { captured = o; } });
  const fns = {
    welcome: () => E.emailWelcome(rec, args),
    upsell: () => E.emailProUpsell(rec, Object.assign({ promoActive: promoActive(env), promoUntilStr: untilStr(env) }, args)),
    verified: () => E.emailVerified(rec, Object.assign({ regNo: "12345", council: "Andhra Pradesh Medical Council" }, args)),
    reminder: () => E.emailVerifyReminder(rec, Object.assign({ daysLeft: 2 }, args)),
    failed: () => E.emailFailed(rec, Object.assign({ reason: "Registration number not found on the register" }, args)),
    pro: () => E.emailProConfirmation(rec, Object.assign({ trial: true }, args)),
    otp: () => E.emailOtp(rec, Object.assign({ code: "482913", minutes: 10 }, args)),
    reset: () => E.emailResetCode(rec, Object.assign({ code: "719204", minutes: 10 }, args)),
    temp: () => E.emailTempPassword(rec, Object.assign({ password: "Kq7mXw2pRt9v" }, args)),
    alert: () => E.emailAlert(rec, Object.assign({ title: "A critical result has landed.", line: "Lab Watch found a new critical value on one of your patients.", cta: "Open Lab Watch" }, args)),
  };
  if (!fns[kind]) return null;
  await fns[kind]();
  return captured;
}

async function render(env, kind, q) {
  const opts = await buildPreview(env, kind, q);
  if (!opts) return null;
  let unsub = "";
  if (opts.kind === "marketing") unsub = "https://stewardmd.in/api/unsubscribe?t=preview";
  return E.renderEmail(Object.assign({}, opts, { unsub }));
}

export async function onRequest({ request, env }) {
  if (!(await ownerOK(request, env))) return J({ error: "unauthorised" }, 401);
  try { await warmBillingCfg(env.CASES_KV || env.GHIS_KV); } catch (e) {}
  const url = new URL(request.url);
  if (request.method === "GET") {
    const kind = url.searchParams.get("kind") || "welcome";
    if (kind === "list") return J({ kinds: ["welcome", "upsell", "verified", "reminder", "failed", "pro", "otp", "reset", "temp", "alert"].concat(PROMO_EDITIONS.map((e) => "promo:" + e)) });
    const html = await render(env, kind, { name: url.searchParams.get("name") || "" });
    if (!html) return J({ error: "unknown-kind" }, 404);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (request.method === "POST") {
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const email = String(b.email || "").trim();
    if (!email) return J({ error: "email-required" }, 400);
    const kind = String(b.kind || "welcome").toLowerCase();
    const args = { email, name: String(b.name || "").slice(0, 120), uid: String(b.uid || "preview-uid") };
    let r;
    if (kind.indexOf("promo:") === 0) r = await emailPromo(env, Object.assign({ edition: kind.slice(6) }, args));
    else {
      const opts = await buildPreview(env, kind, args);
      if (!opts) return J({ error: "unknown-kind" }, 404);
      r = await E.sendBranded(env, Object.assign({}, opts, { to: email }));
    }
    return J({ ok: !!(r && r.ok), kind, email });
  }
  return J({ error: "method" }, 405);
}
