# StewardMD Guided Tour — Design

Date: 2026-07-12
Status: Approved (design), pending implementation-plan
Scope owner: single implementation plan

## Goal

Give a first-time doctor confidence to use every major StewardMD feature within
their first session, via a premium, dismissible, once-per-account interactive
tour that drives the *real* UI (no screenshots). Plus a small set of one-time
contextual tips on first feature use.

Out of scope (explicitly deferred): full-screen welcome-slide screens, and the
guided patient-simulation sandbox. This spec is the "tour core" only.

## Constraints & context

- Buildless static PWA. Cloudflare Pages: merge to `main` = production deploy.
  Cache-bust via `?v=goldNNN` in `index.html` + `sw.js var CACHE` bumped together.
- Additive modules pattern: standalone `*.js` loaded in `index.html`, exposing a
  `window.SMD_*` global (see `welcome-email.js`, `signout-fix.js`, `toast.js`).
- Navigation is uniform: every feature is a `[data-act="..."]` button, routed by
  one delegated click handler in `home.js` (`root.addEventListener("click", ...)`,
  ~line 1118). Known acts: `search`, `askai` (MaiK), `startcase`, `reasoning`,
  `drugmenu`, `calculators`, `icu`, `antibiogram`, `syndromes`, `ward`, `more`.
- An existing, proven tour engine lives privately in `icu.js` (~line 3447):
  spotlight highlight `.icu-tour-hl`, coach-mark card, Back/Skip/Next/Done,
  "Step X of N", per-account state keyed by `ownerNow()`, `TOUR_VERSION`,
  `prefers-reduced-motion` handling. The new module generalizes this pattern.
- Standing user rule (memory `stewardmd-reversible-changes`): big/risky changes
  go behind a feature flag + a git recovery point; feature branch, not pushed to
  `main` until approved on-device.

## Decisions (confirmed with user)

1. Scope = interactive tour + one-time contextual tips. No welcome slides, no
   sandbox.
2. Trigger = first home foreground after sign-in / guest entry. Welcome messaging
   is the tour's first step (no separate slide screens).
3. Flag `smd_onboarding_tour` default **ON** (dismissible + once-only = low risk);
   disable via `?tour=0` or a More-menu toggle. Ship flag-gated with a git
   recovery tag on a feature branch.

## Architecture

New additive module **`onboarding.js`** exposing **`window.SMD_TOUR`**:

- `SMD_TOUR.start(opts?)` — start/replay the tour immediately.
- `SMD_TOUR.maybeAuto()` — start only if eligible (flag on + not completed/opted-out).
- `SMD_TOUR.tip(id, opts)` — show a one-time contextual tip if not yet seen.
- `SMD_TOUR.reset()` — clear tour state (debug/replay).

It only *reads* the existing DOM (`[data-act]` targets) and *adds* an overlay
layer; it does not modify `home.js`/`icu.js` core logic. `index.html` gains one
`<script src="/onboarding.js?v=goldNNN">` tag near the other additive modules.

### Engine (generalized from icu.js)

- **Spotlight**: fixed full-viewport dim backdrop with a cut-out/glow + pulse ring
  around the current target; `outline`-based highlight class on the target so it
  reads above the scrim.
- **Coach-mark card**: floating card anchored near the target (auto-flips
  above/below to stay on-screen; falls back to bottom-center when target is null
  or off-screen). Shows step eyebrow ("Step X of N"), title, 1-2 line body,
  Back / Skip / Next (Finish on last step), "Don't show again" checkbox on last.
- **Repositions** on `resize`/`orientationchange`; only runs when home is the
  foreground view.
- Reduced-motion: disables pulse/transition via `@media (prefers-reduced-motion)`.

### Tour config (centralized, data-driven)

A single `TOUR_STEPS` array; adding/reordering steps needs no core change. Each
step: `{ sel, title, text }` where `text` conveys what / why / when / benefit in
<= 2 short lines. Proposed order (home-anchored; auto-skips a step whose target
is absent):

