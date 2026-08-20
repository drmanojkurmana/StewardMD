# StewardMD — Production Release Runbook (mobile-only)

The repository-level hardening is done (see the security commits on `main`). The items below
**cannot be completed from the repo** — they need the Firebase console, Cloudflare dashboard, the
native Xcode/Gradle projects, and the App Store / Play consoles. Do them in order. Each part lists
**why it's not repo-doable**, the **exact steps**, the **expected result**, and **how to verify**.

Environment facts (verified):
- Capacitor 8, bundle `in.stewardmd.app`, Apple team `5QY4LUKX23`, iOS project `ios/App/App.xcodeproj`
  (SPM, **no** `.xcworkspace`). Targets: App + Watch app + Watch widgets + iOS Widget extension.
- The native app renders the **local `www/` bundle** (`capacitor.config.json` → `webDir:"www"`, no
  remote `server.url`). It only calls `stewardmd.in` for `/api/*`.
- Firebase = **compat JS SDK** in the WebView (`firebase-*-compat.js` in `index.html:156`) +
  `@capacitor-firebase/authentication` for native Google/Apple sign-in.

---

## PART A — Rotate `APP_GATE_KEY` (and decide enforce vs retire)

**Current state (verified):** the client hardcodes `X-SMD-App: smdapp_…REDACTED` at
`native-bridge.js:492`, but **no server code reads `env.APP_GATE_KEY`** — the token is currently
inert (gates nothing). The leaked value is therefore low-impact today, but it must not become the
live gate secret if enforcement is ever switched on.

**Why not repo-only:** rotating the value requires a matching Cloudflare env var + a native rebuild
so the new value ships in the bundle. Attestation (Part A2) is a native+backend feature.

### A1 — Rotate now (safe, ~10 min)
1. Generate a new token: `openssl rand -hex 24` → prefix it `smdapp_` (keep the format).
2. Set the server value: `npx wrangler pages secret put APP_GATE_KEY --project-name stewardmd`
   (paste the new `smdapp_…`). Also set it on the Worker if you later enforce there:
   `cd worker && npx wrangler secret put APP_GATE_KEY`.
3. Update the client: edit `native-bridge.js:492` → `headers["X-SMD-App"] = "<new smdapp_…>";`
4. Rebuild native (Part C) so the new token ships.
- **Expected:** the old leaked token is dead; client + server share the new value.
- **Verify:** after the native rebuild, in-app API calls still succeed (nothing regressed, because
  nothing enforced the token yet); the old value no longer appears in the shipped bundle.

### A2 — Proper fix (schedule as a follow-up milestone): platform attestation
Replace the static shared token with per-install attestation so a leaked string can't impersonate
the app:
- **iOS:** Apple **App Attest** (DeviceCheck as fallback for older devices).
- **Android:** **Play Integrity API**.
- Backend: verify the attestation assertion on `/api/*` (a Pages Function middleware) instead of a
  string compare. This overlaps with Part B (App Check already provides Play Integrity / App Attest
  attestation) — if you do App Check well, you can gate `/api/*` on a valid App Check token and
  **retire `X-SMD-App` entirely**.
- **Decision:** do App Check (Part B) first; then either (a) enforce App Check on `/api/*` and delete
  the `X-SMD-App` token, or (b) keep the rotated token as a secondary gate. Do **not** delete the
  token before confirming nothing in the deployed edge (WAF rules included) keys on the header.

---

## PART B — Firebase App Check (highest-value security item)

**Why not repo-only:** App Check is enabled/enforced in the **Firebase console**, needs attestation
providers registered per platform, and — because this app uses the **compat JS SDK inside a
WebView** — needs a **native attestation token bridged into the JS SDK**. A browser-only reCAPTCHA
provider would be weak in a native WebView, so use native App Attest / Play Integrity.

### B1 — Console setup (monitor mode first — never start on "enforce")
1. Firebase console → **App Check**.
2. Register the **iOS app** (`in.stewardmd.app`) with the **App Attest** provider.
3. Register the **Android app** (`in.stewardmd.app`) with the **Play Integrity** provider.
4. Set **Firestore** and **Authentication** to **Monitor** (NOT Enforce) initially, so you can watch
   the "verified vs unverified" ratio without locking anyone out.

