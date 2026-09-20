#!/usr/bin/env python3
"""perturb.py — photographic robustness cases derived from the REAL Philips IntelliVue MP40 photo.

    python3 bench/icu-monitor/perturb.py

Writes fixtures/perturbed/<id>.jpg + <id>.json (group "perturbed-real"). Ground truth is copied from
the real 900 px case and changed ONLY where a perturbation physically removes or truncates a value:
  - a crop that cuts a reading off entirely  -> "not_visible"
  - a crop or glare patch that truncates / covers part of a reading -> "ambiguous"
    (auto-filling an ambiguous value scores as a silent guess even if the digits happen to match)
Photometric and geometric perturbations keep every field "visible": review is the safe answer for
an image that became hard, a wrong auto-fill is the failure. Deterministic (no randomness)."""
import json, os, copy, io
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BASE_JSON = os.path.join(HERE, "fixtures", "real", "philips-mp40-owner-900px.json")
OUT = os.path.join(HERE, "fixtures", "perturbed")
os.makedirs(OUT, exist_ok=True)
base_gt = json.load(open(BASE_JSON))
base = Image.open(os.path.join(HERE, "fixtures", "real", base_gt["image"])).convert("RGB")
W, H = base.size

def solve(a, b):
    n = len(b); m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c])); m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [m[r][k] - f * m[c][k] for k in range(n + 1)]
    return [m[i][n] / m[i][i] for i in range(n)]

def perspective(img, shift):
    """Keystone: the top edge narrows by `shift` of the width on each side (camera below and off-axis)."""
    w, h = img.size
    dst = [(0, 0), (w, 0), (w, h), (0, h)]
    src = [(w * shift, h * shift * 0.4), (w * (1 - shift * 0.5), 0), (w, h), (0, h * (1 - shift * 0.3))]
    # coefficients mapping OUTPUT (dst) pixels to INPUT (src) pixels
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return img.transform((w, h), Image.PERSPECTIVE, solve(a, b), Image.BICUBIC, fillcolor=(40, 40, 40))

