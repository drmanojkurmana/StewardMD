# research-pdf

A Rust copy of the ResearchMD server's PDF reader
(`backend/research/worker/research_worker/extract.py`, pdfplumber 0.11.11 /
pdfminer.six 20260107). It returns the same `result.json` page shape: page
size, words with boxes, page text and tables, value for value.

Not wired into the app or the worker yet. Nothing here changes what runs live.

## How it fits with on-device reading (PRs #2782, #2785)

The app's own reader (`research-ondevice-pdf.js`, pdf.js plus Apple Vision /
ML Kit for scans) stays the main path on phones and Macs, untouched. This crate
is for the server side: the research container that reads a PDF when the
device read fails, and for uploads that still go to the server. Its output is
identical to today's server output, so nothing downstream changes. The device
path returns `tables: []`; the server path (Python or this crate) finds tables.

A `.wasm` build is included in case the app later wants server-identical
tables on the device, but nothing loads it today.

## What it leaves to Python

- Pages with no text layer: returned with `"needs_ocr": true` (and
  `"needs_ocr": true` at the top), for Tesseract, as extract.py does today.
- Files that use something this crate does not copy exactly come back as
  `{"unsupported": "<reason>"}`, meaning "use pdfplumber for this file":
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

Compare with Python (needs pdfplumber 0.11.11 in the venv):

```
python rust/research-pdf/scripts/make_test_pdfs.py /tmp/tpdf
python rust/research-pdf/scripts/compare_python.py \
  rust/research-pdf/target/release/examples/run_file /tmp/tpdf/*.pdf
```

## Calling it

Both the `.so` and the `.wasm` export the same plain functions (`src/ffi.rs`):
`rs_alloc`, `rs_run(ptr, len)`, `rs_run_limits(ptr, len, max_pages,
max_bytes)`, `rs_result_len`, `rs_free`. Input is the PDF bytes, output is
UTF-8 JSON. `js/research-pdf-wasm.js` is a small loader for a WebView, a
Cloudflare Worker or Node.

From Python with ctypes, a sketch of how the worker could use it:

```python
lib = ctypes.CDLL("libresearch_pdf.so")
lib.rs_alloc.restype = ctypes.c_void_p
lib.rs_run_limits.restype = ctypes.c_void_p
lib.rs_run_limits.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
lib.rs_free.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
ptr = lib.rs_alloc(len(data)); ctypes.memmove(ptr, data, len(data))
out = lib.rs_run_limits(ptr, len(data), 60, 25 * 1024 * 1024)
n = lib.rs_result_len(); result = json.loads(ctypes.string_at(out, n)); lib.rs_free(out, n)
# "unsupported" -> run today's pdfplumber path; pages with needs_ocr -> Tesseract
```

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
- `src/ffi.rs`: C / wasm exports
