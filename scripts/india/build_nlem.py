#!/usr/bin/env python3
"""Build data/india/nlem2022.json from the official NLEM 2022 PDF (CDSCO).

  python3 scripts/india/build_nlem.py            # downloads the PDF
  python3 scripts/india/build_nlem.py file.pdf   # or uses a local copy

Needs pypdf (pip install pypdf cffi). The medicine list is the PDF's own alphabetical INDEX (authoritative);
strengths and levels of care come from the section tables before "Medicines Added" (the annexures of added
and DELETED medicines are never read as listed). Output is committed; the app reads it offline.
"""
import hashlib, json, re, sys, urllib.request, datetime

URL = "https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadConsumer/nlem2022.pdf"
OUT = "data/india/nlem2022.json"

def load_pdf(path):
    if path:
        return open(path, "rb").read()
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=120).read()

def text_of(pdf_bytes):
    import io, pypdf
    r = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return ["" if p.extract_text() is None else p.extract_text() for p in r.pages]

def norm(name):
    n = re.sub(r"\((?:[A-D]|p)\)", " ", name)
    n = n.replace("*", " ").replace("[", " ").replace("]", " ")
    return re.sub(r"\s+", " ", n).strip().lower()

def parse_index(pages):
    t = "\n".join(pages)
    i = t.rfind("\n5-aminosalicylic acid,")          # the INDEX at the end (the front matter has a numbered list too)
    assert i > 0, "index not found"
    i += 1
    lines = [l.strip() for l in t[i:].replace("INDEX", "").split("\n") if l.strip()]
    items, buf = [], ""
    def flush(b):
        m = re.match(r"^(.*?),\s*(\d+(?:\s*,\s*\d+)*)\s*$", b)
        if m: items.append({"name": re.sub(r"\s+", " ", m.group(1)).strip(), "pages": [int(x) for x in re.findall(r"\d+", m.group(2))]})
        else: items.append({"name": re.sub(r"\s+", " ", b).strip(" ,"), "pages": []})
    for l in lines:
        if buf and re.match(r"^[A-Z0-9]", l) and not buf.rstrip().endswith("+"):
            flush(buf); buf = ""
        buf = (buf + " " + l).strip() if buf else l
        if re.search(r",\s*\d+(\s*,\s*\d+)*\s*$", buf): flush(buf); buf = ""
    if buf: flush(buf)
    return items

def parse_sections(pages):
    body = " ".join(pages)
    body = re.sub(r"Medicine\s*Level\s*of\s*Healthcare\s*Dosage\s*form\s*\(?s?\)?\s*and\s*strength\s*\(?s?\)?", " ", body, flags=re.I)
    body = re.sub(r"\s+", " ", body)
    start = body.find(" 1.1.1 ")                        # first medicine entry (the table of contents names sections too)
    end = body.find("Medicines Added", start)            # annexures of added and DELETED medicines follow
    assert start > 0 and end > start, "section tables not found"
    toks = body[start:end].split(" ")
    NUM = re.compile(r"^\d{1,2}\.\d{1,2}\.\d{1,2}(\.\d{1,2})?$")
    LVL = re.compile(r"^(P|S|T)(,(P|S|T))*,?$")
    ents, i = [], 0
    while i < len(toks):
        if NUM.match(toks[i]):
            name, j, lv = [], i + 1, None
            while j < len(toks) and j < i + 25:
                w = toks[j]
                if NUM.match(w) or re.match(r"^\d{1,2}\.\d{1,2}(-|$)", w): break
                if LVL.match(w.strip()) and name:
                    lv, k = w, j + 1
                    while lv.endswith(",") and k < len(toks) and re.match(r"^(P|S|T),?$", toks[k]): lv += toks[k]; k += 1
                    break
                name.append(w); j += 1
            if lv:
                forms, k = [], j + 1
                while k < len(toks) and not NUM.match(toks[k]) and not toks[k].startswith("*") and toks[k] != "Section" and len(forms) < 60:
                    forms.append(toks[k]); k += 1
                ents.append({"no": toks[i], "name": " ".join(name).strip(" ,*"), "levels": lv.strip(","), "forms": " ".join(forms)})
                i = j; continue
        i += 1
    return ents

FORM_RE = re.compile(r"(?:Tablet|Capsule|Injection|Oral liquid|Syrup|Suspension|Cream|Ointment|Gel|Lotion|Drops|Inhalation|Powder for Injection|Suppository|Nasal Spray|Solution|Dispersible Tablet|Modified Release Tablet|Chewable Tablet|Patch|Granules|Spray)\s*[\d.,]+\s*(?:mg|mcg|\u00b5g|g|mL|ml|IU|%|units?)(?:\s*/\s*[\d.]*\s*(?:mL|ml|g|actuation|dose))?", re.I)

def main():
    pdf = load_pdf(sys.argv[1] if len(sys.argv) > 1 else None)
    pages = text_of(pdf)
    idx = parse_index(pages)
    secs = parse_sections(pages)
    by = {}
    for e in secs: by.setdefault(norm(e["name"]), []).append(e)
    meds = []
    for it in idx:
        k = norm(it["name"])
        rows = by.get(k, [])
        levels = sorted(set(",".join(r["levels"] for r in rows).replace(" ", "").split(",")) - {""}, key="PST".index)
        forms = []
        for r in rows:
            for m in FORM_RE.finditer(r["forms"]):
                f = re.sub(r"\s+", " ", m.group(0)).strip(" ,;")
                if f and f not in forms: forms.append(f)
        comps = [c.strip() for c in re.split(r"\+", k) if c.strip()]
        meds.append({"name": it["name"], "key": k, "components": comps, "levels": levels, "forms": forms[:12],
                     "sections": sorted(set(r["no"] for r in rows)), "pages": it["pages"]})
    out = {
        "list": "National List of Essential Medicines 2022 (NLEM 2022), Ministry of Health and Family Welfare, Government of India",
        "source_url": URL, "pdf_sha256": hashlib.sha256(pdf).hexdigest(), "generated": datetime.date.today().isoformat(),
        "levels_key": {"P": "Primary", "S": "Secondary", "T": "Tertiary"},
        "count": len(meds), "matched_to_sections": sum(1 for m in meds if m["sections"]), "medicines": meds,
    }
    with open(OUT, "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, indent=0, separators=(",", ":"))
    print(OUT, out["count"], "medicines;", out["matched_to_sections"], "with strengths and levels")

if __name__ == "__main__":
    main()
