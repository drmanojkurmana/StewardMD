# Phase 01: PDF reading and OCR on the device
Branch: rmd-od-1-ocr (from origin/main). Writer: Gemini Hydrogen, agy account 1. Reviewer: Claude Opus 5.5, agy account 4.

## Rules
Read CLAUDE.md and vault/modules/ResearchMD.md first. StewardMD is a mobile app (iPhone, iPad, Mac, Android). App files are ES5 IIFEs. No em or en dashes in app-facing text. No secrets or patient data in code, tests, logs or URLs. Every new behaviour is ON by default (Manoj, 27 Nov): its flag exists only as a kill switch, read as on unless localStorage holds "0". Edit only the files listed under "Files". No commit, no push, no PR, no merge, no deploy.

## Goal
The app does today's server pdf_extract job itself. Pages with a text layer are read with pdf.js (already done on the thesis screen); scanned pages are read with the phone's own OCR (Apple Vision via the VisionOcr plugin on iPhone, iPad and Mac; ML Kit TextRecognition on Android; both are already wrapped by `SMD_NATIVE.ocr` in native-bridge.js). The PDF never leaves the device. Synced projects upload only the extracted result, never the PDF.

## Server job to match
backend/research/worker/research_worker/extract.py produces result.json:
`{ pages:[{ n, width, height, text, words:[{t,x0,y0,x1,y1}], tables, ocr }], ocr, sha256 }`
width/height in PDF points; words in PDF points, top-left origin (pdfplumber). OCR pages have tables = []. Read extract.py and match field names, number rounding and page text joining exactly.

## Files
1. NEW `research-ondevice-pdf.js` (window.SMD_RMD_ONDEVICE_PDF; dual export for node tests, like research-idb.js).
2. NEW `research-ondevice-checkpoint.js` (window.SMD_RMD_CHECKPOINT): small IndexedDB store, database "rmd_od", object store "checkpoints", key = jobKey string. API: `get(jobKey)`, `put(jobKey, value)`, `remove(jobKey)`, `list(prefix)`. Memory backend for node tests via `_setBackend`, like research-idb.js. Later phases reuse it for stats and drafts.
3. `research-screen-thesis.js`: wire scanned PDFs to the device path.
4. `research-screen-find.js` and `research-screen-extract.js` / `research-screen-pdf.js` (whichever starts pdf_extract for a study PDF: check `uploadPdf` in research-screen-find.js and any other caller of `/pdfs` or `kind: "pdf_extract"`): wire them to the device path.
5. `functions/api/research/_extraction.js` and `functions/api/research/[[path]].js`: NEW route for device results.
6. `index.html` (script tags), `scripts/build-www.sh` (if it lists files).
7. NEW tests: `test/research-ondevice-pdf.test.mjs`, `test/research-ondevice-checkpoint.test.mjs`, `test/research-ondevice-pdf-api.test.mjs`.

## 1. research-ondevice-pdf.js
`extract(source, opts) -> Promise<result>`
- source: ArrayBuffer, Uint8Array, or File/Blob with arrayBuffer().
- opts: `pdfjs` (injectable; default: load /vendor/pdfjs the way research-screen-thesis.js loadPdfJs does; move that loader into this module and have the thesis screen call it), `ocr` (injectable fn(dataUrl, opts) -> Promise<{text, lines, boxes}>; default SMD_NATIVE.ocr), `onProgress(cur, total)`, `onPage(partial)`, `resume` (a previous partial), `maxPages` (default 200; the device has no 60-page limit), `dpi` (default 200; cap the rendered long side at 2400 px), `signal` ({aborted}).
- Result: the server shape plus `engine: "ondevice"`, `ocrEngine: "vision" | "mlkit" | null`, `partial: bool`, `nextPage: int`, `engineVersion: "rod1"`.
- Per page: getTextContent(). If >= 20 non-space characters: build words from text items (convert pdf.js transform to top-left x0,y0,x1,y1 in points), `ocr: false`. Otherwise: render to a canvas at dpi, `toDataURL("image/jpeg", 0.9)`, call ocr(dataUrl, {languageCorrection: true}), convert each normalized box {text,x,y,w,h} to a word in points (x0 = x*width, y0 = y*height, x1 = (x+w)*width, y1 = (y+h)*height), page text = lines joined with "\n", `ocr: true`, `tables: []`.
- ocrEngine: `Capacitor.Plugins.VisionOcr.detectText` present -> "vision"; else `TextRecognition.processImage` -> "mlkit". If neither exists and an image-only page is met, reject with code "ocr-unavailable".
- Call onPage(partial) after every page. With `resume` whose sha256 matches, skip the pages it already has and start at resume.nextPage. A resume with a different sha256 is ignored.
- sha256 via crypto.subtle.digest when available, else null (then resume never matches).
- Errors are Error objects with `err.code` in: ocr-unavailable, ocr-failed, pdf-open-failed, too-many-pages, aborted, password (pdf.js PasswordException), and `err.page` when page-specific.
- After each page: page.cleanup(); canvas width = height = 0.
- Also export `hasNativeOcr()`.

