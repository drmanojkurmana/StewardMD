---
status: proposed (2026-11-15). Rewrite of "PrepNucleus Study Studio Master Plan v1.0" into Phase A (ship first) and Phase B (later).
---

# PrepNucleus Study Studio

A study workspace inside PrepNucleus: bring in a PDF or scan pages, read it, write and highlight on it,
keep handwritten notebooks, search it all, and turn pages into PrepNucleus cards and MCQs with page citations.

Why it exists: students already own Goodnotes and Samsung Notes. Study Studio wins only where it links a page to
the question bank and to revision. Phase A builds that link plus the minimum reading and writing around it.
Everything else is Phase B.

## Ground truth (what the repo already has)

PrepNucleus is a module of the StewardMD app, not a separate app. The source plan assumed TypeScript, Room and a
separate design system; none apply.

| Need | Already in the repo |
|---|---|
| App shell | Capacitor 8, buildless ES5 IIFEs, `?v=goldNNN` tokens, `scripts/build-www.sh` builds `www/` |
| Module boot | `prep-loader.js` (flag `smd_prep`, lazy JS list), screens drawn through `PREP._host`, `.pn-*` styles in `prep.css`, `body.dark` |
| PDF render and text | `vendor/pdfjs/pdf.min.js` + worker; `prep-source.js` reads the text layer with page numbers |
| OCR | `native-bridge.js` `ocr()`: Apple Vision (`local-plugins/capacitor-vision-ocr`) on iOS, ML Kit (`@capacitor-mlkit/text-recognition`) on Android |
| File pick, camera, share, files | `native-bridge.js` `pickFile`, `pickImage`, `share`, `sharePdfFromHtml`; `@capacitor/filesystem`, `@capacitor/camera`, `@capacitor/share` installed |
| PDF writing | `vendor-jspdf.js` |
| Pages to cards and MCQs | Layer C: `prep-create.js`, `prep-decks.js`, `prep-cards.js`, `functions/api/ai/_prep-generate.js`; source refs `{doc, name, p, sn}` (see [[PrepNucleus-LayerC]]) |
| Spaced review | FSRS-6 in `specialty-core.js` |
| On-device models | `local-plugins/capacitor-llama`, `capacitor-mlx` |
| Not present | Document-camera scanner, ink engine, local document library |

## Decisions (logged in `vault/decisions/Decisions.md`, 2026-11-15)

1. **Flag `smd_study`, default OFF, needs `smd_prep`.** Same rule shape as `smd_prep_arena`. Entry: a PrepNucleus row, not a new tab.
2. **Ink is WebView-first.** A `<canvas>` overlay with Pointer Events (`pressure`, `tiltX/Y`, `getCoalescedEvents`,
   `pointerType` for palm rejection) over the pdf.js page. Native PencilKit or Android ink is built ONLY if the
   latency gate in A3 fails on a real device. The source plan's "native for performance" is kept as the fallback, not the default.
3. **Storage:** original files through `@capacitor/filesystem` (app data dir), never modified. Metadata, strokes and
   search text in IndexedDB `study`. Strokes are JSON per page in page-relative coordinates (0..1), one record per
   stroke, written as the stroke ends (autosave per stroke).
4. **Only one new native piece in Phase A:** a document-camera plugin (`local-plugins/capacitor-doc-scan`):
   VisionKit `VNDocumentCameraViewController` on iOS, ML Kit Document Scanner on Android. Licences checked before adding.
5. **No new AI service.** Cards and MCQs go through Layer C. "Explain this" goes through the existing `/api/ai` route,
   and the user is told that the selected text is sent. The PDF file never leaves the phone.

## Phase A (ship first)

