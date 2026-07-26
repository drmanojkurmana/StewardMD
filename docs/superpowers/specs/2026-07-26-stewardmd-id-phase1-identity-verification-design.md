# StewardMD ID — Phase 1: Universal Identity + Verified-Email Core (Design)

**Date:** 2026-07-26
**Status:** Design — approved direction, pending user review of this spec
**Owner:** diwakar.kurmana@sapiens.com
**Feature area:** Account identity / auth / entitlement foundation

> **Multi-phase feature.** This is **Phase 1 of 4**. Later phases get their own spec→plan→build cycles:
> - **Phase 2:** Unified entitlement record + admin console keyed to StewardMD ID (moves KardioX/ThoreX v1/v2beta role from device-activation to the *person*; Pro flags managed by ID/email).
> - **Phase 3:** Per-StewardMD-ID AI token budgets + usage enforcement.
> - **Phase 4:** Pro feature-toggle switchboard.
> Phase 1 is the foundation everything else keys off. It must ship as working, testable software on its own.

---

## Goal

Give **every** StewardMD user a universal, human-readable **StewardMD ID (`SMD-XXXXXX`)** anchored to a **verified, deliverable email**, and fix the Apple "Hide My Email" problem where proxy addresses (`@privaterelay.appleid.com`) bounce and leave the account with no reachable email.

## Why now

- Roles/entitlements (KardioX/ThoreX physician-vs-student, Pro, AI tokens) need a **stable per-person key** that admin can look up and manage. The Firebase `uid` is stable but not human-usable; email is human-usable but unreliable (Apple proxy/empty).
- The `SMD-XXXXXX` "Doctor ID" **already exists** (`icu-collab.js`) with a uniqueness-enforced `doctorDirectory` — but it is minted **only for ICU users** (gated behind `icuGroupsOn()`) and its email index is keyed on the raw (possibly proxy) Firebase email.
- Emails to Apple private-relay addresses **bounce**, so verification, case-share, and future notifications silently fail.

## Non-goals (explicitly deferred)

- Unified entitlement doc, moving KardioX/ThoreX tier to the person, admin lookup-by-ID — **Phase 2**.
- AI token budgets — **Phase 3**. Pro feature toggles — **Phase 4**.
- **Aadhaar linking** — deferred to the Phase 2 identity-linking work. When built, it is stored as a **one-way hash and/or an `aadhaarVerified: true` flag only — never the raw 12-digit number** (DPDP Act liability). Phase 1 reserves the field name but does not collect Aadhaar.
- No change to the Firebase Auth provider set, sign-in UX for Google/email-password, or the promo `PRO_FREE_UNTIL` logic.

---

## Architecture

**Principle:** promote the existing `SMD-XXXXXX` Doctor ID to *the* universal StewardMD ID; keep the stable Firebase `uid` as the internal server key (1:1 with the StewardMD ID via the directory). Add a **verified anchor email** as the deliverability + anti-duplicate anchor. Do **not** rip out working plumbing — extend it.

Three moving parts:

1. **Universal minting** — mint an `SMD-XXXXXX` for every authenticated user at first load (not just ICU users), backfilled lazily for existing users on their next sign-in.
2. **Anchor-email resolution** — on sign-in, classify the account's email: real+verified (Google / verified email-password / Apple "share real email") vs. proxy/empty (Apple Hide-My-Email). Store the resolved **anchor email** on the profile and use it (hashed) for the directory email index.
3. **Real-email capture flow** — when the anchor is proxy/empty, block account finalization and prompt the user to add a real email, **primarily by linking Google** (`linkWithCredential`, no email sent — Google emails are inherently verified), with a **typed-email + OTP** fallback.

### Identity key relationships (after Phase 1)

```
Firebase uid  ──1:1──  SMD-XXXXXX (StewardMD ID)
     │                      │
     │                 doctorDirectory/{smdId} → { uid, name, at }        (uniqueness source of truth)
     │                 doctorDirectory/e_{hash(anchorEmail)} → { uid, smdId, name, at }
     │
users/{uid}/profile/self → { smdId, anchorEmail, anchorEmailVerified, anchorEmailSource, anchorEmailAt, name, ... }
```

Internal entitlement stores (Firebase claims, experimental Firestore, KV) stay keyed on `uid` — unchanged in Phase 1. The StewardMD ID becomes the human-facing handle; Phase 2 makes it the admin lookup key.

---

## Components

### C1. `steward-id.js` (new client module, `window.SMD_STEWARD_ID`)

Extracts and **universalizes** the identity logic currently buried in `icu-collab.js` (`genSmdId`, `emailHash`, `mintIdentity`, `ensureIdentity`, `normalizeId`, `resolveDoctor`). New responsibilities:

