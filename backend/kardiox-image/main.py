"""KardiQ X image-model serving — FULL multi-class ECG module, v3.1 (sanity-fixed).
Restores all 18 findings (AFib, tachy, brady, blocks, MI patterns, LVH, ischaemia, PVC, PAC...)
but fixes the broken serving that mislabeled everything on real ECGs:
  - calibrated probabilities (temperature) so scores aren't inflated to 0.99
  - can say "Normal" and DEFERS to a physician when unsure (never did before)
  - SBRAD is not verdict-eligible (validated worse-than-chance on real -> caused "bradycardia everywhere")
Real-world reliability is honest: MI on CLEAN ECGs is good (AUROC ~0.90); other classes are
synthetic-validated and experimental on real photos. Screening decision-support, NOT a diagnosis."""
import io, os, numpy as np, torch, timm
from PIL import Image
import torchvision.transforms as T
from fastapi import FastAPI, UploadFile, File, Header, HTTPException
from fastapi.responses import JSONResponse

MODEL_PATH = os.environ.get("MODEL_PATH", "image_model.pt")
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
NOT_ASSESSED = ["STEMI / acute occlusion MI (definitive)", "ventricular tachycardia", "ventricular fibrillation",
                "complete (3rd-degree) heart block", "hyperkalaemia", "Brugada pattern",
                "Wellens / De Winter", "pulmonary embolism", "long QT", "pre-excitation (WPW)", "atrial flutter"]
SAFETY_CAVEAT = ("SAFETY: experimental AI screen from an ECG photo. Reliable mainly for MI patterns on clean/"
                 "exported ECGs; rhythm/conduction findings are synthetic-validated and NOT yet reliable on real-"
                 "world phone photos. It does NOT assess STEMI/occlusion-MI definitively, VT/VF, complete heart "
                 "block, hyperkalaemia, Brugada, Wellens/De Winter, PE, long QT, WPW or atrial flutter. A normal or "
                 "benign screen does NOT exclude a life-threatening ECG. Confirm everything on the original 12-lead.")

app = FastAPI()
_dev = "cpu"
_ck = torch.load(MODEL_PATH, map_location=_dev, weights_only=False)
_classes = _ck["classes"]
_model = timm.create_model(_ck["backbone"], pretrained=False, num_classes=len(_classes))
_model.load_state_dict(_ck["state_dict"]); _model.eval()
_tf = T.Compose([T.Resize((320,320)), T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)])
_BB = _ck.get("backbone", "?")
_ENGINE = "kardiox-image-" + _BB.replace("_", "")

@app.get("/v1/health")
def health(): return {"status":"ok","model":_ENGINE,"backbone":_BB,"classes":len(_classes),"mode":"full-calibrated","apiVersion":"3.1"}

def _predict(img: Image.Image):
    x = _tf(img.convert("RGB")).unsqueeze(0)
    with torch.no_grad(): logits = _model(x)[0].numpy()
    p = 1.0 / (1.0 + np.exp(-logits / TEMPERATURE))     # calibrated
    return {c: float(p[i]) for i,c in enumerate(_classes)}

@app.post("/v1/ecg/analyze-image")
async def analyze_image(image: UploadFile = File(...), x_pipeline_token: str = Header(default="")):
    if TOKEN and x_pipeline_token != TOKEN: raise HTTPException(401, "bad token")
    data = await image.read()
    try: img = Image.open(io.BytesIO(data))
    except Exception: raise HTTPException(400, "invalid image")
    probs = _predict(img)
    ranked = [(c, p) for c, p in sorted(probs.items(), key=lambda kv: -kv[1]) if c not in SUPPRESSED]
    norm_p = probs.get("NORM", 0.0)
    # verdict-eligible abnormals (exclude NORM + proven-unreliable SBRAD) that clear the calibrated bar
    abn = [(c, p) for c, p in ranked if c != "NORM" and c not in NOT_VERDICT and p >= VERDICT_THR]

    if abn:
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
    diffs = [{"label": MAP.get(c,(c,""))[0], "probability": round(p, 3)} for c, p in ranked[:6] if p >= 0.15]
    lead = (f"Most likely finding: {MAP.get(top_c,(top_c,''))[0]} (calibrated score {top_p:.0%})."
            if abn else label + ".")
    interp = (f"KardiQ X full ECG screen ({_BB}, reads the photo directly, calibrated). {lead} "
              "EXPERIMENTAL decision-support, NOT a diagnosis. MI patterns on clean ECGs are the most validated; "
              "rhythm/conduction findings are experimental and unreliable on real-world phone photos - treat as "
              "possibilities and confirm every finding on the original 12-lead. " + SAFETY_CAVEAT)
    band = "high" if (top_p >= 0.8 and abn) else "medium" if (top_p >= 0.6) else "low"
    return JSONResponse({
        "schemaVersion":"1.1", "id":"", "engine":_ENGINE+"-3.1",
        "verdict":label, "severity":severity, "confidence":round(float(top_p),3), "confidenceBand":band,
        "reviewRecommended": bool(review),
        "measurements":{"ventRateBpm":None,"rhythm":"-","prMs":None,"qrsMs":None,"qtcMs":None,"axisDeg":None},
        "morphology":[], "findings":findings, "differentials":diffs,
        "clinicalInterpretation":interp,
        "notAssessed": NOT_ASSESSED,
        "modelScope":"18-class ECG screen (rhythm/conduction/hypertrophy/ischaemia/chronic-MI). MI-on-clean is validated (AUROC ~0.90); other classes are synthetic-validated and experimental on real photos. NOT an acute-emergency detector.",
        "whatToVerify":"Experimental screen. Confirm every finding on the original 12-lead ECG. Does NOT rule out STEMI, VT/VF, complete heart block, hyperkalaemia, etc.",
    })
