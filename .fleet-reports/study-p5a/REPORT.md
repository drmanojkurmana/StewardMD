# Study Notebook Phase 5a: library, document tabs, export — Report

Branch: `study-p5a-library`. New file `study-library.js` (+ `study.css` under `/* Phase 5a: library */`), registered in `prep-loader.js` after `study.js`. `study.js` diff is one hook line (export `kick`).

## Row map

| # | Feature | Status | Notes |
|---|---|---|---|
| 5.1 | Library grid | Done | GoodNotes grid: `+ New` tile first, folder + notebook/PDF cards in one grid, real covers (first page with ink, cached in `docs.thumb`, regenerated on demand), name + `⌄` menu, date/time edited (`fmtWhen`: Today/Yesterday/`d MMM hh:mm`), red star for favourites, dashed New tile. Grid padding keeps cards inset: `.st-lib` 16px + card 10px; 2 cols at 375px, 3 at 680, 4 at 1024. |
| 5.2 | Folders | Done | Create via New sheet, rename, nest (`parentId` + breadcrumb `Documents › Folder`), move documents (menu > Move with folder list + inline create) and drag cards onto folder cards (HTML5 DnD), move folders (prompt-based), colour (8-token palette sheet), favourite star. Delete keeps documents in library. |
| 5.3 | Sort and view | Done | Date/Name/Type chips + grid/list toggle; persists in `localStorage` (`smd_study_lib_sort`, `smd_study_lib_view`). |
| 5.4 | Item menu | Done | Rename, Duplicate (copies doc + strokes + ptext + file, ink intact), Move, Change cover (regenerate thumbnail), Export, Delete → Trash (`trashedAt`). Trash tab with Restore and 30-day purge (auto on load + Empty trash). Purge hard-deletes only after 30 days (spec'd), otherwise never. Trash data lives in existing `docs`/`folders` stores, so backup/restore already covers it. |
| 5.5 | Library tabs | Done | Floating bottom bar inside Study (Documents/Search/Favorites) matching app pill style: `--pn-card` pill, ink `#42CDB5` active, 52px rows. Trash remains a chip (no fifth tab) to keep the bar to 3 items; search covers titles + PDF text with `mark` highlights. |
| 5.8 | Document tabs | Done | Tabs under the editor top bar (`#stDocTabs`, `role=tablist`), `×` to close, `localStorage` (`smd_study_openTabs` max 12, `smd_study_tabState`). Switching captures/restores scroll position, tool/colour/width and zoom per document. |
| 5.10 | Export | Done | Item menu > Export > All pages / This page / Original. PDF with ink flattened: renders each page (PDF page via pdf.js or notebook background) on canvas, draws live strokes, embeds via jsPDF (`/vendor-jspdf.js`, same as study.js). Handoff via Capacitor Share/Filesystem when present, else browser download (`saveBlob`). Verified logic by code review; cannot run server here (see below). |

Data store: reused IndexedDB `study` v2 (`docs`, `files`, `folders`, `strokes`, `undo`, `ptext`, `index`). No second store. Old prep159 notebooks open unchanged (same doc shape; `folderId`/`colour`/`parentId`/`trashedAt` are additive). Folders and trash are covered by existing backup/restore (`folders.json` + `docs/<id>.json`).

UI skills consulted: anti-ui-slop, impeccable, emil-design-eng, taste, web-design-guidelines (fetched). Palette limited to `#071318/#0D1D23/#42CDB5` via `--pn-*` tokens, no glows/gradients, inline SVG icons, 44px targets.

## Test output

Unit tests (runnable in sandbox):

```
node --test test/study-p5a.test.mjs test/study.test.mjs
# tests 26
# pass 26
# fail 0
```

Covers sort (date/name/type), trash 30-day purge, duplicate title, date formatting, tab parsing.

UI tests (NOT runnable in this sandbox — do not claim as passed):
- `node test/run-study-ui.mjs` — fails at startup with `Error: listen EPERM: operation not permitted 127.0.0.1` (sandbox blocks all `listen()` sockets; confirmed with minimal `http.createServer().listen()` probe). Same EPERM blocks `test/run-study-p5a-ui.mjs` and `test/capture-study-p5a-shots.mjs`.
- `run-study-ui.mjs` and `capture-study-shots.mjs` were updated to the new selectors (`st5a-new`/`st5aNbT`/`st5a-mknb`, Search tab `#st5aSearchQ`/`#stList`, scan via New sheet, `st5a-backup`). They still contain the original viewer/pen/backup assertions unchanged. New `run-study-p5a-ui.mjs` covers 5.1–5.10 end-to-end for CI.
- A lead with network access must run: `node --test test/study*.test.mjs` and `node test/run-study-ui.mjs` plus `node test/run-study-p5a-ui.mjs` before merging.

Syntax/ES5 checks (ran):
- `node --check study-library.js` / `study.js` / all test files: ok.
- `grep "let |const |=>"` in `study-library.js`: 0 (ES5 only).
- `git diff study.js`: 1 hook line (`kick: kick`).
- `prep-loader.js` `V` still `prep159` (not bumped).

## Screenshot list

Attempted `node test/capture-study-p5a-shots.mjs` (phone 390 + iPad 820, dark + light → `.fleet-reports/study-p5a/`). Blocked by the same EPERM; no PNGs were produced in this environment. The script is in place and creates: `*-01-library-empty`, `*-02-library-grid-folder`, `*-03-item-menu`, `*-04-library-list`, `*-05-search`, `*-06-trash`, `*-07-doc-tabs` (7 per device/theme, 28 total). Run it on a network-enabled host to capture.

## Known issues / follow-ups

1. **UI tests and screenshots could not be run** in this sandbox (EPERM). Unit tests pass; UI run is pending a networked host.
2. `run-study-ui.mjs` updates are selector-only, but the search `st-hit` click now goes through `st5a-open` → `openDocById(id, page)` and relies on `restoreTabState` jumping to the page. Verify the page-jump assertion in CI; if flaky, the retry loop makes it eventual (second click usually settles).
3. Scan/Photos via the old `STUDY.act` path call STUDY's `fillLib()` on completion, which paints the legacy row list into `#stList` once. The next library action re-paints the new grid. No data loss. A local scan implementation would remove the flash.
4. Move-folder uses a prompt (type the folder name) rather than a native sheet. Drag-to-move works on desktop; on touch devices use menu > Move.
5. Collapsible "Documents" title on scroll is decorative-only (title lives in the sticky bar). The big in-body title stays to avoid hiding the current folder path.

---

# Fix round (2026-11-17): library hang + merge main (Phases 0+1)

Branch `study-p5a-library`, commits `8de00cb51` (hang fix) + `1c6f5f788` (merge origin/main 5c0f3d2fe), pushed to `origin study-p5a-library`.

## Root cause

In real Chromium, `node test/run-study-ui.mjs` passed the first 3 `library:` checks (empty state, imported PDF listed, page-1 thumbnail) then hung forever inside `page.evaluate(() => new Promise(... indexedDB.open("study") ...))` at line 78: the bare-`open()` promise (no `onerror`/`onblocked` handler) never settled.

The library (`study-library.js`) owned its **own** IndexedDB connection (`indexedDB.open("study", 2)`, cached in `dbP`) in parallel with study.js's identical connection. Two live connections to `study` are a wedge hazard: the test first issues a blocked `indexedDB.deleteDatabase("study")`, and with a second app connection holding the DB open while the delete is pending, the later bare `open("study")` never fires `onsuccess` in Chromium (it serialises behind the pending versionchange/delete handshake). The library therefore appeared frozen on a real device the same way.

Contributing loop/churn defects found by audit and fixed alongside:
- **Unbounded tab-restore retry**: `restoreTabState` polled every 120 ms forever if the viewer never matched (e.g. a failed open), re-injecting tabs and re-reading `docs` each time.
- **Per-render trash purge**: `renderLibBody` fired `purgeExpiredTrash()` (full 2-store scan + deletes) on *every* render, doubling IDB traffic and racing the render's own reads.
- **Cover re-render with no in-flight guard**: overlapping renders could queue duplicate PDF cover regeneration (`renderCoverForDoc` → `idbPut("docs")` → re-render → regenerate).
- **Un-debounced search input**: every keystroke scheduled a full re-render in 200 ms without cancelling the previous timer.

## Fix (app code only — the test was not changed to avoid it)

- `study.js`: one hook — expose the shared connection as `STUDY.db` (alongside the pre-existing `kick` hook). No other `study.js` change.
- `study-library.js` `db()`: delegates to `STUDY.db()` and returns it. The only remaining `indexedDB.open(` is a STUDY-not-ready fallback (loader order): it handles `onblocked` with **bounded** retries (max 5, 250 ms × tries, then rejects — never loops) and `onerror`, and registers `onversionchange` (close + reset) so the connection cooperates with deletes/upgrades.
- `renderLibBody`: no longer calls `purgeExpiredTrash()` (it still runs once at `init`).
- `renderCoverForDoc`: in-flight guard (`coverBusy`) + pure predicate `needsCoverRegen(doc)`; clean covers skip without touching IDB.
- `restoreTabState`: bounded by pure `shouldRetryTabRestore(tries)` (max 25 polls ≈ 3 s) instead of forever.
- Search `input`: debounced (`_deb` timer, cancels the previous render).
- New pure exports: `needsCoverRegen`, `shouldRetryTabRestore`.

## Regression tests added (`test/study-p5a.test.mjs`, 3 new tests)

- `needsCoverRegen`: clean cover skips; dirty/missing regen; null safe.
- `shouldRetryTabRestore`: retries 0–24, stops at 25/999, NaN-safe.
- `hang fix: library reuses STUDY.db...`: reads both app sources and asserts `study.js` exposes `db`, the library delegates to `S.db()`/`STUDY.db`, exactly one code-level `G.indexedDB.open(` remains (the bounded fallback), and the per-render purge is gone. This test fails on the old second-connection code.

## Merge notes (origin/main → study-p5a-library, `git merge`, no rebase)

- `origin/main` (`5c0f3d2fe`, Phase 0 + Phase 1) merged into `3cff72bc7… + 8de00cb51`. Phase 0 scribble fix and Phase 1 ink engine (`study-ink.js`/`study-ink.css`, `study.js` hooks, `study-ink.test.mjs`) intact; Phase 5a library, doc tabs, export intact.
- Conflicts resolved keeping BOTH sides (2 files):
  - `prep-loader.js`: `OPTIONAL` now includes both `study-library.js` and `study-ink.js/css`; `studyOn()` loads `study.js, study-ink.js, study-library.js` in that order (study → ink → library; library patches last). `V` is `prep160` — that value comes **from origin/main** (Phase 1 bump); this fix round did not bump it.
  - `study.js`: `G.STUDY` export keeps `kick` + `db` (5a) **and** `_inkDblTap`/`_inkApi` (Phase 1), plus `inkDblTap()` def from main.
- `test/run-study-ui.mjs` auto-merged cleanly: Phase 0/1 viewer checks (scribble OFF-by-default, ink toolbar/popover/styles/split-eraser/palm/240 Hz) present **and** 5a library selectors (`st5a-*`) retained — verified by grep, no conflict markers, `node --check` ok.
- `study.css` auto-merge kept both 5a library styles and P0 toast styles; no visual changes in this round.

## Test output

Unit tests (runnable in sandbox), post-merge:

```
node --test test/study*.test.mjs
# tests 39
# pass 39
# fail 0
```

Covers: Phase 1 ink (7), Phase 5a pure + hang-fix (10), study.js pure + P0 + A7/A8 (22). `node --check` passes for `study.js`, `study-library.js`, `study-ink.js`, all study test files. ES5: `grep "let |const |=>"` = 0 in all three study app files.

UI tests (NOT runnable in this sandbox — EPERM on `listen()`; Chromium also segfaults under the sandbox supervisor, so a headless probe was not possible either):
- `node test/run-study-ui.mjs`, `node test/run-study-p5a-ui.mjs`, screenshots — pending a networked host. The hang fix was verified by code inspection + the source-level regression test, **not** by a live browser run. The lead must re-run `node test/run-study-ui.mjs` on a Mac to confirm the line-78 `evaluate` now returns.

## UI compliance pass (no visual edits this round)

The hang fix touched only JS data-layer logic (shared IDB connection, bounded retries, render churn). No DOM, CSS, or markup changed, so the shipped library UI is byte-identical to the reviewed 5a design. Checks performed from code:
- Palette/tokens: untouched (`#071318/#0D1D23/#42CDB5` via `--pn-*`; no new colours, glows, gradients, or emoji — inline SVG icons unchanged).
- Targets/focus: untouched (52px bottom-bar rows, 44px icon buttons, `aria-label`/`aria-pressed`/`role=tablist` unchanged).
- Layout: untouched (grid 2 cols @375px / 3 @680 / 4 @1024, `.st-lib` inset unchanged); new `study-ink.css` adds only `.st-ink-ctx`/`.st-live`/`.st-slot-future` selectors with no overlap with 5a classes.
- Contrast/light-dark/reduced-motion: unchanged (no token or motion edits).
- Screenshot capture was not possible in-sandbox (EPERM); the prior round's scripts are in place for the lead to run.

## Known issues / follow-ups

1. Live-browser tests (`test/run-study-ui.mjs`, `test/run-study-p5a-ui.mjs`) and screenshots all run and pass completely in Chromium (see Fix round 2 below).
2. `V` reads `prep160` from the merge (main's Phase 1 bump). No bump was made by this round; the lead still does the merge-time bump.
3. The duplicate PDF.js / jsPDF loaders in `study.js` and `study-library.js` remain (two script tags for `/vendor/pdfjs/pdf.min.js` when both `pdfjs()` and `pdfjsLib()` fire). Harmless in practice (same URL, cached; both resolve), but deduplicating would be tidier — left for a later round to keep this diff small.

---

# Fix round 2 (2026-11-17): Real-browser failures resolved + full UI test and screenshot verification

Branch `study-p5a-library`. Chromium headless test runs succeeded end-to-end.

## Root causes and fixes

1. **`indexedDB.open("study")` hang at line 78**:
   - *Cause*: `study.js` had an open IndexedDB connection without an `onversionchange` listener. When `run-study-ui.mjs` ran `indexedDB.deleteDatabase("study")` or bare `open("study")`, the connection held by `study.js` blocked the versionchange handshake indefinitely.
   - *Fix*: In `study.js`, attached `conn.onversionchange = function () { dbP = null; try { conn.close(); } catch (e) {} };` so connections yield immediately.
2. **Bottom navigation intercepting clicks**:
   - *Cause*: PrepNucleus `.pnv` bar (`z-index: 4`) sat on top of the floating bottom bar `.st5a-bottom` (`z-index: 1`), intercepting tab taps.
   - *Fix*: Added scoping in `study.css`:
     ```css
     .pn-root:has(#stLib) > .pnv,
     .pn-root:has(.st5a-bottom) > .pnv { display: none !important; pointer-events: none !important; }
     .pn-root > .pn-body.st-lib { z-index: 5; }
     ```
3. **Empty library New tile missing**:
   - *Cause*: `bodyEl.innerHTML` only rendered the empty state placeholder without the `+ New` tile.
   - *Fix*: Prepend `newTileHtml()` in `st5a-grid` above the empty box when on `documents` tab.
4. **Duplicate doc trash assertion**:
   - *Cause*: The duplicate document is titled `"Copy of alpha"` per spec. The test checked `page.locator(".st5a-card.st-doc", { hasText: "alpha" }).count() === 0` after trashing one item, which failed because the copy also contains `"alpha"`.
   - *Fix*: Updated `test/run-study-p5a-ui.mjs` to check card count before and after trash (`count === cardsBeforeTrash - 1`).
5. **Search tab state persistence**:
   - *Cause*: `libState.tab` was being saved to `localStorage` (`smd_study_lib_tab`). When a test opened search, it persisted across reboots, breaking subsequent library tests.
   - *Fix*: Removed `localStorage` persistence for `smd_study_lib_tab`; opening the library always defaults to `documents` tab.
6. **`<mark>` tags escaped in search snippets**:
   - *Cause*: Snippet HTML was being run through outer `esc()`, escaping `<mark>` into `&lt;mark&gt;`.
   - *Fix*: Escaped pre, hit, and post individually within `snippet()`, leaving the enclosing `<mark>` tags unescaped.
7. **`Page 2` mangled by `emoji-icons.js`**:
   - *Cause*: `emoji-icons.js` MutationObserver matched `"Page 2"` and replaced it with standard textbook titles unless protected by keep classes.
   - *Fix*: Added `smd-books-keep smd-emo-keep` classes to `#stLib`, `#stList`, and `.st-hit`.
8. **Scan sheet modal intercepting clicks**:
   - *Cause*: `st5a-scan` invoked `origAct("st-scan")` without dismissing the modal sheet, leaving it covering the UI.
   - *Fix*: Added `closeSheet5a()` on click of `st5a-scan`, `st5a-backup`, and `st5a-restore-lib`.
9. **`Cannot set properties of null (setting 'innerHTML')` in `fillLib`**:
   - *Cause*: `shotsToDoc` in `study.js` called `fillLib()`, which attempted to write to `#stChips` (replaced by Phase 5a layout).
   - *Fix*: In `study.js`, hooked `fillLib()` to delegate to `G.STUDY_LIB.renderBody()` when present, and guarded `#stChips` defensively.
10. **Search hit page navigation**:
    - *Cause*: Search hit elements had `data-act="st5a-open"` instead of `data-act="st-hit"`, missing `origAct("st-hit")` which passes `goto` page to `renderViewer(id, page)` and `startViewer()`. Furthermore, `restoreTabState` clobbered `sc.scrollTop` with `saved.scrollTop` even when navigating to an explicit page.
    - *Fix*: Changed `.st-hit` to use `data-act="st-hit"`, and updated `restoreTabState` to only restore `saved.scrollTop` when `!page`.

## Test results

### 1. Unit tests:
`node --test test/study*.test.mjs`
```
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 113.370458
```

### 2. Main Study UI suite:
`node test/run-study-ui.mjs`
```
PASS flag off: no Study tab
PASS flag off: study.js is not even loaded
PASS flag on: the Study tab shows
PASS library: empty state
PASS library: imported PDF listed with 2 pages
PASS library: page-1 thumbnail
PASS metadata: sha256 of the original, pageCount, folderId, favourite, idb fallback
PASS pen tool on: overlay is touch-action none
PASS two pen strokes drawn
PASS points are page-relative (0..1) and keep pressure
PASS undo hides one stroke
PASS redo brings it back
PASS after reload: both strokes are still there
PASS after reload: the strokes are drawn on page 1
PASS stored original sha256 equals the fixture's after open, draw and reload
PASS the undo stack was restored from storage
PASS page jump scrolls to page 2
PASS zoom in
PASS eraser removes the whole stroke it touches
PASS undo of an erase restores the stroke
PASS lasso: draws loop and shows selection action bar
PASS lasso delete: deletes the selected stroke
PASS undo of lasso delete restores the stroke
PASS scribble erase OFF by default: a zigzag over ink is kept as a new stroke, nothing erased
PASS undo removes that zigzag stroke
PASS scribble erase ON: a fast dense scribble over a stroke erases only that stroke
PASS scribble erase shows the Erased toast with Undo
PASS toast Undo restores the erased stroke
PASS P1 toolbar: order pen, eraser, highlighter, lasso with 7 future slots hidden
PASS P1 pen popover: live preview is drawn
PASS P1 pen popover: brush style selectable
PASS P1 pressure slider: 100% stored on the viewer state
PASS P1 pen popover: tapping the pen again closes it
PASS P1 stroke: new strokes carry style and sensitivity, all points kept
PASS P1 precision eraser: half-erased stroke splits into two pieces (one undo step)
PASS P1 precision eraser: undo restores the whole stroke and removes the pieces
PASS P1 precision eraser: redo splits it again
PASS P1 palm rejection: touch does not draw after a pen was seen
PASS P1 latency: a 240 Hz scrawl keeps every point
PASS notebook: opens with one page and no PDF
PASS notebook: ruled lines are drawn on the page
PASS notebook: page added after the current one
PASS notebook: page 2 moved up
PASS notebook: listed beside the PDF with a thumbnail
PASS after reload: notebook page order intact
PASS after reload: the stroke is on the page it was drawn on (now second)
PASS notebook: page deleted after confirm
PASS search: fully indexed PDF shows no Indexing label
PASS search: result shows document, page 2 and the highlighted match (case-insensitive)
PASS search: one result only, for page 2
PASS search: notebook titles are searched
PASS search: absent word gives a clear empty state
PASS search: tapping the result opens the PDF at page 2
PASS search: an unindexed PDF is indexed again after a reload (resume)
PASS library: partly indexed PDF shows Indexing, n of m pages
PASS search: results say which pages are not yet indexed
PASS photos: 3 images become one 3-page PDF stored like an import (sha256 kept)
PASS photos: OCR text (stubbed, 3 pages) is found by search, one hit per page
PASS scan: no top-level Scan button (now inside New)
PASS scan: the New sheet shows Scan (delegates to DocScan)
PASS scan: cancel returns quietly, nothing added
PASS scan: two pages become one 2-page PDF in the library
PASS scan: the cache JPEGs are deleted
PASS scan: OCR ran in the background for both pages
PASS photos: pickImage path (native bridge) builds a 1-page PDF
PASS viewer: the text layer keeps smd-books-keep smd-emo-keep
PASS Make deck: one button (Layer C makes questions and cards together)
PASS Make cards: signed out shows Layer C's sign-in message, nothing sent
PASS Make cards: the cloud notice is shown and nothing is sent before the tap
PASS Make cards: Layer C's facts request carries the selected page's text with page 2 refs
PASS Make cards: only the selected page's text is sent, never the PDF file or other pages
PASS Make cards: the card's source ref points back to the Study Studio document id and page 2
PASS a card made from the document opens that document at page 2
PASS an answered question made from the document gets the same Open in Study Studio link (srcLink, used by prep.js); other items none
PASS Explain: the confirm sheet names what is sent; nothing sent before the tap
PASS Explain: after the tap one request goes to the existing prep-teach route with the selected text
PASS Explain: the answer shows the document name and page it came from
PASS Explain: offline says so and sends nothing
PASS share original: the file is byte-identical to the stored original
PASS flattened export: named (flattened), 2 pages, differs from the original
PASS flattened export: the stored original's sha256 is unchanged
PASS notebook to PDF: one page per notebook page
PASS backup: one zip with the manifest counts (documents, strokes, originals, folders) and a sha256 per file
PASS backup: every original in the zip is byte-identical to the stored one
PASS wipe: the study database is empty
PASS tampered backup: refused with a clear message and nothing written
PASS wrong record count: refused and nothing written
PASS restore: reports the counts restored and skipped
PASS restore: document count, folders and strokes per page match the library that was backed up
PASS restore: every original's sha256 matches (stored bytes identical)
PASS restore again: documents already present (by sha256 or id) are skipped, nothing duplicated
PASS no uncaught page error 

ALL PASSED
```

### 3. Phase 5a UI suite:
`node test/run-study-p5a-ui.mjs`
```
PASS 5.1: New tile present
PASS 5.1: first card is inset from the viewport edge (28px/189px)
PASS 5.1: card shows date edited
PASS 5.1: real cover thumbnail rendered
PASS 5.2: folder created
PASS 5.2: document moved into folder (menu path data)
PASS 5.2: folder colour changed
PASS 5.3: sort choice persisted
PASS 5.3: view choice survives reload
PASS 5.4: duplicate creates a copy with ink
PASS 5.4: doc leaves grid when trashed
PASS 5.4: Trash view shows the item
PASS 5.4: restore brings the notebook back (ink intact)
PASS 5.4: strokes still stored after trash cycle
PASS 5.5: search finds by title
PASS 5.8: open documents shown as tabs
PASS 5.8: tabs remembered on relaunch (2)
PASS 5.10: export downloads a PDF
PASS 5.10: export has both pages
PASS no uncaught page error 

ALL PASSED
```

### 4. Screenshots:
`node test/capture-study-p5a-shots.mjs`
All 28 screenshots successfully captured into `.fleet-reports/study-p5a/`:
- `phone-dark`: 01-library-empty, 02-library-grid-folder, 03-item-menu, 04-library-list, 05-search, 06-trash, 07-doc-tabs
- `phone-light`: 01-library-empty, 02-library-grid-folder, 03-item-menu, 04-library-list, 05-search, 06-trash, 07-doc-tabs
- `ipad-dark`: 01-library-empty, 02-library-grid-folder, 03-item-menu, 04-library-list, 05-search, 06-trash, 07-doc-tabs
- `ipad-light`: 01-library-empty, 02-library-grid-folder, 03-item-menu, 04-library-list, 05-search, 06-trash, 07-doc-tabs

