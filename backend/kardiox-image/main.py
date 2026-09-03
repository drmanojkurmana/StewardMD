"""KardiQ X image-model serving — FULL multi-class ECG module, v3.2 (MI-specialist ensemble).
Base = the calibrated 19-class screen (v3.1). NEW: a dedicated binary "MI-any" specialist
(image_model_mireal.pt, efficientnet_b3, val AUROC ~0.945) is fused in to fix the two real-photo
failures measured on the Mendeley MI/Normal sets:
  - ARGMAX SUPPRESSION: the 19-class argmax let IRBBB/1AVB outrank IMI/AMI/ASMI, so MI (MI-any prob
    high in 97% of MIs) only *won* the verdict ~58% of the time. The specialist ELEVATES MI to the
    headline when fused MI-any clears MI_THR, regardless of the multiclass argmax.
  - FALSE-POSITIVE MI: the base over-called MI on normals (specificity 0.66). The specialist VETOES
    the base's MI classes when it says "not MI" (fused specificity ~0.99).
Everything else (calibration, Normal/defer, SBRAD barred, findings, disclaimers) is unchanged.
Screening decision-support, NOT a diagnosis. Still does NOT assess STEMI/occlusion definitively."""
import io, os, json, time, numpy as np, torch, timm, secrets
try:
    from layout_crop import crop_ecg, is_ecg   # crop_ecg: isolate/deskew ECG region; is_ecg: reject non-ECG photos
except Exception:
    def crop_ecg(x): return x                  # fail-safe: no-op if OpenCV/module missing
    def is_ecg(x, **k): return (True, {"reason": "layout_crop-missing"})   # fail-open: never block
from PIL import Image
import torchvision.transforms as T
from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Form, Query
from fastapi.responses import JSONResponse

MODEL_PATH = os.environ.get("MODEL_PATH", "image_model.pt")
MIREAL_PATH = os.environ.get("MIREAL_PATH", "image_model_mireal.pt")
TOKEN = os.environ.get("PIPELINE_TOKEN", "")
TEMPERATURE = 1.781                        # calibration fitted on held-out val -> de-inflate scores

MAP = {
 "NORM":("Normal ECG","stable"), "AFIB":("Atrial fibrillation","urgent"),
 "STACH":("Sinus tachycardia","warn"), "SBRAD":("Sinus bradycardia","warn"),
 "1AVB":("First-degree AV block","info"), "CRBBB":("Complete right bundle branch block","warn"),
 "IRBBB":("Incomplete right bundle branch block","info"), "CLBBB":("Complete left bundle branch block","warn"),
 "LAFB":("Left anterior fascicular block","info"), "IMI":("Inferior MI pattern","urgent"),
 "AMI":("Anterior MI pattern","urgent"), "ASMI":("Anteroseptal MI pattern","urgent"),
 "LVH":("Left ventricular hypertrophy","warn"), "ISC_":("Ischaemic changes","warn"),
 "STTC":("ST-T changes","warn"), "NDT":("Non-specific T-wave abnormality","info"),
 "PVC":("Premature ventricular complexes","warn"), "PAC":("Premature atrial complexes","info"),
 "LAD":("Left axis deviation","info"),
}
SUPPRESSED = {"STTC", "LAD"}               # trained on all-zero labels -> meaningless
NOT_VERDICT = {"SBRAD"}                     # real-world AUROC 0.38 (worse than chance) -> may show as a weak
                                           #   differential but must NEVER be the headline (caused the bug)
VERDICT_THR = 0.55                          # calibrated prob to assert an abnormal verdict
FINDING_THR = 0.45                          # calibrated prob to list as a possible finding
NORM_THR = 0.50
MI_CLASSES = ("IMI", "AMI", "ASMI")         # territorial MI-pattern classes in the base model
MI_THR = 0.50                               # fused MI-any prob to ELEVATE MI to the headline verdict
W_BASE, W_MI = 0.90, 0.945                  # fusion weights ~ per-model real-photo AUROC (base, specialist)
NOT_ASSESSED = ["STEMI / acute occlusion MI (definitive)", "ventricular tachycardia", "ventricular fibrillation",
                "complete (3rd-degree) heart block", "hyperkalaemia", "Brugada pattern",
                "Wellens / De Winter", "pulmonary embolism", "long QT", "pre-excitation (WPW)", "atrial flutter"]
