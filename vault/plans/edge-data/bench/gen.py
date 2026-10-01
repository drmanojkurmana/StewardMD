import json, random
from tools import TOOLS
R = random.Random(7); by = {t["name"]: t for t in TOOLS}
G1 = ["calc_creatinine_clearance","calc_egfr","calc_curb65","calc_gcs","calc_anion_gap"]
G2 = ["add_prescription_line","record_vitals","schedule_followup","next_patient","icd10_search"]
G3 = ["check_drug_interactions","recommend_empiric_antibiotic","antibiogram_lookup","drug_dose_lookup","ask_maik"]
c = R.choice
def sex(): return c([("male","man"),("male","M"),("female","woman"),("female","F"),("male","gentleman"),("female","lady")])
def num(a,b,d=0): v=round(R.uniform(a,b),d); return int(v) if d==0 else v
def ex(g): 
    n = c(g)
    return n, GEN[n]()
def crcl():
    a=num(20,90); w=num(40,110); cr=num(0.5,4.5,1); s,sw=sex()
    q=c([f"crcl {a}yo {sw} {w}kg cr {cr}", f"creatinine clearance for {a} year old {sw}, weight {w} kg, creat {cr}",
         f"CG clearance: age {a}, {sw}, {w} kg, S.Cr {cr} mg/dl", f"calculate crcl {sw} {a} y {w} kg scr {cr}",
         f"cockcroft gault {a} {sw} wt {w} creatinine {cr}"])
    return q, {"age_years":a,"weight_kg":w,"serum_creatinine_mg_dl":cr,"sex":s}
def egfr():
    a=num(20,90); cr=num(0.5,5,1); s,sw=sex()
    q=c([f"egfr {a} {sw} creat {cr}", f"what is the eGFR, {a} year old {sw}, creatinine {cr}", f"CKD-EPI for {sw} aged {a} with S.Cr {cr}", f"kidney function {a}y {sw} cr {cr}"])
    return q, {"age_years":a,"serum_creatinine_mg_dl":cr,"sex":s}
def curb():
    a=num(40,95); rr=num(14,40); sb=num(70,150); db=num(40,95); u=num(3,20,1); conf=R.random()<.5
    q=c([f"CURB-65 {a} y, {'confused' if conf else 'oriented'}, RR {rr}, BP {sb}/{db}, urea {u}", f"curb65 age {a} urea {u} rr {rr} bp {sb}/{db} {'with confusion' if conf else 'no confusion'}",
         f"pneumonia severity: {a} year old, {'disoriented' if conf else 'alert'}, resp rate {rr}, BP {sb}/{db}, urea {u}"])
    return q, {"age_years":a,"confusion":conf,"respiratory_rate":rr,"systolic_bp":sb,"diastolic_bp":db,"urea_mmol_l":u}
def gcs():
    e=num(1,4); v=num(1,5); m=num(1,6)
    q=c([f"GCS E{e} V{v} M{m}", f"gcs e{e}v{v}m{m}", f"glasgow coma scale eye {e} verbal {v} motor {m}", f"coma score: eyes {e}, verbal {v}, motor {m}"])
    return q, {"eye":e,"verbal":v,"motor":m}
def ag():
    na=num(120,150); cl=num(85,115); h=num(5,30)
    q=c([f"anion gap na {na} cl {cl} hco3 {h}", f"AG: sodium {na}, chloride {cl}, bicarb {h}", f"calculate anion gap Na {na} Cl {cl} HCO3 {h}", f"gap? Na+ {na}, Cl- {cl}, bicarbonate {h}"])
    return q, {"sodium":na,"chloride":cl,"bicarbonate":h}
