# Native Push Notifications (iOS APNs + Android FCM)

Why this exists: **Web Push does not work inside the iOS Capacitor WebView.** The old
notification path (VAPID web push → service worker `showNotification`) only works in
Safari and installed PWAs, never in the native app — which is why nothing showed on the
iPhone. This adds the native channel using the already-installed
`@capacitor/push-notifications` plugin: **APNs on iOS, FCM on Android.**

Web push is unchanged and still serves desktop/Android browsers and installed PWAs.

## What was added

| Piece | File |
|---|---|
| Client: register device, send token, route taps | `native-push.js` (loaded in `index.html`, no-op on web) |
| Server: APNs sender (ES256 provider JWT) | `functions/_apns.js` |
| Server: FCM HTTP v1 sender (RS256 OAuth) | `functions/_fcm.js` |
| Server: native token store + dispatcher | `functions/_nativepush.js` |
| API: `register-native` / `unregister-native`, `send` now hits both channels | `functions/api/push/[[path]].js` |
| `/api/updates` publish now also pushes native | `functions/api/updates/[[path]].js` |
| UI toggle uses native push on the native app | `home.js` |

Tokens live in the same `PUSH_KV` as web subscriptions, under `push:native:` records
`{ token, platform, uid, ts }`.

## Setup — do this once (nothing works until it's done)

### iOS (APNs)
1. **Apple Developer → Certificates, IDs & Profiles → Keys → +.** Enable **Apple Push
   Notifications service (APNs)**, download the **`.p8`** key. Note the **Key ID** (10 chars)
   and your **Team ID** (10 chars).
2. In **Xcode** open the iOS app → target **Signing & Capabilities → + Capability →
   Push Notifications**. (Also keep **Background Modes → Remote notifications** if you want
   silent/background delivery later.)
3. Set Cloudflare Pages **secrets** (Project → Settings → Environment variables, mark as
   encrypted):
   - `APNS_KEY_P8` = full contents of the `.p8` file (`-----BEGIN PRIVATE KEY----- …`)
   - `APNS_KEY_ID` = the key's Key ID
   - `APNS_TEAM_ID` = your Team ID
   - `APNS_BUNDLE_ID` = `in.stewardmd.app` (default; only set if different)
   - `APNS_ENV` = `production` (use `sandbox` for a debug/dev build run from Xcode)

> Note on `APNS_ENV`: apps built for the App Store / TestFlight use **production**. A debug
> build launched from Xcode uses the **sandbox** gateway. If test pushes 400 with
> `BadDeviceToken`, you're pointed at the wrong environment — flip `APNS_ENV`.

### Android (FCM)
1. **Firebase console** (existing project `stewardmd-498ec`) → Project settings →
   **Service accounts → Generate new private key** → download the JSON.
2. Ensure the Android app has its **`google-services.json`** (Firebase console → Android app)
   in `android/app/`.
3. Cloudflare secret:
   - `FCM_SERVICE_ACCOUNT` = the entire service-account JSON (as one string)

### Rebuild the native apps (on your Mac)
```
npm run build:www      # assembles www/ (includes native-push.js automatically)
npx cap sync
npx cap open ios       # then Run on a real device (push doesn't work in the simulator)
npx cap open android
```

## How to test
1. On a **real device**, open StewardMD → notifications panel → **Enable notifications**.
   Accept the OS prompt. (`native-push.js` registers and stores the token.)
2. Fire a test blast:
   ```
   curl -X POST https://stewardmd.in/api/push/send \
     -H "X-Admin-Token: $UPDATES_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"title":"StewardMD test","body":"Native push works ✅","url":"/"}'
   ```
   The response shows `{ web:{sent,total}, native:{sent,total} }`. A banner should appear on
   the device (background the app first — iOS may not banner while it's foregrounded).
3. `GET /api/push/status` returns `{ enabled, publicKey, native }` — `native:true` means the
   APNs/FCM secrets are present.

## Verified locally
`functions/_apns.js` and `functions/_fcm.js` were unit-tested with throwaway keys: the
ES256 (APNs) and RS256 (FCM OAuth) JWTs are constructed correctly and their signatures
verify against the matching public keys; both senders build the correct requests. What
**cannot** be verified from CI — and needs a real device + your credentials — is actual
delivery through Apple/Google.

## Account-specific alerts (per-doctor, per-patient)

Lab alerts must reach **only the doctor who chose to watch that patient** — never all
users. The plumbing enforces this:

- **Device → account binding is server-verified.** `register-native` derives the owning
  account from a **verified Firebase ID token** (`functions/_fbauth.js`, same verifier as
  saved cases) — never from a client-supplied uid. A device can only bind to the account
  whose real token it presents. (Verified with 7 anti-spoofing tests: forged/wrong-key/
  expired/garbage tokens all fall back to guest.)
- **Tokens are stored scoped to that uid.** `native-push.js` re-registers on sign-in/out,
  so the device re-scopes to the current doctor and un-scopes to guest on logout.
- **Targeted send.** `sendNativeToAll(env, msg, { uid })` fans out to a single account's
  devices only. Broadcast (no `uid`) is used **only** for global medical updates (FDA), not
  for labs.

So the future lab-watcher will send each patient's alert with `{ uid: <that doctor> }`, and
guests (uid=null) never receive per-patient alerts.

## Not included yet — "watch labs" background alerts
This adds the *delivery pipe*. It does **not** yet make "a new lab was reported" fire a push
while the app is closed, because that needs a **server-side watcher** — and the watcher needs
the doctor's GHIS token stored server-side to poll on their behalf. The app currently
**never stores that token server-side by design** (`ghis-ward.js`). Resolving that privacy
trade-off is a product decision (see the two options discussed with the team) before the
watcher can be built.
