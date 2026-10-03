import needle, json, time
schema={"name":"opd_note","description":"Structured OPD consultation record extracted from the transcript","parameters":{"type":"object","properties":{
 "chief_complaint":{"type":"string"},"duration_days":{"type":"integer"},"systolic_bp":{"type":"number"},"diastolic_bp":{"type":"number"},"heart_rate":{"type":"number"},
 "allergies":{"type":"string"},"provisional_diagnosis":{"type":"string"},"medication":{"type":"string"},"followup_days":{"type":"integer"}},"required":["chief_complaint"]}}
filler=" The patient describes the symptom in detail, mentions that it is worse at night, and says the family is worried. The doctor asks about travel, contacts, diet and sleep, and the patient answers each question at length."
head="Doctor: what brings you in today? Patient: I have had a dry cough for 6 days. Doctor: any allergies? Patient: yes, I am allergic to sulfa drugs. Doctor: your BP is 138/86 and pulse is 92."
tail=" Doctor: this looks like acute bronchitis. I am starting azithromycin 500 mg once daily for 3 days. Come back after 5 days."
for n in [0,3,8,16,30]:
    t=head+filler*n+tail
    tok=len(t.split())
    s=time.time()
    try:
        r=needle.extract(t, schema, strict=False)
    except Exception as e:
        r=f"ERR {e}"
    print(f"words={tok} filler={n} {time.time()-s:.1f}s ->", json.dumps(r))
