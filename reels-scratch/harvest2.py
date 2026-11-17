"""Second harvest: official-channel videos for subjects short in the first pass.

Writes reels-scratch/search2.json with {id, title, channel, len, query}.
Reuses the ytInitialData parse approach from the first run's search_harvest.py.
"""
import re, json, subprocess, urllib.parse, time, os

HERE = os.path.dirname(os.path.abspath(__file__))
queries = [
    # forensic
    "Osmosis forensic medicine", "Armando forensic", "Osmosis forensic hypothermia",
    "Osmosis vitreous putrefaction forensic", "Osmosis putrefaction",
    # pathology
    "Osmosis pathology", "Armando pathology", "Osmosis granuloma",
    # dermatology
    "Armando dermatology", "Osmosis psoriasis", "Osmosis eczema",
    # ENT
    "Armando ear anatomy", "Osmosis otitis", "Osmosis sinusitis",
    # orthopaedics
    "Osmosis osteoporosis", "Armando osteoarthritis", "Osmosis fracture",
    # physiology
    "Osmosis physiology", "Armando physiology", "Khan Academy physiology",
    # ophthalmology
    "Osmosis glaucoma", "Osmosis conjunctivitis", "Armando eye",
    # renal
    "Osmosis nephrotic", "Armando kidney", "Osmosis kidney failure",
    # biochemistry
    "Armando biochemistry", "Osmosis protein synthesis", "Ninja Nerd biochemistry",
    # medicine (buffer)
    "Osmosis medicine", "Armando gastroenterology",
]

def fetch(q):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(q)
    out = subprocess.run(["curl", "-sL", "--max-time", "30", "-A", "Mozilla/5.0", url], capture_output=True, text=True)
    html = out.stdout
    m = re.search(r'ytInitialData = (\{.*?\});?</script>', html, re.S)
    if not m:
        print(q, "NO INIT", len(html))
        return []
    try:
        d = json.loads(m.group(1))
    except Exception as e:
        print(q, "JSON ERR", str(e)[:80])
        return []
    items = []
    stack = [d]
    seen = set()
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            if 'videoRenderer' in o:
                c = o['videoRenderer']
                vid = c.get('videoId', '')
                ttl = ''.join(x.get('text', '') for x in c.get('title', {}).get('runs', []))
                owner = ''
                try:
                    owner = ''.join(x.get('text', '') for x in c.get('owner', {}).get('runs', []))
                except Exception:
                    pass
                length = c.get('lengthText', {}).get('simpleText', '') if 'lengthText' in c else ''
                if vid and len(vid) == 11 and vid not in seen:
                    seen.add(vid)
                    items.append({'id': vid, 'title': ttl, 'channel': owner, 'len': length, 'query': q})
            for v in o.values():
                if isinstance(v, (dict, list)):
                    stack.append(v)
        elif isinstance(o, list):
            for v in o:
                stack.append(v)
    print(q, len(items))
    return items

allitems = []
for q in queries:
    allitems.extend(fetch(q))
    time.sleep(1)
uniq = {}
for it in allitems:
    if it['id'] not in uniq:
        uniq[it['id']] = it
json.dump(allitems, open(f"{HERE}/search2.json", "w"), indent=1)
print("total uniq", len(uniq))
