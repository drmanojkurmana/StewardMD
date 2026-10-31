"""Prepare device images for the pamphlets.

Phones: each capture gets its platform's status bar (sized so the Dynamic Island or the
punch-hole camera sits inside it, never over the app header), then goes into the owner's frame
(img/frames/iphone.png, android.png: transparent outside and in the screen). The screen is cut
to the frame's own opening, so the image fills it exactly and its corners follow the glass.
iPad: the capture plus an iOS status bar; the frame is CSS (.ipad in pamphlet.css).
Watch: the app's own Code Blue / Critical labs renders (_site/assets/s/) inside the owner's Ultra frames.

Usage: python3 make-screens.py <capture_dir>
  <capture_dir> holds ios-<n>.png (393x798 @3x), and-<n>.png (412x874 @3x)
  and ipad-<n>.png (1180x820 @2x).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "img")
FRAMES_DIR = os.path.join(OUT, "frames")
FONT = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"

# (capture prefix, frame, css width, status bar height in css px, status bar style)
DEVICES = {
    "ios": ("iphone.png", 393, 54, "ios"),
    "and": ("android.png", 412, 44, "android"),
}
SHOTS = {
    "ios": ["home", "clinix", "dose", "mono", "beta", "ins"],
    "and": ["maikans", "kbl", "dose", "mono", "beta"],
}
IPADS = ["angio", "kardia", "abg", "mono", "beta"]
WATCH = {"codeblue": "watch-frame-codeblue.png", "critical": "watch-frame-critical.png"}
WATCH_BOX = (62, 246, 620, 926)  # display area inside the 720x1172 watch renders
WATCH_FRAMES = {"ocean": "ocean-frame.png", "alpine": "alpine-frame.png"}
WATCHES = [("alpine", "codeblue"), ("ocean", "critical")]


def _fg(img):
    top = img.crop((0, 0, img.width, 2)).resize((1, 1), Image.BOX).getpixel((0, 0))
    lum = .2126 * top[0] + .7152 * top[1] + .0722 * top[2]
    return top, ((12, 16, 15) if lum > 150 else (255, 255, 255))


def _battery(d, xr, cy, u, fg):
    bw, bh = int(24 * u), int(11.5 * u)
    d.rounded_rectangle((xr - bw, cy - bh // 2, xr, cy + bh // 2), radius=int(3.4 * u), outline=fg, width=max(1, int(1.1 * u)))
    d.rounded_rectangle((xr - bw + int(2 * u), cy - bh // 2 + int(2 * u), xr - int(5 * u), cy + bh // 2 - int(2 * u)), radius=int(1.8 * u), fill=fg)
    d.rounded_rectangle((xr + int(1.5 * u), cy - int(2.5 * u), xr + int(3 * u), cy + int(2.5 * u)), radius=int(1 * u), fill=fg)
    return xr - bw


def _wifi(d, x, cy, u, fg):
    for r in (9, 6, 3):
        rr = int(r * u)
        d.arc((x - rr, cy + int(4 * u) - rr, x + rr, cy + int(4 * u) + rr), 225, 315, fill=fg, width=max(1, int(2 * u)))


def _signal(d, x, cy, u, fg):
    for i in range(4):
        hh = int((4 + 2.6 * i) * u)
        d.rounded_rectangle((x + i * int(4.6 * u), cy + int(5 * u) - hh, x + i * int(4.6 * u) + int(3 * u), cy + int(5 * u)), radius=int(1 * u), fill=fg)


def status_bar(img, css_w, bar_css, style):
    """Return img with a status bar prepended: iOS (time left of the island) or Android (time left, icons right)."""
    w, h = img.size
    u = w / float(css_w)
    bar = int(round(bar_css * u))
    bg, fg = _fg(img)
    out = Image.new("RGB", (w, h + bar), bg)
    # the bar continues the screen's own top edge (a gradient header stays a gradient), then the screen
    out.paste(img.crop((0, 0, w, 2)).resize((w, bar)), (0, 0))
    out.paste(img, (0, bar))
    d = ImageDraw.Draw(out)
    if style == "ios":
        cy = int(30 * u)
        d.text((int(52 * u), cy), "9:41", font=ImageFont.truetype(FONT, int(17 * u)), fill=fg, anchor="mm")
        xb = _battery(d, w - int(26 * u), cy, u, fg)
        _wifi(d, xb - int(14 * u), cy, u, fg)
        _signal(d, xb - int(44 * u), cy, u, fg)
    else:
        cy = int(min(bar_css / 2.0, 24) * u)
        d.text((int(22 * u), cy), "9:41", font=ImageFont.truetype(FONT, int(14 * u)), fill=fg, anchor="lm")
        xb = _battery(d, w - int(20 * u), cy, u, fg)
        _wifi(d, xb - int(14 * u), cy, u, fg)
        _signal(d, xb - int(42 * u), cy, u, fg)
    return out


def screen_hole(fr):
    """Mask of the transparent screen opening reachable from the frame's centre."""
    w, h = fr.size
    hole = Image.eval(fr.split()[3], lambda v: 255 if v < 128 else 0)
    ImageDraw.floodfill(hole, (w // 2, h // 2), 128)
    return Image.eval(hole, lambda v: 255 if v == 128 else 0)


def compose(frame_file, screen, out_file, black_bezel=False):
    """Screen fitted to the frame's opening (frame upscaled to the screen's resolution), frame on top."""
    fr = Image.open(os.path.join(FRAMES_DIR, frame_file)).convert("RGBA")
    bb = screen_hole(fr).getbbox()
    k = screen.width / float(bb[2] - bb[0])
    fr = fr.resize((int(fr.width * k), int(fr.height * k)), Image.LANCZOS)
    hole = screen_hole(fr)
    bb = hole.getbbox()
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    s = screen.convert("RGBA")
    kk = max(bw / float(s.width), bh / float(s.height))
    s = s.resize((int(s.width * kk + .999), int(s.height * kk + .999)), Image.LANCZOS)
    s = s.crop(((s.width - bw) // 2, 0, (s.width - bw) // 2 + bw, bh))
    out = Image.new("RGBA", fr.size, (0, 0, 0, 0))
    if black_bezel:
        ImageDraw.Draw(out).rounded_rectangle((bb[0] - 8, bb[1] - 8, bb[2] + 8, bb[3] + 8), radius=int(bw * 0.24), fill=(0, 0, 0, 255))
        inset = int(bw * 0.035)
        box = (bb[0] + inset, bb[1] + inset, bb[2] - inset, bb[3] - inset)
        s = s.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
        m = Image.new("L", (s.width * 4, s.height * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, s.width * 4 - 1, s.height * 4 - 1), radius=int(s.width * 4 * 0.2), fill=255)
        out.paste(s, box[:2], m.resize(s.size, Image.LANCZOS))
    else:
        out.paste(s, bb[:2], hole.crop(bb).filter(ImageFilter.MaxFilter(5)))
    out.alpha_composite(fr)
    out.save(os.path.join(OUT, out_file), optimize=True)


def main(cap):
    os.makedirs(OUT, exist_ok=True)
    for dev, (frame, css_w, bar, style) in DEVICES.items():
        for n in SHOTS[dev]:
            im = status_bar(Image.open(os.path.join(cap, "%s-%s.png" % (dev, n))).convert("RGB"), css_w, bar, style)
            compose(frame, im, "%s-%s.png" % (dev, n))
    for n in IPADS:
        im = status_bar(Image.open(os.path.join(cap, "ipad-%s.png" % n)).convert("RGB"), 1180, 24, "android")
        im = im.resize((1600, int(im.height * 1600 / im.width)), Image.LANCZOS)
        im.save(os.path.join(OUT, "ipad-%s.jpg" % n), quality=86, optimize=True)
    for n, f in WATCH.items():
        im = Image.open(os.path.join(ROOT, "_site", "assets", "s", f)).convert("RGBA").crop(WATCH_BOX)
        bg = Image.new("RGBA", im.size, (0, 0, 0, 255))
        bg.alpha_composite(im)
        bg.convert("RGB").save(os.path.join(OUT, "watch-%s.jpg" % n), quality=88)
    for frame, scr in WATCHES:
        compose(WATCH_FRAMES[frame], Image.open(os.path.join(OUT, "watch-%s.jpg" % scr)), "watch-%s-%s.png" % (frame, scr), black_bezel=True)
    print("device images written to", OUT)


if __name__ == "__main__":
    main(sys.argv[1])
