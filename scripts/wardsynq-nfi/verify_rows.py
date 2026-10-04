import json,re
from rows import R,L
d=json.load(open('draft-pages.json')); o=json.load(open('nfi2011-pages.json'))
ns=lambda s: re.sub(r'\s+','',s)
dpages={i+1:ns(x) for i,x in enumerate(d)}
fail=0; out={'renal':[],'lactation':[]}
# renal: contiguous in NFI 2011 (pages 760-762), tokens present on draft pages 874-877
o_txt=ns(''.join(o[759:762]))
for r in R:
    row=ns(''.join(r))
    ok11 = row in o_txt
    # draft: every cell's stripped text must occur on one of pages 874,875,877
    dp=[p for p in (874,875,877) if ns(r[0][:6]) in dpages[p] or ns(r[0].replace(' ','')[:6]) in dpages[p]]
    # draft splits words oddly ("A cetaminophen"), so stripped first 6 chars may be found
    cells_ok = all(any(ns(c) in dpages[p] for p in (874,875,877)) for c in r[1:] if c)
    page = dp[0] if dp else None
    if not ok11 or not cells_ok or not page: fail+=1; print('RENAL FAIL',r[0],ok11,cells_ok,dp)
    out['renal'].append({'drug':r[0],'page':page,'page2011':next((p+1 for p in range(759,762) if ns(r[0][:8]) in ns(o[p])),None)})
# lactation: drug-first-word and comment contiguous on draft pages 861-870 (allowing spill to next page)
for drug,c in L:
    hit=None
    for p in range(861,871):
        blob=dpages[p]+(dpages[p+1] if p<870 else '')
        if ns(c) in blob and ns(drug.split()[0]) in blob:
            # page = where the drug name first appears
            hit=p if ns(drug.split()[0]) in dpages[p] else p+1; break
    if not hit: fail+=1; print('LACT FAIL',drug)
    out['lactation'].append({'drug':drug,'page':hit})
json.dump(out,open('row-pages.json','w'),indent=1)
print('fails',fail, len(R), len(L))
