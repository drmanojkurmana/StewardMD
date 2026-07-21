"""Build a REAL STEMI validation set from PTB-XL (PhysioNet), no mock data.
  positives  = acute ST-elevation / injury codes (INJAS/INJAL/INJIN/INJLA/INJIL), territory-labeled
  negatives  = NORM (clean) + hard negatives CRBBB/IRBBB + CLBBB (BBB secondary ST changes — the
               documented false-positive failure mode for a naive ST-elevation rule)
Saves stemi_valset.json: [{record, group, territory, scp, signal:[12][5000], fs}]."""
import os, csv, ast, json, numpy as np, wfdb
D = os.environ["D"]
CSV = os.path.join(D, "ptbxl_database.csv")
INJ = {"INJAS": "anteroseptal", "INJAL": "anterolateral", "INJIN": "inferior", "INJLA": "lateral", "INJIL": "inferolateral"}
RBBB = {"CRBBB", "IRBBB"}; LBBB = {"CLBBB"}
MI_ANY = set(INJ) | {"AMI", "IMI", "ASMI", "ALMI", "ILMI", "IPMI", "IPLMI", "LMI", "PMI"}
STTC = {"STD_", "NDT", "NST_", "DIG", "LNGQT", "ISC_", "ISCAL", "ISCIN", "ISCIL", "ISCAS", "ISCLA", "ISCAN"}

def codes(s):
    try: return ast.literal_eval(s)
    except Exception: return {}
def folder(n): return f"records500/{(n//1000)*1000:05d}"

rows = list(csv.DictReader(open(CSV)))
pos, norm, rbbb, lbbb = [], [], [], []
for r in rows:
    c = codes(r["scp_codes"]); ecg = int(r["ecg_id"])
    inj = [k for k in c if k in INJ and c[k] >= 80]
    if inj:
        pos.append((ecg, r, INJ[inj[0]], inj)); continue
    if c.get("NORM", 0) >= 100 and not (set(c) & (MI_ANY | STTC | RBBB | LBBB)):
        norm.append((ecg, r, "normal", ["NORM"]))
    elif (set(c) & RBBB) and not (set(c) & (MI_ANY | {"CLBBB"})) and max((c[k] for k in c if k in RBBB), default=0) >= 80:
        rbbb.append((ecg, r, "rbbb", list(set(c) & RBBB)))
    elif (set(c) & LBBB) and not (set(c) & MI_ANY) and c.get("CLBBB", 0) >= 80:
        lbbb.append((ecg, r, "lbbb", ["CLBBB"]))

# territory-diverse positives: take inferior/lateral first (rare) then fill with anterior
pos.sort(key=lambda x: (x[2] in ("anteroseptal", "anterolateral"), x[0]))
sel = {"stemi": pos[:22], "normal": norm[:20], "rbbb": rbbb[:8], "lbbb": lbbb[:6]}
print("candidates:", {k: len(v) for k, v in [("stemi", pos), ("normal", norm), ("rbbb", rbbb), ("lbbb", lbbb)]})

out = []
for grp, items in sel.items():
    for ecg, r, terr, scp in items:
        rec = f"{ecg:05d}_hr"
        try:
            sig, f = wfdb.rdsamp(rec, pn_dir=f"ptb-xl/{folder(ecg)}")     # [5000,12] mV
            x = sig.T.astype("float64")
            if x.shape[1] < 5000: x = np.pad(x, ((0, 0), (0, 5000 - x.shape[1])))
            out.append({"record": rec, "group": grp, "territory": terr, "scp": scp,
                        "fs": int(f["fs"]), "signal": np.round(x[:, :5000], 4).tolist()})
        except Exception as e:
            print("  skip", rec, repr(e)[:60])
    print(f"{grp}: fetched {sum(1 for o in out if o['group']==grp)}")
json.dump(out, open(os.path.join(D, "stemi_valset.json"), "w"))
byterr = {}
for o in out:
    if o["group"] == "stemi": byterr[o["territory"]] = byterr.get(o["territory"], 0) + 1
print("STEMI territories:", byterr)
print("wrote stemi_valset.json:", len(out), "records")
