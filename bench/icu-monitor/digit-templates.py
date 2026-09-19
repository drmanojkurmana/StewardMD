#!/usr/bin/env python3
"""digit-templates.py -> prints the DIGIT_TEMPLATES table embedded in icu-monitor-parser.js.

The independent digit verifier compares each value glyph with digits rendered from common sans-serif
monitor-style faces and a drawn seven-segment set. Each template is the digit's ink, cropped to its
bounding box, scaled to 20 px tall (aspect kept, centred in a 20x20 cell, narrower than 20 if needed),
area-averaged and quantised to 16 levels: one hex character per cell, 400 characters per digit.
normGlyph() in the parser builds the glyph side the SAME way. Re-run only to change the font set:

    python3 bench/icu-monitor/digit-templates.py > /tmp/t.txt   (then paste the object into the parser)
"""
import json
from PIL import Image, ImageDraw, ImageFont

S = 20
SUP = "/System/Library/Fonts/Supplemental/"
SYS = "/System/Library/Fonts/"
FACES = [
    ("arial", SUP + "Arial.ttf", 0), ("arial-bold", SUP + "Arial Bold.ttf", 0),
    ("arial-narrow", SUP + "Arial Narrow.ttf", 0), ("arial-narrow-bold", SUP + "Arial Narrow Bold.ttf", 0),
    ("helvetica", SYS + "Helvetica.ttc", 0), ("helvetica-bold", SYS + "Helvetica.ttc", 1),
    ("helvetica-neue-condensed-bold", SYS + "HelveticaNeue.ttc", 4),
    ("din-alternate-bold", SUP + "DIN Alternate Bold.ttf", 0), ("din-condensed-bold", SUP + "DIN Condensed Bold.ttf", 0),
    ("tahoma", SUP + "Tahoma.ttf", 0), ("tahoma-bold", SUP + "Tahoma Bold.ttf", 0),
    ("verdana", SUP + "Verdana.ttf", 0), ("verdana-bold", SUP + "Verdana Bold.ttf", 0),
    ("trebuchet", SUP + "Trebuchet MS.ttf", 0), ("futura", SUP + "Futura.ttc", 0),
    ("avenir-next-condensed", SYS + "Avenir Next Condensed.ttc", 0),
]
SEG = {0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgecd", 7: "abc", 8: "abcdefg", 9: "abcdfg"}


def norm(ink):
    """ink: PIL 'L' image, 255 = ink. Crop to bbox, fit into SxS keeping aspect, area-average."""
    bb = ink.getbbox()
    g = ink.crop(bb)
    w, h = g.size
    nh = S
    nw = max(1, round(w * S / h))
    if nw > S:
        nw, nh = S, max(1, round(h * S / w))
    g = g.resize((nw, nh), Image.BOX)
    cell = Image.new("L", (S, S), 0)
    cell.paste(g, ((S - nw) // 2, (S - nh) // 2))
    return "".join("%x" % min(15, v // 16) for v in cell.getdata())


def render(path, index, d):
    f = ImageFont.truetype(path, 160, index=index)
    im = Image.new("L", (240, 240), 0)
    ImageDraw.Draw(im).text((40, 20), str(d), font=f, fill=255)
    return im.point(lambda v: 255 if v > 127 else 0)


def seven(d):
    im = Image.new("L", (140, 240), 0)
    dr = ImageDraw.Draw(im)
    t, L, T, M, B = 18, 20, 10, 120, 230
    R = 120
    segs = {"a": (L + 6, T, R - 6, T + t), "g": (L + 6, M - t // 2, R - 6, M + t // 2), "d": (L + 6, B - t, R - 6, B),
            "f": (L, T + 6, L + t, M - 6), "b": (R - t, T + 6, R, M - 6), "e": (L, M + 6, L + t, B - 6), "c": (R - t, M + 6, R, B - 6)}
    for s in SEG[d]:
        dr.rectangle(segs[s], fill=255)
    return im


table = {}
for name, path, idx in FACES:
    table[name] = [norm(render(path, idx, d)) for d in range(10)]
table["seven-segment"] = [norm(seven(d)) for d in range(10)]
print(json.dumps(table, separators=(",", ":")))
