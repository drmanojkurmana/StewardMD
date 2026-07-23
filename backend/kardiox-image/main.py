"""KardiQ X image-model serving (PoC): ECG photo -> ResNet-18 image classifier -> ECGAnalysis JSON.
Yale-style end-to-end image model (no digitiser). Decision-support only, not a diagnosis."""
import io, os, numpy as np, torch, timm
from PIL import Image
import torchvision.transforms as T
from fastapi import FastAPI, UploadFile, File, Header, HTTPException
from fastapi.responses import JSONResponse

MODEL_PATH = os.environ.get("MODEL_PATH", "image_model.pt")
TOKEN = os.environ.get("PIPELINE_TOKEN", "")   # optional shared token (matches app X-Pipeline-Token)

# class -> (readable label, severity)
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
# --- Stage-1 patient-safety guards (no retrain) ---
SUPPRESSED = {"STTC", "LAD"}      # trained on ALL-ZERO labels (STTC = PTB-XL superclass, never matched as a raw code; LAD absent from PTB-XL scp_codes) -> outputs are meaningless; never surface them
DEFER_THRESHOLD = 0.5             # probabilities are UNCALIBRATED (BCE pos_weight up to 20x) -> below this top score, defer to a physician
NOT_ASSESSED = ["STEMI / acute occlusion MI", "ventricular tachycardia", "ventricular fibrillation",
                "complete (3rd-degree) heart block", "hyperkalaemia", "Brugada pattern",
                "Wellens / De Winter", "pulmonary embolism", "long QT", "pre-excitation (WPW)", "atrial flutter"]
SAFETY_CAVEAT = ("SAFETY: this screen recognises only a limited set of PTB-XL rhythm / conduction / hypertrophy / "
                 "chronic-MI patterns. It does NOT assess for STEMI / occlusion-MI, VT/VF, complete heart block, "
                 "hyperkalaemia, Brugada, Wellens / De Winter, pulmonary embolism, long QT, WPW or atrial flutter - "
                 "a normal or benign result does NOT exclude a life-threatening ECG. Any acute clinical concern "
                 "overrides this tool.")

app = FastAPI()
_dev = "cpu"
_ck = torch.load(MODEL_PATH, map_location=_dev, weights_only=False)
_classes = _ck["classes"]
_model = timm.create_model(_ck["backbone"], pretrained=False, num_classes=len(_classes))
_model.load_state_dict(_ck["state_dict"]); _model.eval()
_tf = T.Compose([T.Resize((320,320)), T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)])
_BB = _ck.get("backbone", "?")                          # e.g. efficientnet_b3 / resnet18 — kept accurate from the checkpoint
_ENGINE = "kardiox-image-" + _BB.replace("_", "")

@app.get("/v1/health")
def health(): return {"status":"ok","model":_ENGINE,"backbone":_BB,"classes":len(_classes),"apiVersion":"2.0"}

def _predict(img: Image.Image):
    x = _tf(img.convert("RGB")).unsqueeze(0)
    with torch.no_grad(): p = torch.sigmoid(_model(x))[0].numpy()
    return {c: float(p[i]) for i,c in enumerate(_classes)}

@app.post("/v1/ecg/analyze-image")
async def analyze_image(image: UploadFile = File(...), x_pipeline_token: str = Header(default="")):
    if TOKEN and x_pipeline_token != TOKEN: raise HTTPException(401, "bad token")
    data = await image.read()
    try: img = Image.open(io.BytesIO(data))
    except Exception: raise HTTPException(400, "invalid image")
    probs = _predict(img)
    # Drop dead/suppressed classes entirely — their scores are meaningless (see SUPPRESSED).
    ranked = [(c, p) for c, p in sorted(probs.items(), key=lambda kv: -kv[1]) if c not in SUPPRESSED]
    norm_p = probs.get("NORM", 0.0)
    abnormal = [(c, p) for c, p in ranked if c != "NORM" and p >= 0.5]
    review = False
    if abnormal:
        top_c, top_p = abnormal[0]
    elif norm_p >= 0.5:
        top_c, top_p = "NORM", norm_p
    else:
        top_c, top_p = (ranked[0] if ranked else ("NORM", norm_p))
        review = True                       # nothing crossed threshold -> uncertain
    if top_p < DEFER_THRESHOLD:
        review = True                       # weak/uncalibrated top score -> defer to a physician

    if review:
        label, severity = "Possible abnormal ECG. Manual physician review recommended.", "warn"
    else:
        label, severity = MAP.get(top_c, (top_c, "info"))

    findings = [{"id":f"f{i}","title":MAP.get(c,(c,"info"))[0],"detail":f"model score {p:.2f} (uncalibrated)",
                 "matched":True,"weight":round(p,2),"severity":MAP.get(c,(c,"info"))[1],"evidence":[]}
                for i,(c,p) in enumerate([(c,p) for c,p in ranked if c!="NORM" and p>=0.4][:5])]
    diffs = [{"label":MAP.get(c,(c,""))[0],"probability":round(p,3)} for c,p in ranked[:6] if p>=0.15]
    lead = (f"Most likely pattern in scope: {MAP.get(top_c,(top_c,''))[0]} (score {top_p:.0%}, uncalibrated)."
            if not review else
            "The model is not confident enough to call a specific pattern - a clinician should read this ECG.")
    interp = (f"KardiQ X image model ({_BB}, reads the ECG photo directly). {lead} "
              "Experimental AI screening from a photo - decision support only, NOT a diagnosis; a clinician must "
              "confirm on the original 12-lead ECG. Real-photo accuracy is still being validated. " + SAFETY_CAVEAT)
    return JSONResponse({
        "schemaVersion":"1.1","id":"", "engine":_ENGINE+"-2.0",
        "verdict":label, "severity":severity, "confidence":round(float(top_p),3),
        "confidenceBand": "high" if (top_p>=0.85 and not review) else "medium" if (top_p>=0.6 and not review) else "low",
        "reviewRecommended": bool(review),
        "measurements":{"ventRateBpm":None,"rhythm":"-","prMs":None,"qrsMs":None,"qtcMs":None,"axisDeg":None},
        "morphology":[], "findings":findings, "differentials":diffs,
        "clinicalInterpretation":interp,
        "notAssessed": NOT_ASSESSED,
        "modelScope": "17 PTB-XL rhythm / conduction / hypertrophy / chronic-MI patterns; NOT an acute-emergency detector",
        "whatToVerify":"Experimental image-AI screen. Confirm every finding on the original 12-lead ECG. This tool does NOT rule out acute emergencies (STEMI, VT/VF, complete heart block, hyperkalaemia, etc.).",
    })