DR=[("augmentin","625","tablet"),("pan","40","tablet"),("dolo","650","tablet"),("azithral","500","tablet"),("metformin","500","tablet"),("ceftriaxone","1 g","injection"),("amlodipine","5","tablet"),("montair lc","","tablet"),("cefixime","200","tablet"),("ondansetron","4","tablet"),("salbutamol","100 mcg","inhaler"),("ascoril","","syrup")]
FQ=[("OD",["od","once daily","once a day","1-0-0"]),("BD",["bd","twice daily","1-0-1","twice a day"]),("TDS",["tds","thrice daily","1-1-1","three times a day"]),("HS",["hs","at bedtime","0-0-1"]),("SOS",["sos","as needed","prn"])]
def rx():
    d,st,f=c(DR); fr,fw=c(FQ); dur=num(3,30); fw=c(fw)
    pre={"tablet":c(["tab","tab.","","t."]),"injection":c(["inj","inj."]),"inhaler":"","syrup":c(["syp","syrup"])}[f]
    instr=c(["","after food","before breakfast","before food",""]); 
    q=c([f"{pre} {d} {st} {fw} for {dur} days {instr}", f"add {d} {st} {fw} x {dur} days {instr}", f"rx {pre} {d} {st} {fw} {dur} days", f"start {d} {st} {fw} {instr} for {dur} days"])
    a={"drug":d,"frequency":fr,"duration_days":dur}
    if st: a["strength"]=st
    if pre or f!="tablet": a["form"]=f
    if instr: a["instructions"]=instr
    return " ".join(q.split()), a
def vit():
    parts=[];a={}
    if R.random()<.8: s=num(90,190);d=num(50,110);parts.append(c([f"BP {s}/{d}",f"bp {s}/{d} mmHg"]));a["systolic_bp"]=s;a["diastolic_bp"]=d
    if R.random()<.8: h=num(50,140);parts.append(c([f"pulse {h}",f"HR {h}",f"PR {h}/min"]));a["heart_rate"]=h
    if R.random()<.6: o=num(80,100);parts.append(c([f"spo2 {o}",f"sats {o}%",f"SpO2 {o} on RA"]));a["spo2"]=o
    if R.random()<.5: t=num(97,104,1);parts.append(c([f"temp {t}",f"T {t}F"]));a["temperature_f"]=t
    if R.random()<.4: r=num(12,36);parts.append(c([f"RR {r}",f"resp rate {r}"]));a["respiratory_rate"]=r
    if not a: return vit()
    R.shuffle(parts); pre=c(["","vitals: ","bukhar 2 din se, ","c/o cough, ","o/e "])
    return pre+", ".join(parts), a
def fu():
    n=num(2,30); r=c(["","with CBC","with reports","for BP check","with LFT"])
    q=c([f"review after {n} days {r}", f"follow up in {n} days {r}", f"come back after {n} days {r}", f"f/u {n} days {r}"])
    a={"in_days":n}; 
    if r: a["reason"]=r.replace("with ","").replace("for ","")
    return q.strip(), a
def nxt(): return c(["next patient","call next","next please","send the next one in","next token"]), {}
DX=["type 2 diabetes","essential hypertension","community acquired pneumonia","acute gastroenteritis","urinary tract infection","dengue fever","migraine","hypothyroidism"]
def icd():
    d=c(DX); return c([f"icd code for {d}",f"icd10 {d}",f"code {d}",f"what's the ICD for {d}"]), {"diagnosis":d}
DRUGS=["warfarin","clarithromycin","amiodarone","digoxin","simvastatin","fluconazole","linezolid","sertraline","clopidogrel","omeprazole","metformin","spironolactone","enalapril","levofloxacin","ondansetron"]
def ddi():
    ds=R.sample(DRUGS,c([2,2,3]))
    q=c([f"{' with '.join(ds)} safe?", f"interaction {' and '.join(ds)}", f"can I give {' and '.join(ds)} together", f"check ddi {', '.join(ds)}"])
    return q, {"drugs":ds}
