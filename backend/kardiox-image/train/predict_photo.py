#!/usr/bin/env python3
"""Run the trained image model on ECG photo(s) -> top diagnoses. Used for the real-photo test + serving."""
import sys, os, argparse, numpy as np, torch, timm
from PIL import Image
import torchvision.transforms as T
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # package root
try:
    from layout_crop import crop_ecg
except Exception:
    def crop_ecg(x): return x

def load(model_path, dev):
    ck=torch.load(model_path, map_location=dev)
    m=timm.create_model(ck["backbone"], pretrained=False, num_classes=len(ck["classes"]))
    m.load_state_dict(ck["state_dict"]); m.eval().to(dev); return m, ck["classes"]

def predict(m, classes, path, dev):
    tf=T.Compose([T.Lambda(crop_ecg), T.Resize((320,320)), T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)])
    x=tf(Image.open(path).convert("RGB")).unsqueeze(0).to(dev)
    with torch.no_grad(): p=torch.sigmoid(m(x))[0].cpu().numpy()
    order=np.argsort(-p)
    return [(classes[i], round(float(p[i]),3)) for i in order]

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--model", default="image_model.pt"); ap.add_argument("imgs", nargs="+")
    a=ap.parse_args(); dev="cuda" if torch.cuda.is_available() else "cpu"
    m,classes=load(a.model,dev)
    for p in a.imgs:
        print(f"\n{p}");
        for c,v in predict(m,classes,p,dev)[:8]: print(f"   {c:6s} {v:.3f}")
