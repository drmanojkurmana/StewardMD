"""Benchmark the ST-elevation STEMI layer on SSMCH (real phone photos): coverage, sensitivity,
false-STEMI rate, and a quality-threshold sweep. Local (no network). Writes bench_st.json."""
import sys, os, glob, json, numpy as np
sys.path.insert(0, os.path.expanduser("~/Developer/StewardMD/backend/kardiox-image"))
from st import extract as ex, rule as rl

SS = os.path.expanduser("~/Downloads/SSMCH-ECG")
CLASSES = {"MI": "Myocardial_Infarction", "Normal": "Normal", "Abnormal": "Abnormal"}

rows = []
for cls, folder in CLASSES.items():
    paths = sorted(glob.glob(os.path.join(SS, folder, "*")))
    paths = [p for p in paths if p.lower().endswith((".jpg", ".jpeg", ".png"))]
    for i, p in enumerate(paths):
        try:
            e = ex.extract(p); q = e["quality"]
            if len(e["leads"]) >= 6:
                st = rl.measure_st(e["leads"], e["fs"]); v = rl.stemi_verdict(st)
                pos, score, terr = v["positive"], v["score"], v["territory"]
            else:
                pos, score, terr = False, 0.0, None
            rows.append({"cls": cls, "q": q, "pos": bool(pos), "score": float(score), "terr": terr})
        except Exception as ex_:
            rows.append({"cls": cls, "q": 0.0, "pos": False, "score": 0.0, "terr": "ERR"})
        if (i+1) % 50 == 0:
            print(f"  {cls}: {i+1}/{len(paths)}", flush=True)
    print(f"{cls}: done ({len(paths)})", flush=True)

json.dump(rows, open(os.path.expanduser("~/.claude/jobs/f357192b/tmp/ecgf/bench_st.json"), "w"))

def metrics(rows, thr):
    # STEMI+ = rule ran (q>=thr) AND fired positive; else negative (abstain counts as negative)
    def called(r): return (r["q"] >= thr) and r["pos"]
    P = [r for r in rows if r["cls"] == "MI"]           # STEMI-ish positive
    N = [r for r in rows if r["cls"] in ("Normal", "Abnormal")]
    tp = sum(called(r) for r in P); fn = len(P) - tp
    fp = sum(called(r) for r in N); tn = len(N) - fp
    sens = tp / (tp+fn+1e-9); spec = tn / (tn+fp+1e-9)
    ppv = tp / (tp+fp+1e-9); npv = tn / (tn+fn+1e-9)
    f1 = 2*ppv*sens / (ppv+sens+1e-9)
    cover = np.mean([r["q"] >= thr for r in rows])
    false_stemi = fp / (len(N)+1e-9)
    return dict(thr=thr, sens=sens, spec=spec, ppv=ppv, npv=npv, f1=f1, cover=cover, false_stemi=false_stemi,
                tp=tp, fn=fn, fp=fp, tn=tn)

def auroc(rows, thr):
    # covered MI vs covered Normal, on the ST score
    P = [r["score"] for r in rows if r["cls"]=="MI" and r["q"]>=thr]
    Ng= [r["score"] for r in rows if r["cls"]=="Normal" and r["q"]>=thr]
    if not P or not Ng: return float("nan")
    s=np.array(P+Ng); y=np.array([1]*len(P)+[0]*len(Ng))
    o=np.argsort(s); rank=np.empty_like(o,float); rank[o]=np.arange(1,len(o)+1)
    rp=rank[:len(P)].sum(); return (rp-len(P)*(len(P)+1)/2)/(len(P)*len(Ng))

print("\n=== per-class fire/abstain (at current gate 0.70) ===", flush=True)
for cls in CLASSES:
    R=[r for r in rows if r["cls"]==cls]; n=len(R)
    cov=sum(r["q"]>=0.70 for r in R); fire=sum((r["q"]>=0.70 and r["pos"]) for r in R)
    print(f"  {cls:9} n={n:4} covered={cov:4} ({cov/n*100:4.1f}%)  fired STEMI={fire:3}", flush=True)

print("\n=== threshold sweep ===", flush=True)
print(f"  {'thr':>4} {'cover':>6} {'sens':>5} {'spec':>5} {'PPV':>5} {'NPV':>5} {'F1':>5} {'falseSTEMI':>10} {'AUROC':>6}", flush=True)
for thr in [0.55,0.60,0.65,0.70,0.75,0.80,0.85]:
    m=metrics(rows,thr); a=auroc(rows,thr)
    print(f"  {thr:4.2f} {m['cover']*100:5.1f}% {m['sens']:5.2f} {m['spec']:5.2f} {m['ppv']:5.2f} {m['npv']:5.2f} {m['f1']:5.2f} {m['false_stemi']*100:9.2f}% {a:6.3f}", flush=True)
print("DONE", flush=True)