### B2 — Native + JS integration (developer task)
Recommended path for a Capacitor + compat-SDK app:
1. Add the App Check Capacitor plugin: `npm i @capacitor-firebase/app-check` then `npx cap sync`.
2. Initialize native App Check **before** any Firestore/Auth call, selecting the platform provider
   (App Attest on iOS, Play Integrity on Android). Enable token auto-refresh.
3. Bridge to the compat JS SDK with a **CustomProvider** whose `getToken()` returns the native
   plugin's App Check token, so the existing `firebase.firestore()/auth()` calls in `app.js` carry a
   verified token. Initialize it right after `firebase.initializeApp(FB_CONFIG)` in `app.js`.
4. For local/simulator testing, register the **debug provider** token in the console (debug builds
   only — never ship the debug provider).

### B3 — Flip to Enforce
After ~1–2 weeks of Monitor showing the shipped app's traffic is verified, switch Firestore + Auth
to **Enforce** in the console.
- **Expected:** only attested installs of the real app can reach Firestore/Auth; the public Firebase
  web keys become useless to an attacker.
- **Verify:** App Check dashboard shows >99% verified requests from app versions; a raw
  `curl`/browser call with the config keys is rejected once enforcing.

---

## PART B2 — Firestore TTL policies (DPDP 7-day auto-clear) — REQUIRED for the privacy notice

**Why not repo-only:** the client now stamps `expiresAt` on the shared ICU docs
(`icu-collab.js retentionExpiry()`, refreshed on every write). The window is **user-configurable**
(`smd_icu_retention_days`: 7 / 30 / 60 / 90 in the Rounds tab) with a **hard cap of 90 days**; the
`firestore.rules` `retentionCapped()` bound (91d) enforces that ceiling server-side. The actual deletion
is done by a **Firestore TTL policy**, configured in the **Firebase/GCP console**, not in the repo.
Without the policy the "kept for N days, then cleared automatically" promise in the ICU notice + privacy
policy (§14) is NOT met. (TTL only checks `expiresAt`, so a variable per-doc window works unchanged.)

Configure a TTL policy on the **`expiresAt`** field for each of these **collection groups** (Firestore →
project `stewardmd-*` (asia-south1) → *Time-to-live (TTL)* → Create policy; or
`gcloud firestore fields ttls update expiresAt --collection-group=<cg> --enable-ttl`):
- `patients`   (the PHI-bearing shared patient doc — `icuGroups/{gid}/patients/{pid}`)
- `timeline`   (append-only audit — `.../patients/{pid}/timeline/{eid}`)
- `tasks`      (`.../patients/{pid}/tasks/{tid}`)
- `presence`   (viewing-metadata heartbeat — `.../patients/{pid}/presence/{uid}`; clinician name, NOT
  patient PHI, but orphaned forever on discharge without this, since Firestore doesn't cascade-delete
  subcollections — data-hygiene, recommended)

Notes:
- TTL deletes within ~72h of the `expiresAt` instant (Google SLA), so real deletion is ~7–10 days —
  acceptable for the notice; the field is refreshed on every write so an ACTIVELY-used patient never
  expires, and explicit discharge deletes immediately.
