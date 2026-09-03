#!/usr/bin/env python3
"""StewardMD — Government Health Schemes: West Bengal Swasthya Sathi package-search adapter.

Source: `POST https://tms.swasthyasathi.gov.in/portal/SSPPackage.asp?dw=<grade>` with form body
`cbo_pckg=<grade>&cbo_Procedure=` (both the URL querystring AND the form field are needed - the
classic-ASP page ignores just the form field, and just the querystring gets HTTP 411 Length
Required without a body). Plain server-rendered HTML `<table>` (unclosed <font>/<b> tags inside
each <td> - malformed but harmless: text is collected regardless of nested tags). Columns:
`SrNo | Procedures(speciality) | PackageId | PackageName | Amount`.

Ten grade values, each its OWN scheme_version (never merged into one natural-key space - the
same procedure name can recur across grades at a different price, and PackageId format doesn't
guarantee cross-grade uniqueness): 2=Grade A, 3=Grade B, 4=Grade C, 7=Grade R,
1=Critical Illness Package, 5=Implants ORTHOPAEDICS, 6=Implants CARDIO, 11=Implants ONCOSURGERY,
8=Investigation Package - NABH, 9=Investigation Package - Non-NABH.

Fetch first (kept separate/inspectable, not baked into this script):
  curl -A "Mozilla/5.0" -X POST "https://tms.swasthyasathi.gov.in/portal/SSPPackage.asp?dw=2" \
    -d "cbo_pckg=2&cbo_Procedure=" -o wb_grade2.html

Usage: ingest_westbengal_html.py <page.html> --grade-label "Grade A" > out.sql
"""
import sys, re, time, random, hashlib, argparse
from html.parser import HTMLParser

AMT_RE = re.compile(r"^[0-9,]+(\.[0-9]+)?$")


class TableExtractor(HTMLParser):
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

    def handle_endtag(self, tag):
        if self.done:
            return
        if tag in ("td", "th") and self.in_cell:
            self.in_cell = False
            if self.cur_row is not None:
                self.cur_row.append(re.sub(r"\s+", " ", "".join(self.cur_text)).strip())
        elif tag == "tr" and self.cur_row is not None:
            if self.cur_row:
                self.rows.append(self.cur_row)
            self.cur_row = None
        elif tag == "table" and self.in_table:
            self.in_table = False
            self.done = True

    def handle_data(self, data):
        if self.in_cell:
            self.cur_text.append(data)


def money(v):
    s = str(v or "").strip()
    if not s:
        return 0, True
    if not AMT_RE.match(s):
        return 0, False
    return int(round(float(s.replace(",", "")))), True


def sql_str(s):
    return "'" + str(s if s is not None else "").replace("'", "''") + "'"


