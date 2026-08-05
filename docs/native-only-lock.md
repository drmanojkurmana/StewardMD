# StewardMD native-only lock (owner runbook)

Goal (Marrow/PrepLadder-style, adapted for a clinical tool): the app runs **only in the native iOS/Android
apps**, the KB/engine are on-device but **inert without a live server key gated by a Pro subscription**
(2-hour offline grace), and the **web app is dead**. Built in 3 phases; each is reversible (recovery tags).

## The runtime chain (once fully enabled)
sign in (native app) → `POST /api/license` verifies you're **Pro** → returns the AES key (2h grace) →
`kb-loader.js` decrypts the on-device `.enc` KB in memory → the app boots. No key → "Activate" lock.

## Phase 1 — web app killed  ✅ LIVE
`functions/_middleware.js`: browsers get only the marketing page + legal + FollowCare + `/api/*` + `/admin`;
every app asset → 404. Native apps load `www/` locally, unaffected. **Emergency valve:** Pages env
`SITE_ALLOW_WEB=1` restores the web app instantly. Recovery tag `pre-webapp-kill`.

## Phase 2 — encrypted, license-gated KB  ✅ BUILT (flag-gated OFF)
`SMD_KB_ENC=0` (default) = plaintext, unchanged. To turn the lock ON:
1. Generate a 32-byte key: `openssl rand -base64 32`
2. Cloudflare Pages → set secret **`APP_KB_KEY`** = that key (this is what `/api/license` hands to Pro users).
3. Build the native bundle with the same key: `KB_ENCRYPT=1 KB_KEY=<same key> bash scripts/build-www.sh`
4. `npx cap sync ios` (and Android) → rebuild + reinstall on device.
5. Device-test: signed-in Pro unlocks; kill wifi → still works ≤2h; sign out / wait >2h → "Activate" lock.
Recovery tag `pre-kb-encryption`. Files: `kb-loader.js`, `scripts/encrypt-kb.mjs`, `functions/api/license.js`.

## Phase 3 — real IAP (Pro from Play + App Store)  ◑ SERVER BUILT, needs your provisioning
`/api/license` already gates on the **real** entitlement (`_entitlement.js`): owner emails always Pro; then
the Firebase `pro` claim honoring the launch promo. Purchases (Razorpay web, and IAP below) grant that claim.

**What's built:** `POST /api/billing/iap/verify` — the native app POSTs `{platform:"google"|"apple",
productId, purchaseToken}` after a store purchase; the server verifies it **server-side** and `grantPro()`s.
Verification lives behind seams in `functions/_iap.js` and returns **501 until you provision creds** (never a
fake grant).

**You provision:**
1. **Client billing plugin** (Capacitor): Play Billing (Android) + StoreKit (iOS) to make the purchase and
   POST the token/transaction to `/api/billing/iap/verify`. (No Capacitor IAP plugin is installed yet.)
2. **Google Play**: a Play Console service account → set Pages env `GOOGLE_PLAY_SA_JSON` + `GOOGLE_PLAY_PACKAGE`
   (`in.stewardmd.app`). Then wire the `verifyGooglePlay` seam (recipe in `_iap.js`: SA→OAuth token →
   `purchases.subscriptionsv2.get` → read `subscriptionState` + `expiryTime`).
3. **Apple**: an App Store Connect API key → env `APPLE_ASC_KEY` + `APPLE_ASC_KEY_ID` + `APPLE_ASC_ISSUER` +
   `APPLE_BUNDLE_ID`. Wire the `verifyAppStore` seam (App Store Server API `GET /inApps/v1/subscriptions/{txn}`).
4. **Renew/cancel/refund webhooks** (follow-up): Play RTDN (Pub/Sub) + App Store Server Notifications V2 →
   `grantPro`/`revokePro` so entitlement stays fresh without the client.
5. **App-store review:** reviewers must be able to use the app → give them a free trial or a demo account.

**Free → paid cutoff:** the launch promo (`_entitlement.js`) treats everyone as Pro until `PRO_FREE_UNTIL`
(default 2026-09-15; overridable via env). Set `PRO_FREE_UNTIL` to "now" to go Pro-only immediately.

## Honest limits
On-device code is inherently reverse-engineerable: the lock stops **bundle-download piracy** (the `.enc` KB is
useless without your server key), but a determined *paying* user could still extract the decrypted KB from
memory once unlocked. That raises the bar from "download the app" to "pay + reverse-engineer memory" — the same
ceiling Marrow/PrepLadder have.
