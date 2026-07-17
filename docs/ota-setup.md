# StewardMD — over-the-air (OTA) updates for the native apps

**Goal:** push web-asset updates (JS/HTML/CSS/KB/calculators/management) to installed iOS/Android apps **without a store release**, while keeping the app fully offline.

**Plugin:** [`@capgo/capacitor-updater`](https://github.com/cap-go/capacitor-updater) (Capacitor 8 — match the plugin major to `@capacitor/core` v8).

---

## Read this first — three hard truths

1. **OTA needs ONE more native release to activate.** The plugin must be embedded in the app binary. So you still cut one native build now — but it's the *last* content-only release you'll ever ship.
2. **It does NOT retroactively update already-installed apps.** Only apps updated to the plugin-enabled build receive OTA afterwards. Everyone on the current build must update once (store/TestFlight) to get onto the OTA track.
3. **`notifyAppReady()` is mandatory every launch or updates auto-roll-back.** This is already wired in `native-ota.js` (web-safe no-op). **Test it on a device before release** (see step 5) — if it doesn't fire, every OTA bundle silently reverts.

---

## Recommended: Capgo cloud (handles the big bundle with delta)

StewardMD's bundle is large (~60 MB — the KB shards, disease docs, calculators). Capgo cloud ships **delta updates**: after the first bundle, only *changed* files transfer (a `home.js` tweak = a few KB, not 60 MB). It also gives rollback, channels (beta/prod), and CDN hosting. Self-hosting (below) serves the full zip every time unless you build delta yourself — not worth it for a solo maintainer.

### One-time setup
```bash
# in the repo root
npx @capgo/cli init            # creates a Capgo account/app, installs the plugin,
                               # adds the CapacitorUpdater block to capacitor.config.json
                               # (appId = in.stewardmd.app), sets autoUpdate + channel
npm install                    # ensure the plugin is in node_modules
```
Confirm `capacitor.config.json` now contains something like:
```json
"plugins": {
  "CapacitorUpdater": { "autoUpdate": true, "appReadyTimeout": 10000, "responseTimeout": 20 }
}
```
(Capgo's default `updateUrl`/`statsUrl` point at Capgo's API — no manual URL needed.)

### Cut the one enabling release
```bash
npm run build:www              # assembles www/ from current repo (all latest content)
npx cap sync                   # copies www + native plugins into ios/ and android/
npx cap open ios               # → Xcode: bump build number, Archive, upload to TestFlight/App Store
npx cap open android           # → Android Studio: bump versionCode, build AAB, upload to Play
```

### Every future content update (NO store release)
```bash
npm run build:www
npx @capgo/cli bundle upload --channel production   # pushes the new web bundle OTA
```
Installed apps pick it up on next launch (background download, applied on the following open). That's it — calculators, KB, management, home stats all flow this way from now on.

---

## Alternative: self-hosted on Cloudflare (no vendor cost, no delta)

If you prefer to avoid Capgo's cloud: host the bundle yourself.

1. `capacitor.config.json`:
   ```json
   "plugins": { "CapacitorUpdater": { "autoUpdate": true,
     "updateUrl": "https://stewardmd.in/api/ota/check",
     "statsUrl":  "https://stewardmd.in/api/ota/stats" } }
   ```
2. Host the bundle zip on **Cloudflare R2** (NOT Pages — Pages has a 25 MiB per-file limit and the zip is ~60 MB). Public R2 URL or a Worker.
3. Add a Pages Function `functions/api/ota/check.js` that reads the caller's current version and returns `{ "version": "<latest>", "url": "<r2-zip-url>" }` when newer, else HTTP 204.
4. Produce bundles: `npx @capgo/cli bundle zip` → upload the zip to R2 and bump the version your `check` endpoint returns.

Downside: no delta — every update re-downloads the full ~60 MB. Fine over Wi-Fi, heavy on cellular.

---

## Verify on a device BEFORE you release (critical)

1. Install the plugin-enabled build on a real device.
2. Confirm `notifyAppReady` fires: check the native log for the Capgo "app ready" line, or add a temporary `console.log` in `native-ota.js`'s `ready()`.
3. Push a trivial OTA bundle (change a visible string), reopen the app twice, confirm it applies **and persists** (does not roll back on the 2nd launch). If it reverts → `notifyAppReady` isn't being called; fix before shipping.

---

## What's already in the repo (done)
- `native-ota.js` — the `notifyAppReady` bootstrap (web-safe no-op), loaded right after `native-bridge.js` in `index.html`.
- It's picked up by `scripts/build-www.sh` automatically (copies all root `*.js`).

## What's on you (native/infra — can't be automated from here)
- Capgo account (or R2 hosting) + `npx @capgo/cli init`.
- The one native build + store/TestFlight/Play release.
- On-device test of the rollback behaviour.
- Telling current users to update once to get onto the OTA track.
