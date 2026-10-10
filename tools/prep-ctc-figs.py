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
     tables and text fail this. The model figure check (prep-radbook figqa prompt) and two Haiku votes judge the rest;
  4. the box then gets a margin (margin_box): a label or arrow caption the edge cuts is taken in whole, strokes that run
     over the edge are followed a little, body text and the other figures stay out, and a few px of clear page pad it.
     Steps 1-2 mask the OCR words, so without this a label beside a picture lost its first letters ("ervosa").
Writes  DIR/figs/ctc-p<page>-<n>.webp   (crop of the embedded page image, longest side <= 1100 px)
        DIR/figs.ctc.json              [{ id, page, bbox (page points), px (image pixels, with the margin), px0 (before
                                       the margin), w, h, file, near, stats }]
        DIR/work/figsheet/p<page>.png   (--sheet: page with the kept boxes drawn, for a visual check)
"""
import argparse, io, json, math, os, re
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



def _hit(a, b, m=0):
    return a[0] < b[2] + m and b[0] < a[2] + m and a[1] < b[3] + m and b[1] < a[3] + m


def _inside(a, b, m=0):
    return a[0] >= b[0] - m and a[1] >= b[1] - m and a[2] <= b[2] + m and a[3] <= b[3] + m


def grow_box(gray, blocks, box, others=(), *, ink=200, step=2, strip=3, ink_cap=24, cap_rel=0.6, cap_min=90, cap_max=200,
             pad=8, clear=215, body_words=4, shrink=0):
    """Grow a figure crop until no word and no stroke is cut at its edge, without taking in body text or another figure.

    gray: PIL L image of the page; blocks: [{"box": [x0, y0, x1, y1], "words": [[x0, y0, x1, y1], ...]}] text blocks in
    the same pixels; box: the crop [x0, y0, x1, y1]; others: the other figure crops on the page.
      1. a text block whose words the crop edge cuts (a label, an arrow caption) is taken in whole, unless that grows a
         side by more than cap_rel of the crop (at least cap_min, at most cap_max px) or meets body text or a figure;
      2. each side grows in `step` px while the strip just outside holds ink (gray < ink), at most ink_cap px in all,
         stopping short of body text (blocks of body_words+ words the crop does not touch), blocks left out in 1, and
         the other figures;
      3. 1 and 2 repeat until nothing changes; a block still cut and mostly outside (body text) has its edge pulled back
         past it when that costs at most `shrink` of the crop (off by default: on this book's scans OCR blocks overlap
         the pictures, and pulling an edge back cut into the drawing); then up to `pad` px of clear page is added.
    Returns (newbox, info): cut (blocks taken in), left (blocks still cut), shrunk, grow (px per side before padding),
    pad, resid (sides that still have ink just outside)."""
    W, H = gray.size
    px = gray.load()
    o = [int(round(v)) for v in box]
    x0, y0, x1, y1 = o
    ow, oh = o[2] - o[0], o[3] - o[1]
    capx = min(max(cap_rel * ow, cap_min), cap_max)
    capy = min(max(cap_rel * oh, cap_min), cap_max)
    stops = [list(b) for b in others if not _hit(b, o)] + [b["box"] for b in blocks if b.get("stop")]
    body = [b["box"] for b in blocks if len(b["words"]) >= body_words and not _hit(b["box"], o)]
    taken, left, inkg = [], [], {"l": 0, "t": 0, "r": 0, "b": 0}

    def free(nb, skip=None):
        if o[0] - nb[0] > capx or nb[2] - o[2] > capx or o[1] - nb[1] > capy or nb[3] - o[3] > capy:
            return False
        if any(_hit(nb, s) for s in stops):
            return False
        return not any(_hit(nb, b, 1) for b in body + left if b is not skip and b not in taken)

    def cut_words(b, bx):
        return [w for w in b["words"] if _hit(w, bx) and not _inside(w, bx)]

    def inked(s):
        n = 0
        if s in "lr":
            xs = range(x0 - strip, x0) if s == "l" else range(x1, x1 + strip)
            pts = ((x, y) for x in xs for y in range(y0, y1))
        else:
            ys = range(y0 - strip, y0) if s == "t" else range(y1, y1 + strip)
            pts = ((x, y) for y in ys for x in range(x0, x1))
        for x, y in pts:
            if 0 <= x < W and 0 <= y < H and px[x, y] < ink:
                n += 1
                if n >= 3:
                    return True
        return False

    for _ in range(6):
        changed = False
        for b in blocks:
            bb = b["box"]
            if b.get("stop") or bb in taken or bb in left or not cut_words(b, [x0, y0, x1, y1]):
                continue
            nb = [max(0, min(x0, int(bb[0]) - 1)), max(0, min(y0, int(bb[1]) - 1)), min(W, max(x1, int(bb[2]) + 2)), min(H, max(y1, int(bb[3]) + 2))]
            if free(nb, bb):
                x0, y0, x1, y1 = nb; taken.append(bb); changed = True
            else:
                left.append(bb)
        for s in "lrtb":
            while inkg[s] < ink_cap and inked(s):
                nb = [x0 - step if s == "l" else x0, y0 - step if s == "t" else y0, x1 + step if s == "r" else x1, y1 + step if s == "b" else y1]
                if nb[0] < 0 or nb[1] < 0 or nb[2] > W or nb[3] > H or not free(nb):
                    break
                x0, y0, x1, y1 = nb; inkg[s] += step; changed = True
        if not changed:
            break
    left = [bb for bb in left if not _inside(bb, [x0, y0, x1, y1], 1) and any(cut_words(b, [x0, y0, x1, y1]) for b in blocks if b["box"] is bb)]
    shrunk, done = [], set()
    for bb in list(left):
        ba = max(1e-6, (bb[2] - bb[0]) * (bb[3] - bb[1]))
        ix = max(0, min(bb[2], x1) - max(bb[0], x0)) * max(0, min(bb[3], y1) - max(bb[1], y0))
        if ix / ba > 0.5:
            continue  # mostly inside: a label too big to take in; leave it
        cand = []
        if bb[1] > (y0 + y1) / 2: cand.append(("b", y1 - int(bb[1] - 2), oh))
        if bb[3] < (y0 + y1) / 2: cand.append(("t", int(bb[3] + 2) - y0, oh))
        if bb[0] > (x0 + x1) / 2: cand.append(("r", x1 - int(bb[0] - 2), ow))
        if bb[2] < (x0 + x1) / 2: cand.append(("l", int(bb[2] + 2) - x0, ow))
        cand = [c for c in cand if c[0] not in done and 0 < c[1] <= shrink * c[2]]
        if not cand:
            continue
        s, k, _ = min(cand, key=lambda c: c[1])
        nb = [x0 + k * (s == "l"), y0 + k * (s == "t"), x1 - k * (s == "r"), y1 - k * (s == "b")]
        if cut_count(blocks, nb, skip=bb) > cut_count(blocks, [x0, y0, x1, y1], skip=bb):
            continue  # pulling back would cut another label
        x0, y0, x1, y1 = nb
        done.add(s); left.remove(bb); shrunk.append(bb)
    resid = [s for s in "lrtb" if inked(s)]
    grow = {"l": o[0] - x0, "t": o[1] - y0, "r": x1 - o[2], "b": y1 - o[3]}

    def clear_line(s):
        if s == "l": pts = ((x0 - 1, y) for y in range(y0, y1))
        elif s == "r": pts = ((x1, y) for y in range(y0, y1))
        elif s == "t": pts = ((x, y0 - 1) for x in range(x0, x1))
        else: pts = ((x, y1) for x in range(x0, x1))
        if not all(0 <= x < W and 0 <= y < H and px[x, y] >= clear for x, y in pts):
            return False
        nb = [x0 - (s == "l"), y0 - (s == "t"), x1 + (s == "r"), y1 + (s == "b")]
        return not any(_hit(w, nb) and not _inside(w, nb) and not _inside(w, [x0, y0, x1, y1]) for w in words)
    words = [w for b in blocks for w in b["words"] if not _inside(w, [x0, y0, x1, y1])]
    p = {}
    for s in "lrtb":
        k = 0
        while k < pad and clear_line(s):
            if s == "l": x0 -= 1
            elif s == "r": x1 += 1
            elif s == "t": y0 -= 1
            else: y1 += 1
            k += 1
        p[s] = k
    r = lambda bs: [[round(v) for v in b] for b in bs]
    return [x0, y0, x1, y1], {"cut": r(taken), "left": r(left), "shrunk": r(shrunk), "grow": grow, "pad": p, "resid": resid}


def cut_count(blocks, box, skip=None):
    """Words the crop edge cuts (partly inside), not counting block `skip`."""
    return sum(1 for b in blocks if b["box"] is not skip for w in b["words"] if _hit(w, box) and not _inside(w, box))


def page_blocks(page, sx, sy, stop_re=None):
    """Text blocks of a PyMuPDF page in image pixels: [{"box", "words"}] (words with a letter or digit only)."""
    by = {}
    for w in page.get_text("words"):
        if not any(c.isalnum() for c in w[4]):
            continue
        by.setdefault(w[5], []).append(([w[0] * sx, w[1] * sy, w[2] * sx, w[3] * sy], w[4]))
    out = []
    for ws in by.values():
        bx = [w for w, _ in ws]
        b = {"box": [min(w[0] for w in bx), min(w[1] for w in bx), max(w[2] for w in bx), max(w[3] for w in bx)], "words": bx}
        if stop_re and stop_re.match(" ".join(t for _, t in ws)):
            b["stop"] = True
        out.append(b)
    return out


def margin_box(gray, blocks, box, others=()):
    """The crop with its margin (grow_box), conservatively: when no word was cut and the strokes at an edge run on past
    the follow limit (a drawing that continues into its neighbours), only labels and padding are added; a result that
    cuts more words than the plain box falls back the same way."""
    nb, info = grow_box(gray, blocks, box, others)
    grown = [k for k, v in info["grow"].items() if v > 0]
    if cut_count(blocks, nb) > cut_count(blocks, box) or (not cut_count(blocks, box) and any(k in info["resid"] for k in grown)):
        nb, info = grow_box(gray, blocks, box, others, ink_cap=0)
    return nb, info


def page_figures(page, doc):
    imgs = page.get_images(full=True)
    if not imgs:
        return None, [], None, None
    xref = imgs[0][0]
    raw = doc.extract_image(xref)
    im = Image.open(io.BytesIO(raw["image"])).convert("RGB")
    W, H = im.size
    if W < 200 or H < 200:
        return None, [], None, None  # a placeholder image (blank page)
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
    return im, figs, gray, page_blocks(page, sx, sy)


def main():
    import fitz  # PyMuPDF
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
        im, figs, gray, tblocks = page_figures(page, d)
        if im is None:
            continue
        sx, sy = im.width / page.rect.width, im.height / page.rect.height
        for f in figs:
            f["bx0"] = f["bx"]
            f["bx"], _ = margin_box(gray, tblocks, f["bx0"], [g["bx0"] if "bx0" in g else g["bx"] for g in figs if g is not f])
            f["pb"] = [round(f["bx"][0] / sx, 1), round(f["bx"][1] / sy, 1), round(f["bx"][2] / sx, 1), round(f["bx"][3] / sy, 1)]
        for k, f in enumerate(figs):
            fid = "ctc-p%04d-%d" % (pn, k + 1)
            crop = im.crop(f["bx"])
            crop.thumbnail((MAXPX, MAXPX))
            rel = "figs/" + fid + ".webp"
            crop.save(os.path.join(a.out, rel), "WEBP", quality=85)
            out.append({"id": fid, "page": pn, "bbox": f["pb"], "px": f["bx"], "px0": f["bx0"], "w": crop.width, "h": crop.height, "file": rel, "near": f["near"], "stats": f["stats"]})
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
