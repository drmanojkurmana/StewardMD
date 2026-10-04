# Tags each parsed monograph with its cleaned name and, for topical/ophthalmic/oral-health/antiseptic/dialysis-fluid
# chapters, the chapter (those are not encoded: the engine does not distinguish route). Chapter page ranges are the draft's.
import json,re
mons=json.load(open('monographs.json'))
EXC=[(252,271,'12 Antiseptics and Disinfectants'),(333,350,'15 Dermatological Drugs'),(358,359,'17 Dialysis Fluids'),(410,419,'24 Drugs for Oral Health'),(602,625,'29 Ophthalmological Preparations')]
out=[]
for m in mons:
    name=m['name']
    clean=re.sub(r'\*','',name); clean=re.sub(r'\s*Schedule\s*\S*.*$','',clean).strip()
    clean=re.sub(r'\(Refer.*$','',clean).strip()
    exc=next((e[2] for e in EXC if e[0]<=m['page']<=e[1]),None)
    out.append({'name':name,'clean':clean,'page':m['page'],'excludedChapter':exc,'fields':m['fields']})
json.dump(out,open('mons-clean.json','w'))
