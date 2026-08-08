/*
 * Site-wide access gate — TEMPORARY "coming soon" mode via a SECRET URL.
 *
 * Why this exists: the StewardMD web app is being taken PRIVATE for now while the
 * native apps go through App Store / Play Store review, after a wave of scraping /
 * data-theft attempts against the public web app. This Cloudflare Pages middleware
 * runs on every request to stewardmd.in but only ever HIDES THE PUBLIC WEB UI: the
 * single thing it can replace is a top-level HTML page view by an anonymous browser,
 * which gets a self-contained "coming soon" page. Everything that carries functionality
 * passes straight through untouched, so no API, endpoint, or app feature is affected:
 *   • /api/* — in-app AI (/api/ai/*), Resend email sends, cron, the native app, and the
 *     emailed verification approve/reject links (/api/verifications/action) all keep
 *     working exactly as before the gate. Each endpoint enforces its own auth.
 *   • /admin/* — the admin console is already protected by Google owner login (_adminauth.js).
 *   • assets, fetch/XHR, and any non-GET request (POST/webhooks) — never a "page view".
 * The native apps bundle their HTML locally (capacitor webDir), so they never request a
 * page here and are wholly unaffected.
 *
 * Authorized access (owner / testers) — "only who knows the URL can visit":
 *   1. Visit the secret entry URL once:  https://stewardmd.in/realapp
 *   2. The gate sets an HttpOnly cookie (30 days) and redirects to the app, which
 *      then loads normally for you on that device/browser. Share that URL only with
 *      people you want to have access.
 *   3. To lock yourself back out (clear the cookie): visit /?lock=1
 *
 * The secret path is "realapp" by default; override it without code by setting the
 * SITE_ACCESS_PATH env var in the Cloudflare Pages environment (e.g. to rotate it if
 * the current one leaks). Changing it invalidates existing unlock cookies.
 *
 * To REMOVE the lockdown later: delete this file.
 */

const COOKIE_NAME = "smd_access";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const DEFAULT_SECRET_PATH = "realapp";

// Constant-time-ish string comparison (avoids trivial timing leaks on the compare).
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// SHA-256 hex — the cookie stores a hash derived from the secret path, not the path
// itself, so rotating SITE_ACCESS_PATH automatically invalidates old cookies.
async function tokenFor(secret) {
  const data = new TextEncoder().encode("smd:" + secret);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Universal Links (iOS) + App Links (Android) association files. Served PUBLICLY here (before the
// coming-soon gate) with a JSON content-type, from BOTH the custom domain and pages.dev, so Apple's
// CDN + Android's verifier can always fetch them. iOS opens the app for invite links (…?icujoin=…);
// the app forwards the link into the join flow (see native-bridge.js + ICU.handleJoinUrl).
// appID = <TeamID>.<bundleId> = 5QY4LUKX23.in.stewardmd.app.
const AASA = {
  applinks: {
    apps: [],
    details: [
      { appID: "5QY4LUKX23.in.stewardmd.app", paths: ["/", "/i/*"] },
      { appIDs: ["5QY4LUKX23.in.stewardmd.app"],
        components: [{ "?": { icujoin: "?*" }, comment: "ICU/Ward unit invite link" }] }
    ]
  }
};
// Android App Links + credential association. sha256_cert_fingerprints lists EVERY signing cert that
// ships the installed app: [0] = local DEBUG keystore (Pixel 9 adb builds), [1] = the Google Play
// "App signing key" SHA-256 (Play Console → Test and release → Setup → App signing) — Play re-signs
// the app, so its cert MUST be here or App Links won't verify for Play installs. The get_login_creds
// relation associates the domain for Android Credential Manager / Smart Lock login autofill.
const ASSETLINKS = [
  { relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: { namespace: "android_app", package_name: "in.stewardmd.app",
      sha256_cert_fingerprints: [
        "9A:36:BF:09:5B:CF:6E:23:5C:BD:DE:9E:DD:E0:31:2A:66:C4:76:23:E4:D7:6C:F3:BD:8A:F7:1E:D7:4B:EE:AC",
        "95:31:10:B1:E0:B6:59:68:35:4A:40:4B:07:B0:21:DE:89:C5:45:74:71:5C:47:99:FC:5B:6A:D0:5D:5A:C0:40"
      ] } }
];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // App-association files — public, uncached-by-gate, application/json. Must resolve before the gate.
  if (url.pathname === "/.well-known/apple-app-site-association") {
    return new Response(JSON.stringify(AASA), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
  }
  if (url.pathname === "/.well-known/assetlinks.json") {
    return new Response(JSON.stringify(ASSETLINKS), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
  }

  // Internal source / docs / native-project files must NEVER be publicly served — Pages serves the
  // repo root, so without this the runbook, CLAUDE.md, the vault, and the ios/android source would be
  // reachable at stewardmd.in/…  . Block on EVERY host (prod, preview, pages.dev) with a 404. The app
  // only ever loads web assets (js/css/html/json/kb/assets/vendor/sw.js), never any of these.
  {
    const p = url.pathname;
    const INTERNAL_DIR = /^\/(docs|vault|tests?|scripts|ios|android|worker|local-plugins|Packages|backend|node_modules|\.git|\.github|\.claude)\//i;
    const INTERNAL_FILE = /^\/(CLAUDE\.md|AGENTS\.md|README(\.md)?|wrangler\.toml|package(-lock)?\.json|capacitor\.config\.json|tsconfig[^/]*\.json|\.gitignore|\.assetsignore)$/i;
    if (INTERNAL_DIR.test(p) || INTERNAL_FILE.test(p) || /\.md$/i.test(p)) {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
    }
  }

  // PREVIEW BYPASS: Cloudflare Pages preview/branch deployments (<hash|branch>.stewardmd.pages.dev)
  // serve the REAL app unconditionally, so changes can be verified (headless eval harness + manual
  // QA) without the /realapp cookie. ONLY the production custom domain (stewardmd.in) stays gated;
  // the production pages.dev alias ("stewardmd.pages.dev", no subdomain) is NOT a preview and is
  // still gated. Anti-scraping on the public site is unaffected — preview URLs are unlisted hashes.
  const host = url.hostname.toLowerCase();
  if (/\.stewardmd\.pages\.dev$/.test(host) && host !== "stewardmd.pages.dev") {
    return next();
  }

  const secretPath = ((env && env.SITE_ACCESS_PATH) || DEFAULT_SECRET_PATH).replace(/^\/+|\/+$/g, "");
  const token = await tokenFor(secretPath);

  // Explicit lock / logout.
  if (url.searchParams.has("lock")) {
    const headers = new Headers({ Location: "/" });
    headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    );
    return new Response(null, { status: 302, headers });
  }

  // Secret-URL knock: /realapp (with or without trailing slash) unlocks and redirects
  // to the app root so all of the app's root-relative assets resolve normally.
  const hitPath = url.pathname.replace(/^\/+|\/+$/g, "");
  if (hitPath === secretPath) {
    const headers = new Headers({ Location: "/" });
    headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
    );
    return new Response(null, { status: 302, headers });
  }

  // Functionality is NEVER gated. Anything that carries app behaviour passes straight through so
  // no API, endpoint, cron, email link, or native-app feature is affected by the lock:
  //   • /api/* — in-app AI, Resend-triggering endpoints, the emailed approve/reject links
  //     (/api/verifications/action), the native app, and cron. Each endpoint self-authorises.
  //   • /admin/* — the admin console gates itself with Google owner login (_adminauth.js).
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/vendor/") || url.pathname.startsWith("/followcare")) {
    return next();
  }

  // Legal / support pages are PUBLIC even while the app is private — App Store & Play Store review
  // require reachable Privacy, Terms and Support URLs, and public policy links must always resolve.
  // "delete-account" is the login-free account/data-deletion page required by Google Play & Apple —
  // it MUST resolve for the reviewer's crawler, so it can never be hidden behind the coming-soon gate.
  // "followcare" is the login-free, install-free patient recovery-check-in portal (FollowCare AI): a
  // discharged patient opens it from an SMS/email link (…/followcare?t=<opaque token>) and has no app,
  // no account and no /realapp cookie, so it must resolve for anonymous visitors. It is safe to expose —
  // it carries no PHI in the URL and its own /api/followcare/* endpoints self-authorise via the signed token.
  // Match both the clean URL (/privacy) and the .html form (/privacy.html), with or without slashes.
  // "queue" is the login-free, install-free OPD patient wait page (Smart OPD Queue): a patient opens it
  // from an SMS/WhatsApp link (…/queue?t=<opaque token>) with no app/account/cookie, so it must resolve
  // for anonymous visitors. Safe to expose — no PHI in the URL, and /api/queue/* self-authorises via the
  // signed token (only position/ETA/status are returned, never name/MRN/phone).
  // "opd" is the staff OPD operations console (opd.stewardmd.in / stewardmd.in/opd): staff sign in with
  // their GHIS employee-id inside the page; /api/queue/* + /api/ghis/staff-login self-authorise. The shell
  // must load for anonymous visitors (no StewardMD account). No PHI in the URL.
  const PUBLIC_PAGES = ["privacy", "terms", "disclaimer", "support", "refunds", "delete-account", "followcare", "queue", "opd"];
  if (PUBLIC_PAGES.indexOf(hitPath.replace(/\.html$/, "")) > -1) {
    return next();
  }

  // Brand images needed by the public pages (marketing "coming soon" + the login-free patient portals:
  // FollowCare, OPD Queue). These are public, non-sensitive brand assets — not app code — so serving the
  // logo/favicons to anonymous visitors is safe and expected. Everything else stays 404'd below.
  if (/^\/(logo\.png|favicon\.ico|favicon-\d+x\d+\.png|apple-touch-icon[\w-]*\.png|android-chrome-[\w-]*\.png)$/i.test(url.pathname)) {
    return next();
  }

  // WEB APP KILLED (native-only). Everything past here IS the clinical app (index.html, the JS bundle, kb/,
  // engine, sw.js, assets). StewardMD runs ONLY in the native iOS/Android apps: they bundle www/ locally and
  // only call /api/*, so a browser may neither RUN nor DOWNLOAD it. Owner testing is on device or on a preview
  // deployment (the <hash>.stewardmd.pages.dev bypass above), NOT on stewardmd.in.
  // Emergency valve: set SITE_ALLOW_WEB="1" in the Pages env to serve the web app again instantly (no redeploy).
  if (env && env.SITE_ALLOW_WEB === "1") return next();
  // Blocked (this is the app). Decide page vs asset by PATH SHAPE, not by request headers (Sec-Fetch-Dest /
  // Accept get dropped by some clients + edges, which is what 404'd the site root): the root, any extension-
  // less path, and .htm(l) pages get the marketing "coming soon" page; a real static asset (.js/.css/.json/
  // .map/kb/…) gets a hard 404 so the app bundle can never be downloaded or run in a browser.
  const isAsset = /\.[a-z0-9]+$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname);
  if (isAsset) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  }
  return new Response(COMING_SOON_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "index, follow",
    },
  });
}

