# Count lesson and knowledge-library files a registry entry matches (and show samples).  python3 tools/figures/dev/termcheck.py tools/figures/scenes/<name>.reg.json
import json,glob,re,sys,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..','..'))
terms=json.load(open(sys.argv[1]))['terms']
rx=re.compile('(?:^|[^a-z])('+'|'.join(terms)+')(?![a-z])',re.I)
n=0;ex=[]
for f in glob.glob(ROOT+'/prep/lessons/v1/*.json')+glob.glob(ROOT+'/kb/diseases/*.json'):
    try:t=open(f).read()
    except:continue
    m=rx.search(t)
    if m:
        n+=1
        if len(ex)<8: ex.append((f.split('/')[-1],t[max(0,m.start()-50):m.end()+50].replace('\n',' ')))
print(n,'files match');[print(e) for e in ex]
