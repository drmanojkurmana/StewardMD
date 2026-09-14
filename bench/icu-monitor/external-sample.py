#!/usr/bin/env python3
"""external-sample.py <dataset-dir> <prefix> <n> [--seed S]

Internal-benchmark helper for the third-party YOLO-format monitor datasets in fixtures/external/
(see its README: CC BY 4.0 as tagged, internal use only, never committed).

1. Collapses near-duplicate frames (16x16 difference hash, Hamming <= 12) so each sampled image is a
   distinct scene.
2. Samples n scenes (fixed seed) and copies each to fixtures/external/cases/<prefix>-NNN.jpg.
3. Writes labelling sheets to fixtures/external/sheets/<prefix>-sheet-KK.jpg: one row per case, every
   dataset box (class name + enlarged crop) side by side, so the DISPLAYED VALUES can be read and typed
   into <prefix>-NNN.json. The dataset only marks WHERE a vital is; the value is ours to label.
4. Writes a skeleton <prefix>-NNN.json with the boxes (normalised) and labelStatus "draft".
"""
import sys, os, glob, json, random, shutil
from PIL import Image, ImageDraw, ImageFont, ImageOps

src, prefix, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 7
HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(HERE, "fixtures", "external")
CASES, SHEETS = os.path.join(EXT, "cases"), os.path.join(EXT, "sheets")
os.makedirs(CASES, exist_ok=True); os.makedirs(SHEETS, exist_ok=True)

names = None
for line in open(os.path.join(src, "data.yaml")):
    if line.strip().startswith("names:"):
        names = [x.strip().strip("'\"") for x in line.split(":", 1)[1].strip().strip("[]").split(",")]
if not names:  # yolov8 exports list names as a block
    y = open(os.path.join(src, "data.yaml")).read()
    import re
    m = re.search(r"names:\s*\n((?:\s*-\s*.+\n)+)", y)
    names = [s.strip()[1:].strip().strip("'\"") for s in m.group(1).strip().splitlines()] if m else []


def dhash(im):
    g = im.convert("L").resize((17, 16), Image.BILINEAR); p = g.load()
    return sum(1 << (y * 16 + x) for y in range(16) for x in range(16) if p[x, y] > p[x + 1, y])


imgs = sorted(glob.glob(os.path.join(src, "*", "images", "*.jpg")))
reps, hashes = [], []
for f in imgs:
    lab = f.replace(os.sep + "images" + os.sep, os.sep + "labels" + os.sep).rsplit(".", 1)[0] + ".txt"
    if not os.path.exists(lab) or not open(lab).read().strip():
        continue
    h = dhash(Image.open(f))
    if any(bin(h ^ o).count("1") <= 12 for o in hashes):
        continue
    hashes.append(h); reps.append((f, lab))
print(f"{len(imgs)} images, {len(reps)} distinct labelled scenes")
random.seed(seed)
pick = random.sample(reps, min(n, len(reps)))

try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
except OSError:
    font = ImageFont.load_default()
rows = []
for i, (f, lab) in enumerate(pick, 1):
    cid = f"{prefix}-{i:03d}"
    im = ImageOps.exif_transpose(Image.open(f)).convert("RGB"); W, H = im.size
    shutil.copy(f, os.path.join(CASES, cid + ".jpg"))
    boxes = []
    for line in open(lab):
        parts = line.split()
        if len(parts) < 5:
            continue
        c, cx, cy, bw, bh = int(parts[0]), *map(float, parts[1:5])
        boxes.append({"class": names[c] if c < len(names) else str(c), "x": round(cx - bw / 2, 4), "y": round(cy - bh / 2, 4), "w": round(bw, 4), "h": round(bh, 4)})
    boxes.sort(key=lambda b: (b["class"], b["y"], b["x"]))
    json.dump({"id": "ext-" + cid, "group": "external-draft", "labelStatus": "draft", "source": {"dataset": os.path.basename(src.rstrip("/")), "file": os.path.basename(f)},
               "image": cid + ".jpg", "imageSize": {"w": W, "h": H}, "synthetic": False, "boxes": boxes, "fields": {}},
              open(os.path.join(CASES, cid + ".json"), "w"), indent=2)
    crops = []
    for b in boxes:
        x0, y0 = max(0, int((b["x"] - 0.01) * W)), max(0, int((b["y"] - 0.01) * H))
        x1, y1 = min(W, int((b["x"] + b["w"] + 0.01) * W) + 1), min(H, int((b["y"] + b["h"] + 0.01) * H) + 1)
        cr = im.crop((x0, y0, x1, y1)); s = 90 / max(1, cr.size[1]); cr = cr.resize((max(1, int(cr.size[0] * s)), 90), Image.LANCZOS)
        crops.append((b["class"], cr))
    rw = 150 + sum(c.size[0] + 110 for _, c in crops)
    row = Image.new("RGB", (max(rw, 400), 110), (255, 255, 255)); d = ImageDraw.Draw(row)
    d.text((6, 40), cid[-3:], fill=(200, 0, 0), font=font)
    x = 150
    for cls, cr in crops:
        d.text((x, 4), cls, fill=(0, 0, 160), font=font); row.paste(cr, (x + 100, 10)); x += cr.size[0] + 110
    rows.append(row)
for k in range(0, len(rows), 10):
    chunk = rows[k:k + 10]; Wd = max(r.size[0] for r in chunk)
    sheet = Image.new("RGB", (Wd, 110 * len(chunk)), (255, 255, 255))
    for j, r in enumerate(chunk):
        sheet.paste(r, (0, j * 110))
    sheet.save(os.path.join(SHEETS, f"{prefix}-sheet-{k // 10 + 1:02d}.jpg"), quality=90)
print(f"{len(pick)} cases -> {CASES}; {len(rows) // 10 + (1 if len(rows) % 10 else 0)} sheets -> {SHEETS}")
