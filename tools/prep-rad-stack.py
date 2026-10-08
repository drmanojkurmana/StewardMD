#!/usr/bin/env python3
"""PrepNucleus Radiology NEET-SS: licensed DICOM series -> web scroll stacks. Dev-only, never shipped (tools/ is 404).

Plan: vault/plans/PrepNucleus-RadiologySS.md. Sources: TCIA collections whose own page and the NBIA series record say
CC BY 3.0 or CC BY 4.0 (commercial reuse allowed); never NC or controlled-access collections. Raw DICOM stays outside git
(~/prep-data/rad/dicom, deleted after conversion); only windowed WebP slices go to R2 (prep-bank/v6/ss-radiology/stack/).

Same conventions as the RadioAnatome atlas pipeline (atlas-pipeline/slices.py): slices sorted along the scan axis,
radiological display (patient right on the viewer's left), numbered NNN.webp, one folder per CT window, never rewrite
the bytes of a published file (a new stack gets a new id).

RUN (python with numpy, pydicom, pillow; e.g. ~/prep-data/rad/.venv/bin/python)
  fetch   <SeriesInstanceUID> <dir>                    download the series zip from the NBIA public API and unzip it
  info    <dir>                                        slice count, spacing, orientation, age/sex, description
  montage <dir> <out.jpg> [--win soft] [--every 4]     contact sheet with slice numbers (for choosing the range by eye)
  build   <dir> <outdir> --range A B [--n 60] [--win soft,lung] [--size 512] [--q 72] [--crop x0 y0 x1 y1]
          -> <outdir>/<win>/NNN.webp + <outdir>/stack.json { n, w, wins, ar, mm }
  test                                                 self-test of the pure helpers
"""
import io, json, os, sys, zipfile, urllib.request, urllib.parse

WINDOWS = {  # name -> (width, level, label) for CT; MR uses a percentile stretch ("mr")
    "soft": (400, 40, "Soft tissue"),
    "lung": (1500, -600, "Lung"),
    "bone": (1800, 400, "Bone"),
    "brain": (80, 40, "Brain"),
    "liver": (180, 70, "Liver"),
    "mr": (None, None, "MR"),
}
NBIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?"


def window(arr, name, lo_hi=None):
    """arr (float HU or MR signal) -> uint8 0..255 for the named window. lo_hi overrides the MR stretch."""
    import numpy as np
    w, l, _ = WINDOWS[name]
    if w is None:
        lo, hi = lo_hi if lo_hi else (float(np.percentile(arr, 1)), float(np.percentile(arr, 99.5)))
    else:
        lo, hi = l - w / 2.0, l + w / 2.0
    out = (arr.astype("float32") - lo) / max(1e-6, hi - lo)
    return (np.clip(out, 0, 1) * 255 + 0.5).astype("uint8")


def pick(a, b, n):
    """n slice indices spread evenly over [a, b] (inclusive), no repeats, ascending."""
    a, b = int(a), int(b)
    if b < a:
        a, b = b, a
    total = b - a + 1
    if n >= total:
        return list(range(a, b + 1))
    return sorted(set(int(round(a + k * (total - 1) / (n - 1))) for k in range(n)))


def load(d):
    """-> (slices sorted along the normal, meta). Only image DICOMs of one series."""
    import numpy as np
    import pydicom
    ds = []
    for root, _, files in os.walk(d):
        for f in files:
            p = os.path.join(root, f)
            try:
                x = pydicom.dcmread(p)
            except Exception:
                continue
            if "PixelData" not in x or not hasattr(x, "ImagePositionPatient"):
                continue
            ds.append(x)
    if not ds:
        raise SystemExit("no image slices in " + d)
    iop = [float(v) for v in ds[0].ImageOrientationPatient]
    row, col = np.array(iop[:3]), np.array(iop[3:])
    nrm = np.cross(row, col)
    ds.sort(key=lambda x: float(np.dot(nrm, [float(v) for v in x.ImagePositionPatient])))
    pos = [float(np.dot(nrm, [float(v) for v in x.ImagePositionPatient])) for x in ds]
    gap = abs(pos[-1] - pos[0]) / max(1, len(pos) - 1)
    x0 = ds[0]
    meta = {
        "n": len(ds), "rows": int(x0.Rows), "cols": int(x0.Columns),
        "px": [float(v) for v in getattr(x0, "PixelSpacing", [1, 1])], "gap": round(gap, 2),
        "iop": [round(v, 3) for v in iop], "mod": str(getattr(x0, "Modality", "")),
        "desc": str(getattr(x0, "SeriesDescription", "")), "age": str(getattr(x0, "PatientAge", "")),
        "sex": str(getattr(x0, "PatientSex", "")), "body": str(getattr(x0, "BodyPartExamined", "")),
    }
    return ds, meta