- `ensureStewardId()` — idempotent mint/backfill, **NOT gated on `icuGroupsOn()`** (the core change). Runs for every signed-in user. Returns the ID via callback/promise, never throws.
- `myStewardId()` — cached accessor.
- Preserves the existing collision-retry transaction on `doctorDirectory/{smdId}` and the profile cache of `smdId`.
- `icu-collab.js` is refactored to **call `SMD_STEWARD_ID`** instead of holding its own copy — no behavioral change for ICU users, single source of truth. (Reviewer note: verify no ICU regression.)

### C2. `anchor-email.js` (new client module, `window.SMD_ANCHOR`)

Pure classification + resolution logic (unit-testable, no Firebase calls in the pure core):

- `classifyEmail(email, provider, emailVerified)` → `{ status: "real" | "proxy" | "empty", source: "google" | "apple" | "manual" | "password" }`.
  - `@privaterelay.appleid.com` (and any `*.appleid.com` proxy) → `proxy`.
  - empty/null → `empty`.
  - Google provider or Firebase `emailVerified === true` → `real`.
  - Apple with a non-proxy, non-empty email → `real` (user chose "Share My Email").
- `needsRealEmail(classification)` → boolean (true for `proxy`/`empty`).
- The impure wrapper reads the current Firebase user + provider data, calls the pure core, and returns the classification.

### C3. Real-email capture UI (new screen/modal, wired into onboarding + account)

Shown when `needsRealEmail()` is true after sign-in (and reachable from the Account screen as "Add / verify email"):

- Copy: explains the Apple private email can't receive StewardMD messages and a real email is required to finish setup.
- **Primary action — "Continue with Google"**: `linkWithPopup`/`linkWithCredential(GoogleAuthProvider)` on the *existing* account → read the linked Google email → set anchor (`source: "google"`, `verified: true`). No OTP, no email sent.
- **Fallback — "Enter email"**: user types an email → C4 sends an OTP → user enters the code → on success set anchor (`source: "manual"`, `verified: true`).
- Until an anchor is set: the flow is non-dismissable for *email-dependent* actions (Phase 2 enforces entitlement gating; Phase 1 sets the flag and soft-blocks finalize + shows the prompt).

### C4. `functions/api/identity/[[path]].js` (new Cloudflare Pages Function)

OTP verification for the typed-email fallback, using the project's existing transactional-email path (the plan pins the exact sender). Firebase ID-token authenticated (reuse `functions/_fbauth.js verifyFirebaseToken`). Endpoints:

- `POST /api/identity/email/start` — body `{ email }`. Validates format; rate-limits per uid; generates a 6-digit code; stores `sha256(pepper + code)` + expiry (10 min) + target email + attempt counter in **Cloudflare KV** keyed by uid; sends the code to the typed email. Returns `{ ok: true }` (never leaks whether the email pre-exists).
- `POST /api/identity/email/verify` — body `{ email, code }`. Compares hash, checks expiry + attempt cap (≤5); on success writes a **server-side attestation** and returns `{ ok: true, verified: true }`. The client then writes `anchorEmail`/`anchorEmailVerified`/`source: "manual"` to `profile/self` (guarded by rules: user can only write their own profile). Rejects with typed errors: `code-expired`, `code-mismatch`, `too-many-attempts`, `rate-limited`, `bad-email`.

### C5. Bootstrap wiring (`native-auth.js` / `email-auth.js` / app entry)

On Firebase auth-state = signed-in:
1. `SMD_STEWARD_ID.ensureStewardId()` (mint/backfill).
2. `SMD_ANCHOR.resolve()` → if `needsRealEmail`, surface C3; else ensure `profile/self.anchorEmail` is set from the real email and the directory email index uses `hash(anchorEmail)`.

This replaces the ICU-gated mint and the raw-email directory index. `account.js`, `recent.js`, `caseshare.js` continue to tolerate an empty Firebase email; they gain `anchorEmail` as the reliable address.

### Data model additions — `users/{uid}/profile/self`

| Field | Type | Notes |
|---|---|---|
| `smdId` | string | existing; now minted universally |
| `anchorEmail` | string | verified, deliverable email of record |
| `anchorEmailVerified` | bool | true once Google-linked or OTP-verified |
| `anchorEmailSource` | `"google"\|"apple"\|"manual"\|"password"` | provenance |
| `anchorEmailAt` | serverTimestamp | when set |