| # | Feature | Built from | Gate (must pass before the next row) |
|---|---|---|---|
| A1 | **Library**: import PDF (file picker, share sheet into the app), list with thumbnails, rename, delete, favourites, recent, one level of folders, link to a PrepNucleus subject | `pickFile`, Filesystem, IndexedDB, pdf.js page 1 thumbnail | Original bytes unchanged after open and annotate (sha256 before = after); survives app restart |
| A2 | **Viewer**: smooth scroll, pinch zoom, page jump, only nearby pages rendered | pdf.js, virtualised page list | 1,000-page PDF opens to page 1 in < 2 s on a mid Android phone; memory stays bounded while scrolling |
| A3 | **Pen**: pen (pressure where reported), highlighter, stroke eraser, 3 colour presets, 3 widths, undo and redo, palm rejection when a stylus is in use | canvas overlay, Pointer Events | Latency gate: pen-to-ink feels instant on iPad + Apple Pencil and on a Samsung S Pen device (owner sign-off plus a slow-motion video); force-quit mid-stroke loses at most the stroke in progress |
| A4 | **Notebooks**: new notebook, blank / ruled / grid / Cornell pages, A4 and phone size, add, delete and reorder pages | same ink engine on PDF-less pages | Same reopen and force-quit checks as A3 |
| A5 | **Scan**: document camera with auto edges and crop, multi-page, saved as one PDF, OCR text stored per page | new `capacitor-doc-scan` plugin, `vendor-jspdf.js`, `ocr()` | 10-page scan on both platforms; OCR text found by search |
| A6 | **Search**: titles, PDF text, OCR text; results show document, page and a snippet; tap opens that page | pdf.js text layer, `ocr()`, IndexedDB | A known phrase on page 742 of the 1,000-page PDF is found and opens at page 742; pages not yet indexed are labelled as such |
| A7 | **Study link**: select pages, then "Make cards" or "Make MCQs" (Layer C, page refs kept); select text, then "Explain" | Layer C, `/api/ai` | Every generated item opens its source page; nothing is sent without a tap; the cloud notice is shown |
| A8 | **Export and backup**: share the original; share a flattened annotated PDF; notebook to PDF; print through the share sheet; "Back up library" to one file and "Restore" from it | pdf.js render + jsPDF, `share`, Filesystem | Back up, uninstall, reinstall, restore: same document count, strokes and checksums |

Phase A rules: no button appears until it works; strokes are never written into the original file; flattened
export is labelled "flattened"; no document text, names or images in analytics or logs.

## Phase B (later, in rough order of value)

- **Writing:** lasso select and move, partial eraser, shapes and shape recognition, text boxes, images, sticky notes,
  laser pointer, custom toolbars and saved pen presets, Bluetooth keyboard shortcuts, scribble gestures.
- **Native ink**: PencilKit and Android native ink, if the A3 gate passes in the WebView but tilt, hover or
  120 Hz smoothness turns out to matter.
- **Pages:** insert, delete, rotate and reorder pages of an imported PDF (as a new derived file, never the original), split view.
- **Recognition:** handwriting to text, handwriting search, maths and equation input, heading and table extraction,
  image and diagram extraction, automatic tags.
- **Infinite canvas** (its own world-coordinate model, spatial index, export).
- **Scanning extras:** filters, glare and shadow fixes, book curvature (benchmark first), signatures, ID cards,
  QR (the barcode scanner exists already).
- **Library extras:** nested folders, collections, tags, smart folders, colour folders, pins, duplicate detection,
  cross-document links, storage management and low-storage cleanup.
- **AI extras:** chat with one or several PDFs with citations, revision notes, diagram explanation and generation,
  translation, AI tutor mode, on-device model routing (`capacitor-llama` / `capacitor-mlx`).
- **Export extras:** editable PDF annotations, selected pages, selected annotations, SVG, password-protected PDF,
  compression, watermarks, OCR text export, flashcard export.
- **Security and migration:** encrypted documents and backups (Keychain / Keystore keys), app lock with PIN and
  biometrics, private folders, auto-lock, Wi-Fi and device-to-device transfer (paired, authenticated, resumable),
  cryptographic erase.

## Test plan

- Unit (`npm test`): stroke store (write, read, undo, page-relative maths), library store, search index, backup
  manifest round trip.
- Headless browser (CDP harness, as `test/run-prep-create-ui.mjs`): import a fixture PDF, draw synthetic pointer
  strokes, reload, strokes intact, original sha unchanged.
- Device (owner): A3 latency gate on iPad + Pencil and a Samsung S Pen device; A5 scan on both; A8 restore after reinstall.

## Open questions for the owner

1. Free for everyone with `smd_prep`, or part of PrepNucleus Pro?
2. Is a reference Android stylus device available for the A3 gate?
