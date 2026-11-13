import json, sys, cactus
m=cactus.Mirage(); I=sys.argv[1]
r=m.describe(I+"/07_lab.png", sections=["text"]); print("LAB", [t["string"] for t in r["text"]])
form={"frequency":{"enum":["OD","BD","TDS","SOS","HS"]},"route":{"enum":["oral","IV","IM","SC"]}}
for f,exp in [("04_single_bd","BD/oral"),("05_single_od","OD/oral"),("06_single_tds","TDS/IV")]:
    try: r=m.extract(f"{I}/{f}.png", form); print(f, "expect", exp, "->", json.dumps(r.get("form",r))[:400])
    except Exception as e: print(f, "ERR", e)
try:
    r=m.extract(I+"/04_single_bd.png", {"drug":{"type":"string"},"dose_mg":{"type":"integer","minimum":1,"maximum":2000}}); print("text/int ->", json.dumps(r.get("form",r))[:400])
except Exception as e: print("text/int ERR", e)
