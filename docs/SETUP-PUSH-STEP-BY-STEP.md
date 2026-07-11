# Turn on Push Notifications + Watch-Lab — beginner step-by-step

Real values for **your** setup (already looked up):
- Cloudflare **Pages project**: `stewardmd` (serves stewardmd.in, auto-deploys from the `main` branch)
- Cloudflare **Worker**: `stewardmd-api` (runs the 15-minute lab-check cron)
- **App ID / bundle id**: `in.stewardmd.app`
- Cloudflare login: `drmanojkurmana@gmail.com` (already logged in in your terminal)
- The code is in **PR #320** (branch `feat/native-push-watch-lab`).

> Anything starting with `!` you type into the Claude prompt in this terminal (it runs the command here and shows the output). Anything in a plain code block you run in a normal Mac Terminal, or it's a click path in a website.

---

## Phase 0 — What you need first (read this before starting)
- A **Mac** with **Xcode** installed (Mac App Store) — for the iPhone build.
- **Android Studio** installed — for the Android build.
- A **paid Apple Developer Program** account ($99/year). **Without it, iOS push cannot work on a real iPhone.** (Android/FCM is free.)
- Access to the **Firebase console** for StewardMD (the app already uses Firebase, so a project exists).
- A **real iPhone and a real Android phone.** Push **never** works in the simulator/emulator.
- Time: ~2–3 hours. The Apple part is the fiddliest.

---

## Phase 1 — Make the encryption key (2 min, easy)
In the Claude prompt here, type:
```
! openssl rand -base64 32
```
Copy the output (a ~44-character string ending in `=`). This is your **`WATCH_ENC_KEY`**. Paste it into a temporary note — you'll use it in Phase 4. **Never** put it in code or commit it.

---

## Phase 2 — Apple push key (.p8) + IDs (Apple Developer site)
1. Go to https://developer.apple.com/account → **Certificates, Identifiers & Profiles**.
2. **Identifiers** → find `in.stewardmd.app` (create it if missing) → tick **Push Notifications** → **Save**.
3. **Keys** → click **＋** → name it `StewardMD APNs` → tick **Apple Push Notifications service (APNs)** → **Continue** → **Register**.
4. **Download** the `.p8` file. ⚠️ You can only download it **once** — keep it safe.
5. Write down:
   - **`APNS_KEY_ID`** = the 10-character Key ID shown on that key's page.
   - **`APNS_TEAM_ID`** = your Team ID (top-right of the account page, 10 characters).
   - **`APNS_BUNDLE_ID`** = `in.stewardmd.app`
   - **`APNS_ENV`** = `sandbox` while you test a Debug build from Xcode; `production` for TestFlight/App Store. (Start with `sandbox`.)
   - **`APNS_KEY_P8`** = open the `.p8` in TextEdit and copy **everything**, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.

---

## Phase 3 — Firebase key for Android (Firebase console)
1. Go to https://console.firebase.google.com → open the **StewardMD** project.
2. **⚙ (gear) → Project settings → Service accounts** tab → **Generate new private key** → **Generate key**. A `.json` file downloads.
   - **`FCM_SERVICE_ACCOUNT`** = the **entire contents** of that JSON file.
3. **Project settings → General → Your apps**: if there's no **Android** app for `in.stewardmd.app`, click **Add app → Android**, package name `in.stewardmd.app`, register, then **download `google-services.json`** (used in Phase 6).

---

## Phase 4 — Put the secrets into Cloudflare
**Part A — the website (Pages project `stewardmd`), via the dashboard (easiest):**
1. https://dash.cloudflare.com → **Workers & Pages** → click **stewardmd** → **Settings** → **Variables and Secrets** (Production).
2. Add each of these as an **encrypted secret** (click the encrypt / 🔒 option), then **Save**:
   `WATCH_ENC_KEY`, `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENV`, `FCM_SERVICE_ACCOUNT`.
   (`UPDATES_ADMIN_TOKEN` is already set — leave it.)
3. Same Settings page → **KV namespace bindings**: make sure there's a binding named **`WATCH_KV`**. If not, click **Add binding**, name it `WATCH_KV`, and point it at any existing namespace (or **Create** a new one). *(The code also accepts `PUSH_KV`/`UPDATES_KV`/`GHIS_KV`/`CASES_KV` if one of those is already bound — but `WATCH_KV` is clearest.)*

