import json, sys, urllib.request, os, io
from PIL import Image
out=sys.argv[1]
sets={"cxr":"hf-vision/chest-xray-pneumonia","skin":"marmal88/skin_cancer","fundus":"Tejaswini628/aptos-fundus-images","ecg":"Amarsaish/ecg_images"}
for lab,d in sets.items():
    got=0
    for cfg in ("default",):
        for split in ("train","test"):
            try:
                j=json.load(urllib.request.urlopen(f"https://datasets-server.huggingface.co/first-rows?dataset={d}&config={cfg}&split={split}",timeout=30))
            except Exception as e: continue
            rows=j.get("rows",[])
            step=max(1,len(rows)//5)
            for row in rows[::step]:
                for v in row["row"].values():
                    if isinstance(v,dict) and "src" in v:
                        try:
                            b=urllib.request.urlopen(v["src"],timeout=30).read()
                            im=Image.open(io.BytesIO(b)).convert("RGB"); im.thumbnail((1024,1024))
                            im.save(f"{out}/{lab}_{got}.jpg",quality=90); got+=1
                        except Exception as e: print(lab,"img err",e)
                        break
                if got>=5: break
            if got: break
    print(lab,got)
