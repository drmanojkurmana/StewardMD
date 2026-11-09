# Gestures audit — StewardMD app (branch gestures-global)

Standard: `/Users/mkk/.claude/skills/gestures/SKILL.md` + `animation-performance`.
Rules key: **T**=1:1 track, direct `transform` on dragged el, no per-move layout/state ·
**E**=rubber-band ~0.2 at edges · **R**=release spring/transition seeded with release velocity,
dismiss on ~40-50% distance OR flick, fast snap-back · **I**=interruptible (no `@keyframes` on
gesture-touchable el; catch mid-flight, no jump) · **L**=linked scrim/backdrop from drag progress ·
**S**=spatial (exit = entry direction); bounce only after drag, small · **H**=hold linear, fast
ease-out cancel · **TA**=`touch-action` for axis, targets >=44x44, hover gated
`@media (hover:hover) and (pointer:fine)` · **C**=interactive children / inner scroller must not
start drag; sheet scrolls first, drags from scrollTop 0 · **RM**=`prefers-reduced-motion`: tracking
stays, fling/bounce removed, brief settle.
Verdicts below are from code inspection only. Nothing was verified on a device.

## Shared primitives (fix here reaches every caller)

| Surface | Tier | T | E | R | I | L | S | H | TA | C | RM | Planned fix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [smd-spring.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/smd-spring.js:1) shared spring + velocity tracker | A (infra) | n/a | n/a | P (seeded `velocity`) | P (`animate()` returns stop fn) | n/a | n/a | n/a | n/a | n/a | P (reduced -> jump to end) | None. Callers must keep the stop fn (below). |
| [sheet-drag.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/sheet-drag.js:1) generic bottom-sheet drag | A | P (direct transform, transition none) | P (`rubber()` sqrt past top) | P (28% or flick >700px/s, spring seeded) | **F**: spring stop fn discarded; a new touch mid-settle fights the running rAF spring | P (scrim opacity + home depth from `y/h`) | P (down = entry) | n/a | **F**: no `touch-action` set on sheet/handle; relies on preventDefault after 6px | P (NO_DRAG children; scroller scrolls first, drag only dy>0 at scrollTop 0) | P (via SMD_SPRING jump) | Keep spring stop; cancel it on new touchstart and on drag activation. |
| [swipe-actions.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/swipe-actions.js:1) row swipe-to-reveal | A | P | P (`offset()` sqrt past tray width) | P (40% or flick <-420px/s, spring seeded) | **F**: same discarded stop fn; `closeOpen` spring not cancellable by a new drag on that row | P (tray clip from revealed px) | P (left reveal, tap action only; full swipe never fires) | n/a | P (row >=44px enforced in `rowish`) | P (excludes inputs/carousels/edge 28px) | P (close jumps if reduced) | Keep spring stop; cancel on new touch / re-drag. |
| [swipe-back.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/swipe-back.js:340) left-edge swipe-back | A | P (direct transform) | n/a (0 clamp at edge) | **F**: settle is fixed `.26s` CSS curve, not seeded with release velocity `vx` (commit decision does use vx) | P (CSS transition retargets; touchcancel slides back, no action) | n/a | P (right = back direction; Android system back untouched in meaning) | n/a | **F**: universal back button is 38x38 (<44) | P (skips h-scrollers that can consume, interactive-child scan) | **F**: settle animation not shortened under reduced motion | Seed settle duration from `vx`; enlarge back button to 44x44. |
| [pull-refresh.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/pull-refresh.js:1) pull-to-refresh | A | P | P (`resist()` exponential cap 150) | **F**: release velocity never measured; `springTo(st,to,0)` always passes v=0 | **F**: spring stop discarded; new pull during settle fights rAF | P (spinner from pull px) | P (down pull, springs home) | n/a | P (scrollTop 0 only; sheet layers excluded) | P (inputs/canvas excluded; sheet wins at top) | P (via SMD_SPRING) | Track velocity with SMD_SPRING tracker; seed release spring; keep+cancel stop. |
| [toast.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/toast.js:1) bottom toast swipe-down | A | P (pointer capture, direct transform) | P (`dampen()` against entry edge) | **F**: dismiss decision uses velocity (0.11px/ms flick) but exit transition is fixed 150ms, not velocity-seeded | P (transitions only, retargets; no keyframes on toast) | n/a | P (down = entry edge, `OFF` below bottom) | n/a | P (`touch-action:none`) | P (extra pointers ignored) | P (fade only) | Seed exit duration from swipe speed in `attachSwipe` end path. |
| [dynamic-notify.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/dynamic-notify.js:1) Dynamic-Island notify | A | P (finger writes spring state directly) | P (`dampen()` away from island) | P (spring keeps `vy`; flick -380px/s dismisses) | P (springs retarget; new notify morphs) | P (card+content clip from one spring state) | P (up = toward island it came from) | n/a | P (`touch-action:none`, pointer capture) | P (action button remembered via downEl) | P (`still()` jumps) | None. |
| [long-press-preview.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/long-press-preview.js:1) hold-to-preview | A | n/a (no drag) | n/a | n/a | P (transitions) | P (backdrop opacity transition) | n/a | **F**: hold sink uses `cubic-bezier(.4,0,.2,1)` over HOLD_MS-150, not linear; cancel is .2s drawer curve (should be fast ease-out) | P (rows >=44px) | P (inner control press belongs to control; scroll of own row cancels) | P (no sink/open motion) | Make hold sink linear; cancel stays fast. |
| [az-scrubber.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/az-scrubber.js:1) A-Z edge scrubber | A | P (pointer capture, direct pick) | n/a (clamped index) | n/a (scrub, no fling by design) | P | P (bubble follows y) | n/a | n/a | **F**: strip is 22px wide (<44 hit target) | P (only when chip row exists) | n/a | **F (perf)**: `getBoundingClientRect()` on every `pick()` (per move). Cache rect at pointerdown; widen hit area to 44px keeping letters centred. |
| [smd-motion.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/smd-motion.js:1) page/tab motion language | A (not finger-driven) | n/a | n/a | P (spring curves sampled to CSS `linear()`, WAAPI) | P for pages (WAAPI retarget); `@keyframes` only on `::view-transition` snapshots, which no finger can grab - accepted | n/a | P (push/pop share axis) | n/a | n/a | n/a | P (view-transition anims disabled) | None. |
| [native-feel.css](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/native-feel.css:1) app-wide touch behaviour | A (infra) | n/a | P (`overscroll-behavior:none` on page) | n/a | n/a | n/a | n/a | n/a | **F (partial)**: sets `touch-action:manipulation` on controls but no axis-specific rules and no 44px helper; hover gating is per-component, not global (cannot be global without breaking components) | n/a | n/a | Left as-is: axis `touch-action` belongs to each gesture surface (done there); a global hover reset would change unrelated screens. Noted, not fixed. |
| [image-viewer.css](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/image-viewer.css:1) + prep-viewer.js pinch/pan viewer | A | P (pointer capture in prep-viewer.js:160, direct transform) | **F (accepted)**: pan clamps hard at edges, no rubber-band. Changing image-pan edges risks fighting pinch; left, listed here. | n/a (no fling by design; double-tap zoom toggles) | P | n/a | n/a | n/a | P (`touch-action:none`, controls 44px, hover gated, reduced-motion kills transitions) | P (buttons are controls, stage is pan) | P | None. |
| [fig-viewer.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/fig-viewer.js:394) figure pinch/pan (`.smdz`) | A | P (direct transform per touchmove) | F (accepted): hard `clamp()`, no rubber-band, no momentum - figure must stop where the finger stops to stay aligned with its readout | n/a | P | n/a | n/a | n/a | P (`touch-action:pan-y` at 1x, `none` when zoomed, 44px zoom buttons) | P (control buttons excluded from pan) | n/a | None (exact-stop is the safer read for teaching figures). |

