---
tags: [module, ui, native, motion]
status: BUILT, browser-tested on the real app (headless Chromium, touch emulation). Not yet seen on a handset. The Live Activity Swift (plugin + widget) is written but NOT compiled in this session (no toolchain in the cloud container) - needs a native rebuild.
flag: one kill switch per module, all default ON except sounds - localStorage smd_sheet_drag, smd_sheet_depth, smd_view_tx, smd_page_motion, smd_large_title, smd_pull_refresh, smd_picker_haptics, smd_skeletons, smd_peek, smd_live_activity, smd_swipe_actions, smd_tab_indicator, smd_status_top, smd_az_scrub, smd_kb_aware, smd_undo, smd_blur_up, smd_launch_morph, smd_sound_module = "0". Sounds are OFF until `smd_sound=1` (Settings > Display & Accessibility > Sounds)
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
| `page-motion.js` | (2026-10-28) any full-screen page/module that is a direct child of body rises+fades in and fades down on close, instead of popping; a tapped Back control cross-fades | class/hidden/style flip to `display:none` is re-shown inline for a 190ms exit; a REMOVED node gets an inert, id-less copy (no iframes/video/scripts, `data-pm-ghost`). Never adds an entrance to a page that animates its own (CSS transition/animation); skips splash/intro/sign-in gates and anything dialog-motion.js owns. Kill switch `smd_page_motion` |
| `live-activities.js` + Swift | ICU task deadline / OPD consult on the Dynamic Island and Lock Screen, clock ticking natively | `SMD_liveActivity.upsert/end`, called from icu.js `grpLiveActivity()` and queue.js `liveActivity()` |

## Round 2 (same day)
| Module | What the doctor feels | Notes |
| --- | --- | --- |
| `swipe-actions.js` | swipe a row left: its own buttons (up to 3) slide out, haptic when it locks; tap one to press the real control | **A swipe never fires an action by itself** (a stray swipe must not discharge or delete anyone). Skips the left 28px (edge back), h-scrolling lists, home grid. Destructive labels (remove/delete/cancel...) are red |
| `tab-bar.js` | tab bar indicator + re-tap to top; tap the status bar to scroll the topmost list to the top | The tabs are LAUNCHERS, so "selected" = last opened this session (sessionStorage `smd_tab_sel`): a 20x3 pill slides (spring) under it, `aria-current` set; re-tapping it while home is scrolled >60px scrolls home to the top and swallows the launch (at the top it launches as before). Positioned by layout offsets, not rects (sheet-depth scale skews rects). Status tap = Capacitor's `statusTap` event (+ a tap in the top 20px). **statusTap is unverified on a handset** |
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

## Touch targets (audit 2026-10-12)
The home header icons are 34x36 (redesign-system.css `.rnav-head .rds-icon-btn`, deliberately narrow so five fit) and the legal footer links were 14px tall. Their HIT area now grows with an invisible `::before` (`::before` because the bell dot owns `::after`); visible size and layout unchanged. Adjacent header icons share the gap, so a middle icon is about 37-42pt wide, not a full 44.


- 2026-10-13: hide-on-scroll for the home tab bar REMOVED at the owner's request (the bar always stays). Do not re-add.

## Motion 3 (2026-10-31, smd-motion.js, switch `smd_motion3` = "0")
Owner: "any transition in app should have good motion, slide up down or anything premium, new, unique". `npx motion-ai`
was NOT run: it installs agent skills and hosted MCP servers into the coding agent's config and changes nothing in the
app; Motion itself was already vendored (`assets/vendor/motion.min.js`, dialogs) and stays.
- `smd-motion.js` (`window.SMD_MOTION`, loaded before page-motion.js): springs sampled into CSS `linear()` easings and run
  with Web Animations (a synchronous first frame: no Motion late-start flicker); presets open [340, 28] (about 2%
  overshoot), push [340, 38], settle [420, 34]; cubic fallback without `linear()`.
- Open from a tile or row (pointerdown within 700 ms): the page GROWS OUT OF IT (clip-path from the tile's rect, scale
  .96 to 1 on the open spring, a 160 ms fade) and shrinks back into it on close if the tile is still where it was; with no
  source it rises 6% on the spring and sinks on close.
- In a module: a new screen slides 44 px from the right, or from the left after a Back tap (replaces the View Transition
  cross-fade while Motion 3 is on), and its list rows settle 28 ms apart.
- PrepNucleus push and pop (prep.js ghost + prep-motion.js nav): iOS style, the new body from the right edge, the old one
  drifting a third left and fading; on a pop the old one slides off right over the returning one with an edge shadow.
  Tabs stay a cross-fade; reduced motion stays a fade.
- Bug fixed on the way: page-motion.js exitGhost's loop variable shadowed its page state, so a removed page never knew
  where it opened from.
- Tests: `test/smd-motion.test.mjs`, `test/run-smd-motion-ui.mjs` (morph in and out, rise, Back and forward slides, row
  stagger, reduced motion, switch off). Known: `test/run-prep-feel-ui.mjs` "back returns to where home was left" fails on
  this branch before Motion 3 too (home is 74 px further down on return); not investigated yet.

### No cross-fades (2026-10-31, owner: "I dont want cross fade it looks ugly")
Everything travels; nothing dissolves (reduced motion keeps its short fade; `smd_motion3 = "0"` keeps the old motion).
- **Push / pop** (`SMD_MOTION.push`): the leaving screen is clipped at the incoming screen's moving edge (both on the same spring) instead of fading. Used by PrepNucleus (`prep.js` ghost) and by in-module swaps (`page-motion.js pushX`, which lays a copy of the removed screen, ids stripped, over the new one's place).
- **Tabs** (`SMD_MOTION.tabDir` + `page`): pointerdown on a tab or segment records its side against the current one; PrepNucleus pages the body sideways (`prep.js` makes a ghost for nav 0 when a side is known). No side (filter, exam picker): `nudgeUp`, a 22 px spring rise.
- **Pages with no source tile** and **full-screen dialogs** (`dialog-motion.js` "fade" family) slide up from the bottom edge and back down.
- **Whole-screen View Transitions** (row taps in `view-transitions.js`, Back in `page-motion.js` with `html.smd-vt-back`): root push/pop slide, CSS injected by `smd-motion.js`. `page-motion.js` stays off while one runs (`vtBusy`, `window.__smdVtAt`).
- Gotcha fixed: the PrepNucleus ghost carries `data-no-motion`, else page-motion treated it as a page opening and animated it in.
