---
tags: [plan, billing, identity, anti-abuse]
status: PROPOSED (awaiting owner approval) - 2026-09-26
flag: TRIAL_ONCE_ON (proposed, KV, default OFF until approved)
---
# Plan: the 7-day free Pro trial is once per doctor, not once per account

Owner ask (2026-09-26): "7 days free trial is one time and once per number verification ... same
device id no second trial. use device id/imei, ip address, old signout account already pro new sign
in again creating pro trial dont activate."

## 1. How a trial is granted today (verified against code)

There are THREE doors to free Pro. With `VERIFY_REQUIRED_FOR_PRO` on (default), all are per-uid:

| Door | Where | Claim written | Keyed on |
|---|---|---|---|
| A. Verified free week | `verify-doctor.js` `setVerifiedClaim`, `verifications/[[path]].js` `doApprove` | `verified`, `verifiedAt` (week = verifiedAt + 7 d) | uid; reg no is unique (`icu:reg:<REG>` -> uid) |
| B. Pending manual review | `verify-doctor.js` `toManual()` | `provUntil = now + 7 d` | uid only |
| C. "Skip for now" trial | `verify-doctor.js` `body.trial === true` / `decideTrial` | `provUntil = now + 7 d` | uid only (`icu:doctor:<uid>.trialStartedAt`) |

`accessState()` (`functions/_entitlement.js`) treats `provUntil > now` as full Pro.

### Holes this leaves open
1. **New Google/Apple account = new trial.** Sign out, sign in with another email, tap "Skip for
   now" (door C): another 7 days. Nothing ties it to the person or the phone.
2. **Door B checks nothing.** `toManual()` runs BEFORE the reg-uniqueness check (step 4), so any
   upload that lands in manual review (blurry photo, someone else's certificate, a reg already
   claimed by another account) grants 7 days Pro immediately.
3. **`doApprove` never checks `icu:reg:<REG>`**; it overwrites the pointer. An owner approving a
   duplicate silently moves the reg to the new account and starts a second week.
4. **`verifiedAt` is re-stamped on every approve/verify**, so reject -> re-approve, or an admin
   re-approval, restarts the free week.
5. **Phone numbers are not unique across accounts.** `otp:phone:<uid>` and
   `lifecycle:u:<uid>.phone` are per uid; the same number verifies any number of accounts.
6. Account purge deletes `icu:doctor:<uid>` (the record that remembers door C was used) but keeps
   `icu:reg:*`. A purged-then-recreated account forgets its trial.

## 2. Design: one ledger of "trial already used" fingerprints

New KV namespace prefix in `ICU_CASES` (already bound, already holds `icu:reg:*`):

```
trial:used:<kind>:<hash>  ->  { uid, at, door }      no TTL (permanent, it IS the "used" record)
```

`<kind>` and what it hashes (SHA-256 with a server secret `TRIAL_PEPPER`, so the ledger holds no
raw phone number, reg no or device id, and cannot be reversed or enumerated):

| Kind | Source | Strength | Decision |
|---|---|---|---|
| `reg` | NMC/SMC registration no. (normalised) | strongest: one per doctor, by law | **hard block** |
| `phone` | verified mobile (E.164 from `_phone_otp.js`) | strong: OTP proves possession | **hard block** |
| `dev` | device id (see section 3) | strong on native, weak on web | **hard block** on native, soft on web |
| `ip` | `CF-Connecting-IP` /24 (v4) or /56 (v6) | weak: hospital wifi and mobile CGNAT share IPs | **never blocks alone**; counted, flags for review |

**Rule at grant time (every door):** before writing `verifiedAt` (A) or `provUntil` (B, C), look up
every fingerprint the request can supply. If ANY hard-block kind is already in the ledger for a
DIFFERENT uid, do not grant the trial. The account is still verified (door A still writes
`verified:true`: the doctor is real, the prescription pad unlocks), but gets NO free week:
`verifiedAt` is written as `trialConsumedAt` instead, and `entitlementState` answers
`reason: "trial-used"` so the paywall shows the price, not the verify screen.

On a successful grant, write ALL available fingerprints to the ledger at once.

**Same uid is always fine** (reinstall, second phone, sign out/in with the SAME account): the ledger
row points at that uid, so nothing changes. This is exactly "old account already Pro, sign in again
= no NEW trial": the old account keeps whatever it had, the new one gets none.

## 3. Device ID: what is actually possible (IMEI is not)

- **IMEI is not readable.** Android 10+ restricts `READ_PRIVILEGED_PHONE_STATE` to system apps; iOS
  has never exposed it. Asking for it would also fail Play/App Store review. So: no IMEI.
- **Android: `Settings.Secure.ANDROID_ID`.** Stable per (device, user, app signing key); survives
  uninstall/reinstall and sign-out; changes only on factory reset. Read via `@capacitor/device`
  `Device.getId()` (it returns ANDROID_ID on Android). Good enough to hard-block.
- **iOS: `identifierForVendor` resets when the app is uninstalled**, so on its own it is weak. Two
  complementary fixes:
  1. A UUID stored in the **iOS Keychain** (survives uninstall/reinstall on the same device). Small
     native plugin or `capacitor-secure-storage`.
  2. **Apple DeviceCheck** (2 persistent bits per device, stored by Apple, survive reset of the
     app and even reinstall; set/read server-side with an Apple key). Set bit0 = "trial used".
     This is Apple's sanctioned tool for exactly this ("one free trial per device").