SY=[("community_acquired_pneumonia",["CAP","community acquired pneumonia","pneumonia from home"]),("urinary_tract_infection",["UTI","cystitis","urine infection"]),("pyelonephritis",["pyelo","pyelonephritis"]),("cellulitis",["cellulitis","leg cellulitis"]),("meningitis",["meningitis","bacterial meningitis"]),("febrile_neutropenia",["febrile neutropenia","FN"]),("hospital_acquired_pneumonia",["HAP","hospital acquired pneumonia"])]
def abx():
    s,sw=c(SY); sw=c(sw); a={"syndrome":s}; ex=[]
    if R.random()<.5: st=c(["opd","ward","icu"]); a["setting"]=st; ex.append(c([f"in {st}",f"{st} patient"]))
    if R.random()<.3: a["penicillin_allergy"]=True; ex.append(c(["pen allergic","penicillin allergy"]))
    if R.random()<.3: a["mdr_risk"]=True; ex.append(c(["MDR risk","recent hospitalisation, MDR risk"]))
    q=c([f"empiric abx for {sw} {' '.join(ex)}", f"what antibiotic for {sw} {' '.join(ex)}", f"what covers {sw} {' '.join(ex)}", f"start empirical therapy {sw} {' '.join(ex)}"])
    return " ".join(q.split()), a
ORG=["klebsiella","e coli","pseudomonas","acinetobacter","MRSA","enterococcus"]
def abg():
    o=c(ORG); sp=c([("urine","urine"),("blood","blood"),("sputum","sputum"),(None,"")]); a={"organism":o}
    if sp[0]: a["specimen"]=sp[0]
    q=c([f"{o} in {sp[1]} sensitive to what" if sp[1] else f"{o} sensitivity", f"antibiogram {o} {sp[1]}", f"local susceptibility of {o} {sp[1]}"])
    return " ".join(q.split()), a
def dose():
    d=c(["vancomycin","paracetamol","meropenem","gentamicin","ceftriaxone","amoxicillin","piperacillin tazobactam","enoxaparin"]); a={"drug":d}; ex=[]
    if R.random()<.5: w=num(8,100); a["weight_kg"]=w; ex.append(f"{w} kg")
    if R.random()<.4: cc=num(10,90); a["crcl_ml_min"]=cc; ex.append(f"crcl {cc}")
    q=c([f"dose of {d} {' '.join(ex)}", f"{d} dose {' '.join(ex)}", f"how much {d} for {' '.join(ex) or 'adult'}"])
    return " ".join(q.split()), a
QS=["what is the differential for {}","why does this patient have {}","explain the pathophysiology of {}","how do I approach {}","what are the causes of {}"]
PR=["pancytopenia with splenomegaly","fever with rash and low platelets","refractory hypokalemia","recurrent syncope in a young woman","hemoptysis with weight loss","unexplained hypercalcemia"]
def maik():
    q=c(QS).format(c(PR)); return q, {"question":q}
GEN={"calc_creatinine_clearance":crcl,"calc_egfr":egfr,"calc_curb65":curb,"calc_gcs":gcs,"calc_anion_gap":ag,"add_prescription_line":rx,"record_vitals":vit,"schedule_followup":fu,"next_patient":nxt,"icd10_search":icd,"check_drug_interactions":ddi,"recommend_empiric_antibiotic":abx,"antibiogram_lookup":abg,"drug_dose_lookup":dose,"ask_maik":maik}
OFF=["book a cab","what's the cricket score","play some music","patient denies fever","no cough, no breathlessness","do not start metformin","hold the augmentin","tell me a joke","set an alarm for 6","remind me to call home"]
out=[]
for i in range(900):
    g=c([G1,G2,G3])
    if R.random()<.1: q=c(OFF); ans=[]
    else:
        n,(q,a)=ex(g); ans=[{"name":n,"arguments":a}]
    out.append({"query":q,"tools":[by[x] for x in g],"answers":ans})
with open("train.jsonl","w") as f:
    for o in out: f.write(json.dumps(o)+"\n")
print(len(out)); print("\n".join(json.dumps(o["query"])+" -> "+json.dumps(o["answers"]) for o in out[:8]))
