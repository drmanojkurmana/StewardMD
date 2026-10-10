#!/usr/bin/env python3
"""finish-g1-sheet.py: verdict table + contact sheets (book | redraw | quiz) + hardest-cases list.
Usage: finish-g1-sheet.py --stage DIR --review DIR [--data DIR] [--full DIR] [--out DIR]
       [--mode full|dry] [--pilot-dir DIR] [--n 40] [--seed 42]"""
import json, os, sys, random, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont

def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d

MODE = arg("--mode", "full")
DATA = os.path.expanduser(arg("--data", os.environ.get("REDRAW_DATA", "~/prep-data/rad/redraw")))
FULL = os.path.expanduser(arg("--full", os.environ.get("REDRAW_FULL", DATA + "/full")))
STAGE = os.path.expanduser(arg("--stage"))
REVIEWD = os.path.expanduser(arg("--review", os.environ.get("REDRAW_REVIEW", DATA + "/review")))
OUT = os.path.expanduser(arg("--out", FULL))
PILOT = os.path.expanduser(arg("--pilot-dir", os.path.expanduser("~/.claude/jobs/c927630f/tmp/redraw")))
N = int(arg("--n", "40"))
SEED = int(arg("--seed", "42"))
FONT = os.path.expanduser("~/Developer/StewardMD/assets/fonts/inter-variable.woff2")
os.makedirs(REVIEWD, exist_ok=True)

def fnt(px, w="Medium"):
    f = ImageFont.truetype(FONT, px)
    f.set_variation_by_name(w)
    return f

