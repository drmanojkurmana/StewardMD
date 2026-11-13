import json, sys, glob, os, time, cactus
m=cactus.Mirage(); I=sys.argv[1]
C=["chest x-ray","skin photo","retina fundus photo","ECG","document","other photo"]
truth={"cxr":"chest x-ray","skin":"skin photo","fundus":"retina fundus photo","ecg":"ECG","doc":"document","other":"other photo"}
ok=n=0; rows=[]
for p in sorted(glob.glob(I+"/*")):
    b=os.path.basename(p); t=truth[b.split("_")[0]]
    t0=time.time()
    r=m.extract(p,{"kind":{"enum":C}}).get("form",{}).get("kind",{})
    ms=int((time.time()-t0)*1000)
    pr=r.get("probabilities",{}); top=max(pr,key=pr.get) if pr else None
    d=m.describe(p, sections=["scene","objects"])
    sc=d.get("scene"); objs=[o.get("label") or o.get("name") for o in d.get("objects",[])][:8]
    n+=1; ok+= (r.get("value")==t)
    print(f"{b:22s} truth={t:20s} value={r.get('value')!s:20s} top={top}({pr.get(top,0):.2f}) {ms}ms | scene={json.dumps(sc)[:90]} | objs={objs}")
print("correct",ok,"/",n)
