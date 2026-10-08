#!/usr/bin/env python3
"""Contact sheets for the image pilot: stem + options + chosen image, one JPG per item. Dev-only.
usage: prep-images-sheets.py <data dir (~/prep-data/img)> <out dir>"""
import json, os, sys, textwrap
from PIL import Image, ImageDraw, ImageFont
d, out = os.path.expanduser(sys.argv[1]), os.path.expanduser(sys.argv[2])
os.makedirs(out, exist_ok=True)
pilot = json.load(open(f"{d}/pilot.json"))
picks = {p["id"]: p for p in json.load(open(f"{d}/picks.json"))}
def font(n):
    for f in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(f): return ImageFont.truetype(f, n)
    return ImageFont.load_default()
F, B = font(18), font(22)
for i, it in enumerate(pilot):
    p = picks[it["id"]]
    im = Image.open(f"{d}/view/{it['img'][0].replace('.webp', '.jpg')}").convert("RGB")
    im.thumbnail((700, 700))
    lines = [f"[{it['place'].upper()}] {it['subject']} / {it['licence']} / {it['author'][:50]}", ""]
    lines += textwrap.wrap(p["q"], 62) + [""]
    for k, o in enumerate(p["o"]): lines += textwrap.wrap(("*" if k == p["a"] else " ") + "ABCD"[k] + ". " + o, 62)
    h = max(im.height, 22 * len(lines) + 30) + 20
    S = Image.new("RGB", (1500, h), "white"); S.paste(im, (780, 10)); dr = ImageDraw.Draw(S)
    y = 10
    for l in lines: dr.text((10, y), l, fill="black", font=F); y += 24
    S.save(f"{out}/{i:02d}-{it['id'][:8]}.jpg", quality=80)
print(len(pilot), "sheets")
