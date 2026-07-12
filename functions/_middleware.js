/*
 * Site-wide access gate — TEMPORARY "coming soon" mode.
 *
 * Why this exists: the StewardMD web app is being taken PRIVATE for now while the
 * native apps go through App Store / Play Store review, after a wave of scraping /
 * data-theft attempts against the public web app. This Cloudflare Pages middleware
 * runs on EVERY request to stewardmd.in (static assets, pages, and /api/* functions
 * alike) and, by default, shows the public a self-contained "coming soon" page while
 * blocking all app code and API endpoints.
 *
 * Authorized access (owner / testers):
 *   1. Set the `SITE_ACCESS_PASSWORD` env var (Cloudflare Pages → Settings →
 *      Environment variables — mark it "Encrypt"/secret). Do this for BOTH the
 *      Production and Preview environments if you want to unlock previews too.
 *   2. Visit https://stewardmd.in/?access=YOUR_PASSWORD once. The gate sets an
 *      HttpOnly cookie (30 days) and redirects to a clean URL; the full app then
 *      loads normally for you on that device/browser.
 *   3. To lock yourself back out (clear the cookie): visit /?lock=1
 *
 * Fail-closed: if `SITE_ACCESS_PASSWORD` is unset/empty, NOBODY can unlock — the
 * whole site stays on "coming soon". That is intentional: the safe default for a
 * privacy lockdown is closed, not open.
 *
 * To REMOVE the lockdown later: delete this file (and, optionally, the env var).
 */

const COOKIE_NAME = "smd_access";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Constant-time-ish string comparison (avoids trivial timing leaks on the compare).
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// SHA-256 hex — the cookie stores a hash of the password, never the password itself.
async function tokenFor(password) {
  const data = new TextEncoder().encode("smd:" + password);
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

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const password = (env && env.SITE_ACCESS_PASSWORD) || "";

  // Explicit lock / logout.
  if (url.searchParams.has("lock")) {
    const headers = new Headers({ Location: "/" });
    headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    );
    return new Response(null, { status: 302, headers });
  }

  // Unlock via ?access=... — set the cookie and redirect to a clean URL.
  const provided = url.searchParams.get("access");
  if (password && provided && safeEqual(provided, password)) {
    url.searchParams.delete("access");
    const clean = url.pathname + (url.searchParams.toString() ? "?" + url.searchParams.toString() : "");
    const headers = new Headers({ Location: clean || "/" });
    headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=${await tokenFor(password)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
    );
    return new Response(null, { status: 302, headers });
  }

  // Already unlocked? Let the real app / API through.
  const cookie = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (password && cookie && safeEqual(cookie, await tokenFor(password))) {
    return next();
  }

  // Locked. Block API calls with a plain 503; show humans the coming-soon page.
  if (url.pathname.startsWith("/api/")) {
    return new Response(
      JSON.stringify({ error: "unavailable", message: "StewardMD is temporarily private." }),
      { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
    );
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
  .mark{ width:76px; height:76px; margin:0 auto 22px; display:block; }
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
    <svg class="mark" viewBox="0 0 96 96" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="88" height="88" rx="22" fill="var(--teal)"/>
      <path d="M48 26c-9 4-16 4-16 4v18c0 12 8 18 16 22 8-4 16-10 16-22V30s-7 0-16-4z" fill="#fff" opacity=".95"/>
      <path d="M48 40v20M38 50h20" stroke="var(--teal)" stroke-width="5" stroke-linecap="round"/>
    </svg>
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
