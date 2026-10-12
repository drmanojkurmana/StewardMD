---
tags: [module, ui, native, motion]
status: BUILT, browser-tested on the real app (headless Chromium, touch emulation). Not yet seen on a handset. The Live Activity Swift (plugin + widget) is written but NOT compiled in this session (no toolchain in the cloud container) - needs a native rebuild.
flag: one kill switch per module, all default ON - localStorage smd_sheet_drag, smd_sheet_depth, smd_view_tx, smd_large_title, smd_pull_refresh, smd_picker_haptics, smd_skeletons, smd_peek, smd_live_activity = "0"
---
# Premium Motion (iOS-like interaction layer)

Owner, 2026-10-12, after [[Dynamic Notifications]]: "Any more similar adaptations to make app more
premium" then "Do all". Eight additive modules, each generic (works over existing screens with no
module edits), each with its own kill switch, loaded by index.html right after swipe-back.js.

| Module | What the doctor feels | How it finds its targets |
| --- | --- | --- |
| `smd-spring.js` | (shared) damped springs; a release keeps the finger's velocity | - |
| `sheet-drag.js` | pull any bottom sheet down by grabber/header, or by content already at the top; flick or ~28% pull dismisses; home recedes (scale .94, black behind) while its sheet is open | geometry at touchstart: fixed, full width, on the bottom edge. Dismisses ONLY through the app's own scrim click or close control; a sheet with neither is never draggable |
| `view-transitions.js` | a tapped row's title flies into the next screen's title, the rest crossfades | capture-phase click on a full-width row with a bold title; replays the click inside `document.startViewTransition`; the LARGEST matching heading gets the shared name |
| `large-title.js` | large titles shrink and fade under the bar; bar gets a hairline (and frost if sticky) | first scroll of any scroller with an `h1` / `*bigt*` / `.rnav-hi` near its top |
| `pull-refresh.js` | pull a list down from the top: spinner winds up, haptic tick at the line, release presses the screen's Refresh | the layer's own control named "Refresh" (aria-label/title). Explicit: `SMD_pullRefresh.register(el, fn)` |
| `picker-haptics.js` | sliders tick per step (firmer at ends); wheel pickers tick per row | `input[type=range]`; small vertical scroll-snap lists |
| `skeletons.js` | the ~70 "Loading…" placeholders become shimmer rows; content fades up when it arrives | MutationObserver; pure CSS on the placeholder, text kept (screen readers still hear it) |
| `long-press-preview.js` | hold a row with its own buttons: it lifts over a blurred page with an iOS menu ("Open" + the row's actions) | rows with inner controls only; no copy/share (no-copy.js PHI rule stands) |
| `live-activities.js` + Swift | ICU task deadline / OPD consult on the Dynamic Island and Lock Screen, clock ticking natively | `SMD_liveActivity.upsert/end`, called from icu.js `grpLiveActivity()` and queue.js `liveActivity()` |

## Live Activities (native)
- Attributes: `ClinicalActivityAttributes` (StewardMDWatchCore `Widgets/TimerActivities.swift`), one per `key`.
- Plugin: `WatchBridge.clinicalActivityUpsert / clinicalActivityEnd` -> `CodeBlue/ClinicalActivityBridge.swift`.
- Widget: `ClinicalLiveActivity` in `ios/App/StewardMDWidget/TimerLiveActivities.swift`, registered in the bundle.
- **Lock Screen privacy**: counts, token numbers and timers only. Never a name, ID, bed, diagnosis or task text.
  `sanitize()` clips lengths as a backstop; the callers are the real guarantee.
- iOS only; web/Android/older builds are a silent no-op (method presence is checked).

## Gotchas (learned building it)
- **Never a document-wide non-passive touchmove** (iOS makes every scroll wait on JS). sheet-drag and
  pull-refresh attach theirs to the one element, for the one touch (same lesson as prep.js).
- **During a view transition the page hit-tests to `<html>`** for ~0.5s, so a second gesture right
  after a row tap lands nowhere. The update callback is capped at 180ms so taps never feel laggy.
  It does not use rAF (rendering is paused during the update phase; rAF stalls).
- New-screen content is often mid entrance-fade (syndromes-motion.js) when captured: heading matching
  ignores opacity.
- PrepNucleus sheets (`.pn-sheet-wrap`) have their own drag; sheet-drag skips them.
- Inside a bottom sheet, pull-down at the top dismisses the sheet; pull-refresh stands down there.
- long-press: the lifting finger's click is swallowed whatever its target (else it lands on the new
  backdrop and closes the menu instantly). Scroll cancels the hold only if it moves the row.
- Home tool grid keeps its own long-press (rearrange); excluded from previews and transitions.

## Tests
- `test/premium-motion-pure.test.mjs` - every module's pure seam.
- `test/run-premium-motion-ui.mjs` - the REAL app via index.html, 23 checks. Flicks are dispatched
  in-page (CDP round trips are ~70ms, too slow to be a flick).
