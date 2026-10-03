import needle, math
a = needle.Needle(tools=[{"name":"noop","description":"noop","parameters":{"type":"object","properties":{}}}])
docs=["myocardial infarction","urinary tract infection","creatinine clearance","glasgow coma scale","hyperglycemia","hyponatremia","dyspnea","constipation","amoxicillin clavulanate","metformin","pantoprazole","paracetamol","fever","fracture","community acquired pneumonia","insulin sliding scale","pulmonary embolism","atrial fibrillation stroke risk","sepsis screening","neonatal jaundice phototherapy","chemotherapy dosing by body surface area","drug drug interaction","anion gap","potassium replacement","stroke"]
qs=[("heart attack",0),("burning urination",1),("kidney function for dosing",2),("coma score",3),("sugar is high",4),("low sodium",5),("breathlessness",6),("not passing stool",7),("augmentin",8),("glycomet",9),("pan 40",10),("crocin",11),("pyrexia",12),("broken bone",13),("CAP",14),("correction insulin",15),("PE",16),("chads vasc",17),("qsofa",18),("baby is yellow",19),("FOLFOX dose",20),("can I give these together",21),("AG",22),("K is 2.9",23),("CVA",24)]
import numpy as np
D=np.array([a.embed(d) for d in docs]); Q=np.array([a.embed(q) for q,_ in qs])
mu=np.vstack([D,Q]).mean(0)
def norm(M): M=M-mu; return M/np.linalg.norm(M,axis=1,keepdims=True)
S=norm(Q)@norm(D).T
def tri(s): s=f"  {s.lower()} "; return {s[i:i+3] for i in range(len(s)-2)}
hit=0;hit3=0;th=0
for i,(q,g) in enumerate(qs):
    r=np.argsort(-S[i]); hit+=r[0]==g; hit3+=g in r[:3]
    tr=max(range(len(docs)),key=lambda j:len(tri(q)&tri(docs[j]))/len(tri(q)|tri(docs[j]))); th+=tr==g
    print(f"{'OK' if r[0]==g else 'XX'} {q!r:32} -> {docs[r[0]]!r}")
print("needle top1",hit,"top3",hit3,"of",len(qs),"| char-trigram top1",th)
