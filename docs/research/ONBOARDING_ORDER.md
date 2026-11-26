# Onboarding order: first sign-in to ResearchMD

Date: 2026-11-26
Branch: w-sf-onb (origin/main code)
Scope: ResearchMD onboarding overlays, mapped without opening `home.js`.

## Reproduce first, on this worktree

The walkthrough that reported the overlay row ran a bundle 52 commits behind origin/main.
On this worktree, four of the five reported overlays still exist and still compete for the
screen. The fifth, "add your address for sign-in recovery", is not present in origin/main:

- No such copy exists in the current tree (`grep -ri "sign-in recovery|recovery address"`).
- No commit in `git log --all` adds or removes that string (`git log -S"sign-in recovery"`).
- The nearest optional address questions are the state / city / hospital fields inside the
  profile sheet (`profile-setup.js:149-161`). Those are institution fields, not sign-in recovery.

Recorded as: not reproducible on this worktree, so no change was made for it. If it is
reintroduced, it should use the same one-optional-sheet budget described below.

The four that do reproduce:

| # | Overlay | Trigger | Classification |
|---|---|---|---|
| 1 | Registration verification gate (`#verifyGate`) | `verify.js:774` runs `evaluate()` on every auth state change; `verify.js:680-733` calls `showForced()` (`verify.js:355`) for an unverified account. | Safety / legal gate. Registered-doctor check, NMC register, 7-day trial and account-deletion rule. **Needs owner decision** to change. |
| 2 | "Complete your profile" (`#pfSetupRoot`) | `profile-setup.js:733-737` (`maybeAsk`, scheduled 1200 ms after auth at `profile-setup.js:742`); also `email-auth.js:399-405` opens it immediately after email OTP. | Optional (`Later`, `profile-setup.js:599-602`). **Safe to defer.** |
| 3 | "Lock StewardMD" chooser (`#smdApplock`) | `applock.js:494` calls `ensureSetup()` on every account change; `applock.js:474-492` waits for pre-home gates then calls `promptSetup()` (`applock.js:224`). | Security feature, optional but protects patient data. **Any sequencing change needs owner decision.** |
| 4 | "Verify your mobile number" (`#phvRoot`) | `phone-verify.js:573` calls `check()` 2 s after sign-in; `phone-verify.js:535-549` waits for the verify gate, tour, or an open profile sheet, then opens. | Identity / contact verification. **Any sequencing change needs owner decision.** |
| 5 | Welcome / guided tour (not in the report's five, but also on screen) | `onboarding.js:915-934` waits for `homeForeground()` (`onboarding.js:906`), so it already runs after the first screen. | Optional. No change needed. |

### Observed current order and why it feels like a row

The blocking verification gate is first because it is the only forced pre-home gate.
After it is dismissed, the app-lock chooser, the profile sheet and phone verification each
run their own 0.5-2 s timers. Whichever timer wins is the next overlay, so the order is
race-dependent rather than designed. In the reported build the profile form opened inside
1.6 s of sign-in, before home was usable, and the other optional sheets stacked behind it.

`profile-setup.js` did not consult the first screen at all. It opened `form(true)` after
`needed()` (`old maybeAsk`, now `legacyAsk`, `profile-setup.js:695-701`).

## Proposed order

Goal: reach the app, and ResearchMD, before optional housekeeping; never weaken a gate.

1. Blocking gates only: registration verification (`#verifyGate`) as today.
2. First screen is usable (the app shell + `#homeV2`, and ResearchMD reachable).
3. Security / identity sheets, kept in their current order pending an owner decision:
   app lock, then phone verification.
4. At most one optional onboarding sheet per session: profile first, recovery-address only if
   it is reintroduced.
5. Guided tour, which already waits for home.

### Changes by classification

| Change | Classification | Status |
|---|---|---|
| Defer the optional profile sheet until after the first screen | SAFE | Implemented |
| Show at most one optional onboarding sheet per session | SAFE | Implemented |
| Defer a recovery-address sheet (does not exist in origin/main) | SAFE (if reintroduced) | Not applicable; the session budget is ready for it |
| Move the app-lock chooser after the first screen | NEEDS OWNER DECISION | Not implemented |
| Move phone verification after the first screen | NEEDS OWNER DECISION | Not implemented |
| Change registration verification, consent, trial or billing order | NEEDS OWNER DECISION | Not implemented |

## Implemented safe changes

Files: `profile-setup.js`, `email-auth.js` (the onboarding files identified above; `home.js`
was not opened or edited).

- `profile-setup.js` now exposes `request(opts)` and decides the sequence in one place:
  - `smd_onb_legacy="1"` (localStorage) restores the old immediate profile prompt and the old
    `needed()` + 400 ms auto path (`legacyAsk`). It is read on every call, so toggling it on a
    device needs no rebuild or reinstall.
  - Otherwise the sheet waits for the first screen (`#homeV2.on` and no pre-home gate) and for
    no other overlay to be on top (`#smdApplock`, `#phvRoot.on`, the sign-in flow, the tour,
    ResearchMD `#researchMD`, ICU, home sheets). The form therefore never lands over ResearchMD.
  - One optional sheet per session: `sessionStorage.smd_onb_optional_shown="1"` is claimed before
    the sheet opens. It resets on the next app open. A future recovery-address sheet must check
    the same key.
  - The wait is bounded at 120 x 500 ms. If the doctor stays inside ResearchMD or another
    overlay, the profile prompt is skipped for this session rather than interrupting them; it
    is asked again on the next app open.
- `email-auth.js` sends first-run asks (`afterVerified`, the one-time prompt for Google/Apple
  users, and the explicit `firstRun` path) to `request({force:true})`. Explicit re-opens from
  Account still call `open()` immediately.
- No copy, layout, colour or motion changed; existing light/dark and keyboard behaviour is
  untouched.

### Consequences to note

- Phone verification may now appear earlier than the profile sheet, because it no longer finds
  `#pfSetupRoot.on` and waits for `smd:profile-saved`. Its trigger, requirement and server
  checks are unchanged; this is an ordering side effect, and moving phone verification itself
  remains an owner decision.
- App-lock behaviour is unchanged. It can still appear before the first screen; that is called
  out for the owner rather than changed here.

## Tests

- `test/research-onboarding-order.test.mjs` (new, unit): loads the real `profile-setup.js` and
  `email-auth.js` in a VM sandbox and pins the decision matrix (legacy wins, session budget,
  wait for first screen, needed check), the DOM guards, and the email-auth first-run hand-off.
- `test/run-onboarding-order-ui.mjs` (new, headless Chrome): in the real bundle, the profile
  sheet does not open before `#homeV2.on`, opens once it is up, refuses a second optional sheet
  in the same session, and opens immediately again with `smd_onb_legacy="1"`.
- `test/run-profile-setup-ui.mjs` (existing, headless Chrome): all 24 profile-sheet checks pass
  (picker, keyboard, save paths).
- Related unit tests pass: `email-auth-flow`, `profile-picker-options`, `institutions-in`,
  `phone-verify-profile`, `onboarding-font-shorthand`.

## Open doubts

- The recovery-address sheet does not exist on origin/main, so its exact trigger cannot be
  mapped. It was either removed before this branch or lived in the 52-commits-old bundle.
- The first-screen predicate uses `#homeV2` (the same anchor `onboarding.js` uses) plus
  ResearchMD `#researchMD`. If a future shell changes those identifiers, update
  `firstScreenReady` / `appBusy` in `profile-setup.js`.
- The optional-sheet budget is session-scoped. A doctor who postpones the profile form is asked
  again on the next app open, matching the previous "returns on the next start" behaviour.
- The app-lock and phone-verification order still needs an owner decision. Neither gate was
  weakened, moved or made skippable.