#!/usr/bin/env python3
"""Render PTB-XL 12-lead signals -> standard ECG images (Yale recipe: ecg-plot, multiple layouts).
Downloads each record's WFDB on demand from PhysioNet, plots to a 3x4+rhythm image (rotating layout
variants for robustness). Parallel across processes. Output: images/<ecg_id>.png.
"""
import os, csv, argparse, io, urllib.request, numpy as np, wfdb
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from concurrent.futures import ProcessPoolExecutor, as_completed

BASE="https://physionet.org/files/ptb-xl/1.0.3/"
LEADS=["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]
LAYOUTS=[  # (rows of leads, rhythm_lead or None) — vary layout to force robustness
  ([["I","aVR","V1","V4"],["II","aVL","V2","V5"],["III","aVF","V3","V6"]], "II"),
  ([["I","aVR","V1","V4"],["II","aVL","V2","V5"],["III","aVF","V3","V6"]], None),
  ([["I","aVL","V1","V4"],["II","-","V2","V5"],["III","aVF","V3","V6"]], "V1"),   # variant
]

def render_one(args):
    ecg_id, fn_hr, out_dir, layout_idx = args
    out=os.path.join(out_dir, f"{int(ecg_id):05d}.png")
    if os.path.exists(out): return ecg_id, True
    base=fn_hr.split("/")[-1]; tmp=f"/tmp/{base}"
    try:
        for ext in (".hea",".dat"):
            if not os.path.exists(tmp+ext): urllib.request.urlretrieve(BASE+fn_hr+ext, tmp+ext)
        sig,meta=wfdb.rdsamp(tmp); sig=sig.T; fs=int(meta["fs"])  # (12, 5000)
    except Exception as e:
        return ecg_id, False
    grid, rhythm = LAYOUTS[layout_idx % len(LAYOUTS)]
    fig,ax=plt.subplots(figsize=(11,8.5),dpi=100); ax.set_xlim(0,10); ax.set_ylim(-6,4); ax.axis("off")
    for gx in np.arange(0,10.001,0.2): ax.axvline(gx,color="#e6a3a3",lw=0.4,zorder=0)
    for gx in np.arange(0,10.001,0.04): ax.axvline(gx,color="#f2cccc",lw=0.2,zorder=0)
    for gy in np.arange(-6,4.001,0.5): ax.axhline(gy,color="#e6a3a3",lw=0.4,zorder=0)
    for gy in np.arange(-6,4.001,0.1): ax.axhline(gy,color="#f2cccc",lw=0.2,zorder=0)
    for r,row in enumerate(grid):
        yoff=2-r*1.4
        for c,L in enumerate(row):
            if L=="-" or L not in LEADS: continue
            li=LEADS.index(L); seg=sig[li,int(c*2.5*fs):int((c+1)*2.5*fs)]
            t=np.linspace(c*2.5,(c+1)*2.5,len(seg))
            ax.plot(t, yoff+np.clip(seg,-1.4,1.4), color="#111", lw=0.7, zorder=2)
            ax.text(c*2.5+0.05, yoff+1.0, L, fontsize=7, color="#111", zorder=3)
    if rhythm and rhythm in LEADS:
        li=LEADS.index(rhythm); ax.plot(np.linspace(0,10,sig.shape[1]), -4.5+np.clip(sig[li],-1.4,1.4), color="#111", lw=0.7, zorder=2)
        ax.text(0.05,-3.7,rhythm+" (rhythm)",fontsize=7,color="#111")
    plt.subplots_adjust(0,0,1,1); fig.savefig(out, dpi=100); plt.close(fig)
    for ext in (".hea",".dat"):
        try: os.remove(tmp+ext)
        except: pass
    return ecg_id, True

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--labels", default="labels.csv"); ap.add_argument("--out", default="images")
    ap.add_argument("--limit", type=int, default=0); ap.add_argument("--workers", type=int, default=8)
    a=ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    rows=list(csv.DictReader(open(a.labels)))
    if a.limit:
        # keep class balance-ish: shuffle deterministically
        import random; random.Random(0).shuffle(rows); rows=rows[:a.limit]
    tasks=[(r["ecg_id"], r["filename_hr"], a.out, i) for i,r in enumerate(rows)]
    ok=0; done=0
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for fut in as_completed([ex.submit(render_one,t) for t in tasks]):
            _,s=fut.result(); ok+=int(s); done+=1
            if done%500==0: print(f"rendered {done}/{len(tasks)} ok={ok}", flush=True)
    print(f"DONE rendered {ok}/{len(tasks)} images -> {a.out}")

if __name__=="__main__": main()
