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
