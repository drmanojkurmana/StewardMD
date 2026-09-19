#!/usr/bin/env python3
"""external-confirm-sheet.py <prefix> <n> [--seed S]

Builds sheets/<prefix>-CONFIRM-KK.jpg for a random sample of n drafted cases: every labelled box's crop
with the DRAFTED value printed beside it (green = number, grey = "--" not shown, orange = "?" ambiguous).
A human checks each crop against its drafted value and reports mismatches; only then do those cases
become labelStatus "confirmed" (external-labels.py --confirmed ...).
"""
import sys, os, json, random, glob
from PIL import Image, ImageDraw, ImageFont, ImageOps

prefix, n = sys.argv[1], int(sys.argv[2])
seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 11
HERE = os.path.dirname(os.path.abspath(__file__))
CASES, SHEETS = os.path.join(HERE, "fixtures", "external", "cases"), os.path.join(HERE, "fixtures", "external", "sheets")
CLS = {"HR": "hr", "SpO2": "spo2", "RR": "rr", "SYS": "sbp", "DIA": "dbp", "MAP": "map",   # model_OCR
       "hr": "hr", "spo2": "spo2", "awrr": "rr", "abp_sys": "sbp", "abp_dia": "dbp", "abp_map": "map", "pulse": "pulse", "etco2": "etco2"}   # Rios
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 30)
files = sorted(glob.glob(os.path.join(CASES, prefix + "-[0-9][0-9][0-9].json")))
random.seed(seed)
pick = sorted(random.sample(files, min(n, len(files))))
rows = []
for f in pick:
    c = json.load(open(f))
    im = ImageOps.exif_transpose(Image.open(os.path.join(CASES, c["image"]))).convert("RGB"); W, H = im.size
    cells = []
    for b in c["boxes"]:
        k = CLS.get(b["class"]); t = c["fields"].get(k, {}) if k else {}
        st = t.get("status")
        draft = str(t["value"]) if st == "visible" else "--" if st == "not_visible" else "?" if st == "ambiguous" else "(unlab.)"
        col = (0, 130, 0) if st == "visible" else (120, 120, 120) if st == "not_visible" else (220, 110, 0)
        x0, y0 = max(0, int((b["x"] - 0.01) * W)), max(0, int((b["y"] - 0.01) * H))
        x1, y1 = min(W, int((b["x"] + b["w"] + 0.01) * W) + 1), min(H, int((b["y"] + b["h"] + 0.01) * H) + 1)
        cr = im.crop((x0, y0, x1, y1)); s = 80 / max(1, cr.size[1]); cr = cr.resize((max(1, int(cr.size[0] * s)), 80), Image.LANCZOS)
        cells.append((b["class"], cr, draft, col))
    row = Image.new("RGB", (150 + sum(max(cr.size[0], 90) + 40 for _, cr, _, _ in cells), 150), (255, 255, 255)); d = ImageDraw.Draw(row)
    d.text((8, 55), c["id"].split("-")[-1], fill=(200, 0, 0), font=big)
    x = 150
    for cls, cr, draft, col in cells:
        d.text((x, 2), cls, fill=(0, 0, 160), font=font); row.paste(cr, (x, 30)); d.text((x, 114), draft, fill=col, font=big)
        x += max(cr.size[0], 90) + 40
    d.line((0, 149, row.size[0], 149), fill=(200, 200, 200))
    rows.append(row)
for k in range(0, len(rows), 10):
    chunk = rows[k:k + 10]; Wd = max(r.size[0] for r in chunk)
    sheet = Image.new("RGB", (Wd, 150 * len(chunk)), (255, 255, 255))
    for j, r in enumerate(chunk):
        sheet.paste(r, (0, j * 150))
    out = os.path.join(SHEETS, f"{prefix}-CONFIRM-{k // 10 + 1:02d}.jpg"); sheet.save(out, quality=90); print(out)
print("sample:", ",".join(os.path.basename(f)[len(prefix) + 1:-5] for f in pick))
