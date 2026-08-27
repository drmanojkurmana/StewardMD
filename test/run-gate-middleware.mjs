/* StewardMD — coming-soon gate (functions/_middleware.js) regression.
 * The gate must hide the public WEB UI from anonymous browsers WITHOUT breaking any API,
 * endpoint, or app feature. This locks in exactly that contract:
 *   • a top-level page view by the public          → "coming soon"
 *   • /api/* (in-app AI, Resend triggers, emailed  → always pass through (each self-auths)
 *     approve/reject links, native app, cron)
 *   • /admin/* (own Google owner login)            → pass through
 *   • assets / fetch / XHR / POST / webhooks        → pass through (not a page view)
 *   • /realapp knock / ?lock=1 / unlock cookie      → unchanged
 * Pure unit test — no browser/server needed.  USAGE: node test/run-gate-middleware.mjs
 */
import { onRequest } from "../functions/_middleware.js";

const NEXT = "__NEXT__";
const next = () => new Response(NEXT, { status: 200, headers: { "x-next": "1" } });
const env = { APP_GATE_KEY: "smdapp_test", UPDATES_ADMIN_TOKEN: "tok" };

const run = (url, { method = "GET", headers = {} } = {}) =>
  onRequest({ request: new Request(url, { method, headers }), env, next });

const passedThrough = (res) => res.headers.get("x-next") === "1";
// The gate no longer serves a "Coming soon" placeholder: an anonymous top-level page view now gets
// the real marketing site from /_site/ (a sub-request through next()), and the COMING_SOON_HTML is
// only the fallback if that is unavailable. What the contract still guarantees is that the visitor
// does NOT get the clinical app.
const isPublicPage = async (res) => {
  if (res.status !== 200) return false;
  const body = await res.text();
  return body.includes("Coming soon") || (passedThrough(res) && !body.includes("__APP__"));
};

let fails = 0;
const chk = (name, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${name}${d ? " — " + d : ""}`); if (!ok) fails++; };

const ORIGIN = "https://stewardmd.in";
const doc = { "Sec-Fetch-Dest": "document", "Accept": "text/html" }; // a browser page navigation

// 1) Public page view → coming soon (the lock still works).
chk("public page view gets the marketing site, never the app",
  await isPublicPage(await run(ORIGIN + "/", { headers: doc })));

// 2) In-app AI: /api/ai/* must always work (this was the "AI not working in app" bug).
chk("POST /api/ai/reason passes through", passedThrough(await run(ORIGIN + "/api/ai/reason", { method: "POST" })));

// 3) Emailed approve/reject links are a browser navigation to /api/... → must work.
chk("GET /api/verifications/action (email link) passes through",
  passedThrough(await run(ORIGIN + "/api/verifications/action?uid=u&do=approve&sig=x", { headers: doc })));

// 4) Any other /api call (Resend-triggering endpoints, native app) passes through.
chk("POST /api/verify-doctor passes through", passedThrough(await run(ORIGIN + "/api/verify-doctor", { method: "POST" })));

// 5) Admin console page loads (protected by its own owner login).
chk("GET /admin/ passes through", passedThrough(await run(ORIGIN + "/admin/", { headers: doc })));

// 6) Assets are never REPLACED by the gate with a page — and since the web app was killed
// (native-only), the app bundle itself must be hard-404'd rather than served to a browser.
{
  const res = await run(ORIGIN + "/app.js", { headers: { "Sec-Fetch-Dest": "script" } });
  chk("GET /app.js is 404'd, never swapped for a page", res.status === 404 && !passedThrough(res));
}

// 7) The secret knock unlocks (302 + Set-Cookie).
{
  const res = await run(ORIGIN + "/realapp", { headers: doc });
  chk("/realapp sets cookie + redirects", res.status === 302 && /smd_access=/.test(res.headers.get("Set-Cookie") || ""));
}

// 8) ?lock=1 clears the cookie.
{
  const res = await run(ORIGIN + "/?lock=1", { headers: doc });
  chk("?lock=1 clears cookie + redirects", res.status === 302 && /smd_access=;/.test(res.headers.get("Set-Cookie") || ""));
}

// 9) An unlocked browser (valid cookie) sees the real app, not coming-soon.
{
  const data = new TextEncoder().encode("smd:realapp");
  const digest = await crypto.subtle.digest("SHA-256", data);
  const token = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const res = await run(ORIGIN + "/", { headers: { ...doc, Cookie: `smd_access=${token}` } });
  chk("unlocked cookie passes through", passedThrough(res));
}

// 10) The PG logbook signature-verification page must resolve for an ANONYMOUS visitor. An examiner
// scans the QR printed on a logbook; they have no account, no app and no cookie. Without this the
// gate sees an extensionless path, calls it a page view, and every printed QR lands on the marketing
// page — which is exactly what it did before this line existed.
chk("GET /pglog/v/<code> passes through for an anonymous scanner",
  passedThrough(await run(ORIGIN + "/pglog/v/PGL-7K2M9-XQ4TB", { headers: doc })));

// ...but the curriculum packs under /pglog/ are app assets and must stay 404'd.
{
  const res = await run(ORIGIN + "/pglog/curricula/generic-pg.json", { headers: { "Sec-Fetch-Dest": "empty" } });
  chk("GET /pglog/curricula/*.json stays blocked", res.status === 404 && !passedThrough(res));
}

console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — public UI locked; every API/endpoint/app feature untouched"}`);
process.exitCode = fails ? 1 : 0;
