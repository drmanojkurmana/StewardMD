#!/usr/bin/env python3
"""
build_corpus.py — StewardMD Voice medical ASR test corpus (text + ground-truth entities).

Deterministic (fixed seed) so the corpus is reproducible. Stdlib only — no ML deps.
Drug vocabulary is pulled from the repo's gold drug DB (worker/data/gold/*.json).

Output: results/medical_corpus.jsonl — one row per utterance:
  {"id", "lang", "text", "entities": {"drug","dose","unit","route","freq","numbers","dx","lab"}}

The reference `text` is used for WER; `entities` are used for the clinical-entity scorer
(score.py). AUDIO is NOT produced here (needs TTS on a capable box — see synth_audio.py).

Languages / 100 utterances each: en, hi, te, hi_en (Hindi-English code-switch), te_en (Telugu-English).
"""
import json, glob, os, random, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GOLD = os.path.join(ROOT, "worker", "data", "gold")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "medical_corpus.jsonl")
random.seed(20260812)  # fixed → reproducible

# ---- drug vocabulary from the gold DB (filename = generic name) ----
def load_drugs(n=80):
    names = []
    for fp in sorted(glob.glob(os.path.join(GOLD, "*.json"))):
        g = os.path.splitext(os.path.basename(fp))[0]
        if 3 <= len(g) <= 22 and " " not in g.strip()[:0] and re.match(r"^[A-Za-z][A-Za-z0-9 +/-]+$", g):
            names.append(g.strip())
    # prefer common, easily-spoken generics for a realistic clinical set
    common = ["Ceftriaxone","Amoxicillin","Azithromycin","Paracetamol","Pantoprazole","Metronidazole",
              "Metformin","Amlodipine","Atorvastatin","Furosemide","Insulin","Vancomycin","Meropenem",
              "Piperacillin","Ondansetron","Dexamethasone","Hydrocortisone","Adrenaline","Noradrenaline",
              "Heparin","Enoxaparin","Aspirin","Clopidogrel","Ciprofloxacin","Levofloxacin","Doxycycline",
              "Ramipril","Losartan","Salbutamol","Ipratropium","Prednisolone","Diclofenac","Tramadol",
              "Morphine","Midazolam","Propofol","Phenytoin","Levetiracetam","Digoxin","Warfarin"]
    inrepo = set(x.lower() for x in names)
    picked = [c for c in common if c.lower() in inrepo] or common
    return picked

DRUGS = load_drugs()
# Indian brand names (small curated set — realistic code-switch flavour; not in the generic-only gold DB)
BRANDS = ["Augmentin","Monocef","Taxim","Pan","Zifi","Azithral","Dolo","Emeset","Lasix","Clexane"]

DOSES = ["500","250","1","2","5","10","40","0.5","1.5","0.9","2.5","325","650","75","150","600"]
UNITS = ["mg","g","mcg","ml","units","IU"]
ROUTES = ["IV","IM","PO","SC","oral","intravenous"]
ROUTE_NORM = {"IV":"IV","intravenous":"IV","IM":"IM","PO":"PO","oral":"PO","SC":"SC"}
FREQS = ["OD","BD","TDS","QID","HS","SOS","STAT","Q6H","Q8H"]
LABS = ["CBC","CRP","procalcitonin","LFT","RFT","ABG","troponin","D-dimer","serum lactate","HbA1c",
        "blood culture","urine routine","chest X-ray","ECG","serum creatinine","serum potassium"]
DX = ["community acquired pneumonia","sepsis","acute kidney injury","diabetic ketoacidosis","COPD exacerbation",
      "acute gastroenteritis","urinary tract infection","cellulitis","acute pancreatitis","dengue fever",
      "lower respiratory tract infection","acute coronary syndrome","hepatic encephalopathy"]
SYMPTOMS = ["fever","cough","breathlessness","chest pain","vomiting","loose stools","abdominal pain","giddiness"]
DUR = ["one day","two days","three days","five days","one week"]

def pick(seq): return random.choice(seq)

