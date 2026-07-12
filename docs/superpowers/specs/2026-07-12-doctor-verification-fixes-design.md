# Doctor verification: approval propagation + 7-day trial + clearer copy

_Date: 2026-07-12_

## Problem

Four issues in the doctor-verification flow ([verify.js](../../../verify.js),
[functions/api/verify-doctor.js](../../../functions/api/verify-doctor.js),
[functions/api/verifications/[[path]].js](../../../functions/api/verifications/%5B%5Bpath%5D%5D.js),
[index.html](../../../index.html)):

1. **Owner approval doesn't reflect in the app.** The emailed approve link (and the admin
   console) run the same `doApprove()` — claim set + KV marked `verified`. But the client
   `evaluate()` reads the **cached** Firebase ID token (`getIdTokenResult()` with no refresh)
   and has no branch that honors a server status of `verified`. So an approved doctor is still
   shown the forced gate and told to re-upload, until the token naturally expires or they
   re-sign-in.
2. **✕ close does nothing on the forced gate** — it's `display:none` in `forced` mode, trapping
   unverified doctors with no exit.
3. **No way to skip / try the app.** Provisional (7-day) access is only granted after uploading a
   certificate that fails auto-verify. There's no pure "skip and try" path.
4. **Upload instructions are unclear** — users don't know the two accepted paths.

## Decisions (agreed)

- 7-day trial is **server-side, per account** (tied to uid) — one trial only, survives
  reinstall / cleared storage.
- Trial unlocks **everything except the prescription generator** (prescriptions require the
  `verified` claim, legally and in code).
- Forced gate gets **a working ✕ AND an explicit skip button**; both start the trial and dismiss
  (the ✕ must start the trial, else the gate reopens and feels broken again).

## Design

### 1. Fix approval propagation — [verify.js](../../../verify.js)
- `isVerifiedClaim(force)` gains an optional force-refresh arg.
- In `evaluate()`, when the cached claim is false, consult `fetchStatus()` (authoritative server
  read). Add the missing branch: **if `status === "verified"`, force-refresh the ID token
  (`getIdToken(true)`) so the client claim catches up, then `hideGate()`.** Falls through to the
  existing provisional / forced logic otherwise.

### 2. One-time 7-day trial — [functions/api/verify-doctor.js](../../../functions/api/verify-doctor.js)
`POST /api/verify-doctor` accepts `{ idToken, trial:true }` (no image), before the image checks:
- authenticate uid; if the record is already `verified` → `{status:"verified"}`.
- if `trialStartedAt` exists: active (`provisionalUntil` in future) → return it; expired →
  `{status:"trial_expired"}`.
- else persist `{status:"trial", provisionalUntil: now+7d, trialStartedAt: nowISO, trialUsed:true}`
  → `{status:"trial", provisionalUntil, provisionalDays:7}`.

`PROVISIONAL_DAYS` (existing constant) is the window. No claim is set → prescriptions stay locked.

### 3. Client trial + working ✕ — [verify.js](../../../verify.js) + [index.html](../../../index.html)
- New `#verifySkipBtn` "Skip for now — start your 7-day trial" in the forced gate; show `#verifyClose`
  on forced too.
- `startTrial()`: `POST {trial:true}` → on `trial`: `hideGate()` + toast
  "7-day trial · prescriptions locked · Nd left"; on `trial_expired`: status message
  "Your 7-day trial has ended — please verify" and stay gated. Both ✕ and skip button call it.
- `render()`/`evaluate()`/`provisionalActive` treat `status === "trial"` like `pending` for
  provisional access. When `provisionalUntil` passes, the existing logic re-forces the gate.

### 4. Clearer copy — [index.html](../../../index.html)
Rewrite `#verifySubtitle` and drop labels to spell out two paths:
- **A. Registration certificate** — NMC / State Medical Council certificate (instant auto-verify).
- **B. Aadhaar or any govt photo ID + registration number** — read only the name to match the
  register; the ID is never stored.

## Testing
- Node unit test `test/run-verify-trial.mjs`: grant once → active on repeat → `trial_expired` after
  window; verified account skips trial. (Import the endpoint's pure helpers or drive `onRequest`
  with a fake env/KV + a stubbed `verifyFirebaseToken`.)
- Live smoke tests after deploy: `POST {trial:true}` with a bad token → `401` (reachable);
  full flow validated by owner in-app.

## Out of scope
- Changing the prescription lock rule, the NMC matching, or the admin console UI.
