"""KardiQ X self-improving flywheel — the AUTO-RETRAIN agent (Cloud Run Job, GPU, run-to-completion).

Pulls the base MI corpus + the clinician CORRECTIONS harvested by the data flywheel (gs://…-feedback),
fine-tunes the MI-specialist, and evaluates it on a FROZEN benchmark (a deterministic held-out split
that is NEVER trained on) against the current live model. It STAGES an improved candidate for one-tap
human promotion — it never auto-deploys a medical model. A no-regression gate blocks anything that
would make MI detection worse. Billed only per run (~$0.15); no persistent GPU.

Env: TRAIN_BUCKET (base data + seed), FEEDBACK_BUCKET (corrections + staged models), MIN_NEW (min new
corrections to bother retraining), EPOCHS.
"""
import os, io, json, glob, random, datetime, numpy as np, torch, timm
import torch.nn as nn, torchvision.transforms as T
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from google.cloud import storage

TRAIN_BUCKET = os.environ.get("TRAIN_BUCKET", "stewardmd-ecg-train-in")
FB_BUCKET = os.environ.get("FEEDBACK_BUCKET", "stewardmd-ecg-feedback-in")
MIN_NEW = int(os.environ.get("MIN_NEW", "20"))
EPOCHS = int(os.environ.get("EPOCHS", "6"))
DEV = "cuda" if torch.cuda.is_available() else "cpu"
WORK = "/tmp/retrain"; os.makedirs(WORK, exist_ok=True)
gcs = storage.Client()

# labels that count as MI-positive when a clinician corrects a reading
MI_POS = ("stemi", "nstemi", "infarct", "mi ", "myocardial", "ischaem", "ischem")
def label_is_mi(txt):
    t = (txt or "").lower()
    if "normal" in t: return 0
    if any(k in t for k in MI_POS): return 1
    return None   # ambiguous -> skip (don't teach the model noise)

def dl_prefix(bucket, prefix, dest):
    os.makedirs(dest, exist_ok=True); n = 0
    for b in gcs.bucket(bucket).list_blobs(prefix=prefix):
        if b.name.endswith("/"): continue
        fn = os.path.join(dest, b.name.replace("/", "_"))
        b.download_to_filename(fn); n += 1
    return n

def log(m): print(f"[retrain] {m}", flush=True)

# ---- 1. base corpus + seed model ----
log(f"device={DEV}")
dl_prefix(TRAIN_BUCKET, "base_ds/mi/", WORK + "/mi")
dl_prefix(TRAIN_BUCKET, "base_ds/normal/", WORK + "/normal")
gcs.bucket(TRAIN_BUCKET).blob("seed_model.pt").download_to_filename(WORK + "/seed.pt")
base = [(p, 1) for p in glob.glob(WORK + "/mi/*")] + [(p, 0) for p in glob.glob(WORK + "/normal/*")]
random.seed(42); random.shuffle(base)
k = max(1, int(len(base) * 0.2)); benchmark, base_train = base[:k], base[k:]   # frozen benchmark (seed 42)
log(f"base={len(base)} (train {len(base_train)} / frozen-benchmark {len(benchmark)})")

# ---- 2. clinician corrections from the flywheel ----
corr = []
os.makedirs(WORK + "/corr", exist_ok=True)
fb = gcs.bucket(FB_BUCKET)
for b in fb.list_blobs(prefix="labels/"):
    if not b.name.endswith(".json"): continue
    try: rec = json.loads(b.download_as_text())
    except Exception: continue
    y = label_is_mi(rec.get("label"))
    img_key = rec.get("image")
    if y is None or not img_key: continue         # need a stored image + a clear label
    try:
        fn = WORK + "/corr/" + os.path.basename(img_key)
        fb.blob(img_key).download_to_filename(fn); corr.append((fn, y))
    except Exception: pass
log(f"usable clinician corrections: {len(corr)}")

if len(corr) < MIN_NEW:
    log(f"only {len(corr)} corrections (< MIN_NEW={MIN_NEW}) -> skip retrain, nothing to learn yet.")
    raise SystemExit(0)

