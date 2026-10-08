# PrepNucleus: iPad, balloon celebrations, MaiK lines, Ask MaiK everywhere (plan)

Status: PLAN ONLY, 2026-10-09. Nothing here is built, merged or deployed. Base: origin/main ffea380f9 (PR #1398).
Owner request (2026-10-09): "make PrepNucleus module IPAD compatible. and three bits in line balloon confetti effect and
if module is cardiology then maik bot can come and say so you are next best cardiologist in making? (this is one example
you make many) create some lines as per the module and branch. think and plan and let subagent plan." Section 5 is the
owner's addition the same day ("Give Ask MaiK everywhere ... offline or online ... tell them straight away if their device
is not capable").

Standing rules (PrepNucleus-Plan2.md section 8) apply to every task below: no AI or source labels in the app, no emoji, no
em-dash in app text, motion on transform and opacity only, reduced motion respected, ES5 client style, owner UI skills
(ui-ux-pro-max, anti-ui-slop, impeccable, taste-skill, Emil skills, web-design-guidelines) loaded by whoever builds it,
no paid AI without a dry-run cost and the owner's yes.

How this plan was made: graphify was queried first (it returned nothing PrepNucleus-specific, so the code was read
directly). A Sonnet agent ran the existing headless harnesses at seven iPad sizes and dumped layout metrics; another
Sonnet agent traced the Ask MaiK paths and quota code; Haiku agents drafted the MaiK lines (two passes) and the Apple
device table. The lead checked the key claims against the code and screenshots and reviewed every line. Screenshots
(not in git): `$CLAUDE_JOB_DIR/tmp/prep-ipad-plan/shots/<p820|l1180|l1366|p507|p438|p375|p320>/` and the earlier
`$CLAUDE_JOB_DIR/tmp/setup-shots/*ipad*.png`. Caveat: neither audit agent loaded the owner's UI skills; the builder must
run the anti-ui-slop finish gate and web-design-guidelines before calling any of this done.

Effort key: S under 1 h, M 1 to 3 h, L over 3 h.

## 1. iPad compatibility

### 1.1 How width works today (the key finding)
- The app zooms the whole document: `home.js` `autoFitD()` (`home.js:10106`) sets `document.documentElement.style.zoom`
  from the window width (0.9 under 340 px, 0.95 under 400, 1.0 under 600, 1.08 under 900, 1.15 from 900). It runs at
  boot (`home.js:11505`) and on the Auto button (`home.js:10189`) only. No resize or rotation listener calls it, so an
  iPad that launches in Split View or rotates keeps its launch zoom (inferred from code; the resize test in 1.4 will
  prove it).
- Effective CSS widths: 820 becomes 759, 1180 becomes 1026, 1366 becomes 1188.
- The content column is `.pn-root .pn-body > * { max-width: 720px }` (`prep.css:88`), which renders 828 screen px at 1180.
  That is a sensible reading column; the problem is everything around it.
- Only phone breakpoints exist (`prep.css:427` max 359, `:702`/`:743`/`:1256` min 600, `:746` max 751, `:792` max 420,
  `:1220` min 700). No tablet or landscape layout.
- 145 px font declarations, no rem; Dynamic Type comes only from the app zoom plus `seedOSTextScale`. The viewport meta
  (`index.html:18`) has `maximum-scale=1.0, user-scalable=no`, which blocks pinch zoom.
- Already good: hover rules guarded by `(hover: hover) and (pointer: fine)` except `prep.css:1226`; safe-area padding on
  `.pn-root` (`prep.css:34`); keyboard in the runner (`prep.js:968`: A to D, 1 to 4, Enter, ArrowRight, ArrowLeft in
  timed tests; Escape to back at `prep.js:523`) and flashcards (`prep-flash.js:459-460`: Space or Enter reveal, 1 to 4
  grade); question grid auto-fills 52 px tiles; split view at 438 and 507 shows no layout break.

### 1.2 Changes per screen

| # | Screen and problem (evidence) | Change (file, selector) | Effort |
|---|---|---|---|
| 1 | All screens 820 and wider: the exam tabs and filter chips span the window while the content is a centred column (`shots/l1180/prep-home.png`: tabs 1143 px from x 18, column 828 px from x 176) | `prep.css:74` `.pn-root .pn-tabs` and `:76` `.pn-filters`: `width: 100%; max-width: 720px; margin-inline: auto` (keep the 16 px side margin under 752 px) | S |
| 2 | Home hero: the brand banner (`prep.css:928`, aspect 16/7) is about 360 px tall in landscape, readiness falls below the fold (`shots/l1180/prep-home.png`) | `@media (min-width: 700px)` banner height cap about 180 px (or aspect 16/4); `@media (orientation: landscape) and (max-height: 900px)` shrink further | S |
| 3 | Home tile groups (`prep.css:141`, `.pn-home > .pn-next + .pn-group`) and subject grid (`prep.css:164` `.pn-subs`, 2 columns) never go past 2 columns | At `min-width: 900px` (CSS px) widen home and subject bodies to about 1040 px (`.pn-home`, `.pn-subj` containers only, reading screens stay 720) and use `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` (3 at 820, 4 at 1180). Decision D1 | M |
| 4 | Subject and module lists: one long row per module across 828 px (`shots/l1180/prep-subject.png`) | `prep.css:191` `.pn-mods`: 2-column grid at `min-width: 900px` when the body is widened; `.pn-missed` stays one column | S |
| 5 | Practice setup sheet and every other `.pn-sheet`: a 720 px bottom sheet filling the iPad height; the Timer heading is clipped by the sticky action bar (`setup-shots/sheet-ipad-dark.png`); the Arena consent sheet is taller than 820 px and its Join button sits at the edge (`shots/l1180/social-consent-dark.png`) | `@media (min-width: 700px)`: `prep.css:284` `.pn-sheet-wrap { justify-content: center; align-items: center }`, `prep.css:286` `.pn-sheet { max-width: 560px; max-height: calc(100dvh - 64px); overflow-y: auto; border-radius: var(--pn-r-xl) }`, matching radius on the sticky `.su-act` (`prep-setup.css:51`) and the same for `.pl-sheet` (`prep-plan.css:50`). Entrance: the existing sheet spring in `prep-motion.js` (`translateY(100%)`) becomes `opacity 0 to 1, scale(0.96) to scale(1)` at this width. Split view under 700 px keeps the bottom sheet. Decision D2 | M |
| 6 | Runner question and feedback in landscape: stem on top, options below, empty right half; the explanation falls below the fold under the sticky Next row (`prep.css:1172`) (`shots/l1180/prep-question.png`, `prep-feedback.png`) | `@media (orientation: landscape) and (min-width: 900px)`: `.pn-qw` 2-column grid (stem and image left, options and feedback right, each column scrolls), body widened to about 1040. `.pn-q { max-width: 34em }` (`prep.css:1144`) stays. Image questions get the larger half for the image. Decision D5 | L |
| 7 | Lesson reader bottom bar spans the window with a 900 px Next button and the controls at the far left; wide figures are cut by the bar in landscape (`shots/l1180/lesson-dark-step4-table-wide.png`) | A: `prep.css:439` `.pn-lsn-bar`: inner content `max-width: 720px; margin-inline: auto` (bar background stays full width). B: `@media (orientation: landscape) and (min-width: 900px)`: `.pn-lsn-step` 2 columns (text left, `.pn-vis-image` figure right, figure `max-height: calc(100dvh - bar - header)` with `object-fit: contain`); tables (`.pn-xt`, `prep.css:1247`) stay full width under the text, not squeezed | A: S, B: M |
| 8 | Tap targets: `.pn-tab` and `.pn-chip` are 40 px (`prep.css:78`, `:80`); at 320 and 375 the app zoom (0.9, 0.95) shrinks 44 px icon buttons (`.pn-ib`, `prep.css:61`) to 40 and 42 px | `min-height: 44px` on `.pn-tab` and `.pn-chip` under `@media (pointer: coarse)`; in `home.js` `autoFitD()` never go below 1.0 when the window is an iPad split pane (or for widths 320 to 400 when `navigator.maxTouchPoints > 1` and the screen is large). Decision D10 | S |
| 9 | Rotation and Split View keep the launch zoom | `home.js`: call `autoFitD()` (debounced 150 ms) on `resize` and `orientationchange` when `ds.autoFit` is on; keep the user's manual choice otherwise. App-wide change, test in other modules too | M |
| 10 | Hover rule without `pointer: fine` (`prep.css:1226`, stack viewer) | add `and (pointer: fine)` | S |
| 11 | Keyboard on iPad with a Magic Keyboard | `prep.js:968` add `B` bookmark, `G` question grid, `Escape` closes an open sheet before going back; `:focus-visible` rings on `.pn-opt`, `.pn-btn`, `.pn-row`, `.pn-chip`, `.pn-tab` (2 px accent outline, offset 2 px); lessons: ArrowRight/ArrowLeft next/previous step, Space play/pause. A small "Keys" hint in the runner menu only when `(hover: hover) and (pointer: fine)` | M |
| 12 | Plan, social, stats screens at iPad width: partly unaudited (the social harness needs `prep/accuracy.json`, missing from the sparse tree; plan shots showed only the home) | audit during the build with the full tree; `.pl-hero` (`prep-plan.css:9`) is already 2 columns | S |
| 13 | Pinch zoom blocked (`index.html:18`) | app-wide, out of this plan's scope; flag to the owner (accessibility) | none |

Things checked and fine: question grid columns at all sizes, `.pn-seg4`, the heat map and calendar grids, split view 438
and 507, safe-area padding. The `ov:true` overflow readings at 320 to 507 are believed to be false alarms from the CSS
zoom (scrollWidth in CSS px against innerWidth); the new test measures it properly.

### 1.3 Order inside section 1
1, 2, 10, 8 (quick wins, one PR) then 5 (sheets) then 7A, 3, 4 then 9 (app-wide zoom) then 6 and 7B (landscape layouts)
then 11 (keyboard).

### 1.4 Tests
New `test/run-prep-ipad.mjs` (copy of `run-prep-ui.mjs`, viewport from env, `deviceScaleFactor: 1` to save disk).
Sizes 820x1180, 1180x820, 1366x1024, 507x820, 438x820, 375x1180, 320x820. Assertions:
1. No horizontal overflow: `Math.round(document.documentElement.scrollWidth * zoom) <= innerWidth + 1`.
2. `.pn-body > *` screen width at most `720 * zoom + 1` on reading screens; `.pn-tabs` and `.pn-filters` share the
   column's left edge within 1 px.
3. Column counts from `getComputedStyle(...).gridTemplateColumns` for `.pn-subs` and the home group: 2 at 507, 3 at 820,
   4 at 1180 (after D1).
4. Every `.pn-sheet` at 820 and wider is centred (`abs(left - (innerWidth - right)) < 2`), `max-width <= 600`, bottom
   edge inside the viewport, and its last button visible without scrolling the page.
5. Landscape lesson: figure bottom above the `.pn-lsn-bar` top; bar controls inside the 720 column.
6. Hit areas of `.pn-ib`, `.pn-chip`, `.pn-tab`, `.pn-opt` at least 44 screen px at every size.
7. Real `keydown` events: A to D answer, Enter next, B bookmark, Escape closes a sheet then backs out.
8. Resize: boot at 1180, set 507 with `Emulation.setDeviceMetricsOverride`, assert the zoom recomputes (fails today).
Existing harnesses keep their 390x844 runs unchanged. Screenshots for the owner: the same screens in light and dark at
820 and 1180, compared side by side with today's shots.

Section 1 effort: about 2.5 days (quick wins 0.5, sheets 0.5, grids and lists 0.5, zoom on resize 0.5, landscape runner
and lessons 1, keyboard 0.5, tests 0.5, overlapping).

## 2. Balloon celebration

### 2.1 What exists (origin/main ffea380f9)
- `prep-motion.js:212` `confetti(host)`: 28 pieces burst from the finish card and fall away in about 1.6 s; the layer is removed at 2.4 s. Triggered from the MutationObserver `scan()` at `prep-motion.js:149` when a `.pn-score`, `.pn-lsn-fin`, `.pk-end` or `.pn-lobby` card is painted and it is a battle win (`.win`), a lesson finish with `+XP`, or a ring at 70% or more. Public `PREP_MOTION.confetti(el)` at `prep-motion.js:293`.
- CSS `prep.css:629-630` (`.pn-confetti`), hidden under reduced motion at `prep.css:650`. Finish cards keep their content above effects via `prep.css:219`.
- Off-screen pausing exists for the sparkle layer (`.pn-fx`, `IntersectionObserver` in `attach()`, `.pn-off` at `prep.css:516`).
- Milestone data already in the store: day streak (`CORE.streak`, milestones `S_MILES = [7, 30, 100]` at `prep-nudges.js:28`), question milestones (`Q_MILES = [100, 500, 1000, 2500, 5000, 10000]`), level (`levelOf(xpOf(store))` at `prep-plan.js:169-180`, ranks Fresher, Intern, Resident, Registrar, Consultant), finished mocks (`store.mh`, pushed at `prep.js:1017`), today's plan progress (`itemProgress` at `prep-plan.js:154`).

### 2.2 Which moment gets what
Rule: balloons are rare and mean "a milestone in your journey"; confetti stays for "a strong result right now". One effect per moment, balloons win if both qualify. At most one balloon release a day, except a level-up.

| Moment | Effect | Frequency in practice |
|---|---|---|
| Battle win (Arena) | confetti (unchanged) | per battle |
| Practice set at 70% or more | confetti (unchanged) | per set |
| Lesson finished with XP | confetti only for the FIRST lesson ever and the first lesson of each day (today it fires on every lesson with +XP; trim it) | at most daily |
| Level-up (new level number) | balloons | about 10 times in a year |
| New rank (Intern, Resident, Registrar, Consultant) | balloons, 2 more balloons than a level-up | 4 times ever |
| Day streak reaches 7, 30, 100 (and every 100 after) | balloons | rare |
| Question milestones 100, 500, 1000, 2500, 5000, 10000 | balloons | 6 times ever |
| First mock exam finished ever | balloons | once |
| Today's plan finished | balloons the first time ever, then the existing plain "Today's plan is done" text only | once |
| Practice setup, an answer, a card flip, a tab, a bookmark | nothing | never celebrate frequent actions |

### 2.3 The effect
- 7 balloons on a phone, 9 when the host card is wider than 600 px (iPad). Each balloon is a `span.pn-bl > i` pair: the outer span rises, the inner `i` wobbles. Shape is pure CSS (`border-radius: 50% 50% 47% 53% / 58% 58% 42% 42%`, a small radial highlight via `background-image`, a 1 px string as `i::after` with `transform-origin: top`). No emoji, no text, no images, no SVG paint animation.
- Colours: the existing confetti `HUES` minus white, at 0.92 opacity, so they read on both themes.
- Rise: `translate3d(x, 0, 0)` from just below the card to `translate3d(x + drift, -(cardHeight + 120) px, 0)`, 2.6 to 3.4 s each, ease `[0.33, 0, 0.2, 1]`, staggered 0 to 360 ms. Opacity 0 to 1 in the first 8%, 1 to 0 in the last 15%.
- Wobble ("light spring"): the inner element runs `rotate(-5deg) translateX(-4px)` to `rotate(5deg) translateX(4px)` alternate, 1.1 to 1.5 s, `ease-in-out`, infinite until removed. A true spring is not needed for a looping sway; a damped settle is used only on the first 400 ms (`{ type: "spring", visualDuration: 0.4, bounce: 0.35 }` from `rotate(0deg) scale(0.6)` to `scale(1)`) when Motion is loaded.
- Engine: WAAPI (`el.animate`) like `nav()` already does, so it works even when the vendored Motion build has not loaded; Motion only adds the pop-in spring. Transform and opacity only, compositor-friendly, `will-change: transform` set on create and cleared on removal.
- Budget: the burst starts within 300 ms of the finish card painting (it waits for the card's own POP spring, delay 120 ms); DOM creation is 9 nodes (under 2 ms); `pointer-events: none` so Done and Retry are tappable at once; the layer is removed at 3.8 s or on `detach()`/navigation, whichever is first.
- Pausing: the host is added to the existing `io` observer; when `.pn-off` is set the balloon animations are paused (`a.pause()`) and resumed on return; `visibilitychange` hidden pauses them too.
- Reduced motion: nothing is created (same guard as `PREP_MOTION.confetti`); the milestone itself is still said in words on the card (for example a chip "Level 6" or "30 day streak"), so nobody loses the information. CSS `@media (prefers-reduced-motion: reduce) { .pn-root .pn-balloons { display: none; } }` as a second guard.
- Haptic: `haptic("success")` once (already fired by the finish card; do not double fire).

### 2.4 Where it hooks
1. `prep-motion.js`: add `function balloons(host, n)` next to `confetti()`, export `PREP_MOTION.balloons(el)` with the same guards. In `scan()` at line 149: `if (n.getAttribute("data-cele") === "balloons") balloons(n); else if (<existing confetti test>) confetti(n);`. Also scan `.pl-hero` (plan screen) for `data-cele`.
2. `prep.js`: a small `milestones(before, after)` helper. Before a run starts, keep `{ lv, streak, qTotal, mocks }` from the store on `st.run.m0`; in `renderResult()` (`prep.js:1029`) and the lesson finish, compute the same after `save()`, and if a milestone was crossed and today's balloon budget is free, add `data-cele="balloons"` and the milestone chip to the `.pn-score` section. Record `store.cel = { day, keys: [...] }` so the same milestone never fires twice (sync-safe: keys like `lv6`, `st30`, `q500`, `mock1`, `plan1`).
3. `prep-plan.js`: when the plan list renders with every item done and `cel` has no `plan1`, add `data-cele` to `.pl-hero`.
4. `prep-arena.js`: unchanged (confetti on win).
5. CSS in `prep.css` next to `.pn-confetti` (line 629): `.pn-balloons`, `.pn-bl`, `.pn-bl > i`, string pseudo element, the reduced-motion guard, and add `:not(.pn-balloons)` to the z-index rule at line 219.

### 2.5 Tests
- `test/run-prep-ui.mjs`: stub a store at level boundary (XP 299 to 300), finish a 5-question set, assert `.pn-score[data-cele=balloons]` and `.pn-balloons > .pn-bl` count 7 at 390 px and 9 at 820 px; assert all running animations on `.pn-bl` only touch `transform`/`opacity` (`el.getAnimations().every(a => a.effect.getKeyframes().every(k => Object.keys(k).every(p => ["transform","opacity","offset","easing","composite","computedOffset"].includes(p))))`); assert the layer is gone after 4 s; assert no confetti on the same card.
- Reduced motion: `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce`, assert no `.pn-balloons` and the milestone chip text is present.
- Second finish the same day with another milestone: no balloons (budget), except a level-up.
- Off screen: scroll the card out, assert `getAnimations()[0].playState === "paused"`.
- Effort: M (3 to 4 h including tests and screenshots).

## 3. MaiK lines per subject

### 3.1 What the owner asked
After a set in a subject, MaiK says one short warm line that fits it. Owner's example for cardiology: "You are the next best cardiologist in the making." "Module" in the owner's words means the subject (Cardiology); "branch" is the taxonomy branch (`mbbs` for NEET-PG and INI-CET, `ss-medicine` for NEET-SS). The taxonomy on origin/main has 19 MBBS subjects and 15 SS subjects (including `ss-radiology`), 34 in all.

### 3.2 Data format
`prep/maik-lines.json` (static, cached like `prep/taxonomy.json`, which `prep.js:280` loads from `STATIC`). Draft at `vault/plans/PrepNucleus-maik-lines.draft.json` on this branch (copy into `prep/` only after the owner approves the words).

```
{ "v": 1,
  "branch":  { "mbbs": [3 lines], "ss-medicine": [3 lines] },     // mixed-subject sets, mocks, Custom across subjects
  "subject": { "<subject id from taxonomy.json>": [3 lines], ... },
  "module":  { "<module id>": [lines] }                             // optional overrides, empty for now
}
```
Lookup order: `module[moduleId]`, then `subject[subjectId]` (via `PREP.subjectOfModule`), then `branch[branchId]`, else no line. Unknown ids show nothing (never a generic filler).

### 3.3 Rotation and frequency
- At most one line per app session: an in-memory flag in `prep.js` (`st.mlShown`), plus `sessionStorage` in try/catch so a reload in the same session does not repeat it.
- Next line each time for that subject: counter `store.ml[subjectId]` in `smd_prep_v1` (sync-safe small integer; `prep-sync.js` merges unknown keys as last-writer-wins, check during build), wraps around.
- Only after a set with at least 5 answered questions. Never in the runner, never on a wrong answer, never in Arena battles (they have their own result moment), never in mocks (cross-subject and high stakes; use nothing).

### 3.4 Where it shows
- Set result screen: `renderResult()` at `prep.js:1029`, a single row under the `.pn-score` card: the MaiK mark (reuse the existing MaiK avatar used in `home.js`; check its asset path during build) and the line in body text, `role="status"` so screen readers announce it once. No label like "AI" or "MaiK says"; just the mark and the line. It is a plain sentence, not a button.
- It shows for any score, so lines never claim a result. That is why every line is about growth and effort, not about this set.
- Lesson finish card (`.pn-lsn-fin`): owner decision D4 below (recommended: yes, same once-per-session budget).
- Module header: not recommended (it would show before any effort and becomes wallpaper).

### 3.5 Writing rules (enforced by a test)
One sentence, 4 to 14 words, plain words, Indian English; warm, about growth and the subject's craft; no emoji, no em-dash or en-dash, no exclamation mark; no AI, source or data words; no exam-result promises (rank, AIR, top, topper, crack, clear the exam, guaranteed, selection, seat, percentile, score, pass); no claims about this set ("you did well", "mastered", "real strength"); no comparison with other people (others, everyone, competition, rivals, ahead of, beat, behind), no fear, guilt or pressure; no medical facts.

### 3.6 How the draft was made and reviewed
1. Two Haiku drafting passes wrote 5 candidates per subject (170 lines).
2. A second Haiku pass checked tone and forbidden words, flagged 23 lines (claims about this set such as "you are handling it well", odd phrasing such as "breath of practice", cheesy lines such as "familiar friends"), and picked 3 per subject.
3. Lead review (this plan): changed 17 more lines. Kept the owner's own words for cardiology ("next best cardiologist"); replaced lines that over-claim ("is becoming second nature for you", "your natural instinct"), narrow or odd ones ("voice box", "safe sedation" for anaesthesia, "every lens and retina"), near duplicates (two "diagnostic eye" lines in radiology), and awkward grammar in SS General Medicine. Added 3 branch fallback lines each for MBBS and SS. A script lint (regex for the forbidden list, 4 to 14 words, ASCII only) passes on all 108 lines (its only hits were false positives: "ahead" in "clinical years ahead", "behind" in "the person behind it", "others" inside "mothers").

Reviewer notes for the owner:
- "You are the next ... in the making" says the student will become that specialist. For MBBS subjects many students will not choose that specialty; it reads as encouragement, not a prediction, but the owner may prefer the softer "You think like a pathologist today" for MBBS subjects. Decision D4.
- Biochemistry has no "in the making" line on purpose (few become biochemists).
- `ss-general-medicine` uses "consultant physician"; `ss-biostatistics` uses "clinical researcher".
- Lines need a clinical-tone read by the owner before shipping (the owner signs off words, as with other clinical copy).

### 3.7 Samples
- Cardiology (NEET-SS): "You are the next best cardiologist in the making." / "ECG rhythms are starting to read like a familiar language." / "Every echo view you revisit makes the heart a little easier to read."
- Radiology (NEET-SS): "You are the next radiologist in the making." / "A steady search pattern is how radiologists read, and you are building one." / "Every subtle finding you look for trains a careful eye."
- Radiology (NEET-PG): "You are the next great radiologist in the making." / "Your eye for images is growing with every scan you study." / "X-rays, scans and their signs are starting to link together."

### 3.8 Build tasks and tests
- `prep/maik-lines.json` (from the draft), loader in `prep.js` next to `loadTax()`, `pickLine(moduleId, branchId)` pure helper exported for Node tests.
- Node unit test (new `test/prep-maik-lines.test.mjs`): every taxonomy subject has exactly 3 lines, every line passes the lint above, unknown ids return null, rotation wraps, once-per-session flag holds.
- `test/run-prep-ui.mjs`: finish a 5-question cardiology set, assert one `.pn-maikline` with the first cardiology line; finish another set, assert none (session budget); a 3-question set shows none.
- Effort: S to M (2 to 3 h), plus owner review of the words.

## 4. Work breakdown (covers sections 1, 2, 3 and 5)

Each step is its own PR on its own branch, tests and light/dark screenshots at 390, 820 and 1180 reviewed before merge;
merge, OTA and flags only on the owner's yes. Client changes ship by OTA; only 5-native needs a store build.

| Step | Task | Depends on | Tests that change | Effort |
|---|---|---|---|---|
| A1 | iPad quick wins: tabs and filters in the column, banner cap, 44 px targets, hover fix (1.2 #1, 2, 8, 10) | none | new `test/run-prep-ipad.mjs` (assertions 1, 2, 6) | S to M |
| A2 | Sheets as centred panels on wide screens, sheet entrance for that width (1.2 #5) | A1 | `run-prep-ipad.mjs` (4), `run-prep-setup-ui.mjs`, `run-prep-social-ui.mjs` (sheet still opens and closes) | M |
| A3 | Lesson bar in the column, wider home and subject grids, 2-column module list (1.2 #7A, 3, 4) | A1, D1 | `run-prep-ipad.mjs` (3, 5), `run-prep-lessons-ui.mjs` | M |
| A4 | `autoFitD()` on resize and rotation (1.2 #9), app wide | none | `run-prep-ipad.mjs` (8); smoke other modules (home, OPD) at 820 and 1180 | M |
| A5 | Landscape runner and lesson 2-column layouts (1.2 #6, 7B) | A3, D5 | `run-prep-ui.mjs` (runner flows at 1180x820), `run-prep-lessons-ui.mjs`, `run-prep-pyq-ui.mjs` | L |
| A6 | Keyboard and focus rings (1.2 #11) | none | `run-prep-ipad.mjs` (7), `run-prep-flash-ui.mjs` | M |
| B1 | Balloons in `prep-motion.js`, CSS, milestone detection in `prep.js` and `prep-plan.js`, `cel` store key in the sync register list (`prep-sync.js:31`), trim lesson confetti to first of the day (section 2) | none (D3) | `run-prep-ui.mjs` balloon cases, reduced-motion case; `run-prep-plan-ui.mjs` plan-done case | M |
| C1 | MaiK lines: `prep/maik-lines.json` from the approved draft, `pickLine()`, result-screen row, `ml` store key in the sync register list (section 3) | owner approves words (D4) | new `test/prep-maik-lines.test.mjs`; `run-prep-ui.mjs` line and session-budget cases | S to M |
| D1 | Ask MaiK: `prep-ask.js` sheet, buttons on every listed screen, offline path refactor, device verdict step A (RAM proxy), web message (section 5) | A2 (sheet styling), D6, D8 | `test/prep-teacher.test.mjs`, `run-prep-ui.mjs`, `run-prep-lessons-ui.mjs`, `run-prep-flash-ui.mjs`, `run-prep-pyq-ui.mjs`, `run-prep-arena-ui.mjs` | L |
| D2 | Online route `prep-teach` (server), `AI_MODULES.prep_tutor`, client wiring and error mapping | D1, D7; a dry-run cost note to the owner before any paid call in tests (tests stub the model) | new `test/prep-teach-server.test.mjs` | M |
| D3 | Native: model identifier from `capacitor-llama` `available()`; `prep/device-capability.json` from the verified table | D1; store build | Node test on the table; device check on a real iPhone and iPad | M plus store build |

Order: A1, B1 and C1 can run in parallel (different files: `prep.css`, `prep-motion.js`, `prep.js` result screen; B1 and
C1 both touch `renderResult()`, so merge B1 first). Then A2, A3, D1, D2, A4, A5, A6, D3.

Total estimate: about 6 to 7 working days of build plus review rounds (iPad 2.5, balloons 0.5, lines 0.5 plus owner word
review, Ask MaiK 2.5 to 3 plus a store build).

## 5. Ask MaiK everywhere, offline or online (owner addition 2026-10-09)

Owner's words: "Why only offline MaiK connected below every MCQ? Give Ask MaiK everywhere. They can choose offline or online. Tell them straight away if their device is not capable of the on-device model (non-AI flagship: anything before 2024, not an iPad or iPhone from M1 or A17 Pro onward)."

### 5.1 What exists today (origin/main ffea380f9)
- Only two entry points, both offline only and both hidden unless the on-device model is ready (`PREP_TEACHER.ready()` at `prep-teacher.js:274` = native app + local runtime + pack installed):
  - MCQ feedback, `prep.js:834`, shown only after a WRONG answer: "Why is X wrong? Ask MaiK offline"; handler `prep.js:1453` (`teach`) calls `PREP_TEACHER.explain()`.
  - Lesson step, `prep-lessons.js:300-304` (`askable()`), handler `prep-lessons.js:505`.
  - Nothing in review (`prep.js:1043`), result (`prep.js:1029`), module header (`renderModule`, `prep.js:672`), flashcards (`prep-flash.js`), PYQ (`prep-pyq.js`) or Arena (`prep-arena.js:343`, `:475`).
- So on a phone without the model, or on the web, a student never sees Ask MaiK at all and never learns why. That is the gap the owner saw.
- The offline teacher is grounded (question, options, key, stored explanation, per-option reasons) and every answer passes `check()` (each drug and number must appear in the stored explanation) before it is shown, else the stored explanation is shown (`prep-teacher.js:192-197`). This safety net works unchanged for online text.
- Online MaiK today: the MaiK sheet in `home.js` uses `SMD_AI.explainGrounded` (`reasoning.js:6378`) to `POST /api/ai/explain`, which is tuned for clinician questions and is wrapped by `maik-engine.js` (with engine pref `local` or `rag` the call never reaches the cloud). There is no server route that answers a student's MCQ question. (`maik-ask.js` and `functions/api/ai/_maik-ask.js` are the OPD history-taking interview, not this.) `/api/ai/prep-generate` is deck generation only, sign-in required.
- Device checks today: `SMD_MAIK_MODELS.suitability()` (`maik-models.js:677-715`) is RAM-based (MaiK Lite needs 6 GB, MxCore 8 GB), fed by the llama plugin's `available()` (`totalMemory`, `availableMemory`; iOS `ProcessInfo.physicalMemory`, Android `totalMem`). `PREP_TEACHER.ready()` does not call it, so a phone that is too small but has a pack downloaded shows the button and then fails at load with `low-memory`. No model-identifier or chip check exists anywhere; `@capacitor/device` is not installed (`device-id.js:4`). The existing text `DEVICE_SUPPORTED` (`maik-models.js:127-131`, "iPhone 18 Pro, 17 Pro, 16 Pro ...") and `DEVICE_WARNING` ("Built for flagship, AI-enabled phones ...") disagree with the owner's new cut-off and use the word "AI"; they must not be reused in PrepNucleus.
- Quota machinery to reuse: `AI_MODULES` daily caps (`functions/_ai_usage.js:20-37`, enforced only when `MAIK_ENFORCE_CAPS=1`; live value unknown), `checkQuota` (`functions/_usage.js:155`: circuit breaker, rate, monthly tokens, guest limits), per-device cap (`_usage.js:300`, default 300 a day), rupee cap (`AI_COST_CAP_ON`, inert unless on), and the client "MaiK Tokens are used up" sheet (`SMD_PRO.openAiLimit`, `pro-paywall.js:459-475`), which already opens automatically from a global fetch wrapper on any `/api/ai/` 429 `ai-cost-cap`.
- Engine policy: `stewardmd.maikEngine` (`cloud` default, `local`, `rag`) and the hard Local policy (`smd_maik_hard_local`, `maik-engine.js:196-220`): a Local choice never silently calls the cloud. PrepNucleus currently ignores the engine pref both ways.

### 5.2 One entry point, one sheet
- New `prep-ask.js` (ES5, `window.PREP_ASK`), loaded in `prep-loader.js:19` right after `prep-teacher.js` (bump `V`). One function: `PREP_ASK.open(ctx, host)` with `ctx = { kind: "mcq" | "review" | "step" | "card" | "pyq" | "result" | "battle" | "module", item, chosen, step, title, moduleId }`.
- One button style everywhere: "Ask MaiK" with the MaiK mark, `data-act="ask"`, always visible (right or wrong answer, web or app). It never hides because the model is missing; the sheet explains instead.
- Placement:

| Screen | Where | Grounding sent |
|---|---|---|
| Runner feedback card (`prep.js:826-839`) | replaces the offline-only button; for right answers too | stem, options, key, chosen, stored explanation, per-option reasons (existing `promptFor`/`groundParts`) |
| Review a missed question (`prep.js:1043`) | under the explanation | same |
| Set result (`prep.js:1029`) | one row: "Ask MaiK about the ones you missed" | the missed items, clipped to the existing `LIM` budget |
| Mock result (`mockAnalysis`, `prep.js:1167`) | per question in the mock review list, never during a timed mock | same as review |
| Lesson step (`prep-lessons.js:304`) | existing icon button, no longer gated on `ready()` | `stepGround` |
| Flashcard back (`prep-flash.js` card render) | small icon button on the back face only | front, back, deck source sentence |
| PYQ paper review (`prep-pyq.js`) | per question after answering | same as MCQ |
| Arena battle result (`prep-arena.js:343`, `:475`) | per round in the result list, never during a live round | same as MCQ |
| Module header (`renderModule`, `prep.js:672`) | "Ask MaiK about this module" | module title and its section names only (no free text answers here unless online; offline answers stay grounded) |

- The sheet: reuses the offline teacher's chat screen (`pt-chat`, `prep-teacher.js:299-334`) and the `pn-sheet` pattern. On iPad width (600 px and up) it opens as a centred panel (max-width 560 px) or, in landscape runner, a right side panel 400 px wide so the question stays visible (see section 1). Top of the sheet: a two-option segmented control, "On this phone" and "Online", then the context card, then the chat.
- `prep-teacher.js`: split the generators so `teach()` and `teachStep()` take `deps.generate` (offline: `SMD_MAIK_LOCAL.answer`; online: the new route), add `PREP_TEACHER.deviceVerdict()` (5.4), and change the copy "Nothing is sent to a server" (`:326`, `:363`) to be mode-specific.

### 5.3 Offline vs online in plain words
- On this phone: "Works without signal. Your question stays on this phone. Smaller and slower, about 10 to 40 seconds."
- Online: "Uses StewardMD's server. Needs a connection. Faster and more detailed. Your question and its explanation are sent for this answer."
- Default (decision D6): the choice the student made last time (`localStorage smd_prep_ask_mode`, in try/catch); first time: "On this phone" when the device is capable and the pack is installed, else "Online" when connected. If the student's app-wide engine pref is Local or Edge (`cloudAllowed()` false), "Online" stays selectable but asks once per sheet: "Send this question to StewardMD's server for this answer?" It never changes `stewardmd.maikEngine`, so the hard Local policy holds: nothing goes to the cloud without a tap.
- Changed in: the sheet itself (remembered), and a new row in PrepNucleus settings ("Ask MaiK: On this phone / Online / Ask me each time"). The app-wide MaiK engine setting stays where it is.
- No-AI-label rule: the app UI says "MaiK", "On this phone", "Online", never "AI". MaiK's own answer text is MaiK's output, not a label, and is fine. Server messages that say "AI" (`[[path]].js:1672`, `:1701`, `:1712`, `moduleLimitMsg`) are mapped to MaiK wording on the client for this route, and the new route returns its own wording.

Online route (server, mirrors `prep-generate` and the CliniX tutor precedent):
1. New seg `prep-teach` in `functions/api/ai/[[path]].js` dispatched next to `prep-generate` (`:1746`), `MODULE_FOR["prep-teach"] = "prep_tutor"`, new `AI_MODULES.prep_tutor` in `_ai_usage.js` (daily cap, decision D7), label in `moduleLimitMsg`.
2. New `functions/api/ai/_prep-teach.js`: scrub input (`prepScrub` from `_prep-core.js`), the same SYSTEM / STEP_SYSTEM text as the offline teacher, clip lengths, cheapest model (`gemini-3.1-flash-lite`, `MODEL_HARD_DEFAULT`), meter as feature `prep:teach`, return `{ text }`.
3. Client calls it with a direct `fetch` and the signed-in Firebase token (as `prep-create.js:592-594`), so the engine decoration does not swallow it; maps 401 to "Sign in to ask MaiK online", 402 to the existing Pro/top-up path, 429 (`module-daily`, `rate`, `device-cap`) to MaiK wording; `ai-cost-cap` already opens `openAiLimit`.
4. Every online answer passes the same `check()` before display.
- Cost estimate (no spend in this plan): about 1,500 input and 400 output tokens an ask at the `MODEL_RATES` for flash-lite (Rs 0.024 / 0.144 per 1k) is about Rs 0.09 an ask. 20 asks a day by 1,000 students is about Rs 1,800 a day at worst. Hence a daily cap per student (D7).

### 5.4 Device capability check, shown straight away
When the sheet opens with "On this phone" selected (or when the student taps it), the verdict shows at once, before any download or generation:

| Verdict | Message (draft, decision D8) | Actions |
|---|---|---|
| capable, pack installed | "Runs on this phone. About 10 to 40 seconds." | Ask |
| capable, no pack | "MaiK Lite (1.1 GB) needs a one-time download on this phone." | Download in Settings, Ask online |
| not capable | "MaiK on this phone needs an iPhone 15 Pro or newer, or an iPad with an M1 chip or newer. You can ask MaiK online instead." (Android: "a 2024 or newer phone with 8 GB memory or more") | Ask online (primary), Not now |
| unknown | "We could not check this phone. Ask online for the best answer." | Ask online (primary), Try on this phone (only if a pack is installed and `suitability()` is not "no") |
| web browser | "MaiK on this phone works in the StewardMD app. You can ask online here." | Ask online |

- Tone: never "your phone is old" or "not good enough"; the message names what is needed, then the way forward. The stored explanation is always on screen, so nobody is left with nothing.
- Older devices: online only. Offline and not capable and no connection: "Ask MaiK needs a connection on this phone. The explanation is above." No dead end, no crash risk.

How the verdict is computed (honest limits):
- A web view cannot read the chip or model reliably (iPadOS Safari even reports a Mac user agent). The check needs native data.
- Step A, no native rebuild (ships with an OTA): RAM proxy from the existing llama plugin `available().totalMemory`. On Apple devices the owner's cut-off matches total memory: every qualifying iPhone (15 Pro and later, 16 family, 16e, 17 family, Air) and every M1-or-later iPad and the iPad mini (A17 Pro) has 8 GB or more, while every non-qualifying iPhone and iPad listed has 6 GB or less. Rule: iOS `totalMemory >= 7.5 GB` = capable; less = not capable; null = unknown. This must be confirmed against Apple's tech specs per model before shipping (Apple publishes RAM on few spec pages; mark unverified rows).
- Step B, with the next store build: add the model identifier to the existing `capacitor-llama` plugin's `available()` (iOS `utsname.machine`, for example "iPhone16,1"; Android `Build.MODEL`, `Build.SOC_MODEL` on Android 12+) rather than adding `@capacitor/device` (no new dependency). Then match the identifier against the capability table (5.5); a table hit overrides the RAM proxy; a miss falls back to step A.
- iPhone rule: A17 Pro or later. Neat property: every iPhone with identifier major number 16 or higher qualifies (iPhone16,1 is the 15 Pro) and every lower one does not, so new iPhones qualify without a table update. iPad: M1 or later, or iPad mini A17 Pro; iPad identifiers do not sort by chip (iPad13,1 is the A14 Air 4, iPad13,4 is the M1 Pro, iPad14,1 is the A15 mini 6), so iPads need the explicit table; unknown new iPad identifiers fall back to the RAM proxy.
- Android: there is no chip-year API. Threshold: arm64-v8a, Android 12 or later, total memory 8 GB or more (llama plugin `totalMem`, not `navigator.deviceMemory`, which caps at 8), and, when `SOC_MODEL` is known, a 2024 flagship SoC or newer (Snapdragon 8 Gen 3, Dimensity 9300, Tensor G4, Exynos 2400, and later; list kept in the same data file). An NPU is not required: MaiK Lite runs on the CPU through llama.cpp. Unknown SoC with 12 GB or more = capable with the existing `suitability()` warning; anything else unidentifiable = unknown, offer online.
- `PREP_TEACHER.ready()` must also respect `suitability()` so a downloaded pack on a too-small phone no longer fails late.

### 5.5 Data: device capability table
- File: `prep/device-capability.json` (shipped, cached, OTA-updatable), built from a reviewed TSV. Columns: `model_id`, `name`, `family` (iPhone, iPad, Android SoC), `year`, `chip`, `ram_gb`, `verdict` (yes, no), `id_verified`, `chip_verified`, `source_url`.
- Draft on this branch: `vault/plans/PrepNucleus-device-capability.draft.tsv` (52 Apple rows, drafted by a Haiku pass that fetched `support.apple.com/en-us/108044`, `/108043`, `apple.com/iphone/compare`, `apple.com/ipad/compare`). Chips were read from Apple's compare pages; NO identifier is verified on an Apple page (Apple's identify pages do not list them), 2026 models have no identifier yet, and the table lists one identifier per model while most models have two to four (Wi-Fi and cellular variants, for example iPad13,4 to iPad13,7 for the M1 11-inch Pro). The lead corrected the 2020 iPad Pro ids to iPad8,9 and iPad8,11 (the draft had the 2018 ids). Treat it as a starting point only.
- Update process: (1) each September and on each iPad launch, add rows from Apple's identify and tech specs pages, `source_url` per row; (2) confirm the identifier from a real device or the matching Xcode simulator (`Device.model` from the plugin), set `id_verified`; (3) a Node test checks the file (unique ids, verdict matches the chip rule, every "yes" row has `ram_gb >= 8`); (4) ship by OTA, no store build needed once step B is in.

### 5.6 Tests and iPad impact
- Node: `test/prep-teacher.test.mjs` grows cases for `deviceVerdict()` (RAM proxy, identifier rule, iPad table, Android rule, unknowns) and the mode default; new `test/prep-teach-server.test.mjs` on the pattern of `test/prep-pro-server.test.mjs` (scrub, clip, cap, status codes, no "AI" in returned messages).
- UI (`test/run-prep-ui.mjs`, `run-prep-lessons-ui.mjs`, `run-prep-flash-ui.mjs`, `run-prep-pyq-ui.mjs`, `run-prep-arena-ui.mjs`): an "Ask MaiK" button exists on every listed screen, for right and wrong answers, on the web build too; opening it on the web shows the "works in the StewardMD app" verdict; stubbing the plugin with 6 GB shows "not capable" and the Online primary; 8 GB with pack shows "Runs on this phone"; Online with a stubbed fetch returns text that passes `check()`; a 429 maps to MaiK wording; the engine pref is unchanged after an online ask.
- iPad: the sheet at 820 and 1180 widths is a centred panel (max-width 560 px) or a side panel in the landscape runner with the question still visible; the offline teacher chat at 1180x820 keeps a readable column; split view at 320 to 507 px falls back to the bottom sheet. Effort for section 5: L (client 1.5 to 2 days, server 0.5 day, native step B 0.5 day plus a store build, tests 0.5 day).

## 6. Owner decisions (with recommendations)

| # | Question | Recommendation |
|---|---|---|
| D1 | Which screens are iPad-first (wider than the 720 px reading column)? | Home, subject list, stats and plan go up to about 1040 px with 3 to 4 tiles a row; the runner, explanations and lessons stay a 720 px reading column, except the landscape 2-column runner and lesson (D5). |
| D2 | Sheets on iPad: centred panel or side sheet? | Centred panel, max 560 px, for setup, consent, Pro and limit sheets; a right side panel only for Ask MaiK in the landscape runner so the question stays visible. Bottom sheet under 700 px (phones and narrow split view). |
| D3 | How often may balloons appear? | Milestones only (level-up, new rank, day streak 7, 30, 100, question milestones, first mock, first finished daily plan), at most once a day except a level-up; confetti stays for wins and 70% sets, trimmed to the first lesson of the day. |
| D4 | MaiK lines: approve the words; MBBS subjects keep "You are the next ... in the making" or the softer "You think like a ... today"? Show on the lesson finish card too? | Keep "in the making" (the owner's own style); show after sets of 5 or more questions and on the lesson finish card, once per app session, never in mocks or battles, never in the lesson reader steps. |
| D5 | Landscape runner: 2 columns (question and image left, options and explanation right)? | Yes for iPad landscape at 900 CSS px and wider; one column everywhere else. |
| D6 | Ask MaiK default mode | The student's last choice; first time "On this phone" if the device is capable and MaiK Lite is downloaded, else "Online". Never changes the app-wide MaiK engine setting; with the engine on Local, Online asks once per sheet. |
| D7 | Is online Ask MaiK free for students, and how many a day? | Free while the Pro gate is off, capped at 20 asks a day per student (`prep_tutor` module cap) and sign-in required for online (guests get offline or the stored explanation). About Rs 0.09 an ask at flash-lite rates; revisit when `smd_prep_pro_enforce` goes on (Pro: 100 a day). |
| D8 | Exact cut-off wording for devices that cannot run MaiK on the phone | "MaiK on this phone needs an iPhone 15 Pro or newer, or an iPad with an M1 chip or newer. You can ask MaiK online instead." (Android: "a 2024 or newer phone with 8 GB memory or more"). Also retire the old `DEVICE_SUPPORTED` text (`maik-models.js:127-131`), which says 16 Pro and later and uses "AI". |
| D9 | Do older Android phones get the same message? | Yes, same tone and same online fallback; rule: 8 GB or more and Android 12 or later, plus a 2024 flagship chip when the chip name can be read; anything unreadable is "unknown, offer online". |
| D10 | May the 0.9 and 0.95 app zoom on narrow windows be dropped to keep 44 px targets, and should auto-fit follow rotation and Split View? | Yes to both; app-wide change, smoke-tested on other modules. |
