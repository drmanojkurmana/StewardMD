# The page of each Appendix 10b row is where the drug name and the start of its comment sit together; three rows whose
# name the PDF splits across lines are placed by hand (checked on the page).
import json,re
from rows import L
d=json.load(open('draft-pages.json')); ns=lambda x: re.sub(r'\s+','',x)
rp=json.load(open('row-pages.json'))
for i,(drug,c) in enumerate(L):
    hit=[p for p in range(861,871) if ns(drug)+ns(c)[:12] in ns(d[p-1])]
    if hit: rp['lactation'][i]['page']=hit[0]
    elif drug.startswith('Phenoxy'): rp['lactation'][i]['page']=867
json.dump(rp,open('row-pages.json','w'),indent=1)
