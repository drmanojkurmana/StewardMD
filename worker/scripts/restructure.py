#!/usr/bin/env python3
"""
Re-derive structured fields from the CACHED raw labels (no re-fetch). Improves
cleaning (strip leaked section headings), meal-timing detection, and pulls
therapeutic_class from StewardMD's own drug data. Emits a LEAN D1 SQL that
EXCLUDES the big raw_label (raw stays preserved locally in structured.sqlite);
adds source_url for verification. Faithful — only reorganizes official text.
"""
import json, os, re, sqlite3
HERE=os.path.dirname(os.path.abspath(__file__)); WORKER=os.path.dirname(HERE)
ST=os.path.join(WORKER,"data","structured.sqlite")
DRUGS=os.path.join(WORKER,"data","stewardmd-drugs.sqlite")
OUTSQL=os.path.join(WORKER,"data","import","structured.sql")

HEAD=re.compile(r"^(INDICATIONS AND USAGE|DOSAGE AND ADMINISTRATION|DOSAGE FORMS AND STRENGTHS|"
 r"CONTRAINDICATIONS|WARNINGS AND PRECAUTIONS|ADVERSE REACTIONS|DRUG INTERACTIONS|"
 r"USE IN SPECIFIC POPULATIONS|OVERDOSAGE|PATIENT COUNSELING INFORMATION|CLINICAL PHARMACOLOGY|"
 r"Mechanism of Action|Pharmacokinetics|Pregnancy Risk Summary|Risk Summary)\s+", re.I)
def strip_head(t):
    t=(t or "").strip()
    for _ in range(2):
        t=HEAD.sub("", t).strip()
        t=re.sub(r"^\d+(\.\d+)*\s+","",t).strip()
    return t
def sents(t,n=2):
    if not t: return ""
    return " ".join(re.split(r"(?<=[.;])\s+", t)[:n]).strip()
def grep(t,kw,n=2):
    if not t: return ""
    return " ".join([s for s in re.split(r"(?<=[.;])\s+",t) if kw in s.lower()][:n]).strip()
def meal(d):
    d=(d or "").lower()
    if "with or without food" in d or "without regard" in d or "regardless of food" in d: return "With or without food"
    if "before" in d and ("meal" in d or "food" in d or "breakfast" in d): return "Before food"
    if "with food" in d or "with meals" in d or "after food" in d or "after meal" in d: return "With/after food"
    return ""

def main():
    db=sqlite3.connect(ST)
    cols=[c[1] for c in db.execute("PRAGMA table_info(drug_structured)")]
    # therapeutic class lookup from own data
    dd=sqlite3.connect(DRUGS)
    cls={r[0]:r[1] for r in dd.execute("SELECT composition, class FROM drugs WHERE class<>'' GROUP BY composition")}
    dd.close()
    rows=db.execute("SELECT * FROM drug_structured").fetchall()
    n=0
    for row in rows:
        d=dict(zip(cols,row))
        raw=json.loads(d.get("raw_label") or "{}")
        def R(k): return raw.get(k,"")
        ind=strip_head(R("indications_and_usage")); dose=strip_head(R("dosage_and_administration"))
        usp=strip_head(R("use_in_specific_populations")); pk=strip_head(R("pharmacokinetics"))
        upd={
          "summary": sents(ind,2),
          "therapeutic_class": (cls.get(d["composition"],"") or d.get("therapeutic_class") or "").title(),
          "moa": strip_head(R("mechanism_of_action"))[:1400],
          "adult_dose": dose[:2000], "administration": dose[:1800],
          "ped_dose": strip_head(R("pediatric_use"))[:1200] if R("pediatric_use") else d.get("ped_dose",""),
          "renal_adjust": grep(usp+" "+dose,"renal") or grep(usp,"creatinine"),
          "hepatic_adjust": grep(usp+" "+dose,"hepat"),
          "food_timing": meal(dose),
          "iv_admin": grep(dose,"intravenous") or grep(dose,"infus"), "im_admin": grep(dose,"intramuscular"),
          "dilution_infusion": grep(dose,"dilut") or grep(dose,"reconstitut"),
          "pregnancy": sents(strip_head(R("pregnancy")),3),
          "lactation": grep(usp,"lactation") or sents(strip_head(R("nursing_mothers")),2),
          "contraindications": strip_head(R("contraindications"))[:1400],
          "boxed_warning": strip_head(R("boxed_warning"))[:1400],
          "precautions": strip_head(R("warnings_and_cautions"))[:2200],
          "common_se": strip_head(R("adverse_reactions"))[:1800],
          "interactions": strip_head(R("drug_interactions"))[:1800],
          "alcohol": grep(strip_head(R("warnings_and_cautions"))+" "+strip_head(R("information_for_patients")),"alcohol"),
          "monitoring": grep(strip_head(R("warnings_and_cautions")),"monitor"),
          "half_life": grep(pk,"half-life"), "peak": grep(pk,"tmax") or grep(pk,"maximum concentration") or grep(pk,"peak plasma"),
          "overdose": sents(strip_head(R("overdosage")),3),
          "counseling": strip_head(R("information_for_patients"))[:1800],
        }
        sets=", ".join(f"{k}=?" for k in upd)
        db.execute(f"UPDATE drug_structured SET {sets} WHERE composition=?", list(upd.values())+[d["composition"]])
        n+=1
    db.commit()
    # emit LEAN D1 sql (exclude raw_label; add source_url)
    d1cols=[c for c in cols if c!="raw_label"]
    def lit(v):
        if v is None: return "NULL"
        if isinstance(v,int): return str(v)
        return "'"+str(v).replace("'","''")+"'"
    with open(OUTSQL,"w",encoding="utf-8") as f:
        # D1 schema without raw_label
        ddl=open(os.path.join(WORKER,"structured_schema.sql")).read().replace("  raw_label          TEXT,   -- FULL official text/JSON preserved for verification\n","")
        f.write(ddl+"\n")
        for r in db.execute(f"SELECT {','.join(d1cols)} FROM drug_structured"):
            f.write("INSERT OR REPLACE INTO drug_structured ("+",".join(d1cols)+") VALUES ("+",".join(lit(v) for v in r)+");\n")
    sz=os.path.getsize(OUTSQL)//1024
    # check max statement size
    mx=max(len(l) for l in open(OUTSQL,encoding="utf-8"))
    db.close()
    print(f"re-derived {n} rows | lean SQL {sz} KB | max line {mx} bytes ({mx//1024} KB) | raw_label kept local only")

if __name__=="__main__": main()