## Feature files

| Surface | Tier | Finding | Planned fix |
|---|---|---|---|
| [prep.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep.js:2933) `.pn-sheet` drag (own impl, excluded from sheet-drag.js) | A | Mostly P: pointer capture, 1:1, scrim linked, velocity from 100ms history, dismiss 30%/flick, WAAPI settle. **F-I**: the WAAPI dismiss/settle animation is never cancelled if a new pointerdown starts on the sheet mid-flight. | Store the WAAPI animation; cancel on next pointerdown. Behaviour identical otherwise; not migrated to sheet-drag.js (different scrim/close wiring). |
| [prep-flash.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep-flash.js:426) flash-card swipe-to-grade | A | P: pointer capture after 8px intent, 1:1 paint, down-drag damped x0.2, grade on swipe via `swipeGrade` (distance+time), settle via PREP_MOTION. Edge start <28px yielded to swipe-back. | None. |
| [connect-agent-onboarding.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/connect-agent-onboarding.js:417) onboarding sheet drag | A | Exemplary: cancels `S.anim` on pointerdown (catch mid-flight), rubber-band above 0, velocity-projected dismiss 35%/60%, bounce only with velocity (`hadVelocity`). | None - reference implementation. |
| [home.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/home.js:1907) tool-grid long-press reorder + `#hvSheet` (via sheet-drag.js) | A | Sheet inherits sheet-drag fix. Reorder: `touch-action:none` in reordering, drag handle present; jiggle uses `@keyframes rnavJiggle` on tiles - tiles are gesture-touchable while reordering, but the jiggle animates the tile box, not the dragged transform path; removing it is a visual change. Left, flagged. | None beyond sheet-drag. |
| [queue.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/queue.js:586) + [opd-emr.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/opd-emr.js:5358) slide knob (advance/confirm) | A | Drag-to-confirm: 1:1 knob, threshold-only release is correct for a confirm (no dismiss velocity needed); uses touch+mouse, document listeners, no pointer capture (mouse/touch only). Adding Pointer Events risks changing EMR behaviour. | None. Noted: no rubber-band past end (hard clamp) - acceptable for a confirm track. |
| [prep-viewer.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep-viewer.js:160) | A | See image-viewer.css row. Pass. | None. |
| [prep-lessons.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep-lessons.js:778) compare slider / lesson stages, [prep-rad.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep-rad.js:167), [specialty-stage.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/specialty-stage.js:54), [atlas.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/atlas.js:1376), [oncotree.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/oncotree.js:1873), [kb-flowchart.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/kb-flowchart.js:282) | A/B boundary | Pointer-capture pan/zoom/scrub stages: direct transforms, exact stop. These are reading/measurement-adjacent (radiology, trees, flowcharts): no momentum or rubber-band added on purpose. | None. Listed so the omission is a decision, not a miss. |
| [prep-tide.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep-tide.js:164) | A | Scroll-driven reveal (pointerdown only wakes); no drag surface. | None. |
| [icu.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/icu.js:1406) swipe card (`touch-action:pan-y`, touchstart at :9737) | A | Vertical scroll preserved by touch-action; horizontal swipe handled by row logic + shared swipe-actions. Keyframes present are spinners/thinking indicators, not gesture-touchable. | None. |
| [maik-companion.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/maik-companion.js:321) | A | Draggable companion uses `touch-action:pan-y`; its `@keyframes` are decorative (rise/pop/eq), not the drag path. Drag itself not audited as velocity-based; it is a free companion, not a dismiss surface. | None. |
| [prescription.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prescription.js:2794) signature canvas | **B** | Drawing must land exactly under the finger. `touch-action:none` correct. No feel changes. | None. |

