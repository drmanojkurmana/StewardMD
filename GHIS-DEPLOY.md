# GHIS Ward Sync — hosted (Cloudflare Pages) deployment

This makes GHIS labs + radiology work in stewardmd.in on **web and phone**, for
authorised users, with **no localhost proxy and no cookie pasting**. The server
logs into GHIS by itself.

## Files

| File | Where it goes in the repo |
|------|---------------------------|
| `ghis-ward.js` | wherever the site loads it from (already wired via `<script src>`). **Replace** the existing one — this version auto-detects its backend. |
| `ghis-cloudflare-function.js` | copy to **`functions/api/ghis/[[path]].js`** |

`ghis-ward.js` now picks its backend automatically:
- on `localhost` → the local Node proxy (`http://localhost:3456`) for dev
- on stewardmd.in → same-origin **`/api/ghis`** (the Cloudflare Function)
- override anytime with `window.GHIS_PROXY = '...'` before the script loads

So the local `ghis-proxy.js` is still your dev tool; production uses the Function.

## Cloudflare setup (Pages → your project → Settings)

1. **Secrets** (Settings → Environment variables → add as *encrypted*):
   - `GHIS_USER` = the dedicated GHIS service-account id
   - `GHIS_PASS` = its password
   > Use a **dedicated service account** with a **strong password**, not a personal login.

2. **KV (recommended, optional)** — keeps the GHIS session shared across requests:
   - Create a KV namespace, then bind it to the Pages project as **`GHIS_KV`**.
   - Without it everything still works; it just re-logs-in more often.

3. **Lock the endpoint** (pick one):
   - **Best:** put **Cloudflare Access** in front of `/api/ghis/*` (zero code; the
     Function already trusts the `Cf-Access-Authenticated-User-Email` header).
   - **Or:** set a secret `GHIS_APP_TOKEN` and have the app send it as the
     `X-App-Token` header.
   - Default fallback only allows same-origin (`*.stewardmd.in`) requests.

## Deploy & verify

1. Commit both files; push → Cloudflare Pages builds automatically.
2. Smoke test (while logged in as an authorised user):
   - `GET https://stewardmd.in/api/ghis/status`  → `{"connected":true}`
   - `GET https://stewardmd.in/api/ghis/patients` → array of inpatients
3. In the app: tap 🏥 Ward → patients load with **no cookie prompt** → tap a
   patient → labs + radiology load. Try it on your phone too.

## Notes
- PHI never persists: only the GHIS *session cookie* is cached (in KV/memory),
  never patient data. Keep it that way.
- If GHIS changes its login page fields (`USER_ID` / `PASSWORD` / `/Index`), the
  `login()` function in the Function is the single place to update.
