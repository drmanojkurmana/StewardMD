import needle, math, time
a = needle.Needle(tools=[{"name":"noop","description":"noop","parameters":{"type":"object","properties":{}}}])
def cos(x,y): return sum(i*j for i,j in zip(x,y))/math.sqrt(sum(i*i for i in x)*sum(j*j for j in y))
t=time.time(); v=a.embed("heart attack"); print("dim",len(v),"ms",(time.time()-t)*1000)
pairs=[("heart attack","myocardial infarction"),("heart attack","acute coronary syndrome"),("heart attack","urinary tract infection"),
("kidney function","creatinine clearance"),("kidney function","glasgow coma scale"),
("sugar is high","hyperglycemia"),("sugar is high","hyponatremia"),
("breathlessness","dyspnea"),("breathlessness","constipation"),
("augmentin","amoxicillin clavulanate"),("augmentin","metformin"),
("pan 40","pantoprazole 40 mg"),("pan 40","paracetamol 500 mg"),
("bukhar","fever"),("bukhar","fracture"),
("empiric antibiotic for pneumonia","community acquired pneumonia treatment"),("empiric antibiotic for pneumonia","insulin sliding scale")]
for p,q in pairs: print(f"{cos(a.embed(p),a.embed(q)):.3f}  {p!r} ~ {q!r}")
