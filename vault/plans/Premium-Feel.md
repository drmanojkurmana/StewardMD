# Premium feel plan (2026-10-03)

Source: a designer's "Nessie" list (numbers that roll, ~200 ms motion, one big moment, skeletons,
slow ambient background, haptics, press shrink, Face ID + privacy lock, matching launch screen,
Dynamic Type, icon process), mapped onto StewardMD `origin/main` at `1afb444b5`, plus improvements
the list does not cover. Skills applied: ui-ux-pro-max, anti-ui-slop (polish), impeccable
(polish, animate), emil-design-eng, mobile-native.

Every risky item ships behind a flag with a recovery point, per `STEWARDMD-KNOWLEDGE.md` section 2.

## Owner decisions (2026-10-03)

1. Splash: full 3 s sequence on the FIRST open only, fast on every later open. Built
   (`index.html` splash pace script; kill switch `smd_splash_fast="0"`).
2. Launch follows the SYSTEM light/dark mode. Built (native launch colors, web view backgrounds,
   HTML splash on every platform; Android's 06-18 clock guess removed).
3. Android haptics: yes, through the system's tuned `performHapticFeedback` constants only.
   Built (`SmdDevice.haptic`, routed from `haptics.js`).
4. App lock: as recommended. Built: 5-minute background relock behind an opaque shield, 2 h grace
   still wins, kill switch `smd_applock_relock="0"`. Correction: the `smd_applock` flag is never read
   (`flagOn()` is defined but unused); `ensureSetup()` already forces the chooser on every signed-in
   user (test/run-applock-ui.mjs asserts "forcing is not flag-gated"), so lock-by-default is already
   live and needs no flag flip.
5. Insulin dose: swap, not count-up (no intermediate doses on screen).
6. Celebration: achievements in clinical progress (the clinician's own milestones), never patient events.

Correction to B10: `theme-reveal.js` is a one-shot View Transition on a user's theme toggle, not an
ambient loop, so it needs no power or visibility pause. `thinking-orbs.js` had NO reduced-motion
path at all; it now holds one still frame for reduced motion and Low Power Mode.

## Principles (the Nessie list, adapted for a clinical tool)

1. **Frequency decides motion.** StewardMD is opened dozens of times a shift. Anything seen on every
   open gets the least motion, not the most. Rare moments earn the authored animation.
2. **Clinical values never tween.** A rolling number passes through values that never existed. That
   is fine for a token balance and wrong for a dose, a score, or a lab. Counters roll; clinical
   values swap (old value out, new value in, ~180 ms, no intermediate digits).
3. **Celebrate the clinician, never the patient.** Celebrations belong to the user's own milestones
   (logbook month authenticated, module complete). Red flags get the opposite treatment: instant,
   undecorated, warning haptic.
4. **One motion vocabulary.** Press 120 ms, routine state 200 ms, sheets and overlays 320 ms, one
   authored moment up to 800 ms. Exit faster than enter. Extend the existing `motion.css` tokens
   (`--smd-ease`, `--smd-ease-out`, `--smd-dur`) instead of per-file values.
5. **Still when it should be.** Ambient motion stops for reduced motion, Low Power Mode / Battery
   Saver, and hidden documents.

## Part A: the designer's list, against what StewardMD has today

| Tip | Today (evidence) | Action |
|---|---|---|
| Numbers move instead of jumping | Only `insulin.js:294` `countUp`, which counts the dose up from 0 over 460 ms | Shared `SMD_NUM.set(el, value, {kind})`: `"counter"` rolls digits (token wallet, queue counts, streak, logbook totals), `"clinical"` swaps. Move insulin to `"clinical"` (no counting through lower doses) |
| ~200 ms animations | `motion.css:8-13` tokens exist but are rarely referenced; ~23 CSS lines at 0.4 s or more; 2 `scale(0)` entrances | Add press/routine/sheet/moment duration tokens and the strong ease-out curve; migrate the 23 long durations and both `scale(0)` (to `scale(.95)` + opacity) |
| Biggest animation for the biggest moment | No celebration code; `engagement.js:8` badges are toast-style | One authored moment, see B9 |
| Skeleton, not spinner | Skeletons in ~22 files, each hand-rolled; spinners in 11 files | One shared skeleton primitive, see B7 |
| Slow ambient background, still for power/reduced motion | `maik-atmosphere.js:167,288` handle reduced motion + hidden; `theme-reveal.js:55` reduced motion only; no Low Power handling anywhere (only `thermalState` in `LlamaEngine.swift`) | See B10 |
| Haptics on reorder, success, error | `haptics.js` has semantic methods, but iOS-only by owner design (`haptics.js:19-21`); outcomes inferred by regex on toast text (`:117-134`) | See B8 |
| Buttons shrink on press | ~109 per-component `:active` scale rules, values inconsistent | One global press rule (`scale(.97)`, 120 ms, ease-out) for `button, [role=button], .tile, .card[data-tap]`, remove per-file duplicates |
| Face ID + privacy lock that hides every amount | `applock.js` has PIN + Face ID, flag `smd_applock` default OFF, locks only at cold boot with a 2 h grace; iOS `applicationWillResignActive` is an empty stub (`AppDelegate.swift:80`) | See B2 |
| Launch screen matches the app | Native launch, WebView and splash all hard-coded `#FFFFFF` (`capacitor.config.json`, `LaunchScreen.storyboard`, Android `styles.xml:18,25`), deliberate per the `styles.xml` comment | See B4 |
| Test at the biggest text sizes | Nothing honors iOS text size or Android font scale (only `-webkit-text-size-adjust` in `ui-v3.css:48`) | See B3 |
| Icon in 10 styles, legible at 60 pt, dark + tinted | iOS `AppIcon.appiconset` has one 1024 image; Android adaptive icon has no `<monochrome>` layer | See B12 |

## Part B: improvements beyond the list, ranked by what a clinician feels

**B1. Make the boot splash wait for readiness, not a clock.** `index.html:274` plays a constant 3 s
sequence on every open, and app lock even waits for it (`index.html:599`). For a tool opened 30+
times a shift that is roughly 90 s a day of waiting, and the most-seen animation in the app.
Returning users: hide the splash the moment `ready()` (`index.html:587`) is true, with a 150 ms fade.
First launch and post-update: keep the full logo trace. App lock prompts immediately.
*Owner decision: the splash is branded work.*

**B2. Patient privacy, the clinical version of "hide every amount".**
- App switcher cover: on iOS `applicationWillResignActive` add a blurred cover view, removed on
  `applicationDidBecomeActive`. On Android, `FLAG_SECURE` while a PHI screen is open (extend the
  existing `capture-guard` path, `MainActivity.java:34`). Recents and screenshots stop leaking
  patient names.
- Re-lock on resume after an idle timeout (default 5 min, setting in Account > Security), not only
  at cold boot.
- Privacy mode: one tap in the header masks patient names, UHIDs, phone numbers and ages to initials
  (for teaching, screen sharing, rounds in public corridors). A CSS class on `<html>` plus a
  `data-phi` attribute on rendered PHI fields, so it is one rule, not per-screen code.
- Turn `smd_applock` ON after the owner's device test.

**B3. Dynamic Type and Android font scale.** Use `@capacitor/text-zoom` (8.0.1 on npm, official,
matches Capacitor 8): `getPreferred()` on launch and resume, then `set()`. Audit the main flows at
the 2 largest sizes for clipping (ward list, MaiK answers, calculator results, prescription). Fix
with wrapping and `min-height`, never by capping the size.

**B4. Launch chain that matches the theme.** The white chain is deliberate, so a dark-theme user
gets white → white splash → dark app. Option: storyboard uses `systemBackground` + the existing dark
`Splash.imageset` variant; Android adds `values-night/styles.xml`; `ios/android.backgroundColor`
follow the system; `#smdBootSplash` already themes itself pre-paint (`index.html:309`).
Caveat: native launch can only follow the system appearance, not an in-app override.
*Owner decision: keep white or go theme-aware.*

**B5. `font-variant-numeric: tabular-nums` on every clinical number** (vitals, labs, doses, scores,
tables, timers). Digits stop shifting width when values update and columns align. One rule on
shared number classes.

**B6. Value-change motion** (detail of the Part A row). Write `SMD_NUM` once in `motion.css` +
a small JS helper (WAAPI, transform + opacity only, interruptible, reduced motion = instant swap,
`aria-live="polite"` announces the final value only). No new dependency. Apply to: token wallet,
OPD queue counts, streak, logbook counts (roll); ICU scores, calculator results, insulin dose
(swap).

**B7. One skeleton primitive.** `.smd-skel` block/line/circle shapes from existing tokens,
`aria-busy="true"` on the container, appears only if loading exceeds 300 ms (no flash on fast
loads), static under reduced motion, pulse ≤ 1.2 s otherwise. Replace the 11 spinner files first,
then fold the 22 hand-rolled skeletons into it as they are touched. Shape matches the real layout
so nothing jumps when content lands.

**B8. Haptics driven by outcomes, not toast text.** Call `SMD_HAPTICS.success()` where a record
actually commits (logbook entry saved, verification signed, insulin dose recorded, prescription
saved), `warning()` when a red-flag alert renders, `error()` on validation failure, `selection()`
on pickers and segmented controls. Then delete the toast-regex buzz. Android stays off by owner
design; optional later: `View.performHapticFeedback(CONFIRM / REJECT)` (API 30+) uses the tuned
system haptics rather than raw vibration. *Owner decision for Android.*

**B9. One authored celebration.** The clinician's biggest moments in this app: NMC logbook month
authenticated by the guide, a CliniX module completed, first prescription signed. Reuse the boot
splash's own logo trace (`.sbs-logo-trace`, 3 paths, ~1.5 s) as the celebration: the mark draws
itself around a check, the "authenticated" line rolls in, `success()` haptic, ~700 ms total,
tap to dismiss, reduced motion = static mark + text. Brand continuity, no confetti library.
Never fires on patient events.

**B10. Power-aware ambient motion.** Add one `getPowerState()` method + change event to an existing
local plugin (iOS `ProcessInfo.isLowPowerModeEnabled` + `NSProcessInfoPowerStateDidChange`; Android
`PowerManager.isPowerSaveMode` + `ACTION_POWER_SAVE_MODE_CHANGED`). `maik-atmosphere.js`,
`thinking-orbs.js`, `theme-reveal.js` go still when it is on; `theme-reveal.js` also pauses on
`visibilitychange`. Confirm reduced-motion handling in `thinking-orbs.js`.

**B11. Mobile-native baseline fixes** (mobile-native skill).
- ~11 input rules under 16 px trigger iOS zoom-on-focus: set 16 px on coarse pointers.
- ~36 `vh` lines in app shells and bottom-pinned UI → `dvh`.
- `inputmode="decimal"` + `enterkeyhint="next"/"done"` on every numeric calculator field (430
  calculators; insulin already does it, `insulin.js:1586`).
- Gate remaining ungated `:hover` rules behind `(hover: hover) and (pointer: fine)`.
- `theme-color` per color scheme (`index.html:38` is a single value).

**B12. Icon set.** iOS 18 dark + tinted variants in `AppIcon.appiconset`; Android `<monochrome>` layer
for themed icons. Check legibility at 60 pt and 29 pt; fix strokes that vanish when small. Same mark
as the in-app logo.

**B13. Toasts that behave like Sonner.** `toast.js`: pause the timer while the document is hidden,
swipe to dismiss with velocity, enter and exit from the same edge, stack instead of replace, safe-area
aware.

**B14. Continuity between screens.** Same-document View Transitions for list → detail (patient card →
patient view, drug row → monograph) so the tapped card becomes the header. Interactive edge-swipe
back (`swipe-back.js`) with the previous screen at -30 % + dim, like iOS. Feature-detect, plain swap
otherwise.

**B15. Calm save and sync states.** Optimistic save for logbook entries and notes (show saved
instantly, reconcile in the background, surface conflicts inline). One quiet sync indicator ("Saved
on device, syncs when online") instead of per-module banners.

## Phases

| Phase | Items | Why first |
|---|---|---|
| P0 privacy + correctness | B2 (cover, re-lock), B5, B11 | PHI exposure and iOS zoom are defects, not polish; all small |
| P1 feel | B1, B6, B7, B8, B10, press rule + duration tokens | Felt on every open and every tap |
| P2 brand + accessibility | B3, B4, B9, B12 | Needs native rebuild + store builds; batch with the next release |
| P3 depth | B2 privacy mode, B13, B14, B15 | Larger surface, behind flags |

## Verification (per phase)

- Unit tests `node --test test/*.test.mjs` for `SMD_NUM`, skeleton timing, privacy-mode masking.
- Headless CDP pass for each changed screen, light + dark, reduced motion on and off.
- `impeccable detect --json` once on the changed web files; `web-design-guidelines` review; anti-ui-slop
  finish gate (render, inspect, fix in one batch, re-inspect once).
- Real iPhone + Pixel: haptics, splash timing, app-switcher cover, Low Power Mode, largest text size,
  icon on home screen in dark/tinted/themed modes. Emulators cannot verify these.

## Owner decisions needed

1. B1: shorten the 3 s splash for returning users?
2. B4: theme-aware launch, or keep the deliberate white chain?
3. B8: Android haptics via system CONFIRM/REJECT, or stay iOS-only?
4. B2: app lock ON by default after device test; re-lock timeout value.
5. B6: replace the insulin dose count-up with a swap?
6. B9: which moment gets the celebration?
