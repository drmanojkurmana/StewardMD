"""Build a STEMI validation set from the LOCAL CPSC data (curated challenge labels; cleaner than PTB-XL
injury codes). Held-out folds 9-10 (fair for the CPSC-trained NN too). pure-STE = STEMI+; negatives =
pure-SNR + RBBB(noSTE) + LBBB(noSTE). Saves cpsc_stemi_valset.json (same schema as stemi_valset.json)."""
import os, csv, json, numpy as np, wfdb
D = os.environ["D"]; base = os.path.join(D, "cpsc_data/CPSC")
rows = list(csv.DictReader(open(os.path.join(base, "labels.csv"))))
cls = ["SNR", "AF", "IAVB", "LBBB", "RBBB", "PAC", "PVC", "STD", "STE"]
def pure(r, c): return r[c] == "1" and sum(int(r[x]) for x in cls) == 1
HOLD = {"9", "10"}
ste = [r for r in rows if pure(r, "STE") and r["fold"] in HOLD][:40]
snr = [r for r in rows if pure(r, "SNR") and r["fold"] in HOLD][:30]
rbbb = [r for r in rows if r["RBBB"] == "1" and r["STE"] == "0" and r["fold"] in HOLD][:15]
lbbb = [r for r in rows if r["LBBB"] == "1" and r["STE"] == "0" and r["fold"] in HOLD][:15]
sel = [("stemi", ste), ("normal", snr), ("rbbb", rbbb), ("lbbb", lbbb)]
out = []
for grp, items in sel:
    for r in items:
        pid = r["patient_id"]
        try:
            sig, f = wfdb.rdsamp(os.path.join(base, pid))
            x = sig.T.astype("float64")
            if x.shape[1] < 5000: x = np.pad(x, ((0, 0), (0, 5000 - x.shape[1])))
            out.append({"record": pid, "group": grp, "territory": "unspecified",
                        "fs": int(f["fs"]), "signal": np.round(x[:, :5000], 4).tolist()})
        except Exception as e:
            print("skip", pid, repr(e)[:50])
    print(f"{grp}: {sum(1 for o in out if o['group']==grp)}")
json.dump(out, open(os.path.join(D, "cpsc_stemi_valset.json"), "w"))
print("wrote cpsc_stemi_valset.json:", len(out))
