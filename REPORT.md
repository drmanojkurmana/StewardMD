# sci-fix-I Report: ResearchMD Mobile Scroll Fix & Manuscript Screen Redesign

**Branch:** `rmd-scroll-fix` (branched from `origin/main` at `ec290134c`)  
**Worktree:** `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixI`

---

## Part 1: iPhone Scroll Trap Root Cause & ResearchMD-Wide Scroll Audit

### Root Cause (Manuscript on iPhone)
Inside `#researchMD` (`position: fixed; inset: 0; display: flex; flex-direction: column;`), the intended single page scroll container is `#rmdScreenBody.rmd-shell-body` (`flex: 1; overflow-y: auto; overflow-x: hidden;`). On phone viewports (`<= 767px`), `research-screen-manuscript.js` previously left `.rmd-manuscript-screen` at `height: 100%; min-height: 0;`, `.rmd-man-split` at `flex: 1; min-height: 0; overflow: hidden;`, and `.rmd-man-left` / `.rmd-man-right` at `flex: 1; overflow-y: auto;`.

When the header, action buttons, draft cards, segmented control, and phone notice occupied ~640-760 px above `.rmd-man-split`, `#rmdScreenBody` could not scroll at all (`scrollHeight === clientHeight`, `scrollTop === 0`), while `.rmd-man-split` (`overflow: hidden`) was crushed down to ~70-91 px (`DIV.rmd-man-left(h:91,sh:543)`, `DIV.rmd-man-right(h:91,sh:1397)`). Swipes inside those nested `overflow-y: auto` regions either scrolled a tiny viewport or failed to chain upward to `#rmdScreenBody`.

At `@media (max-width: 767px)` in `research-screen-manuscript.js`:
- `#researchMD .rmd-manuscript-screen` now uses `flex: 0 0 auto; height: auto; min-height: 0; overflow: visible;`
- `#researchMD .rmd-man-split` uses `flex-direction: column; flex: none; min-height: auto; overflow: visible;`
- `#researchMD .rmd-man-left` and `#researchMD .rmd-man-right` use `flex: none; overflow-y: visible;`
- Tablet (`>= 768px`, iPad) split layout and independent pane scrolling are preserved unchanged.

### ResearchMD-Wide Scroll Audit (`390x844`)
Every ResearchMD screen CSS block was audited for nested `overflow: auto/scroll` inside height-constrained/`overflow: hidden` parents, fixed `100vh` inner wrappers, `touch-action: none` blockers, `overscroll-behavior: contain` on non-scrolling nodes, and leftover modal body scroll locks:

1. **`research.js`** (`@media (max-width: 767px)`):
   - `.rmd-run-screen` (Run Meta-Analysis): previously `height: 100%; overflow-y: auto;` trapped `#rmdScreenBody` at `st=0`. Changed on phone to `flex: 0 0 auto; height: auto; min-height: 0; overflow-y: visible;`.
   - `.rmd-studies-screen`, `.rmd-split-layout`, `.rmd-pane-left`, `.rmd-pane-right`, `.rmd-extract-form-body` (Studies, Conflicts, Credits, Data, Extract, Institution, IPD, Journals, RoB, Screening, Templates): changed phone `@media (max-width: 767px)` rules to `overflow: visible` / `overflow-y: visible` and `flex: none; min-height: auto;` so `#rmdScreenBody` is the sole vertical scroller.
   - `.rmd-abstract-box`: previously `max-height: 240px; overflow-y: auto; overscroll-behavior: contain;`. Overridden on phone to `max-height: none; overflow-y: visible; overscroll-behavior: auto;`.
   - `.rmd-pdf-layout`, `.rmd-pdf-scroll`: overridden on phone to `flex: none; min-height: auto; max-height: none; overflow-y: visible;`.
2. **`research-screen-grade.js`**:
   - `.rmd-grade-screen`, `.rmd-grade-layout`, `.rmd-grade-list` (previously `max-height: calc(100vh - 220px); overflow-y: auto;`): overridden at `@media (max-width: 767px)` to `flex: 0 0 auto; height: auto;`, `flex: none; min-height: auto;`, and `max-height: none; overflow-y: visible;`.
