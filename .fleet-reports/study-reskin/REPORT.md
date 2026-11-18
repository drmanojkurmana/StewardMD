# Study reskin: GoodNotes layout, navy bars + gold accent

Branch `study-reskin`. Look-only change: no selectors, `data-act`/`data-ink`/`data-sel`
values, behaviour, data formats, or undo semantics changed. JS edits are markup
templates, one cosmetic CSS variable (`--st-pen`), and canvas selection colours.

## Tokens (one block at the top of study.css, `.pn-root`)

| Token | Value | Use |
|---|---|---|
| `--st-navy` | #3E4C72 | top bar, pager, selected segmented/tab states |
| `--st-navy-2` | #55648C | document tab strip (lighter navy step) |
| `--st-navy-ink` | #232F4A | active tab/tool text on white |
| `--st-navy-deep` | #2B3653 | pager border |
| `--st-toolrow-dark` | #232E47 | tool row + active tab in dark mode |
| `--st-gold` | #C9A227 | ONLY: active tab indicator, selection handles + lasso bar, selected colour ring, focus rings, primary buttons in sheets |
| `--st-gold-ink` | #241D05 | text on gold |
| `--st-canvas` / `--st-canvas-dark` | #E9EBEE / #171D2B | page-area background |
| `--st-toolrow` | #FFFFFF | tool row (light) |
| `--st-ink` / `--st-sub` / `--st-hairline` / `--st-active-wash` | #1C2432 / #5B6575 / #D8DCE2 / #EDEFF2 | one cool-grey family |

Radius: tabs 0, tool buttons 8px, popover 12px, sheets unchanged (16px), dots 50%.
No glows, no gradients, no backdrop blur anywhere in the new rules.

## Rows

