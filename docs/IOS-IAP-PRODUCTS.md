# iOS IAP product manifest (from the pricing plan)

Derived from **`docs/PRICING_PACKAGING.md` (v7, signed-off)**. This is the exact set of App Store Connect
products the native StoreKit layer (`iap.js`, PR #694) expects. **I create these via `asc` once the Paid
Applications agreement is active** (owner step); prices below are the INR targets — pick Apple's nearest
price point per territory (India base).

Coordination: the **pricing session** owns tiers/prices/promo + the multi-tier paywall UI; **this session**
owns the native StoreKit mechanism + creating these ASC products to match.

## Session B decisions (2026-08-17, authoritative)
- **iOS IAP set (create + sell on iOS, accept Apple ~15%):** Trainee, Co-Resident, Pro, Physician, Physician Pro (monthly + annual) + Onco add-on + the 3 token packs. These are the only way iOS users can pay, so they must exist.
- **WEB / ANDROID ONLY — do NOT create on iOS:** Founding-Doctor ₹399/yr offer, coupon/redeem codes, the ₹139/clinic/mo extra-clinic add-on, and all Hospital B2B. iOS inherits these via account sign-in (entitlements are account-based on the Firebase/Google uid, so a web purchase unlocks iOS). Keep these UIs **hidden on iOS** (Guideline 3.1.1: never advertise/link the external offer inside the iOS app).
- **Onco add-on:** offer only to **Trainee / Pro / Physician** subscribers. **Never to Physician Pro** (it already includes OncoTree + ONCQIS) — avoid a double charge.
- **Co-Resident:** keep `.monthly` (₹299); `.annual` low-priority. 2-account plan — StoreKit sub sits on account #1; the server links account #2 to the same `aiPoolUid` (`ai:pool`) on activation.
- **Free trial:** set an ASC introductory **free trial** on the base subs (Trainee, Pro, Physician, Physician Pro; monthly primarily, annual optional). **Not** on token packs (consumables can't) and **not** on the Onco add-on. Length: **14 days at launch, edit to 7 days after the cutover** (ASC intro offers are not date-conditional; Apple applies the change to new subscribers going forward). One free trial per user per subscription group.
- **Paywall UI + platform routing:** owned by Session B (iOS → `SMD_IAP`, web/Android → Razorpay/PhonePe).

## Auto-renewable subscriptions — group "StewardMD Pro"
| Product ID | Tier | Monthly (INR) | Annual (INR) |
|---|---|---|---|
| `in.stewardmd.trainee.monthly` / `.annual` | Trainee (Student/Intern/Resident) | 199 | 1,999 |
| `in.stewardmd.coresident.monthly` / `.annual` | Co-Resident (2 accounts) | 299 | 2,999 |
| `in.stewardmd.pro.monthly` / `.annual` | Pro | 599 | 4,999 |
| `in.stewardmd.physician.monthly` / `.annual` | Physician | 1,499 | 14,999 |
| `in.stewardmd.physicianpro.monthly` / `.annual` | Physician Pro | 2,499 | 24,999 |
| `in.stewardmd.onco.monthly` / `.annual` | Physician Onco add-on (+₹89) | 89 | 899 |

## Consumables — MaiK Token packs
| Product ID | Tokens | Price (INR) |
|---|---|---|
| `in.stewardmd.tokens.boost` | 50,000 MT | 49 |
| `in.stewardmd.tokens.plus`  | 250,000 MT | 199 |
| `in.stewardmd.tokens.power` | 750,000 MT | 499 |

**From 2026-12-26 (`PACKS_V2_FROM`) the same three product ids credit 10,000 / 40,000 / 100,000 MT** at the
same prices (the old sizes sold tokens at our cost; the Power pack lost money after Apple's cut). Keep the ASC
display name and description free of the token count, or edit them on that date. See `vault/Role-Tiers.md`.

## Consumables — Dictation credit packs (added 2026-09-26; created in ASC 2026-09-27, Play pending)
Cloud speech-to-text is used only when the phone cannot transcribe; it spends dictation credits (never shown in
rupees). Server: `functions/_quota.js` feature `dict`, fulfilled like the care/scribe packs.
| Product ID | Credits | Price (INR) | ASC display name | Description (<= 55 chars) |
|---|---|---|---|---|
| `in.stewardmd.dict.300`  | 300   | 199 | 300 Dictation Credits   | Cloud dictation when your phone cannot transcribe |
| `in.stewardmd.dict.1000` | 1,000 | 699 | 1,000 Dictation Credits | Cloud dictation when your phone cannot transcribe |
Type: Consumable.

**Status (2026-09-27, app 6790305279):**
- **App Store Connect:** both created, READY_TO_SUBMIT, availability India + US, review screenshot attached.
  - `dict.300` = IAP 6816651611
  - `dict.1000` = IAP 6816651543
  - They ship with the next review submission. Add the app version AND each IAP version to one submission with
    `asc review submissions-create` and `asc review items add`; `asc review submit` alone sends only the app version.
- **Token packs:** display names changed to "MaiK Tokens Boost / Plus / Power" with no token count, so the
  2026-12-26 re-size needs no store edit.
- **care.25, care.100, scribe.50, scribe.250:** were MISSING_METADATA since 2026-09-18 (no territory
  availability; care.* had no localization). Fixed; now READY_TO_SUBMIT.
- **msg.100 (6813248305):** still MISSING_METADATA because it has no price schedule. The owner sets INR 599.
- **Google Play:** NOT created yet (no Play API access on the build Mac). In Play Console go to Monetize, then
  Products, then In-app products, and create both ids at INR 199 / 699, then Activate. Until then an Android
  store purchase of a dictation pack fails; web (Razorpay) purchase works.

## Not standard iOS IAP (handle separately)
- **Personal clinic add-on (₹100/clinic/mo)** — quantity-based; keep web-only or model later.
- **Hospital B2B plans** — sales-led, not App Store.
- **Institution coupons / redeem codes** — Apple forbids IAP promo codes in-app; the paywall's redeem field
  is for codes obtained outside (allowed), web/Android is where coupons live (per plan §12).

## iOS app-store-cut decision (OWNER + pricing session)
Plan §12 wants to minimise Apple's 15% (small-business program) vs ~2% on web. **Apple forbids steering to
external payment inside the iOS app (Guideline 3.1.1)** — so on iOS you either offer these as IAP (Apple's
cut) or offer nothing purchasable. Decide which tiers/packs are sold via iOS IAP vs left web-only before the
products are submitted. `iap.js` can expose any subset.

## Owner runbook for going live
See `docs/IOS-IAP-IMPLEMENTATION.md`: Paid Apps agreement (LLP) + banking/tax → I create these products via
`asc` → set server `APPLE_ASC_*` env → `npm install` + `cap sync` → StoreKit-sandbox device test → submit with v1.1.