- **`device-id.js` today** is a localStorage UUID (`smd_device_id`), wiped on reinstall; no Device
  plugin is installed. Plan: add `@capacitor/device`, send `hw-<id>` for the trial check SEPARATELY
  from the existing `smd_device_id` (which must not change, it binds Experimental Access codes).
- **Web/PWA**: no stable id exists. Web can only soft-signal (localStorage + IP). Since the product
  is mobile-only, the web path gets: no trial without a verified phone.
- **Trust**: a device id comes from the client, so a rooted phone can spoof it. That is why `reg`
  and `phone` (server-proven) are the real locks and `dev` is the extra layer. Optional later:
  Play Integrity / App Attest to prove the request comes from the genuine app.

## 4. Changes, file by file

**Server**
1. `functions/_trial_ledger.js` (new, pure + KV injected, unit-tested):
   `fingerprints({ regNo, phone, deviceId, platform, ip })`, `checkTrial(store, uid, fps)` ->
   `{ ok } | { ok:false, hit:"reg"|"phone"|"dev", ownerUid }`, `consumeTrial(store, uid, fps, door)`,
   `ipSignal(store, ip)` (counter with 30 d TTL, never blocks).
2. `functions/api/verify-doctor.js`:
   - door C (`body.trial`): require a verified phone (`phoneVerified` claim) first; run
     `checkTrial`; grant only if clean; `consumeTrial` on grant.
   - door B (`toManual`): move the reg-uniqueness check BEFORE `toManual`; run `checkTrial`; if
     the ledger hits, go to manual review WITHOUT `provUntil`.
   - door A (`setVerifiedClaim`): `checkTrial`; clean -> `verifiedAt`; hit -> `verified:true`,
     `trialConsumedAt`, no week. Never re-stamp an existing `verifiedAt`.
3. `functions/api/verifications/[[path]].js` `doApprove`: refuse (409 to the admin, with who owns
   it) when `icu:reg:<REG>` belongs to another uid; same ledger rule; keep an existing `verifiedAt`.
4. `functions/_entitlement.js`: `accessState` returns `freeProActive:false` when `trialConsumedAt`
   is set; `entitlementState` reason `"trial-used"`. Pure, claims-only, no KV on the hot path
   (the decision is made once at grant time and written into the claim).
5. `functions/_phone_otp.js` / auth route: on phone-verify, `consumeTrial` the phone fingerprint only
   if this uid holds a trial; and reject verifying a number already verified by another uid? (see
   decision D2).
6. `functions/_lifecycle.js` purge: keep `trial:used:*` (it is the tombstone), same as `icu:reg:*`.
7. Kill switch: `TRIAL_ONCE_ON` KV flag via `cfgFlag`, default OFF; when OFF, behaviour is exactly
   today's. `TRIAL_PEPPER` secret via `wrangler secret put` / Pages env (never in the repo).

**Client**
8. `@capacitor/device` added; `device-id.js` gains `getHwId()` (Android ANDROID_ID, iOS Keychain
   UUID) without touching `getId()`.
9. `verify.js` / the "Skip for now" call sends `{ hwId, platform }`; iOS also sends a DeviceCheck
   token (server queries/sets the bits).
10. Paywall copy for `reason:"trial-used"`: "Your free week was already used on this phone number,
    device or registration. Subscribe to continue." (No em-dash.) Never tell them WHICH signal hit.

**Admin**
11. Admin Console row: ledger hits (uid, kind, other uid, time) so the owner can override a false
    positive (e.g. a shared family phone) with one tap: `grantPro(days:7, source:"trial-override")`.

## 5. Tests (before any deploy)
- `test/trial-ledger.test.mjs`: each kind blocks a second uid; same uid passes; IP never blocks
  alone; pepper hashing (no raw values in KV); purge keeps the ledger; flag OFF = no change.
- `verify-doctor` tests: door C needs phone; door B no longer grants on a claimed reg; door A with a
  used phone gives verified-without-week; `verifiedAt` never re-stamped.
- `verifications` test: approve of a claimed reg refused.
- `_entitlement` tests: `trialConsumedAt` -> not Pro, reason `trial-used`; paid claim still wins.
- Headless UI test: paywall shows the price (not verify) for `trial-used`.
- Device: Android reinstall keeps ANDROID_ID (real phone); iOS reinstall keeps Keychain id.

## 6. Rollout
1. Git tag `pre-trial-once` (recovery point). Ship server + tests with `TRIAL_ONCE_ON=0`.
2. Shadow mode week: flag `TRIAL_ONCE_SHADOW=1` logs would-be blocks (counts only, no PHI) so the
   false-positive rate is known before anything is denied.
3. Owner flips `TRIAL_ONCE_ON=1` in KV (no deploy). Native build with `@capacitor/device` follows.
4. Existing accounts: backfill the ledger from `icu:reg:*` and `lifecycle:u:*.phone` for everyone
   who already had a week, so current users cannot farm a second one after launch.

## 7. Decisions needed from the owner
- **D1. IP**: soft signal only (recommended; one hospital wifi = hundreds of doctors), or also block
  after N trials per IP per 30 days?
- **D2. Phone uniqueness**: should one mobile number be allowed to verify only ONE account at all
  (stronger, blocks family-shared phones), or only block the TRIAL (recommended)?
- **D3. Pending review (door B)**: keep 7 days full access while pending (current owner decision
  2026-08-27) but gated by the ledger (recommended), or drop pending access entirely?
- **D4. Door C "Skip for now"**: keep it (gated by phone + ledger), or remove it and make
  verification the only door?
- **D5. iOS DeviceCheck**: worth adding now (needs an Apple DeviceCheck key in the Apple developer
  account), or Keychain UUID only for v1?
