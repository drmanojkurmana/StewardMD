"""Downscale raw 3x captures (assets/screens/raw/*.png) to the 2x JPEGs the film loads.

    python3 launch-film/capture/prepare-screens.py
Phone/iPad captures are kept at 2x of app CSS px (sharp enough for 1.3x lifted crops at 1080p);
the desktop site capture is scaled to 2400 px wide.
"""
import glob, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "assets", "screens", "raw")
DST = os.path.join(HERE, "..", "assets", "screens")
for f in sorted(glob.glob(os.path.join(SRC, "*.png"))):
    name = os.path.basename(f)[:-4]
    im = Image.open(f).convert("RGB")
    s = 2400 / im.width if name.startswith("site") else 2 / 3
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    out = os.path.join(DST, name + ".jpg")
    im.save(out, quality=90, optimize=True, progressive=True)
    print(f"{name}: {im.size[0]}x{im.size[1]}, {os.path.getsize(out) // 1024} KB")
