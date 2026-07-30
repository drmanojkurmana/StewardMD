#!/usr/bin/env python3
"""KardiQ X image model v4 — ECG-GPT recipe upgrade.
Multi-layout renders + HEAVY photo-realistic augmentation, EfficientNet-B3, temperature calibration,
and a REAL operating point: per-class sensitivity/specificity/PPV/NPV/F1 (threshold chosen on VAL,
measured on TEST) on CLEAN and photo-DISTORTED held-out. Saves ckpt {backbone,classes,state_dict,
temperature,thresholds} + metrics_v4.json, and compares head-to-head vs the current live v2."""
import os, sys, csv, io, json, argparse, numpy as np, torch, torch.nn as nn, timm
from PIL import Image
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
from sklearn.metrics import roc_auc_score, roc_curve
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # package root
try:
    from layout_crop import crop_ecg   # isolate/deskew the waveform region before resize
except Exception:
    def crop_ecg(x): return x

# ---------- photo-realistic lighting sim (applied on PIL before tensor) ----------
def light_sim(img, rng):
    if rng.random() > 0.5: return img
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    ang = rng.uniform(0, np.pi)
    gx, gy = np.cos(ang), np.sin(ang)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    grad = (xx/w*gx + yy/h*gy)
    grad = (grad - grad.min()) / (grad.ptp() + 1e-6)
    scale = (0.65 + 0.7*grad)[..., None]                # 0.65..1.35 brightness ramp = glare/shadow
    return Image.fromarray(np.clip(a*scale, 0, 255).astype(np.uint8))

class ECGImg(Dataset):
    def __init__(self, rows, img_dir, classes, train, strong=True):
        self.rows=rows; self.dir=img_dir; self.classes=classes; self.train=train; self.strong=strong
        aug=[T.Lambda(crop_ecg), T.Resize((320,320))]
        if train and strong:
            aug += [T.RandomApply([T.RandomAffine(degrees=12, translate=(0.03,0.03), scale=(0.9,1.1), shear=7)],0.85),
                    T.RandomPerspective(0.28, 0.6),
                    T.RandomApply([T.ColorJitter(0.35,0.35,0.25,0.04)],0.85),
                    T.RandomApply([T.GaussianBlur(3,(0.1,2.2))],0.45),
                    T.RandomGrayscale(0.05)]
        aug += [T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)]
        if train and strong:
            aug += [T.RandomErasing(0.4, scale=(0.02,0.10)), T.RandomErasing(0.2, scale=(0.02,0.06))]
        self.tf=T.Compose(aug); self.rng=np.random.default_rng(1234)
    def __len__(self): return len(self.rows)
    def __getitem__(self,i):
        r=self.rows[i]; p=os.path.join(self.dir, f"{int(r['ecg_id']):05d}.png")
        img=Image.open(p).convert("RGB")
        if self.train and self.strong:
            img=light_sim(img, self.rng)
            if self.rng.random()<0.5:
                b=io.BytesIO(); img.save(b,"JPEG",quality=int(self.rng.uniform(40,90))); b.seek(0); img=Image.open(b).convert("RGB")
        x=self.tf(img)
        y=torch.tensor([float(r[c]) for c in self.classes])
        return x,y

# a fixed heavy-distortion transform for the sim-to-real EVAL (deterministic per seed)
def distort_eval_tf():
    return T.Compose([T.Lambda(crop_ecg), T.Resize((360,360)),
        T.RandomPerspective(0.3,1.0), T.RandomAffine(degrees=10, translate=(0.04,0.04), scale=(0.9,1.05), shear=5),
        T.ColorJitter(0.4,0.4,0.3), T.GaussianBlur(3,(0.5,2.0)), T.Resize((320,320)),
        T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)])
CLEAN_TF=T.Compose([T.Lambda(crop_ecg), T.Resize((320,320)), T.ToTensor(), T.Normalize([0.5]*3,[0.5]*3)])

def load(labels_csv, img_dir):
    classes=csv.DictReader(open(labels_csv)).fieldnames[4:]
    rows=[r for r in csv.DictReader(open(labels_csv)) if os.path.exists(os.path.join(img_dir,f"{int(r['ecg_id']):05d}.png"))]
    by={s:[r for r in rows if r["split"]==s] for s in ("train","val","test")}
    print("classes:",classes); print("image counts:", {k:len(v) for k,v in by.items()}, flush=True)
    return classes, by

