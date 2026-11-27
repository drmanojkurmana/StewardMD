# ResearchMD Scientist Fixes B (`rmd-sci-fixes-b`)

Branch: `rmd-sci-fixes-b` (branched from `origin/main` at `5073dfc9f` in `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixB`).

## Summary of Fixes

1. **Thesis flow (target journal, word count, and reachable manuscript/DOCX export)**
   - [research-store.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research-store.js): Added `updateProject(id, patch)` on `SMD_RESEARCH_STORE` and preserved `targetJournal` / `targetJournalName` inside `adoptServerProject`.
   - [research-screen-thesis.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research-screen-thesis.js): Updated `saveThesis` (and `renderJournal` catch-up sync) to write `targetJournal` and `targetJournalName` onto the active store project when a journal is selected. Hardened `saveDraft` to lock `#rmdDraftSave` while saving, mirror sections locally (`smd_rmd_manuscript_local_v1`), save section 0 first and `Promise.all` the remaining sections before navigating, and expose `pendingSave()` on `SMD_RESEARCH_THESIS` so downstream screens never read a half-written manuscript. Updated `renderRefs` (`Next: manuscript`) to point to `"manuscript"`.
   - [functions/api/research/_journals.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/functions/api/research/_journals.js) & [functions/api/research/_format_check.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/functions/api/research/_format_check.js): Updated `loadJournal(db, id)` to fall back to `JOURNALS_CATALOGUE` (and `"default"`) when a chosen catalogue journal (such as `ijccm` or `japi`) is not in the 10-row D1 `research_journals` seed table, and forwarded `journal.limits` into `buildFormatChecks`.
   - [research.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research.js): Added `"manuscript"` to `journeyFor` for thesis projects (9 steps total) and `HELP["thesis-refs"]`, and updated `renderReady` to await `SMD_RESEARCH_THESIS.pendingSave()`, resolve `targetJournal` from `proj` / `smd_rmd_thesis_v1`, display full/catalogue journal names in headings and `#rmd_sub_journal`, and pass the chosen journal to `/format-check`.
   - [research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research-screen-manuscript.js): Awaits `SMD_RESEARCH_THESIS.pendingSave()` before loading `/manuscript` and includes a `thesisManuscript(pid)` fallback if neither server nor `localManuscript` has populated yet.

2. **Step pill bar (active scroll, highlight, and mobile fit)**
   - [research.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research.js): Added `PILL_LABELS` for compact pill labels (e.g. `Refs`, `Ethics`, `Consent`, `Chart`, `Screen`, `CONSORT`) with full `aria-label` from `TAB_LABELS` so `#rmdStepBanner` remains verbose and readable while pills fit cleanly on phone widths. Added `scrollActiveTabsIntoView()` on `renderShell` and `open()`, set `position: relative` on `.rmd-shell-tabs`, enforced `min-height: 44px` and `white-space: nowrap` on `.rmd-tab`, removed dimmed opacity (`0.6`) on `.rmd-tab-later` to preserve AA contrast, and gated `:hover` styling behind `@media (hover: hover) and (pointer: fine)` to prevent sticky touch hover highlights on earlier tabs.

3. **PRISMA 2020 flow diagram at `390px`**
   - [research-screen-prisma.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research-screen-prisma.js): Increased `svgBox` height (`64px` -> `74px` with proportional row/arrow coordinates) so two-line box labels no longer crowd or overlap the `20px` count text. Wrapped the SVG in `.rmd-prisma-scroll-wrap` with a bordered scroll frame, right-edge fade indicator (`is-scrollable` / `is-at-end`), mobile swipe caption, and a `44px` `"Fit screen"` / `"Full size"` toggle button (`[data-rmd="prisma-fit"]`) so clinicians can either inspect the diagram fitted inside `390px` or scroll at full legibility.

