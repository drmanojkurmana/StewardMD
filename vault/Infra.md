---
tags: [infra]
---
# Infra

## Hosting / backend
- **Cloudflare Pages** — serves the repo root (static) + `functions/` (Pages Functions). Auto-deploys on push to `main`. Internal paths (`docs/`, `vault/`, `ios/`, `*.md`, `CLAUDE.md`…) are 404'd by `functions/_middleware.js` (see [[Decisions]]).
- **Worker `stewardmd-api`** (`worker/wrangler.jsonc`) — deploy via `wrangler deploy`.
- **Firebase** (`stewardmd-498ec`) — Auth (Google/Apple), Firestore, App Check. Compat JS SDK in the WebView + `@capacitor-firebase/*` native bridges.
- **KV** — `MAIK_KV` (via `usageKv()`): MaiK metering + the [[AI Control Center]] rollups + all the runtime-editable knobs (`ai:model:override`, `ai:limits`, `ai:budget:daily`, `ai:emergency`, `ai:abuse:threshold`).
- **D1** — drug gold data. **R2** — FollowCare media, KardiQ X models bucket (`stewardmd-kardiox-models`, public India weights), on-demand assets.

## Coming-soon gate
`functions/_middleware.js` 503s public browser page-views to a coming-soon page; `/api/*`, the native app (`X-SMD-App`, currently inert), cron (`X-Admin-Token`), and the `/realapp` cookie pass through. This is why "AI/etc not working in app" until a native rebuild+reinstall.

## Native
- Bundle `in.stewardmd.app`. Apple team `5QY4LUKX23`. iOS project `ios/App/App.xcodeproj` (SPM, no workspace). Android `applicationId in.stewardmd.app`, targetSdk 36.
- **iOS build gotcha**: `-derivedDataPath` products land in flat OR ECID-subfolder — always `find … -name App.app`, verify the `?v=` token + a code marker BEFORE installing.
- **Signing**: iOS distribution cert is created by Xcode at Archive (needs a RELEASE Xcode — the beta was removed). Android **upload keystore** at `~/StewardMD/keystore/Untitled.jks` (alias `stewardmd`), wired via gitignored `android/app/keystore.properties`.
- **Play upload**: `node scripts/play-upload.mjs` (needs a Play Developer API service-account key) — see [[Roadmap]].

## Secrets (NEVER commit / never in this vault)
Mac password, admin token, 2Factor, Green-API, GHIS creds, keystore password, the Firebase-admin JSON in ~/Downloads (should be moved+rotated). Advise rotation.

## iOS build toolchain (2026-08-25)
`xcode-select -p` points at **`/Library/Developer/CommandLineTools`**, which has no iOS SDK - that is
why device builds fail out of the box. The full Xcode is at
**`/Users/diwakarkumar/Downloads/Xcode-beta 2.app`** (Xcode 27.0, build 27A5237l).

Pass it per-command instead of switching the global toolchain (`xcode-select -s` needs sudo and
changes it for every other session/worktree):

```sh
export DEVELOPER_DIR="/Users/diwakarkumar/Downloads/Xcode-beta 2.app/Contents/Developer"
```

**There is NO `.xcworkspace`** - this project is Capacitor SPM, not CocoaPods. Build the
**`App` scheme of `ios/App/App.xcodeproj`**; `-workspace ios/App/App.xcworkspace` fails with
"does not exist". Signing is Automatic, team `5QY4LUKX23`.

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'id=<device-udid>' -derivedDataPath ios/DerivedData \
  -allowProvisioningUpdates build
```

Device list: `xcrun devicectl list devices` (needs the same DEVELOPER_DIR).


## PGLOG_SIGNING_KEY — the NMC Logbook verification key (set 2026-08-27)

The HMAC key behind every logbook verification code / QR. **Pages secret, never a var** — anyone
holding it can forge a digest and make the public verification page show "valid" over a fabricated
certificate, and `wrangler.toml` is tracked in git.

- Set with `wrangler pages secret put PGLOG_SIGNING_KEY --project-name stewardmd` for **production**
  and (with a **different** value) `--env preview`. Different keys mean a code issued by a branch
  deploy can never validate against production — the isolation the digest design already assumed.
- Generated as 32 random bytes into `~/.stewardmd-secrets/pglog-signing.env` (0600, outside the
  repo), piped from the file so the value never reached a command line or a process list.
- `PGLOG_VERIFY_BASE` (the domain printed on the PDFs) IS public config and lives in `wrangler.toml`
  — top-level `[vars]` **and** `[env.production.vars]`, because named envs do not inherit the top level.

**ROTATION IS EFFECTIVELY PERMANENT.** The digest is derived from the key, so changing it makes every
code ever issued read TAMPERED. Rotate only on an actual compromise, and expect to re-issue every
certificate.

**Pages snapshots bindings at DEPLOY time.** Adding the secret does not affect deployments that
already exist — `/api/pglog/ready` kept reporting `"signing":false` until the next build. Push a
commit (or re-deploy) after adding any Pages secret, and confirm with the readiness probe.

## Native push — APNs and FCM (updated 2026-09-05)

APNs and FCM are LIVE in production and have been for some time: `/api/push/status` returns
`native:true`, which is exactly `pushKv(env) && (apnsConfigured(env) || fcmConfigured(env))`. Recorded
because a WardSynQ note previously claimed the blocker on escalation delivery was "a vendor,
credentials and a contract", and that was wrong.

Secrets (Cloudflare Pages, values encrypted and not readable via wrangler): `APNS_KEY_P8`,
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENV`, plus `FCM_SERVICE_ACCOUNT` and
`FIREBASE_SERVICE_ACCOUNT`. Token store is `pushKv` → the `stewardmd-updates` KV namespace
(`48a600ae…`), prefix `push:native:`.

