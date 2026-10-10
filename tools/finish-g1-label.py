#!/usr/bin/env python3
"""finish-g1-label.py: render Inter labels at source positions, write -ai1 / -ai1-h webps (q80 m6, width<=900).
Reads decisions (f, pick). Full mode uses labels-x.jsonl + uses.json; dry mode uses pilot labels.json.
Usage: finish-g1-label.py --stage DIR --decisions FILE [--data DIR] [--full DIR] [--mode full|dry]
       [--pilot-dir DIR] [--only f,f] [--fresh]"""
import json, os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont

def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d

MODE = arg("--mode", "full")
DATA = os.path.expanduser(arg("--data", os.environ.get("REDRAW_DATA", "~/prep-data/rad/redraw")))
FULL = os.path.expanduser(arg("--full", os.environ.get("REDRAW_FULL", DATA + "/full")))
_STAGE = arg("--stage")
STAGE = os.path.expanduser(_STAGE) if _STAGE else None
DEC = arg("--decisions")
PILOT = os.path.expanduser(arg("--pilot-dir", os.path.expanduser("~/.claude/jobs/c927630f/tmp/redraw")))
ONLY = set(arg("--only").split(",")) if arg("--only") else None
FRESH = "--fresh" in sys.argv
FONT = os.path.expanduser("~/Developer/StewardMD/assets/fonts/inter-variable.woff2")
KEEP = {"label", "letter", "axis", "caption", "panel"}
LR = re.compile(r"^(R|L|RT|LT|RIGHT|LEFT)$", re.I)

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

# --- full-mode label boxes (from labels-x.jsonl) ---
LX, OVR = {}, {}
if MODE == "full":
    for l in open(DATA + "/labels-x.jsonl"):
        j = json.loads(l)
        LX[j["f"]] = j
    if os.path.exists(DATA + "/label-overrides.json"):
        OVR = json.load(open(DATA + "/label-overrides.json"))

def texts_full(f):
    if f in OVR:
        return OVR[f]
    out = []
    for t in LX.get(f, {}).get("texts", []):
        s = (t.get("t") or "").strip()
        if not s or t.get("role") not in KEEP or LR.match(s):
            continue
        b = t.get("box_2d") or t.get("box")
        if not b or len(b) != 4:
            continue
        y0, x0, y1, x1 = [v / 1000 for v in b]
        out.append({"t": s, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "rot": t.get("rot", 0) or 0, "color": t.get("color", "dark"), "role": t["role"]})
    return out

