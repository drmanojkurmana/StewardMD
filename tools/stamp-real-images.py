# Stamp one StewardMD watermark (logo + name, bottom-right) on every realistic lesson image.
# Idempotent: always stamps from the unstamped copy, which it makes on first run, so re-running never double-stamps.
# Keep the unstamped store outside the repo (e.g. ~/Documents/stewardmd-image-originals/<module>).
# Usage (from the repo root): python3 tools/stamp-real-images.py <module-root e.g. tokos> <unstamped-dir> [name ...]
import glob, json, os, sys, shutil
from PIL import Image, ImageDraw, ImageFont

ROOT, UN = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
LOGO = Image.open("logo.png").convert("RGBA")
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
GREEN = (31, 92, 69, 255)

os.makedirs(UN, exist_ok=True)
spots = {}
for f in glob.glob(f"{ROOT}/learn/lessons/*.json"):
    s = json.load(open(f)).get("see", {})
    if s.get("img"):
        spots.setdefault(os.path.basename(s["img"]), []).extend(s.get("hotspots", []))
for p in sorted(glob.glob(f"{ROOT}/learn/media/real/*.webp")):
    name = os.path.basename(p)
    if only and name[:-5] not in only:
        continue
    keep = os.path.join(UN, name)
    if not os.path.exists(keep):
        shutil.copy2(p, keep)
    im = Image.open(keep).convert("RGBA")
    W, H = im.size
    lh = max(28, round(W * 0.055))           # logo height
    font = ImageFont.truetype(FONT, round(lh * 0.46))
    pad, m = round(lh * 0.22), round(W * 0.015)
    tw = ImageDraw.Draw(im).textbbox((0, 0), "StewardMD", font=font)[2]
    bw, bh = lh + tw + 3 * pad, lh + 2 * pad
    x0, y0 = W - m - bw, H - m - bh          # always bottom-right
    for h in spots.get(name, []):            # never cover a tap label: step up above it, still on the right
        hx, hy = h["x"] * W, h["y"] * H
        if hx > x0 - 16 and hy > y0 - 16:
            y0 = min(y0, round(hy - 22 - bh))
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=bh // 2, fill=(255, 255, 255, 190))
    layer.alpha_composite(LOGO.resize((lh, lh), Image.LANCZOS), (x0 + pad, y0 + pad))
    d.text((x0 + 2 * pad + lh, y0 + bh / 2), "StewardMD", font=font, fill=GREEN, anchor="lm")
    Image.alpha_composite(im, layer).convert("RGB").save(p, "WEBP", quality=82, method=6)
    print(f"{name}: {os.path.getsize(p) // 1024}KB")