**Part B — the cron Worker (`stewardmd-api`):** it needs `UPDATES_ADMIN_TOKEN` (to authorize the cron). Check it in the Claude prompt:
```
! cd worker && npx wrangler secret list
```
If `UPDATES_ADMIN_TOKEN` is **not** listed, set it to the **same value** you use on Pages:
```
! cd worker && npx wrangler secret put UPDATES_ADMIN_TOKEN
```
(paste the value when prompted.)

---

## Phase 5 — Xcode: turn on Push Notifications
1. In the Claude prompt: `! npx cap open ios` (opens Xcode).
2. In Xcode: left sidebar → click the blue **App** project → select the **App** target → **Signing & Capabilities** tab.
3. Confirm **Team** = your Apple Developer team, and bundle id = `in.stewardmd.app`.
4. Click **＋ Capability** (top-left of that tab) → double-click **Push Notifications**.
   - ⚠️ Note: `aps-environment` was intentionally **removed** from `App.entitlements` earlier so automatic signing worked with only Sign-in-with-Apple. Adding the Push Notifications capability here **re-adds it** — with your paid account + automatic signing, Xcode regenerates the provisioning profile to include push.
5. (Recommended) **＋ Capability → Background Modes** → tick **Remote notifications**.

## Phase 6 — Android: add the Firebase file  ✅ ALREADY DONE
`android/app/google-services.json` is already present and real (Firebase project `stewardmd-498ec`, package `in.stewardmd.app`), the gradle google-services plugin is wired, and `POST_NOTIFICATIONS` is in the manifest. **No action needed** — Android FCM config is ready. (You still need Phase 3's *service-account JSON* — that's a different file, for the server to SEND pushes.)

## Phase 7 — Install + sync (in the Claude prompt)
```
! npm install
! npx cap sync
```

## Phase 8 — Merge + deploy
1. Merge **PR #320** on GitHub → the website auto-deploys (gold290) from `main`.
2. Deploy the cron worker so the 15-minute schedule registers:
```
! cd worker && npx wrangler deploy
```
You should see two crons listed after it deploys: `17 */6 * * *` and `*/15 * * * *`.

## Phase 9 — Build on real devices
- **iPhone:** in Xcode → plug in your iPhone → pick it in the top device bar → press **▶ Run**. First run: on the phone, **Settings → General → VPN & Device Management → Trust** your developer profile.
- **Android:** `! npx cap open android` → plug in your phone (enable **USB debugging** in Developer Options) → press **▶ Run**.

## Phase 10 — Verify it works
1. In the app: **sign in** (Google/Apple), enable notifications (tap **Allow** when asked).
2. **Raw push test** (from a normal Terminal — replace `TOKEN` with your `UPDATES_ADMIN_TOKEN`):
```
curl -X POST https://stewardmd.in/api/push/send \
  -H "X-Admin-Token: TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"StewardMD test","body":"Push is working"}'
```
→ a banner should appear on your signed-in phone.
3. **Watch a patient:** open **Ward Sync** → pick a test patient → tap **🔔 Background alerts** → tick consent. Have a new lab posted in GHIS for that patient → within ~15 min a banner arrives and tapping it opens the patient.
4. **Isolation:** a second doctor (different login) watching a *different* patient gets nothing.
5. **Revoke:** use the app's revoke (or `SMD_WATCH.forget()`) → alerts stop and stored creds are purged.

---

## Common gotchas
- **Simulator never gets push** — use a real device.
- **`APNS_ENV` must match the build:** `sandbox` for a Debug build from Xcode; `production` for TestFlight/App Store. Mismatch = pushes silently do nothing.
- The `.p8` downloads **once** — if lost, revoke the key and make a new one.
- `APNS_KEY_P8` and `FCM_SERVICE_ACCOUNT` are **multi-line** — paste the whole thing.
- No Apple Developer Program = no iOS push on a real iPhone (Android still works).
- The **"Watch labs" button (in-app alerts) already works with just the merge** — the phases above are only needed for **background / closed-app** push.
