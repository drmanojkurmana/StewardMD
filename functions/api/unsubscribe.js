/* StewardMD - one-click unsubscribe from marketing email.
 *
 *   GET  /api/unsubscribe?t=<token>   the link in the footer: unsubscribes at once and shows a page
 *                                     with a Resubscribe button (no sign-in needed).
 *   POST /api/unsubscribe?t=<token>   RFC 8058 one-click (mail clients send List-Unsubscribe=One-Click);
 *                                     a form POST with resub=1 from the page re-enables.
 *
 * The token is signed (functions/_unsub.js), so the page can act without a session and a forged link
 * does nothing. It flips ONLY the marketing flag in the lifecycle record: account notices (a
 * verification code, the removal warning) are unaffected, as the page says.
 */
import { unsubUid } from "../_unsub.js";
import { markUnsubscribed } from "../_lifecycle.js";

const APP = "https://stewardmd.in";
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif";

function page(title, sub, action, token) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' | StewardMD</title>' +
    '<style>body{margin:0;background:#fbfbfd;font-family:' + FONT + ';color:#1d1d1f}.c{max-width:520px;margin:48px auto;background:#fff;border-radius:28px;padding:48px 32px;text-align:center}h1{font-size:30px;letter-spacing:-.02em;margin:18px 0 10px}p{color:#6e6e73;font-size:16px;line-height:1.5;margin:0 auto;max-width:400px}.b{display:inline-block;margin-top:26px;padding:13px 26px;border-radius:980px;background:#0e6e63;color:#fff;font-weight:600;text-decoration:none;border:0;font-size:16px;cursor:pointer}.l{display:block;margin-top:16px;color:#0e6e63;text-decoration:none}small{display:block;margin-top:28px;color:#86868b;font-size:12px}</style></head>' +
    '<body><div class="c"><img src="' + APP + '/logo.png" width="44" height="44" alt="StewardMD"><h1>' + title + '</h1><p>' + sub + '</p>' +
    (action ? '<form method="post" action="/api/unsubscribe?t=' + encodeURIComponent(token) + '"><input type="hidden" name="resub" value="' + (action === "resub" ? "1" : "0") + '"><button class="b" type="submit">' + (action === "resub" ? "Resubscribe" : "Unsubscribe") + '</button></form>' : "") +
    '<a class="l" href="' + APP + '">Open StewardMD &#8250;</a>' +
    '<small>Account notices such as sign-in codes and verification updates are not affected.</small></div></body></html>';
}
const html = (s, status) => new Response(s, { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") || "";
  const uid = await unsubUid(env, token);
  if (!uid) return html(page("This link is not valid.", "It may have been cut short by your mail app. Open the email again and tap Unsubscribe, or write to support@stewardmd.in.", null, ""), 400);

  let resub = false, body = "";
  if (request.method === "POST") {
    try { body = await request.text(); } catch (e) {}
    resub = /(^|&)resub=1(&|$)/.test(body);
  } else if (request.method !== "GET") {
    return new Response("method", { status: 405 });
  }
  await markUnsubscribed(env, uid, !resub);
  // A mail client's one-click POST wants a plain 2xx, not a page.
  if (request.method === "POST" && /List-Unsubscribe=One-Click/.test(body)) {
    return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  return resub
    ? html(page("You are back on the list.", "You will hear from StewardMD about new features and offers again.", "unsub", token))
    : html(page("You are unsubscribed.", "No more feature news or offers from StewardMD at this address. Changed your mind?", "resub", token));
}