SAFETY_CAVEAT = ("SAFETY: experimental AI screen from an ECG photo. MI-any is now backed by a dedicated "
                 "specialist model (val AUROC ~0.94); rhythm/conduction findings are synthetic-validated and NOT "
                 "yet reliable on real-world phone photos. It does NOT assess STEMI/occlusion-MI definitively, VT/VF, "
                 "complete heart block, hyperkalaemia, Brugada, Wellens/De Winter, PE, long QT, WPW or atrial flutter. "
                 "A normal or benign screen does NOT exclude a life-threatening ECG. Confirm everything on the original 12-lead.")

app = FastAPI()
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
_dev = "cpu"
_ck = torch.load(MODEL_PATH, map_location=_dev, weights_only=False)
_classes = _ck["classes"]
_model = timm.create_model(_ck["backbone"], pretrained=False, num_classes=len(_classes))
_model.load_state_dict(_ck["state_dict"]); _model.eval()
_tf = T.Compose([T.Lambda(crop_ecg), T.Resize((320,320)), T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)])
_BB = _ck.get("backbone", "?")
_ENGINE = "kardiox-image-" + _BB.replace("_", "")

# MI-specialist: dedicated binary "MI-any" head. Loaded best-effort; if absent the service degrades
# gracefully to the base-only v3.1 behaviour (mi_p = None everywhere).
try:
    _mick = torch.load(MIREAL_PATH, map_location=_dev, weights_only=False)
    _mi_model = timm.create_model("efficientnet_b3", pretrained=False, num_classes=1)
    _mi_model.load_state_dict(_mick["state_dict"]); _mi_model.eval()
    _MI_AUROC = round(float(_mick.get("val_auroc", 0.945)), 3)
except Exception:
    _mi_model = None; _MI_AUROC = None

# ── Candidate 19-class model (textbook-fine-tuned) — A/B TEST ONLY, never the default. ──
# Enabled per request via ?variant=candidate|compare. Same serving contract as the base model.
# This lets us evaluate the candidate on real inputs BEFORE any promotion (no real-photo benchmark yet).
V2_PATH = os.environ.get("V2_PATH", "image_model_v2.pt")
try:
    _v2ck = torch.load(V2_PATH, map_location=_dev, weights_only=False)
    _model_v2 = timm.create_model(_v2ck["backbone"], pretrained=False, num_classes=len(_v2ck["classes"]))
    _model_v2.load_state_dict(_v2ck["state_dict"]); _model_v2.eval()
    _v2_classes = _v2ck["classes"]
except Exception:
    _model_v2 = None; _v2_classes = None

# Data flywheel: consent-gated storage of clinician-labelled ECGs to GCS -> the retraining corpus.
FEEDBACK_BUCKET = os.environ.get("FEEDBACK_BUCKET", "stewardmd-ecg-feedback")
try:
    from google.cloud import storage as _gcs
    _fb_bucket = _gcs.Client().bucket(FEEDBACK_BUCKET)
except Exception:
    _fb_bucket = None

# ── Per-user training-contribution quota + admin controls (keeps retraining cost under budget) ──
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
DEFAULT_TRAIN_LIMIT = int(os.environ.get("DEFAULT_TRAIN_LIMIT", "30"))   # training images / user / month
def _month(): return time.strftime("%Y%m", time.gmtime())
def _limits_cfg():
    try:
        b = _fb_bucket.blob("config/limits.json")
        if b.exists():
            c = json.loads(b.download_as_text()); c.setdefault("monthlyLimit", DEFAULT_TRAIN_LIMIT); c.setdefault("exempt", []); c.setdefault("modelLab", []); return c
    except Exception: pass
    return {"monthlyLimit": DEFAULT_TRAIN_LIMIT, "exempt": [], "modelLab": []}
def _user_count(uid, month):
    try:
        b = _fb_bucket.blob(f"counters/{month}/{uid}.json")
        if b.exists(): return int(json.loads(b.download_as_text()).get("count", 0))
    except Exception: pass
    return 0
def _incr_user(uid, month):
    c = _user_count(uid, month) + 1
    try: _fb_bucket.blob(f"counters/{month}/{uid}.json").upload_from_string(json.dumps({"count": c}), content_type="application/json")
    except Exception: pass
    return c

@app.get("/v1/health")
def health(): return {"status":"ok","model":_ENGINE,"backbone":_BB,"classes":len(_classes),
                      "mode":"ensemble-mi-specialist" if _mi_model is not None else "full-calibrated",
                      "miSpecialist": _MI_AUROC, "candidate19": _v2_classes is not None, "apiVersion":"3.2"}

