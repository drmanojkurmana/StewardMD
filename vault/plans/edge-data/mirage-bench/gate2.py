import json, sys, glob, os, cactus
m=cactus.Mirage(); I=sys.argv[1]
C=["xray","skin","eye","ecg","text","other"]
truth={"cxr":"xray","skin":"skin","fundus":"eye","ecg":"ecg","doc":"text","other":"other"}
ok=0;n=0
for p in sorted(glob.glob(I+"/*")):
    b=os.path.basename(p); t=truth[b.split("_")[0]]
    pr=m.extract(p,{"kind":{"enum":C}})["form"]["kind"]["probabilities"]
    best=max((k for k in pr if k!="-"),key=pr.get); n+=1; ok+=best==t
    print(f"{b:22s} {t:6s} -> {best:6s} {'OK' if best==t else '  '}  "+" ".join(f"{k}:{pr[k]:.3f}" for k in C))
print("argmax excl '-':",ok,"/",n)
d=m.describe(I+"/other_astronaut.jpg", sections=["objects"], keywords="face, person")
print("astronaut objects:", [(o.get("label"),o.get("bbox")) for o in d.get("objects",[])])
