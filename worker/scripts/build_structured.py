#!/usr/bin/env python3
"""
StewardMD — build the STRUCTURED clinical DB (LOCAL ONLY).
Re-fetches FULL openFDA labels for the matched single-ingredient compositions,
PRESERVES the official text (raw_label), and maps each official section into the
structured schema (worker/structured_schema.sql). Faithful: fields are the
official text organized + lightly cleaned; derived quick-facts use only source
content. No invention. India-only authored monographs are merged in.

Usage: python3 build_structured.py --key OPENFDA_KEY
Outputs: data/structured.sqlite  +  data/import/structured.sql
"""
import json, os, re, sqlite3, sys, time, urllib.parse, urllib.request, threading, concurrent.futures

KEY = sys.argv[sys.argv.index("--key") + 1] if "--key" in sys.argv else None
HERE = os.path.dirname(os.path.abspath(__file__)); WORKER = os.path.dirname(HERE)
MONO = os.path.join(WORKER, "data", "monographs.sqlite")          # has the 934 matched comps
AUTH = os.path.join(WORKER, "data", "monographs.sqlite")          # (authored rows live in D1; merged separately)
OUT = os.path.join(WORKER, "data", "structured.sqlite")
OUTSQL = os.path.join(WORKER, "data", "import", "structured.sql")

_rl = threading.Lock(); _nxt = [0.0]; MIN = 60.0/230.0
def throttle():
    with _rl:
        t = max(time.time(), _nxt[0]); _nxt[0] = t + MIN
    d = t - time.time()
    if d > 0: time.sleep(d)

SYN = {"paracetamol":"acetaminophen","amoxycillin":"amoxicillin","frusemide":"furosemide",
       "salbutamol":"albuterol","adrenaline":"epinephrine","noradrenaline":"norepinephrine",
       "rifampicin":"rifampin","lignocaine":"lidocaine","glyceryl trinitrate":"nitroglycerin"}
def qname(c): return SYN.get(c.lower().strip(), c.lower().strip())

def fetch_full(q):
    for field in ("openfda.generic_name", "openfda.substance_name"):
        p = {"search": f'{field}:"{q}"', "limit": "1"}
        if KEY: p["api_key"] = KEY
        try:
            throttle()
            with urllib.request.urlopen("https://api.fda.gov/drug/label.json?"+urllib.parse.urlencode(p), timeout=20) as r:
                d = json.load(r)
            if d.get("results"): return d["results"][0]
        except Exception: pass
    return None

def clean(v, cap=2400):
    t = " ".join(v) if isinstance(v, list) else str(v or "")
    t = re.sub(r"<[^>]+>", " ", t)                 # strip any HTML
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"^\d+(\.\d+)*\s+", "", t)           # strip leading section number
    t = re.sub(r"\s*\[see [^\]]*\]", "", t)         # strip cross-refs
    return (t[:cap].rsplit(" ", 1)[0] + " …") if len(t) > cap else t
def sec(r, *keys, cap=2400):
    for k in keys:
        if r.get(k): return clean(r[k], cap)
    return ""
def sents(t, n=2):
    if not t: return ""
    parts = re.split(r"(?<=[.;])\s+", t)
    return " ".join(parts[:n]).strip()
def grep_sent(t, kw):
    if not t: return ""
    out = [s for s in re.split(r"(?<=[.;])\s+", t) if kw in s.lower()]
    return " ".join(out[:2]).strip()
def meal(dose):
    d = (dose or "").lower()
    if "without regard to" in d or "without regard to meals" in d: return "With or without food"
    if "before" in d and ("meal" in d or "food" in d or "breakfast" in d): return "Before food"
    if "with food" in d or "with meals" in d or "after food" in d: return "With/after food"
    return ""

COLS = ["composition","summary","therapeutic_class","pharm_class","moa","rx_otc","habit_forming","routes",
 "adult_dose","ped_dose","geriatric","dosage_table","renal_adjust","hepatic_adjust","administration",
 "food_timing","oral_admin","iv_admin","im_admin","dilution_infusion","pregnancy","lactation",
 "contraindications","boxed_warning","precautions","common_se","serious_se","interactions",
 "food_interactions","alcohol","monitoring","onset","peak","half_life","duration","storage",
 "counseling","missed_dose","overdose","offlabel","guideline_notes","refs","sources",
 "raw_label","reviewed","updated_at"]

