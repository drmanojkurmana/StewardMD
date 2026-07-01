# GHIS Ward Sync — Deployment (per-doctor login)

Pulls a doctor's GITAM HIS inpatient labs + radiology into StewardMD on **web and
phone**. Each doctor signs in with **their own** GHIS id/password (correct audit
trail). "Keep me logged in" persists the session; the ⏻ button logs out.

## Files
| File | Goes to | Purpose |
|------|---------|---------|
| `ghis-cloudflare-function.js` | `functions/api/ghis/[[path]].js` | Server: per-doctor login, sessions, labs, radiology |
| `ghis-ward.js` | loaded via `<script>` before `</body>`, behind `smd_ghis_ward` | Frontend: 🏥 Ward button, login screen, drawers. **Replace** the existing one. |

The frontend auto-detects its backend: `localhost` → `http://localhost:3456` (dev),
otherwise same-origin `/api/ghis` (production). Override with `window.GHIS_PROXY`.

## Cloudflare Pages settings

### 1. Secret — encryption key  ✅ ALREADY SET via CLI
`GHIS_ENC_KEY` = base64 of 32 random bytes (AES-GCM key that encrypts saved passwords).
Re-set anytime with:
`printf '%s' "$(openssl rand -base64 32)" | wrangler pages secret put GHIS_ENC_KEY --project-name=stewardmd`

> The old `GHIS_USER` / `GHIS_PASS` secrets are **no longer used** (each doctor logs
> in individually). You may delete them.

### 2. KV namespace binding  ⬅️ NEEDS ONE STEP
Namespace `GHIS_KV` is already created (id `fe08922ff2504aeb913b10a818054a08`).
Bind it to the Pages project (stores sessions + encrypted creds):

**Dashboard (simplest):** Workers & Pages → **stewardmd** → Settings → **Functions**
→ **KV namespace bindings** → Add → variable name `GHIS_KV`, select the `GHIS_KV`
namespace → Save → redeploy.

**or repo config:** add `kv_namespaces` to a root `wrangler.jsonc` (only if the
project already builds cleanly with one):
`{ "kv_namespaces": [ { "binding": "GHIS_KV", "id": "fe08922ff2504aeb913b10a818054a08" } ] }`

## How it works
- `POST /api/ghis/login {userId,password,remember}` → server logs into GHIS
  (gimsrlogin `/Index` → `ghis/Home`), stores the session in KV under a random token,
  and (if `remember`) stores the **encrypted** credentials. Returns `{token}`.
- All data calls send `Authorization: Bearer <token>`. On GHIS timeout the server
  silently re-logins from the stored (encrypted) creds → "logged in forever."
- `POST /api/ghis/logout` deletes the session **and** the stored creds.
- Endpoints: `status`, `patients`, `lab`, `lab-detail`, `radiology`, `radiology-report`.

## Security notes
- Passwords are **encrypted at rest** (AES-GCM) and erased on logout. Otherwise only
  the short-lived GHIS session cookie is kept.
- **No patient data is persisted** — KV holds only the session cookie + encrypted creds.
- Access is gated by GHIS login itself: no valid token → `401 login_required`.
- The service worker must **not** cache `/api/*` (no PHI on device).
- If GHIS changes its login fields (`USER_ID`/`PASSWORD`/`/Index`), `loginGhis()` in
  the Function is the single place to update.

## Smoke test after deploy
1. `GET /api/ghis/status` (no token) → `{"connected":false}` (expected).
2. In the app: 🏥 Ward → sign in with a real GHIS id/password → patients load; tap
   one → labs + radiology. Try it on your phone.
3. Close & reopen the app → still logged in (thanks to "Keep me logged in"). ⏻ logs out.
