"""Insert generated video cards into prep-medigram.js CANDIDATES, replacing the placeholder card."""
import re, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
mg = open(f"{ROOT}/prep-medigram.js").read()
cards = open(f"{ROOT}/reels-scratch/cards.txt").read().rstrip("\n")

# Match the placeholder line exactly (single line containing dQw4w9WgXcQ)
placeholder_re = re.compile(r'\n    \{ id: "mg-v-yt-ecg".*\},\n')
m = placeholder_re.search(mg)
assert m, "placeholder card not found"
mg2 = placeholder_re.sub("\n" + cards + "\n", mg)
assert "dQw4w9WgXcQ" not in mg2, "placeholder still present"
open(f"{ROOT}/prep-medigram.js", "w").write(mg2)
print("inserted cards; remaining placeholder occurrences:", mg2.count("dQw4w9WgXcQ"))
