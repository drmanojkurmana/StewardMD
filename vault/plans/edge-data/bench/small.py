import json, time, sys, needle
from tools import TOOLS
by = {t["name"]: t for t in TOOLS}
def run(names, cases, label):
    import os
    W=os.environ.get("W")
    a = needle.Needle(tools=[by[n] for n in names], system="device: phone; user: clinician", stateless=True, weights=W) if W else needle.Needle(tools=[by[n] for n in names], system="device: phone; user: clinician", stateless=True)
    ok=0
    print("==", label, names)
    for q, exp in cases:
        t=time.time(); r=a.complete(q); dt=(time.time()-t)*1000
        c=r.get("function_calls") or []; s=r.get("suppressed_calls") or []
        got=[x["name"] for x in c]
        hit = (got[:1]==[exp]) if exp else (not c)
        ok+=hit
        print(("OK " if hit else "XX ")+f"{dt:5.0f}ms c={r.get('confidence')} {q!r}\n   {json.dumps(c)} sup={json.dumps(s)[:160]} ungr={(r.get('validation') or {}).get('ungrounded')}")
    print(f"-- {ok}/{len(cases)}\n")
    a.close()

run(["calc_creatinine_clearance","calc_egfr","calc_curb65","calc_gcs","calc_anion_gap"], [
 ("crcl for 72 yo female 58 kg creat 1.4","calc_creatinine_clearance"),
 ("renal function of this man, 65 years, creatinine 2.1","calc_egfr"),
 ("CURB 65: 78 year old, confused, RR 32, BP 88/50, urea 9","calc_curb65"),
 ("GCS E2 V3 M5","calc_gcs"),
 ("anion gap na 138 cl 100 hco3 12","calc_anion_gap"),
 ("crcl 60 year old man 70 kg","calc_creatinine_clearance"),
 ("what's the cricket score",None),
], "calculators(5)")

run(["add_prescription_line","record_vitals","schedule_followup","next_patient","icd10_search"], [
 ("tab augmentin 625 bd for 5 days after food","add_prescription_line"),
 ("add pan 40 od before breakfast 14 days","add_prescription_line"),
 ("inj ceftriaxone 1 gram iv twice daily","add_prescription_line"),
 ("BP 150/90 pulse 102 spo2 93 temp 101.2","record_vitals"),
 ("bukhar 3 din se, BP 110/70, pulse 110","record_vitals"),
 ("review after 1 week with CBC","schedule_followup"),
 ("next patient please","next_patient"),
 ("icd code for type 2 diabetes with nephropathy","icd10_search"),
 ("patient denies fever, no cough",None),
 ("do not add metformin","add_prescription_line_NEG"),
], "opd(5)")

run(["check_drug_interactions","recommend_empiric_antibiotic","antibiogram_lookup","drug_dose_lookup","ask_maik"], [
 ("warfarin with clarithromycin safe?","check_drug_interactions"),
 ("empiric abx for pyelo in ward, pen allergic","recommend_empiric_antibiotic"),
 ("what covers CAP in ICU with MDR risk","recommend_empiric_antibiotic"),
 ("klebsiella in urine sensitive to what","antibiogram_lookup"),
 ("dose of vancomycin for 70 kg with crcl 40","drug_dose_lookup"),
 ("pediatric paracetamol dose 14 kg","drug_dose_lookup"),
 ("what is the differential for fever with thrombocytopenia and rash","ask_maik"),
 ("why does this patient have refractory hyponatremia despite fluid restriction","ask_maik"),
], "stewardship(5)")
