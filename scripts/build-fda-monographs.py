#!/usr/bin/env python3
"""Build offline monograph records from the FDA-approved label (DailyMed SPL XML).

WHY: many molecules in drug-lexicon.js have no authored monograph. The label is the source of
truth for dosing, warnings and interactions, so this copies each label section VERBATIM (text
only, paragraph breaks kept) into a gold-format record. Nothing is summarised or invented here.

Run:  python3 scripts/build-fda-monographs.py <names.json> [--limit N] [--cache DIR]
  names.json   a JSON array of generic names to build (e.g. the missing lexicon names)
  Writes data/fda-labels/<slug>.json (skips names already built). Kept OUT of the bundled
  supplement on purpose: ~58 KB per drug would bloat the phone's startup payload; the app
  fetches one record when its monograph is opened.
  Raw label XML is cached under --cache (default: ./.fda-label-cache, gitignored).
Source: https://dailymed.nlm.nih.gov/dailymed/services/v2/ (FDA-run SPL repository).
"""
import json, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DEFAULT_OUT = os.path.join(ROOT, "data", "fda-labels")
NS = {"v3": "urn:hl7-org:v3"}
TRUNC = 30000  # per-section character cap; longer sections are cut and flagged

# LOINC section codes -> record key
CODES = {
    "34066-1": "Boxed warning", "34067-9": "Indications and usage", "34068-7": "Dosage and administration",
    "43678-2": "Dosage forms and strengths", "34070-3": "Contraindications", "43685-7": "Warnings and precautions",
    "34071-1": "Warnings", "34084-4": "Adverse reactions", "34073-7": "Drug interactions",
    "42228-7": "Pregnancy", "77290-5": "Lactation", "34080-2": "Nursing mothers", "77291-3": "Females and males of reproductive potential",
    "34081-0": "Pediatric use", "34082-8": "Geriatric use", "88828-9": "Renal impairment", "88829-7": "Hepatic impairment",
    "34088-5": "Overdosage", "34089-3": "Description", "34090-1": "Clinical pharmacology", "43679-0": "Mechanism of action",
    "43681-6": "Pharmacodynamics", "43682-4": "Pharmacokinetics", "34092-7": "Clinical studies",
    "34069-5": "How supplied", "44425-7": "Storage and handling", "34076-0": "Patient counseling information",
}

