#!/usr/bin/env python3
"""PrepNucleus CTC: cut the figures out of a scanned radiology review book. Dev-only, never shipped.

PRIVATE DATA: the PDF and everything cut from it stay outside git (the repo is public). This script holds no book text;
it reads the PDF given and writes only under --out (default ~/prep-data/radnotes/ctc).

  python3 -P tools/prep-ctc-figs.py --pdf <book.pdf> [--out DIR] [--pages 1-1143] [--sheet]

The book is a scan: every page is one embedded image (about 150 dpi) with an OCR text layer. A figure is cut from that
embedded image object (never from a page render), so its pixels are the scan's own:
  1. the page image is reduced 4x and blurred, so thin table rules and single text strokes fade, and the OCR word
     blocks are masked out;
  2. dense dark regions left over are joined (connected cells) into candidate boxes;
  3. a box is kept when it is big enough and photo-like (many grey levels, a real share of mid tones); flat cartoons,
     tables and text fail this. The model figure check (prep-radbook figqa prompt) and two Haiku votes judge the rest.
Writes  DIR/figs/ctc-p<page>-<n>.webp   (crop of the embedded page image, longest side <= 1100 px)
        DIR/figs.ctc.json              [{ id, page, bbox (page points), px (image pixels), w, h, file, near, stats }]
        DIR/work/figsheet/p<page>.png   (--sheet: page with the kept boxes drawn, for a visual check)
"""
import argparse, io, json, math, os, re
import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFilter

MAXPX = 1100
RED = 4          # reduction factor for the region search
MIN_SIDE = 110   # px of the page image (about 0.75 inch at 150 dpi)


def words_block(t):
    return len(re.findall(r"[A-Za-z]{3,}", t)) >= 2


def entropy(hist):
    n = float(sum(hist)) or 1.0
    return -sum((h / n) * math.log2(h / n) for h in hist if h)


def region_stats(gray):
    h = gray.histogram()
    n = float(sum(h)) or 1.0
    dark = sum(h[:100]) / n
    mid = sum(h[30:226]) / n
    white = sum(h[236:]) / n
    levels = sum(1 for k in range(0, 256, 8) if sum(h[k:k + 8]) / n > 0.004)
    return {"ent": round(entropy(h), 2), "dark": round(dark, 3), "mid": round(mid, 3), "white": round(white, 3), "levels": levels}


def photo_like(s):
    # radiographs, CT, MRI, ultrasound and photos: many grey levels and a real share of mid tones; a flat cartoon or a
    # table has few levels or is mostly white
    return s["ent"] >= 4.6 and s["levels"] >= 14 and s["mid"] >= 0.28 and s["white"] <= 0.62


def components(mask, gw, gh):
    seen = bytearray(gw * gh)
    out = []
    for start in range(gw * gh):
        if not mask[start] or seen[start]:
            continue
        stack = [start]; seen[start] = 1
        x0 = y0 = 10 ** 9; x1 = y1 = -1; n = 0
        while stack:
            i = stack.pop(); n += 1
            x, y = i % gw, i // gw
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
            for j in (i - 1 if x > 0 else -1, i + 1 if x < gw - 1 else -1, i - gw, i + gw):
                if 0 <= j < gw * gh and mask[j] and not seen[j]:
                    seen[j] = 1; stack.append(j)
        out.append((x0, y0, x1 + 1, y1 + 1, n))
    return out


