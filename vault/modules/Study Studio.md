# Study Studio

A PDF library, viewer and pen inside PrepNucleus (phase A1 to A3 of [[plans/PrepNucleus-StudyStudio]]). Part of [[PrepNucleus]].

- **Flag + default:** `smd_study`, default **OFF**, needs `smd_prep`. `localStorage.smd_study = "1"` or `?study=1` on, `"0"` or `?study=0` off. Rule in `study.js` (`enabled`) and `prep-loader.js` (`studyOn`, which also keeps `study.js` / `study.css` from downloading while off).
- **Entry point:** a "Study Studio" row on the PrepNucleus home (`homeRow`, `data-act="st-home"`), shown only with the flag on.
- **Status (2026-11-15):** A1, A2, A3 built and tested in a headless browser. NOT passed: the A3 latency gate (iPad + Apple Pencil, Samsung S Pen), 1,000-page open under 2 s on a mid Android phone, force-quit mid-stroke on a phone. Only the owner can pass those.

## Files
- `study.js` (`window.STUDY`, ES5 IIFE; pure helpers load under node), `study.css` (`.st-*`). Loaded last by `prep-loader.js`, optional.
- `prep.js` forwards every `data-act` starting `st-`, asks `STUDY.back()` first, calls `STUDY.leave()` on close.
- Tests: `test/study.test.mjs` (pure), `test/run-study-ui.mjs` (Playwright: import, draw, undo, redo, erase, reload, sha256).

## Data (IndexedDB `study`)
`docs` (id, title, sha256, pageCount, created, lastOpened, favourite, folderId, subject, thumb, store), `files` (original blob, only when `store` is `idb`), `folders`, `strokes` (one record per stroke: page, tool, color, w, pts `[x, y, pressure]` in 0..1 of the page, `gone`), `undo` (per document: `u`, `r` op lists).
- Original bytes: `Capacitor.Plugins.Filesystem` (`study/<id>.pdf`, directory DATA) when present, else an IndexedDB blob (`shortcut:` in the code). Written once at import, never modified; sha256 stored at import.
- Strokes are never deleted: erase sets `gone`, so undo and redo are id lists and persist.

## Gotchas
- Pen strokes are written when the stroke ends (autosave per stroke); the eraser writes as it touches.
- Palm rejection: after any `pointerType === "pen"` event in the session, a finger on the overlay pans the page by hand (the overlay is `touch-action: none` only while a tool is on).
- Pinch zoom uses touch events (two touches) on the scroller; not verified on a device. Canvases stretch while pinching and are redrawn sharp 250 ms after.
- Page boxes use page 1's aspect until a page renders (then its own); a PDF with mixed page sizes shifts slightly while scrolling.
- Pages within 1.5 screens hold canvases (IntersectionObserver); others are empty boxes.
- Import goes through `SMD_NATIVE.pickFile`, falling back to the hidden `<input type=file>` (what the headless test uses).
- Not built (A4+): notebooks, scanner, search, Layer C link, export, backup, subject link UI (the `subject` field exists, unset).
