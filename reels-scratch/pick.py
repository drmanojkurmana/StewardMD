"""Select PrepReels video cards from harvested corpus: official-channel + teaching filters.

Reads ~/prep-data/assessment/reels-scratch/{corpus,verified_raw,verified_search}.json (read-only).
Writes selection.json next to this script (worktree copy).
"""
import json, re, collections, os

SCRATCH = "/Users/mkk/prep-data/assessment/reels-scratch"
HERE = os.path.dirname(os.path.abspath(__file__))
corpus = json.load(open(f"{SCRATCH}/corpus.json"))
vraw = json.load(open(f"{SCRATCH}/verified_raw.json"))
vsearch = json.load(open(f"{SCRATCH}/verified_search.json"))

dur = {}
for x in corpus:
    dur[x["id"]] = x.get("durationSec")
def plen(t):
    if not t: return None
    try:
        p = t.split(":")
        return sum(int(x) * m for x, m in zip(reversed(p), [1, 60, 3600]))
    except Exception:
        return None

pool = {}
def add(id_, title, author, d, source):
    if id_ in pool: return
    if not id_ or not title or not author: return
    pool[id_] = {"id": id_, "title": title, "author": author, "durationSec": d, "source": source}

for x in vraw:
    add(x["id"], x.get("title"), x.get("author_name"), dur.get(x["id"]), f"raw/{x.get('author_name','?')}")
for x in vsearch:
    if x.get("http") != 200: continue
    add(x["id"], x.get("title"), x.get("author_name"), plen(x.get("len")), f"search/{x.get('query','')}")
for x in corpus:
    if x["id"] in pool and pool[x["id"]]["durationSec"] is None:
        pool[x["id"]]["durationSec"] = x.get("durationSec")

OFFICIAL = {"Osmosis from Elsevier", "Armando Hasudungan", "Ninja Nerd", "Dr. Najeeb Lectures",
            "khanacademymedicine", "Zero To Finals"}
KHAN_MED = ["reproductive", "childbirth", "gestation", "intestine", "disorders", "disease", "organism",
            "cell", "biology class", "science", "physiology", "anatomy", "embryo", "pregnancy", "infection",
            "immune", "respiratory", "circulatory", "endocrine", "renal", "digestive", "neuro"]
CLINIC_OK = ["Mayo Clinic", "Cleveland Clinic", "Johns Hopkins Medicine", "NEJM"]
CLINIC_KEEP = ["pancreatic cyst", "fibroid", "period", "perimenopause", "stroke", "be fast",
               "honey for allergies", "joints hurt", "robot helps prepare chemo", "pops or cracks",
               "drone delivery", "heat exhaustion", "alzheimer", "forgetfulness", "newborn screening",
               "cognitive decline", "grapefruit", "hand, foot and mouth", "acl tear", "diet", "uti",
               "swim with a uti", "cardiac screening", "screen time", "liver detox", "alcohol cause cancer",
               "respiratory viruses", "mammogram", "dementia", "posture", "desk", "ergonomics", "eating disorders",
               "smoking", "ulcer", "processed"]

NONTEACH = ["osmosis ai", "try osmosis", "meet osmosis", "tutor mode", "raise the line podcast",
            "behind-the-scenes", "bts", "hackathon", "day in the life", "a day in the life", "meet cheyan",
            "career", "crna", "mentor", "volunteer", "match day", "student success", "test-taking",
            "study with", "study hack", "study type", "hour horror", "horror movie", "girl dinner",
            "nursing school exam", "colors!", "how kristin draws", "assemble", "website!", "teaser",
            "shout-out", "students of", "baby", "pumpkin", "halloween", "trick-or-treat", "nicu!",
            "free mcat", "loan", "insurance", "401(k)", "computer science", "python",
            "teacher", "classroom", "reimagined", "ist", "springcue", "scam", "pyramid", "life insurance",
            "bakery", "snowball", "sharks", "workforce", "code in the age of ai", "replace teachers",
            "clash royale", "discover", "lecumberri", "fuji", "rick astley",
            "grand welcome", "makes fun of his baldness", "stein fireside", "tomorrow's cure",
            "donor alliance", "brain death", "malpractice",
            "robotic cataract", "telugu", "american laser",
            "nursing pharmacology", "nursing practice", "maslow", "airway, breathing, and circulation"]

def keep(item):
    a = (item["author"] or "").strip()
    t = (item["title"] or "").lower()
    if a in OFFICIAL:
        pass
    elif a.startswith("Khan Academy") and any(k in t for k in KHAN_MED):
        pass
    elif any(c in a for c in CLINIC_OK) and any(k in t for k in CLINIC_KEEP):
        pass
    else:
        return False
    if any(n in t for n in NONTEACH):
        return False
    d = item["durationSec"]
    if d is not None and d > 360:
        return False
    return True

selected = [it for it in pool.values() if keep(it)]
print("pool", len(pool), "selected", len(selected))
print(collections.Counter(x["author"] for x in selected))
nodur = [x for x in selected if x["durationSec"] is None]
print("no-duration:", len(nodur))
for x in nodur: print("  NODUR", x["author"], x["id"], x["title"][:80])

json.dump(selected, open(f"{HERE}/selection_pool.json", "w"), indent=1)