def http_get(url, binary=False, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "StewardMD-label-build/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else data.decode("utf-8", "replace")
        except Exception as e:  # network blips: back off and retry
            last = e
            time.sleep(1.5 * (i + 1))
    raise last

def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

def clean(s):
    s = re.sub(r"\s*\[see [^\]]*\]", "", s)   # drop internal [see Section 2.1] cross-references
    s = s.replace("—", "-").replace("–", "-")          # no em or en dashes in app text
    s = re.sub(r"[ \t\xa0]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    return s.strip()

def section_text(section, depth=0):
    """Text of a section: its own paragraphs, then its subsections that carry no key of their own
    (numbered subsections like 1.1, 2.2 are part of the parent's content). A subsection with its own
    LOINC key is left out here and gets its own record field instead, so nothing is printed twice."""
    out = []
    def walk(el):
        for ch in el:
            tag = ch.tag.split("}")[-1]
            if tag == "component":
                walk(ch)
            elif tag == "section":
                code_el = ch.find("v3:code", NS)
                if code_el is not None and code_el.get("code") in CODES:
                    continue
                sub = section_text(ch, depth + 1)
                if sub:
                    out.append(sub)
            elif tag in ("paragraph", "item", "caption"):
                t = "".join(ch.itertext()).strip()
                if t:
                    out.append(t)
            elif tag == "table":
                for tr in ch.iter():
                    if tr.tag.split("}")[-1] == "tr":
                        cells = ["".join(td.itertext()).strip() for td in tr if td.tag.split("}")[-1] in ("td", "th")]
                        cells = [c for c in cells if c]
                        if cells:
                            out.append(" | ".join(cells))
            elif tag in ("text", "list"):
                walk(ch)
    txt = section.find("v3:text", NS)
    if txt is not None:
        walk(txt)
    for comp in section.findall("v3:component", NS):
        walk(comp)
    return clean("\n".join(out))

def parse_label(xml_text):
    root = ET.fromstring(xml_text.encode("utf-8"))
    sections = {}
    for sec in root.iter("{urn:hl7-org:v3}section"):
        code_el = sec.find("v3:code", NS)
        if code_el is None:
            continue
        code = code_el.get("code")
        if code not in CODES or code in sections:
            continue
        body = section_text(sec)
        if body:
            sections[code] = body
    return sections

def build_record(name, setid, title, published, sections):
    rec = {"generic": name, "src": "fda-label", "setid": setid, "labelTitle": title, "labelDate": published,
           "cls": "", "pharm": "", "tags": [], "quick": [], "indications": [], "label": {}, "refs": []}
    truncated = []
    for code, key in CODES.items():
        if code not in sections:
            continue
        text = sections[code]
        if len(text) > TRUNC:
            text = text[:TRUNC].rsplit("\n", 1)[0] + "\n[Section continues in the full label on DailyMed.]"
            truncated.append(key)
        if code == "34067-9":
            rec["indications"] = [ln for ln in text.split("\n") if ln.strip()][:60]
        rec["label"][key] = text
    if "34066-1" in sections:
        rec["quick"].append(["Boxed warning", sections["34066-1"].split("\n")[0][:240]])
    rec["quick"].append(["Full label", "All FDA label sections are shown verbatim below"])
    if truncated:
        rec["labelTruncated"] = truncated
    rec["refs"].append([f"FDA-approved label: {title} (DailyMed, {published})", f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={setid}"])
    rec["footer"] = "Verbatim from the FDA-approved label on DailyMed. Verify against the current label before prescribing."
    return rec

SALT_WORDS = r"(anhydrous|anhyd|sodium|potassium|calcium|magnesium|hydrochloride|hcl|dihydrochloride|hydrobromide|sulfate|sulphate|acetate|citrate|tartrate|maleate|besylate|mesylate|phosphate|succinate|fumarate|bisulfate|bitartrate|disodium|dihydrate|monohydrate|trihydrate|hydrate|propionate|tromethamine|tosylate|diphosphate|hemihydrate|mesilate|besilate|bromide|chloride|nitrate|lactate|gluconate|pivoxil)"
NONPHARMA_LABELERS = r"complementary health|homeopath|hylands|boiron|heel inc|guna\b|nature'?s |herbal|dr\.? reckeweg|pekana|vetone|mwi|veterin|animal|canine|feline|equine|bovine|porcine|avian"
VET_TITLE = r"canine|feline|equine|bovine|porcine|veterin|\bdogs?\b|\bcats?\b|\bhorse"

def ingredient_match(title, name):
    """The title must name THIS molecule alone: its ingredient parenthetical is the molecule plus at most a
    salt word ("(ALECTINIB HYDROCHLORIDE)" yes; "(AMOXICILLIN AND CLAVULANATE POTASSIUM)" no, that is a
    combination). Homeopathic and multi-ingredient products are refused by labeler and ingredient list."""
    head = title.split(" [")[0]
    labeler = title.split(" [")[1].lower() if " [" in title else ""
    if re.search(NONPHARMA_LABELERS, labeler) or re.search(VET_TITLE, title.lower()) or re.search(r"homeopath", title.lower()):
        return False
    m = re.search(r"\(([^)]*)\)", head)
    if not m:
        return False
    ing = re.sub(r"\s+", " ", m.group(1).lower()).strip()
    if re.search(r"\band\b|\s-\s|/|,|\+", ing):
        return False
    core = re.sub(r"\b" + SALT_WORDS + r"\b", " ", ing)
    core = re.sub(r"\s+", " ", core).strip()
    want = re.sub(r"\b" + SALT_WORDS + r"\b", " ", name.lower())
    return core == re.sub(r"\s+", " ", want).strip()

def pick_setid(name):
    """First DailyMed SPL whose ACTIVE INGREDIENT is this molecule (see ingredient_match)."""
    q = urllib.parse.urlencode({"drug_name": name, "pagesize": 100})
    data = json.loads(http_get(f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?{q}"))
    for item in data.get("data", []):
        t = item.get("title", "")
        if ingredient_match(t, name):
            return item["setid"], t, item.get("published_date", "")
    return None, None, None

def label_is_about(sections, name):
    """Second check on the label itself: the molecule is named in its indications, dosage or description."""
    word = re.compile(r"\b" + re.escape(name.split()[0].lower()) + r"\b")
    for code in ("34067-9", "34068-7", "34089-3"):
        if code in sections and word.search(sections[code].lower()):
            return True
    return False

def main():
    args = sys.argv[1:]
    names = json.load(open(args[0]))
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else len(names)
    cache = args[args.index("--cache") + 1] if "--cache" in args else os.path.join(ROOT, ".fda-label-cache")
    outdir = args[args.index("--out") + 1] if "--out" in args else DEFAULT_OUT
    os.makedirs(outdir, exist_ok=True)
    os.makedirs(cache, exist_ok=True)
    report = {"built": [], "exists": [], "no_label": [], "failed": []}
    for name in names[:limit]:
        safe = re.sub(r"[^A-Za-z0-9 ._-]", "", name).strip()
        out = os.path.join(outdir, slug(safe) + ".json")
        if os.path.exists(out):
            report["exists"].append(name); continue
        try:
            setid, title, published = pick_setid(name)
            if not setid:
                report["no_label"].append(name); continue
            cpath = os.path.join(cache, setid + ".xml")
            if os.path.exists(cpath):
                xml_text = open(cpath, encoding="utf-8").read()
            else:
                xml_text = http_get(f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}.xml")
                open(cpath, "w", encoding="utf-8").write(xml_text)
            sections = parse_label(xml_text)
            if "34067-9" not in sections and "34068-7" not in sections:
                report["no_label"].append(name); continue
            if not label_is_about(sections, name):
                report["no_label"].append(name); continue
            rec = build_record(safe, setid, title.split(" [")[0], published, sections)
            with open(out, "w", encoding="utf-8") as f:
                json.dump(rec, f, ensure_ascii=False, indent=2); f.write("\n")
            report["built"].append(name)
        except Exception as e:
            report["failed"].append([name, str(e)[:160]])
        time.sleep(0.2)
    print(json.dumps({k: len(v) for k, v in report.items()}))
    json.dump(report, open(os.path.join(cache, "report.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
