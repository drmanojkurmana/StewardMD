"""Merge third-harvest candidates into verified_final.json (oEmbed + duration fallback)."""
import json, re, urllib.request, urllib.parse, time, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
final = json.load(open(f"{HERE}/verified_final.json"))
have = {x["id"] for x in final}
search3 = json.load(open(f"{HERE}/search3.json"))

OFFICIAL = {"Osmosis from Elsevier", "Armando Hasudungan", "Ninja Nerd", "Dr. Najeeb Lectures",
            "khanacademymedicine", "Zero To Finals"}
NONTEACH = ["osmosis ai", "try osmosis", "meet osmosis", "tutor mode", "raise the line", "podcast",
            "behind-the-scenes", "hackathon", "day in the life", "career", "crna", "mentor", "teaser",
            "grand welcome", "stein fireside", "tomorrow's cure", "donor alliance", "brain death",
            "malpractice", "telugu", "american laser", "nursing", "study tips"]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

def plen(t):
    if not t:
        return None
    try:
        p = t.split(":")
        return sum(int(x) * m for x, m in zip(reversed(p), [1, 60, 3600]))
    except Exception:
        return None

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

new = []
seen = set(have)
for it in search3:
    vid = it["id"]
    if vid in seen:
        continue
    d = plen(it.get("len"))
    if d is not None and d > 360:
        continue
    t = (it.get("title") or "").lower()
    if any(n in t for n in NONTEACH):
        continue
    st, data = oembed(vid)
    time.sleep(0.3)
    if st != 200 or not data or not data.get("title") or not data.get("author_name"):
        print("DROP oembed", vid, st, it.get("title", "")[:60])
        continue
    if data["author_name"] not in OFFICIAL:
        print("DROP channel", vid, data["author_name"], data["title"][:60])
        continue
    if d is None:
        d = watch_duration(vid)
        time.sleep(0.2)
    if d is None:
        print("DROP nodur", vid, data["title"][:60])
        continue
    if d > 360:
        print("DROP long", vid, d, data["title"][:60])
        continue
    seen.add(vid)
    new.append({"id": vid, "title": data["title"], "author_name": data["author_name"],
                "durationSec": d, "harvest_title": it.get("title", ""), "harvest_author": ""})
    print("KEEP", vid, d, data["author_name"], "|", data["title"][:80], "| q:", it.get("query"))

merged = final + new
json.dump(merged, open(f"{HERE}/verified_final.json", "w"), indent=1)
vout = [{"id": x["id"], "title": x["title"], "author_name": x["author_name"]} for x in merged]
json.dump(vout, open(f"{ROOT}/vault/handoff/reels-videos-verified.json", "w"), indent=1)
print("before:", len(final), "added:", len(new), "merged:", len(merged))
