#!/usr/bin/env python3
"""Build a curated multi-label target + train/val/test split from PTB-XL.
Output: labels.csv with columns: ecg_id, filename_hr, fold, split, <CLASS columns 0/1>.
Both the image model and the signal model train against the SAME labels for a fair benchmark.
"""
import os, ast, csv, argparse, urllib.request

# Curated, clinically-meaningful, reasonably-prevalent PTB-XL scp_codes (multi-label).
# FIX (Stage-1): dropped "LAD" — left-axis-deviation is NOT a PTB-XL scp_code (axis is not a diagnostic
# statement in PTB-XL) so it was always all-zero. "STTC" is a PTB-XL *superclass*, not a raw scp_code,
# so exact-match `c in scp` never fired -> now mapped via scp_statements.csv diagnostic_class.
CLASSES = ["NORM","AFIB","STACH","SBRAD","1AVB","CRBBB","IRBBB","CLBBB","LAFB",
           "IMI","AMI","ASMI","LVH","ISC_","STTC","NDT","PVC","PAC"]
# ISC_ = any ischemic (prefix match); STTC = any code whose diagnostic_class == 'STTC'; NDT = nonspec T.

def load_superclass_map(scp_csv):
    """scp_statements.csv: first (unnamed) column is the scp code, plus a 'diagnostic_class' column."""
    m = {}
    try:
        for r in csv.DictReader(open(scp_csv)):
            code = r.get("") or r.get("Unnamed: 0") or r.get("scp_code")
            if code: m[code] = r.get("diagnostic_class", "") or ""
    except FileNotFoundError:
        print(f"WARN: {scp_csv} not found — STTC will be under-labelled. Download PTB-XL scp_statements.csv.")
    return m

def build(ptbxl_csv, out_csv, min_conf=0.0, scp_csv="scp_statements.csv"):
    sc_map = load_superclass_map(scp_csv)                    # raw code -> diagnostic superclass
    rows = list(csv.DictReader(open(ptbxl_csv)))
    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ecg_id","filename_hr","fold","split"] + CLASSES)
        n = 0
        for r in rows:
            scp = ast.literal_eval(r["scp_codes"])           # {code: confidence}
            vec = []
            for c in CLASSES:
                if c == "ISC_":
                    v = 1 if any(k.startswith("ISC") and scp[k] >= min_conf for k in scp) else 0
                elif c == "STTC":
                    v = 1 if any(sc_map.get(k, "") == "STTC" and scp[k] >= min_conf for k in scp) else 0
                else:
                    v = 1 if (c in scp and scp[c] >= min_conf) else 0
                vec.append(v)
            if sum(vec) == 0:            # skip records with no label in our curated set
                continue
            fold = int(r["strat_fold"])
            split = "train" if fold <= 8 else ("val" if fold == 9 else "test")
            w.writerow([r["ecg_id"], r["filename_hr"], fold, split] + vec)
            n += 1
    print(f"wrote {out_csv}: {n} records, {len(CLASSES)} classes")
    print("classes:", CLASSES)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ptbxl_csv", default="ptbxl_database.csv")
    ap.add_argument("--scp_csv", default="scp_statements.csv")
    ap.add_argument("--out", default="labels.csv")
    ap.add_argument("--min_conf", type=float, default=0.0)
    a = ap.parse_args()
    build(a.ptbxl_csv, a.out, a.min_conf, a.scp_csv)
