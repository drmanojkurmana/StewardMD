#!/usr/bin/env python3
"""PrepNucleus radbook: blur patient identifiers (names, initials, IDs, exam dates and numbers) burned into lesson
figures. Dev-only. Input: a JSON list [{ "id", "file", "idtext": [strings], "boxes": [[x0, y0, x1, y1] fractions]? }].
Text is located with tesseract (word boxes on a 2x upscale); every word that matches an identifier token is blurred
with padding. Hand boxes (fractions of width and height) are blurred as given. Output: <out>/<id>.webp and
<out>/result.json { files: { id: path }, misses: [{ id, missing: [tokens] }] }. Labels, arrows and captions stay.

  python3 tools/prep-radbook-blur.py <in.json> <outdir>
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image, ImageFilter


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def ocr_words(img):
    big = img.convert("L").resize((img.width * 2, img.height * 2), Image.LANCZOS)
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "x.png")
        big.save(p)
        out = subprocess.run(["tesseract", p, "stdout", "--psm", "11", "tsv"], capture_output=True, text=True).stdout
    words = []
    for line in out.splitlines()[1:]:
        c = line.split("\t")
        if len(c) < 12 or not c[11].strip():
            continue
        x, y, w, h = (int(c[6]) // 2, int(c[7]) // 2, int(c[8]) // 2, int(c[9]) // 2)
        words.append({"t": c[11], "n": norm(c[11]), "box": (x, y, x + w, y + h)})
    return words


def blur_box(img, box, pad):
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(img.width, x1 + pad), min(img.height, y1 + pad)
    if x1 <= x0 or y1 <= y0:
        return
    reg = img.crop((x0, y0, x1, y1))
    # pixelate then blur: unreadable, and no faint text survives
    small = reg.resize((max(1, (x1 - x0) // 8), max(1, (y1 - y0) // 8)), Image.BILINEAR).resize(reg.size, Image.NEAREST)
    img.paste(small.filter(ImageFilter.GaussianBlur(6)), (x0, y0))


def main(inp, outdir):
    os.makedirs(outdir, exist_ok=True)
    items = json.load(open(inp))
    res = {"files": {}, "misses": [], "boxes": {}}
    for it in items:
        img = Image.open(it["file"]).convert("RGB")
        words = ocr_words(img)
        boxes, missing = [], []
        for tok in it.get("idtext") or []:
            parts = [norm(p) for p in re.split(r"[\s/:,.-]+", tok) if len(norm(p)) >= 2]
            hit = False
            for p in parts:
                for w in words:
                    if w["n"] and (w["n"] == p or (len(p) >= 4 and (p in w["n"] or w["n"] in p))):
                        boxes.append(w["box"])
                        hit = True
            if not hit:
                missing.append(tok)
        for fb in it.get("boxes") or []:
            boxes.append((int(fb[0] * img.width), int(fb[1] * img.height), int(fb[2] * img.width), int(fb[3] * img.height)))
        pad = max(3, img.height // 120)
        for b in boxes:
            blur_box(img, b, pad)
        if boxes:
            p = os.path.abspath(os.path.join(outdir, it["id"] + ".webp"))
            img.save(p, "WEBP", quality=88)
            res["files"][it["id"]] = p
            res["boxes"][it["id"]] = [list(b) for b in boxes]
        if missing or not boxes:
            res["misses"].append({"id": it["id"], "missing": missing or it.get("idtext") or []})
    json.dump(res, open(os.path.join(outdir, "result.json"), "w"), indent=1)
    print(json.dumps({"figures": len(items), "blurred": len(res["files"]), "misses": len(res["misses"])}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