def logits_for(model, rows, img_dir, classes, tf, dev, seed=1):
    torch.manual_seed(seed)
    ds=ECGImg(rows, img_dir, classes, train=False); ds.tf=tf
    dl=DataLoader(ds, batch_size=64, num_workers=6)
    L=[]; Y=[]
    model.eval()
    with torch.no_grad():
        for x,y in dl:
            L.append(model(x.to(dev)).cpu().numpy()); Y.append(y.numpy())
    return np.concatenate(L), np.concatenate(Y)

def fit_temperature(logits, Y):
    lt=torch.tensor(logits, dtype=torch.float32); yt=torch.tensor(Y, dtype=torch.float32)
    logT=torch.zeros(1, requires_grad=True)
    opt=torch.optim.LBFGS([logT], lr=0.05, max_iter=80)
    bce=nn.BCEWithLogitsLoss()
    def closure():
        opt.zero_grad(); loss=bce(lt/torch.exp(logT), yt); loss.backward(); return loss
    opt.step(closure)
    return float(torch.exp(logT).item())

def op_metrics(P, Y, classes, thresholds):
    """P calibrated probs, Y labels, thresholds per-class -> per-class sens/spec/ppv/npv/f1 + counts."""
    out={}
    for i,c in enumerate(classes):
        pos=Y[:,i].sum()
        if pos==0 or pos==len(Y):
            out[c]={"auroc":None,"note":"no evaluable positives"}; continue
        thr=thresholds[i]; pred=(P[:,i]>=thr).astype(int); y=Y[:,i].astype(int)
        tp=int(((pred==1)&(y==1)).sum()); fp=int(((pred==1)&(y==0)).sum())
        fn=int(((pred==0)&(y==1)).sum()); tn=int(((pred==0)&(y==0)).sum())
        sens=tp/(tp+fn) if tp+fn else None; spec=tn/(tn+fp) if tn+fp else None
        ppv=tp/(tp+fp) if tp+fp else None; npv=tn/(tn+fn) if tn+fn else None
        f1=(2*ppv*sens/(ppv+sens)) if (ppv and sens and ppv+sens>0) else None
        try: auroc=roc_auc_score(y,P[:,i])
        except Exception: auroc=None
        out[c]={"auroc":auroc,"threshold":round(thr,3),"sensitivity":sens,"specificity":spec,
                "ppv":ppv,"npv":npv,"f1":f1,"tp":tp,"fp":fp,"fn":fn,"tn":tn,"n_pos":int(pos)}
    aurocs=[v["auroc"] for v in out.values() if v.get("auroc") is not None]
    return out, float(np.mean(aurocs)) if aurocs else None