def render_full(f, art, hide=()):
    im = art.convert("RGB").copy()
    W, H = im.size
    hn = {norm(h) for h in hide}
    T = texts_full(f)
    def own(t):
        lines = t["t"].split("\n")
        rot = abs(t["rot"]) > 45
        bh = ((t["x1"] - t["x0"]) * W) if rot else ((t["y1"] - t["y0"]) * H)
        return bh / len(lines) * 0.78
    sz = sorted(own(t) for t in T)
    med = sz[len(sz) // 2] if sz else 14
    for t in T:
        if norm(t["t"]) in hn:
            continue
        lines = t["t"].split("\n")
        rot = abs(t["rot"]) > 45
        bw = ((t["y1"] - t["y0"]) * H) if rot else ((t["x1"] - t["x0"]) * W)
        size = max(12, min(med, H * 0.06, own(t) * 1.6 if t["role"] != "letter" else 999))
        wt = "Bold" if t["role"] in ("letter", "panel") else "SemiBold"
        f_ = ImageFont.truetype(FONT, round(size))
        f_.set_variation_by_name(wt)
        while size > 12 and max(f_.getlength(l) for l in lines) > bw * 1.35 + 10:
            size -= 1
            f_ = ImageFont.truetype(FONT, round(size))
            f_.set_variation_by_name(wt)
        col, halo = ("#16213E", "#F7F5F0") if t["color"] != "light" else ("#F7F5F0", "#16213E")
        lh = size * 1.18
        tw = round(max(f_.getlength(l) for l in lines) + size)
        th = round(lh * len(lines) + size * 0.6)
        layer = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for i, l in enumerate(lines):
            d.text((tw / 2, size * 0.3 + lh * (i + 0.5)), l, font=f_, fill=col, anchor="mm",
                   stroke_width=max(2, round(size * 0.12)), stroke_fill=halo)
        if rot:
            layer = layer.rotate(90 if t["rot"] > 0 else -90, expand=True)
        cx = (t["x0"] + t["x1"]) / 2 * W
        cy = (t["y0"] + t["y1"]) / 2 * H
        im.paste(layer, (round(cx - layer.width / 2), round(cy - layer.height / 2)), layer)
    return im

# --- dry-mode labels (pilot labels.json, normalised coords) ---
LAB = {}
if MODE == "dry":
    LAB = json.load(open(PILOT + "/labels.json"))

def render_dry(fig, im, skip_hidden):
    im = im.copy()
    d = ImageDraw.Draw(im)
    W, H = im.size
    for l in LAB.get(fig, []):
        if skip_hidden and l.get("hide"):
            continue
        f = ImageFont.truetype(FONT, max(10, round(l.get("s", 0.045) * H)))
        f.set_variation_by_name(l.get("w", "SemiBold"))
        halo = l.get("halo", "#F7F5F0")
        for i, line in enumerate(l["t"].split("\n")):
            y = l["y"] * H + i * round(l.get("s", 0.045) * H * 1.15)
            d.text((l["x"] * W, y), line, font=f, fill=l.get("c", "#16213E"),
                   anchor=l.get("a", "lm"),
                   stroke_width=max(2, round(H * 0.004)) if halo else 0, stroke_fill=halo)
    return im

def hide_for_full(f, uses):
    H = set()
    T = [t["t"] for t in texts_full(f)]
    for u in uses.get(f, []):
        sp = u.get("spot")
        if sp:
            a = norm(sp.get("label", ""))
            for t in T:
                b = norm(t)
                if a and b and (a in b or b in a or (len(b) > 3 and b[:5] == a[:5])):
                    H.add(t)
        for m in (u.get("marks") or []):
            a = norm(m.get("label", ""))
            for t in T:
                b = norm(t)
                if a and b and (a == b or (len(b) > 3 and (a in b or b in a))):
                    H.add(t)
    return H

FIXED = {  # source -> (full png, hidden png or None), pilot + deterministic art
    "rb-ctc-p0008-1-m1-h1.webp": (None, "out/0008/0008-hidden.png"),
    "rb-ctc-p0852-2-m1-h1.webp": (None, "out/0852/0852-hidden.png"),
    "rb-n2-p024-2-m1-h1.webp": (None, "out/n2024/n2024-hidden.png"),
    "rb-n2-p024-2-m1.webp": ("out/n2024/n2024-full.png", None),
    "rb-ctc-p0005-2.webp": ("out/0005/0005-full.png", None),
    "rb-ctc-p0006-1.webp": ("out/0006/0006-full.png", None),
    "rb-ctc-p0128-1-m1.webp": ("out/0128/0128-full.png", None),
    "rb-ctc-p0678-1.webp": ("out/0678/0678-full.png", None),
    "rb-ctc-p0679-2.webp": ("out/0679/0679-full.png", None),
    "rb-ctc-p0855-1.webp": ("out/0855/0855-full.png", None),
    "rb-r11-4-130-8.webp": ("cand/r11-8/det-full.png", "cand/r11-8/det-hidden.png"),
    "rb-r11-4-130-35.webp": ("det/rb-r11-4-130-35.png", None),
    "rb-r11-4-130-36.webp": ("det/rb-r11-4-130-36.png", None),
    "rb-r11-4-130-27.webp": ("det/rb-r11-4-130-27.png", None),
    "rb-r11-4-201-11.webp": ("det/rb-r11-4-201-11.png", None),
    "rb-n2-p117-1.webp": ("det/rb-n2-p117-1.png", None),
}

def save_webp(img, path, src_ar):
    W, H = img.size
    if abs(W / H - src_ar) / src_ar > 0.005:
        img = img.resize((round(H * src_ar), H), Image.LANCZOS)
        W, H = img.size
    w = min(900, W)
    if w < W:
        img = img.resize((w, round(H * w / W)), Image.LANCZOS)
    img.convert("RGB").save(path, "WEBP", quality=80, method=6)
    return img.size

def main():
    M = STAGE + "/v1/lessons/media"
    os.makedirs(M, exist_ok=True)
    mp, dp = STAGE + "/map.json", STAGE + "/source-dims.json"
    MAP = json.load(open(mp)) if os.path.exists(mp) and not FRESH else {}
    DIMS = json.load(open(dp)) if os.path.exists(dp) and not FRESH else {}
    dec = {}
    for l in open(DEC):
        if not l.strip() or l.startswith("#"):
            continue
        a = l.rstrip("\n").split("\t")
        dec[a[0]] = a[1:]
    uses = json.load(open(DATA + "/uses.json")) if MODE == "full" else {}
    n = 0
    for f, d in sorted(dec.items()):
        if ONLY and f not in ONLY:
            continue
        if d[0] not in ("0", "1", "a", "fixed", "pilot"):
            continue
        if f in MAP and not FRESH:
            continue
        base = f[:-5]
        h1 = base.endswith("-h1")
        root = base[:-3] if h1 else base
        if MODE == "dry":
            # f is like 0008 (pilot fig); pick names a cand file
            fig = f
            src = Image.open(PILOT + "/cand/" + fig + "/_src-padded.png").convert("RGB")
            # source dims from pilot src media for aspect
            spec = json.load(open(PILOT + "/pilot.json"))[fig]
            orig = Image.open(os.path.expanduser(spec["src"]))
            ar = orig.width / orig.height
            cand_path = PILOT + "/cand/" + fig + "/" + d[1]  # decisions col2 = cand file
            art = Image.open(cand_path).convert("RGB") if os.path.exists(cand_path) else None
            if art is None:
                # det art for r11-8
                art = Image.open(PILOT + "/cand/r11-8/det-art.png").convert("RGB") if fig == "r11-8" else None
                if art is None:
                    continue
            full = render_dry(fig, art, False)
            hidden = render_dry(fig, art, True) if any(l.get("hide") for l in LAB.get(fig, [])) else None
            e = {}
            nm = fig + "-ai1.webp"
            w, h = save_webp(full, f"{M}/{nm}", ar)
            e = {"full": nm, "w": w, "h": h}
            if hidden is not None:
                nh = fig + "-ai1-h.webp"
                hw, hh = save_webp(hidden, f"{M}/{nh}", ar)
                e.update(hidden=nh, hw=hw, hh=hh)
            MAP[f] = e
            DIMS[f] = [orig.width, orig.height]
            n += 1
            continue
        # full mode
        src = Image.open(DATA + "/media/" + f)
        sw, sh = src.size
        ar = sw / sh
        full = hidden = None
        if f in FIXED and d[0] in ("fixed", "pilot"):
            fp, hp = FIXED[f]
            full = Image.open(PILOT + "/" + fp) if fp else None
            hidden = Image.open(PILOT + "/" + hp) if hp else None
        else:
            art = Image.open(f"{FULL}/cand/{base}/g1-{d[0]}.png").convert("RGB")
            hs = hide_for_full(f, uses)
            if h1:
                hidden = render_full(f, art, hide=hs)
            else:
                full = render_full(f, art)
                if hs and any(u.get("spot") or u.get("marks") for u in uses.get(f, [])):
                    hidden = render_full(f, art, hide=hs)
        e = {}
        if h1:
            nm = root + "-ai1-h.webp"
            w, h = save_webp(hidden, f"{M}/{nm}", ar)
            e = {"full": nm, "w": w, "h": h}
        else:
            nm = root + "-ai1.webp"
            w, h = save_webp(full, f"{M}/{nm}", ar)
            e = {"full": nm, "w": w, "h": h}
            if hidden is not None:
                nh = root + "-ai1-h.webp"
                hw, hh = save_webp(hidden, f"{M}/{nh}", ar)
                e.update(hidden=nh, hw=hw, hh=hh)
        MAP[f] = e
        DIMS[f] = [sw, sh]
        n += 1
    json.dump(MAP, open(mp, "w"), indent=0, sort_keys=True)
    json.dump(DIMS, open(dp, "w"), indent=0, sort_keys=True)
    print(f"labeled {n}, total in map {len(MAP)}")

if __name__ == "__main__":
    if not STAGE or not DEC:
        sys.exit("need --stage DIR --decisions FILE")
    main()
