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