def new_id(prefix):
    return f"{prefix}{int(time.time()*1000):x}{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html_file")
    ap.add_argument("--jurisdiction", default="west-bengal")
    ap.add_argument("--scheme-id", default="west-bengal-swasthya-sathi")
    ap.add_argument("--scheme-name", default="Swasthya Sathi")
    ap.add_argument("--authority", default="Swasthya Sathi Scheme, Government of West Bengal")
    ap.add_argument("--grade-label", required=True, help="stored verbatim as rate_tier, e.g. 'Grade A'")
    ap.add_argument("--source-url", default="https://tms.swasthyasathi.gov.in/portal/SSPPackage.asp")
    a = ap.parse_args()

    # The source serves cp1252 bytes (e.g. byte 0x96 = en-dash "-") under a page that otherwise
    # looks ASCII/UTF-8; decode as cp1252 (a strict superset of latin-1 for the printable range)
    # so punctuation like "-" renders correctly instead of a "�" replacement glyph.
    html = open(a.html_file, encoding="cp1252").read()
    ex = TableExtractor()
    ex.feed(html)
    if not ex.rows:
        sys.exit("no <table> found in HTML")

    # No <th> header row in this source (confirmed: table starts directly with data <tr>s) -
    # columns are fixed and documented: SrNo, Procedures, PackageId, PackageName, Amount.
    recs, seen, skipped = [], set(), 0
    for r in ex.rows:
        if len(r) < 5:
            skipped += 1
            continue
        _, spec, pkg_id, pkg_name, amt_raw = r[0], r[1], r[2], r[3], r[4]
        code = pkg_id.strip()
        if not code:
            skipped += 1
            continue
        if code in seen:
            skipped += 1
            continue
        amount, ok = money(amt_raw)
        if not ok:
            print(f"DROPPED (non-numeric Amount): {code} = {amt_raw!r}", file=sys.stderr)
            skipped += 1
            continue
        seen.add(code)
        recs.append({
            "speciality_name": spec,
            "treatment_code": code,
            "treatment_name": pkg_name,
            "package_amount": amount,
        })
    if not recs:
        sys.exit("no rows parsed")

    canon = "\n".join("|".join([r["treatment_code"], r["treatment_name"], str(r["package_amount"])])
                      for r in recs)
    content_hash = hashlib.sha256((a.grade_label + "\n" + canon).encode()).hexdigest()
    now = int(time.time() * 1000)
    src, svid = new_id("gssrc"), new_id("sv")

    o = ["-- Generated by scripts/govschemes/ingest_westbengal_html.py -- DO NOT HAND-EDIT.",
         f"-- Source: {a.source_url}?dw=<grade> grade={a.grade_label!r} (POST form, curl-exact)",
         f"-- {len(recs)} procedures ({skipped} rows skipped), content_hash={content_hash}", ""]
    o.append(f"INSERT OR IGNORE INTO schemes (id, jurisdiction_id, name, authority, status) VALUES "
             f"({sql_str(a.scheme_id)}, {sql_str(a.jurisdiction)}, {sql_str(a.scheme_name)}, {sql_str(a.authority)}, 'active');")
    o.append(f"INSERT INTO sources (id, jurisdiction_id, authority, url, homepage, document_type, "
             f"document_date, retrieved_ts, verification_status, enabled, created_ts) VALUES "
             f"({sql_str(src)}, {sql_str(a.jurisdiction)}, {sql_str(a.authority)}, {sql_str(a.source_url)}, "
             f"{sql_str(a.source_url)}, 'html', '', {now}, 'unverified', 1, {now});")
    o.append(f"INSERT INTO scheme_versions (id, scheme_id, version_label, source_id, effective_date, "
             f"content_hash, status, published_ts, created_ts) VALUES ({sql_str(svid)}, {sql_str(a.scheme_id)}, "
             f"{sql_str('Swasthya Sathi Package List - ' + a.grade_label)}, {sql_str(src)}, '', "
             f"{sql_str(content_hash)}, 'draft', 0, {now});")
    o.append("")

    cols = "id, scheme_version_id, speciality_name, treatment_code, treatment_name, package_amount, rate_tier"
    vals = [f"({sql_str(new_id('pkg'))}, {sql_str(svid)}, {sql_str(r['speciality_name'])}, "
            f"{sql_str(r['treatment_code'])}, {sql_str(r['treatment_name'])}, {r['package_amount']}, "
            f"{sql_str(a.grade_label)})" for r in recs]
    CHUNK = 50
    for i in range(0, len(vals), CHUNK):
        o.append(f"INSERT INTO packages ({cols}) VALUES\n" + ",\n".join(vals[i:i + CHUNK]) + ";")
    o.append("")
    o.append(f"INSERT INTO crawl_logs (id, ts, source_id, status, detail, rows_in, rows_out) VALUES "
             f"({sql_str(new_id('cl'))}, {now}, {sql_str(src)}, 'new', "
             f"{sql_str('ingest_westbengal_html.py grade=' + a.grade_label)}, {len(ex.rows)}, {len(recs)});")
    print("\n".join(o))
    print(f"-- west-bengal {a.grade_label}: {len(recs)} procedures ({skipped} skipped)", file=sys.stderr)


if __name__ == "__main__":
    main()
