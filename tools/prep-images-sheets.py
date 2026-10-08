#!/usr/bin/env python3
"""Contact sheets for the image run: stem + options + chosen image + licence line, one JPG per item. Dev-only.
usage: prep-images-sheets.py <final.json> <picks.json> <out dir> [--n 40] [--raw dir ...]
Without --n every item gets a sheet; with --n a random sample (seed 7)."""
import json, os, random, sys, textwrap
from PIL import Image, ImageDraw, ImageFont
a = sys.argv[1:]
fin, picks, out = [os.path.expanduser(x) for x in a[:3]]
n = int(a[a.index("--n") + 1]) if "--n" in a else 0
raws = [os.path.expanduser(a[i + 1]) for i, x in enumerate(a) if x == "--raw"]
os.makedirs(out, exist_ok=True)
items = json.load(open(fin))
byid = {p["id"]: p for p in json.load(open(picks))}
if n and n < len(items):
    random.Random(7).shuffle(items); items = items[:n]
def font(s):
    for f in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(f): return ImageFont.truetype(f, s)
    return ImageFont.load_default()
F = font(18)
made = 0
for i, it in enumerate(items):
    src = next((os.path.join(r, it["img"][0]) for r in raws if os.path.exists(os.path.join(r, it["img"][0]))), None)
    p = byid.get(it["id"])
    if not src or not p: continue
    im = Image.open(src).convert("RGB"); im.thumbnail((700, 700))
    lines = [f"[{it['imgPlace'].upper()}] {it['subject']} / {it['licence']} / {it['author'][:55]}", ""]
    lines += textwrap.wrap(p["q"], 62) + [""]
    for k, o in enumerate(p["o"]): lines += textwrap.wrap(("*" if k == p["a"] else " ") + "ABCD"[k] + ". " + o, 62)
    h = max(im.height, 24 * len(lines) + 30) + 20
    S = Image.new("RGB", (1500, h), "white"); S.paste(im, (780, 10)); d = ImageDraw.Draw(S)
    y = 10
    for l in lines: d.text((10, y), l, fill="black", font=F); y += 24
    S.save(f"{out}/{i:02d}-{it['id'][:8]}.jpg", quality=80); made += 1
print(made, "sheets")
