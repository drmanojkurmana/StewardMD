#!/usr/bin/env python3
"""StewardMD — Government Health Schemes: Assam AA-MMJAY "PMJAY Package Master" adapter.

Source: https://atalamritabhiyan.assam.gov.in/information-services/pmjay-package-master —
a plain server-rendered HTML <table> (Drupal), NOT a React SPA, NOT a PDF. This is a
DIFFERENT, cleaner source than the MMLSAY PDF this project already tried and rejected
(overlapping text boxes shifted prices between columns) - confirmed by curl (exact bytes,
no JS execution needed, table present in the raw HTML response).

Why this source is safe where the PDF adapters aren't: ONE numeric column (Package Price)
sits in its own <td>, addressed by exact column index from the real <th> header row - no
"Nth numeric token among free text" heuristic, no risk of a stray digit in criteria/document
text being picked up as the rate. See functions/db/govschemes_verified_sources_batch3.md for
how this URL was found.

Uses Python's stdlib html.parser only - no external HTML library dependency, no guessing at
malformed markup (the source's <table> is simple: <tbody><tr><th>...</th></tr><tr><td>...
</td></tr>...).

Usage: ingest_assam_html.py <page.html> --source-url <url> > out.sql
"""
import sys, re, time, random, hashlib, argparse
from html.parser import HTMLParser

WANT_HEADERS = {
    "Specialty": "speciality_name",
    "Specialty Code HBP 2.0": "speciality_code",
    "Package Code HBP 2.0": "package_code",
    "AB PM - JAY Package Name": "package_name",
    "Procedure Code HBP 2.0": "treatment_code",
    "AB PM - JAY Procedure Name": "treatment_name",
    "Package Price": "package_amount",
    "Stratification Criteria ( Y/N)": "stratification_criteria",
    "Implants / High End Consumables (Y/N)": "implant_criteria",
    "Mandatory Documents - Pre Authorization": "pre_investigation",
    "Mandatory Documents - Claim Processing": "post_investigation",
}


