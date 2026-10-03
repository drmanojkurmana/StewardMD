import needle, json
N={"type":"number"}
schema={"name":"patient_facts","description":"Clinical values stated about the patient","parameters":{"type":"object","properties":{
 "age_years":N,"sex":{"type":"string","enum":["male","female"]},"weight_kg":N,"height_cm":N,"serum_creatinine_mg_dl":N,"urea_mmol_l":N,
 "systolic_bp":N,"diastolic_bp":N,"heart_rate":N,"respiratory_rate":N,"spo2":N,"temperature_f":N,"glucose_mg_dl":N,"sodium":N,"potassium":N,
 "confusion":{"type":"boolean"},"penicillin_allergy":{"type":"boolean"}}}}
Q=[("crcl for 72 yo female 58 kg creat 1.4",{"age_years":72,"sex":"female","weight_kg":58,"serum_creatinine_mg_dl":1.4}),
("CURB 65: 78 year old, confused, RR 32, BP 88/50, urea 9",{"age_years":78,"confusion":True,"respiratory_rate":32,"systolic_bp":88,"diastolic_bp":50,"urea_mmol_l":9}),
("crcl 60 year old man 70 kg",{"age_years":60,"sex":"male","weight_kg":70}),
("65M, cr 2.1, K 5.9",{"age_years":65,"sex":"male","serum_creatinine_mg_dl":2.1,"potassium":5.9}),
("BP 150/90 pulse 102 spo2 93 temp 101.2",{"systolic_bp":150,"diastolic_bp":90,"heart_rate":102,"spo2":93,"temperature_f":101.2}),
("sugar 342, weight 80",{"glucose_mg_dl":342,"weight_kg":80}),
("pen allergic lady, 34, 52 kg",{"penicillin_allergy":True,"sex":"female","age_years":34,"weight_kg":52}),
("sodium 118 in a 60 kg woman aged 70",{"sodium":118,"weight_kg":60,"sex":"female","age_years":70}),
("no penicillin allergy, not confused",{"penicillin_allergy":False,"confusion":False}),
]
tot=ok=fab=0
for q,gold in Q:
    try: r=needle.extract(q,schema,strict=False) or {}
    except Exception as e: r={"ERR":str(e)}
    good=sum(1 for k,v in gold.items() if k in r and (r[k]==v or (isinstance(v,(int,float)) and not isinstance(v,bool) and isinstance(r[k],(int,float)) and abs(r[k]-v)<1e-6)))
    extra=[k for k in r if k not in gold]
    wrong=[k for k in gold if k in r and k not in extra and not (r[k]==v if False else True)]
    tot+=len(gold); ok+=good; fab+=len(extra)
    print(f"{good}/{len(gold)} extra={extra} | {q!r}\n    {json.dumps(r)}")
print(f"field recall {ok}/{tot}, invented fields {fab}")
