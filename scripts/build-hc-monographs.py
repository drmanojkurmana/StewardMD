#!/usr/bin/env python3
"""Build monographs from the Health Canada PRODUCT MONOGRAPH (Drug Product Database) for molecules that
no FDA label covers. Verbatim section text, one JSON per drug in data/fda-labels/ (same schema).

Match rule: a Canadian human product whose ACTIVE INGREDIENTS are exactly this one molecule (salt
removed). Multi-ingredient products and veterinary/natural products are refused.

Run:  python3 scripts/build-hc-monographs.py <names.json> [--cache DIR] [--out DIR]
Source: https://health-products.canada.ca/api/drug/ (DPD) and https://pdf.hres.ca/dpd_pm/<DIN>.PDF
"""
import json, os, re, sys, time, urllib.request
import concurrent.futures as cf

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DEFAULT_OUT = os.path.join(ROOT, "data", "fda-labels")
SALT = r"(anhydrous|anhyd|dipropionate|diacetate|mesylate|dimesylate|sodium|potassium|calcium|magnesium|hydrochloride|hcl|dihydrochloride|hydrobromide|sulfate|sulphate|acetate|citrate|tartrate|maleate|besylate|mesilate|phosphate|succinate|fumarate|bisulfate|bitartrate|disodium|dihydrate|monohydrate|trihydrate|hydrate|propionate|tromethamine|tosylate|diphosphate|hemihydrate|bromide|chloride|nitrate|lactate|gluconate|pivoxil|tannate|polistirex|maleate|d-tartrate|free acid|resin|medoxomil|decanoate|isetionate|cypionate|enanthate|valerate|palmitate|hyclate|pamoate|napsylate|esylate|edisylate|oxalate|hemifumarate|valproate|sesquihydrate|mofetil|axetil|proxetil|hexanoate|undecanoate|acefyllinate|hyoscyamate|xinafoate|stearate|laurate|dipalmitate|cilexetil|dimesilate|monohydrochloride)"
# Canadian product monograph headings (uppercase lines) -> record keys
HEADINGS = {
    "INDICATIONS AND CLINICAL USE": "Indications and usage",
    "INDICATIONS": "Indications and usage",
    "DOSAGE AND ADMINISTRATION": "Dosage and administration",
    "CONTRAINDICATIONS": "Contraindications",
    "WARNINGS AND PRECAUTIONS": "Warnings and precautions",
    "WARNINGS": "Warnings and precautions",
    "ADVERSE REACTIONS": "Adverse reactions",
    "DRUG INTERACTIONS": "Drug interactions",
    "SPECIAL POPULATIONS": "Pregnancy and special populations",
    "OVERDOSAGE": "Overdosage",
    "SYMPTOMS AND TREATMENT OF OVERDOSAGE": "Overdosage",
    "ACTION AND CLINICAL PHARMACOLOGY": "Clinical pharmacology",
    "STORAGE AND STABILITY": "Storage and handling",
    "STABILITY AND STORAGE RECOMMENDATIONS": "Storage and handling",
    "DESCRIPTION": "Description",
    "PHARMACEUTICAL INFORMATION": "Pharmaceutical information",
    "DOSAGE FORMS, COMPOSITION AND PACKAGING": "How supplied",
    "AVAILABILITY OF DOSAGE FORMS": "How supplied",
    "DIRECTIONS FOR USE": "Directions for use",
    "STORAGE, STABILITY AND DISPOSAL": "Storage and handling",
    "DOSAGE FORMS, STRENGTHS, COMPOSITION AND PACKAGING": "How supplied",
    "SERIOUS WARNINGS AND PRECAUTIONS BOX": "Boxed warning",
}
TRUNC = 30000

def http_get(url, binary=False, tries=2):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "StewardMD-label-build/1.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            return data if binary else data.decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(1.0 * (i + 1))
    raise last

def core(s):
    x = re.sub(r"\s*\([^)]*\)", " ", str(s).lower())
    x = re.sub(r"[^a-z0-9]+", " ", x)
    for _ in range(3):
        x = re.sub(r"\b" + SALT + r"\b", " ", x)
    return re.sub(r"\s+", " ", x).strip()