class TableExtractor(HTMLParser):
    """Collects every <tr> as a list of cell-text strings, from the FIRST <table> only
    (the header block's nav menus have <ul>/<li>, not <table> - no ambiguity)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_table = False
        self.done = False
        self.in_cell = False
        self.rows = []
        self.cur_row = None
        self.cur_text = []

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        if tag == "table" and not self.in_table:
            self.in_table = True
        elif self.in_table and tag == "tr":
            self.cur_row = []
        elif self.in_table and tag in ("td", "th"):
            self.in_cell = True
            self.cur_text = []
        elif self.in_table and tag == "br":
            self.cur_text.append(" ")

    def handle_endtag(self, tag):
        if self.done:
            return
        if tag in ("td", "th") and self.in_cell:
            self.in_cell = False
            if self.cur_row is not None:
                self.cur_row.append(re.sub(r"\s+", " ", "".join(self.cur_text)).strip())
        elif tag == "tr" and self.cur_row is not None:
            self.rows.append(self.cur_row)
            self.cur_row = None
        elif tag == "table" and self.in_table:
            self.in_table = False
            self.done = True

    def handle_data(self, data):
        if self.in_cell:
            self.cur_text.append(data)


CLEAN_MONEY_RE = re.compile(r"^[0-9,]+(\.[0-9]+)?$")


def money(v):
    """Returns (amount, ok). ok=False for anything that isn't a clean number - e.g. the
    source's one non-numeric Package Price cell, 'Upto 1 lakh' (US001A) - so the caller
    drops that row instead of silently extracting a stray digit as the price."""
    s = str(v or "").strip()
    if not s:
        return 0, True   # genuinely blank price - valid 0, not a parse failure
    if not CLEAN_MONEY_RE.match(s):
        return 0, False
    return int(round(float(s.replace(",", "")))), True


def sql_str(s):
    return "'" + str(s if s is not None else "").replace("'", "''") + "'"


def new_id(prefix):
    return f"{prefix}{int(time.time()*1000):x}{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html_file")
    ap.add_argument("--jurisdiction", default="assam")
    ap.add_argument("--scheme-id", default="assam-aa-mmjay")
    ap.add_argument("--scheme-name", default="Atal Amrit Abhiyan / AB PM-JAY (Assam)")
    ap.add_argument("--authority", default="Atal Amrit Abhiyan Society, Government of Assam")
    ap.add_argument("--version-label", default="AA-MMJAY PMJAY Package Master")
    ap.add_argument("--source-url", required=True)
    a = ap.parse_args()

    html = open(a.html_file, encoding="utf-8").read()
    ex = TableExtractor()
    ex.feed(html)
    if not ex.rows:
        sys.exit("no <table> found in HTML")

    header = ex.rows[0]
    col = {}
    for i, h in enumerate(header):
        field = WANT_HEADERS.get(h)
        if field:
            col[field] = i
    missing = set(WANT_HEADERS.values()) - set(col)
    if "treatment_code" not in col or "package_amount" not in col:
        sys.exit(f"required columns not found in header {header!r}; missing={missing}")
    if missing:
        print(f"NOTE: optional columns not found, left blank: {missing}", file=sys.stderr)

    def cell(r, f):
        i = col.get(f)
        return (r[i] if i is not None and i < len(r) else "") or ""

    recs, seen, skipped = [], set(), 0
    for r in ex.rows[1:]:
        code = cell(r, "treatment_code").strip()
        if not code:
            skipped += 1
            continue
        spec = cell(r, "speciality_code").strip()
        key = (spec, code)
        if key in seen:
            skipped += 1
            continue
        amount, ok = money(cell(r, "package_amount"))
        if not ok:
            print(f"DROPPED (non-numeric Package Price): {code} = {cell(r, 'package_amount')!r}",
                  file=sys.stderr)
            skipped += 1
            continue
        seen.add(key)
        recs.append({
            "speciality_code": spec,
            "speciality_name": cell(r, "speciality_name"),
            "package_code": cell(r, "package_code"),
            "package_name": cell(r, "package_name"),
            "treatment_code": code,
            "treatment_name": cell(r, "treatment_name"),
            "package_amount": amount,
            "stratification_criteria": cell(r, "stratification_criteria"),
            "implant_criteria": cell(r, "implant_criteria"),
            "pre_investigation": cell(r, "pre_investigation"),
            "post_investigation": cell(r, "post_investigation"),
        })
    if not recs:
        sys.exit("no rows parsed")

    canon = "\n".join("|".join([r["speciality_code"], r["treatment_code"], r["treatment_name"],
                                str(r["package_amount"])]) for r in recs)
    content_hash = hashlib.sha256(canon.encode()).hexdigest()
    now = int(time.time() * 1000)
    src, svid = new_id("gssrc"), new_id("sv")

    o = ["-- Generated by scripts/govschemes/ingest_assam_html.py -- DO NOT HAND-EDIT.",
         f"-- Source: {a.source_url} (plain server-rendered HTML table, curl-exact, no OCR/layout guessing)",
         f"-- {len(recs)} procedures ({skipped} rows skipped: blank code or dup key), "
         f"content_hash={content_hash}", ""]
    o.append(f"INSERT OR IGNORE INTO schemes (id, jurisdiction_id, name, authority, status) VALUES "
             f"({sql_str(a.scheme_id)}, {sql_str(a.jurisdiction)}, {sql_str(a.scheme_name)}, {sql_str(a.authority)}, 'active');")
    o.append(f"INSERT INTO sources (id, jurisdiction_id, authority, url, homepage, document_type, "
             f"document_date, retrieved_ts, verification_status, enabled, created_ts) VALUES "
             f"({sql_str(src)}, {sql_str(a.jurisdiction)}, {sql_str(a.authority)}, {sql_str(a.source_url)}, "
             f"{sql_str(a.source_url)}, 'html', '', {now}, 'unverified', 1, {now});")
    o.append(f"INSERT INTO scheme_versions (id, scheme_id, version_label, source_id, effective_date, "
             f"content_hash, status, published_ts, created_ts) VALUES ({sql_str(svid)}, {sql_str(a.scheme_id)}, "
             f"{sql_str(a.version_label)}, {sql_str(src)}, '', {sql_str(content_hash)}, 'draft', 0, {now});")
    o.append("")

    cols = ("id, scheme_version_id, speciality_code, speciality_name, package_code, package_name, "
            "treatment_code, treatment_name, package_amount, pre_investigation, post_investigation, "
            "implant_criteria, stratification_criteria, rate_tier")
    vals = [f"({sql_str(new_id('pkg'))}, {sql_str(svid)}, {sql_str(r['speciality_code'])}, "
            f"{sql_str(r['speciality_name'])}, {sql_str(r['package_code'])}, {sql_str(r['package_name'])}, "
            f"{sql_str(r['treatment_code'])}, {sql_str(r['treatment_name'])}, {r['package_amount']}, "
            f"{sql_str(r['pre_investigation'])}, {sql_str(r['post_investigation'])}, "
            f"{sql_str(r['implant_criteria'])}, {sql_str(r['stratification_criteria'])}, '')"
            for r in recs]
    CHUNK = 50
    for i in range(0, len(vals), CHUNK):
        o.append(f"INSERT INTO packages ({cols}) VALUES\n" + ",\n".join(vals[i:i + CHUNK]) + ";")
    o.append("")
    o.append(f"INSERT INTO crawl_logs (id, ts, source_id, status, detail, rows_in, rows_out) VALUES "
             f"({sql_str(new_id('cl'))}, {now}, {sql_str(src)}, 'new', "
             f"{sql_str('ingest_assam_html.py ' + a.source_url)}, {len(ex.rows) - 1}, {len(recs)});")
    print("\n".join(o))
    print(f"-- assam: {len(recs)} procedures ({skipped} skipped)", file=sys.stderr)


if __name__ == "__main__":
    main()
