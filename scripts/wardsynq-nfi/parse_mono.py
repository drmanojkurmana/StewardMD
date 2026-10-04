import json,re,sys
t=json.load(open('draft-pages.json'))
# lines with page numbers
lines=[]
EMB=re.compile(r'(?<=[.;])\s*(?=(?:Indications|Dosage\s*forms?|Dose|Contra\s*-?\s*indications|Precautions|Adverse\s*[Ee]ffects|Storage)\s*[;:—–])')
for i,p in enumerate(t):
    if i+1 >= 726: break  # Appendix 1 starts on PDF page 726
    for ln in p.split('\n'):
        # a field label inside a line, after a full stop or semicolon, starts a new field
        for part in EMB.split(ln.rstrip()):
            lines.append((i+1, part))
FIELD=re.compile(r'^\s*(Indications|Dosage\s*forms?\s*(?:\(s\))?|Dose|Contra\s*-?\s*indications|Precautions|Pecautions|Adverse\s*[Ee]ffects|Storage|Availability|Schedule)\s*[;:—–-]?\s*(.*)$')
mons=[]; cur=None
def is_heading(idx):
    # heading if next non-empty line is Schedule or Indications
    j=idx+1
    while j < len(lines) and not lines[j][1].strip(): j+=1
    if j>=len(lines): return False
    nxt=lines[j][1].strip()
    return bool(re.match(r'^(Schedule|Indications)',nxt))
for idx,(pg,ln) in enumerate(lines):
    s=ln.strip()
    if not s: continue
    if not FIELD.match(s) and len(s)<90 and is_heading(idx) and not s.endswith('.') :
        cur={'name':s,'page':pg,'fields':{},'field':None}; mons.append(cur); continue
    if cur is None: continue
    m=FIELD.match(s)
    if m:
        key=re.sub(r'\s+','',m.group(1)).lower()
        key={'contra-indications':'contraindications','pecautions':'precautions'}.get(key,key)
        if key.startswith('dosageform'): key='dosageform'
        if key.startswith('adverse'): key='adverseeffects'
        if key.startswith('contra'): key='contraindications'
        cur['field']=key
        if key in cur['fields'] and key!='schedule': cur.setdefault('dupFields',[]).append((key,pg))
        cur['fields'].setdefault(key,{'text':'','page':pg,'endPage':pg})
        cur['fields'][key]['text']+=m.group(2)+' '
        cur['fields'][key]['endPage']=pg
    elif cur['field']:
        cur['fields'][cur['field']]['text']+=s+' '
        cur['fields'][cur['field']]['endPage']=pg
for m in mons:
    for f in m['fields'].values(): f['text']=re.sub(r'\s+',' ',f['text']).strip()
    del m['field']
json.dump(mons,open('monographs.json','w'),indent=1)
print(len(mons))
preg=[m for m in mons if any(re.search(r'(?i)pregnan',f['text']) for k,f in m['fields'].items() if k in('contraindications','precautions','dose'))]
print('with pregnancy in CI/prec/dose:',len(preg))
for m in mons[:15]: print(m['page'], m['name'], list(m['fields']))