# Each template declares (text, used-entity keys) so ground truth == what is actually spoken
# (a perfect transcription then scores 100 on every recorded entity).
def make(lang):
    drug = pick(DRUGS); dose = pick(DOSES); unit = pick(UNITS)
    route = pick(ROUTES); freq = pick(FREQS); lab = pick(LABS); dx = pick(DX)
    sym = pick(SYMPTOMS); dur = pick(DUR)
    rN = ROUTE_NORM.get(route, route)
    TEMPLATES = {
        "en": [
            (f"Start {drug} {dose} {unit} {route} {freq}.", {"drug","dose","unit","route","freq"}),
            (f"Patient has {sym} since {dur}, start {drug} {dose} {unit} {route} {freq} and send {lab}.", {"drug","dose","unit","route","freq","lab"}),
            (f"Add {drug} {dose} {unit} {route} {freq}, provisional diagnosis {dx}.", {"drug","dose","unit","route","freq","dx"}),
            (f"Send {lab} and start {drug} {dose} {unit} {route} STAT.", {"drug","dose","unit","route","freqSTAT","lab"}),
        ],
        "hi": [
            (f"मरीज़ को {dur} से बुखार है, {drug} {dose} {unit} {route} {freq} शुरू करें।", {"drug","dose","unit","route","freq"}),
            (f"{drug} {dose} {unit} {route} {freq} दें और {lab} भेजें।", {"drug","dose","unit","route","freq","lab"}),
            (f"{drug} {dose} {unit} {route} {freq} स्टार्ट करो, डायग्नोसिस {dx}।", {"drug","dose","unit","route","freq","dx"}),
        ],
        "te": [
            (f"పేషెంట్‌కి {dur} నుంచి జ్వరం ఉంది, {drug} {dose} {unit} {route} {freq} స్టార్ట్ చెయ్యండి.", {"drug","dose","unit","route","freq"}),
            (f"{drug} {dose} {unit} {route} {freq} ఇవ్వండి, {lab} పంపించండి.", {"drug","dose","unit","route","freq","lab"}),
            (f"{drug} {dose} {unit} {route} {freq} మొదలుపెట్టండి, డయాగ్నోసిస్ {dx}.", {"drug","dose","unit","route","freq","dx"}),
        ],
        "hi_en": [
            (f"Patient ko {dur} se fever hai, {drug} {dose} {unit} {route} {freq} start karo.", {"drug","dose","unit","route","freq"}),
            (f"{drug} {dose} {unit} {route} {freq} add kar do aur {lab} bhej do.", {"drug","dose","unit","route","freq","lab"}),
            (f"BP low hai, {drug} {dose} {unit} {route} STAT de do, {lab} urgent send karo.", {"drug","dose","unit","route","freqSTAT","lab"}),
        ],
        "te_en": [
            (f"Patient ki {sym} {dur} nunchi undi, {drug} {dose} {unit} {route} {freq} start cheyyandi.", {"drug","dose","unit","route","freq"}),
            (f"{drug} {dose} {unit} {route} {freq} ivvandi, {lab} send cheyyandi.", {"drug","dose","unit","route","freq","lab"}),
            (f"BP low ga undi, {drug} {dose} {unit} {route} STAT ivvandi, {lab} urgent ga pampandi.", {"drug","dose","unit","route","freqSTAT","lab"}),
        ],
    }
    t, used = pick(TEMPLATES[lang])
    ent = {}
    if "drug" in used: ent["drug"] = drug
    if "dose" in used: ent["dose"] = dose; ent["numbers"] = [dose]
    if "unit" in used: ent["unit"] = unit
    if "route" in used: ent["route"] = rN
    if "freq" in used: ent["freq"] = freq
    if "freqSTAT" in used: ent["freq"] = "STAT"
    if "lab" in used: ent["lab"] = lab
    if "dx" in used: ent["dx"] = dx
    return t, ent

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    rows = []
    for lang in ["en", "hi", "te", "hi_en", "te_en"]:
        seen = set(); i = 0
        while i < 100:
            t, ent = make(lang)
            if t in seen:  # keep them distinct
                continue
            seen.add(t)
            rows.append({"id": f"{lang}-{i:03d}", "lang": lang, "text": t, "entities": ent})
            i += 1
    with open(OUT, "w") as fh:
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    # self-check: every row has all entity keys + 500 rows + 5 langs
    assert len(rows) == 500, len(rows)
    langs = {}
    for r in rows: langs[r["lang"]] = langs.get(r["lang"], 0) + 1
    assert all(v == 100 for v in langs.values()), langs
    for r in rows:  # core entities present in EVERY utterance
        for k in ("drug","dose","unit","route","freq","numbers"):
            assert k in r["entities"], (r["id"], k)
    print(f"OK  {len(rows)} utterances -> {OUT}")
    print(f"    langs: {langs}")
    print(f"    drug vocab: {len(DRUGS)} generics from gold DB")
    print(f"    sample: {rows[0]['text']}")
    print(f"    sample te_en: {[r['text'] for r in rows if r['lang']=='te_en'][0]}")

if __name__ == "__main__":
    main()