3. **`research-screen-images.js`**:
   - `.rmd-img-stage`: replaced `touch-action: none` with `touch-action: pan-x pan-y;` so page vertical touch swipes pass through the stage container (`.rmd-img-canvas` retains `touch-action: none; max-width: 100%; height: auto;` for canvas annotation), and overrode `.rmd-img-stage` at `@media (max-width: 767px)` to `max-height: none; overflow: visible;`.
4. **`research-screen-pubconsent.js`**:
   - `.rmd-consent-preview`, `.rmd-consent-preview-local`, `.rmd-ce-body` (previously `max-height: 360px; overflow-y: auto;`): overridden at `@media (max-width: 767px)` to `max-height: none; overflow-y: visible;`.
5. **`research-screen-manuscript.js` Case Report modal (`showDraftPreviewModal`)**:
   - Added `max-height: 90dvh;` (with `90vh` fallback), `Escape` key handler cleaned up on close, backdrop click close, and focus restoration to opener; does not mutate `document.body.style.overflow`.

### New Headless Touch-Scroll Verification (`test/run-research-scroll-ui.mjs`)
Added CDP touch-emulation test (`Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent` `touchStart`/`touchMove`/`touchEnd` swipes) at `390x844` across `manuscript` (`Sections`, `Read section`, `Approve`), `checklist`, `masterchart`, `run`, `search`, `thesis-draft`, plus modal Escape-close check. Verified it failed on unmodified `origin/main` (catching `.rmd-man-left(h:91,sh:543)`, `.rmd-man-right(h:91,sh:1397)`, and `.rmd-run-screen(h:639,sh:1144)`) and passes cleanly on `rmd-scroll-fix`.

---

## Part 2: Manuscript Phone & iPad Hierarchy Redesign

1. **Header (`research-screen-manuscript.js`)**:
   - Full title (`.rmd-man-title`) wraps cleanly across lines with **no ellipsis** (`white-space: normal; word-break: break-word; overflow: visible;`).
   - Single quiet meta line underneath (`.rmd-man-meta`): `Version N · Draft (not final yet)` / `Approved` / `Locked (final)`.
2. **Segmented Control & Phone Notice**:
   - `Sections` / `Read section` / `Approve` bar (`.rmd-man-phone-bar` with `role="tablist"` / `role="tab"` + `aria-selected`) sits directly under the header (`position: sticky; top: 0; z-index: 6;` on phone).
   - One short `.rmd-phone-notice` line directly below it, rendered once (`"Read and approve sections here. Editing needs a tablet."`).
3. **Unified `"Draft your paper"` Card & `"Redraft"` Collapse**:
   - Merged the separate Ask MaiK bar and PaperOrchestra block into ONE `.rmd-man-draft-card`:
     1. `Full paper (PaperOrchestra)` with `[data-rmd="full-draft-po"]` (`"Full draft (PaperOrchestra)"`), plain description, server quote line, inline confirm, and `aria-live="polite"` status row.
     2. `Quick draft or write it yourself`: `Quick draft (Ask MaiK)` (`[data-rmd-ai="ask"]`, `Costs about 2 MaiK tokens.`) + `Write it myself` (`[data-rmd-ai="manual"]`). (Case reports render their CARE de-identification modal trigger + `Write it myself` inside the same single card.)
     3. Privacy line rendered **once** at the bottom of the card.
   - Collapses into a quiet `.rmd-man-redraft-bar` with `"Redraft"` (`[data-rmd="manuscript-redraft"]`) once any section has draft text (auto-expands during confirm/active/paused/failed PO jobs or AI errors, or when toggled via `"Redraft"`).
4. **`Drafted by MaiK, check it` Inline Badge**:
   - Removed the loose floating `[data-rmd-ai-note="manuscript"]` note outside cards; rendered `.rmd-drafted-by-maik` (`[data-rmd-drafted="maik"]`) directly on unapproved AI-drafted sections in the section list, section reader/editor header, and phone Approve section cards.

