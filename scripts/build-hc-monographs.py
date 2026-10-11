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
            if body:
                sections[key] = (sections.get(key, "") + "\n" + body).strip()
    for l in lines:
        head = l.rstrip(":").strip()
        if head in HEADINGS:
            flush(); cur = head; buf = []
        elif cur:
            buf.append(l)
    flush()
    return sections

def build(name, din, brand, sections, pdf_url):
    rec = {"generic": name, "src": "health-canada-monograph", "setid": din, "labelTitle": brand,
           "labelDate": "", "cls": "", "pharm": "", "tags": [], "quick": [], "indications": [], "label": {}, "refs": []}
    for key in ["Indications and usage", "Dosage and administration", "Contraindications", "Warnings and precautions",
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
                url = f"https://pdf.hres.ca/dpd_pm/{din}.PDF"
                try:
                    data = http_get(url, binary=True)
                except Exception:
                    continue
                sections = parse_pdf(data)
                if "Indications and usage" not in sections and "Dosage and administration" not in sections:
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
