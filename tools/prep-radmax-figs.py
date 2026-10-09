#!/usr/bin/env python3
"""PrepNucleus radiology max bank: cut the numbered figures out of the owner's long-case book PDF. Dev-only, never shipped.

PRIVATE DATA: the PDF and everything cut from it stay outside git (the repo is public). This script holds no PDF text;
it reads the PDF given and writes only under --out (default ~/prep-data/radnotes/max).

  python3 -I tools/prep-radmax-figs.py --pdf <book.pdf> [--out DIR] [--pages 8-415] [--zoom 2]

How a figure is found: every caption block that starts "Fig. 4.121.10:" (or "Figs 4.121.1A and B:") anchors one figure.
The picture is the union of the placed images that sit just above the caption in the same column (tiled line drawings
are merged), grown over touching images; the page is rendered at that clip, so burned-in arrows and panel letters stay.
Captions continue over the next lines of the same column until a gap or another caption.

Writes  DIR/figs/r11-<4.121.10>.webp   longest side <= 1100 px
        DIR/figs.r11.json              [{ id, page, fig, caption, bbox, w, h, file, tiles }]
"""
import argparse, json, os, re
import fitz  # PyMuPDF
from PIL import Image

CAP_RE = re.compile(r"^\s*Figs?\.?\s*(\d+\.\d+\.\d+)", re.I)
MAXPX = 1100


def caption_blocks(page):
    blocks = [b for b in page.get_text("blocks") if b[6] == 0]
    caps = []
    for i, b in enumerate(blocks):
        t = b[4].strip()
        m = CAP_RE.match(t)
        if not m:
            continue
        x0, y0, x1, y1 = b[:4]
        text = " ".join(t.split())
        # continuation lines: blocks right below in the same column, not another caption
        for c in blocks:
            if c is b or CAP_RE.match(c[4].strip()):
                continue
            if 0 <= c[1] - y1 <= 4 and abs(c[0] - x0) < 40 and c[2] <= x1 + 60:
                text += " " + " ".join(c[4].split())
                y1 = c[3]
        nums = re.findall(r"Figs?\.?\s*(\d+\.\d+\.\d+)", text)
        if len(nums) > 1 and re.fullmatch(r"(\s*Figs?\.?\s*\d+\.\d+\.\d+[A-Z]?\s*)+", text):
            # a row of bare numbers under a row of pictures: split the caption block evenly left to right
            w = (x1 - x0) / len(nums)
            for k, n in enumerate(nums):
                caps.append({"fig": n, "bbox": [x0 + k * w, b[1], x0 + (k + 1) * w, y1], "text": "Fig. " + n, "row": True})
            continue
        caps.append({"fig": m.group(1), "bbox": [x0, b[1], x1, y1], "text": text})
    return caps


def overlap_x(a, b, slack=0):
    return min(a[2], b[2]) + slack > max(a[0], b[0])


def figure_box(infos, cap, page_rect):
    cx0, cy0, cx1, _ = cap["bbox"]
    imgs = [i["bbox"] for i in infos if i["bbox"][1] >= 0 and i["bbox"][3] <= page_rect.y1 + 1 and (i["bbox"][2] - i["bbox"][0]) * (i["bbox"][3] - i["bbox"][1]) > 0.5]
    near = [b for b in imgs if b[3] <= cy0 + 3 and b[3] >= cy0 - 30]
    seed = [b for b in near if overlap_x(b, [cx0 + 5, 0, cx1 - 5, 0])]
    if not seed:
        seed = [b for b in near if overlap_x(b, [cx0 - 40, 0, cx1 + 40, 0])]
    if not seed:
        return None, 0
    box = [min(b[0] for b in seed), min(b[1] for b in seed), max(b[2] for b in seed), max(b[3] for b in seed)]
    used = set(id(b) for b in seed)
    grown = True
    while grown:
        grown = False
        for b in imgs:
            if id(b) in used or b[3] > cy0 + 3:
                continue
            if b[0] <= box[2] + 3 and b[2] >= box[0] - 3 and b[1] <= box[3] + 3 and b[3] >= box[1] - 3:
                box = [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
                used.add(id(b)); grown = True
    box = [max(box[0], 0), max(box[1], 0), min(box[2], page_rect.x1), min(box[3], cy0 + 1)]
    return box, len(used)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", default=os.path.expanduser("~/prep-data/radnotes/max"))
    ap.add_argument("--pages", default="")
    ap.add_argument("--zoom", type=float, default=2.0)
    a = ap.parse_args()
    d = fitz.open(a.pdf)
    p0, p1 = (1, len(d))
    if a.pages:
        p0, p1 = [int(x) for x in a.pages.split("-")]
    os.makedirs(os.path.join(a.out, "figs"), exist_ok=True)
    out, seen = [], set()
    for pn in range(p0, p1 + 1):
        page = d[pn - 1]
        infos = page.get_image_info()
        for cap in caption_blocks(page):
            box, tiles = figure_box(infos, cap, page.rect)
            if not box or (box[2] - box[0]) < 40 or (box[3] - box[1]) < 40:
                continue
            fid = "r11-" + cap["fig"]
            if fid in seen:
                fid += "-p%d" % pn
            seen.add(fid)
            pix = page.get_pixmap(matrix=fitz.Matrix(a.zoom, a.zoom), clip=fitz.Rect(*box), alpha=False)
            im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            im.thumbnail((MAXPX, MAXPX))
            rel = "figs/" + fid + ".webp"
            im.save(os.path.join(a.out, rel), "WEBP", quality=80)
            out.append({"id": fid, "page": pn, "fig": cap["fig"], "caption": cap["text"], "bbox": [round(v, 1) for v in box],
                        "w": im.width, "h": im.height, "file": rel, "tiles": tiles})
    json.dump(out, open(os.path.join(a.out, "figs.r11.json"), "w"), indent=1)
    print("figures", len(out), "pages", p0, "-", p1)


if __name__ == "__main__":
    main()