Directory: `doctorDirectory/e_{hash(anchorEmail)}` replaces the raw-email index. Existing raw-email index entries remain readable (get-by-exact-key) during migration; new writes use the anchor. No raw email is ever stored (unchanged from today — only the FNV-1a+djb2 hash).

---

## Data flow

**New Google / verified-password sign-in:** auth → `ensureStewardId()` mints `SMD-XXXXXX` → `resolve()` classifies email `real` → writes `anchorEmail` (source google/password, verified true) + directory index. No prompt.

**New Apple "Share My Email":** auth (real email present) → mint → classify `real` (source apple) → write anchor. No prompt.

**New Apple "Hide My Email":** auth (proxy/empty) → mint → classify `proxy` → C3 shown → user links Google *or* enters email+OTP → anchor written verified → directory index. Finalize unblocks.

**Existing user, next sign-in (backfill):** `ensureStewardId()` finds no `smdId` → mints (idempotent). `resolve()` sets `anchorEmail` from their real email if present; if they were an Apple-proxy user, C3 prompts them once.

---

## Error handling

- Minting collision → existing transaction retry (≤6 attempts) → on exhaustion, callback `null`; app remains usable, retries next load (never blocks sign-in).
- OTP: typed errors (`code-expired`, `code-mismatch`, `too-many-attempts` ≥5, `rate-limited`, `bad-email`); attempt cap + 10-min expiry; codes stored hashed with a server pepper, never logged.
- Google-link failure (popup closed, `credential-already-in-use` — email already tied to another account) → surfaced as a clear message; user can try the other email or the OTP path. `credential-already-in-use` must **not** silently merge accounts.
- Email send failure → `POST /start` returns a soft error; user can retry or use Google-link.
- Never block sign-in on any identity step; degrade to a re-prompt on the next load.
- No PHI/PII in logs; email appears only hashed in the directory and only in KV (short-TTL) during OTP.

## Security & privacy (R3 gate)

- OTP codes hashed (`sha256(pepper + code)`), short TTL, attempt-capped, per-uid rate-limited; pepper from an env secret, never committed.
- Raw email never persisted to Firestore (hash-only index, as today). Anchor email stored on the user's own `profile/self` (rules already restrict to `request.auth.uid == userId`).
- `/api/identity/*` requires a valid Firebase ID token; no owner/admin surface in Phase 1.
- Aadhaar explicitly **not** collected in Phase 1; when added, hash/flag only.
- Ships only through R1 (clinical — n/a here, no clinical logic) confirmation, **R3 security**, and R5 UX gates before any flag flip.

## Feature flag

- `smd_steward_id` (master, default **OFF**) gates universal minting + the anchor-email flow, so it can be dark-launched and validated before rollout. ICU's existing lazy mint continues to work with the flag off (no regression). With the flag on, minting becomes universal.

---

## Testing

Node tests (follow repo convention — pure-logic modules use `node:test`, dual `module.exports` + `window.*`):

- **`steward-id`**: `genSmdId()` format (`SMD-` + 6 chars from the 31-char no-ambiguous alphabet), never emits `0/O/1/I/L`; `normalizeId()` bare-code → `SMD-`; `emailHash()` stability + case-insensitivity; `ensureStewardId()` idempotence (second call returns cached, no re-mint).
- **`anchor-email`**: `classifyEmail()` truth table — privaterelay→proxy, empty→empty, google→real, verified-password→real, apple-real→real, apple-proxy→proxy; `needsRealEmail()` polarity.
- **OTP function**: code hash match/mismatch, expiry, attempt cap (6th attempt rejected), rate-limit; `/start` never reveals pre-existence; malformed email rejected.
- **Backfill idempotence**: user with existing `smdId` is not re-minted; user without gets exactly one.
- **No-regression**: ICU `resolveDoctor`/`addByIdOrEmail` still resolve by ID and by anchor email after the `icu-collab.js` refactor.

## Rollout

1. Land behind `smd_steward_id=OFF`.
2. Enable in a debug/staging build; verify all four sign-in paths (Google, password, Apple-share, Apple-hide) mint an ID and set/prompt for an anchor email.
3. R3 + R5 review.
4. Staged flag-on; monitor mint success + anchor-verification completion.

## Open items for the plan

- Pin the exact transactional-email sender used by `/api/identity/email/start` (reuse whatever case-share/verification email uses).
- Confirm the `linkWithCredential` vs `linkWithPopup` choice per platform (native Apple → web SDK credential exchange already exists in `native-auth.js`; Google-link on native uses the native Google plugin credential).
- Decide whether backfill is purely lazy (on next sign-in) or also a one-time admin/script sweep of `doctorDirectory` completeness (recommend lazy-only for Phase 1).