def _predict(img: Image.Image, model=None, classes=None):
    m = model if model is not None else _model
    cs = classes if classes is not None else _classes
    x = _tf(img.convert("RGB")).unsqueeze(0)
    with torch.no_grad(): logits = m(x)[0].numpy()
    p = 1.0 / (1.0 + np.exp(-logits / TEMPERATURE))     # calibrated
    return {c: float(p[i]) for i,c in enumerate(cs)}

def _mi_any(img: Image.Image):
    """Dedicated MI-any specialist probability (sigmoid), or None if the model is unavailable."""
    if _mi_model is None: return None
    x = _tf(img.convert("RGB")).unsqueeze(0)
    with torch.no_grad(): return float(torch.sigmoid(_mi_model(x))[0,0])

@app.post("/v1/ecg/analyze-image")
async def analyze_image(image: UploadFile = File(...), x_pipeline_token: str = Header(default=""),
                        variant: str = Query("prod")):
    if TOKEN and not secrets.compare_digest(x_pipeline_token, TOKEN): raise HTTPException(401, "bad token")
    data = await image.read()
    try: img = Image.open(io.BytesIO(data))
    except Exception: raise HTTPException(400, "invalid image")
    # ── is-ECG gate: refuse to "diagnose" a non-ECG photo. The classifier is a plain per-class sigmoid
    # with no out-of-distribution notion, so before this gate a face photo was forced into a class and
    # returned e.g. "Atrial fibrillation, urgent". An ECG is bright, low-saturation paper; a face/scene
    # is colourful. Env-tunable KX_SAT_MAX; fail-open (a gate error never blocks a real read). ──
    try:
        _ecg_ok, _ecg_detail = is_ecg(img, sat_max=float(os.environ.get("KX_SAT_MAX", "85")))
    except Exception:
        _ecg_ok, _ecg_detail = True, {"reason": "gate-error"}
    if not _ecg_ok:
        return JSONResponse({
            "schemaVersion": "1.1", "id": "", "engine": _ENGINE + "-3.2", "notEcg": True,
            "verdict": "No ECG detected", "severity": "info", "confidence": 0.0, "confidenceBand": "n/a",
            "reviewRecommended": False,
            "measurements": {"ventRateBpm": None, "rhythm": "-", "prMs": None, "qrsMs": None, "qtcMs": None, "axisDeg": None},
            "morphology": [], "findings": [], "differentials": [],
            "clinicalInterpretation": "This image does not look like a 12-lead ECG, so KardiQ X did not attempt a reading. "
                                      "Upload a clear photo of a printed 12-lead ECG — the pink/red grid should fill the frame.",
            "notAssessed": NOT_ASSESSED, "whatToVerify": "No ECG detected in the image; nothing was analysed.",
            "gate": _ecg_detail,
        })
    # variant: "prod" (default, unchanged) | "candidate" (use the textbook-fine-tuned 19-class) |
    #          "compare" (prod result + a side-by-side compare19 block for A/B testing).
    _cand_ok = _model_v2 is not None
    probs = _predict(img, _model_v2, _v2_classes) if (variant == "candidate" and _cand_ok) else _predict(img)
    compare19 = None
    if variant == "compare" and _cand_ok:
        pc = _predict(img, _model_v2, _v2_classes)
        tp = max(probs, key=probs.get); tc = max(pc, key=pc.get)
        compare19 = {"prod": {"top": MAP.get(tp,(tp,))[0], "cls": tp, "conf": round(probs[tp],3)},
                     "candidate": {"top": MAP.get(tc,(tc,))[0], "cls": tc, "conf": round(pc[tc],3)},
                     "agree": tp == tc}
    _used_variant = "candidate" if (variant == "candidate" and _cand_ok) else "prod"

    # ── MI ensemble: fuse the base's territorial MI signal with the dedicated specialist ──
    mi_p = _mi_any(img)
    base_mi = max(probs[c] for c in MI_CLASSES)
    mi_fused = base_mi if mi_p is None else (W_BASE*base_mi + W_MI*mi_p) / (W_BASE + W_MI)
    mi_positive = mi_fused >= MI_THR
    # When the specialist is confident it is NOT MI, veto the base's MI classes (kills false positives).
    mi_veto = (mi_p is not None) and (mi_fused < FINDING_THR)

    def _elig(c):
        if c in SUPPRESSED: return False
        if c in MI_CLASSES and mi_veto: return False
        return True
    ranked = [(c, p) for c, p in sorted(probs.items(), key=lambda kv: -kv[1]) if _elig(c)]
    norm_p = probs.get("NORM", 0.0)
    abn = [(c, p) for c, p in ranked if c != "NORM" and c not in NOT_VERDICT and p >= VERDICT_THR]

    if mi_positive:
        # ELEVATE MI regardless of the multiclass argmax; report the most likely territory.
        top_c = max(MI_CLASSES, key=lambda c: probs[c]); top_p = mi_fused
        label, severity, review = MAP[top_c][0], "urgent", True
    elif abn:
        top_c, top_p = abn[0]
        label, severity = MAP.get(top_c, (top_c, "info")); review = True
    elif norm_p >= NORM_THR:
        top_c, top_p = "NORM", norm_p
        label, severity, review = "Normal ECG (screening - confirm clinically)", "stable", False
    else:
        top_c, top_p = (ranked[0] if ranked else ("NORM", norm_p))
        label, severity, review = "Inconclusive - physician review recommended", "warn", True

    findings = [{"id": f"f{i}", "title": MAP.get(c,(c,"info"))[0],
                 "detail": f"possible - calibrated score {p:.2f}; confirm on 12-lead" + (" (rhythm output experimental)" if c in NOT_VERDICT else ""),
                 "matched": True, "weight": round(p, 2), "severity": MAP.get(c,(c,"info"))[1], "evidence": []}
                for i, (c, p) in enumerate([(c, p) for c, p in ranked if c != "NORM" and p >= FINDING_THR][:5])]
    # Explicit MI-any finding from the specialist (surfaces the fused evidence even when territory is unclear).
    if mi_p is not None:
        findings.insert(0, {"id": "mi_any", "title": "MI-any (specialist screen)",
                            "detail": f"dedicated MI detector: fused score {mi_fused:.2f} (specialist {mi_p:.2f}, base {base_mi:.2f}; val AUROC ~{_MI_AUROC}). "
                                      + ("POSITIVE - correlate clinically for infarction and confirm on 12-lead." if mi_positive else "below the MI threshold."),
                            "matched": bool(mi_positive), "weight": round(mi_fused, 2),
                            "severity": "urgent" if mi_positive else "info", "evidence": []})
    diffs = [{"label": MAP.get(c,(c,""))[0], "probability": round(p, 3)} for c, p in ranked[:6] if p >= 0.15]
    lead = (f"Most likely finding: {MAP.get(top_c,(top_c,''))[0]} (score {top_p:.0%})." if (mi_positive or abn) else label + ".")
    interp = (f"KardiQ X full ECG screen ({_BB}, reads the photo directly, calibrated) + dedicated MI-any specialist. {lead} "
              "EXPERIMENTAL decision-support, NOT a diagnosis. MI-any is specialist-backed (val AUROC ~0.94); "
              "rhythm/conduction findings are experimental and unreliable on real-world phone photos - treat as "
              "possibilities and confirm every finding on the original 12-lead. " + SAFETY_CAVEAT)
    band = "high" if (top_p >= 0.8 and (mi_positive or abn)) else "medium" if (top_p >= 0.6) else "low"
    return JSONResponse({
        "schemaVersion":"1.1", "id":"", "engine":_ENGINE+"-3.2",
        "verdict":label, "severity":severity, "confidence":round(float(top_p),3), "confidenceBand":band,
        "reviewRecommended": bool(review),
        "measurements":{"ventRateBpm":None,"rhythm":"-","prMs":None,"qrsMs":None,"qtcMs":None,"axisDeg":None},
        "morphology":[], "findings":findings, "differentials":diffs,
        "clinicalInterpretation":interp,
        "notAssessed": NOT_ASSESSED,
        "miAny": None if mi_p is None else {"fused": round(mi_fused,3), "specialist": round(mi_p,3), "base": round(base_mi,3), "positive": bool(mi_positive), "valAuroc": _MI_AUROC},
        "modelScope":"19-class ECG screen + dedicated MI-any specialist. MI-any is validated (specialist val AUROC ~0.94, real-photo sens/spec ~0.98/0.99 on the Mendeley set - likely optimistic from train overlap); other classes are synthetic-validated and experimental on real photos. NOT an acute-emergency detector.",
        "whatToVerify":"Experimental screen. Confirm every finding on the original 12-lead ECG. Does NOT rule out STEMI, VT/VF, complete heart block, hyperkalaemia, etc.",
        "modelVariant": _used_variant, "compare19": compare19,
    })