def pixels(x):
    import numpy as np
    a = x.pixel_array.astype("float32")
    s, i = float(getattr(x, "RescaleSlope", 1) or 1), float(getattr(x, "RescaleIntercept", 0) or 0)
    return a * s + i


def display(a, iop):
    """Radiological display for an axial slice: rows run anterior->posterior, columns patient right->left.
    Row direction +x (toward patient left) and column direction +y (toward posterior) is already that; flip otherwise."""
    import numpy as np
    row, col = iop[:3], iop[3:]
    if abs(row[0]) > 0.5 and row[0] < 0:
        a = a[:, ::-1]
    if abs(col[1]) > 0.5 and col[1] < 0:
        a = a[::-1, :]
    return np.ascontiguousarray(a)


def to_img(a8, px, size, crop=None):
    from PIL import Image
    im = Image.fromarray(a8)
    if crop:
        im = im.crop(tuple(crop))
    w, h = im.size
    ar = (h * px[0]) / (w * px[1])  # physical height / width (PixelSpacing is row, col)
    tw = size if w >= h / ar else int(round(size / ar))
    th = int(round(tw * ar))
    if th > size:
        th, tw = size, int(round(size / ar))
    return im.resize((tw, th), Image.LANCZOS)


def cmd_fetch(uid, d):
    os.makedirs(d, exist_ok=True)
    url = NBIA + urllib.parse.urlencode({"SeriesInstanceUID": uid})
    req = urllib.request.Request(url, headers={"User-Agent": "StewardMD-PrepNucleus-rad/1.0"})
    with urllib.request.urlopen(req, timeout=600) as r:
        data = r.read()
    zipfile.ZipFile(io.BytesIO(data)).extractall(d)
    print("fetched", len(data) // 1024, "KB ->", d)


def cmd_fetchlist(listfile, root):
    """listfile: "id uid" per line (# comments). Skips ids already on disk; stops under 800 MB free."""
    import shutil
    for line in open(listfile):
        line = line.split("#")[0].strip()
        if not line:
            continue
        sid, uid = line.split()[:2]
        d = os.path.join(root, sid)
        if os.path.isdir(d):
            continue
        free = shutil.disk_usage(os.path.expanduser("~")).free // (1 << 20)
        if free < 800:
            raise SystemExit("PAUSE: free disk %d MB" % free)
        try:
            cmd_fetch(uid, d)
        except Exception as e:  # one failed series does not stop the rest
            print("FAILED", sid, e)


def cmd_info(d):
    _, meta = load(d)
    print(json.dumps(meta))


def cmd_montage(d, out, win="soft", every=4):
    import numpy as np
    from PIL import Image, ImageDraw
    ds, meta = load(d)
    idx = list(range(0, len(ds), every))
    tiles = []
    lohi = None
    if WINDOWS[win][0] is None:
        mid = pixels(ds[len(ds) // 2])
        lohi = (float(np.percentile(mid, 1)), float(np.percentile(mid, 99.5)))
    for i in idx:
        im = to_img(window(display(pixels(ds[i]), meta["iop"]), win, lohi), meta["px"], 160)
        t = Image.new("L", (160, 160), 0)
        t.paste(im, ((160 - im.size[0]) // 2, (160 - im.size[1]) // 2))
        ImageDraw.Draw(t).text((3, 2), str(i), fill=255)
        tiles.append(t)
    cols = 10
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("L", (cols * 160, rows * 160), 0)
    for k, t in enumerate(tiles):
        sheet.paste(t, ((k % cols) * 160, (k // cols) * 160))
    sheet.save(out, quality=80)
    print("montage", len(tiles), "tiles ->", out, json.dumps(meta))


def cmd_build(d, outdir, rng, n=60, wins=("soft",), size=512, q=72, crop=None):
    import numpy as np
    ds, meta = load(d)
    a, b = rng
    b = min(b, len(ds) - 1)
    sel = pick(a, b, n)
    lohi = None
    if any(WINDOWS[w][0] is None for w in wins):  # one MR stretch for the whole stack, from the chosen range
        sample = np.concatenate([pixels(ds[i]).ravel() for i in sel[:: max(1, len(sel) // 8)]])
        lohi = (float(np.percentile(sample, 1)), float(np.percentile(sample, 99.6)))
    from PIL import Image
    dims = None
    for w in wins:
        os.makedirs(os.path.join(outdir, w), exist_ok=True)
        for k, i in enumerate(sel):
            im = to_img(window(display(pixels(ds[i]), meta["iop"]), w, lohi), meta["px"], size, crop)
            dims = im.size
            im.save(os.path.join(outdir, w, "%03d.webp" % k), "WEBP", quality=q, method=6)
    span = round(abs(sel[-1] - sel[0]) * meta["gap"], 1)
    st = {"n": len(sel), "wins": list(wins), "labels": [WINDOWS[w][2] for w in wins], "w": dims[0], "h": dims[1],
          "mm": span, "src": {"range": [a, b], "of": meta["n"], "desc": meta["desc"], "mod": meta["mod"]}}
    with open(os.path.join(outdir, "stack.json"), "w") as f:
        json.dump(st, f)
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(outdir) for f in fs)
    print("built", len(sel), "slices x", len(wins), "windows,", tot // 1024, "KB ->", outdir, json.dumps(st))


def cmd_test():
    import numpy as np
    assert pick(0, 9, 5) == [0, 2, 4, 7, 9], pick(0, 9, 5)
    assert pick(3, 5, 10) == [3, 4, 5]
    assert pick(9, 0, 2) == [0, 9]
    a = np.array([[-1000.0, 40.0, 240.0]])
    s = window(a, "soft")
    assert s[0, 0] == 0 and s[0, 2] == 255 and 120 < s[0, 1] < 135, s
    m = window(np.arange(100.0).reshape(10, 10), "mr", (0, 99))
    assert m[0, 0] == 0 and m[9, 9] == 255
    x = np.arange(4.0).reshape(2, 2)
    assert (display(x, [1, 0, 0, 0, 1, 0]) == x).all()
    assert (display(x, [-1, 0, 0, 0, 1, 0]) == x[:, ::-1]).all()
    assert (display(x, [1, 0, 0, 0, -1, 0]) == x[::-1, :]).all()
    print("ok")


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    c = argv[0]
    opt = lambda k, d=None: argv[argv.index("--" + k) + 1] if "--" + k in argv else d
    if c == "test":
        return cmd_test()
    if c == "fetch":
        return cmd_fetch(argv[1], argv[2])
    if c == "fetchlist":
        return cmd_fetchlist(argv[1], argv[2])
    if c == "info":
        return cmd_info(argv[1])
    if c == "zoom":  # zoom <dir> <out.jpg> --range A B [--step 1] [--crop x0 y0 x1 y1] [--win soft]: 5 tiles a row, 300 px
        import numpy as np
        from PIL import Image, ImageDraw
        ds, meta = load(argv[1])
        i = argv.index("--range")
        a, b = int(argv[i + 1]), min(int(argv[i + 2]), len(ds) - 1)
        cr = argv.index("--crop") if "--crop" in argv else -1
        crop = tuple(int(v) for v in argv[cr + 1:cr + 5]) if cr >= 0 else None
        win = opt("win", "mr" if meta["mod"] == "MR" else "soft")
        tiles = []
        for k in range(a, b + 1, int(opt("step", 1))):
            arr = display(pixels(ds[k]), meta["iop"])
            im = Image.fromarray(window(arr, win, (float(np.percentile(arr, 1)), float(np.percentile(arr, 99.5))) if WINDOWS[win][0] is None else None))
            if crop:
                im = im.crop(crop)
            im = im.resize((300, 300))
            ImageDraw.Draw(im).text((4, 3), str(k), fill=255)
            tiles.append(im)
        sh = Image.new("L", (1500, 300 * ((len(tiles) + 4) // 5)))
        for k, im in enumerate(tiles):
            sh.paste(im, ((k % 5) * 300, (k // 5) * 300))
        sh.save(argv[2], quality=82)
        print("zoom", len(tiles), "->", argv[2])
        return
    if c == "views":  # views <stacks.json> <root>: <root>/view/<id>.jpg, the "views" slices side by side (verifier input)
        from PIL import Image
        cfg = json.load(open(argv[1]))["stacks"]
        os.makedirs(os.path.join(argv[2], "view"), exist_ok=True)
        for key, s in cfg.items():
            sel = pick(s["range"][0], s["range"][1], s["n"])
            ks = [min(range(len(sel)), key=lambda k: abs(sel[k] - o)) for o in s["views"]]
            ims = [Image.open(os.path.join(argv[2], "stacks", s["id"], s["wins"][0], "%03d.webp" % k)).convert("L") for k in ks]
            sheet = Image.new("L", (sum(i.size[0] for i in ims) + 10 * (len(ims) - 1), max(i.size[1] for i in ims)))
            x = 0
            for i in ims:
                sheet.paste(i, (x, 0))
                x += i.size[0] + 10
            sheet.save(os.path.join(argv[2], "view", s["id"] + ".jpg"), quality=85)
            print(key, s["id"], "slices", ks)
        return
    if c == "sheets":  # sheets <cands.json> <root>: contact sheets of each img target's fetched candidates -> <root>/sheets/
        from PIL import Image, ImageDraw
        cands = json.load(open(argv[1]))
        out = os.path.join(argv[2], "sheets")
        os.makedirs(out, exist_ok=True)
        rows = []
        for tid, lst in cands.items():
            got = [x for x in lst if x.get("lic") and x.get("file") and os.path.exists(os.path.join(argv[2], "view", x["file"].replace(".webp", ".jpg")))][:4]
            if got:
                rows.append((tid, got))
        for s in range(0, len(rows), 4):
            sheet = Image.new("RGB", (4 * 330, 4 * 330), (0, 0, 0))
            d = ImageDraw.Draw(sheet)
            for r, (tid, got) in enumerate(rows[s:s + 4]):
                for k, x in enumerate(got):
                    im = Image.open(os.path.join(argv[2], "view", x["file"].replace(".webp", ".jpg"))).convert("RGB")
                    im.thumbnail((320, 300))
                    sheet.paste(im, (k * 330, r * 330 + 22))
                    d.text((k * 330 + 2, r * 330 + 4), "%s #%d %s" % (tid, k, x["pmcid"]), fill=(255, 255, 0))
            sheet.save(os.path.join(out, "s%02d.jpg" % (s // 4)), quality=82)
        print("sheets", (len(rows) + 3) // 4)
        return
    if c == "cite":  # cite <collection page.html> <doi fragment>: the page text before the DOI (the data citation)
        import re
        import html as H
        s = open(argv[1], encoding="utf-8", errors="ignore").read()
        t = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
        t = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t)))
        k = t.find(argv[2])
        print(t[max(0, k - 400):k + 20] if k >= 0 else "none")
        return
    if c == "montages":  # montages <dicom root> <out dir>: every series, MR stretched, CT soft tissue
        os.makedirs(argv[2], exist_ok=True)
        for sid in sorted(os.listdir(argv[1])):
            d = os.path.join(argv[1], sid)
            out = os.path.join(argv[2], sid + ".jpg")
            if os.path.isdir(d) and not os.path.exists(out):
                _, meta = load(d)
                cmd_montage(d, out, "mr" if meta["mod"] == "MR" else "soft", max(1, meta["n"] // 60))
        return
    if c == "montage":
        return cmd_montage(argv[1], argv[2], opt("win", "soft"), int(opt("every", 4)))
    if c == "build":
        i = argv.index("--range")
        cr = argv.index("--crop") if "--crop" in argv else -1
        return cmd_build(argv[1], argv[2], (int(argv[i + 1]), int(argv[i + 2])), int(opt("n", 60)),
                         tuple(opt("win", "soft").split(",")), int(opt("size", 512)), int(opt("q", 72)),
                         [int(v) for v in argv[cr + 1:cr + 5]] if cr >= 0 else None)
    raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
