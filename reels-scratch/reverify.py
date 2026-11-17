"""Re-verify selected PrepReels videos via live oEmbed; fetch durations for unknown ones.

- oEmbed must return 200 with title + author_name (official channel check vs selection).
- Watch page scrape for lengthSeconds where durationSec is unknown. Keep <= 360s.
- Writes reels-scratch/verified_final.json and vault/handoff/reels-videos-verified.json
"""
import json, re, urllib.request, urllib.parse, time, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sel = json.load(open(f"{HERE}/selection_pool.json"))

DROP_IDS = {"KNVOQXkX2ak", "UM0jWlDtQLg", "XN2DIdXCnlc", "rFkcDnjNXPk", "FIKW62VO6Pg", "xdarp2VBwNk",
            "4dKtWI0rROA", "5fCQ2ktIFHA", "R9BTEtHqawc", "0SLO_MnouhU", "5Lr6WqMsfZg", "8AStSJA6FkY",
            "zRmrBU5ZtWg", "5CQTgY2fqxM", "0KZwYQPggl8"}
sel = [x for x in sel if x["id"] not in DROP_IDS]
print("candidates after manual drop:", len(sel))

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

def oembed(vid):
    url = "https://www.youtube.com/oembed?url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}") + "&format=json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return getattr(e, "code", None), None

def watch_duration(vid):
    url = f"https://www.youtube.com/watch?v={vid}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            html = r.read().decode("utf-8", "ignore")
        m = re.search(r'"lengthSeconds":"(\d+)"', html)
        return int(m.group(1)) if m else None
    except Exception:
        return None

out = []
for i, x in enumerate(sel):
    st, data = oembed(x["id"])
    time.sleep(0.3)
    if st != 200 or not data or not data.get("title") or not data.get("author_name"):
        print("DROP oembed", x["id"], st, x["title"][:60])
        continue
    d = x["durationSec"]
    if d is None:
        d = watch_duration(x["id"])
        time.sleep(0.2)
        print(f"dur {x['id']} -> {d}")
    if d is None:
        print("DROP nodur", x["id"], x["title"][:60])
        continue
    if d > 360:
        print("DROP long", x["id"], d, x["title"][:60])
        continue
    out.append({"id": x["id"], "title": data["title"], "author_name": data["author_name"],
                "durationSec": d, "harvest_title": x["title"], "harvest_author": x["author"]})

json.dump(out, open(f"{HERE}/verified_final.json", "w"), indent=1)
vout = [{"id": x["id"], "title": x["title"], "author_name": x["author_name"]} for x in out]
os.makedirs(f"{ROOT}/vault/handoff", exist_ok=True)
json.dump(vout, open(f"{ROOT}/vault/handoff/reels-videos-verified.json", "w"), indent=1)
print("verified final:", len(out), "-> vault/handoff/reels-videos-verified.json")