@app.post("/v1/ecg/feedback")
async def feedback(aiVerdict: str = Form(""), label: str = Form(""), correct: str = Form("0"),
                   consent: str = Form("0"), ts: str = Form(""), userId: str = Form("anon"),
                   image: UploadFile = File(default=None)):
    """Data flywheel: store one clinician-labelled example. The label record is always kept; the ECG
    IMAGE (training data) is stored ONLY with explicit consent AND while the user is under their monthly
    training quota (exempt users unlimited). Retraining reads gs://<bucket>/{labels,images}/."""
    rec = {"ts": ts or str(int(time.time()*1000)), "aiVerdict": aiVerdict, "label": label,
           "correct": correct == "1", "consent": consent == "1", "userId": userId, "engine": _ENGINE + "-3.2"}
    if _fb_bucket is None:
        return {"stored": False, "reason": "storage unavailable"}
    cfg = _limits_cfg(); month = _month(); limit = int(cfg.get("monthlyLimit", DEFAULT_TRAIN_LIMIT))
    exempt = userId in cfg.get("exempt", [])
    used = _user_count(userId, month)
    capped = (not exempt) and used >= limit
    rec["trainingCapped"] = bool(capped)
    key = rec["ts"] + "-" + str(abs(hash(aiVerdict + "|" + label)) % 1000000)
    try:
        _fb_bucket.blob("labels/" + key + ".json").upload_from_string(json.dumps(rec), content_type="application/json")
        if image is not None and consent == "1" and not capped:
            data = await image.read()
            if data:
                _fb_bucket.blob("images/" + key + ".img").upload_from_string(data)
                rec["image"] = "images/" + key + ".img"
                used = _incr_user(userId, month)
        return {"stored": True, "key": key, "image": rec.get("image"),
                "trainingCapped": bool(capped), "used": used, "limit": ("unlimited" if exempt else limit)}
    except Exception as e:
        return {"stored": False, "reason": str(e)[:150]}

