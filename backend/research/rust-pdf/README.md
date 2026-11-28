# research-pdf

A Rust copy of the ResearchMD server's PDF reader
(`backend/research/worker/research_worker/extract.py`, pdfplumber 0.11.11 /
pdfminer.six 20260107). It returns the same `result.json` page shape: page
size, words with boxes, page text and tables, value for value.

## Where it runs

- **Server backup reader**: the research container's `extract.py` calls the
  `.so` through `research_worker/rust_pdf.py` (built by `worker/Dockerfile`).
  pdfplumber is no longer installed.
- **ResearchMD on the phone**: `research-ondevice-pdf.js` loads the `.wasm`
  (`vendor/rust-pdf/`) and uses its pages, tables included, so a PDF read on
  the phone gives the same result as one read by the server. Scanned pages
  still go to Apple Vision / ML Kit, and any Rust failure falls back to pdf.js.
- **PrepNucleus deck creation**: `prep-source.js` uses `rs_lines` (lines with
  font sizes, in content order, as pdf.js gives them) to find headings and
  sentences. Files over 8 MB, which are opened in pieces, stay on pdf.js.
- **PrepNucleus notebook (Study Studio, `study.js`)**: search text for imported
  PDFs, and "Make flashcards and questions" from a PDF, use the same lines.
  The page view (drawing, selectable text, thumbnails) stays on pdf.js.
- **ResearchMD thesis screen (`research-screen-thesis.js`)**: page text of an
  uploaded PDF thesis.

### Lines: how each line looks

`rs_lines` (`SMD_RUST_PDF.lines` in the app) gives every line as
`{ tx, size, bold, italic, caps }`, so callers can find headings (for
example, splitting a thesis by its own chapter headings):

- `bold`: more than half of the line's visible characters are in a bold font
  (name such as Bold, Black, Heavy, Semibold, Demi, URW `Medi`, TeX `CMBX`;
  FontDescriptor FontWeight 600 or more; the ForceBold flag), or drawn with
  text render mode 2 (fill and stroke, the usual "fake bold").
- `italic`: the same for italic / oblique / slanted fonts (name, the Italic
  flag, or a non-zero ItalicAngle).
- `caps`: at least two letters and no lower-case letter ("CHAPTER 3").

A heading usually shows as bold and/or caps and/or a size above the body
text, so use them together. This is only in the lines output: `rs_run`
(extract.py's result: words, text, tables) is unchanged, byte for byte.

Kill switch in the app: `localStorage.smd_rust_pdf = "0"` (or `?rust_pdf=0`).

The `.wasm` in `vendor/rust-pdf/` is built with
`cargo build --release --target wasm32-unknown-unknown` and copied there.

## What it leaves to the caller

- Pages with no text layer: returned with `"needs_ocr": true` (and
  `"needs_ocr": true` at the top), for OCR (Tesseract on the server, the
  phone's own OCR in the app).
- Files that use something this crate does not copy exactly come back as
  `{"unsupported": "<reason>"}` (the server then reads them with PyMuPDF,
  words and text without tables; the app with pdf.js):
  vertical writing, predefined CJK CMaps, a font whose only Unicode map is
  inside an embedded TrueType file, a file lopdf cannot open, or a number
  whose exact value lopdf's f32 parsing lost and the file does not give back.
- Ceilings use extract.py's codes: `{"error": "ceiling_bytes"}` and
  `{"error": "ceiling_pages"}` (25 MB and 60 pages by default). The 240 s time
  ceiling stays with the caller.

## Checked against the Python reader

`scripts/compare_python.py` runs extract.py (OCR stubbed out) and this crate
on the same files and compares every page's size, words, boxes, text and
tables exactly.

- 57 PDFs, 640 pages, about 200,000 words and 138 tables: all identical.
  The set: test PDFs made by `scripts/make_test_pdfs.py` (reportlab, fpdf2
  Type0 fonts, LibreOffice, hand-written content streams with TJ kerning,
  text state operators, inline images, Form XObjects, rotated pages), a
  39-page two-column paper with 25 tables, the repo's own PDFs, and 41 pdfLaTeX
  documents (R package vignettes).
- One more file that pdfplumber also cannot open comes back `unsupported`.
- The `.wasm` build gives the same result as the native build on all 57.

Speed on those 57 files (4 cores, one thread):

| Reader | Total |
| --- | --- |
| extract.py (pdfplumber, tables on) | 50.9 s |
| this crate, native | 1.0 s |
| 39-page paper: pdfplumber / native / wasm in Node | 9.0 s / 0.10 s / 0.22 s |

## Build and run

```
cargo build --release                          # target/release/libresearch_pdf.so
cargo run --release --example run_file -- paper.pdf [--max-pages N] [--time]
cargo build --release --target wasm32-unknown-unknown
node js/run-file.js target/wasm32-unknown-unknown/release/research_pdf.wasm paper.pdf
```

Compare with the old pdfplumber reader (needs pdfplumber 0.11.11 in the venv; the
script reads that version of extract.py from git history):

```
python backend/research/rust-pdf/scripts/make_test_pdfs.py /tmp/tpdf
python backend/research/rust-pdf/scripts/compare_python.py \
  backend/research/rust-pdf/target/release/examples/run_file /tmp/tpdf/*.pdf
```

## Calling it

Both the `.so` and the `.wasm` export the same plain functions (`src/ffi.rs`):
`rs_alloc`, `rs_run(ptr, len)`, `rs_run_limits(ptr, len, max_pages,
max_bytes)`, `rs_result_len`, `rs_free`. Input is the PDF bytes, output is
UTF-8 JSON. `js/research-pdf-wasm.js` is a small loader for a WebView, a
Cloudflare Worker or Node.

From Python: `backend/research/worker/research_worker/rust_pdf.py`.

## Layout

- `src/pslex.rs`: PostScript lexer and content-stream parser (pdfminer rules)
- `src/font.rs`: fonts, encodings, ToUnicode, widths (`src/tables*.rs` are
  generated from pdfminer's data by `scripts/gen_tables.py`)
- `src/interp.rs`: content-stream interpreter: text state, chars, paths,
  Form XObjects
- `src/words.rs`: pdfplumber words and page text, and extract.py's rotated-page
  path
- `src/tablefind.rs`: pdfplumber `find_tables()` and `Table.extract()`
- `src/lib.rs`: page tree, page boxes, the result JSON
- `src/lines.rs`: lines (text, font size, bold / italic / caps, pdf.js order)
- `src/ffi.rs`: C / wasm exports
