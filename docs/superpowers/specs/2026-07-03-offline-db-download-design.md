# Login-gated Offline Drug Database Download — Design Spec

**Date:** 2026-07-03
**Status:** Approved design → implementation
**Author:** brainstormed with Claude

## Goal

Let **paid** StewardMD users download the full drug database to their phone for **offline** use. Cloudflare D1 remains the master (online) source; the offline copy is a compressed snapshot served only to entitled, authenticated users.

## Scope

- **Build now (server-side, testable today):** authenticated + paid-gated, gzipped download of the DB snapshot from Cloudflare R2, plus a version/metadata endpoint and an admin script to grant the paid entitlement.
- **Spec now, build later (mobile):** the Capacitor Settings toggle → download → unzip → offline search flow. No Capacitor project exists yet.

## Entitlement model — "PAID stamp"

- A Firebase **custom claim** `pro: true` marks an account as paid.
- Rides inside the Firebase ID token → the worker reads it after verifying the token; no DB lookup.
- **Initial paid accounts (granted now):** `northstar201b@gmail.com`, `mkkmanojkumar0@gmail.com`.
- **Future:** payment success (Stripe/Razorpay/etc.) sets `pro:true` automatically — no change to this feature.
- Granting the claim requires Firebase Admin privileges (service account or a Cloud Function running with admin rights). Provided as `scripts/set-pro-claim.mjs`.

## Server architecture (added to existing `stewardmd-api` worker)

### Storage — Cloudflare R2
- New bucket (e.g. `stewardmd-offline`) holds:
  - `stewardmd-drugs.sqlite.gz` — gzip of the 412,180-row DB (~40–50 MB from 151 MB).
  - `version.json` — `{ version, generated_at, bytes_gzipped, bytes_raw, sha256, row_count }`.
- Bucket is **private**; only the worker reads it (no public bucket URL).

### Endpoints
1. `GET /offline-db/version`
   - Verify Firebase ID token → require `pro:true`.
   - Return `version.json`. App uses this to detect updates.
2. `GET /offline-db`
   - Verify Firebase ID token → require `pro:true`.
   - Rate-limited via existing `RL` binding (e.g. a few pulls/day/user).
   - Stream `stewardmd-drugs.sqlite.gz` from R2 with `Content-Type: application/gzip`, `Content-Length`, and an `ETag`/version header. Support `If-None-Match` → `304`.

### Firebase token verification (new capability in worker)
- Fetch Google's public keys from `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`; cache per `Cache-Control: max-age`.
- Verify RS256 signature, `iss = https://securetoken.google.com/<projectId>`, `aud = <projectId>`, `exp` valid.
- Read `pro` claim from payload. Missing/false → `403 {error:"upgrade_required"}`. No/invalid token → `401`.
- Isolated in `worker/src/auth.js` (`verifyFirebaseToken(request, env) → {uid,email,pro} | throws`). Existing routes untouched.

### Config / secrets
- `env.FIREBASE_PROJECT_ID` (public id).
- `env.OFFLINE_BUCKET` (R2 binding).
- Reuse `env.RL`.

## Data flow (offline enable, mobile — future)

1. User (paid) toggles **Settings → Enable offline database**.
2. App `GET /offline-db/version` with Firebase token → shows size + "Download".
3. App `GET /offline-db` → receives `.gz`.
4. App **unzips in-app** (bundled unzip lib, e.g. `fflate`; reliable for large files on mobile) → writes `stewardmd-drugs.sqlite` to app storage; deletes `.gz`.
5. Store the downloaded `version` locally.
6. Offline searches query the local file via a Capacitor SQLite plugin (e.g. `@capacitor-community/sqlite`); online mode continues to hit D1.
7. When `/offline-db/version` differs from local → show "Update available".

## Security

- Download requires valid Firebase login **and** `pro:true`; non-paid → "Upgrade to Pro".
- R2 bucket private; file only reachable through the authenticated worker route.
- Per-user rate limit prevents repeated mass pulls.
- Data is public drug info (from 1mg); this protects the compiled file, bandwidth, and gates a paid perk — not secret data.
- On-device: iOS sandboxing isolates the file; optional SQLCipher encryption is a future hardening option, not required for v1.

## Build order

**Now (server):**
1. `worker/src/auth.js` — Firebase token verification + `pro` check.
2. `worker/src/index.js` — add `/offline-db` and `/offline-db/version` routes (new only; existing untouched).
3. R2 bucket create + binding in `worker/wrangler.jsonc`.
4. Build `stewardmd-drugs.sqlite.gz` + `version.json` from the updated DB; upload to R2.
5. `scripts/set-pro-claim.mjs` — grant `pro:true` to the two emails (needs Firebase admin creds).
6. Deploy worker; verify with curl (401 no token, 403 non-paid, 200 + file for paid).

**Later (mobile):** Capacitor project, Settings toggle, download/unzip/local-SQLite, update check.

## External dependencies (cannot be done without you)
- **Firebase Admin credentials** (service-account JSON or approval to deploy a Cloud Function) to set the `pro` claim on the two accounts. Without this the endpoint deploys but no account can pass the gate yet.
- **Confirmation to deploy to production** `api.stewardmd.in` (live medical API).

## Out of scope (YAGNI for v1)
- On-device encryption (SQLCipher).
- Delta/differential DB updates (full re-download on version change).
- Multi-tier plans; only a single `pro` boolean.
