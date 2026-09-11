#!/usr/bin/env -S uv run --with docling --with pypdf --script
"""StewardMD — Government Health Schemes: extract every table from a package-master PDF with
docling and write them as CSV files, one per table, plus a small JSON manifest.

Why docling, not pdftotext: `pdftotext -layout` recovers the columns but wraps long package
names across lines (code + rates on the middle line, name fragments above/below) - a
line-based parser is fragile on 100-200 page government PDFs. docling reconstructs actual
table structure (cells/rows/headers). It also OCRs image-only / vector-outline PDFs such as
the user-supplied Telangana Aarogyasri "Print To PDF" file, which has no text layer at all.

Usage: scripts/govschemes/pdf_tables.py <in.pdf> <out_dir> [--ocr] [--pages A-B]
Prints only aggregate stats (table count, rows per table, headers) - never row content -
so it is safe to run over anything.
"""
import sys, json, pathlib, argparse

ap = argparse.ArgumentParser()
ap.add_argument("pdf"); ap.add_argument("out_dir")
ap.add_argument("--ocr", action="store_true", help="force OCR (image-only / outline-text PDFs)")
ap.add_argument("--pages", default="", help="page range A-B (1-based, inclusive) to limit work")
ap.add_argument("--batch-size", type=int, default=40, help="pages per batch to prevent OOM (default: 40)")
a = ap.parse_args()

import pypdf
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions

opts = PdfPipelineOptions()
opts.do_table_structure = True
opts.do_ocr = bool(a.ocr)
conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})

reader = pypdf.PdfReader(a.pdf)
total_pages = len(reader.pages)
if a.pages:
    lo, hi = map(int, a.pages.split("-"))
    lo = max(1, lo); hi = min(total_pages, hi)
else:
    lo, hi = 1, total_pages

out = pathlib.Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)
manifest = []
table_idx = 0

for b_lo in range(lo, hi + 1, a.batch_size):
    b_hi = min(hi, b_lo + a.batch_size - 1)
    doc = conv.convert(str(a.pdf), page_range=(b_lo, b_hi)).document
    for t in doc.tables:
        df = t.export_to_dataframe(doc=doc)
        pages = sorted({p.page_no for p in t.prov})
        path = out / f"table_{table_idx:03d}.csv"
        df.to_csv(path, index=False)
        manifest.append({"i": table_idx, "csv": path.name, "rows": int(len(df)), "cols": int(len(df.columns)),
                         "headers": [str(c) for c in df.columns], "pages": pages})
        table_idx += 1

(out / "tables.json").write_text(json.dumps(manifest, indent=1))
print(f"pdf      : {a.pdf}")
print(f"pages    : {hi - lo + 1} ({lo}-{hi})")
print(f"tables   : {len(manifest)}")
print(f"rows     : {sum(m['rows'] for m in manifest)}")
for m in manifest[:6]:
    print(f"  #{m['i']:03d} p{m['pages'][:1]} {m['rows']}x{m['cols']} {m['headers'][:6]}")
if len(manifest) > 6: print(f"  ... {len(manifest)-6} more")
