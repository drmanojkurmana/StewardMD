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
