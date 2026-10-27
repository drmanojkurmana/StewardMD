"""Prepare device screens for the pamphlets.

Phone and iPad captures get an iOS status bar on top so the notch / camera sits over the
status bar and never over the app header; the image then fills the device screen exactly.
Watch screens are cropped from the app's own Apple Watch renders in _site/assets/s/.

Usage: python3 make-screens.py <capture_dir>
  <capture_dir> holds app-<name>.png (390x844 @3x) and ipad-<name>.png (1180x820 @2x).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "img")
FONT = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"

PHONES = ["home", "abg", "clinix", "dose", "kardia", "kbl"]
IPADS = ["abg", "kardia", "kbl", "dose"]
WATCH = {"codeblue": "watch-frame-codeblue.png", "critical": "watch-frame-critical.png"}
WATCH_BOX = (62, 246, 620, 926)  # display area inside the 720x1172 watch renders
# Watch frames supplied by the owner (img/frames, background removed); screen = enclosed hole
FRAMES = {"ocean": "ocean-frame.png", "alpine": "alpine-frame.png"}
WATCHES = [("alpine", "codeblue"), ("ocean", "codeblue"), ("ocean", "critical")]


def status_bar(img, bar_pt, scale, big):
    """Return img with an iOS status bar (9:41, signal, wifi, battery) prepended."""
    w, h = img.size
    bar = int(bar_pt * scale)
    bg = img.getpixel((4, 4))
    dark_text = sum(bg[:3]) > 380
    fg = (12, 16, 15) if dark_text else (255, 255, 255)
    out = Image.new("RGB", (w, h + bar), bg)
    out.paste(img, (0, bar))
    d = ImageDraw.Draw(out)
    f = ImageFont.truetype(FONT, int((17 if big else 13) * scale))
    cy = bar // 2 + (int(2 * scale) if big else 0)
    x0 = int((34 if big else 22) * scale)
    d.text((x0, cy), "9:41", font=f, fill=fg, anchor="lm")
    u = scale
    xr = w - int((30 if big else 22) * u)
    # battery
    bw, bh = int(25 * u), int(12 * u)
    d.rounded_rectangle((xr - bw, cy - bh // 2, xr, cy + bh // 2), radius=int(3.5 * u), outline=fg, width=max(1, int(1.1 * u)))
    d.rounded_rectangle((xr - bw + int(2 * u), cy - bh // 2 + int(2 * u), xr - int(2 * u), cy + bh // 2 - int(2 * u)), radius=int(2 * u), fill=fg)
    d.rounded_rectangle((xr + int(1.5 * u), cy - int(2.5 * u), xr + int(3 * u), cy + int(2.5 * u)), radius=int(1 * u), fill=fg)
    # wifi
    wx = xr - bw - int(14 * u)
    for i, r in enumerate((9, 6, 3)):
        rr = int(r * u)
        d.arc((wx - rr, cy + int(4 * u) - rr, wx + rr, cy + int(4 * u) + rr), 225, 315, fill=fg, width=max(1, int(2 * u)))
    # signal
    sx = wx - int(30 * u)
    for i in range(4):
        hh = int((4 + 2.6 * i) * u)
        d.rounded_rectangle((sx + i * int(4.6 * u), cy + int(5 * u) - hh, sx + i * int(4.6 * u) + int(3 * u), cy + int(5 * u)), radius=int(1 * u), fill=fg)
    return out


def main(cap):
    os.makedirs(OUT, exist_ok=True)
    for n in PHONES:
        im = Image.open(os.path.join(cap, "app-%s.png" % n)).convert("RGB")
        im = status_bar(im, 54, im.width / 390.0, True)
        im = im.resize((780, int(im.height * 780 / im.width)), Image.LANCZOS)
        im.save(os.path.join(OUT, "%s.jpg" % n), quality=86, optimize=True)
    for n in IPADS:
        im = Image.open(os.path.join(cap, "ipad-%s.png" % n)).convert("RGB")
        im = status_bar(im, 24, im.width / 1180.0, False)
        im = im.resize((1600, int(im.height * 1600 / im.width)), Image.LANCZOS)
        im.save(os.path.join(OUT, "ipad-%s.jpg" % n), quality=84, optimize=True)
    for n, f in WATCH.items():
        im = Image.open(os.path.join(ROOT, "_site", "assets", "s", f)).convert("RGBA").crop(WATCH_BOX)
        bg = Image.new("RGBA", im.size, (0, 0, 0, 255))
        bg.alpha_composite(im)
        bg.convert("RGB").save(os.path.join(OUT, "watch-%s.jpg" % n), quality=88)
    for frame, scr in WATCHES:
        compose_watch(frame, scr)
    print("screens written to", OUT)


def compose_watch(frame, scr):
    """App screen under an owner-supplied watch frame (transparent outside and in the screen hole).

    A black bezel fills the hole, the screen sits in a smooth rounded rectangle inside it, and the
    frame goes on top, so the jagged hole edge of a cut-out photo never shows.
    """
    fr = Image.open(os.path.join(OUT, "frames", FRAMES[frame])).convert("RGBA")
    w, h = fr.size
    hole = Image.eval(fr.split()[3], lambda v: 255 if v < 128 else 0)
    ImageDraw.floodfill(hole, (w // 2, h // 2), 128)
    bb = Image.eval(hole, lambda v: 255 if v == 128 else 0).getbbox()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bez = 8
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((bb[0] - bez, bb[1] - bez, bb[2] + bez, bb[3] + bez), radius=int((bb[2] - bb[0]) * 0.24), fill=(0, 0, 0, 255))
    inset = int((bb[2] - bb[0]) * 0.035)
    box = (bb[0] + inset, bb[1] + inset, bb[2] - inset, bb[3] - inset)
    bw, bh = box[2] - box[0], box[3] - box[1]
    s = Image.open(os.path.join(OUT, "watch-%s.jpg" % scr)).convert("RGBA")
    k = max(float(bw) / s.width, float(bh) / s.height)
    s = s.resize((int(s.width * k) + 1, int(s.height * k) + 1), Image.LANCZOS)
    s = s.crop(((s.width - bw) // 2, 0, (s.width - bw) // 2 + bw, bh))
    m = Image.new("L", (bw * 4, bh * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, bw * 4 - 1, bh * 4 - 1), radius=int(bw * 4 * 0.2), fill=255)
    out.paste(s, box[:2], m.resize((bw, bh), Image.LANCZOS))
    out.alpha_composite(fr)
    out.save(os.path.join(OUT, "watch-%s-%s.png" % (frame, scr)), optimize=True)

if __name__ == "__main__":
    main(sys.argv[1])