def youden_thresholds(P, Y, classes):
    thr=np.full(len(classes),0.5)
    for i in range(len(classes)):
        if 0<Y[:,i].sum()<len(Y):
            try:
                fpr,tpr,t=roc_curve(Y[:,i],P[:,i]); j=np.argmax(tpr-fpr)
                thr[i]=float(np.clip(t[j],0.05,0.95))
            except Exception: pass
    return thr

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--labels", default="labels.csv"); ap.add_argument("--img_dir", default="images")
    ap.add_argument("--epochs", type=int, default=16); ap.add_argument("--bs", type=int, default=48)
    ap.add_argument("--out", default="image_model_v4.pt"); ap.add_argument("--backbone", default="efficientnet_b3")
    ap.add_argument("--v2", default="image_model_v2.pt")   # for head-to-head
    a=ap.parse_args()
    classes, by = load(a.labels, a.img_dir)
    dev="cuda" if torch.cuda.is_available() else "cpu"; print("device:",dev,flush=True)
    model=timm.create_model(a.backbone, pretrained=True, num_classes=len(classes)).to(dev)
    tr=DataLoader(ECGImg(by["train"],a.img_dir,classes,True),batch_size=a.bs,shuffle=True,num_workers=8,drop_last=True)
    va=DataLoader(ECGImg(by["val"],a.img_dir,classes,False),batch_size=a.bs,num_workers=6)
    Ytr=np.array([[float(r[c]) for c in classes] for r in by["train"]]); pos=Ytr.sum(0); neg=len(Ytr)-pos
    pw=torch.tensor(np.clip(neg/np.clip(pos,1,None),1,20),dtype=torch.float32).to(dev)
    opt=torch.optim.AdamW(model.parameters(),lr=3e-4,weight_decay=1e-4)
    sch=torch.optim.lr_scheduler.CosineAnnealingLR(opt,a.epochs)
    lossf=nn.BCEWithLogitsLoss(pos_weight=pw)
    scaler=torch.cuda.amp.GradScaler(enabled=(dev=="cuda")); best=-1
    def val_auroc():
        L,Y=logits_for(model,by["val"],a.img_dir,classes,CLEAN_TF,dev)
        P=1/(1+np.exp(-L)); aus=[roc_auc_score(Y[:,i],P[:,i]) for i in range(len(classes)) if 0<Y[:,i].sum()<len(Y)]
        return float(np.mean(aus))
    for ep in range(a.epochs):
        model.train()
        for x,y in tr:
            x,y=x.to(dev),y.to(dev); opt.zero_grad()
            with torch.cuda.amp.autocast(enabled=(dev=="cuda")):
                loss=lossf(model(x),y)
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update()
        sch.step(); vα=val_auroc()
        print(f"ep{ep} loss{loss.item():.3f} val_macroAUROC {vα:.3f}", flush=True)
        if vα>best: best=vα; torch.save({"backbone":a.backbone,"classes":classes,"state_dict":model.state_dict()}, a.out)
    # reload best
    ck=torch.load(a.out,map_location=dev); model.load_state_dict(ck["state_dict"]); model.eval()
    # calibrate on val
    Lval,Yval=logits_for(model,by["val"],a.img_dir,classes,CLEAN_TF,dev)
    temp=fit_temperature(Lval,Yval); print("temperature:",round(temp,3),flush=True)
    Pval=1/(1+np.exp(-Lval/temp)); thr=youden_thresholds(Pval,Yval,classes)
    # eval on test: clean + distorted, calibrated, at val-chosen thresholds
    report={"backbone":a.backbone,"temperature":temp,"classes":classes,"n_test":len(by["test"])}
    for name,tf in [("clean",CLEAN_TF),("distorted",distort_eval_tf())]:
        Lte,Yte=logits_for(model,by["test"],a.img_dir,classes,tf,dev)
        Pte=1/(1+np.exp(-Lte/temp))
        per,macro=op_metrics(Pte,Yte,classes,thr)
        report[name]={"macro_auroc":macro,"per_class":per}
        print(f"[{name}] macro-AUROC {macro:.3f}",flush=True)
    # head-to-head vs v2 on the SAME distorted test images (shared classes)
    try:
        ck2=torch.load(a.v2,map_location=dev); m2=timm.create_model(ck2["backbone"],pretrained=False,num_classes=len(ck2["classes"])).to(dev)
        m2.load_state_dict(ck2["state_dict"]); m2.eval(); cl2=ck2["classes"]
        L2,Y2=logits_for(m2,by["test"],a.img_dir,cl2,distort_eval_tf(),dev)
        P2=1/(1+np.exp(-L2))
        shared=[c for c in classes if c in cl2]
        def macro_on(P,Y,cl):
            aus=[]
            for c in shared:
                i=cl.index(c)
                if 0<Y[:,i].sum()<len(Y):
                    try: aus.append(roc_auc_score(Y[:,i],P[:,i]))
                    except: pass
            return float(np.mean(aus)) if aus else None
        # recompute v4 distorted on shared for apples-to-apples
        Lv4,Yv4=logits_for(model,by["test"],a.img_dir,classes,distort_eval_tf(),dev); Pv4=1/(1+np.exp(-Lv4/temp))
        report["head_to_head_distorted_sharedclasses"]={"v2":macro_on(P2,Y2,cl2),"v4":macro_on(Pv4,Yv4,classes),"shared_n":len(shared)}
        print("head-to-head (distorted, shared classes):", report["head_to_head_distorted_sharedclasses"],flush=True)
    except Exception as e:
        report["head_to_head_error"]=str(e); print("v2 compare skipped:",e,flush=True)
    # save calibration + thresholds into the ckpt for serving
    ck["temperature"]=temp; ck["thresholds"]={c:float(thr[i]) for i,c in enumerate(classes)}; torch.save(ck,a.out)
    json.dump(report, open("metrics_v4.json","w"), indent=2, default=float)
    print("SAVED", a.out, "+ metrics_v4.json", flush=True)

if __name__=="__main__": main()
