# Study Studio

A PDF library, viewer, pen, notebooks and search inside PrepNucleus (phase A1 to A4 and A6 of [[plans/PrepNucleus-StudyStudio]]). Part of [[PrepNucleus]].

- **Flag + default:** `smd_study`, default **OFF**, needs `smd_prep`. `localStorage.smd_study = "1"` or `?study=1` on, `"0"` or `?study=0` off. Rule in `study.js` (`enabled`) and `prep-loader.js` (`studyOn`, which also keeps `study.js` / `study.css` from downloading while off).
- **Entry point:** a "Study Studio" row on the PrepNucleus home (`homeRow`, `data-act="st-home"`), shown only with the flag on.
- **Status (2026-11-15):** A1, A2, A3, A4, A6 built and tested in a headless browser (A5, A7, A8 not built). Loader token prep151. NOT passed: the A3 latency gate (iPad + Apple Pencil, Samsung S Pen), 1,000-page open under 2 s on a mid Android phone, force-quit mid-stroke on a phone. Also NOT passed: A6 gate (phrase on page 742 of a 1,000-page PDF found and opened at 742), and A4 force-quit on a phone. Only the owner can pass those.

## Files
- `study.js` (`window.STUDY`, ES5 IIFE; pure helpers load under node), `study.css` (`.st-*`). Loaded last by `prep-loader.js`, optional.
- `prep.js` forwards every `data-act` starting `st-`, asks `STUDY.back()` first, calls `STUDY.leave()` on close.
- Tests: `test/study.test.mjs` (pure), `test/run-study-ui.mjs` (Playwright: import, draw, undo, redo, erase, reload, sha256, notebook create / add / move / delete / reload, search, resume of indexing).

## Data (IndexedDB `study`)
`docs` (id, title, sha256, pageCount, created, lastOpened, favourite, folderId, subject, thumb, store), `files` (original blob, only when `store` is `idb`), `folders`, `strokes` (one record per stroke: page, tool, color, w, pts `[x, y, pressure]` in 0..1 of the page, `gone`), `undo` (per document: `u`, `r` op lists), `ptext` (search index: id `doc:page:pdf` or `doc:page:ocr`, doc, page, src, text), `index` (doc, done: PDF pages indexed so far). DB version 2; the upgrade only creates missing stores.
- **Notebook** = a `docs` record with `kind: "nb"`, `style` (blank/ruled/grid/cornell), `size` (a4/phone), `ratio`, `ord` (page ids in order), `next`, no file. A stroke's `page` is the page id, not its position, so reordering never touches strokes. Backgrounds are drawn on the page canvas (`bgLines`, pure); the ink overlay, undo and autosave are the PDF code unchanged.
- Original bytes: `Capacitor.Plugins.Filesystem` (`study/<id>.pdf`, directory DATA) when present, else an IndexedDB blob (`shortcut:` in the code). Written once at import, never modified; sha256 stored at import.
- Strokes are never deleted: erase sets `gone`, so undo and redo are id lists and persist.

## Search (A6)
- Indexer (`kick`, `indexDoc`): runs when the library opens and after an import, one PDF at a time, three pages then a 30 ms pause, progress saved per batch in `index`, so it resumes after a reload. Library cards show `Indexing, n of m pages`; results add a note naming PDFs not fully indexed.
- **OCR hook for A5:** `STUDY.setPageText(docId, page, text)` writes `ptext` with src `ocr`; search reads both sources. A5 must call it per scanned page and nothing else is needed.
- Query is one phrase, case-insensitive `indexOf` (diacritics not folded). Titles of PDFs and notebooks are matched too. Results capped at 60.
- A PDF that fails to index (corrupt, missing file) stays at its count and is retried at the next library open.

## Gotchas
- `emoji-icons.js` rewrites any text node matching "page N" into a "Standard textbooks" line. The results box carries `smd-books-keep smd-emo-keep` to opt out; keep that class or snippets of the user's own PDF text get mangled.
- Deleting a notebook page deletes its strokes and clears that notebook's undo history. Notebook thumbnails are the blank page style (not refreshed with ink).
- Pen strokes are written when the stroke ends (autosave per stroke); the eraser writes as it touches.
- Palm rejection: after any `pointerType === "pen"` event in the session, a finger on the overlay pans the page by hand (the overlay is `touch-action: none` only while a tool is on).
- Pinch zoom uses touch events (two touches) on the scroller; not verified on a device. Canvases stretch while pinching and are redrawn sharp 250 ms after.
- Page boxes use page 1's aspect until a page renders (then its own); a PDF with mixed page sizes shifts slightly while scrolling.
- Pages within 1.5 screens hold canvases (IntersectionObserver); others are empty boxes.
- Import goes through `SMD_NATIVE.pickFile`, falling back to the hidden `<input type=file>` (what the headless test uses).
- Not built (A5+): scanner, Layer C link, export, backup, subject link UI (the `subject` field exists, unset).