def clean(s):
    s = re.sub(r"\s*\[see [^\]]*\]", "", s)
    s = s.replace("—", "-").replace("–", "-")
    s = re.sub(r"[ \t\xa0]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s)
    return s.strip()

def load_index(cache):
    ai_path = os.path.join(cache, "hc_activeingredient.json")
    dp_path = os.path.join(cache, "hc_drugproduct.json")
    if not os.path.exists(ai_path):
        open(ai_path, "wb").write(http_get("https://health-products.canada.ca/api/drug/activeingredient/?lang=en&type=json", binary=True))
    if not os.path.exists(dp_path):
        open(dp_path, "wb").write(http_get("https://health-products.canada.ca/api/drug/drugproduct/?lang=en&type=json", binary=True))
    ai = json.load(open(ai_path, encoding="utf-8"))
    dp = json.load(open(dp_path, encoding="utf-8"))
    by_code_ings = {}
    for r in ai:
        by_code_ings.setdefault(r["drug_code"], set()).add(core(r.get("ingredient_name", "")))
    products = {}
    for r in dp:
        if r.get("class_name") != "Human":
            continue
        products.setdefault(r["drug_code"], []).append(r)
    return by_code_ings, products

def find_products(name, by_code_ings, products):
    want = core(name)
    if not want:
        return []
    codes = [c for c, ings in by_code_ings.items() if ings == {want}]
    out = []
    for c in codes:
        out.extend(products.get(c, []))
    return out

def pm_urls(drug_code, din):
    """The product monograph PDF is keyed by its own PM number, not the DIN: the DPD product page
    (dpd-bdpp/info?code=<drug_code>) links it as pdf.hres.ca/dpd_pm/<PM no>.PDF. Using the DIN 404s for
    most products (ANDROCUR, MYLAN-CYPROTERONE), and where it does not 404 it is often ANOTHER drug's
    monograph: the DIN for HONVOL fetched PRISTIQ, TUBOCURARINE fetched Sandoz Omeprazole. Never guessed."""
    urls = []
    try:
        page = http_get(f"https://health-products.canada.ca/dpd-bdpp/info?lang=eng&code={drug_code}")
        urls = list(dict.fromkeys(re.findall(r"https://pdf\.hres\.ca/dpd_pm/\d+\.PDF", page)))
    except Exception:
        pass
    return urls

def names_molecule(sections, name, brand):
    """The monograph must be about this molecule: its indications name the molecule or the product's
    brand. A PDF that parses but is about another drug is refused (see pm_urls)."""
    ind = (sections.get("Indications and usage", "") + "\n" + sections.get("Dosage and administration", "")[:3000]).lower()
    word = core(name).split(" ")[0]
    b = re.sub(r"[^a-z]+", " ", (brand or "").lower()).split()
    return bool(word and re.search(r"\b" + re.escape(word), ind)) or bool(b and len(b[0]) >= 4 and re.search(r"\b" + re.escape(b[0]), ind))

def parse_pdf(data):
    import pymupdf
    doc = pymupdf.open(stream=data, filetype="pdf")
    text = "\n".join(p.get_text() for p in doc)
    lines = [l.strip() for l in text.split("\n")]
    sections, cur, buf = {}, None, []
    def flush():
        if cur and buf:
            key = HEADINGS[cur]
            body = clean("\n".join(buf))
            # A heading seen twice is the table of contents and then the section itself (current PM
            # format). Keep the longer body rather than gluing the TOC page numbers onto the text.
            if body and len(body) > len(sections.get(key, "")):
                sections[key] = body
    for l in lines:
        # Current PMs number their headings: "1 INDICATIONS", "7 WARNINGS AND PRECAUTIONS".
        head = re.sub(r"^\d{1,2}\.?\s+", "", l.rstrip(":").strip())
        if head in HEADINGS:
            flush(); cur = head; buf = []
        elif cur:
            buf.append(l)
    flush()
    return sections

def build(name, din, brand, sections, pdf_url):
    rec = {"generic": name, "src": "health-canada-monograph", "setid": din, "labelTitle": brand,
           "labelDate": "", "cls": "", "pharm": "", "tags": [], "quick": [], "indications": [], "label": {}, "refs": []}
    for key in ["Boxed warning", "Indications and usage", "Dosage and administration", "Contraindications", "Warnings and precautions",
                "Adverse reactions", "Drug interactions", "Pregnancy and special populations", "Overdosage",
                "Clinical pharmacology", "Storage and handling", "Description", "Pharmaceutical information",
                "How supplied", "Directions for use"]:
        if key in sections:
            t = sections[key]
            if len(t) > TRUNC:
                t = t[:TRUNC].rsplit("\n", 1)[0] + "\n[Section continues in the full product monograph.]"
                rec.setdefault("labelTruncated", []).append(key)
            rec["label"][key] = t
    if "Indications and usage" in rec["label"]:
        rec["indications"] = [l for l in rec["label"]["Indications and usage"].split("\n") if l.strip()][:60]
    rec["quick"].append(["Full label", "All sections of the Health Canada product monograph are shown verbatim below"])
    rec["refs"].append([f"Health Canada product monograph: {brand} (DIN {din})", pdf_url])
    rec["footer"] = "Verbatim from the Health Canada product monograph (Drug Product Database). Verify against the current monograph before prescribing."
    return rec

def main():
    args = sys.argv[1:]
    names = json.load(open(args[0]))
    cache = args[args.index("--cache") + 1] if "--cache" in args else os.path.join(ROOT, ".fda-label-cache")
    outdir = args[args.index("--out") + 1] if "--out" in args else DEFAULT_OUT
    os.makedirs(cache, exist_ok=True); os.makedirs(outdir, exist_ok=True)
    by_code_ings, products = load_index(cache)
    def slug(n):
        return re.sub(r"[^a-z0-9]+", "-", re.sub(r"[^A-Za-z0-9 ._-]", "", n).strip().lower()).strip("-")
    report = {"built": [], "no_product": [], "no_pdf": [], "exists": [], "failed": []}
    def work(name):
        out = os.path.join(outdir, slug(name) + ".json")
        if os.path.exists(out):
            return ("exists", name)
        try:
            prods = find_products(name, by_code_ings, products)
            if not prods:
                return ("no_product", name)
            for p in prods[:40]:
                din = str(p["drug_identification_number"]).zfill(8)
                data, url = None, ""
                for url in pm_urls(p["drug_code"], din):
                    try:
                        data = http_get(url, binary=True)
                        if data[:4] == b"%PDF":
                            break
                        data = None
                    except Exception:
                        data = None
                if not data:
                    continue
                sections = parse_pdf(data)
                if "Indications and usage" not in sections and "Dosage and administration" not in sections:
                    continue
                if not names_molecule(sections, name, p.get("brand_name", "")):
                    continue
                rec = build(name, din, p.get("brand_name", name), sections, url)
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(rec, f, ensure_ascii=False, indent=2); f.write("\n")
                return ("built", f"{name} [DIN {din}]")
            return ("no_pdf", name)
        except Exception as e:
            return ("failed", [name, str(e)[:160]])
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for kind, val in ex.map(work, names):
            report[kind].append(val)
    print(json.dumps({k: len(v) for k, v in report.items()}))
    json.dump(report, open(os.path.join(cache, "hc_report.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