- **Deploy the rules too:** `firestore.rules` now caps the client-set `expiresAt` at ~8 days
  (`retentionCapped()`) so the auto-delete can't be defeated by a bad/forged value — `firebase deploy
  --only firestore:rules`. (Rules edits do NOT change production on their own.)
- **Verify:** in the console, a test doc with `expiresAt` in the past is gone within the TTL window;
  the TTL dashboard shows the four policies "Serving".

---

## PART C — Clean native rebuild (ships ALL of today's fixes to devices)

**Why not repo-only:** the installed app runs the bundle from its last build; the fixes on `main`
only reach devices after a rebuild + reinstall. **Incremental builds do NOT re-bundle the Capacitor
`public/` folder** — a clean build is mandatory (documented stale-bundle trap).

### iOS
1. `npm run build:www`  (regenerates `www/` from the fixed source — includes the app.js email-log
   fix, Lab-Watch push, DPDP notice, etc.)
2. `npx cap sync ios`
3. Xcode → open `ios/App/App.xcodeproj` → **Product ▸ Clean Build Folder** (⇧⌘K).
4. Select the **App** scheme, a real device / "Any iOS Device", team `5QY4LUKX23`, **Release**.
5. **Verify the fresh bundle before trusting it:** the built `App.app/public/index.html` `?v=` token
   must match the current `www/index.html` — and in-app, **ICU → More footer** should show the
   current gold build. If it shows an older gold, the build is stale — clean again.
6. Archive (Product ▸ Archive) → Organizer → Distribute to App Store Connect.

### C.1 — TestFlight archive readiness (repo prep done 2026-07-29)
Prepared in-repo (so the archive won't fail on these):
- **Build bumped to v2.1 (5)**, and **every embedded target** (iOS app, `StewardMDWatch`,
  `StewardMDWidgetExtension`, `StewardMDWatchWidgets`, legacy `watchkitapp`) aligned to
  `MARKETING_VERSION 2.1` / `CURRENT_PROJECT_VERSION 5`. (An embedded watch app / app-extension whose
  version does not match the containing app fails App Store *validation* — that mismatch is now gone.)
- `www/` rebuilt to **gold1046** + `npx cap sync ios` — the archive will contain the latest code.
- **Release configuration compiles cleanly** (verified: `xcodebuild -configuration Release build` →
  BUILD SUCCEEDED).
- `ios/ExportOptions.plist` added (method `app-store`, team `5QY4LUKX23`, automatic signing) for an
  optional CLI export.
- Info.plist is submission-ready: all six usage strings present (camera/mic/motion/photo×2/speech),
  `ITSAppUsesNonExemptEncryption=false`, Google + `stewardmd` URL schemes.

**Two BLOCKERS that must be resolved on this Mac before archiving (cannot be done from the repo):**
1. **Beta Xcode.** The active toolchain is `Xcode-beta 2.app` (Xcode 27 beta, iOS 27.0 SDK). App Store
   Connect **rejects binaries built with a beta Xcode/SDK.** Install a **release** Xcode from the Mac
   App Store, then `sudo xcode-select -s /Applications/Xcode.app` (verify with `xcodebuild -version`)
   before Product ▸ Archive.
2. **No distribution certificate.** The keychain has only *Apple Development*. App Store archives need
   an *Apple Distribution* cert + an App Store provisioning profile. In Xcode this is automatic:
   sign into your Apple ID (Settings ▸ Accounts, team `5QY4LUKX23`), keep signing **Automatic**, and
   Product ▸ Archive will create the distribution cert/profile and let you Distribute → App Store
   Connect (or Validate first). A headless `xcodebuild archive` cannot create these without the GUI /
   an App Store Connect API key.

### Android
1. `npx cap sync android`
2. Android Studio → **Build ▸ Clean Project**, then generate a **signed release AAB**.
3. Confirm the **Play App Signing** SHA-256 is added to `functions/_middleware.js` `ASSETLINKS`
   (there's a placeholder comment next to the debug fingerprint) so App Links verify for Play installs.

- **Expected:** devices run today's hardened code; APNs/push in **production** mode.
- **Verify:** confirm `aps-environment` = `production` in the release build; test a real push +
  sign-in + a FollowCare portal open on a device.

### C.2 — Android AAB readiness (repo prep done 2026-07-29)
Prepared in-repo:
- **versionCode bumped 10 → 11** (Play rejects a duplicate/lower code). `versionName` left at `"7"`
  — NOTE the mismatch with iOS `2.1`; decide whether to unify the display version (cosmetic).
- `www/` rebuilt to **gold1046** + `npx cap sync android` (web assets in `app/src/main/assets/public`).
- **Release AAB build VERIFIED** on this Mac (Android Studio JBR + SDK at `~/Library/Android/sdk`):
  `./gradlew :app:bundleRelease` → **BUILD SUCCESSFUL**, produced `app-release.aab` (~123 MB unsigned).
- **One-command signing wired:** `android/app/build.gradle` now reads `android/app/keystore.properties`
  (gitignored) if present and signs the release build with it; **absent → unsigned, unchanged.**
- `assetlinks` already carries the **Play App Signing** SHA-256 + `get_login_creds`
  (`functions/_middleware.js`) — App Links verify for Play installs.
- `targetSdk = 36`, `google-services.json` present (FCM push), permissions:
  INTERNET/CAMERA/RECORD_AUDIO/POST_NOTIFICATIONS.

**To ship a SIGNED upload AAB (your steps — needs your upload keystore):**
1. Generate an upload key (once):
   `keytool -genkey -v -keystore stewardmd-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias stewardmd-upload`
2. `cp android/app/keystore.properties.example android/app/keystore.properties` and fill in the path +
   passwords (this file is gitignored — never commit it).
3. Build: `cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:bundleRelease`
   → signed `android/app/build/outputs/bundle/release/app-release.aab`. (Or Android Studio ▸ Build ▸
   Generate Signed Bundle.)
4. Upload to **Play Console → internal testing** (the TestFlight equivalent). Keep Play App Signing ON.
- **Size note:** the AAB is ~123 MB (ARCore + ML Kit face model + native libs + web bundle). Under
  Play's limits (per-device split downloads are smaller), but enabling R8 (`minifyEnabled true`) would
  shrink it if desired.

**On-demand module assets (slim the install).** Some heavy, flag-gated module assets are stripped from
the native bundle and fetched from `stewardmd.in` on first use (cached by the WebView; the loaders keep
a fallback so nothing breaks). Build sequence becomes:
```
npm run build:www   →   npx cap sync android   →   bash scripts/strip-native-ondemand.sh   →   gradlew :app:bundleRelease
```
(and the same `strip-native-ondemand.sh` after `npx cap sync ios`, before the Xcode Archive). Currently
stripped: **MediaPipe** (FundX face landmarker, ~22 MB) — FundX is flag-gated OFF, loads from
`stewardmd.in` (then jsdelivr) on first use. Add more paths to the `ONDEMAND` list in that script.

**One-command upload (automation).** After a signed build, upload to a Play track without the web UI:
```
node scripts/play-upload.mjs --key /path/to/play-service-account.json --track internal \
  --notes "…" [--dry-run]
