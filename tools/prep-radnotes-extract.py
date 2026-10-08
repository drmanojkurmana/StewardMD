#!/usr/bin/env python3
"""PrepNucleus radnotes: cut every figure out of the owner's own radiology notes PDFs. Dev-only, never shipped.

The PDFs and everything cut from them are PRIVATE (the repo is public): this script holds no PDF text, reads the PDFs
from the paths given and writes only under --out (default ~/prep-data/radnotes). Needs PyMuPDF and Pillow.

  python3 tools/prep-radnotes-extract.py --pdf 1=<notes1.pdf> --pdf 2=<notes2.pdf> [--out DIR]

Writes  DIR/src/blocks<k>.json   reading-order text blocks per page { p, x0, y0, x1, y1, c, t }
        DIR/figs/<id>.webp       each embedded picture rendered from the page at its placed size (burned-in labels and
                                 arrows kept, page furniture outside the picture dropped), longest side <= 1280 px
        DIR/figs.raw.json        [{ id, pdf, page, bbox, w, h, file, caption, cite, panel, fig, near }] before QA
Captions: notes 1 numbers its figures ("Fig.2-15: ..."), so a picture takes the caption of its figure on the page (or the
figure "continued" from the page before) and its panel letter; the cite text is every paragraph that names the figure.
Notes 2 has no numbers: a picture takes the nearest text blocks beside or below it as its caption.
"""
import argparse, json, os, re, sys
import fitz  # PyMuPDF
from PIL import Image

MAXPX = 1280
FIG_RE = re.compile(r"^\s*Fig\s*\.?\s*([0-9Il]{1,2})\s*[-.]\s*([0-9IlO ]{1,4})\s*[:;.]", re.I)
REF_RE = re.compile(r"fig\s*\.?\s*([0-9Il]{1,2})\s*-\s*([0-9IlO][0-9IlO ]{0,3})\s*([A-E](?:\s*[A-E]){0,4})?", re.I)
PYQ_RE = re.compile(r"\b(NEET|AIIMS|INICET|INI-CET|JIPMER|PGI|MEET|NIEET)\b|\[\s*(NEET|AIIMS)", re.I)

def num(s):
    s = s.replace(" ", "").replace("I", "1").replace("l", "1").replace("O", "0")
    return int(s) if s.isdigit() else None

def blocks_of(page):
    W = page.rect.width
    out = []
    for b in page.get_text("blocks"):
        if b[6] != 0 or not b[4].strip():
            continue
        t = re.sub(r"\s*\n\s*", " ", b[4]).strip()
        c = 0 if b[2] - b[0] > W * 0.6 else (1 if (b[0] + b[2]) / 2 < W / 2 else 2)
        out.append({"x0": b[0], "y0": b[1], "x1": b[2], "y1": b[3], "c": c, "t": t})
    left = sorted([b for b in out if b["c"] != 2], key=lambda b: b["y0"])
    right = sorted([b for b in out if b["c"] == 2], key=lambda b: b["y0"])
    return left + right

def dist(r, b):
    dx = max(b["x0"] - r.x1, r.x0 - b["x1"], 0)
    dy = max(b["y0"] - r.y1, r.y0 - b["y1"], 0)
    return (dx * dx + dy * dy) ** 0.5

def render(page, rect, xref, path, doc):
    try:
        info = doc.extract_image(xref)
        native = max(info.get("width", 0), info.get("height", 0))
    except Exception:
        native = 0
    side = max(rect.width, rect.height)
    target = min(MAXPX, max(native, side * 2))
    zoom = max(1.0, target / side)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=rect & page.rect, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if max(img.size) > MAXPX:
        img.thumbnail((MAXPX, MAXPX), Image.LANCZOS)
    img.save(path, "WEBP", quality=80, method=6)
    return img.size

