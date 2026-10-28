/* functions/add/[id].js - https://stewardmd.in/add/<StewardMD ID>, the colleague invite link.
 * ===========================================================================
 * Colleagues > "Invite on WhatsApp" (kits-share.js) sends this link. On a phone WITH StewardMD the
 * Universal Link (AASA path "/add/*" in _middleware.js) or App Link opens the app on "Add this
 * colleague?" and this page is never seen. WITHOUT the app this page explains what was shared and
 * sends the doctor to the App Store or Google Play, showing the ID large so it can be added after
 * install (Contacts > Add a colleague).
 *
 * Carries only the inviting doctor's own StewardMD ID: no name lookup (the page must not turn the
 * directory into something a stranger can browse), no patient data. Script-free, strict CSP, noindex,
 * like /verify. Must stay listed in functions/_middleware.js or the gate serves the marketing page.
 */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const APP_STORE = "https://apps.apple.com/app/stewardmd";
export const PLAY_STORE = "https://play.google.com/store/apps/details?id=in.stewardmd.app";

/** "smd-95nurw" or "95NURW" -> "SMD-95NURW"; anything else -> "". */
export function normalizeId(raw) {
  let s = "";
  try { s = decodeURIComponent(String(raw || "")); } catch (e) { s = String(raw || ""); }
  s = s.trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z0-9]{6}$/.test(s)) s = "SMD-" + s;
  return /^SMD-[A-Z0-9]{6}$/.test(s) ? s : "";
}

export function renderInvite(rawId) {
  const id = normalizeId(rawId);
  const title = "Add me on StewardMD";
  const desc = "Send each other referrals and handovers in StewardMD, encrypted and between verified doctors only.";
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StewardMD">
<meta property="og:image" content="https://stewardmd.in/_site/assets/s/home.png">
<meta name="twitter:card" content="summary_large_image">
<style>
:root{--p:#00685f;--bg:#f7f9fb;--fg:#191c1e;--mut:#3d4947;--card:#fff;--line:#bcc9c6}
@media (prefers-color-scheme:dark){:root{--p:#3fc7b3;--bg:#191c1e;--fg:#eff1f3;--mut:#bcc9c6;--card:#1f2325;--line:#3d4947}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:440px;margin:0 auto;padding:40px 16px}
.logo{width:56px;height:56px;border-radius:14px;display:block;margin-bottom:18px}
h1{margin:0 0 8px;font-size:24px;line-height:1.25}
p{margin:0 0 16px;color:var(--mut)}
.id{margin:0 0 20px;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--card);text-align:center}
.id span{display:block;font-size:12px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--mut)}
.id b{display:block;margin-top:4px;font-size:28px;letter-spacing:.04em;user-select:all;-webkit-user-select:all}
a.btn{display:block;margin:0 0 10px;padding:14px 16px;border-radius:12px;background:var(--p);color:#fff;text-align:center;font-weight:650;text-decoration:none}
a.btn.alt{background:transparent;color:var(--p);border:1px solid var(--line)}
ol{margin:18px 0 0;padding-left:20px;color:var(--mut)}li{margin-bottom:6px}
</style></head><body><main>
<img class="logo" src="/apple-touch-icon.png" alt="StewardMD">
<h1>${id ? "A colleague invited you to StewardMD" : "Join your colleagues on StewardMD"}</h1>
<p>${esc(desc)}</p>
${id ? `<div class="id"><span>Their StewardMD ID</span><b>${esc(id)}</b></div>` : ""}
<a class="btn" href="${esc(id ? "stewardmd://add/" + id : "stewardmd://home")}">I have StewardMD: open it</a>
<a class="btn alt" href="${APP_STORE}">Get it on the App Store</a>
<a class="btn alt" href="${PLAY_STORE}">Get it on Google Play</a>
${id ? `<ol><li>Install StewardMD and sign in.</li><li>Open Colleagues, then Contacts.</li><li>Add ${esc(id)}.</li></ol>` : ""}
</main></body></html>`;
  return new Response(body, {
    status: id ? 200 : 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

export async function onRequest(context) {
  const m = context.request.method;
  if (m !== "GET" && m !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { "content-type": "text/plain", allow: "GET, HEAD", "cache-control": "no-store" } });
  }
  return renderInvite((context.params && context.params.id) || "");
}
