"""KardioX image-model serving (PoC): ECG photo -> ResNet-18 image classifier -> ECGAnalysis JSON.
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
app = FastAPI()
_dev = "cpu"
_ck = torch.load(MODEL_PATH, map_location=_dev, weights_only=False)
_classes = _ck["classes"]
_model = timm.create_model(_ck["backbone"], pretrained=False, num_classes=len(_classes))
_model.load_state_dict(_ck["state_dict"]); _model.eval()
_tf = T.Compose([T.Resize((320,320)), T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)])

@app.get("/v1/health")
def health(): return {"status":"ok","model":"kardiox-image-resnet18","classes":len(_classes),"apiVersion":"1.0"}

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
    ranked = sorted(probs.items(), key=lambda kv: -kv[1])
    norm_p = probs.get("NORM", 0.0)
    abnormal = [(c,p) for c,p in ranked if c != "NORM" and p >= 0.5]
    if not abnormal and norm_p >= 0.5:
        top_c, top_p = "NORM", norm_p
    else:
        top_c, top_p = (abnormal[0] if abnormal else ranked[0])
    label, severity = MAP.get(top_c, (top_c, "info"))
    findings = [{"id":f"f{i}","title":MAP.get(c,(c,"info"))[0],"detail":f"model probability {p:.2f}",
                 "matched":True,"weight":round(p,2),"severity":MAP.get(c,(c,"info"))[1],"evidence":[]}
                for i,(c,p) in enumerate([(c,p) for c,p in ranked if c!="NORM" and p>=0.4][:5])]
    diffs = [{"label":MAP.get(c,(c,""))[0],"probability":round(p,3)} for c,p in ranked[:6] if p>=0.15]
    interp = ("KardioX image model (ResNet-18, reads the ECG photo directly). Top finding: "
              f"{label} ({top_p:.0%}). This is an experimental AI screening read from a photo — decision "
              "support only, NOT a diagnosis; confirm on the original ECG and clinically. Accuracy on real "
              "photos is still being validated.")
    return JSONResponse({
        "schemaVersion":"1.0","id":"", "engine":"kardiox-image-resnet18-1.0",
        "verdict":label, "severity":severity, "confidence":round(float(top_p),3),
        "confidenceBand": "high" if top_p>=0.85 else "medium" if top_p>=0.6 else "low",
        "measurements":{"ventRateBpm":None,"rhythm":"-","prMs":None,"qrsMs":None,"qtcMs":None,"axisDeg":None},
        "morphology":[], "findings":findings, "differentials":diffs,
        "clinicalInterpretation":interp,
        "whatToVerify":"Experimental image-AI screen. Confirm every finding on the original 12-lead ECG.",
    })
