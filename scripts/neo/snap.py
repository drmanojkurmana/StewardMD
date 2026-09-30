#!/usr/bin/env python3
"""StewardMD neonatal layer - fetch a source and store a plain-text snapshot.

  python3 scripts/neo/snap.py <srcId> <url>                 HTML or PDF page -> text
  python3 scripts/neo/snap.py <srcId> fda:<set_id>          openFDA drug label (public domain) -> text
  python3 scripts/neo/snap.py <srcId> fda-name:<generic>    openFDA label, first match by generic name
  python3 scripts/neo/snap.py <srcId> <url> --raw           store the body as-is (CSV / TXT tables)

Writes data/neo/sources/<srcId>.txt with a 3-line header (URL, accessed date, extra) then the text.
Every quote in data/neo/*.json must be a verbatim substring of its snapshot (whitespace-normalised);
scripts/neo/validate.mjs enforces this. Snapshots are provenance only: build-www never ships them.
"""
import sys, os, re, json, io, datetime, urllib.request, urllib.parse, html

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "data", "neo", "sources")
UA = "Mozilla/5.0 (StewardMD provenance snapshot; +https://stewardmd.in)"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", ""), r.geturl()

def html_text(b):
    from bs4 import BeautifulSoup
    s = BeautifulSoup(b, "html.parser")
    for t in s(["script", "style", "noscript", "svg", "header", "footer", "nav", "form"]):
        t.decompose()
    for br in s.find_all("br"):
        br.replace_with("\n")
    # table rows become one line each, cells separated by " | " so a row can be quoted
    for tr in s.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        tr.replace_with("\n" + " | ".join(cells) + "\n")
    t = s.get_text("\n")
    t = html.unescape(t)
    lines = [re.sub(r"[ \t ]+", " ", l).strip() for l in t.splitlines()]
    out, blank = [], 0
    for l in lines:
        if not l:
            blank += 1
            if blank > 1: continue
        else:
            blank = 0
        out.append(l)
    return "\n".join(out).strip()

def pdf_text(b):
    import pypdf
    r = pypdf.PdfReader(io.BytesIO(b))
    return "\n\n".join((p.extract_text() or "") for p in r.pages)

FDA_FIELDS = ["boxed_warning", "indications_and_usage", "dosage_and_administration", "dosage_and_administration_table",
              "dosage_forms_and_strengths", "how_supplied", "storage_and_handling", "pediatric_use", "use_in_specific_populations",
              "clinical_pharmacology", "pharmacokinetics", "warnings_and_cautions", "warnings", "precautions", "contraindications",
              "description", "package_label_principal_display_panel"]

def fda(query):
    url = "https://api.fda.gov/drug/label.json?search=" + urllib.parse.quote(query) + "&limit=1"
    b, _, _ = get(url)
    res = json.loads(b)["results"][0]
    of = res.get("openfda", {})
    head = "openFDA label | set_id %s | version %s | effective %s | %s | %s" % (
        res.get("set_id"), res.get("version"), res.get("effective_time"),
        "; ".join(of.get("brand_name", [])), "; ".join(of.get("manufacturer_name", [])))
    parts = [head]
    for f in FDA_FIELDS:
        if f in res:
            v = res[f]
            if f.endswith("_table"):
                v = [html_text(x.encode()) for x in v]
            parts.append("## " + f + "\n" + "\n".join(v))
    dm = "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=" + res.get("set_id", "")
    return "\n\n".join(parts), dm

def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__); sys.exit(2)
    sid, src = a[0], a[1]
    raw = "--raw" in a
    extra = ""
    if src.startswith("fda:"):
        text, url = fda('set_id:"%s"' % src[4:]); extra = "Public domain (US Government work, FDA-approved labeling)"
    elif src.startswith("fda-name:"):
        text, url = fda('openfda.generic_name:"%s"' % src[9:]); extra = "Public domain (US Government work, FDA-approved labeling)"
    else:
        b, ct, url = get(src)
        if raw: text = b.decode("utf-8", "replace")
        elif "pdf" in ct or src.lower().endswith(".pdf") or b[:4] == b"%PDF": text = pdf_text(b)
        else: text = html_text(b)
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, sid + ".txt")
    with open(p, "w", encoding="utf-8") as f:
        f.write("URL: %s\nAccessed: %s\nNote: %s\n\n" % (url, datetime.date.today().isoformat(), extra))
        f.write(text)
    print("wrote", p, len(text), "chars")

if __name__ == "__main__":
    main()