| # | Row | Status | Notes |
|---|---|---|---|
| 1 | Navy top bar, white icons, centred title, 44px targets | Done | `.st-p3-topbar` navy #3E4C72, `.st-p3-btn`/`.st-p3-title` white. Existing buttons/order kept (back, grid, search, share, mic / title / undo, redo, bookmark, add page, close, more). White on navy = 8.46:1. |
| 2 | Folder tab strip, flat equal-width tabs, × left, active joins tool row | Done | Strip is `--st-navy-2`; tabs `flex:1 1 0`, radius 0, hairline dividers; × moved left with flex `order:-1` (no markup change). Active tab is white (tool-row colour) with a 3px gold indicator inset at its base. Long titles ellipsis (existing nowrap/ellipsis). |
| 3 | One white tool row, inline context strip, tinted active tool, width presets + colour dots | Done | `#stInkCtx` and `#stInsertOptions` moved inside `#stTb` (study.js `toolbarHtml`, structure only). Capsule removed; active tool sits on `--st-active-wash`; pen/highlighter icon takes the current ink colour via `--st-pen` set in `syncTb()` from the existing `activeColor()`. Thin vertical hairline before the context strip. Widths: 3 line samples, selected on the light grey square with navy inset. Colour dots: 28px visual circle in a 44px target, selected gets gold ring + check. Eraser/highlighter/shapes/lasso/text/image options render in the same bar. The bar wraps inside itself when width demands it and the strip scrolls internally; there is no separate second row, floating pill, or grey capsule. |
| 4 | GoodNotes pen/eraser/highlighter popover | Done | `#stInkPop` is now a white 12px card anchored under the tool row (absolute, top 148px, left 12px, max 400px, neutral shadow). Pen: segmented Fountain/Ball/Brush, size slider (writes the active width preset), live preview canvas, pressure slider, tip slider (fountain), colour grid + custom colour/hex, finger toggle. Eraser: Whole stroke / Partial / Precision segmented, Small/Medium/Large sizes, "Erase highlighter only", return-to-tool toggle, Clear page. Highlighter gets size + colour grid too. Sliders use the gold accent. |
| 5 | Grey canvas, white page, page counter pill | Done | `.st-sc` is `--st-canvas`; `.st-pg` keeps a white page with 1px `--st-hairline` border and a soft neutral shadow. Pager stays bottom-left, now navy with white text. |
| 6 | Gold discipline | Done | Gold appears only in: active tab indicator, canvas selection stroke/handles (#C9A227 in study.js/study-select.js), DOM selection handles/drag bar, lasso bar border, selected colour ring, `:focus-visible` rings, sheet primary buttons + erase Undo, current page-card outline. Everything else is navy/cool grey. Eraser cursor is navy. |
| 7 | Dark mode + phone | Done | `body.dark`: navy bars unchanged; tool row and active tab become `--st-toolrow-dark`; canvas `--st-canvas-dark`; page stays white; popover dark. Phone (≤560px): existing top-bar collapse into More kept; tab strip scrolls (min tab 132px); tools scroll with snap inside the bar; context strip takes its own line inside the same bar; colour dots are hidden in the row and live in the pen popover (row 4 grid). |
| 8 | Library + sheets in the same tokens | Done | Library chips and bottom tab active state are navy; search focus, page-card current outline, menu selected state, and sheet `.pn-btn.pri` are gold (dark text on gold = 6.93:1); section titles moved to the grey family. No library markup or behaviour changed. |

## Files

- study.css: token block + reskin rules (top bar, tabs, tool row, page, gold spends, library, dark, phone, reduced motion).
- study-ink.css: strip/dot/segmented/popover restyle (28px dots, gold ring + check, navy segmented, anchored popover).
- study-select.css: lasso/shapes strip transparent in the bar, navy selected rules, gold focus.
- study.js: `toolbarHtml` nests the context strip in the tool row; `syncTb` sets `--st-pen`; selection/lasso canvas colour mint → gold.
- study-ink.js: popover gains size slider, colour grid + custom, eraser mode/size controls (template + its own popover handlers); eraser cursor mint → navy.
- study-select.js: selection box/handles mint → gold.

Untouched: prep-loader.js V token, index.html ?v=, all data/undo code, study-library.js, study-pages.js, study-insert.js, study-media.js.

## Verification

- `node --test --experimental-test-module-mocks --experimental-sqlite test/study*.test.mjs`
  → tests 81, pass 81, fail 0 (also green before the change).
- `node --check` on study.js and study-ink.js: OK. New JS is ES5 (no arrows/let/const/template literals in the diff).
- Contrast (computed): white/#3E4C72 8.46, white/#55648C 5.85, #232F4A/white 13.32, gold-ink/gold 6.93, #E8ECF3/#232E47 11.41.
- CSS brace balance: study-ink.css and study-select.css balanced; study.css keeps the base file's pre-existing one-brace offset, my additions are balanced.
- Compliance pass (web-design-guidelines style, by code inspection): 44px targets kept (dots are 44px targets with 28px visuals), focus-visible rings on all reskinned controls, `prefers-reduced-motion` disables the new transitions, 390px rules for tabs/tool snap/popover, light + dark rules both present, no emoji icons added (check mark is a text glyph on the selected dot only).
- Browser suites and screenshots were NOT run: the brief reserves them for the lead. Selectors and DOM ids the UI tests use (#stTb tool order, #stInkCtx, #stInkPop controls, #stP3Top, #stDocTabs under #stP3Top, Finding D chip edges at 390px) are unchanged; the lasso chips keep their phone sizing so their right edges stay inside 390px.

## Known issues

- The popover anchor is a fixed offset (top 148px = 52px top bar + 44px tab strip + 52px tool row). If the tab strip is absent it overlaps the page top by that strip's height; it never pushes the page.
- On mid widths (~768-1100px) the colour strip scrolls horizontally inside the tool row instead of wrapping; all dots remain reachable.
- Skills: astryx not applicable (this app is vanilla ES5, not React) and pick-ui-library not applicable (no new UI library chosen; existing CSS kept). All other standing-rule skills were read.

---

## Reskin round 2 (lead's real-WebKit iPad run, 1194x834)

| # | Fix | Status | Notes |
|---|---|---|---|
| 1 | Teal everywhere | Done | `--pn-km-mint`/`--pn-accent` redefined to gold `#C9A227` only under Study containers (`.st-body`, `.st-lib`, `.st-sheet`, `.st-lasso-bar`, `.st-sel-panel`, `.st-paste-bubble`, `.st-erase-toast`), so sheets/popovers appended to the Prep root are covered and PrepNucleus outside Study keeps mint. All literal `#42CDB5/#42cdb5` and `rgba(66,205,181,...)` in study.css/study-select.css swapped to gold. Selected chips/segmented = navy fill + white text (`.st-p3-seg-btn.on`; library Date chip already navy). `FOLDER_COLORS` default + folder-icon fallbacks in study-library.js now gold. Selection count (study-select.css) now navy-ink. Ink palette `PEN_COLORS` keeps its teal as a user ink colour (content, not chrome); saved folders keep their stored colour. |
| 2 | Width presets missing | Done | study-ink.js strip and study.js fallback strip now render the 3 width presets first, then a hairline divider, then colour dots, so they are visible at 1194px without scrolling. Selectors unchanged (`data-ink="width"`, `data-act="st-width"`); selected preset sits on the light grey rounded square with navy inset. |
| 3 | Pen popover too tall | Done | `.st-ink-pop`: `max-height: calc(100dvh - 164px)`, internal scroll, tighter padding/gap, z-index 90. iPad landscape >=900px: two-column grid (600px). Page counter pill (`.st-p3-pager`, z 30) sits below popovers and is hidden while `#stInkPop` is open (`:has`, progressive enhancement). |
| 4 | Library header + empty state | Done | `.st-lib` gets flat `var(--pn-bg)` (no tide wash/gradient behind "Documents"). Documents empty state is now the New tile plus one short line "Import a PDF, create a notebook, or scan notes." (`.st5a-empty-line`); the duplicated "No PDFs yet" card is gone. Favourites keeps its single empty card. `test/run-study-ui.mjs` empty-state assertion updated to the new line. |
| 5 | Active tool highlight | Done | `.st-tb-tools .st-b.on` is transparent (no grey square); the active pen/highlighter SVG fills with `currentColor`, which `syncTb()` already sets to the current ink colour via `--st-pen`. Dark mode keeps the ink colour and drops the square too. |

Verification: `node --test --experimental-test-module-mocks --experimental-sqlite test/study*.test.mjs` -> tests 81, pass 81, fail 0. `node --check` on study.js/study-ink.js/study-library.js OK. ES5 kept (template/class edits only; no new syntax). Compliance pass by code inspection: 44px targets unchanged, focus rings now gold via the scoped token, reduced-motion rules untouched, phone rules unchanged (colours still collapse into the popover, widths stay visible), light + dark covered. Browser screenshots not re-run; selectors/`data-act` values unchanged. Skills read: anti-ui-slop, impeccable, emil-design-eng, bundled:taste; astryx N/A (vanilla ES5, not React), pick-ui-library N/A (no new library).

## Verification attempt (this session)

- `node --test --experimental-test-module-mocks --experimental-sqlite test/study*.test.mjs` -> tests 81, pass 81, fail 0.
- `node test/run-study-ui.mjs` -> BLOCKED in this sandbox: `Error: listen EPERM: operation not permitted 127.0.0.1` (the harness spawns test/serve.mjs; binding any local port returns EPERM on 127.0.0.1, 0.0.0.0, :: and localhost; unsandboxed escalation is disabled). No running server exists to point BASE at.
- `node test/capture-study-shots.mjs` -> BLOCKED for the same reason (it also spawns serve.mjs).
- Fallback probe (route-interception Chromium script driving the real entry: library empty line/New tile, width presets, colour dots, popover fit/scroll, pager visibility, pen/highlighter states) -> BLOCKED: Playwright Chromium (headless shell and full Chrome for Testing) and WebKit all die at launch under the sandbox (SIGSEGV / target closed). Script kept at /tmp/study-verify.mjs for a non-sandboxed run.
- Screenshot list: none captured this session. Expected on a non-sandboxed run: .fleet-reports/study-reskin/ipad-library-empty.png, ipad-pen-popover.png, ipad-editor-hl.png, phone-library-empty.png.
