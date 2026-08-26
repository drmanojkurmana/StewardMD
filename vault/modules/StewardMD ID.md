---
tags: [module, identity, cross-cutting]
status: live (mint) / flag-gated (anchor email)
flag: smd_steward_id_mint (def ON) · smd_steward_id (def OFF)
---
# StewardMD ID

Every user's permanent, human-readable account handle: **`SMD-XXXXXX`** (base32, no ambiguous
0/O/1/I/L). It is the thing a colleague adds you to a unit **by**, a referral is addressed to, and a
support ticket is filed against — the app's equivalent of a national ID number, not a reward for
using a feature.

## Key files
- `steward-id.js` (`SMD_STEWARD_ID`) — mint/resolve. `ensure(deps, cb)` is the ONLY mint path worth
  using; all Firebase access is injected via `deps` so it unit-tests in node. `my([uid])` returns the
  resolved ID.
- `steward-id-flags.js` — `smd_steward_id_mint` (default **ON**, kill switch for the mint) and
  `smd_steward_id` (default **OFF**, the verified-email / Apple-proxy capture UI only).
- `steward-id-onboard.js` (`SMD_STEWARD_ONBOARD`) — the sign-in bootstrap. Waits for the lazily
  loaded Firebase SDK (`SMD_loadFirebase`), then on `onAuthStateChanged` ensures the ID for every
  signed-in user. The anchor-email prompt on top of it stays behind `smd_steward_id`.
- `anchor-email.js` (`SMD_ANCHOR`) — classifies real / Apple-proxy / empty email.
- `icu-collab.js` — `ensureIdentity` / `myDoctorId` for ICU's own call sites; delegates to the shared
  module, with a byte-identical inline fallback if it hasn't loaded.

## Firestore shape
- `users/{uid}/profile/self` → `{ smdId, name, at }` — private cache, owner-only.
- `doctorDirectory/{smdId}` → `{ uid, name, at }` — uniqueness + "add by ID" lookup.
- `doctorDirectory/e_{emailHash}` → `{ uid, name, smdId, at }` — "add by email"; the raw email is
  NEVER stored, only a hash. Both are **get-only, never listable**, so the directory can't be
  enumerated into a roster of every doctor.
- Mint and the email index are **transactions**: `{smdId}` aborts + regenerates on collision, and
  `e_{hash}` never overwrites a pointer owned by a different uid (one email, one account).

## Gotchas
- **Never cache the ID without its uid.** Now that it is minted for everyone, sign-out → sign-in as
  another user happens in one page lifetime; a uid-less cache hands account B account A's ID, and it
  then travels into referrals, invites and the directory. Both `steward-id.js` `_cache` and
  `icu-collab.js` `_identity` are keyed on uid; `my(uid)` refuses a mismatch.
- **Don't bootstrap on `if (window.firebase)` at parse time** — index.html loads the SDK lazily on
  idle, so it is essentially never there yet. Use `SMD_loadFirebase`.
- The ID card (`.icu-v2-idcard`) renders on BOTH ICU Team screens, solo and shared — a resident needs
  to read their ID out *before* they are in any unit.

## Where a doctor sees it
The **profile page** — `openAccount()` in `home.js`, exported as `window.SMD_openProfile` so every
entry point opens the same sheet: the sidebar identity block (`#smdSbProfile` — your own photo/name),
More → Profile, and Settings → Account → "Profile & StewardMD ID" (`sidebar-redesign.js` ACT
`profile`). The page shows identity → StewardMD ID (copyable) → professional details (reg no,
hospital/college, **degree**, **speciality**, city, phone, edited in place) → account → danger zone.
Also on both ICU Team screens. Note "Account & Verification" (verify.js) is a DIFFERENT sheet — the
registration certificate flow — and is reached from the same Settings section.

## Professional details (`users/{uid}/profile/self`)
One Firestore doc, two writers — keep them in step:
- **The Profile card** (`acctFillProfessional` in `home.js`) reads and edits it in place.
- **`profile-setup.js`** asks for the four required fields (phone · college/hospital · degree ·
  speciality) on every app start while any is missing. "Later" postpones for that app-open only.
  It owns the shared `DEGREES` / `SPECIALITIES` lists (`window.SMD_PROFILE_SETUP`), which the
  Profile card's chooser also reads, so the two surfaces can never offer different options.
- Institutions come from `hospitals-in.js` (`window.SMD_HOSPITALS`, ~2,400 entries) with a
  request-to-add flow via `functions/api/hospital-request`.

**Gotcha, and it bit us:** this card broke exactly the way the bullet above warns. It read
`window.SMD_DB` once at open, found it absent (lazy SDK), and showed every row as "Offline" with a
Retry that was the only escape. Boot via `SMD_loadFirebase` and re-fill the sheet that is on screen
*then* — a re-render detaches the card you captured. Pinned by `test/run-profile-details-ui.mjs`.

## History
Built as Phase 1 of the 4-phase identity/entitlement initiative (PR #545, all phases merged
flag-OFF). Until 2026-08-22 the mint was reachable only through ICU's group-mode subscription, so an
ID existed only after a user turned Group mode on and a unit resolved — see [[Decisions]].
Consumers: [[ICU]] (units, invites, Team), referrals, the entitlement record + admin console.
