# Stamp the StewardMD logo and name on every realistic lesson image: a corner badge plus a tiled diagonal mark, so a
# crop or screenshot still carries it. Idempotent: always stamps from the unstamped copy (made on first run).
# Usage: python3 tools/stamp-real-images.py <module-root e.g. tokos> <unstamped-dir> [name ...]
import json, glob, os, sys, shutil
from PIL import Image, ImageDraw, ImageFont, ImageStat
ROOT, UN = sys.argv[1], sys.argv[2]            # module root (e.g. tokos) and unstamped store
only = set(sys.argv[3:])
LOGO = Image.open("logo.png").convert("RGBA")
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
GREEN = (31, 92, 69, 255)
spots = {}
for f in glob.glob(f"{ROOT}/learn/lessons/*.json"):
    s = json.load(open(f)).get("see", {})
    if s.get("img"): spots[os.path.basename(s["img"])] = s.get("hotspots", [])
for p in sorted(glob.glob(f"{ROOT}/learn/media/real/*.webp")):
    name = os.path.basename(p)
    if only and name[:-5] not in only: continue
    keep = os.path.join(UN, name)
    if not os.path.exists(keep): shutil.copy2(p, keep)
    im = Image.open(keep).convert("RGBA"); W, H = im.size
    lh = max(28, round(W * 0.055)); fs = round(lh * 0.46); pad = round(lh * 0.22); m = round(W * 0.015)
    font = ImageFont.truetype(FONT, fs); logo = LOGO.resize((lh, lh), Image.LANCZOS)
    tw = ImageDraw.Draw(im).textbbox((0, 0), "StewardMD", font=font)[2]
    bw, bh = lh + tw + 3 * pad, lh + 2 * pad
    hs = spots.get(name, [])
    def clear(x0):  # no hotspot inside the badge box (with margin)
        return all(not (x0 - 12 <= h["x"] * W <= x0 + bw + 12 and H - m - bh - 12 <= h["y"] * H) for h in hs)
    def busy(x0):  # pixel spread under the badge: low = plain background
        box = im.convert("L").crop((x0, H - m - bh, x0 + bw, H - m))
        return ImageStat.Stat(box).stddev[0]
    cands = [x for x in (W - m - bw, m) if clear(x)] or [W - m - bw]
    x0 = min(cands, key=busy)
    y0 = H - m - bh
    # tiled diagonal mark over the whole picture, so any crop or screenshot still carries it
    tf = ImageFont.truetype(FONT, round(W * 0.034)); tl = LOGO.resize((round(W * 0.05),) * 2, Image.LANCZOS)
    tl.putalpha(tl.getchannel("A").point(lambda a: a * 0.30))
    tw2 = ImageDraw.Draw(im).textbbox((0, 0), "StewardMD", font=tf)[2]
    tile = Image.new("RGBA", (tl.width + tw2 + 12, tl.height), (0, 0, 0, 0)); td = ImageDraw.Draw(tile)
    tile.alpha_composite(tl, (0, 0))
    td.text((tl.width + 10, tl.height / 2), "StewardMD", font=tf, fill=(255, 255, 255, 70), anchor="lm", stroke_width=2, stroke_fill=(20, 60, 45, 60))
    big = Image.new("RGBA", (W * 2, H * 2), (0, 0, 0, 0)); sx, sy = tile.width + round(W * 0.12), round(H * 0.16)
    for r, y in enumerate(range(0, H * 2, sy)):
        for x in range(-(r % 2) * sx // 2, W * 2, sx): big.alpha_composite(tile, (x, y))
    big = big.rotate(28, resample=Image.BICUBIC)
    im.alpha_composite(big.crop((W // 2, H // 2, W // 2 + W, H // 2 + H)))
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=bh // 2, fill=(255, 255, 255, 185))
    layer.alpha_composite(logo, (x0 + pad, y0 + pad))
    d.text((x0 + 2 * pad + lh, y0 + bh / 2), "StewardMD", font=font, fill=GREEN, anchor="lm")
    out = Image.alpha_composite(im, layer).convert("RGB")
    out.save(p, "WEBP", quality=82, method=6)
    print(f"{name}: {'right' if x0 > W/2 else 'LEFT'} {os.path.getsize(p)//1024}KB")
