---
tags: [module, ui, native, motion]
status: BUILT, browser-tested on the real app (headless Chromium, touch emulation). Not yet seen on a handset. The Live Activity Swift (plugin + widget) is written but NOT compiled in this session (no toolchain in the cloud container) - needs a native rebuild.
flag: one kill switch per module, all default ON except sounds - localStorage smd_sheet_drag, smd_sheet_depth, smd_view_tx, smd_large_title, smd_pull_refresh, smd_picker_haptics, smd_skeletons, smd_peek, smd_live_activity, smd_swipe_actions, smd_tabbar_hide, smd_status_top, smd_az_scrub, smd_kb_aware, smd_undo, smd_blur_up, smd_launch_morph, smd_sound_module = "0". Sounds are OFF until `smd_sound=1` (Settings > Display & Accessibility > Sounds)
---
# Premium Motion (iOS-like interaction layer)

Owner, 2026-10-12, after [[Dynamic Notifications]]: "Any more similar adaptations to make app more
premium" then "Do all", twice: round 1 (eight modules, table below) and round 2 (eight more, "Round 2"). Additive modules, each generic (works over existing screens with no
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

## Round 2 (same day)
| Module | What the doctor feels | Notes |
| --- | --- | --- |
| `swipe-actions.js` | swipe a row left: its own buttons (up to 3) slide out, haptic when it locks; tap one to press the real control | **A swipe never fires an action by itself** (a stray swipe must not discharge or delete anyone). Skips the left 28px (edge back), h-scrolling lists, home grid. Destructive labels (remove/delete/cancel...) are red |
| `tab-bar.js` | home tab bar slides away scrolling down, returns scrolling up; tap the status bar to scroll the topmost list to the top | The tabs are LAUNCHERS (no selected tab), so no indicator / re-tap-to-top. Status tap = Capacitor's `statusTap` event (+ a tap in the top 20px). **statusTap is unverified on a handset** |
| `az-scrubber.js` | a letter strip on the Drug Database: slide to jump, tick + big letter bubble | Presses the app's own `.db-az` chips. The Drug Database IGNORES a chip press while loading the previous letter, so the press waits for a 220ms rest or the release and retries until it takes |
| `keyboard-aware.js` | the focused field glides into view; a bar pinned to the bottom rides above the keyboard; `--smd-kb` published | Acts only on what is STILL covered 450ms after the keyboard appears, so onboarding / PrepNucleus / phone-verify / profile-setup / reasoning (which handle it themselves) are untouched; a bar that already has a transform or `data-kb-managed` is left alone. Needs `visualViewport`; no-op if the web view itself resizes. **Not verified with a real iOS keyboard** (tested with a stubbed visualViewport) |
| `undo.js` + card action | destructive local action runs, a Dynamic Island card offers **Undo** for 6s | `SMD_undo.run({message, perform, restore})` returns false when unavailable and the caller keeps its confirm(). **Only used for local, exactly-restorable data**: today only the antibiogram "Remove from this device". Queue patient removal, unit removal, ECG wipes, follow-up deletes stay as confirmations on purpose (server records / PHI / irreversible) |
| `blur-up.js` | an image still loading stays hidden, then fades from blur to sharp (decoded first) | There is no low-res preview file, so the "blur" is the reveal itself. Skips cached, tiny, logos, data: images. 8s safety unhide |
| `launch-morph.js` | the boot-splash logo flies onto the header logo | Only when the header logo is really visible (a first-run guest sees the intro poster over home, so nothing flies). Cross-checked with `elementFromPoint` |
| `sound.js` | soft synthesized ticks: bell for pushes, rising pair for success / task done, low thud for errors, tick at pull-to-refresh | **OFF by default.** Web Audio, no files, whisper gain. Plays from dynamic-notify (success/error/push), pull-refresh, ICU task done. No "message sent" sound: no clean hook exists in the MaiK send path. Whether it follows the iOS silent switch is **unverified on a handset** |

Lessons: `large-title.js` must retry a failed setup (a screen still animating in made it give up forever); dynamic-notify's action button needs the pointerdown target (pointer capture retargets pointerup to the card).

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
- `test/run-premium-motion-ui.mjs` - the REAL app via index.html, ~60 checks (round 1 + 2). The Drug Database
  waits on network calls that are slow in some sandboxes: the test polls (`waitFor`), never fixed sleeps. visualViewport is stubbed (no keyboard in headless). Flicks are dispatched
  in-page (CDP round trips are ~70ms, too slow to be a flick).
