import needle, time
from tools import TOOLS
by={t["name"]:t for t in TOOLS}
for names in (["next_patient"], ["add_prescription_line","record_vitals","schedule_followup","next_patient","icd10_search"], [t["name"] for t in TOOLS]):
    t0=time.time(); a=needle.Needle(tools=[by[n] for n in names], stateless=True); init=time.time()-t0
    for q in ["next patient please","BP 150/90 pulse 102 spo2 93 temp 101.2"]:
        t=time.time(); r=a.complete(q); dt=time.time()-t
        print(len(names),"tools init %.2fs"%init, "%4.0fms"%(dt*1000), "prefill_tps",r.get("prefill_tps"),"decode_tps",r.get("decode_tps"),"ram",r.get("peak_ram_mb"))
    a.close()
