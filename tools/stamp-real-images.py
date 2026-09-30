# Stamp one StewardMD watermark (logo + name, bottom-right) on every realistic lesson image.
# Idempotent: always stamps from the unstamped copy, which it makes on first run, so re-running never double-stamps.
# Keep the unstamped store outside the repo (e.g. ~/Documents/stewardmd-image-originals/<module>).
# GEMINI=1 sizes and places the badge so it covers the generator's sparkle mark (about 90% across, 87-89% down).
# Usage (from the repo root): [GEMINI=1] python3 tools/stamp-real-images.py <module-root e.g. tokos> <unstamped-dir> [name ...]
import glob, json, os, sys, shutil
from PIL import Image, ImageDraw, ImageFont

ROOT, UN = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
GEMINI = os.environ.get("GEMINI") == "1"
LOGO = Image.open("logo.png").convert("RGBA")
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
GREEN = (31, 92, 69, 255)
SS = 3  # draw the badge at 3x and scale down, for crisp edges and text


def badge(lh):
    """The badge (white pill, logo, name) drawn at SS x then scaled to logo height lh."""
    L = lh * SS
    font = ImageFont.truetype(FONT, round(L * 0.46))
    pad = round(L * 0.22)
    tw = ImageDraw.Draw(Image.new("RGBA", (1, 1))).textbbox((0, 0), "StewardMD", font=font)[2]
    bw, bh = L + tw + 3 * pad, L + 2 * pad
    b = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(b)
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=bh // 2, fill=(255, 255, 255, 215))
    b.alpha_composite(LOGO.resize((L, L), Image.LANCZOS), (pad, pad))
    d.text((2 * pad + L, bh / 2), "StewardMD", font=font, fill=GREEN, anchor="lm")
    return b.resize((round(bw / SS), round(bh / SS)), Image.LANCZOS)


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
    m = round(W * 0.015)
    if GEMINI:
        b = badge(max(28, round(H * 0.095)))          # tall enough to hide the sparkle
        x0 = W - m - b.width
        y0 = min(H - m - b.height, round(H * 0.878 - b.height / 2))  # centred on the sparkle row
    else:
        b = badge(max(28, round(W * 0.055)))
        x0, y0 = W - m - b.width, H - m - b.height   # always bottom-right
    for h in spots.get(name, []):                     # never cover a tap label: step up above it, still on the right
        hx, hy = h["x"] * W, h["y"] * H
        if hx > x0 - 16 and y0 - 16 < hy < y0 + b.height + 16:
            y0 = min(y0, round(hy - 22 - b.height))
            print(f"  {name}: badge moved above hotspot {h['label']['en']}")
    im.alpha_composite(b, (x0, y0))
    im.convert("RGB").save(p, "WEBP", quality=82, method=6)
    print(f"{name}: {os.path.getsize(p) // 1024}KB badge at ({x0},{y0}) {b.width}x{b.height}")
