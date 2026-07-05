# StewardMD → iOS + Android via Capacitor — build handoff

This is the continuation plan for wrapping the StewardMD PWA into native App Store
and Google Play apps. It was prepared in a cloud session (Linux, no Xcode); the
build itself must run on a Mac. Give this file to **Claude Code CLI on the Mac**
("read docs/CAPACITOR-BUILD.md and continue") and it can execute most of it.

## Context — what's already done (all live on stewardmd.in, gold217)
- StewardMD is a working PWA (static files at repo root: `index.html`, `home.js`,
  `reasoning.js`, `icu.js`, `drugs.js`, `kb/…`, service worker `sw.js`, `manifest`).
- Deployed via Cloudflare Pages. Backend = Cloudflare Functions under `/api/*`
  (`/api/updates`, `/api/ghis/*`, `/api/ai/*`). Auth = Firebase (Google sign-in) + guest.
- App-store prerequisites already shipped: in-app **account deletion**, **Privacy/Terms/
  Disclaimer** pages + in-menu links, medical disclaimers, "for qualified clinicians"
  framing, no AI provider names in UI.
- Store assets ready in `store-assets/`: `apple/` (13 × 1290×2796), `google-play/`
  (13 × 1080×2160 + `feature-graphic-1024x500.png`), `app-icon-1024-teal.png` /
  `-white.png`, plus `raw-app-screens/`. Listing copy: `docs/app-store-listing.md`.
  Privacy/Data-Safety answers: `docs/app-store-privacy-forms.md`.

## Goal
Ship the same app to the App Store and Google Play, built to **pass review** —
not as a thin web wrapper.

## Decisions (locked unless you change them)
- **Bundle ID / applicationId:** `in.stewardmd.app` (must be identical on Apple & Play;
  cannot be changed after first submission).
- **App name:** StewardMD
- **Load mode: BUNDLE THE WEB APP LOCALLY** (do NOT use `server.url` pointing at the live
  site). This is what avoids Apple Guideline **4.2** ("repackaged website") rejection and
  gives offline support.

## The two big review gotchas
1. **Apple 4.2 (min functionality):** must not be a URL-in-a-WebView. → bundle locally +
   real native features (below). StewardMD's engine/calculators/DB/offline KB satisfy the
   "real app" bar; just don't ship a remote-URL wrapper.
2. **Apple 4.8 (Sign in with Apple):** because the app offers **Google sign-in**, Apple
   generally **requires** offering **Sign in with Apple** too. Add it (plugin below) or
   restructure auth. This is a very common rejection — do not skip.

## Step 1 — Add Capacitor (Mac or here; it's just files)
```bash
npm install @capacitor/core @capacitor/cli
npm install @capacitor/ios @capacitor/android
# native plugins we need for a "real app" + features:
npm install @capacitor/push-notifications @capacitor/camera @capacitor/share \
            @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen \
            @capacitor/app @capacitor/preferences
# Sign in with Apple (community plugin, well-maintained):
npm install @capacitor-community/apple-sign-in
```

## Step 2 — Assemble the web bundle (`www/`)
Capacitor copies one folder into the native app. The repo root has mixed content
(.git, docs, store-assets, test, node_modules) — don't ship those. Create a small
copy script that assembles ONLY the runtime files into `www/`:
- include: `index.html`, all root `*.js` / `*.css`, `kb/`, `functions`-independent
  assets, icons/`*.png`/`*.webp`, `manifest*`, `sw.js`, `privacy.html`, `terms.html`,
  `disclaimer.html`, `support.html`, fonts.
- exclude: `.git`, `node_modules`, `docs`, `store-assets`, `test`, `functions`, `worker`.
Write `scripts/build-www.sh` (or a Node script) and set `webDir: "www"`.

```bash
npx cap init "StewardMD" "in.stewardmd.app" --web-dir="www"
# after build-www.sh has populated www/:
npx cap add ios
npx cap add android
npx cap sync
```

