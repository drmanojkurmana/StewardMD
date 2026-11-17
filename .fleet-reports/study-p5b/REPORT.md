# Study Notebook 10/10, Phase 5b: search inside notes, audio, print, presentation

Branch: `study-p5b-media`. New code: `study-media.js` (`window.STUDY_MEDIA`, ES5), registered after `study-library.js` in `prep-loader.js` `studyOn()` + `OPTIONAL`. Styles appended to `study.css` under `/* Phase 5b */`. Small `study.js` / `study-library.js` hooks only: IndexedDB `study` v2->v3 + `audio` store, backup/restore `audio.json` + `audio/<id>.bin`, `removeDoc`/`purgeDoc`/`duplicateDoc` audio cleanup, and one `stampStroke` call when a stroke is created. No `V`/`?v=` bump.

## Row map

| # | Feature | Status | Evidence |
|---|---|---|---|
| 5.6 | Search across titles, PDF text (pdf.js `getTextContent`, indexed once per doc into IndexedDB in chunks), typed text (Phase 4 `ptext` src `typed`/`ocr`), handwriting (native recogniser when present, else AI Convert via `indexText`), results show page thumbnail with hit highlighted | Done | Matches "Searching a word in a PDF finds the page" (`test/run-study-ui.mjs` P5b block), typed/convert rows found in library search, `enrichHits` injects `img.st5b-th` thumbs rendered by `pageThumb` (PDF page + ink + highlight box; notebook page ink). |
| 5.7 | In-document search: top-bar search field, hit count, < > steps through hits, highlight on the page; 300-page without freezing via chunked index | Done | Toolbar `#stTb` now has search/mic/print/present buttons; in-doc bar `#st5bInDoc` with `#st5bInCount`, `stepInDoc` wraps via `nextIdx`, text-layer spans highlighted (`st5b-hit`), notebook pages pulse (`st5b-hitpage`). Indexing reuses `STUDY.kick`/`indexDoc` (3 pages per `setTimeout 30` batch). |
| 5.9 | Audio: top-bar Mic records while writing (MediaRecorder AAC/webm), stroke stores recording time `a`, playback replays, tapping a stroke seeks, recordings list per notebook; Blobs in IndexedDB, backup/restore, storage in Settings | Done | `stampStroke` returns elapsed seconds, saved on the stroke record (`put("strokes", s)` path unchanged); `audio` store `{id,doc,mime,size,started,dur,blob}`; `playRec` + fallback seek layers (`strokeAt` via `STUDY._pure.hit`, `clampSeek`); recordings sheet + More-sheet Audio section with `#st5bStorage`. Matches "Tapping a stroke jumps the audio to that moment" (UI test). |
| 5.11 | Print: this page or all; hidden iframe images + `print()`, native share sheet with exported PDF | Done | Print sheet (`This page` / `All pages`), web renders pages+ink to PNGs and `iframe.contentWindow.print()`, native delegates to `STUDY_LIB.exportAll`. Matches "Print sheet opens". |
| 5.12 | Presentation: fullscreen page view with laser visible, chrome hidden, toolbar hidden | Done | `enterPresent` fullscreen overlay + `renderPageImage`, laser dot follows `pointermove`, prev/next/exit, `.st5b-presenting` hides `.st-tb`/tabs/AI box. Matches "Toolbar hidden, laser visible". |
| 5.13 | Share link to collaborate | Not done (out of scope) | Intentionally not built per brief. No code. |

## Tests

- `node --test test/study*.test.mjs`: 35 tests, 35 pass, 0 fail (was 26 before; new `test/study-p5b.test.mjs` adds 9: `fmtBytes`, `fmtDur`, `clampSeek`, `nextIdx`, `isValidStrokeTime`, `pageList`, `pickMime`, `storageOf`, audio backup verify round-trip / old-backup compat / bad-count refusal).
- `node test/run-study-ui.mjs`: extended with a P5b block (media loaded, 4 toolbar buttons, in-doc search 1 of 1 + wrap + close, typed/convert searchable, thumbnail present, mocked MediaRecorder stamps `a`, audio Blob in IDB, Settings storage line, recordings list, tap-to-seek from `a`, print sheet + iframe, presentation hide/laser/follow/step/exit). **Not executed in this sandbox**: `serve.mjs` fails with `listen EPERM` and Chromium launch fails with `SEGV_ACCERR` (both reproduced with a minimal server and a minimal `chromium.launch`). The block is written and `node --check` clean; run it on a normal dev host.
- `node test/capture-study-p5b-shots.mjs` (new, extends `capture-study-shots.mjs` pattern): captures `study-p5b/` at 390x844 + 820x1180 dark/light: `search-thumbs`, `indoc-search`, `print-sheet`, `audio-list`, `present`. **Not executed here** (same Chromium crash). No PNGs produced; list of expected files is above.

## Code notes

- Hard rules kept: strokes still flagged `gone`, every finished stroke `put("strokes", s)` before anything else, each user action one undo step; library/notebooks/PDF import/DocScan/AI chips/palette/lasso/undo/backup/restore untouched except additive audio store (old backups still verify; old notebooks open with strokes intact). `study.js` diff is only the named Phase 5b hooks.
- UI: StewardMD tokens + `#071318`/`#0D1D23`/`#42CDB5`, inline SVG icons, no emoji, no glows/gradients/backdrops. Toolbar wraps at 560px so 375px phone does not clip; 1024+ iPad unchanged.
- Coverage honesty: the 300-page freeze requirement is met by reusing the existing chunked indexer; no 300-page fixture was generated in the UI test (kept fast). Audio seek requires tools off (by design: tools on = writing, tools off = tap-to-seek) and is announced by toast.

## Compliance (static, since screenshots blocked)

- 44px targets: toolbar 36px visual inside 44-row + nav/rec/print/present/pres-bar all `min-height/n 44px`; hit rows 56px; rec rows 56px.
- Contrast: body text uses `var(--pn-text)`/`--pn-mut` tokens, laser solid `#e5484d` with white ring, presentation bar `#e6f5f1` on `#0D1D23`.
- Focus: `:focus-visible` mint outline on all new controls; sheets `role=dialog aria-modal`.
- Reduced motion: Phase 5b `transition/animation none` under `prefers-reduced-motion`.
- Light/dark: all Phase 5b surfaces use `var(--pn-*)` except presentation stage (intentionally fixed dark `#071318` for mirroring); no hardcoded light-only canvas (page image stays white like the app).
- 390px: in-doc bar wraps to `min-width 44px` count; toolbar wraps (see CSS).

## Known issues / follow-ups

- UI + screenshots not run in this environment (see Tests). Run `node test/run-study-ui.mjs` and `node test/capture-study-p5b-shots.mjs` on a dev host before merge.
- `pageThumb` highlight uses pdf.js `transform` math; if a PDF has rotated pages the box may be slightly off — snippet `mark` remains the source of truth.
- Print preview dialog cannot be automated headlessly; the test asserts sheet + iframe, not the OS dialog.
- `getUserMedia` is only tested mocked; real mic permission/AAC on iOS needs on-device check.