@app.get("/v1/admin/limits")
def admin_get(x_admin_token: str = Header(default="")):
    if not ADMIN_TOKEN or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN): raise HTTPException(401, "bad admin token")
    if _fb_bucket is None: return {"error": "no storage"}
    cfg = _limits_cfg(); month = _month(); usage = {}
    for b in _fb_bucket.list_blobs(prefix=f"counters/{month}/"):
        uid = b.name.split("/")[-1][:-5]
        try: usage[uid] = int(json.loads(b.download_as_text()).get("count", 0))
        except Exception: pass
    total = sum(usage.values())
    est = round(1.0 + total * 0.5/1024 * 0.02, 2)   # ~$1 monthly GPU retrain + storage; inference free-tier
    return {"config": cfg, "month": month, "usage": usage, "totalTrainingImages": total,
            "estMonthlyCostUsd": est, "budgetUsd": 2.0}

@app.post("/v1/admin/limits")
async def admin_set(monthlyLimit: int = Form(default=None), exempt: str = Form(default=None),
                    modelLab: str = Form(default=None), x_admin_token: str = Header(default="")):
    if not ADMIN_TOKEN or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN): raise HTTPException(401, "bad admin token")
    if _fb_bucket is None: raise HTTPException(503, "no storage")
    cfg = _limits_cfg()
    if monthlyLimit is not None: cfg["monthlyLimit"] = int(monthlyLimit)
    if exempt is not None: cfg["exempt"] = [e.strip() for e in exempt.split(",") if e.strip()]
    if modelLab is not None: cfg["modelLab"] = [e.strip().lower() for e in modelLab.split(",") if e.strip()]
    _fb_bucket.blob("config/limits.json").upload_from_string(json.dumps(cfg), content_type="application/json")
    return {"saved": True, "config": cfg}

# Public: does this user get the "Model Lab" beta (candidate-19 shown alongside prod)? Admin-gated list.
@app.get("/v1/model-lab/status")
def model_lab_status(uid: str = Query(default=""), email: str = Query(default="")):
    allow = set(_limits_cfg().get("modelLab", []))
    ident = {x for x in (uid.strip().lower(), email.strip().lower()) if x}
    allowed = (_model_v2 is not None) and bool(ident & allow)
    return {"allowed": bool(allowed), "candidate19": _model_v2 is not None}
