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
const isComingSoon = async (res) =>
  res.status === 200 && !passedThrough(res) && (await res.text()).includes("Coming soon");

let fails = 0;
const chk = (name, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${name}${d ? " — " + d : ""}`); if (!ok) fails++; };

const ORIGIN = "https://stewardmd.in";
const doc = { "Sec-Fetch-Dest": "document", "Accept": "text/html" }; // a browser page navigation

// 1) Public page view → coming soon (the lock still works).
chk("public page view is locked", await isComingSoon(await run(ORIGIN + "/", { headers: doc })));

// 2) In-app AI: /api/ai/* must always work (this was the "AI not working in app" bug).
chk("POST /api/ai/reason passes through", passedThrough(await run(ORIGIN + "/api/ai/reason", { method: "POST" })));

// 3) Emailed approve/reject links are a browser navigation to /api/... → must work.
chk("GET /api/verifications/action (email link) passes through",
  passedThrough(await run(ORIGIN + "/api/verifications/action?uid=u&do=approve&sig=x", { headers: doc })));

// 4) Any other /api call (Resend-triggering endpoints, native app) passes through.
chk("POST /api/verify-doctor passes through", passedThrough(await run(ORIGIN + "/api/verify-doctor", { method: "POST" })));

// 5) Admin console page loads (protected by its own owner login).
chk("GET /admin/ passes through", passedThrough(await run(ORIGIN + "/admin/", { headers: doc })));

// 6) Assets never get replaced by the gate.
chk("GET /app.js (script) passes through",
  passedThrough(await run(ORIGIN + "/app.js", { headers: { "Sec-Fetch-Dest": "script" } })));

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

console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — public UI locked; every API/endpoint/app feature untouched"}`);
process.exitCode = fails ? 1 : 0;
