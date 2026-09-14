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
w, h = im.size
with open(out, "wb") as f:
    f.write(im.tobytes())
print(w, h)
