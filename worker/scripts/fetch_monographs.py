#!/usr/bin/env python3
"""
StewardMD — clinical monograph fetcher (open data: openFDA / DailyMed labels).
LOCAL ONLY. Builds data/monographs.sqlite + data/import/monographs.sql for D1.

openFDA labels are U.S. FDA prescribing information (public domain). We map each
Indian composition -> its US generic name (INN/British -> USAN spelling), fetch
the structured label, and keep the clinically useful sections. US-label-based —
the UI must show a "US FDA label" disclaimer (dosing not India-specific).

Usage:
  python3 fetch_monographs.py [--key OPENFDA_KEY] [--all]
  (no --all = POC set below; with key + --all = full single-ingredient run)
Limits: 240 req/min (we throttle), 1000/day no-key, 120k/day with key.
"""
import json, os, re, sqlite3, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)); WORKER = os.path.dirname(HERE)
SRC = os.path.join(WORKER, "data", "stewardmd-drugs.sqlite")
OUT_DB = os.path.join(WORKER, "data", "monographs.sqlite")
OUT_SQL = os.path.join(WORKER, "data", "import", "monographs.sql")
KEY = None
if "--key" in sys.argv: KEY = sys.argv[sys.argv.index("--key") + 1]
ALL = "--all" in sys.argv

# Indian/INN -> US (openFDA generic_name). Only the ones that differ.
SYN = {
    "paracetamol": "acetaminophen", "amoxycillin": "amoxicillin",
    "frusemide": "furosemide", "salbutamol": "albuterol",
    "adrenaline": "epinephrine", "noradrenaline": "norepinephrine",
    "rifampicin": "rifampin", "lignocaine": "lidocaine",
    "glyceryl trinitrate": "nitroglycerin", "cefpodoxime proxetil": "cefpodoxime proxetil",
}
# POC set (top single-ingredient generics by brand count)
POC = ["Cefixime","Azithromycin","Cefpodoxime Proxetil","Ofloxacin","Ceftriaxone","Cefuroxime",
       "Pantoprazole","Itraconazole","Ondansetron","Rabeprazole","Deflazacort","Levofloxacin",
       "Levocetirizine","Paracetamol","Amikacin","Atorvastatin","Amoxycillin","Diclofenac",
       "Telmisartan","Rosuvastatin","Fluconazole","Ciprofloxacin","Methylprednisolone",
       "Etoricoxib","Omeprazole","Meropenem","Luliconazole","Albendazole","Glimepiride","Nimesulide"]

SECTIONS = {  # our column -> openFDA field(s), first non-empty wins
    "indication": ["indications_and_usage"],
    "dosage": ["dosage_and_administration"],
    "pregnancy": ["pregnancy", "pregnancy_or_breast_feeding"],
    "specific_pop": ["use_in_specific_populations"],
    "adverse": ["adverse_reactions"],
    "interactions": ["drug_interactions"],
    "warnings": ["warnings_and_cautions", "warnings"],
    "forms": ["dosage_forms_and_strengths"],
}
CAP = 1800

def clean(v):
    t = " ".join(v) if isinstance(v, list) else str(v or "")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"^\d+(\.\d+)*\s+", "", t)  # strip leading "6 ADVERSE REACTIONS"
    return (t[:CAP].rsplit(" ", 1)[0] + " …") if len(t) > CAP else t

def query_name(comp):
    c = comp.lower().strip()
    return SYN.get(c, c)

def fetch(qname):
    base = "https://api.fda.gov/drug/label.json"
    for field in ("openfda.generic_name", "openfda.substance_name"):
        params = {"search": f'{field}:"{qname}"', "limit": "1"}
        if KEY: params["api_key"] = KEY
        url = base + "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                data = json.load(r)
            if data.get("results"):
                return data["results"][0]
        except Exception:
            pass
    return None

def extract(r):
    out = {}
    for col, keys in SECTIONS.items():
        val = ""
        for k in keys:
            if r.get(k): val = clean(r[k]); break
        out[col] = val
    of = r.get("openfda", {})
    out["source_id"] = (of.get("spl_set_id") or [""])[0] if isinstance(of.get("spl_set_id"), list) else ""
    return out

def main():
    db = sqlite3.connect(SRC)
    comps = ([r[0] for r in db.execute("SELECT composition FROM drugs WHERE composition NOT LIKE '%+%' AND composition<>'' GROUP BY composition").fetchall()]
             if ALL else POC)
    db.close()
    os.makedirs(os.path.dirname(OUT_SQL), exist_ok=True)
    if os.path.exists(OUT_DB): os.remove(OUT_DB)
    m = sqlite3.connect(OUT_DB)
    cols = ["composition","generic_query","indication","dosage","pregnancy","specific_pop",
            "adverse","interactions","warnings","forms","source","source_id","fetched_at"]
    m.execute("CREATE TABLE monographs (" + ",".join(c + (" TEXT PRIMARY KEY" if c == "composition" else " TEXT") for c in cols) + ")")
    hit = miss = 0; missed = []
    stamp = time.strftime("%Y-%m-%d")
    for i, comp in enumerate(comps):
        qn = query_name(comp)
        r = fetch(qn)
        if not r:
            miss += 1; missed.append(comp);
        else:
            d = extract(r)
            if not (d["indication"] or d["dosage"]):
                miss += 1; missed.append(comp)
            else:
                hit += 1
                row = [comp, qn, d["indication"], d["dosage"], d["pregnancy"], d["specific_pop"],
                       d["adverse"], d["interactions"], d["warnings"], d["forms"],
                       "U.S. FDA label via openFDA", d["source_id"], stamp]
                m.execute("INSERT OR REPLACE INTO monographs VALUES (" + ",".join("?"*len(cols)) + ")", row)
        time.sleep(0.30)  # ~3/sec, well under 240/min
        if (i + 1) % 10 == 0: print(f"  …{i+1}/{len(comps)}")
    m.commit()

    # emit D1 SQL (schema + INSERT OR REPLACE, ≤40KB statements)
    def lit(v): return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"
    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("CREATE TABLE IF NOT EXISTS monographs (" + ",".join(c + (" TEXT PRIMARY KEY" if c=="composition" else " TEXT") for c in cols) + ");\n")
        for row in m.execute(f"SELECT {','.join(cols)} FROM monographs"):
            f.write(f"INSERT OR REPLACE INTO monographs ({','.join(cols)}) VALUES (" + ",".join(lit(v) for v in row) + ");\n")
    n = m.execute("SELECT count(*) FROM monographs").fetchone()[0]
    m.close()
    print(f"\nmonographs fetched: {hit}  | missed (no US label): {miss}")
    print("missed:", ", ".join(missed) if missed else "none")
    print(f"rows in monographs.sqlite: {n}")
    print(f"SQL: {OUT_SQL} ({os.path.getsize(OUT_SQL)/1024:.0f} KB)")

if __name__ == "__main__":
    main()