```
Pure Node (no fastlane). Needs a **Play Developer API service-account key** with "Release apps to
testing tracks": Play Console → Setup → **API access** → link/create a Google Cloud service account →
grant the release permission → download its JSON. Keep that JSON **outside the repo** (gitignored).
`--dry-run` creates the edit + uploads then discards (safe test); without it, the release commits.

---

## PART D — Cloudflare edge protection (dashboard)

**Why not repo-only:** WAF / Bot / rate-limit are edge configuration, not code.
1. Security → **WAF** → enable **Cloudflare Managed Ruleset** + **OWASP Core Ruleset**.
2. Security → **Bots** → **Bot Fight Mode** on.
3. Security → WAF → **Rate limiting** → rule on `api.stewardmd.in/*`: e.g. 100 req / min / IP → block.
- **Verify:** a scripted burst to an API path gets 429; normal app use is unaffected.

---

## PART E — Store submission

- **Reviewer access:** demo Google/Apple account + review notes explaining the coming-soon gate and
  that GHIS/Ward Sync is credentialed-hospital-only (not needed to review the core app).
- **Privacy nutrition labels:** declare health data, identifiers, contact accurately.
- **Assets:** screenshots (6.9"/6.7" iPhone; iPad + Watch if listed), 1024 icon, description, keywords,
  category = Medical, age rating.
- **Bump the build number** each upload (now v2.1 build 5 — every embedded target aligned to 2.1/5).
- **Export compliance:** `ITSAppUsesNonExemptEncryption=false` — confirm accurate (standard crypto is
  exempt).
- Keep FundX / KardiQ X / ThoreX **flag-OFF** and do not advertise them until clinically validated.

---

## Rollback notes
- `APP_GATE_KEY`: revert `native-bridge.js:492` + re-set the old Cloudflare value; rebuild.
- App Check: set Firestore/Auth back to **Monitor** (or unenforced) in the console — instant, no deploy.
- Native build: keep the previous archive; you can re-promote it in App Store Connect / Play Console.
- ICU at-rest encryption (`feat/icu-collab-encryption`, flag `smd_icu_encrypt` default OFF) stays
  unmerged until reconciled with the in-flight ICU work — not part of this release.
