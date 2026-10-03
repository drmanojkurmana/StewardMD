import needle, json, time
def T(n,d,p,r=()): return {"name":n,"description":d,"parameters":{"type":"object","properties":p,"required":list(r)}}
TOOLS=[
 T("log_drug","Log a resuscitation drug that was just given",{"drug":{"type":"string","enum":["adrenaline","amiodarone","atropine","adenosine","calcium","bicarbonate","magnesium","naloxone"]},"dose_mg":{"type":"number"}},["drug"]),
 T("log_shock","Log a defibrillation shock that was delivered",{"energy_joules":{"type":"integer"}}),
 T("log_rhythm","Log the cardiac rhythm seen at a rhythm check",{"rhythm":{"type":"string","enum":["VF","pulseless VT","PEA","asystole","sinus","AF"]}},["rhythm"]),
 T("log_rosc","Log return of spontaneous circulation",{}),
]
a=needle.Needle(tools=TOOLS, system="device: phone; user: clinician", stateless=True)
C=[("adrenaline 1 mg given","log_drug"),("epi one milligram in","log_drug"),("gave 300 of amiodarone","log_drug"),("shocked at 200 joules","log_shock"),("shock delivered","log_shock"),
("rhythm check, VF","log_rhythm"),("it's asystole","log_rhythm"),("we have ROSC","log_rosc"),("pulse is back","log_rosc"),("continue compressions",None),("do not shock",None),("prepare adrenaline",None)]
ok=0
for q,e in C:
    t=time.time(); r=a.complete(q); dt=(time.time()-t)*1000
    c=r.get("function_calls") or []; s=r.get("suppressed_calls") or []
    got=c[0]["name"] if c else None; hit=(got==e); ok+=hit
    print(("OK " if hit else "XX ")+f"{dt:5.0f}ms c={r.get('confidence')} {q!r} -> {json.dumps(c)} sup={json.dumps(s)[:120]}")
print(ok,"/",len(C))