## Step 3 — API + auth when running as a native app (IMPORTANT)
Bundled origin is `capacitor://localhost` / `https://localhost`, so relative `/api/*`
calls won't reach Cloudflare, and cross-origin fetch hits CORS.
- Point API calls to the **absolute** base `https://stewardmd.in` when running natively.
- Enable **CapacitorHttp** in `capacitor.config` (`plugins: { CapacitorHttp: { enabled: true } }`)
  so `fetch` is proxied through native HTTP and **bypasses CORS**. Verify `/api/updates`,
  `/api/ghis/*`, `/api/ai/*` all work from the device.
- Firebase Auth Google sign-in in a WebView needs the native Google flow or Firebase's
  Capacitor-compatible setup — test sign-in on device; wire `@capacitor-community/apple-sign-in`
  for the Apple option and feed the credential to Firebase (`signInWithCredential`).
- Service worker: SW doesn't run under `capacitor://` the same way — offline is handled
  by the local bundle instead. Confirm the app works airplane-mode.

## Step 4 — iOS native config (Xcode, on Mac)
- `ios/App/App/Info.plist`: add usage strings —
  `NSCameraUsageDescription` ("Capture a monitor/medication photo to read values"),
  `NSPhotoLibraryUsageDescription` if picking images.
- Capabilities (Xcode → Signing & Capabilities, GUI click): **Push Notifications**,
  **Sign in with Apple**, Background Modes → Remote notifications (if using push).
- APNs key in Apple Developer → paste into Firebase (if using FCM) or your push sender.
- Signing: select your Apple **Team**, let Xcode manage the provisioning profile.
- `pod install` runs via `npx cap sync` (needs CocoaPods installed: `sudo gem install cocoapods`).
- Set app icon + launch screen from `store-assets/app-icon-1024-*.png` (use
  `@capacitor/assets` to generate all icon/splash sizes: `npx @capacitor/assets generate`).

## Step 5 — Android native config (Android Studio, on Mac)
- `android/app/src/main/AndroidManifest.xml`: camera + internet permissions
  (INTERNET is default; add `CAMERA`, `POST_NOTIFICATIONS` for Android 13+).
- FCM for push: add `google-services.json` (from Firebase console) to `android/app/`.
- Generate a **release keystore** (`keytool -genkey …`) — store it safely; you'll reuse it
  for every update. Configure signing in `android/app/build.gradle` (or Play App Signing).
- Build the release bundle: `cd android && ./gradlew bundleRelease` → `.aab`.

## Step 6 — Run & test on a real device
- iOS: Xcode → select device → Run. Android: Android Studio → Run.
- Test checklist: launches offline; Google + Apple sign-in; guest mode; push notification
  received; camera/AI-vision; a full case → recommendation; a calculator; the reasoning
  workspace + a bedside tool (opens & closes cleanly); Acknowledgements sheet.

## Step 7 — Submit
- **App Store Connect:** create app (bundle `in.stewardmd.app`) → upload build (Xcode
  Archive → Distribute, or `xcrun altool`/Transporter) → screenshots from
  `store-assets/apple/` → App Privacy answers from `docs/app-store-privacy-forms.md` →
  age rating (medical, 18+ per our setting) → listing from `docs/app-store-listing.md`
  → submit. In review notes: state it's decision-support for qualified clinicians and
  give a guest-mode path so the reviewer can access it without credentials.
- **Play Console:** create app → upload `.aab` → screenshots + `feature-graphic-1024x500.png`
  from `store-assets/google-play/` → Data Safety form from `docs/app-store-privacy-forms.md`
  → content rating → submit.

## If a reviewer still flags 4.2
Emphasise (and add if missing): offline use, native push, native camera, Sign in with
Apple, and that the clinical engine/database/calculators run in-app — not a website.

---
*Prepared for continuation via Claude Code CLI on macOS. This repo's default branch
(`main`) already contains everything above except the Capacitor scaffold.*