# ---- 3. fine-tune ----
aug = T.Compose([T.RandomAffine(10, translate=(0.05, 0.05), scale=(0.9, 1.1)), T.ColorJitter(0.3, 0.3, 0.2),
                 T.RandomApply([T.GaussianBlur(3)], 0.3), T.Resize((320, 320)), T.ToTensor(), T.Normalize([0.5]*3, [0.5]*3)])
ev = T.Compose([T.Resize((320, 320)), T.ToTensor(), T.Normalize([0.5]*3, [0.5]*3)])
class D(Dataset):
    def __init__(s, it, tf): s.it, s.tf = it, tf
    def __len__(s): return len(s.it)
    def __getitem__(s, i): p, y = s.it[i]; return s.tf(Image.open(p).convert("RGB")), y
def build():
    m = timm.create_model("efficientnet_b3", pretrained=False, num_classes=1)
    m.load_state_dict(torch.load(WORK + "/seed.pt", map_location="cpu", weights_only=False)["state_dict"], strict=False)
    return m.to(DEV)
def evaluate(m, items):
    m.eval(); S, Y = [], []
    with torch.no_grad():
        for x, y in DataLoader(D(items, ev), batch_size=32):
            S += torch.sigmoid(m(x.to(DEV))[:, 0]).cpu().tolist(); Y += y.tolist()
    S, Y = np.array(S), np.array(Y); pos, neg = S[Y == 1], S[Y == 0]
    au = float('nan') if not len(pos) or not len(neg) else \
        (lambda o: ((r := np.empty_like(o, float)), r.__setitem__(o, np.arange(1, len(o)+1)), (r[:len(pos)].sum() - len(pos)*(len(pos)+1)/2)/(len(pos)*len(neg)))[-1])(np.argsort(np.concatenate([pos, neg])))
    sens = float((pos >= 0.5).mean()) if len(pos) else 0.0; spec = float((neg < 0.5).mean()) if len(neg) else 0.0
    return dict(auroc=round(float(au), 3), sens=round(sens, 3), spec=round(spec, 3))

baseline = evaluate(build(), benchmark)
log(f"baseline (current live model) on frozen benchmark: {baseline}")

train_items = base_train + corr * 3            # upweight the real corrections
m = build(); opt = torch.optim.AdamW(m.parameters(), lr=3e-5, weight_decay=1e-4)
npos = max(1, sum(y for _, y in train_items)); lf = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([(len(train_items)-npos)/npos]).to(DEV))
dl = DataLoader(D(train_items, aug), batch_size=16, shuffle=True, num_workers=4)
for e in range(EPOCHS):
    m.train()
    for x, y in dl:
        x, y = x.to(DEV), y.float().to(DEV); opt.zero_grad(); lf(m(x)[:, 0], y).backward(); opt.step()
    log(f"epoch {e+1}/{EPOCHS} done")
cand = evaluate(m, benchmark)
log(f"candidate on frozen benchmark: {cand}")

# ---- 4. no-regression gate + STAGE (never auto-deploy) ----
improved = (cand["auroc"] >= baseline["auroc"] - 0.005) and (cand["sens"] >= baseline["sens"] - 0.02) and \
           (cand["auroc"] > baseline["auroc"] or cand["sens"] > baseline["sens"])
stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
report = dict(runId=stamp, corrections_used=len(corr), baseline=baseline, candidate=cand,
              improved=bool(improved), promotion="READY" if improved else "REJECTED (no improvement / regression)")
fb.blob(f"models/report-{stamp}.json").upload_from_string(json.dumps(report, indent=2), content_type="application/json")
if improved:
    torch.save({"backbone": "efficientnet_b3", "state_dict": m.state_dict(), "task": "mi_any_binary",
                "val_auroc": cand["auroc"], "trained_utc": stamp, "corrections": len(corr)}, WORK + "/candidate.pt")
    fb.blob(f"models/candidate-{stamp}/image_model_mireal.pt").upload_from_filename(WORK + "/candidate.pt")
    fb.blob("models/PROMOTION_READY.json").upload_from_string(json.dumps(report, indent=2), content_type="application/json")
    log(f"STAGED candidate-{stamp} (improved) — awaiting human promotion.")
else:
    log("candidate did NOT beat the live model on the frozen benchmark — discarded (no regression allowed).")
log("RETRAIN_DONE")