def overlay(im, boxes, marks):
    im = im.copy()
    d = ImageDraw.Draw(im)
    W, H = im.size
    for x, y, w, h, label in boxes:
        d.rectangle((x * W, y * H, (x + w) * W, (y + h) * H), outline=(230, 0, 60), width=max(2, W // 250))
        d.text((x * W + 3, y * H + 2), "SPOT:" + label[:24], fill=(230, 0, 60), font=fnt(max(12, W // 45)))
    for x, y, label in marks:
        cx, cy, r = x * W, y * H, max(5, W // 90)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(0, 170, 90), width=3)
        d.text((cx + r + 2, cy - r), label[:24], fill=(0, 140, 70), font=fnt(max(12, W // 45)))
    return im

def main():
    if MODE == "dry":
        spec = json.load(open(PILOT + "/pilot.json"))
        dec = {}
        for l in open(OUT + "/decisions.tsv"):
            if l.strip():
                a = l.rstrip("\n").split("\t")
                dec[a[0]] = a
        figs = sorted(f for f, a in dec.items() if a[1] in ("pilot", "fixed"))
        M = STAGE + "/v1/lessons/media"
        rows = []
        for f in figs:
            a = dec[f]
            orig = Image.open(os.path.expanduser(spec[f]["src"])).convert("RGB")
            full = Image.open(f"{M}/{f}-ai1.webp").convert("RGB") if os.path.exists(f"{M}/{f}-ai1.webp") else None
            hp = f"{M}/{f}-ai1-h.webp"
            hidden = Image.open(hp).convert("RGB") if os.path.exists(hp) else None
            rows.append((f, [orig, full, hidden], f"dry {a[1]} {a[2] if len(a) > 2 else ''}"))
        tag = "dry"
    else:
        uses = json.load(open(DATA + "/uses.json"))
        qa = json.load(open(OUT + "/qa.json")).get("full", {})
        dec = {}
        for l in open(OUT + "/decisions.tsv"):
            if l.strip():
                a = l.rstrip("\n").split("\t")
                dec[a[0]] = a
        acc = [f for f, a in dec.items() if re.match(r"^[01]$", a[1]) or a[1] == "fixed"]
        rnd = random.Random(SEED)
        rnd.shuffle(acc)
        sample = acc[:N]
        M = STAGE + "/v1/lessons/media"
        MAP = json.load(open(STAGE + "/map.json"))
        rows = []
        for f in sample:
            m = MAP.get(f, {})
            o = Image.open(DATA + "/media/" + f).convert("RGB")
            boxes = [(u["spot"]["box"][0], u["spot"]["box"][1], u["spot"]["box"][2], u["spot"]["box"][3],
                      u["spot"].get("label", "")) for u in uses.get(f, []) if u.get("spot")]
            marks = [(mm["x"], mm["y"], mm.get("label", "")) for u in uses.get(f, []) for mm in (u.get("marks") or [])]
            cells = [overlay(o, boxes, marks)]
            for k in ("full", "hidden"):
                nm = m.get(k)
                if nm and os.path.exists(f"{M}/{nm}"):
                    cells.append(overlay(Image.open(f"{M}/{nm}").convert("RGB"), boxes, marks))
                else:
                    cells.append(None)
            e = qa.get(f, {})
            c0 = (e.get("cands", {}).get(dec[f][1], {}) if dec[f][1] in ("0", "1") else {})
            j = c0.get("judge", {})
            rows.append((f, cells, f"pick={dec[f][1]} uses={len(uses.get(f, []))} "
                         f"spot/marks={sum(1 for u in uses.get(f, []) if u.get('spot') or u.get('marks'))} "
                         f"issues={len(j.get('issues', []))}"))
        # hardest 15%: accepted with most issues, then kept with closest call
        hard = []
        for f, a in dec.items():
            if a[1] in ("0", "1"):
                e = qa.get(f, {}).get("cands", {}).get(a[1], {})
                hard.append((len(e.get("judge", {}).get("issues", [])), 0, f))
            elif a[1] == "keep":
                hard.append((99, 1, f))
        hard.sort(reverse=True)
        nh = max(1, round(len(dec) * 0.15))
        open(f"{REVIEWD}/hardest-g1.tsv", "w").write("f\thardness\tnote\n" + "\n".join(
            f"{f}\t{h}\t{(dec[f][2] if len(dec[f]) > 2 else '')[:120]}" for h, _, f in hard[:nh]) + "\n")
        print(f"hardest {nh} written", flush=True)
        tag = "g1"
    # sheets, 20 rows each
    rowh, per = 330, 20
    for si in range(0, max(1, len(rows)), per):
        chunk = rows[si:si + per]
        if not chunk:
            break
        ncol = len(chunk[0][1])
        colw = []
        for i in range(ncol):
            w = 0
            for _, cells, _ in chunk:
                c = cells[i]
                if c is not None:
                    w = max(w, c.width * rowh / c.height)
            colw.append(min(int(w) or 200, 560))
        W = sum(colw) + 12 * ncol + 10
        Ht = sum(rowh + 24 for _ in chunk) + 60
        s = Image.new("RGB", (W, Ht), "white")
        d = ImageDraw.Draw(s)
        d.text((10, 8), f"Redraw {tag} review {si // per + 1} · book figure (labels) | redraw, all labels | quiz variant · seed {SEED}",
               font=fnt(20, "SemiBold"), fill="#16213E")
        heads = ["Book figure", "Redraw, all labels", "Quiz variant (target hidden)"]
        for i, h in enumerate(heads[:ncol]):
            d.text((6 + sum(colw[:i]) + 12 * i, 36), h, font=fnt(15, "SemiBold"), fill="#5B6578")
        y = 58
        for f, cells, note in chunk:
            d.text((6, y), f"{f}  {note}"[:150], fill=(20, 20, 120), font=fnt(14, "SemiBold"))
            x = 6
            for i, c in enumerate(cells):
                if c is not None:
                    t = c.copy()
                    t.thumbnail((colw[i], rowh))
                    s.paste(t, (x, y + 20))
                else:
                    d.text((x + colw[i] // 2, y + 20 + rowh // 2), "n/a", font=fnt(14),
                           fill="#9AA3B2", anchor="mm")
                x += colw[i] + 12
            y += rowh + 24
        p = f"{REVIEWD}/sheet-{tag}-{si // per + 1:02d}.jpg"
        s.save(p, quality=85)
        print(p, s.size, os.path.getsize(p) // 1024, "KB", flush=True)
    # verdict table copy into review
    import shutil
    shutil.copy(OUT + "/verdicts.tsv", f"{REVIEWD}/verdicts-{tag}.tsv")
    print("verdicts copied", flush=True)

if __name__ == "__main__":
    if not STAGE:
        sys.exit("need --stage DIR --review DIR")
    main()