// Fully self-contained: inline SVG mark, no external requests, so the gate can block
// every other asset without breaking this page.
const COMING_SOON_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>StewardMD — Coming soon</title>
<meta name="description" content="StewardMD — AI-powered antibiotic decision support and antimicrobial stewardship for clinicians. Coming soon to the App Store and Google Play.">
<meta name="theme-color" content="#0e6e63">
<meta property="og:title" content="StewardMD — Coming soon">
<meta property="og:description" content="AI-powered antibiotic decision support and antimicrobial stewardship for clinicians. Coming soon to the App Store and Google Play.">
<meta property="og:type" content="website">
<style>
  :root{ --teal:#0e6e63; --teal-2:#0b574e; --ink:#14202b; --slate:#5a7184; --paper:#f6f7f5; --panel:#ffffff; --line:#d7dee3; }
  @media (prefers-color-scheme: dark){
    :root{ --teal:#3fc7b3; --teal-2:#2fae9b; --ink:#e8edf2; --slate:#9bb0c2; --paper:#0d1b26; --panel:#132030; --line:#2a3d4f; }
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; height:100%; }
  body{
    font-family:'IBM Plex Sans',-apple-system,'Segoe UI',Roboto,sans-serif;
    background:
      radial-gradient(1200px 600px at 50% -10%, color-mix(in srgb, var(--teal) 14%, transparent), transparent 60%),
      var(--paper);
    color:var(--ink);
    display:flex; align-items:center; justify-content:center;
    padding:32px 20px; min-height:100%;
    -webkit-font-smoothing:antialiased;
  }
  .card{
    width:100%; max-width:560px; text-align:center;
    background:var(--panel); border:1px solid var(--line); border-radius:22px;
    padding:44px 32px 36px; box-shadow:0 24px 60px -30px rgba(0,0,0,.35);
  }
  .mark{ width:88px; height:88px; margin:0 auto 22px; display:flex; align-items:center; justify-content:center; background:#fff; border:1px solid var(--line); border-radius:22px; box-shadow:0 10px 26px -14px rgba(0,0,0,.35); }
  .mark img{ width:68px; height:68px; display:block; }
  h1{ font-size:1.9rem; letter-spacing:-.02em; margin:0 0 6px; }
  .tag{ color:var(--teal); font-weight:600; font-size:.82rem; text-transform:uppercase; letter-spacing:.14em; margin:0 0 18px; }
  p.lead{ color:var(--slate); font-size:1.02rem; line-height:1.6; margin:0 auto 28px; max-width:44ch; }
  .stores{ display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
  .badge{
    display:inline-flex; align-items:center; gap:10px;
    background:var(--ink); color:var(--paper);
    border-radius:12px; padding:11px 16px; min-width:190px;
    text-align:left; opacity:.9; cursor:default; user-select:none;
  }
  @media (prefers-color-scheme: dark){ .badge{ background:#000; color:#fff; } }
  .badge svg{ width:24px; height:24px; flex:0 0 auto; }
  .badge .b1{ font-size:.62rem; opacity:.8; display:block; line-height:1.1; }
  .badge .b2{ font-size:1.02rem; font-weight:600; display:block; line-height:1.2; }
  .soon{ margin-top:22px; font-size:.8rem; color:var(--slate); }
  .foot{ margin-top:30px; font-size:.78rem; color:var(--slate); }
  .foot a{ color:var(--teal); text-decoration:none; }
</style>
</head>
<body>
  <main class="card">
    <div class="mark"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAzI0lEQVR4nO1dB3xUVfa+5b1JoUOA9IQSqnSkiAVBXV27Yod1RRT+0osQmoCUIB2RYhcboqhYUBaVVbAgvfcOISQhCUmAZOa9e+//d86djOg6URFmkvDOorKQTN7M+965p3znO1QpRRxz7PeM/e6fOuaYAw7HijPHczjm1xxwOObXHHA45tcccDjm1xxwOObXHHA45tcccDjm1xxwOObXHHA45tcccDjm1xxwOObXHHA45tcccDjm1xxwOObXHHA45tcccDjm1xxwOObXHHA45tcccDjm1xxwOObXHHA45tcccDjm1xxwOObXHHA45tcMUgpN6RlOpRj7Fbg9Hs/JU5luj1sIIZWkhHKDh7hCalSNCAsN/Z9XUJRQSmnAL7/UGC1ds7KKECWlDxNKqaNpqTsP7tt+cM+xtLSs09lH0o57LBvAAfeeMMY45wmR0RGVKkdUiWie1PCKpAa14xMM7n0qpJQAEAcipRoc8Kyf5yr2Hz64auPaH7Zu2Hv8UG5hgaRSKSqkELYtpRRCEKWIxG9jinJGFJG2bRBeOax8Ulx8i0bN7uh4Y6M69fSrORApxeCQRd7C7XGv3rD2/a+Wrd++JbfwjBHiIhycgz5llFKSKCWkEpJI+C24GvQ3cMYQoqgiCrDCGa8aVr5V/SYP3nT71a3acnxx309xrHSAQ18epXCdK374buFnS9bv3uYGDEhuGJxzRYmklDAKd1VDAXyGVBKwQuEdEqn/AqILZRiMMs5NQ+FpYkp69RUt77/h1mtbtWf4U/SPI46VcHD4HuWdB/a+umTRF2u+swxChGSKCiqlVJQxSuHOM7ifeEfhvsJbAhchCZGAI/AWGhuMMM4pZ/CNnHH8JvgRhXan5m0fv+OBZg2vcFxIKQCHRoZlW29+uuTlT97Lkx4hFZFCQkwhCUScXl+hKFWMAj68Tzz8F/0HYEN/HVXwVgEIjFLONZoAWZRQJYVHUqVCFH/yvq5P3f8vxpiQUp81l7OVRHD4Ys9jaaljZk/5ftcmGWJSTuFCpVISnQLmokV3Hb+NQXLi9R+/vBbce6XwT/U/EJsSil8ITgZeUCobfgkliS07t2g/adDwqBo1nRCkxIEDAgV0ACvXfD9+/qyDJ4+zEJMYXPt/Lw4ogESbjiqYDiw49XkQQAAeMVL7Dvg6xI1+v95QFWEmlbTRxUiofBBKWtZtNLpn/5aNm/ou5vK0kgUO381YtOzjya/Py3Gf5YQrRhQcAIQRik88ngdSUchUIUWV+pYjAoSSGFEASAAdDBwHRBXoMMDpQJaLP0gADiByQcO/U3DOGJwZvHpohakDR13Tqu3lfL6ULHBoT/7i+29NX/SqDdEAkQruJQAC3YBGBmHgIxgeKNIWbtuDN5tQSTjjYS4XpKoc3Iii5Jy0mGloTyGF4kQJSwop4O8IxKw+Q+dCqckNTqUikeFV35k0Oy4yWkjBGSeXn5UgcGhkfLbyPyMWTC+ggikKR4IUSuCTDU8vxaoGoQANBpGEotLtqWiENa5Vt3WjZglRsbXjE8qFhzPG8QuUkCItK/PEqYwjqcc27dy658jhs1Zhoe0hlHIJRQ/KGP4XnBI4CEapwUz4PROENIxOmDN4XEzNqMsz/igp4JBKMsrWbt3Ub8qYHKuAMExVpZC2t5aFxXC4l4bORSnlNmlWq37nNh06tmqXGBvP+R883G6PZ8+hA1+vWbX8x1W7jx7E8IQBGjhTDA4uOITALTF9MEn8ZFrG1psyYERsZLQQ4g9/RBmzEgEO/VweP3nikWF9j+adgseWEAg1IHUVpKiIRQjhhkEYMxVv06DJo7ff26HFlSGmS/+VN3T4nxqW/sPzn/vc/LzPv1nxyqeLD2ecgDiXc2JgdKK/mcGhRSllEP8oKlSLuKSpg5+JqRl1ueEj+ODQF1DocT/17IgVG35wcZMZ8CBj5uAtiOtyJwanNLpKjV73Pnz/TbeFhIRoYGk0/GFagWGoN7AghKRmnHz9w0Xvf/W5mwliMMEAhIBDDEYo/I9KgChhkjRLqDdr6Ljo6jUvK3yUCHBQSucvWjhl4YuSEgg1OZQuJVXg9aHwRWw4YggX6qorWo56akDD2kn6JMKk9S+nmrpOon3J9xvWTn5z/v7sE4ANIZSQtoIuHkEnAuU1pUzwKqpFQv3pQ8dG14i8fOKPIINDf9Bb9+1+bPSgrDO5jDEbuyQMeicYDygdfFBliXuvu3F8/+Sw0FAhBADob/5oLKwzxo6ePDFo5oTtx/ZRCY4DimJCaHwoBmExRCJSKSFa1G74fPKEyOo1LhN8BPMdQpSJj+bLH75zVni4aRIXhJsMChqU66oGJqUGpQ/dePvkIaPCQkOllJCm/u2fjkEnlMnjI6NnDRrVKLKWoFRxCt6LFtVdsTImLMttWx5bbNi9re+E5JOZGRCuYnmlbFtQwSEBHN+uX7NqyzrAgwnZJWSoEs4SuD86U5Hq7utuGtd3sMGNi/7IcshKZGzN6BmDRzeOSsDkCMtlTBOLMBu2hbRtoIoI+fOe7b0nJB8/eQLTmTKOj6CBQ5e3PR7r5Q/fzSs4JzyWhHsATTUlFZz+tlAeKQutG1peNa73ENMwL5EzZxTcQGJM3IxBoxvWiJMeC+rolEK6VMRIZIRyxpSLmS7XxsN7B88cn5ZxklEGrKKya8EDB/LzVm/4ef22LVKIQstDPDa3oeQlhFKWtN3C8lhJkbFjew0KdYUIKS7dMQ/nixC1YuPnjpjQKDqRK8UxEIZyui6bMs4Mw3C5jFBXeHjYliP7+k8fk34qk3Nehs+X4IBDN12llIuWLXULC8I9qFhLoouhWMmWVIZQY/jj/WpGVA9AAVvf5vio2Pmjnrsivp6w4WLAmUkIQrBsD51+aN8ArMmW4wf6pIw8mZGuS7GkLFqQwIFVrT2HDvy0dQP4b6x5Aj441KA4Y4bJQ0NDbu3YuWO7qwBJyPO61KbDiLio6FlDxzWNTxK2TQR0d6DJRwiwUqWUlm3ZtiVsYoltx/cNnTXxWFqqDqtJmbPggEMXJ774fqWbS1doKDMNyqEbgpkJ/FKcVgot9/g9D57fqg2AQRghRXx0zIxhY5rEJ8GPxvatIoRLaVMlpFSWbbsty7IUoRsP73nns499pbwyZkEAh77ZQsq1O7exkBBqQkEDSRmE6l8cCtjXtW7XJKlh4BkVnMH5Uis2Yd4zKU0TkgCsLpOFGIZhgHtDlhBTyhbCU+hpk3RFl5tvK6u002CAA/+9/+ihvccPIa/Ly8WBbBahI4XNhbr3hn/6aiEBvkIdD8VHxcwdPalRfF0DqcwU8AFezTBNQUh5Fjqwy7/njZhYNz7RAcfFM/TA2/buPp2fq9yWtLApD9kBDpx4LLvQE12pWrN6jYP4oTPMXxJi4mYnj2scXduk3DAYN8FsomIr15g5eHS/bj1CQ6AoR8qoBdpz+AaTNu7Y6i5wW4UeYUGFQ9nQnxcCS01uT4crWlcIL4cswKC5a865kLJ2bMKMwaPr1YyltlJuYbutqxu0eHPi7H9c0wnq+lBhL7N19IC/MbzXQsoDRw5RIaDD4euWYkFbKBLKQ27q0LEkRHlc1z/iEqYNeqZ+zQSXrXrcct+8ERPrxCVolAcRu2VxkBrji7TM9ENpxyH49DI9oY+ig44QzmqUq9K4fgP44hLwyXOsf9SJS5w/cnJaxsnml9NgS6DBgeUumpuXl+8poDBwYFDgD0MGALxx6NfT2rVrV6lUxZfxBt0Yxqc1q0XUrBah4f3nkeHjHwG7vci8RAPgJpaIN1iyJBiEFBD1h5iMQnnRS8pA7jClNKJSFaOEEWqYt83251hFRQoR5zPQoNf8G0MuEx6pGi0lDihB0+cAgjjlSA0t6r1CBEIpdMlJCTT2J6q0Po6It+KOVuh2nysoOJqe6na7FSGGYcRUr1mpfMXQ0NDzpvRKomRIcMDhnTkDBh6msVJAIwNyk9I6RCQxCgEA4eUfS0/bd/TgvqOH0zJObt27O/9sfmp6uhC2otQwjcgaNSpVqBQfGV0vLiGyavX6CXVqx8aHh4Vr51Fy9CCC5jkgAgUmDUF04EMnpT6ZkVRcakzi1J0+Po6kpf60ef33G9ZvObj7VGE+N4BM5LEsZQupbD2YJZhIzctKK8jdm3Xsmx1rpdtDbFk/MvGfV3fq3O7q2nEJ+qVKAkSCAw7kDgOnB/qx+At4PVAslZRx6HiVBlP4PxzGIxt3bnt/xecr1qwG1RDTZBzm+ZF8UDQeg6IPHJ0LnD3CVgLnOnFKd/PRfZsW7l6w+M1rmre+vdM/rm1zlWkYvomNywscjFGB7CqmBRKgzKHgpFYG4zDmWPJN6myWkgPHDr+59IMPv1l+VroVowY3FSXQqxO2N+CUCpq2XjI9cNxokb9RcJhKIgiFIW6S6c7/ZN13n635rkPT1k/c8+A1rdtpIlKw0ubggMM0TU6JKrQUDongfDyTUPVgBqfHTp44c+5s+fByvpiupJnEGyaVfOuLpa98ujgzJ1sayiQuReEugwcUAvtzXgUAFIpB3iFEVTDuQIUXH0BhgbNUQSYPM71MmnTtoR3bZ4y769p/9HqgW40q1YJ1xAQaHPohiI2MTqwRnXXqlDIMdBbIKTYJNO4lycrLOZWTXV6Xz0sePiQiI+/smcmvzP3k55U2p9RkRFFpA+VD9w7hN+Aj8BuArgxzUprs752NwL/wxiuEyqIEB6o9JiMGLaDqvdVfbty7Y/TjfVs1bhpg6oK2gPsr/FjKhYZVKlcBHzIoHpCiz4VD2UPm5Oau2bJBfzUpSaaQ7sMY23f0UI+xTy/+7zIpJERLSEXWX4O8aFQAAHIyzmTpOXAFfHrgI6A7gdxdD/brEAyNY1ACtR/M5qjBdqce7jv1mS9WrfRpX5VlcPjeYaM6Sdw0uGkwk1PDwDFm4NIwyS0lv/5plS4tBL298hv2GmNs4+4dPZ8dtmHfdsoJ5CHCRp/hjZS8sh8Ewg5KCafERWgIZabJmMmoiymTMU4NRTm8WYxJvOP9kMB5GfcwD2FbtrCIPJmbM+C5Ma+8/4739QP4gQSH7EMIadG4SWhomCs0hAMHDLXcNK8Y7edtW46dPHGeyEqQTQKTFG7fkq+W9Zw4/HhupmFwhcPWSgBBDO8x3GbfIKcpIeZQStlECh1aKCVtpSxlu4XHY9mWkLZgqDwD34AjMxB9SFBDlLawER/MkrYSKW8tmLd4YYAjj2AEpPj26ifWrVq5Sk7hWcjmkFeMxTCgdEgps/JPf/X9t927PFwSispSh59Svvn5h88vecstPaZpWFIQKMxoATI4TlAOBEIqahPlsYUNyKlRJaJ6tar14mtXrlDJAJI0tYXIzc/bc2h/RnZWek6WTQVwiQyTQJqmjyjvbDBViqMYFfyOyRmLX1O26Hn/vwzTKLPg0Hc7NjKqce2kH3ZuBj0uOMpRjAMjfVDdYOTtLz6668Z/VqlYKbgtUIGT02cKzqW8MmfpD98IEyIjqD4A7VlX7zD7wLiCQzaOboObjeo16HTlVZ3adoiNjAp1wcz3+Wbbdlpm+uZdO75b9+OqzetzPWeg/8u4V3bIhmAFXlkRwQgnTAkoAu0+sNey7YCBIzi0aX2/F362ZNzLzxMbJlOJL7zAk5dBzG6M7t6v6x33BAscigD/iHOelZMzbNakldvXu0yDGlTqsAknJUGEUIsKaW1CxkIIva1954duvrNJvYa/ecv6RDhfh1nbiYz0T75d/t5Xn6efzSGgBAHgkDaEM0oILoktPKGma8i/ej1x7yOBPFaCCY6jJ0/c3af7ybxsneJjvkJwWBaidklIbPmI18ZNrROfGPhCoSpSq928e/uoF6bvPHaAuuD6oHwH0/cYgOhMlCpDUlC/JOyqxi373Ne1daNmvrepI01UG/vlpuqkFE8P6ZvHOZGZPue91z9b+62lJINIRghQtLKZJWtXjxrff9g1LdsGOKEN2sCFfpMT589esHQR0nxwYgXkhaHageUhxiS5uXn72SPG6yM/YP7DdwO+37x2+Nwp6bnZOOgvvRRo7SVA7xghDbULym31yA139n24e4Xwcn+1M+Lr5Sql3vli6dTFr1hMUMsutCwiaPt6TZ/p2b9eYh1dSA5kEBY0cOibvWXXjoeH9j0nC+EgOV8CEDVUlC2oLQY90uOphx8LmPC0D4VvL/to9pI38j2FHCIPyDOAUoBKZCghpisRTDIoXQx+oMdjd9yvqSpa7vIv/1wIYuC7VqxZPfmNuUdPpXGTd73+zoFde5QPLxeUszWYo1paRbTfxNFfrFvNOHzK2JjFrLYonVNSuBRPfrzPkw92DYBT1fdACLHgw3cWLH1XQPuMWVLAQgZoIEO6itk1StihukuN8pWHdu15V6ebf7PX4cJMv8Ed+3ePnjvtzk7/ePT2+4LISgwmOPR73n1o/xPPJme58z1AP5fEghQRWejQuOICshlG6DM9Bzz5YNdL6j/09eSeyR89d9qydauZy8AOkLKxBMNB8AeFoaASAfUJKVVCteip/Ue3btzkIl6YvozCwsJQXCAUxGQtmCxZHUk0qFX33s43E1sQFF+ALAESAexdYnuC4wDcxFfnvPz+276A/9LVxXtNGL5s7bcQ/kph2TApgQ4DThNQ04eShBFimi5utq7b+MURKa0bNxFCXMTylA4+NDL+viv6OxbkCWD90/PO5PcYPWTj4T24fQtR4lWi1oc7DlcbzFTs6W49H+/y0MX1H75XW7d98+DnJ53IP8UVBBn6ANNXAv1VnEMAAVtCQqjRuXn7sb0GX7poQFMGSVAt+OPh+pTdvGvH/41LPpadrvsMcJDgVIhWfsI8BmTklJSDH3z8ifseuVj48N3ab9f9NHbhnLS8LIMSAduelLdpVqRgiRfGFCUuygfc/1i3W+8NDQkpBhllYHVL8IcvoF4gZfOGjZMf7x1CuCIcM0RDT7V4k0VcsiSosLic+u5Lr3606KKcL95bq9TCZUuSX52WUXjaNA3QnEQOAcPsmsJ1YBRky8LCApdFRnT7vyfuefgPkaEPmqA/e3/HSsrV6w/6vc+Wjpw7zU2lyU0oHaMyGKrHgd45MHhB148wSZMf6dn97gf+ztOpBWHOFhbMeOvF91f/R5rQ/YOaKHY2KJSrocqF9UpBQZNDJlaNntR36FUtrvTOExT7XjKzTxncqFKpcumdgCop4PA9bR8tXzZl4Ysn8nM4djzhD+FkwbqCCcrnuK6LUlsNeaRHjy4XeL7oG5aWmTFw5vgNh3cbuKMHxNb1GjhkwRPv/BKlMMorm8YlTeozrG58reIdhg4ht+3bNXzWpKpVqj43YGRURI1SKq1fssDhDQy3bR703PjDGalIQYYtKijJBf+CXX8UyBCguSPkoK5P9Lq/21/Ch0+hdtOubc++OHvrsf0KdYU45VC1xvIVvD6jsEoDh3cZIbe2uW7IQz2rVa78Z5Dx05YNw+dNST+TzRlvWafRlN7DI6tXDy5VuNSD4/zPd/3Wzb3GJZ84nckMg0BNXUensC8BrllKYoFgF1N06KO9nnrk338SH74a2jc/fz9y3tSMvBy9vodwKGdB06todNfALpqkJIzy+zveMqRrT4MbxWhb+5KL79avGf3ijEx3HuUENo8J1SI+ac6w8TWqRZS686VkgUObvgfrt27uP3lMWu4pBVsN9DSDphUqBYqUAA4lpEHY8B69n+ra/Q/x4atPL17+acrr83Ots5xDXINrAPEH6MgXOV0MWVmhpmvMY33vuf7m87+9GMy9+vGi+Z+8V0AEo8QSlmXZVEhiq1ZJV0zqM6ROXGLpwkdJBMf5+Hh6xvhjuVn6noFerES+P1RDvEu84NixxMie/Xs9/O9i6uv61FdKzXj3lde+WAIVceTnFX09/oMfhda2FkrGV48e8+TAjq3aFWkDFGe2sGe+/cqrXyyhIbCBQesT2ZatgNthmIaZWD16Sp/kRrWTShE+Sig4fPjYsGPrwKljjmWfAoo2aJTqZELv/oNUE3gvIKMvkrv17t7lIShS/Q849Eudzs+b88HCxT+uEBIonxDsQukTdwpi9EkljGdK5Jc0iq0zc9AzSQm1i++vatBknc4ZPue5b7ethRVg6I2EQo6xkPDXJnO5TJMadWvGzRn4TGREjdKyeqHkQhiEdYRo1bjprCHjYipHwOlte1c3YcmUM5NzF6wPNk1uM7Lw4/dyck//prSg6+Kc86MnT/SbPvbDn75GWTqgEynOiKF170GrWJdNoPsqZMcrrpw7fGJSQm2tjFvMUaV/lm3bJ09lQFHdoPAa3glPyLPgIg0DyKFU7s44Mnj+cyezQNq2VEgfl1zPoU074Q3bt/SfOvZoRhrwKXH9J27eYAxmXgwqROPoWsOf7NemWavzv9d3xPz35x+mvrXg8Ol0YgBTBAAEE2aK6V4ONnGYjRrnlnzkhtuTe/QJQ7GvP+P/9U85np7Wf8ronWlHhELaOdZS4TecUsO7WgpCFqlaxNWb0ju5ZrXqJd9/lHRw+PCxduumvpNGpeVmc0oFk+g7OIN9CqxdUqMp/UdG1Yz81XcVxY8ffrVswkuz8+xCHmoSTTPT+2Z1LYNzSDEVUZYIk2xot14P3nznX+2FSvziI6nH+kwbsyP1YCg3CQbRXgKYTrTguFHMBk5hi4T6KX2GxUaW9NVPpQAcvqBh867tT40fkZp3ipvchAV+kF38+5Z7BnTtER4Wdn6hSe/7lEqlvPzCG58vgZQXJgmQUYSJiR5z1bw/bhpCqso8bMy/+97U/toLY40I/InH0k/0njJ2X8YxbkL0omsq3hdCVqEQwgCeimqSkDS53/AkLKkFfZq+dIPDh48tu3b0mfzMifwMJmi44erzUPcnujz8mwfdO654Jv/ZF2d9uOor2FSMM4foMoo2fgENgKHsLGXcbB5XZ8SjvRsk1IFbpado/rppfJw4lTFk1sRtqQeoi1g2cA9wtAAjYGAwwZgfjG8pUqNi5ZkDx7Rt0qLE+o9SAw7fXV+3bfPQ6eM9Hs+zfYd2bn/N+Q+6r9Rx6PjRYbMnbdy/+5eOKq7z0weIFmGCQgaqC13XuPXo7n1jLsZ+LolnWWpm+sgXUjYd3ac4dds2FGSRqgJjKZiBS6JwCoHEVIqY3Htoh2atS2Z+W5rA4cPHrv17pZSN6zU4Hxm++vTqjWsnvDH3UEYqwc06uIjcO+6udXdwjTU6fM4ev+3+gY/0gPDzIpW3BZ5u6dmZg6c9u/noPhh3kzh6gXmvDn7h/0A/gFOD1ShX+bleT7e9okUJxEcpA8f5J8j5p7XvD5d8/cXEhS8UKGFw5rFs4GihS4eyg2Z/IlQsKUK50fuefw341xMXnYonEB+nTmc/PX3C6l0bISCFKUk42OCKGTUJowYMzbq4wQgrx0NnPJV8ZeNmJQ0fpQ8cvnkQXzFbn9ke2562cMG7Kz6zYUgZGqxQGsEZOkhZNXVHKqALS7ti+UpT+o24+aqOxfP9JZTHvPt4LoQH6naPWzBzyarlpKixDKcO7gyBIAP/xGBcEVLZLJfSY3D7Ji1LVHxaKsHxv7fhXMG5Uc9PWbbmW2VAg1XiWGKR6CPcfu/ie9RYahRda8yTA9o0aVlMO0b9+q8uKH8B/1FYWDjh5ec/+OkrqaQB+S0q1GC6pEVJkIMIJ18Vs9zEJwdf07JNycFHKQaH7/7tPXzwmblT12zfbLpcyoASma5B6VAUWME+VpYkLWo3nNZ/pF4P6+8e+Nz7j5vWrd++5V933lf5gkZ29be43e5xr8xauu47KHxgT0/PZHgnsGHNDxLbLRERViHlqaHXtGpXQs6X0goO7yQibokbPWfqwYxUeBbhBMeHEkVftcofh/lWUEyRtni44619H3isarHsLJ+T+Oi/yye/Nd/tKbyuaZsJvYdVLFf+AoJWHz7Gv/bCp+tWEQ6nm54cp/ALvgBVXgSQSBStXr7y5N5Dr27RpiTgo1SCw/fBLf7y0zELZp6xCkINE5Z9IjLw4cScBCpclHNq4/LiJ2+9f9CDT6CAn9/PXeeithBT3njxzS+XCIOEulyE0mubtJnaJzk8NOyC8VFY6B7/xgvLt/womHBbMD5HbBsUxEBxAgCDUjVAb4f85amhVzVrFXR8lD5wFIm1qYUfL56ycEEBxcKorkSeF1pCkMFhaZ8kpEJIeO8u3brf/kDxtAwdJVi2NeaFaYtXfqFgSoUpTgyXyQm/sdlVz/VLDnG5LiD+0JDyWJ7xr835cvP3HiUsAQUxGMJAGQ/Q+WCUGLCCkjIO58uTQ9oFO78tZeDwemmPe/jzzy3f+KNQ0HwHvZeid+HlkulyAtadalaoNn3wMx2aX1l8XOkNbM+de2b+tE9/WAnTj0QJBjr+BmUGsBTZLa2uTuk/PMQ0/w4+Ul6ds/Sn/7opLmtBBRgtlE8Z5SbQ3gzoGfHyxEzpMahDsyuLQXMZn5X95Tr+jNo8MgiPnDg+891XvtqyxoaF95LY8AjihAneARTEAf9gKyGs+vG1JvQe2rZpqz+TmOw6tH/Kopd+2L2ZWhLkU7QeO9LfpSIGYyY3Hup0a3L33lq3/6/iQ0Oq0O2eunDBB6tXeECQBXCMC7BhJhte1mBKI1GRGuGV5g0YVys6Llj4CJrL8iUL2vC2/j5MYYAZ5w1hKn/Pzj7Txn69Y5235+lVdcQXxC/G7pYitiK2vL5pu3dS5rZtCoe3X2QU3bNNe3cOmZey7sgeFuLiYS7DZcDqP1BrgUYu1E0UbEZetPyT9du3XNhAip7QCQ0JGd69993tO4EUGgcuCUxrGZrHimow3hFzlXYmO+WteR7LA8z4YGijBUH2yecDzp47+/rHi2vFJdx6bWcd5WnZJ98Xai4ntMk491ieD1YsW7B00SnPGaarWjauWYAPE+47h84WFK2A6CVV99vve/qxXuXDyxXT1tKunjL24covp73/ar7tNsBL4DZZk+FdQqYZ8IyoZQkuVP9Hujer3+iCh2X0eLBhGGP+byDM6fwA9TEte+1NvlHjmyhqIRny5z3bXvtkca8u3f6YqFgGjhVdmqKU7jywd+z8GZsP7jYkvalDx6633tWi/hW/exdP5WSt277lveWfrN23U4RAr0zZNgiAonqWd3xS+0ClCi2L2WpYt1497wPJhmKSC+2rpZIvfvTu3I/eFoACCGINGKsHJS4CAn/w0pSAsL1RqIZ1ffJfd4Amwt80Hd/Ywp748pz3fvwPMVFREd+OXn8NHFTsClFbVjBCF41/vlZMfOCHGwIKDt/b++ibL1PemJ95NsdQjBiEucxy3Gxep9GVDZtWqVARxt2U8li22+3en3r4x60bj2eepCZnBpSc9UmiyRIoxQWvDH15xoilosIq9X+4+z033lp8x8QbfhYWjH551vINq1GejdjgiGAaUytwMDTAK2M1wysN7NL9n1dff/E+CsyZbXvymwsWrVrOTEyz8NyBQAqFKUFH0LIppT1uvm/oo70CP3wbOHD4BBtf+nDRnCULC6UFZWNkdJqwY8A7nKprhRJWycMHZVOJPQhmeMVKpbfBiixjiephuP4LmH4xFSKm9BnWunGz4j9HfSUZ2acmvDZ35c51epQe4hobtGOA3idgvomg4AJVrFb16Im9hjSt2/Di3h79qFjCnvDKnKVrV6oQDmgQ4C3wgEScCKEoqRpe6c1RUxvUqhvgzDaAP4mxnLzcYbNTpr//mqAEuHQmB5YvzCjpwQNpS+GRwlKQfegbD2EhA++OHF3YOIDS0LhNUotG435oJlWHOle8NGJSa+xtFpOYCPx8dxzY2ytl1Debf4TN2EAWhxgG5t5Qfprjxg9hCfc5d8u4+lN7j2hatyGEMhf1wdUbEUxujO7R9+p6zWB+HBeaeTfAoWS6ZqCcPpf/wTdfBn5mP3CeY/2OrZPfmLvl4B5cBAna79BTgCXlcNeRZolZJfKmtGSwl4GBNU+pYYwnSZFqBnzAlFJT0k5N2k7oO6xi+Qp/RhNh695d/aaMOZ6XGWIaAtmdehsfOC9vVqCEx5K2vKlFh5R+yRXKlb90ZC3NH9t79NBT00efss6At7As4IxJ2LOBrhLKOLUqR72XMqda5aqBTGsD5Dmys7Mnzpu1Ne2QYZhQz+Qg+kykgnY1cmCA0Kml40Gcg0oDOqvwC+aOYGYA/D0meIp49RtNGFFhzCJdrr05ZcDIiuUraK/wuxegnwBK6ar1P//fhFFHsjKooh7w3gTm57C+Cpg0OIFyKHO5XHddfeP0Ic9cUmTo1bVSqXrxtbrecAeBpcYeIaD+AU7RgMkGIyTEDDHT87O+WfcTvpMyp31etWrV4T37NqgZz0xoW3PKTALxOWqkaD1YvadEjyqB1pMOJtDB4zgB7DOHUwFuJ/ZXhU0iXOXHPNZvbK/B5cLC8FzwG37qpObVj997ImXkibwsTpkAzUL8BxVnpbCJlFDP4MQkbHCX7il9kkNMlx57uaQfjj4s7r3+llrVom1Y3i6pAFojFMhg/IKb4aGsQujafdvOXzcZAAvcT2rTtMVLwyfd1+EmFzSoieWxoVSF9wVZuDA279UwBgUOYhBqQt0aICJRsk3vdJJuWxbattvTvn6zF4enPHjzHcXXxX2yWi9+8PbMRa/bVJouA0Wk4DuElgfUrVEhRYGnkm2MeKjXo7fdp5/pANwMWNwkZYXyFW5pfx20hISCFZlFaxj0OgXO+d5jh3Lycy/1xQQzWyGEfPXjqrc+/+in7ZssXB/BOZApGQygQCzi3VyumZ4oxuFNTCwhLBh5Y4I0jKvz0D/v7HLTbboNVkykpkFzpuDctLdeXPLdf6QBJSdb2IAYrWmps1g84GA+NiJyXI8B17ZuX3yL7uJ/OEg5O3j8SLdxg7PO5kDmZjBpQi5tUC5dBhfSJdnzfUe3b9KyDFZIdSuVUXrjVdd2bnf16vVrliz/7NvNawuFBceB8O5UZSCyAIaPNBYGOTOgCW+4eFizuvXv6fTPG9tdExoKUvPF14V0lzX/bP7wOVNW79siwg1IdQSkzwIrXQy8N5ZMQF/crhUR9ULyxIaJdTXgWCArCpii1IlLbFQ7adXWtXBBekYTN7mj6JXyKLFp/86yCQ79cevVuoyx69pcdV2bq/YfObR1/+4t+3buOXwgLStTcpKdl6dgLhpWJ4aZRsVyFRIjY+tExjet16BpvYa1Y+N0GVm3ZopBBsQKjGdmZye/MHndwZ1weHuJguBLcPCNgraoYCZ4EtmsdqPn+iXXS6hlC9vgge4qQFKOF9a2UbPvt65Dtik6PimhTKvDMqYOpB4L5FUF/FPAR8TXXqmbUKtuQq17Ot9yrrDgVE62LcTR9BN5Z8/gnCKPrR5ZtVLliCpVz19J4YVFsaGAVzt7985Jr83bmLrPABYvzCHq+WZ9HRjtGdCm4/yutp2GPtqrepWq0PgIODK06bi7Zf3G5cLCC6jtHbHBKBzGXpDVlpaTWeAuDAsBidKyu1e2iNOp3z+lNDw0LD4qhhBSOzb+f7/+l53vfy5cZ4yt2vDziNlTTp45jfkRBeaHlov8Zaealqsm93S4YWT3fsWrAwbAdOWrepVq5StWtDxnAci2TXG7BhNKYjSWmnUyO/d0TI1fTQWXwY3UPi/iazZ6p9P0fKk+74umAv4SG1tK+e4XS2e882puwTmO+tRQjMez2/uiWqUFqrSuQQ/8u9vNd+v1GEHmbFL4V42qEQnRMXknDiqPrThsc4cyGSb0UA2UQGEM2BUFExy/saL7T8mFlhV0W7vAXfjJ1/85JzzcxSEdogrOFMgGMDvEzgw0uDitEBZ+S/uOlEIN3V+NJHCGVx/qCqlcviLOxwEvRYI6HrGIorY0pSQuGMUJ2BUF+xO5qKYL8OXCwmcNH5tUMxamVHXpTLc6JVQdwWngoj1DkqwzeSPnT8nJz4WSBnZkgm4KC31F/0e/I72F1LYskBBBwkeArEyBw7eaNKZm1IwhY+rVhPAFFl5jfRRjOhQP1ANFuDjlxz3bhs+ZknsmX2/SCPblE4iTcaUI0geAZ4TcdD2kD23jQFJ+yho4vGw8JZMSEl8YOrZxTG0gB7sMFsJx0zOBBY3AEwDUYKtGrt69afjcKafz8zjnqFYYTDudn3ckNdV2W7gf0hut6+6CjsgCyfcpg+DQn6AQom584ozBo+pHxbtMMIZVc2zkwtoUb4uGKWKy73ZuGD1vet7ZM9BGDyo+TufnZWZlQk8YGPUADe/aBh2WE2g3BuxiyiY4fHpzdeMTZw8ZW6datEFQ8gCEir0CcDj6jv+Vkpvsuz0bRzyfcubcWQAWUjcCbJoskJV7urDwnLQQHBh8aIErg4LwXGyNqKqVKgfsksosOLz4kCIxKnbWoDH1qsdJGwRGcUIE59uBVIKFUgbMEkLlt7s29Js+Lu9MPmc8CPEpnhq7D+33WDaMRwpQXIVD0jAMAz0f55ER1cNCwgJ2RWUZHMiWAH39+KiYyX2TG1SPU7ZkOBEBO+ZR4BZI7FIKS3jclse2V21bN3Dqs9m5pzWjMWDX6Wsdr9uzVWAIrVd5aFoTiG2b8NdJ0QkBu6SyDw59Wkspa0XHTh8wsmFUAoWVjqiljnMiQBBByiroTHosYquV29c+PXNiTl6g8UEIOZ6etnH/LgHjUzDWhBIkCGCiBKcmN5on/WqR8aW2sg8OXU0XUiZGx80cMLpuRLSAJa6glYFpAC4OQzKv5qOGErZ696Yhsybl5OViJzkQ+NDF4TXbNuVbBaEhIdxlMtPAyQiddzNqGNUrV22YWJcE0C4LcGg2npAyPipm9pCx9WvWIpaCEkIRmQXXMTCIVQ0uTWq6+E8HdwybN+XMuXOaBnypL0+TTj76bgVsqTU4NQ1YLKOdB9TOAbd1o+MjKlUhAbTLBRxFbE0ZVyNq9oBRdSNicGMLyj9iiR3lJxEfIUCLN1x8zaEdT7+Qkpufd6nPF4F95uU/r9p16jjqhnmJ1r6aL5x6bqttg6YEKv2By6QuI3B4pwGUjKlec+bA0fUjE5UFvGVvF07zAAyDmODDKYoz/Xx456iXZ3jPl0uDD4nU1/TsU2+uWGrDNCbVQys4Iy5gbsVjWx5PVbNcxxawvwG4+4Gyywsc3vqYFAlRMc/1SU6qHqPcQlmaD4DFSCg2weA7xW3TNlPf790yet6U05cm/kAOBwQ8099+5UhWuoTuCW6GAPaiLpiD5h0R6prGLROjYlFdInD188sOHEX5rYT6WPL4pMhEcBqaK8KxJYzEQVvhRhaY1Zbf7ds8fN6UvLz8ixt/YIEWUPjel58uX7daWBaxbf0T9T4ZoFVLaVsijJm3Xd35UmxbLt4uR3D4/Eft2IQFz0yqHx0P89McxpnhyNdjEkLCfVIK6mMGW713c/K85y5if07LgjHGvlqzevri19woM0Iwpxaow+BdBIMaHl2uv6U9SowEeOLtMgWH139ImRAZM3/4xEYxiYAX3OICE9sUsENsIWwBN80CX79yx/pB05/NPp3DOTiXv/MQa6I15/yzVV8//cJzuZ5zKCyII/YwSwM/H/jnnLlCXdXKV3zkH3d6zyAHHAGuf8RHxcwaNLpBVKIizKQGeA9oulDkgkDrHAbtBMBl1Y713ccN+WnLBq/gjHck6y+YHpFhlAohXv/sg7EL554jdoiBAjFIVsPlqAyC4hDDMHkYD72n4y2J0XEYbQT6SS5lmmCXwrR7P5p+4uk5k/ekHyUc1DgkpgwopwLkTVzhBNMuUsqqID/36IO33BmKRF8tp1y0kOH3TY9jkaIa+dGTJ176ZNGyDd8XCgv+EFfVacYkShxjsw0PuKQqMa8mT65cvmLgzxQHHL/y8ycyMwbNHL/71GFJQBwd9GH0DC24D4ALFZIrKlGEuH3Dpn3v796iQWPfPdOyRL+5hVpexsdOPXP27Cfff/XmiqWZnnNwaKEAN6iREsWhn6IEiOwyA3ekljNdU58Y0a5x82Axnx3P8asJqOPpaYPmjN938rhFJWyQxMlE1I0DBDEJO0zBvwM1hIdxo0Xthrd16NymUfOaVaoV82S7Lc+eo4e+3bhm5aY1hzNTCajQMLcUDPHnTUP0QlsIfIAszzx237u6PXb7A0HkxDvg+K3/OJx2fMiMCbszjuEYLSQO+kjQvDHUEqLcNA3ofaCCuUdEhFdKikpoXKtuhXLla8fE1agSAfpNlOWezd9//EhmTta63du2H9xTqKTgoG2qowcoYKDp8SUY+eM42I000kevv33AI09q2nOwdNAdcPyO/zhy4vigmRO3px7S8UbRphSIK+Cxxko7RbVQ7/CNluCBGUvBpAoPDYdSlcEhL+WQY1i2JT0Wg4YfbKXU+pIgnwtMZ5QngfVNqNnNqbRVp0atZw4cbRoXInjqgOMSmh5TOHD86MCp4/ZmHFNQzgZaLwz8o666bsOA/0cZUZgfQK6yjmHxb3U7VYeY2vVgwUK7JhzG9FG/INjFnMCAmhf89trGrSf3Sa5cvkJwkeF4jt83PZ99KPXooKnPbj9+QK8Shqo63lr8FyqG6AE6fTpoATtk9aH0uvcw8G7vKprCxNaIV6AGVVS9wxME1uWCL7mj7fXDu/euXL5i0IXPHXD4NYn35nR+7viX5ixb8y0JMYwwcPJQb4ByO672AbeBkyZe1SH0E4gbRImen9IjfL9UvjVVGEv2CAvYfy2FJOVCwnve8cCTd+M+w4CrSv6uOTHHHyrwyyX/WTZ36aIsdVbDAhSAkLXOMMUFOQCcPvIatu4wPkG4eGW3vTvWtcIQyG7gSkIFe8ZgTqlOjfjhjz3VAZcmlwSfoc0BR3Emi57g/cePvLFsycqNa84xAfrIqEkJxTJvKuMTkNHSd7D2RXdckeMHhBGdDkMazDiWMRiIJipVkYbdfXXnx+64r2bViMArjRZvDjj+wNR5N2z9zq1L/rv8h50b8+1CLQ8kQbEU+6veRcbeI0ODwvvhatFq/RIg8WXghD+o47Wr36T7rV1aNbjiwjaFXWpzwPGnTJ4XBOw6tP+9FZ99tXZ1TkE+jGQTiQxDIArpzgzmIZpfhvV2rXNHKOLC4JyXCy9/U4t2d3To1Kyud/sp5j0l4ig53xxw/FlT6AZ8XJvUjJMbdmz9bvPaTQd2pmamG6EuAIcJQ3U2tHNtKGGA5KGlLMhYXIZRJ65Wszr1m9dteGXjpvE1ovXrlJDY83fNAcdfNvnr23kyO/NQ6tHM7JyjGWlpWRmSkpOns7LzTocaZlSVagY1qleq0iChdmxkdK3ouPPn1Xxr6khJNQccF2LKG0z8vt5Lgcd9trDA5EalcuX/cCluSTYHHI75tRJ62jlWEswBh2N+zQGHY37NAYdjfs0Bh2N+zQGHY37NAYdjfs0Bh2N+zQGHY37NAYdjfs0Bh2N+zQGHY37NAYdjfs0Bh2N+zQGHY37NAYdjfs0Bh2N+zQGHY37NAYdjfs0Bh2N+zQGHY37NAYdjfs0Bh2N+zQGHY37NAYdjfs0Bh2PEn/0/9r4NZ7MBPogAAAAASUVORK5CYII=" alt="StewardMD logo" width="68" height="68"></div>
    <p class="tag">Coming soon</p>
    <h1>StewardMD</h1>
    <p class="lead">AI-powered antibiotic decision support and antimicrobial stewardship for clinicians. We're putting the finishing touches on the mobile apps.</p>
    <div class="stores">
      <span class="badge" role="img" aria-label="Coming soon to the App Store">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.9c0-2 1.6-3 1.7-3-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6 1.2 0 1.5.6 2.5.6 1 0 1.7-1 2.3-2 .7-1.1 1-2.2 1-2.2s-1.8-.7-1.9-2.4zM14.6 6.6c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.2-.5.6-1 1.5-.8 2.4.9.1 1.8-.4 2.4-1z"/></svg>
        <span><span class="b1">Coming soon on the</span><span class="b2">App Store</span></span>
      </span>
      <span class="badge" role="img" aria-label="Coming soon to Google Play">
        <svg viewBox="0 0 24 24"><path d="M3.6 2.3c-.2.2-.3.5-.3.9v17.6c0 .4.1.7.3.9l.1.1L13.5 12 3.7 2.2l-.1.1z" fill="#00d1ff"/><path d="M17 15.3l-3.5-3.3 3.5-3.3 4.1 2.3c1.2.7 1.2 1.8 0 2.5L17 15.3z" fill="#ffce00"/><path d="M17 15.3L13.5 12 3.6 21.8c.4.4 1 .5 1.8.1L17 15.3z" fill="#ff3d44"/><path d="M17 8.7L5.4 2.1c-.8-.4-1.4-.4-1.8.1L13.5 12 17 8.7z" fill="#00e676"/></svg>
        <span><span class="b1">Coming soon on</span><span class="b2">Google Play</span></span>
      </span>
    </div>
    <p class="soon">The web app is temporarily private while the mobile apps roll out.</p>
    <p class="foot">Questions? <a href="mailto:support@stewardmd.in">support@stewardmd.in</a></p>
  </main>
</body>
</html>`;