1. Welcome (no highlight) — what StewardMD is, < 30s.
2. Global Search — `[data-act="search"]`.
3. Ask MaiK — `[data-act="askai"]`.
4. Start a Case / Dx My Patient — `[data-act="startcase"]` (fallback `reasoning`).
5. Drugs (database + interactions + doses) — `[data-act="drugmenu"]`.
6. Calculators — `[data-act="calculators"]`.
7. Stewardship tools (Antibiogram / ICU / Ward Sync) — first present of
   `[data-act="antibiogram"]`, `[data-act="icu"]`, `[data-act="ward"]`.
8. More (account, settings, guidelines, replay) — `[data-act="more"]`.

### Persistence & trigger

Per-account state under key `smd_apptour:<owner>` (owner from the same identity
source the app already uses; `anon` fallback), shape:
`{ launchCount, completedVersion, skippedCount, dontShowAgain, lastCompletedAt }`.

`maybeAuto()` shows when: flag on, `?tour` not `0`, not `dontShowAgain`, not
`completedVersion === TOUR_VERSION`, and `skippedCount < 2` (a plain Skip allows
one more showing). Fires once per session, on first home foreground, after a
short settle delay so home has rendered. `?tour=1` forces it for testing.

### Replay entry

Add to `openMore()` in `home.js` a menu item
`mi("compass", "App tour", "Replay the guided tour", "apptour")` and handle
`a === "apptour"` in the `[data-mi]` handler → `closeSheet()` then
`SMD_TOUR.start({ replay: true })`. (This is the one small, additive edit to
`home.js`.)

### Contextual tips

Lightweight popover (smaller variant of the coach-mark), one-time per hint with a
per-account guard `smd_tip:<owner>:<id>`:

- `interactions-generic` — first Drug-Interaction open: "Search by generic name."
- `calc-pin` — first Calculator open: "Long-press to pin a calculator."
- `maik-natural` — first MaiK question: "Ask naturally, like talking to a colleague."

Fired via `SMD_TOUR.tip(id, {sel})` from additive hooks (event listeners /
`data-act` observation) — no edits to those features' internals. Tips are
suppressed while the main tour is active.

## Accessibility

- Card is `role="dialog"` with `aria-label`; focus moves to the primary button on
  each step (engine already does this).
- `Esc` = Skip; Tab cycles within the card.
- All controls have `aria-label`s; targets scrolled into view before highlight.
- `prefers-reduced-motion` disables animation.
- Works light/dark, phone/tablet, landscape (fixed positioning + safe-area insets).

## Analytics

Safe no-op hooks: dispatch `window` CustomEvents `smd:tour`
(`{phase: 'started'|'step_view'|'skipped'|'completed', step, version}`). No hard
dependency; can be wired to existing metering later.

## Edge cases

- Missing target element → skip that step (no dead highlight).
- Deep links / not-on-home → `maybeAuto()` no-ops until home is foreground.
- App update → `TOUR_VERSION` bump re-offers; `dontShowAgain` still suppresses.
- Offline → tour is fully local (no network); tips likewise.
- Feature flags off (e.g. ICU/antibiogram hidden) → those steps auto-skip.
- Orientation / background-foreground → reposition on resize; re-check foreground.

## Deliverables

- `onboarding.js` (new) — engine + `SMD_TOUR` + `TOUR_STEPS` + tips.
- `index.html` — one script tag + `goldNNN` bump; `sw.js` `CACHE` bump.
- `home.js` — one additive More entry + handler; `maybeAuto()` call on home mount.
- CSS: injected by the module (self-contained), themed via existing tokens.
- Feature branch + git recovery tag; not merged to `main` until approved.

## Testing

- Build-integrity sweep (all JS parse, JSON valid).
- Manual/headless: first-launch shows tour; Skip/Back/Next/Finish; "Don't show
  again"; replay from More; `?tour=0` suppresses, `?tour=1` forces; tips fire once.
- `xcodebuild` simulator build for native compile sanity.
