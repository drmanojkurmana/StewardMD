#!/usr/bin/env python3
"""Pin QA: flag pins that are probably on the wrong thing, and render them for a human to LOOK AT.

A pin is always inside its mask, so a bad pin means a bad mask label (mastoid air cells called
"paranasal sinus", a vertebra called "skull"). Two cheap signals find candidates:
  - JUMP: far from every pin of the same structure on the neighbouring slices (1 away, else 2);
  - TISSUE: the displayed pixel under the pin is implausible for the structure's category
    (a bone pin on soft tissue or air, an airway pin on bright tissue, a solid-organ pin on air).
Neither signal decides anything. Every flag is rendered as a crop (with the whole slice beside
it) into --out, and changes are made by hand in pin_fixes.py after looking.

Usage: atlas-pipeline/.venv/bin/python atlas-pipeline/pin_scan.py --out /tmp/pinscan [--module id ...]
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JUMP = 20.0            # % of image height, aspect-corrected
SOLID = {"viscus", "muscle", "vessel-artery", "vessel-vein", "urinary", "grey", "white", "deep-grey", "mixed"}


def patch(img, p, r=3):
    h, w = img.shape
    y = int(round(p["y"] / 100 * (h - 1))); x = int(round(p["x"] / 100 * (w - 1)))
    return float(np.median(img[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]))


def scan(mid):
    a = json.load(open(os.path.join(_REPO, "atlas", mid, "atlas.json"), encoding="utf-8"))
    by = {}
    for s in a["slices"]:
        for p in s["pins"]:
            by.setdefault((p["s"], s["i"]), []).append(p)
    flags = []
    for s in a["slices"]:
        img = np.asarray(Image.open(os.path.join(_REPO, s["img"].lstrip("/"))).convert("L"), dtype=float)
        bright = np.percentile(img, 99)
        for p in s["pins"]:
            why = []
            for step in (1, 2):
                nb = by.get((p["s"], s["i"] - step), []) + by.get((p["s"], s["i"] + step), [])
                if nb:
                    d = min(np.hypot((p["x"] - q["x"]) * s["aspect"], p["y"] - q["y"]) for q in nb)
                    if d > JUMP:
                        why.append("jump %.0f%% from its neighbours" % d)
                    break
            g = patch(img, p) / max(bright, 1) * 255
            cat = a["structures"][p["s"]].get("category", "")
            mr = mid.startswith("mri-")
            if cat == "bone" and g < 90:
                why.append("bone pin on dark pixel (%.0f/255)" % g)
            if cat == "airway" and g > 110 and not mid.startswith("ct-live"):
                why.append("airway pin on bright pixel (%.0f/255)" % g)
            if cat in SOLID and g < (8 if mr else 12):
                why.append("%s pin on black (%.0f/255)" % (cat, g))
            if why:
                flags.append({"m": mid, "i": s["i"], "s": p["s"], "x": p["x"], "y": p["y"], "why": "; ".join(why)})
    return flags


def render(f, out, n):
    a = json.load(open(os.path.join(_REPO, "atlas", f["m"], "atlas.json"), encoding="utf-8"))
    s = a["slices"][f["i"] - 1]
    im = Image.open(os.path.join(_REPO, s["img"].lstrip("/"))).convert("RGB")
    W, H = im.size
    x, y = f["x"] / 100 * (W - 1), f["y"] / 100 * (H - 1)
    d = ImageDraw.Draw(im)
    for p in s["pins"]:
        px, py = p["x"] / 100 * (W - 1), p["y"] / 100 * (H - 1)
        mine = p["x"] == f["x"] and p["y"] == f["y"] and p["s"] == f["s"]
        d.ellipse([px - 6, py - 6, px + 6, py + 6], outline=(255, 40, 40) if mine else (255, 220, 0), width=3 if mine else 1)
        d.text((px + 8, py - 6), p["s"], fill=(255, 80, 80) if mine else (255, 230, 0))
    crop = im.crop((int(x - 150), int(y - 150), int(x + 150), int(y + 150))).resize((360, 360))
    whole = im.resize((max(1, int(W * 360 / H)), 360))
    sheet = Image.new("RGB", (360 + whole.width + 8, 390))
    sheet.paste(crop, (0, 30)); sheet.paste(whole, (368, 30))
    ImageDraw.Draw(sheet).text((4, 4), "%s #%d  %s  (%s)" % (f["m"], f["i"], f["s"], f["why"]), fill=(255, 255, 255))
    path = os.path.join(out, "%03d-%s-%d-%s.png" % (n, f["m"], f["i"], f["s"]))
    sheet.save(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--module", nargs="*")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    cat = json.load(open(os.path.join(_REPO, "atlas", "modules.json"), encoding="utf-8"))
    mods = a.module or [m["id"] for m in cat["modules"] if not m.get("hidden")]
    flags = [f for mid in mods for f in scan(mid)]
    for n, f in enumerate(flags, 1):
        f["png"] = render(f, a.out, n)
        print("%-24s #%-2d %-26s x=%5.1f y=%5.1f  %s" % (f["m"], f["i"], f["s"], f["x"], f["y"], f["why"]))
    json.dump(flags, open(os.path.join(a.out, "flags.json"), "w"), indent=1)
    print("%d pins flagged across %d modules" % (len(flags), len(mods)))


if __name__ == "__main__":
    main()