def extract(k, pdf, out):
    doc = fitz.open(pdf)
    figs, allblocks, seen = [], [], set()
    last_fig = None  # notes 1: the figure a "continued" page carries on
    for i, page in enumerate(doc):
        pno = i + 1
        bl = blocks_of(page)
        for b in bl:
            allblocks.append({"p": pno, **{kk: (round(v) if isinstance(v, float) else v) for kk, v in b.items()}})
        caps = []
        for b in bl:
            m = FIG_RE.match(b["t"])
            if m and num(m.group(1)) and num(m.group(2)):
                caps.append((f"{num(m.group(1))}-{num(m.group(2))}", b))
            elif re.match(r"^\s*Fig\s*\.?\s*[0-9Il]{1,2}\s*-\s*[0-9IlO ]{1,4}\s*:?\s*\(?continued", b["t"], re.I):
                m2 = re.match(r"^\s*Fig\s*\.?\s*([0-9Il]{1,2})\s*-\s*([0-9IlO ]{1,4})", b["t"], re.I)
                caps.append((f"{num(m2.group(1))}-{num(m2.group(2))}", dict(b, cont=True)))
        letters = [b for b in bl if re.fullmatch(r"[A-E]", b["t"])]
        n = 0
        for x in page.get_images(full=True):
            xref = x[0]
            for r in page.get_image_rects(xref):
                if r.width < 70 or r.height < 70:
                    continue
                key = (pno, round(r.x0), round(r.y0))
                if key in seen:
                    continue
                seen.add(key)
                n += 1
                fid = f"n{k}-p{pno:03d}-{n}"
                path = os.path.join(out, "figs", fid + ".webp")
                w, h = render(page, r, xref, path, doc)
                near = sorted([b for b in bl if not re.fullmatch(r"[A-E\d ]{1,3}", b["t"])], key=lambda b: dist(r, b))[:3]
                rec = {"id": fid, "pdf": k, "page": pno, "bbox": [round(r.x0), round(r.y0), round(r.x1), round(r.y1)], "w": w, "h": h,
                       "file": f"figs/{fid}.webp", "near": [b["t"][:400] for b in near]}
                # PYQ screenshots and question pages: flagged, never used (third-party question material)
                rec["pyq"] = bool(any(PYQ_RE.search(b["t"]) and dist(r, b) < 120 for b in bl))
                if k == 1:
                    if caps:
                        fig, cb = min(caps, key=lambda c: dist(r, c[1]))
                    else:
                        fig, cb = (last_fig, None)
                    rec["fig"] = fig
                    if cb is not None and not cb.get("cont"):
                        rec["caption"] = cb["t"]
                    lt = [b for b in letters if dist(r, b) < 40]
                    rec["panel"] = min(lt, key=lambda b: dist(r, b))["t"] if lt else ""
                else:
                    cand = [b for b in near if dist(r, b) < 90 and len(b["t"]) > 12]
                    rec["caption"] = " ".join(b["t"] for b in cand[:2])[:700]
                figs.append(rec)
        if k == 1 and caps:
            last_fig = caps[-1][0]
    if k == 1:
        bycap = {}
        for b in allblocks:
            m = FIG_RE.match(b["t"])
            if m and num(m.group(1)) and num(m.group(2)):
                bycap.setdefault(f"{num(m.group(1))}-{num(m.group(2))}", b["t"])
        cites = {}
        for b in allblocks:
            if FIG_RE.match(b["t"]):
                continue
            for m in REF_RE.finditer(b["t"]):
                a, c = num(m.group(1)), num(m.group(2))
                if a and c:
                    cites.setdefault(f"{a}-{c}", [])
                    if b["t"] not in cites[f"{a}-{c}"]:
                        cites[f"{a}-{c}"].append(b["t"])
        for f in figs:
            if f.get("fig"):
                f["caption"] = f.get("caption") or bycap.get(f["fig"], "")
                f["cite"] = " ".join(cites.get(f["fig"], []))[:1500]
    json.dump(allblocks, open(os.path.join(out, "src", f"blocks{k}.json"), "w"), indent=0)
    return figs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", action="append", required=True, help="k=path")
    ap.add_argument("--out", default=os.path.expanduser("~/prep-data/radnotes"))
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "figs"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "src"), exist_ok=True)
    allf = []
    for spec in a.pdf:
        k, p = spec.split("=", 1)
        allf += extract(int(k), p, a.out)
    json.dump(allf, open(os.path.join(a.out, "figs.raw.json"), "w"), indent=1)
    print(f"{len(allf)} pictures; pyq-flagged {sum(f['pyq'] for f in allf)}; notes1 without figure number {sum(1 for f in allf if f['pdf']==1 and not f.get('fig'))}")

if __name__ == "__main__":
    main()