**`wrangler kv key list` needs `--remote`.** Without it wrangler 4 reads LOCAL state and reports zero
keys for a namespace that is not empty, which reads exactly like a wrong namespace.

**APNs environment is resolved PER TOKEN, not per deployment.** A token is only valid against the
environment its BUILD was signed for, so a Debug or TestFlight-debug handset registers a SANDBOX
token. `APNS_ENV` still picks the deployment default and is still tried first — production sending is
unchanged — but a token Apple rejects as not-valid-here now retries once against the other host and
the answer is remembered on the token. Before this, such a token was PRUNED: the device silently
stopped receiving anything and the symptom looked like a broken push system rather than a build
mismatch. A `410 Unregistered` still prunes immediately, on both hosts, because that means uninstalled.

**Custom data must be copied explicitly.** `sendApns()` built a fixed payload and dropped every
caller key; `sendFcm()` did the same. Found only by sending a real push to a real handset and reading
what arrived. APNs carries custom keys as TOP-LEVEL keys alongside `aps` (which is where Capacitor
reads them back into `notification.data`); FCM requires every data value to be a STRING and rejects
anything else with an opaque 400.

Device identity is captured at registration (`installId`, optional `label`, best-effort model/OS/app
version, `firstSeen` written once). `GET /api/push/devices` lists the caller's own registrations,
read-only, returning an 8-character fingerprint and never the token itself.

## WardSynQ Clinical Record Service — D1 (added 2026-09-06, NOT yet applied to production)

Lives in the existing `stewardmd-connect` D1 (binding `CONNECT_DB`) because tenancy and the PHI-free
audit already live there. Two additive tables, `wardsynq_record` and `wardsynq_idempotency`; no
UPDATE or DELETE anywhere in `functions/_wardsynq/repository-d1.js`.

Apply (additive, `CREATE TABLE IF NOT EXISTS`):
```
wrangler d1 execute stewardmd-connect --remote --file functions/db/wardsynq_schema.sql
```
Enable: Pages env var `WARDSYNQ_RECORD=1` (default unset → every `/api/wardsynq/*` is 404). A tenant
needs `connect_membership` rows with role `clinician` for each doctor, and optionally
`settings.wardsynq.recordMode = "integration"` on `connect_tenant`. `CONNECT_HMAC_SALT`, if set, gives
the audit rows a per-patient pseudonym; absent, the hash column is null and nothing fails.

Verified locally on 2026-09-06 with `wrangler pages dev . --binding WARDSYNQ_RECORD=1` against the
miniflare D1 (schemas + a seed applied with `--local`): the full route surface, atomic batch writes,
409 on a lost race, idempotent replay, PHI-free audit. Remember `--remote` for the real database; the
same wrangler-4 trap as the KV list.

## WardSynQ FHIR / SMART — optional bindings and the id_token signing key (added 2026-09-08)

All OFF by default; each is read only when bound, and the code says which store or key it used.

- `WSQ_RL` — a Workers **rate-limit binding** (exact, cross-isolate). Preferred by `functions/_wardsynq/rate-limit.js`
  when present; the caller's limit/window then document intent and the binding's own configuration counts.
  For a Pages project this is bound in the dashboard (Functions > Bindings), not in `wrangler.toml`.
- `WSQ_RL_KV` — a KV namespace for the rate limiter when no binding exists. KV is eventually consistent, so a
  concurrent burst can under-count inside one window (windows are keyed by index, so nothing sticks or runs away).
  Absent both, the limiter is per isolate and says so (`store: "memory"`).
- `WSQ_TX_KV` — a KV namespace caching terminology-server answers (`CodeSystem/$validate-code`, 24 h; outages
  are never cached) and registered SMART `jwksUri` key sets (1 h). Absent, both caches are per isolate.
- `WSQ_SMART_SIGNING_JWK` — a **secret**: the hospital's ES256 private key as a JWK JSON string (`kty: "EC"`,
  `crv: "P-256"`, `d`, and a `kid`). Signs SMART `id_token`s; the public half is served at
  `/api/fhir/{orgId}/.well-known/jwks.json`. Without it `openid`/`fhirUser` are not offered and are dropped from
  any request that asks, and the consent screen says so. Set with
  `wrangler pages secret put WSQ_SMART_SIGNING_JWK --project-name stewardmd`. Generate with WebCrypto
  (`generateKey ECDSA P-256`, `exportKey("jwk", privateKey)`), add a `kid`, never commit it.