4. **Checklist disabled Approve button contrast**
   - [research-screen-checklist.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research-screen-checklist.js): Replaced the disabled `.rmd-checklist-btn[disabled]` rule (which left `.rmd-checklist-btn-primary`'s dark cobalt `--rmd-acc-grad` background behind `--rmd-mut` text) with a recessed `--rmd-panel` background, dashed `--rmd-line` border, `--rmd-mut` text, `box-shadow: none`, `opacity: 1`, and `cursor: not-allowed`, passing WCAG AA contrast (>= 4.5:1) in both light and dark modes.

5. **Duplicate phone notice banner on Manuscript**
   - [research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research-screen-manuscript.js): Removed the duplicate `.rmd-phone-notice` inside `.rmd-man-right`, keeping only the single banner below `.rmd-man-phone-bar`.

6. **Journal list boilerplate & duplicate seed entries**
   - [research-screen-thesis.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/research-screen-thesis.js): Updated `journalView` to merge `/v1/journals/match` results with catalogue entries by normalized journal name (so `Annals of Internal Medicine` from seed id `annals` inherits full metadata from catalogue `annals_internal_med` without duplicating). Updated `journalRowHtml` to omit repeated `"Check the author guidelines"` strings when multiple fields are null (keeping at most one fallback note when needed while preserving single-missing-field guidance such as Cureus's `Word limit: Check the author guidelines`).

7. **Cache-busting**
   - Bumped `?v=` tokens in [index.html](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/index.html) for `research-store.js`, `research-screen-thesis.js`, `research-screen-prisma.js`, `research-screen-manuscript.js`, `research-screen-checklist.js`, and `research.js`.
   - Bumped `CACHE` on line 16 of [sw.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/sw.js) with `-sb1`.

## UI & Accessibility Compliance Pass

Applied responsive web & mobile-first interface standards across every touched UI surface:
- **Contrast (>= 4.5:1 AA)**: Verified computed light and dark mode contrast ratios on journal cards in `run-research-thesis-ui.mjs` and disabled Approve button in `run-research-checklist-ui.mjs`; removed `opacity: 0.6` fade on `.rmd-tab-later` so tab pill text keeps full `--rmd-mut` contrast.
- **Touch targets (>= 44px)**: Verified `>= 44px` height on `.rmd-tab`, journal controls, `[data-rmd="back"]`, manuscript phone tabs/actions, and PRISMA `Fit screen` toggle (`min-height: 44px`).
- **Focus visibility & semantics**: Preserved visible `2px` / `3px` `:focus-visible` outlines, `aria-pressed` / `aria-current="page"` / `aria-label` on compact pills, and `tabindex="0"` on the PRISMA scroll container.
- **Reduced motion & zero overflow**: No unguarded animations added; verified `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at `375x812`, `390x844`, `768x1024`, `1024x768`, and `1024x1366`.
- **Copy rules**: Verified zero em-dashes (`\u2014`) or en-dashes (`\u2013`) in visible ResearchMD UI text across harnesses.

## Verification Results

1. **Syntax check (`node --check`)**: Passed on all 8 modified JS files.
2. **ResearchMD unit & server tests** (`node --test --experimental-test-module-mocks --experimental-sqlite test/research-*.test.mjs test/functions/_research.test.mjs`):
   - **807 tests across 84 suites: 804 passed, 0 failed, 3 skipped** (including updated [test/research-journey.test.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/research-journey.test.mjs), [test/research-format-check.test.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/research-format-check.test.mjs), [test/research-ready-state.test.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/research-ready-state.test.mjs), and [test/research-thesis-render.test.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/research-thesis-render.test.mjs)).
3. **Full `npm test` in worktree**:
   - Exited 1 solely due to 9 non-ResearchMD suites expecting gitignored/untracked files absent in a clean `git worktree` (`test/build-slim.test.mjs`, `test/edge-schemas.test.mjs`, `test/narke-drills.test.mjs`, `test/no-side-stripes.test.mjs`, `test/remote-media.test.mjs`, `test/tokos-drill-core.test.mjs`, `test/tokos-learn-gyA.test.mjs`, `test/wardsynq-i18n-unwrapped.test.mjs`, `test/wardsynq-reachability.test.mjs` — e.g. `ENOENT` on `wardsynq/site/i18n.js`). `rx-build.test.mjs` and all ResearchMD/Connect tests passed.
4. **All ResearchMD headless-Chrome UI suites (`test/run-research-*-ui.mjs`)**:
   - **33 / 33 passed (`UI_SUITES_FAILED=0`)**, including extended assertions in [test/run-research-thesis-ui.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/run-research-thesis-ui.mjs), [test/run-research-checklist-ui.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/run-research-checklist-ui.mjs), [test/run-research-manuscript-ui.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/run-research-manuscript-ui.mjs), and [test/run-research-phase2-ui.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixB/test/run-research-phase2-ui.mjs).