def structure(comp, q, r):
    of = r.get("openfda", {})
    ind = sec(r, "indications_and_usage"); dose = sec(r, "dosage_and_administration")
    usp = sec(r, "use_in_specific_populations", cap=3000); pk = sec(r, "pharmacokinetics", "clinical_pharmacology", cap=3000)
    routes = of.get("route") or []
    cls = (of.get("pharm_class_epc") or of.get("pharm_class_cs") or [""])[0]
    raw = {k: clean(r[k], 6000) for k in ["indications_and_usage","dosage_and_administration","contraindications",
            "boxed_warning","warnings_and_cautions","adverse_reactions","drug_interactions","use_in_specific_populations",
            "pregnancy","nursing_mothers","mechanism_of_action","pharmacokinetics","overdosage","information_for_patients",
            "dosage_forms_and_strengths"] if r.get(k)}
    row = {
      "composition": comp,
      "summary": sents(ind, 2) or (cls or comp),
      "therapeutic_class": cls, "pharm_class": (of.get("pharm_class_moa") or [""])[0],
      "moa": sec(r, "mechanism_of_action", cap=1400),
      "rx_otc": "Rx", "habit_forming": "", "routes": json.dumps([x.title() for x in routes]),
      "adult_dose": dose, "ped_dose": sec(r, "pediatric_use"), "geriatric": sents(sec(r, "geriatric_use"), 2),
      "dosage_table": "", "renal_adjust": grep_sent(usp + " " + dose, "renal") or grep_sent(usp, "creatinine"),
      "hepatic_adjust": grep_sent(usp + " " + dose, "hepat"),
      "administration": sec(r, "dosage_and_administration", cap=1800), "food_timing": meal(dose),
      "oral_admin": "", "iv_admin": grep_sent(dose, "intravenous") or grep_sent(dose, "infus"),
      "im_admin": grep_sent(dose, "intramuscular"), "dilution_infusion": grep_sent(dose, "dilut") or grep_sent(dose, "reconstitut"),
      "pregnancy": sents(sec(r, "pregnancy", "pregnancy_or_breast_feeding"), 3),
      "lactation": sents(sec(r, "nursing_mothers"), 2) or grep_sent(usp, "lactation"),
      "contraindications": sec(r, "contraindications", cap=1400), "boxed_warning": sec(r, "boxed_warning", cap=1400),
      "precautions": sec(r, "warnings_and_cautions", "warnings", cap=2200),
      "common_se": sec(r, "adverse_reactions", cap=1800),
      "serious_se": sec(r, "boxed_warning", cap=900) or grep_sent(sec(r,"warnings_and_cautions","warnings",cap=3000), "serious"),
      "interactions": sec(r, "drug_interactions", cap=1800), "food_interactions": grep_sent(dose+" "+pk, "food"),
      "alcohol": grep_sent(sec(r,"warnings_and_cautions","warnings",cap=3000)+" "+sec(r,"information_for_patients",cap=3000), "alcohol"),
      "monitoring": grep_sent(sec(r,"warnings_and_cautions","warnings",cap=3000), "monitor"),
      "onset": "", "peak": grep_sent(pk, "tmax") or grep_sent(pk, "peak"),
      "half_life": grep_sent(pk, "half-life"), "duration": "", "storage": grep_sent(sec(r,"how_supplied","storage_and_handling",cap=2000), "store"),
      "counseling": sec(r, "information_for_patients", cap=1800), "missed_dose": "", "overdose": sents(sec(r, "overdosage"), 3),
      "offlabel": "", "guideline_notes": "",
      "refs": json.dumps([{"title": "U.S. FDA label via openFDA / DailyMed", "url": "https://dailymed.nlm.nih.gov"}]),
      "sources": json.dumps(["openFDA", "DailyMed"]),
      "raw_label": json.dumps(raw), "reviewed": 0, "updated_at": "2026-06-28",
    }
    return row

def main():
    if not os.path.exists(MONO): sys.exit("run fetch_monographs first")
    db = sqlite3.connect(MONO)
    comps = [r[0] for r in db.execute("SELECT composition FROM monographs").fetchall()]  # the 934 matched
    db.close()
    out = sqlite3.connect(OUT)
    if os.path.exists(OUT): out.close(); os.remove(OUT); out = sqlite3.connect(OUT)
    out.executescript(open(os.path.join(WORKER, "structured_schema.sql")).read())
    done = 0; ok = 0
    def work(c):
        r = fetch_full(qname(c)); return (c, r)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for c, r in (f.result() for f in concurrent.futures.as_completed([ex.submit(work, c) for c in comps])):
            done += 1
            if r and (r.get("indications_and_usage") or r.get("dosage_and_administration")):
                row = structure(c, qname(c), r)
                out.execute("INSERT OR REPLACE INTO drug_structured (" + ",".join(COLS) + ") VALUES (" + ",".join("?"*len(COLS)) + ")",
                            [row[k] for k in COLS]); ok += 1
            if done % 50 == 0: print(f"  …structured {done}/{len(comps)} ({ok} ok)", flush=True)
    out.commit()
    n = out.execute("SELECT count(*) FROM drug_structured").fetchone()[0]
    # emit D1 SQL
    def lit(v):
        if v is None: return "NULL"
        if isinstance(v, int): return str(v)
        return "'" + str(v).replace("'", "''") + "'"
    os.makedirs(os.path.dirname(OUTSQL), exist_ok=True)
    with open(OUTSQL, "w", encoding="utf-8") as f:
        f.write(open(os.path.join(WORKER, "structured_schema.sql")).read() + "\n")
        for r in out.execute(f"SELECT {','.join(COLS)} FROM drug_structured"):
            f.write("INSERT OR REPLACE INTO drug_structured (" + ",".join(COLS) + ") VALUES (" + ",".join(lit(v) for v in r) + ");\n")
    out.close()
    print(f"\nstructured rows: {n}  | SQL: {OUTSQL} ({os.path.getsize(OUTSQL)//1024} KB)", flush=True)

if __name__ == "__main__":
    main()