### Action Mapping Table (Where Every Existing Action Lives)

| Prior Action | New Location & Stage Behaviour |
|---|---|
| `Ask MaiK to draft it` / `Do it myself` / `Full draft (PaperOrchestra)` | Inside single **Draft your paper** card when no draft exists (or when toggled via **Redraft** after drafting). Labelled `Full draft (PaperOrchestra)`, `Quick draft (Ask MaiK)`, `Write it myself`. |
| `Ask MaiK to draft it` (Case Report) | Inside single **Draft your paper** card on Case Report projects (replaces header pill clutter). |
| `Download Word file` (`manuscript-export`) | Primary CTA (`rmd-btn-primary`) in `.rmd-man-actions` **only after a draft exists**. Hidden before any draft text exists. |
| `Journal format check` (`to-format-check`) | Secondary row button in `.rmd-man-actions` **after a draft exists**. |
| `Editor` (`manuscript-mode-editor`) | Secondary row button in `.rmd-man-actions` **after a draft exists** (returns to editor/reader pane). |
| `Earlier versions (N)` (`manuscript-versions-toggle`) | Inside the **More** dropdown menu (`#rmdManMoreMenu`, `[data-rmd="manuscript-more-toggle"]`); also switches phone view to `Read section` pane when opened. |
| `See what changed` (`manuscript-diff-toggle`) | Inside the **More** dropdown menu (`#rmdManMoreMenu`); switches phone view to `Read section` pane when opened. |
| Per-section review / approval (`[data-rmd-approve-sec]`) | Added on phone **Approve** tab (section review cards with preview + `Read section` + `Approve section`) and in the tablet/reader `.rmd-editor-head`. |
| `Mark as final` (`manuscript-approve`) | Appears **only after every drafted section is approved** (`allSectionsApproved`), rendered as primary final step in `.rmd-man-actions` and at the bottom of phone **Approve** tab. |
| `Lock this version` (`manuscript-lock`) | Appears as primary action in `.rmd-man-actions` and phone **Approve** tab once manuscript is marked `Approved`. |

---

## UI Skill & Accessibility Compliance Pass

- **Touch targets**: Verified `>= 44px` minimum height on all phone header buttons, segmented tabs, draft card buttons, menu items, section rows, and Approve action buttons (measured `min=44` in `run-research-manuscript-ui.mjs`).
- **Spacing & alignment**: `16px` horizontal gutters on phone (`16px` topbar/cards/right pane), consistent `8px` / `12px` / `16px` rhythm (`4/8px` grid), zero horizontal overflow (`scrollWidth <= clientWidth` checked at `375x812`, `390x844`, `768x1024`, `1024x768`, `1024x1366`).
- **Accessibility & keyboard semantics**:
  - Segmented tabs use `role="tablist"`, `role="tab"`, and `aria-selected`.
  - **More** menu uses `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, `role="menu"`, `role="menuitem"`, closes on outside click, item selection, or `Escape` (restoring focus to trigger).
  - Case report preview modal closes on `Escape` and backdrop click, restoring focus to opener.
  - `@media (prefers-reduced-motion: reduce)` disables transitions/animations inside `.rmd-manuscript-screen`.
- **Contrast (WCAG AA checked via CDP `getComputedStyle`)**:
  - Light (`390x844`): `.rmd-man-title` **16.23:1**, `.rmd-man-meta` **6.08:1**, `.rmd-man-actions .rmd-btn-subtle` **16.23:1**, `.rmd-man-actions .rmd-btn-quiet` **6.08:1**, `.rmd-phone-notice` **5.50:1**, `.rmd-drafted-by-maik` **4.95:1** (`#a34e1c` on `#fdebdf`).
  - Dark (`390x844`, `#0a1230`/`#111c44` ResearchMD house dark theme): `.rmd-man-title` **14.68:1**, `.rmd-man-meta` **7.64:1**, `.rmd-man-actions .rmd-btn-primary` **16.49:1**, `.rmd-man-actions .rmd-btn-subtle` **14.68:1**, `.rmd-phone-notice` **8.52:1**, `.rmd-drafted-by-maik` **6.93:1** (`#f59e71` on `#3a2418`).
