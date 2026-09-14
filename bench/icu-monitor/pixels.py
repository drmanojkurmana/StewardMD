#!/usr/bin/env python3
"""pixels.py <image> <out.rgb>  ->  prints "W H"; writes raw 8-bit RGB rows to out.rgb.

The benchmark's pixel source for the SAME JavaScript colour sampler the app runs on a canvas
(icu-monitor-parser.js sampleColors). Decoding lives here so Node needs no image dependency and the
sampler has exactly one implementation. Nothing is uploaded; this is a local file transform."""
import sys
from PIL import Image, ImageOps

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src)
im = ImageOps.exif_transpose(im).convert("RGB")   # honour phone EXIF rotation, like the WebView does
# the app's pixel source (reasoning.js smdPixelSource) draws the original at most 2400 px on its long edge;
# the digit verifier and colour sampler must see the same resolution here
s = min(1.0, 2400.0 / max(im.size))
if s < 1: im = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.BILINEAR)
w, h = im.size
with open(out, "wb") as f:
    f.write(im.tobytes())
print(w, h)