def glare(img, rect, alpha):
    x0, y0, x1, y1 = rect
    over = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(over)
    steps = 14
    for s in range(steps):
        k = s / steps
        a = int(255 * alpha * (1 - k) ** 0.6)
        dx, dy = (x1 - x0) * k * 0.5, (y1 - y0) * k * 0.5
        d.ellipse([(x0 - dx) * W, (y0 - dy) * H, (x1 + dx) * W, (y1 + dy) * H], fill=(255, 255, 250, max(0, a // steps * 3)))
    core = Image.new("RGBA", img.size, (0, 0, 0, 0)); ImageDraw.Draw(core).ellipse([x0 * W, y0 * H, x1 * W, y1 * H], fill=(255, 255, 250, int(255 * alpha)))
    return Image.alpha_composite(Image.alpha_composite(img.convert("RGBA"), over), core).convert("RGB")

def jpeg(img, q):
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=q); buf.seek(0); return Image.open(buf).convert("RGB")

VIS = {"status": "visible"}
CASES = [
    # id, description, function, truth overrides {field: status-or-dict}
    ("resize-050", {"resize": 0.5}, lambda im: im.resize((W // 2, H // 2), Image.LANCZOS), {}),
    ("resize-035", {"resize": 0.35}, lambda im: im.resize((int(W * 0.35), int(H * 0.35)), Image.LANCZOS), {}),
    ("jpeg-q30", {"jpeg": 30}, lambda im: jpeg(im, 30), {}),
    ("jpeg-q10", {"jpeg": 10}, lambda im: jpeg(im, 10), {}),
    ("brightness-055", {"brightness": 0.55}, lambda im: ImageEnhance.Brightness(im).enhance(0.55), {}),
    ("brightness-160", {"brightness": 1.6}, lambda im: ImageEnhance.Brightness(im).enhance(1.6), {}),
    ("contrast-055", {"contrast": 0.55}, lambda im: ImageEnhance.Contrast(im).enhance(0.55), {}),
    ("contrast-160", {"contrast": 1.6}, lambda im: ImageEnhance.Contrast(im).enhance(1.6), {}),
    ("blur-r1", {"gaussianBlur": 1.0}, lambda im: im.filter(ImageFilter.GaussianBlur(1.0)), {}),
    ("blur-r2_5", {"gaussianBlur": 2.5}, lambda im: im.filter(ImageFilter.GaussianBlur(2.5)), {}),
    ("blur-r4", {"gaussianBlur": 4.0}, lambda im: im.filter(ImageFilter.GaussianBlur(4.0)), {}),
    ("glare-moderate", {"glare": "alpha 0.45 between SpO2 and ART values"}, lambda im: glare(im, (0.60, 0.515, 0.80, 0.56), 0.45), {}),
    ("glare-severe-hr", {"glare": "alpha 0.97 over the HR value"}, lambda im: glare(im, (0.565, 0.455, 0.725, 0.505), 0.97),
        # visual check (2026-09-14): a faint "105" stays legible at the glare edge, so HR is ambiguous, not absent
        {"hr": {"status": "ambiguous", "value": 105, "why": "HR value under glare, only faintly legible"}}),
    ("rotate-05", {"rotate": 5}, lambda im: im.rotate(5, Image.BICUBIC, expand=True, fillcolor=(40, 40, 40)), {}),
    ("rotate-12", {"rotate": 12}, lambda im: im.rotate(12, Image.BICUBIC, expand=True, fillcolor=(40, 40, 40)), {}),
    ("rotate-25", {"rotate": 25}, lambda im: im.rotate(25, Image.BICUBIC, expand=True, fillcolor=(40, 40, 40)), {}),
    ("perspective-mild", {"perspective": 0.06}, lambda im: perspective(im, 0.06), {}),
    ("perspective-strong", {"perspective": 0.18}, lambda im: perspective(im, 0.18), {}),
    ("crop-bottom-rr", {"crop": "bottom edge at y=0.600 removes RR"}, lambda im: im.crop((0, 0, W, int(H * 0.600))),
        {"rr": {"status": "not_visible", "why": "cropped away"}}),
    ("crop-right-truncates", {"crop": "right edge at x=0.740 truncates 149/66 and PVC, removes Pulse"}, lambda im: im.crop((0, 0, int(W * 0.740), H)),
        {"sbp": {"status": "ambiguous", "value": 149, "why": "reading truncated by the crop"}, "dbp": {"status": "ambiguous", "value": 66, "why": "reading truncated by the crop"},
         "map": {"status": "ambiguous", "value": 98, "why": "reading truncated by the crop"}, "art": {"status": "ambiguous", "value": {"sbp": 149, "dbp": 66, "map": 98}, "why": "truncated"},
         "pulse": {"status": "not_visible", "why": "cropped away"}, "pvc": {"status": "ambiguous", "value": 0, "why": "truncated"}}),
]

written = []
for cid, desc, fn, over in CASES:
    img = fn(base.copy())
    name = "philips-mp40-" + cid
    path = os.path.join(OUT, name + ".jpg")
    img.save(path, "JPEG", quality=95)
    gt = copy.deepcopy(base_gt)
    gt.update({"id": name, "image": name + ".jpg", "imageSize": {"w": img.size[0], "h": img.size[1]}, "synthetic": False,
               "group": "perturbed-real", "derivedFrom": base_gt["id"], "perturbation": desc,
               "difficulty": ["perturbed"] + list(desc.keys())})
    for k, v in over.items():
        gt["fields"][k] = v
    gt["notes"] = "Derived from the owner's real MP40 photo by perturb.py; truth changed only for fields listed in the perturbation's overrides."
    json.dump(gt, open(os.path.join(OUT, name + ".json"), "w"), indent=2)
    written.append((name, img.size))
for n, s in written:
    print(n, "%dx%d" % s)
print(len(written), "cases ->", OUT)
