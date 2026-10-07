"""Build drug-lexicon.js (window.SMD_DRUG_LEXICON) from data/interaction-rules.json.

Source: the `generics` and `brands` tables of data/interaction-rules.json (openFDA structured product
labelling and the ONC/NLM high-priority DDI list, both U.S. Government works, public domain).
Output is names only: what drug-link.js needs to find and highlight a drug in text.

Rules:
  - plain names only (letters, spaces, hyphens; at most 4 words); chemicals with digits/commas dropped
  - allergen extracts, antivenins and vaccines-of-pollen style entries dropped (not prescribable drugs)
  - salt / form words stripped to add the BASE name too ("amoxicillin anhydrous" -> "amoxicillin",
    "alfentanil hydrochloride" -> "alfentanil"), because the catalogue often only lists the salt
  - bare electrolytes, elements and body substances dropped ("sodium", "potassium", "glucose", "iron"):
    they are lab values far more often than prescriptions, and highlighting "potassium 3.2" is wrong
Usage: python3 scripts/druglink/build-drug-lexicon.py
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
src = json.load(open(os.path.join(ROOT, "data", "interaction-rules.json"), encoding="utf-8"))

SALT = ("anhydrous hydrochloride hcl hydrobromide sodium potassium calcium magnesium sulfate sulphate "
        "acetate maleate dimaleate mesylate mesilate besylate besilate tartrate bitartrate citrate "
        "phosphate succinate fumarate hemifumarate dihydrate monohydrate trihydrate hydrate bromide "
        "chloride nitrate lactate gluconate propionate dipropionate valerate butyrate furoate xinafoate "
        "tosylate hyclate pamoate embonate disodium trometamol tromethamine meglumine hydrobromide "
        "monosodium decanoate enanthate cypionate undecanoate palmitate").split()
DROP_PHRASE = re.compile(r"(pollen|allergenic|allergen|extract|antivenin|antivenom|venom|dander|mite|"
                         r"mold|mould|feather|hair|epithelia|smut|weed|grass|tree|dust|insect|food)")
NOT_A_DRUG = set("""sodium potassium calcium magnesium chloride phosphate bicarbonate glucose dextrose
oxygen nitrogen water alcohol ethanol urea iron zinc copper lead gold silver sulfur sulphur iodine
fluoride selenium chromium manganese molybdenum histamine cholesterol protein albumin collagen
starch sucrose lactose fructose glycerin glycerol honey caffeine menthol camphor talc kaolin
petrolatum paraffin lanolin gelatin nickel cobalt rosin""".split())
# Real, commonly prescribed names the catalogue lists only in compound form.
EXTRA = ["insulin", "clavulanate"]
# Combination brands -> EVERY ingredient. The source maps each to ONE ("combiflam" -> "ibuprofen"),
# which hides the paracetamol and opens the wrong monograph ("entresto" -> "valsartan"). Ingredients
# sorted: that is how the Drug Index names the composition ("Ibuprofen + Paracetamol").
# Clinician-confirmed by the owner 2026-10-02 against api.stewardmd.in/brand-search; pinned by
# test/drug-lexicon-combos.test.mjs. Adding or changing one is a clinical change: get sign-off.
COMBOS = {
    "combiflam": ["ibuprofen", "paracetamol"],
    "deriphyllin": ["etofylline", "theophylline"],
    "dynapar": ["diclofenac", "paracetamol"],
    "entresto": ["sacubitril", "valsartan"],
    "pan-d": ["domperidone", "pantoprazole"],
    "ultracet": ["paracetamol", "tramadol"],
    "zituvimet": ["metformin", "sitagliptin"],
}

def plain(x):
    return re.fullmatch(r"[a-z][a-z \-]{2,48}", x) and len(x.split()) <= 4

names = set()
for g in src["generics"]:
    g = g.strip().lower()
    if not plain(g) or DROP_PHRASE.search(g):
        continue
    words = g.split()
    base = [w for w in words if w not in SALT]
    for cand in (g, " ".join(base)):
        cand = cand.strip()
        if len(cand) >= 4 and cand not in NOT_A_DRUG and plain(cand):
            names.add(cand)

brands = {}
for b, gen in src["brands"].items():
    b = b.strip().lower(); gen = str(gen).strip().lower()
    if b in COMBOS:
        # the source's one ingredient must be one of ours, or the source changed under us: re-check it
        assert gen in COMBOS[b], (b, gen, COMBOS[b])
        continue
    # brand keys that are really class shorthands ("acei", "acid reducer", "ppi") are not drug names
    if len(b) < 5 or " " in b or not re.fullmatch(r"[a-z][a-z\-]+", b) or b in NOT_A_DRUG:
        continue
    if gen in names or plain(gen):
        brands[b] = gen
        names.add(gen) if plain(gen) and gen not in NOT_A_DRUG and len(gen) >= 4 else None

names.update(EXTRA)
# British/BAN and US/INN spellings of the same molecule, from the curated CLIN_SYN table in api.js
# (the table the Drugs Database uses to resolve a monograph). Indian notes use BAN names
# ("rifampicin", "salbutamol", "lignocaine"); the FDA-derived catalogue uses US names.
api = open(os.path.join(ROOT, "api.js"), encoding="utf-8").read()
blk = re.search(r"var CLIN_SYN = \[(.*?)\];", api, re.S)
for x, y in re.findall(r'\["([^"]+)",\s*"([^"]+)"\]', blk.group(1) if blk else ""):
    for n in (x.lower(), y.lower()):
        if plain(n) and n not in NOT_A_DRUG and len(n) >= 4:
            names.add(n)
out = sorted(names)
js = ("/* drug-lexicon.js - window.SMD_DRUG_LEXICON. GENERATED by scripts/druglink/build-drug-lexicon.py\n"
      " * from data/interaction-rules.json (openFDA SPL + ONC/NLM HP-DDI; U.S. Government works, public domain).\n"
      " * Names only, for drug-link.js highlighting. brands: brand -> one generic; combos: brand -> every\n"
      " * ingredient (never in brands). Do not edit by hand; re-run the script. */\n"
      "(function (root) {\n  var L = { version: \"2\", generics: " + json.dumps(out, separators=(",", ":")) +
      ",\n    brands: " + json.dumps(dict(sorted(brands.items())), separators=(",", ":")) +
      ",\n    combos: " + json.dumps(dict(sorted(COMBOS.items())), separators=(",", ":")) + " };\n"
      "  if (typeof module !== \"undefined\" && module.exports) module.exports = L;\n"
      "  if (root) root.SMD_DRUG_LEXICON = L;\n"
      "})(typeof window !== \"undefined\" ? window : null);\n")
open(os.path.join(ROOT, "drug-lexicon.js"), "w", encoding="utf-8").write(js)
print(len(out), "generics,", len(brands), "brands,", len(COMBOS), "combos,", len(js), "bytes")
