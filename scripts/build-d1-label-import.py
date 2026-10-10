#!/usr/bin/env python3
"""Turn data/fda-labels/*.json into a D1 import for the drug_structured table.

Same table and column list the authored monographs use (worker/scripts/import_gold_to_d1.mjs), so the
server's /structured route serves these drugs exactly like the rest. INSERT OR IGNORE: a drug that already
has an authored row in D1 keeps it; nothing existing is overwritten.

Run:  python3 scripts/build-d1-label-import.py
Out:  worker/data/import/fda_label_structured.sql   (generated; apply only after owner review)
Apply (owner, with wrangler auth):
  npx wrangler d1 execute stewardmd-prod --remote --file worker/data/import/fda_label_structured.sql
"""
import glob, json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "data", "fda-labels")
OUT = os.path.join(ROOT, "worker", "data", "import", "fda_label_structured.sql")

COLS = ["composition", "summary", "therapeutic_class", "pharm_class", "moa", "rx_otc", "habit_forming",
        "routes", "adult_dose", "ped_dose", "geriatric", "dosage_table", "renal_adjust", "hepatic_adjust",
        "administration", "food_timing", "oral_admin", "iv_admin", "im_admin", "dilution_infusion",
        "pregnancy", "lactation", "contraindications", "boxed_warning", "precautions", "common_se",
        "serious_se", "interactions", "food_interactions", "alcohol", "monitoring", "onset", "peak",
        "half_life", "duration", "storage", "counseling", "missed_dose", "overdose", "offlabel",
        "guideline_notes", "refs", "sources", "reviewed", "updated_at", "gold", "raw_label"]

def lit(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

def cut(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[:n].rsplit("\n", 1)[0]

def row(d):
    L = d.get("label", {})
    ind = d.get("indications", [])
    return {
        "composition": d["generic"],
        "summary": cut(" ".join(ind[:2]), 600),
        "therapeutic_class": "",
        "pharm_class": "",
        "moa": cut(L.get("Mechanism of action") or L.get("Clinical pharmacology") or "", 1500),
        "rx_otc": "Rx",
        "habit_forming": "",
        "routes": "[]",
        "adult_dose": cut(L.get("Dosage and administration", ""), 600),
        "ped_dose": cut(L.get("Pediatric use", ""), 1200),
        "geriatric": cut(L.get("Geriatric use", ""), 800),
        "dosage_table": "[]",
        "renal_adjust": cut(L.get("Renal impairment", ""), 1000),
        "hepatic_adjust": cut(L.get("Hepatic impairment", ""), 1000),
        "administration": cut(L.get("Dosage and administration", ""), 4000),
        "food_timing": "",
        "oral_admin": "", "iv_admin": "", "im_admin": "", "dilution_infusion": "",
        "pregnancy": cut(L.get("Pregnancy", ""), 3000),
        "lactation": cut(L.get("Lactation", ""), 1500),
        "contraindications": cut(L.get("Contraindications", ""), 2000),
        "boxed_warning": cut(L.get("Boxed warning", ""), 3000),
        "precautions": cut(L.get("Warnings and precautions", "") or L.get("Warnings", ""), 6000),
        "common_se": cut(L.get("Adverse reactions", ""), 6000),
        "serious_se": "",
        "interactions": cut(L.get("Drug interactions", ""), 4000),
        "food_interactions": "", "alcohol": "", "monitoring": "",
        "onset": "", "peak": "", "half_life": "", "duration": "",
        "storage": cut(L.get("Storage and handling", "") or L.get("How supplied", ""), 1500),
        "counseling": cut(L.get("Patient counseling information", ""), 3000),
        "missed_dose": "",
        "overdose": cut(L.get("Overdosage", ""), 1500),
        "offlabel": "", "guideline_notes": "",
        "refs": json.dumps(d.get("refs", [])),
        "sources": json.dumps(["FDA-approved label (DailyMed)"]),
        "reviewed": "",
        "updated_at": d.get("labelDate", ""),
        "gold": json.dumps(d, ensure_ascii=False),
        "raw_label": json.dumps(L, ensure_ascii=False),
    }

def main():
    lines = ["-- FDA-label monographs for drugs with no authored row (scripts/build-d1-label-import.py).",
             "-- INSERT OR IGNORE: existing authored rows are kept as they are."]
    n = 0
    for f in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        r = row(d)
        vals = ", ".join(lit(r[c]) for c in COLS)
        lines.append("INSERT OR IGNORE INTO drug_structured (" + ", ".join(COLS) + ") VALUES (" + vals + ");")
        n += 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(n, "rows ->", os.path.relpath(OUT, ROOT))

if __name__ == "__main__":
    main()
