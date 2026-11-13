import json, sys, time, glob, os
import cactus
m = cactus.Mirage()
print("weights", m.weights, os.path.getsize(m.weights))
for p in sorted(glob.glob(sys.argv[1]+"/*.png")):
    t=time.time()
    try: r=m.describe(p, sections=["text"])
    except Exception as e: r={"error":str(e)}
    ms=int((time.time()-t)*1000)
    txt=r.get("text") if isinstance(r,dict) else r
    print(f"\n== {os.path.basename(p)}  {ms} ms\n", json.dumps(txt, ensure_ascii=False)[:900])