def page_figures(page, doc):
    imgs = page.get_images(full=True)
    if not imgs:
        return None, []
    xref = imgs[0][0]
    raw = doc.extract_image(xref)
    im = Image.open(io.BytesIO(raw["image"])).convert("RGB")
    W, H = im.size
    if W < 200 or H < 200:
        return None, []  # a placeholder image (blank page)
    sx, sy = W / page.rect.width, H / page.rect.height
    gray = im.convert("L")
    gw, gh = W // RED, H // RED
    small = gray.resize((gw, gh), Image.BOX).filter(ImageFilter.BoxBlur(2))
    # mask the OCR word blocks (real words only; OCR noise read off a picture is kept so pictures stay whole)
    tm = Image.new("L", (gw, gh), 0)
    dr = ImageDraw.Draw(tm)
    blocks = [b for b in page.get_text("blocks") if b[6] == 0]
    for b in blocks:
        if words_block(b[4]):
            dr.rectangle([b[0] * sx / RED - 1, b[1] * sy / RED - 1, b[2] * sx / RED + 1, b[3] * sy / RED + 1], fill=255)
    sp, tp = small.load(), tm.load()
    mask = bytearray(gw * gh)
    for y in range(gh):
        for x in range(gw):
            if sp[x, y] < 205 and not tp[x, y]:
                mask[y * gw + x] = 1
    figs = []
    for (x0, y0, x1, y1, n) in components(mask, gw, gh):
        bx = [x0 * RED, y0 * RED, min(W, x1 * RED), min(H, y1 * RED)]
        w, h = bx[2] - bx[0], bx[3] - bx[1]
        if w < MIN_SIDE or h < MIN_SIDE or n < 0.35 * (x1 - x0) * (y1 - y0):
            continue
        if w > 0.96 * W and h > 0.9 * H:
            continue  # the whole page (a dark full-page scan): not a figure
        s = region_stats(gray.crop(bx))
        if not photo_like(s):
            continue
        pb = [bx[0] / sx, bx[1] / sy, bx[2] / sx, bx[3] / sy]
        near = []
        for b in blocks:
            if not words_block(b[4]):
                continue
            gap_below = b[1] - pb[3]; gap_above = pb[1] - b[3]
            side = (b[0] >= pb[2] - 5 or b[2] <= pb[0] + 5) and b[1] < pb[3] and b[3] > pb[1]
            if (-4 <= gap_below <= 30 or -4 <= gap_above <= 24) and b[2] > pb[0] - 40 and b[0] < pb[2] + 40 or side:
                near.append(" ".join(b[4].split()))
        figs.append({"bx": bx, "pb": [round(v, 1) for v in pb], "stats": s, "near": " | ".join(near)[:600]})
    return im, figs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", default=os.path.expanduser("~/prep-data/radnotes/ctc"))
    ap.add_argument("--pages", default="")
    ap.add_argument("--sheet", action="store_true")
    a = ap.parse_args()
    d = fitz.open(a.pdf)
    p0, p1 = 1, len(d)
    if a.pages:
        p0, p1 = [int(x) for x in a.pages.split("-")]
    os.makedirs(os.path.join(a.out, "figs"), exist_ok=True)
    out = []
    for pn in range(p0, p1 + 1):
        page = d[pn - 1]
        im, figs = page_figures(page, d)
        if im is None:
            continue
        for k, f in enumerate(figs):
            fid = "ctc-p%04d-%d" % (pn, k + 1)
            crop = im.crop(f["bx"])
            crop.thumbnail((MAXPX, MAXPX))
            rel = "figs/" + fid + ".webp"
            crop.save(os.path.join(a.out, rel), "WEBP", quality=85)
            out.append({"id": fid, "page": pn, "bbox": f["pb"], "px": f["bx"], "w": crop.width, "h": crop.height, "file": rel, "near": f["near"], "stats": f["stats"]})
        if a.sheet and figs:
            sd = os.path.join(a.out, "work", "figsheet"); os.makedirs(sd, exist_ok=True)
            v = im.copy(); dr = ImageDraw.Draw(v)
            for f in figs:
                dr.rectangle(f["bx"], outline=(255, 0, 0), width=5)
            v.thumbnail((700, 900)); v.save(os.path.join(sd, "p%04d.png" % pn))
    path = os.path.join(a.out, "figs.ctc.json")
    if a.pages and os.path.exists(path):
        old = [x for x in json.load(open(path)) if not (p0 <= x["page"] <= p1)]
        out = sorted(old + out, key=lambda x: (x["page"], x["id"]))
    json.dump(out, open(path, "w"), indent=1)
    print("figures", len(out), "pages", p0, "-", p1)


if __name__ == "__main__":
    main()
