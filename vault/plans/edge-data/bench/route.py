import json, time, sys, needle
sys.path.insert(0, '.')
from tools import TOOLS
SYS = "device: phone; user: clinician; locale: en-IN"
agent = needle.Needle(tools=TOOLS, system=SYS, tool_index_path="tools.idx", stateless=True)
CASES = [
 ("crcl for 72 yo female 58 kg creat 1.4", "calc_creatinine_clearance"),
 ("renal function of this man, 65 years, creatinine 2.1", "calc_egfr"),
 ("CURB 65: 78 year old, confused, RR 32, BP 88/50, urea 9", "calc_curb65"),
 ("GCS E2 V3 M5", "calc_gcs"),
 ("warfarin with clarithromycin safe?", "check_drug_interactions"),
 ("check interactions amiodarone digoxin and furosemide", "check_drug_interactions"),
 ("empiric abx for pyelo in ward, pen allergic", "recommend_empiric_antibiotic"),
 ("what covers CAP in ICU with MDR risk", "recommend_empiric_antibiotic"),
 ("klebsiella in urine sensitive to what", "antibiogram_lookup"),
 ("dose of vancomycin for 70 kg with crcl 40", "drug_dose_lookup"),
 ("pediatric paracetamol dose 14 kg", "drug_dose_lookup"),
 ("sugar 342, sliding scale", "insulin_sliding_scale"),
 ("sodium 118 in a 60 kg woman aged 70, how to correct", "electrolyte_correction"),
 ("icd code for type 2 diabetes with nephropathy", "icd10_search"),
 ("open the antibiogram", "open_module"),
 ("take me to ICU dashboard", "open_module"),
 ("tab augmentin 625 bd for 5 days after food", "add_prescription_line"),
 ("add pan 40 od before breakfast 14 days", "add_prescription_line"),
 ("BP 150/90 pulse 102 spo2 93 temp 101.2", "record_vitals"),
 ("next patient please", "next_patient"),
 ("review after 1 week with CBC", "schedule_followup"),
 ("why does this patient have refractory hyponatremia despite fluid restriction", "ask_maik"),
 ("what is the differential for fever with thrombocytopenia and rash", "ask_maik"),
 ("hospital protocol for snake bite ASV", "search_protocol"),
 ("FOLFOX dose 68 kg 165 cm", "oncology_dose"),
 ("baby 48 hours old 37 weeks bilirubin 16", "neonatal_bilirubin"),
 ("CHADS VASc 76 female hypertension diabetes", "calc_chads_vasc"),
 ("corrected calcium 7.8 albumin 2.4", "calc_corrected_calcium"),
 ("anion gap na 138 cl 100 hco3 12", "calc_anion_gap"),
 ("book me a cab to the airport", None),
 ("what's the cricket score", None),
 ("bukhar 3 din se, BP 110/70, pulse 110", "record_vitals"),
 ("मरीज को 3 दिन से बुखार है, पल्स 110", "record_vitals"),
 ("patient denies fever, no cough", None),
]
ok = 0; lat = []
for q, exp in CASES:
    t = time.time(); r = agent.complete(q); dt = time.time() - t; lat.append(dt)
    calls = r.get("function_calls") or []; sup = r.get("suppressed_calls") or []
    got = calls[0]["name"] if calls else None
    hit = (got == exp)
    ok += hit
    print(("OK " if hit else "XX ") + f"{dt*1000:5.0f}ms conf={r.get('confidence')} | {q!r}\n    -> {json.dumps(calls)} sup={json.dumps(sup)[:200]} ungr={r.get('validation',{}).get('ungrounded')}")
print(f"\n{ok}/{len(CASES)}  median {sorted(lat)[len(lat)//2]*1000:.0f}ms  max {max(lat)*1000:.0f}ms")
