# StewardMD — self-hosted OTA updates (Cloudflare, no SaaS)

Push web/content updates (JS/HTML/CSS/KB/calculators/management) to installed iOS/Android apps **without an app-store release**, using **only your existing Cloudflare infrastructure**. No Capgo cloud, no recurring subscription.

## Architecture (what's implemented)

- **Plugin (free, MIT):** `@capgo/capacitor-updater` in **self-hosted mode** — it handles download, atomic apply, rollback and integrity. Only Capgo's *cloud backend* is paid; we don't use it.
- **Backend (your existing Worker):** `worker/src/ota.js`, wired into `stewardmd-api` (`api.stewardmd.in`). Runtime is read-only; reuses R2 bucket `stewardmd-offline` (prefix `ota/`), the per-IP rate limiter, and the `production`-gated deploy workflow.
- **Content-addressed storage → delta updates:** each web file is stored once by its `sha256` (`ota/files/<hash>`); a version is a manifest of hashes. The device downloads **only changed files** — a `home.js` tweak is a few KB, not the ~60 MB bundle. R2 has **zero egress fees** and immutable files edge-cache hard, so bandwidth/storage cost is negligible and scales well past 5,000 users.
- **Integrity:** every file + the full zip carry a `sha256` the plugin verifies. Optional **end-to-end signing** (see below) protects against a compromised bucket.
- **Rollback:** two layers — the plugin auto-reverts a bundle that never calls `notifyAppReady` (wired in `native-ota.js`), and server-side you repoint the channel to any prior version in one command.
- **Native-version gate:** each manifest has `minNativeBuild`; `/ota/check` won't serve a web bundle to an older native binary than it needs — so **store releases are only ever needed for native code changes**.

R2 layout (bucket `stewardmd-offline`):
```
ota/channels/<channel>.json        { version, minNativeBuild, manifestKey }   ← the atomic "publish" pointer
ota/manifests/<channel>/<v>.json   { version, checksum, minNativeBuild, files:[{file_name,file_hash}] }
ota/files/<sha256>                 one web file (immutable)
ota/bundles/<version>.zip          full bundle (url fallback / first install)
```

## Read this first — three hard truths

1. **OTA needs ONE native release to activate** — the plugin must be in the binary. That release is the *last* content-only store submission you'll make.
2. **It does NOT retroactively update already-installed apps.** Everyone must update to the plugin-enabled build once to get on the OTA track.
3. **`notifyAppReady()` must fire every launch or updates auto-roll-back.** Already wired in `native-ota.js` (web-safe no-op). **Test on a device before release** (step 6).

## One-time setup

1. **Install the plugin** (adds the correct Capacitor-8 version + updates `package.json`):
   ```bash
   npm i @capgo/capacitor-updater
   ```
   (Config is already in `capacitor.config.json` → `CapacitorUpdater` block pointing at `api.stewardmd.in/ota/*`.)
2. **Worker secrets/bindings** — already present: R2 `OFFLINE_BUCKET` (`stewardmd-offline`), rate-limit `RL`. Nothing new to add.
3. **Deploy the Worker** with the OTA endpoints: push `worker/**` to `main` → approve the `production` deployment in GitHub Actions (`deploy-worker.yml`). Verify: `curl https://api.stewardmd.in/ota/check` returns a JSON no-op body (e.g. `{"version":"builtin","message":"no_channel"}`).
4. **Release tooling env** (local or CI): `CLOUDFLARE_API_TOKEN` (R2 edit) + `CLOUDFLARE_ACCOUNT_ID=5476a757e49205bd1cce40b144eb59a9`, and the `zip` CLI.

## Publish the FIRST OTA bundle (before cutting the native release)

```bash
npm run ota:release -- --min-native 1 --dry-run   # sanity: hashes + manifest, uploads nothing
npm run ota:release -- --min-native 1             # publishes to the production channel
```
Now `curl https://api.stewardmd.in/ota/check` should return `{version, url, manifest, checksum}`.

## Cut the ONE enabling native release

```bash
npm run build:www
npx cap sync
npx cap open ios       # Xcode: bump build number, Archive → TestFlight/App Store
npx cap open android   # Android Studio: bump versionCode, build AAB → Play
```
Set `--min-native` to that build number from now on.

## Every future content update (NO store release)

```bash
npm run ota:release -- --min-native <current-native-build>
```
Only changed files upload; installed apps download only what changed and apply on next launch.

## Rollback / kill-switch (instant)

```bash
npm run ota:release -- --rollback <previous-version>    # repoints the channel; no re-upload
```

## Native-version gating (keep store releases for native code only)

- Pure web/content change → keep `--min-native` at the current native build; ships OTA.
- Change that needs new **native** code (a new Capacitor plugin, native permission) → cut a native release, then publish OTA with `--min-native` = the NEW build number. Old binaries won't pull the incompatible bundle.

## Optional: end-to-end signing (recommended for a medical app)

Beyond TLS + sha256, sign bundles so a compromised bucket can't push tampered code:
1. Generate a keypair with the Capgo CLI (`npx @capgo/cli key create`) — keep the **private** key offline/CI-only.
2. Put the **public** key in `capacitor.config.json` → `CapacitorUpdater.publicKey`, and cut a native release.
3. Encrypt/sign each bundle at release (`npx @capgo/cli bundle encrypt`) and include the returned `sessionKey`+`checksum` in the manifest (the release script has a `sessionKey` slot). Ship signed bundles only.

## Verify on a device BEFORE wide release (critical)

1. Install the plugin-enabled build on a real device.
2. Confirm `notifyAppReady` fires (native log) — else every OTA rolls back.
3. `npm run ota:release -- --min-native <n>` with a trivial visible change; reopen twice; confirm it **applies and persists** (doesn't revert on the 2nd launch). Then test `--rollback`.

## Cost

R2: ~$0.015/GB-month storage (a few versions of a 60 MB bundle = pennies) and **$0 egress**. Worker requests are within the cheap/free tier and rate-limited. No per-seat or per-update SaaS fees.
