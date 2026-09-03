#!/usr/bin/env -S uv run --with paddleocr --with paddlepaddle --with pypdfium2 --with pandas --script
"""StewardMD — Government Health Schemes: table extraction via plain PaddleOCR (mobile models),
with rows reconstructed from text-box geometry.

Why not PP-StructureV3 (the obvious first choice, tried first): its full pipeline loads ~10
models at once (2 layout nets + OCR det/rec + table classifier + 2 table-structure nets +
2 cell-detector nets, all "server"-size by default) - on this machine (8GB RAM, often <100MB
free under normal contention) that gets SIGKILL'd (exit 137) before it finishes loading, let
alone runs inference. Confirmed by running the trial in the foreground and reading the real
exit code, not just the silent process death.

This script uses PaddleOCR's plain text detection+recognition only (2 small "mobile" models,
not "server"), then reconstructs table rows the SAME way scripts/govschemes/ingest_layout_pdf.py
already does for the headerless-PDF states: cluster recognized text boxes by their Y-center into
physical rows, then by X-position into columns, rather than trusting a heavyweight table-structure
model neither this machine's memory nor these dense government tables (many wrapped cells) reward.

Output shape matches pdf_tables.py/ingest_csv_tables.py: table_NNN.csv + tables.json.
Prints aggregate stats only (row/table counts, headers) - never row content.

Usage: scripts/govschemes/paddle_tables.py <in.pdf> <out_dir> [--pages A-B] [--dpi 200] [--row-tol 8]
"""
import sys, json, pathlib, argparse, io

ap = argparse.ArgumentParser()
ap.add_argument("pdf")
ap.add_argument("out_dir")
ap.add_argument("--pages", default="", help="page range A-B, 1-based inclusive")
ap.add_argument("--dpi", type=int, default=200)
ap.add_argument("--row-tol", type=int, default=8, help="px Y-center tolerance to merge into one row")
a = ap.parse_args()

import pypdfium2 as pdfium
import pandas as pd
from paddleocr import PaddleOCR

doc = pdfium.PdfDocument(a.pdf)
total = len(doc)
if a.pages:
    lo, hi = (int(x) for x in a.pages.split("-"))
    lo, hi = max(1, lo), min(total, hi)
else:
    lo, hi = 1, total

out = pathlib.Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)

# Explicit MOBILE model names - PaddleOCR 3's bare defaults are "server"-size, which is what
# OOM'd the PP-StructureV3 attempt. Mobile det+rec together are roughly 1/10th the memory.
# Everything else (doc orientation, unwarping, textline orientation) is off - a scanned "Print
# To PDF" government form has no skew/warp to correct, and each extra classifier is another
# model resident in memory for no benefit here.
ocr = PaddleOCR(
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
)

scale = a.dpi / 72.0
manifest, tidx = [], 0


def rows_from_boxes(items):
    """items: list of (x0, y0, x1, y1, text). Cluster into physical rows by Y-center (a table
    cell's text often wraps onto a second line INSIDE the same logical row - see ingest_layout_pdf.py's
    header comment on this exact failure mode - so this is a first pass; row merging for wrapped
    cells is a known limitation here, left for a human/reviewer to spot-check, not silently
    "fixed" by guessing which fragment belongs to which row)."""
    boxes = []
    for x0, y0, x1, y1, text in items:
        boxes.append({"xc": (x0 + x1) / 2, "yc": (y0 + y1) / 2, "x0": x0, "text": text})
    boxes.sort(key=lambda b: b["yc"])
    rows, cur, cur_y = [], [], None
    for b in boxes:
        if cur_y is None or abs(b["yc"] - cur_y) <= a.row_tol:
            cur.append(b)
            cur_y = b["yc"] if cur_y is None else (cur_y + b["yc"]) / 2
        else:
            rows.append(cur)
            cur, cur_y = [b], b["yc"]
    if cur:
        rows.append(cur)
    return [sorted(r, key=lambda b: b["x0"]) for r in rows]


for pno in range(lo, hi + 1):
    page = doc[pno - 1]
    img = page.render(scale=scale).to_pil()
    png = out / f"_page_{pno:04d}.png"
    buf = io.BytesIO(); img.save(buf, format="PNG")
    png.write_bytes(buf.getvalue())
    try:
        results = ocr.predict(str(png))
    except Exception as e:
        print(f"  page {pno}: predict failed: {e}", file=sys.stderr)
        png.unlink(missing_ok=True)
        continue
    items = []
    for res in results:
        d = res.json if isinstance(getattr(res, "json", None), dict) else {}
        d = d.get("res", d)
        polys = d.get("rec_polys") or d.get("dt_polys") or []
        texts = d.get("rec_texts") or []
        for poly, text in zip(polys, texts):
            xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
            items.append((min(xs), min(ys), max(xs), max(ys), text))
    row_groups = rows_from_boxes(items)
    max_cols = max((len(r) for r in row_groups), default=0)
    if row_groups and max_cols:
        table = [[cell["text"] for cell in r] + [""] * (max_cols - len(r)) for r in row_groups]
        df = pd.DataFrame(table, columns=[f"col{i}" for i in range(max_cols)])
        p = out / f"table_{tidx:03d}.csv"
        df.to_csv(p, index=False)
        manifest.append({"i": tidx, "csv": p.name, "rows": int(len(df)), "cols": int(max_cols),
                         "headers": list(df.columns), "pages": [pno]})
        tidx += 1
    png.unlink(missing_ok=True)
    print(f"  page {pno}: {len(items)} text boxes -> {len(row_groups)} rows", file=sys.stderr, flush=True)

(out / "tables.json").write_text(json.dumps(manifest, indent=1))
print(f"pdf      : {a.pdf}")
print(f"pages    : {hi - lo + 1} ({lo}-{hi}) of {total}")
print(f"tables   : {len(manifest)}")
print(f"rows     : {sum(m['rows'] for m in manifest)}")
for m in manifest[:6]:
    print(f"  #{m['i']:03d} p{m['pages']} {m['rows']}x{m['cols']}")
