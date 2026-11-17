"""Forensic-only: extra queries for official-channel forensic shorts."""
import re, json, subprocess, urllib.parse, time, os

HERE = os.path.dirname(os.path.abspath(__file__))
queries = [
    "Zero To Finals forensic medicine",
    "Osmosis forensic medicine explained",
    "forensic medicine short osmosis",
    "Osmosis thanatology",
    "Osmosis asphyxia forensic",
    "forensic medicine NEET PG short",
    "Osmosis forensic medicine Osmosis",
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
                length = c.get('lengthText', {}).get('simpleText', '') if 'lengthText' in c else ''
                if vid and len(vid) == 11 and vid not in seen:
                    seen.add(vid)
                    items.append({'id': vid, 'title': ttl, 'len': length, 'query': q})
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
json.dump(allitems, open(f"{HERE}/search4.json", "w"), indent=1)
print("total uniq", len(uniq))