## 2. Thesis screen
Flag `rmd_ondevice_ocr`, DEFAULT ON: on unless localStorage "smd_rmd_ondevice_ocr" === "0" (follow the pattern of the research flag near line 1045 of research.js; add a `?rmd_ondevice_ocr=0` query override only if that pattern has one).
In handleFile: when readPdfLocal finds no text layer and the flag is on and hasNativeOcr(), run extract with progress "Reading scanned page X of Y on your phone"; save the partial to SMD_RMD_CHECKPOINT under "pdf:" + tpid + ":" + sha256 after each page; on success clear it and call saveExtractedPages(result.pages, ...) exactly like the text-layer path. On error: keep the current uploadPdfServer(file, container) path unchanged (phase 04 replaces this with the two-retry rule and the privacy notice; do NOT build those now). Password errors keep today's password message.
When the flag is on, the upload subtitle (around line 957) reads: "Text and scanned pages are read on your phone."

## 3. Study PDF screens (find, extract, pdf)
Behind the same flag: instead of uploading the PDF and creating a pdf_extract job, run extract on the device, then POST the result to the new route below. The existing screens then read it through the same artifact/result endpoints they use today. Show "Reading on your phone, page X of Y". On error, keep today's upload path unchanged. Show the existing OCR-page warning banners from the result's `ocr` flags as today.
Local-only projects (no serverId): keep the result on the device (checkpoint store) and render from it; do not call the server.

## 4. Server route for device results
`POST /v1/projects/:projectId/extractions/device` with JSON `{ filename, sha256, bytes, result }` (no PDF bytes).
- Same project gate and roles as uploadPdfArtifact (WRITE_ROLES).
- Validate: sha256 is 64 hex chars; result.engine === "ondevice"; result.pages is an array of at most 200 pages with the server field names; total JSON body at most 8 MB (reject larger with 413 "ceiling_bytes"); result.sha256 equals sha256.
- Store result.json in R2 at the same key artifactResult reads ("projects/<pid>/jobs/<jobId>/result.json").
- Insert a research_job_runs row with kind 'pdf_extract', status 'succeeded', completed_ts now, and an `output_json` that records `{engine:"ondevice", ocrEngine, engineVersion}`. Read the table columns in functions/db/research_schema.sql and fill the NOT NULL ones the way createJob does. Device jobs must NOT count toward checkPdfJobCaps (they never used the container): add `AND (output_json IS NULL OR output_json NOT LIKE '%"engine":"ondevice"%')` or a cleaner equivalent to the cap queries, and test it.
- Insert or update research_extraction_artifacts the way uploadPdfArtifact does. If research_pdfs requires a row, insert one with the sha256 and an empty r2_key (no PDF stored); check the schema and say in a NOTE what you chose.
- Idempotent on (projectId, sha256): a second post returns the existing artifact with idempotentReplay: true.
- Audit row "artifact_device_extracted" with bytes, sha256, page count, ocr flag. No text in the audit.

## 5. Load order
index.html: `<script src="/research-ondevice-checkpoint.js?v=rod1" defer></script>` and `<script src="/research-ondevice-pdf.js?v=rod1" defer></script>`, both before research-screen-thesis.js. Make sure scripts/build-www.sh copies both into www/.

## 6. Tests
test/research-ondevice-pdf.test.mjs (node:test, fake pdfjs and fake ocr, no real PDF):
1. text page -> ocr false, words in points, text matches extract.py joining.
2. image page 600 x 800 pt, box x .1 y .2 w .5 h .05 -> x0 60, y0 160, x1 360, y1 200.
3. mixed doc -> top-level ocr true only if any page is ocr.
4. resume with nextPage 3 and same sha256 -> pages 1 and 2 not read again; different sha256 -> starts at 1.
5. no native OCR and an image page -> rejects "ocr-unavailable".
6. ocr rejects on page 4 -> "ocr-failed", err.page 4, onPage was called for pages 1 to 3.
7. over maxPages -> "too-many-pages".
8. signal.aborted between pages -> "aborted".
test/research-ondevice-checkpoint.test.mjs: put, get, list by prefix, remove, with the memory backend.
test/research-ondevice-pdf-api.test.mjs: follow test/research-phase3-api.test.mjs for the D1 and R2 fakes. Cases: happy path writes R2 key and rows; replay is idempotent; wrong engine 400; sha mismatch 400; over 8 MB 413; non-member 404 or 403 as the existing gate returns; device jobs are not counted by checkPdfJobCaps.

Run:
node --test --experimental-test-module-mocks --experimental-sqlite test/research-ondevice-pdf.test.mjs test/research-ondevice-checkpoint.test.mjs test/research-ondevice-pdf-api.test.mjs test/research-thesis.test.mjs test/research-phase3-api.test.mjs

## Out of scope here
Two-retry rule, cloud fallback, privacy notices, monthly allowances (phase 04). Running in the background when the app is put away, Live Activity, WorkManager (phase 05). iOS 26 table reading and MiniCPM-OCR (later, optional).