## Tier B - clinical / measurement (no feel changes; bugs only if output values unchanged)

| Surface | Finding |
|---|---|
| [tokos-calipers.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/tokos-calipers.js:1), tokos-clinic-us.js, kardia-*.js (echolab/sim-measure/sim-probe/syncprobe), codeblue-ecg.js, ward-dicom-viewer.js, narke-vent*.js, ophthalmos-*-stage/measurement stages | Pointer/touch measurement: values must equal finger position exactly. No momentum, rubber-band or easing added. No wrong-`touch-action` or missing-capture bug found that can be fixed without risking output values; left untouched and listed here per tier rule. |
| prescription.js signature (above) | Same: exact-stop drawing. Untouched. |

## Search coverage

Searched the repo (excluding `scrollcraft/`, `kardia/angiolab/assets/`, `vineela-koushik/`,
`.claude/`, `*.min.js`) for `touchstart|touchmove|pointerdown|pointermove|setPointerCapture|touch-action`
and hand-rolled sheets/drawers not using sheet-drag.js. Extra hits beyond the lists above are
scroll listeners, carousels with native scroll, and the Tier B tools; no additional Tier A drag
surface was found that is not in the tables.

## What changed (finish)

- [sheet-drag.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/sheet-drag.js:133): release-spring stop fn is now kept and cancelled on the next touch; a caught sheet resumes from its painted `translate3d` offset (`g.base`), so catching mid-close has no jump. Dismiss decision now uses total travel including that base.
- [swipe-actions.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/swipe-actions.js:74): same spring-stop handling; `closeOpen` starts from the row's current painted offset instead of assuming `-w`; a re-drag starts from the caught offset.
- [pull-refresh.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/pull-refresh.js:80): release velocity is now tracked (SMD_SPRING tracker on the resisted pull) and seeds both the snap-back and the hold springs; in-flight spring is cancellable by a new touch.
- [swipe-back.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/swipe-back.js:345): settle duration is seeded with release velocity (`settleMs`, 110-300ms, distance/speed); universal back button enlarged 38px to 44px. Back meaning, commit rule and Android system-back handling unchanged.
- [toast.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/toast.js:40): swipe exit duration is seeded with swipe speed (`exitMs`: flick 90ms, medium 120ms, slow 150ms default).
- [az-scrubber.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/az-scrubber.js:30): strip hit width 22px to 44px (letters centred, same look); strip rect cached at pointerdown instead of a layout read per move.
- [long-press-preview.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/long-press-preview.js:141): hold sink is now `linear` (time passing honestly); cancel timing unchanged.
- [prep.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep.js:2925): the sheet's WAAPI dismiss flight is stored, `commitStyles()` + cancelled when the sheet is caught again; the deferred close is suppressed after a cancel. No migration to sheet-drag.js (different scrim/close wiring; behaviour preserved).
- Cache-busts: `?v=` tokens bumped in [index.html](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/index.html:2353) for every edited file, prep loader `prep127` to `prep128` ([prep-loader.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/prep-loader.js:36)), and the `CACHE` name in [sw.js](/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/gestures-global/sw.js:16) gained `-gest1`.

