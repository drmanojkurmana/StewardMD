#!/usr/bin/env python3
"""v1-vs-v2 honesty eval on HELD-OUT test records (never trained on).
Scores each model on CLEAN renders vs HEAVY photo-like distortion (perspective+affine+
colorjitter+blur+jpeg) — the clean->distorted AUROC drop is our sim-to-real proxy, and the
DISTORTED number is the closest stand-in for real phone-photo performance. Fair comparison:
identical images + identical (seeded) distortions applied to both models."""
import os, sys, csv, io, numpy as np, torch, timm
from PIL import Image
import torchvision.transforms as T
from sklearn.metrics import roc_auc_score

HOME = os.path.expanduser("~")
sys.path.insert(0, HOME); sys.path.insert(0, os.path.join(HOME, "train")); sys.path.insert(0, "train")

LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 800
rdr = list(csv.DictReader(open(os.path.join(HOME, "labels.csv"))))
fields = list(csv.DictReader(open(os.path.join(HOME, "labels.csv"))).fieldnames)
classes = fields[4:]                                   # header: ecg_id,filename_hr,fold,split,<19 classes>

def img_for(r):
    try: cand = os.path.join(HOME, "images", "%05d.png" % int(r["ecg_id"]))
    except Exception: return None
    return cand if os.path.exists(cand) else None

# Held-out TEST records that were already rendered during training (never in the train split).
allrows = [r for r in rdr if r.get("split") == "test"]
import random; random.Random(1).shuffle(allrows)
have = []
for r in allrows:
    p = img_for(r)
    if p: have.append((p, r))
    if len(have) >= LIMIT: break
print("scored held-out test images: %d" % len(have))

clean = T.Compose([T.Resize((320, 320)), T.ToTensor(), T.Normalize([0.5]*3, [0.5]*3)])
dist = T.Compose([T.Resize((360, 360)),
    T.RandomPerspective(0.3, 1.0), T.RandomAffine(degrees=10, translate=(0.04, 0.04), scale=(0.9, 1.05), shear=5),
    T.ColorJitter(0.4, 0.4, 0.3), T.GaussianBlur(3, (0.5, 2.0)), T.Resize((320, 320)),
    T.ToTensor(), T.Normalize([0.5]*3, [0.5]*3)])
def jpeg(im, q=55):
    b = io.BytesIO(); im.save(b, "JPEG", quality=q); b.seek(0); return Image.open(b).convert("RGB")

# preload images once
IMGS = [(Image.open(p).convert("RGB"), r) for p, r in have]

def load(mp):
    ck = torch.load(mp, map_location="cpu", weights_only=False)
    m = timm.create_model(ck["backbone"], pretrained=False, num_classes=len(ck["classes"]))
    m.load_state_dict(ck["state_dict"]); m.eval()
    return m, ck["classes"], ck["backbone"]

def evalm(mp):
    m, mcl, bb = load(mp)
    torch.manual_seed(1)                               # same distortions for every model
    Pc, Pd, Y = [], [], []
    for im, r in IMGS:
        y = [float(r[c]) for c in mcl]
        with torch.no_grad():
            Pc.append(torch.sigmoid(m(clean(im).unsqueeze(0)))[0].numpy())
            Pd.append(torch.sigmoid(m(dist(jpeg(im)).unsqueeze(0)))[0].numpy())
        Y.append(y)
    Pc, Pd, Y = np.array(Pc), np.array(Pd), np.array(Y)
    def per(P):
        d = {}
        for i, c in enumerate(mcl):
            if 0 < Y[:, i].sum() < len(Y):
                try: d[c] = roc_auc_score(Y[:, i], P[:, i])
                except Exception: pass
        return d
    dc, dd = per(Pc), per(Pd)
    return bb, float(np.mean(list(dc.values()))), float(np.mean(list(dd.values()))), dc, dd

res = {}
for name, mp in [("v1", os.path.join(HOME, "image_model_v1.pt")), ("v2", os.path.join(HOME, "image_model_v2.pt"))]:
    if not os.path.exists(mp): print("%s: MISSING %s" % (name, mp)); continue
    bb, mc, md, dc, dd = evalm(mp); res[name] = (bb, mc, md, dc, dd)
    print("\n=== %s (%s) on %d held-out test ECGs ===" % (name, bb, len(IMGS)))
    print("  CLEAN     macro-AUROC %.3f" % mc)
    print("  DISTORTED macro-AUROC %.3f  (photo-like)" % md)
    print("  sim-to-real drop %.3f" % (mc - md))

if "v1" in res and "v2" in res:
    _, mc1, md1, _, dd1 = res["v1"]; _, mc2, md2, _, dd2 = res["v2"]
    print("\n=== v1 vs v2 ===")
    print("  CLEAN     macro: v1 %.3f -> v2 %.3f  (%+.3f)" % (mc1, mc2, mc2 - mc1))
    print("  DISTORTED macro: v1 %.3f -> v2 %.3f  (%+.3f)   <-- real-world proxy" % (md1, md2, md2 - md1))
    print("  per-class DISTORTED (v1 -> v2):")
    for c in classes:
        if c in dd1 and c in dd2:
            print("    %-6s %.3f -> %.3f  (%+.3f)" % (c, dd1[c], dd2[c], dd2[c] - dd1[c]))
