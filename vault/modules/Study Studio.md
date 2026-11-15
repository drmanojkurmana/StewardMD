# Study Studio

A PDF library, viewer, pen, notebooks, search, scan, study link and export / backup inside PrepNucleus (phase A1 to A8 of [[plans/PrepNucleus-StudyStudio]]). Part of [[PrepNucleus]].

- **Flag + default:** `smd_study`, default **OFF**, needs `smd_prep`. `localStorage.smd_study = "1"` or `?study=1` on, `"0"` or `?study=0` off. Rule in `study.js` (`enabled`) and `prep-loader.js` (`studyOn`, which also keeps `study.js` / `study.css` from downloading while off).
- **Entry point:** a "Study Studio" row on the PrepNucleus home (`homeRow`, `data-act="st-home"`), shown only with the flag on.
- **Status (2026-11-15):** A1 to A8 built and tested in a headless browser (stubbed scanner, OCR, network). Loader token prep155. NOT passed (only the owner can): A3 latency gate (iPad + Apple Pencil, Samsung S Pen), 1,000-page open under 2 s on a mid Android phone, force-quit mid-stroke, A6 gate (page 742 of 1,000), A4 force-quit, **A5** 10-page scan on both platforms with OCR text found by search, **A7** on a phone (Make cards, Explain, tapping a card or answer opens its page), **A8** back up, uninstall, reinstall, restore (same count, strokes, checksums) and the share sheet itself.

## Files
- `study.js` (`window.STUDY`, ES5 IIFE; pure helpers load under node), `study.css` (`.st-*`). Loaded last by `prep-loader.js`, optional.
- `prep.js` forwards every `data-act` starting `st-`, asks `STUDY.back()` first, calls `STUDY.leave()` on close.
- Tests: `test/study.test.mjs` (pure: flag, ink maths, page range, source ref, zip round trip, backup verify, restore plan), `test/run-study-ui.mjs` (Playwright: import, draw, undo, redo, erase, reload, sha256, notebooks, search, photos to PDF, scan, Make cards, Explain, share, flattened export, back up, wipe, restore, tampered backup).

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
- Not built: subject link UI (the `subject` field exists, unset).

## Scan and photos (A5)
- "Scan" appears in the library only when `Capacitor.Plugins.DocScan.isAvailable()` is true (and Filesystem can read). Scan -> read each JPEG (Filesystem `readFile`) -> jsPDF (page = A4 width, height from the picture) -> `importBytes` (same as an imported PDF) -> cache JPEGs deleted (always, also on failure) -> background OCR.
- "Import photos as PDF": `SMD_NATIVE.pickImage` one photo a call with "Add another photo?" (the bridge has no multi pick), else the hidden multi-file input. Photos are redrawn as JPEG, 2000 px at most.
- OCR: `SMD_NATIVE.ocr(dataUrl)` per page, 3 pages then a 30 ms pause, text into `setPageText`. Not resumable (`shortcut:` in the code). A scanned PDF has no text layer, so the A6 indexer stores empty "pdf" text and search finds the "ocr" text.

## Study link (A7)
- Viewer: **More** opens a second toolbar: page range (empty = the page on screen; Layer C's `selFromSpec`, 60-page cap), Make deck, Explain, Share original, Share flattened (Notebook to PDF in a notebook).
- Make deck (owner 2026-11-15: one button, since Layer C always makes questions and cards together): a notice sheet (text of those pages sent, never the file, personal details removed, MaiK Tokens) then `PREP_C.fromStudy`. It needs sign-in (Layer C's own message shows otherwise).
- Page text: pdf.js text layer lines (`PREP_SRC.itemsToLines`), or the stored OCR text for a page with no text layer. Page numbers are the Study Studio page numbers, so source refs `{ doc, name, p, h, sn, std }` point back to the document id (`std`) and page.
- Explain: pdf.js text layer over each page (`.st-tl`, below the ink, `smd-books-keep smd-emo-keep`); the last non-empty selection is kept (`V.sel`) because a button tap can collapse the live one. Confirm sheet shows the text; the request goes to `/api/ai/prep-teach` only after the tap; offline and signed-out are said plainly. Answer shows the document name and page.
- Open source: `data-act="st-src"` with `data-doc` / `data-p`, drawn by `PREP_C.srcLink` on cards and answered questions (not a page number in the text: emoji-icons.js).

## Export and backup (A8)
- Share original: `loadOriginal` bytes -> Filesystem CACHE -> share sheet, named `<title>.pdf`. Share flattened: each page drawn by pdf.js (or the notebook ruling) plus live strokes -> JPEG -> jsPDF, `<title> (flattened).pdf`; notebooks `<title>.pdf`. No separate Print button: the share sheet is the print path. Without the native shell (headless test) the file is downloaded.
- Back up library: a zip (fflate, STORE) streamed file by file; layout and restore rules in `vault/decisions/Decisions.md` (2026-11-15, A5, A7, A8). Restore verifies everything first, skips documents already present, never overwrites.
- Gotchas: restore reads the whole backup into memory; flatten builds the whole PDF in memory (both marked `shortcut:`).