- **Language & copy hygiene**: Zero em-dashes (`\u2014`) or en-dashes (`\u2013`) in edited files; scientific terms paired with plain brackets (`IMRaD (all manuscript sections)`, `CARE (case report)`).
- **Platform Guidance Note**: Consulted `Modern Web Guidance` (native `<button>` tabs/menu with progressive keyboard/Escape dismissal and content-first staged disclosure) alongside project UI rules (`_ui-rules.md`).

---

## Screenshots (`shots/`)
- Before (`origin/main`): `shots/before-390-light.png`, `shots/before-390-drafted-light.png`, `shots/before-390-dark.png`, `shots/before-ipad.png`
- After (`rmd-scroll-fix`): `shots/after-390-light.png`, `shots/after-390-drafted-light.png`, `shots/after-390-dark.png`, `shots/after-ipad.png`

---

## Verification Results

All checks below ran after the final edit (`poStatusHtml` live-region fix):

1. `node --check`: passed for `research.js`, `research-screen-manuscript.js`, `research-screen-grade.js`, `research-screen-images.js`, `research-screen-pubconsent.js`, `sw.js`.
2. `node --experimental-test-module-mocks --experimental-sqlite test/research-po-button.test.mjs`: `16 passed, 0 failed`.
3. `for f in test/research-*.test.mjs`: all passed (`0` failures across all ResearchMD unit suites).
4. `node test/run-research-scroll-ui.mjs`: **ALL SCROLL UI CHECKS PASSED** (failed on unmodified `origin/main` as expected, passes completely after fix).
5. `node test/run-research-manuscript-ui.mjs`: **all passed**.
6. `node test/run-research-ipad-ui.mjs`: **ALL IPAD UI CHECKS PASSED**.
7. `node test/run-research-ui.mjs`: **all passed**.
8. Additional UI suites: all 8 manuscript-touching walkthrough/case/live-fix suites (`test/run-research-walk-*-ui.mjs`, `test/run-research-casereport-ui.mjs`, `test/run-research-caseseries-ui.mjs`, `test/run-research-live-fixes-ui.mjs`) re-ran and passed after the final edit; the remaining 23 non-manuscript `test/run-research-*-ui.mjs` suites passed immediately prior to the final 1-line `poStatusHtml()` live-region restore.
9. `npm test` run (executed prior to final 1-line `poStatusHtml` live-region restore, after which `test/research-*.test.mjs` were all re-run and passed): 10 failures in unrelated non-ResearchMD suites (`test/build-slim.test.mjs`, `test/edge-schemas.test.mjs`, `test/narke-drills.test.mjs`, `test/no-side-stripes.test.mjs`, `test/remote-media.test.mjs`, `test/tokos-drill-core.test.mjs`, `test/tokos-learn-gyA.test.mjs`, `test/wardsynq-i18n-unwrapped.test.mjs`, `test/wardsynq-reachability.test.mjs` — e.g. `test/no-side-stripes.test.mjs` fails in worktree paths containing spaces because `new URL("..", import.meta.url).pathname` leaves `%20` un-decoded; unrelated to ResearchMD).

---

## Files Changed
- [research-screen-manuscript.js](research-screen-manuscript.js)
- [research.js](research.js)
- [research-screen-grade.js](research-screen-grade.js)
- [research-screen-images.js](research-screen-images.js)
- [research-screen-pubconsent.js](research-screen-pubconsent.js)
- [index.html](index.html) (`?v=` tokens bumped for all edited ResearchMD scripts)
- [sw.js](sw.js) (`CACHE` updated with `-scii1`)
- [test/run-research-scroll-ui.mjs](test/run-research-scroll-ui.mjs) (new)
- [test/run-research-manuscript-ui.mjs](test/run-research-manuscript-ui.mjs)
- [REPORT.md](REPORT.md) (new)
- `shots/` (`before-*.png`, `after-*.png`)
