# iOS In-App Purchase (StewardMD Pro) — implementation + runbook

**Status: code complete on branch `feat/ios-storekit-iap`, NOT device-tested. Ship in v1.1, not the free v1.0.**
StoreKit native code cannot be compiled or run here, and IAP cannot go live until the Paid Applications
agreement is active. Everything below marked **OWNER** is yours to do.

## What this branch adds
- **`local-plugins/capacitor-iap/`** — a minimal StoreKit 2 Capacitor plugin (`Capacitor.Plugins.Iap`, iOS 15+):
  `getProducts`, `purchase`, `restore`, `currentEntitlements`. No third-party runtime.
- **`iap.js`** — `window.SMD_IAP` thin wrapper (available / getProducts / purchase / restore) + the product IDs.
- **`pro-paywall.js`** — the iOS branch now shows a real **Subscribe** + **Restore purchases** when the plugin
  is present (falls back to "coming soon" otherwise). Purchase → server verify → Pro.
- **`package.json`** — registers `@stewardmd/capacitor-iap` as a local plugin.
- Loaded in `index.html` (`iap.js` before `pro-paywall.js`).

The **server side already exists** on main and is unchanged:
`POST /api/billing/iap/verify { platform:"apple", productId, purchaseToken:<transactionId> }`
→ `functions/_iap.js verifyPurchase` (App Store Server API) → `grantPro` (the Firebase `pro` claim).
A purchase is never trusted from the client.

## Product IDs (must match everywhere)
- `in.stewardmd.pro.monthly` — auto-renewable subscription
- `in.stewardmd.pro.annual`  — auto-renewable subscription
(defined in `iap.js` `SMD_IAP.PRODUCTS`; change there + in App Store Connect together.)

## OWNER steps to make it live
1. **Paid Applications agreement** — App Store Connect → **Business** → accept as **MAIKNOWLEDGE LLP**, add the
   LLP **bank account** + **tax forms** (India + US W-8BEN-E). IAP cannot be created/sold until this is active.
2. **Create the subscription products** — one **subscription group** (e.g. "StewardMD Pro") with the two product
   IDs above, prices (suggested ₹499/mo, ₹3999/yr — your call), a display name, description, and one review
   screenshot per product. *(I can create these via `asc subscriptions` once step 1 is active.)*
3. **Server env** — set on the Worker/Pages so `_iap.js` can validate:
   `APPLE_ASC_KEY` (.p8 contents), `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER`, `APPLE_BUNDLE_ID=in.stewardmd.app`.
4. **Build** — `npm install` (picks up the new local plugin) → `npx cap sync ios` → confirm the **Iap** plugin
   appears in `CapApp-SPM` (plugin count goes up by one) → in Xcode add the **In-App Purchase** capability to the
   App target (and the IAP entitlement on the App ID) → native rebuild.
5. **Device-test in the StoreKit sandbox** — sign in to a sandbox Apple ID, open the paywall on iOS, buy each
   plan, confirm the `pro` claim flips (Restore too). Only then submit the IAP products **with** the v1.1 build.

## Notes / caveats
- SourceKit shows "No such module 'Capacitor'/'PackageDescription'" until `npm install` + `cap sync` resolve the
  SPM deps — expected, not a real error (same as the other local plugins in isolation).
- Android Play Billing is a later addition (the server `_iap.js` google path + verify route already exist).
- The v1.0 free release does not include this branch; merge/rebuild for v1.1 only after device testing.