## What was left, and why

- native-feel.css global hover/axis rules: axis `touch-action` belongs to each surface (already set there); a global hover reset would restyle unrelated screens. No visual redesign in this job.
- image/figure pan rubber-band (image-viewer, fig-viewer): hard clamp kept; exact stop is safer for reading figures, and pinch/pan edge physics risks misalignment with readouts.
- home.js reorder jiggle `@keyframes rnavJiggle`: animates tiles while reordering but not the dragged transform path; removing it is a visual change, out of scope.
- queue/opd-emr slide knobs: threshold-only confirm release is correct for a confirm control; Pointer Events migration would risk EMR behaviour for no output change.
- pull-refresh spinner `@keyframes smdPtrSpin`: decorative rotation of a non-dragged indicator, not a gesture-touchable element. Accepted.
- Tier B clinical/measurement tools: untouched by design (exact finger stop). No bug fix was safe without risking read values.
- smd-motion.js view-transition `@keyframes`: they animate transition snapshots no finger can grab. Accepted.

## Verification

- `node --check` on every edited JS file: pass.
- `node --test test/gestures-pure.test.mjs test/toast-swipe-pure.test.mjs`: 13 pass, 0 fail (new assert-based tests for dismiss/lock/commit thresholds, rubber-band maths, velocity-seeded settle/exit durations).
- `npm test` (full suite, 1496 test files): started, produced no output and did not finish within ~10 minutes in this sandbox; stopped. Targeted suite instead: `node --test test/gestures-pure.test.mjs test/toast-swipe-pure.test.mjs test/premium-motion-pure.test.mjs test/prep-nav.test.mjs test/prep-app.test.mjs test/opd-profile-sheet.test.mjs` - 77 pass, 0 fail. Full-suite green is unverified.
- Headless harness `node test/run-swipe-back-ui.mjs`: harness error before any assertion (`webSocketDebuggerUrl` undefined - Chrome/CDP did not start in the sandbox). UI behaviour is therefore unverified in a browser harness; code-level checks only.
- Nothing was verified on a device. No phone, simulator or WebView run was performed.

## Real-phone checklist (try by hand on the phone)

1. Open any bottom sheet (home More, MaiK, a module sheet). Drag it down slowly past a third and release: it dismisses. Drag a little and release: it springs back fast. Flick it down from near the top: it dismisses on the flick.
2. While a sheet is closing, catch it mid-slide and drag it back up: it should continue from where it visually was, with no jump.
3. In a sheet with a long list, scroll the list first; only at scrollTop 0 should a downward drag move the sheet.
4. Swipe a list row left: tray locks past 40% or on a flick; catch a closing row mid-slide and re-drag it.
5. Pull to refresh on Ward Sync / queue / OPD dashboard: pull past the line (haptic tick), release with a downward flick and with a slow drag; both should settle without a jump.
6. Swipe a toast down: a flick dismisses faster than a slow drag. Repeat with Dynamic Island notifications enabled (swipe up toward the island).
7. Left-edge swipe back on a non-home screen, once slowly and once as a fast flick; then catch the sliding screen with a second touch. At home, the same swipe still opens the menu. Check the round back button is easy to tap (44px).
8. A-Z scrubber in the Drug Database: slide the right-edge strip; letters tick without lag and the strip is easy to hit.
9. Long-press a ward/queue row: the row sinks steadily (linear) and the menu appears; release early and it cancels quickly.
10. PrepNucleus: drag a `.pn-sheet` down to dismiss, catch it mid-dismiss and pull it back; flash cards: swipe to grade, drag down slightly (damped) and release to snap back.
11. With `prefers-reduced-motion` on (system setting): sheets still track the finger, but settle briefly with no fling or bounce.
12. Tier B spot check: calipers / ECG / DICOM / signature still land exactly where the finger stops, unchanged.

## Compliance notes (standing UI rules)

Palette/layout/copy unchanged by this job (no visual redesign). Fixes touch only timing,
velocity, hit size (az strip width, back button 44px) and cancellation - no colour, gradient,
glow or backdrop changes. 390px width, light/dark, focus and reduced-motion paths are inherited
from the existing primitives and re-checked in the finish pass.
