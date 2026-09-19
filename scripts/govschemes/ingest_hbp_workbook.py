#!/usr/bin/env python3
"""StewardMD — Government Health Schemes: generic NHA "HBP" package-master workbook adapter.

Most state masters are the same shape: the National Health Authority's Health Benefit Package
workbook, re-published per state with the state's own price column (Bihar HBP 2022 "Tier 2",
Kerala KASP HBP 2.0, Nagaland CMHIS "RATES" / CMHIS-EP semi-private, ...). One adapter reads
them all; the per-state differences are declared on the command line, never guessed.

Reads .xlsx (raw zipfile+XML - survives the malformed stylesheets openpyxl rejects) and legacy
.xls (xlrd). Emits SQL matching functions/db/govschemes_schema.sql +
functions/db/migrate_govschemes_hbp_fields.sql, as ONE new scheme_version.

SAFETY - two rules this script will not bend:
  1. --rate-column and --rate-tier are REQUIRED. HBP workbooks carry several price columns
     (Tier 1/2/3, NABH/non-NABH, ward class). Guessing which one is "the" price would silently
     put a wrong rupee figure in front of a clinician. The operator names the column; the tier
     label is stored verbatim on every row.
  2. Native codes/names are copied through byte-for-byte. No case-folding, no trimming of
     internal whitespace, no "fixing" of odd codes.

Usage:
  ingest_hbp_workbook.py FILE --jurisdiction bihar --scheme-id bihar-ab-pmjay \\
    --scheme-name "Ayushman Bharat PM-JAY (Bihar)" --authority "SHA Bihar" \\
    --version-label "HBP 2022" --rate-column "Tier 2" --rate-tier "Tier 2" \\
    --source-url "https://..." [--sheet "Procedure sheet"] > out.sql
"""
import sys, re, json, time, random, hashlib, zipfile, argparse, pathlib
from xml.etree import ElementTree as ET

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# Header aliases seen across the real state workbooks. Matching is case/space/newline-insensitive.
ALIASES = {
    "speciality_code": ["specialty code", "speciality code", "specialty code hbp 2022",
                        "specialty code hbp 2.0", "spec code"],
    "speciality_name": ["specialty", "speciality", "specialty name", "speciality name"],
    "package_code":    ["package code", "package code hbp 2022", "package code hbp 2.0"],
    "package_name":    ["package name", "ab pm - jay package name", "ab pmjay package name",
                        "ab pm-jay package name"],
    "treatment_code":  ["procedure code", "procedure code hbp 2022", "procedure code hbp 2.0",
                        "procedure code hbp 1.0"],
    "treatment_name":  ["procedure name", "procedure name 2022", "ab pm - jay procedure name",
                        "ab pm-jay procedure name"],
    "los_days":        ["los", "length of stay", "los (days)"],
    "implant_criteria": ["implant criteria (y/n)", "implant criteria", "implant mapped."],
    "stratification_criteria": ["stratification criteria (y/n)", "stratification criteria"],
    "icd_code":        ["ichi procedure / icd code", "icd code", "ichi / icd code"],
}


def norm(h):
    return re.sub(r"\s+", " ", str(h or "").replace("\n", " ")).strip().lower()


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("s:si", NS):
            shared.append("".join((t.text or "") for t in si.findall(".//s:t", NS)))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    names = [s.get("name") for s in wb.findall(".//s:sheet", NS)]
    sheets = {}
    paths = sorted((n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)),
                   key=lambda n: int(re.search(r"(\d+)", n).group(1)))
    for idx, sp in enumerate(paths):
        root = ET.fromstring(z.read(sp))
        rows = []
        for r in root.findall(".//s:sheetData/s:row", NS):
            cells = {}
            for c in r.findall("s:c", NS):
                ref = c.get("r") or ""
                m = re.match(r"([A-Z]+)", ref)
                if not m:
                    continue
                ci = 0
                for ch in m.group(1):
                    ci = ci * 26 + (ord(ch) - 64)
                ci -= 1
                t = c.get("t"); v = c.find("s:v", NS)
                if t == "inlineStr":
                    isn = c.find("s:is", NS)
                    val = "".join((x.text or "") for x in isn.findall(".//s:t", NS)) if isn is not None else ""
                elif t == "s" and v is not None:
                    val = shared[int(v.text)]
                else:
                    val = v.text if v is not None else ""
                cells[ci] = val
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
        sheets[names[idx] if idx < len(names) else sp] = rows
    return sheets


def read_xls(path):
    import xlrd
    wb = xlrd.open_workbook(path)
    out = {}
    for sh in wb.sheets():
        rows = []
        for r in range(sh.nrows):
            vals = []
            for c in sh.row(r):
                v = c.value
                if isinstance(v, float) and v == int(v):
                    v = int(v)
                vals.append("" if v is None else str(v))
            rows.append(vals)
        out[sh.name] = rows
    return out


def pick_sheet(sheets, want):
    """The procedure sheet = the one whose header row maps the most required HBP fields."""
    if want:
        if want not in sheets:
            sys.exit(f"sheet {want!r} not found; have {list(sheets)}")
        return want, sheets[want]
    best, best_score = None, -1
    for name, rows in sheets.items():
        if not rows:
            continue
        hdr = [norm(h) for h in rows[0]]
        score = sum(1 for k in ("treatment_code", "treatment_name", "package_code")
                    if any(h in ALIASES[k] for h in hdr))
        if score > best_score:
            best, best_score = name, score
    return best, sheets[best]


def map_columns(header, rate_column):
    """Match by ALIAS PREFERENCE order, not left-to-right header order.

    Kerala's KASP sheet carries BOTH 'Procedure Code\\nHBP 1.0' (legacy, mostly blank) at column 2
    and the live 'Procedure Code' at column 6. Scanning headers left-to-right picked the legacy
    column and silently produced ~1200 rows instead of ~2286 - a half-empty state master that
    still "worked". So: for each field, walk the alias list in order and take the first alias that
    matches any header. The canonical name is listed first in ALIASES, versioned variants after.
    """
    hdr = [norm(h) for h in header]
    col = {}
    for field, opts in ALIASES.items():
        for alias in opts:
            if alias in hdr:
                col[field] = hdr.index(alias)
                break
    rc = norm(rate_column)
    for i, h in enumerate(hdr):
        if h == rc:
            col["package_amount"] = i
            break
    return col


def money(v):
    s = re.sub(r"[^\d.]", "", str(v or ""))
    if not s:
        return 0
    try:
        return int(round(float(s)))
    except ValueError:
        return 0


def sql_str(s):
    return "'" + str(s if s is not None else "").replace("'", "''") + "'"


def new_id(prefix):
    return f"{prefix}{int(time.time()*1000):x}{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--jurisdiction", required=True)
    ap.add_argument("--scheme-id", required=True)
    ap.add_argument("--scheme-name", required=True)
    ap.add_argument("--authority", default="")
    ap.add_argument("--version-label", required=True)
    ap.add_argument("--rate-column", required=True, help="EXACT header of the price column to ingest")
    ap.add_argument("--rate-tier", required=True, help="tier/ward label stored verbatim on every row")
    ap.add_argument("--source-url", default="")
    ap.add_argument("--sheet", default="")
    a = ap.parse_args()

    p = pathlib.Path(a.file)
    sheets = read_xls(p) if p.suffix.lower() == ".xls" else read_xlsx(p)
    sheet_name, rows = pick_sheet(sheets, a.sheet)
    if not rows:
        sys.exit("empty sheet")

    # Header may not be row 0 (Nagaland EP has 3 preamble lines). Find the first row that maps a code column.
    hdr_i, col = 0, {}
    for i in range(min(12, len(rows))):
        c = map_columns(rows[i], a.rate_column)
        if "treatment_code" in c and "package_amount" in c:
            hdr_i, col = i, c
            break
    if "treatment_code" not in col:
        sys.exit(f"could not find a Procedure Code column in sheet {sheet_name!r}; headers={rows[0][:12]}")
    if "package_amount" not in col:
        sys.exit(f"rate column {a.rate_column!r} not found in sheet {sheet_name!r}; headers={rows[hdr_i]}")

    def cell(r, f):
        i = col.get(f)
        return (r[i] if i is not None and i < len(r) else "") or ""

    recs, seen = [], set()
    for r in rows[hdr_i + 1:]:
        code = str(cell(r, "treatment_code")).strip()
        if not code:
            continue
        spec = str(cell(r, "speciality_code")).strip()
        if (spec, code) in seen:      # same natural key as the AP importer
            continue
        seen.add((spec, code))
        recs.append({
            "speciality_code": spec,
            "speciality_name": cell(r, "speciality_name"),
            "package_code": cell(r, "package_code"),
            "package_name": cell(r, "package_name"),
            "treatment_code": code,
            "treatment_name": cell(r, "treatment_name"),
            "package_amount": money(cell(r, "package_amount")),
            "los_days": money(cell(r, "los_days")),
            "implant_criteria": cell(r, "implant_criteria"),
            "stratification_criteria": cell(r, "stratification_criteria"),
            "icd_code": cell(r, "icd_code"),
        })
    if not recs:
        sys.exit("no rows parsed")

    canon = "\n".join("|".join([r["speciality_code"], r["treatment_code"], r["treatment_name"],
                                str(r["package_amount"])]) for r in recs)
    content_hash = hashlib.sha256(canon.encode()).hexdigest()
    now = int(time.time() * 1000)
    src, svid = new_id("gssrc"), new_id("sv")

    o = [f"-- Generated by scripts/govschemes/ingest_hbp_workbook.py -- DO NOT HAND-EDIT.",
         f"-- Source: {p.name} | sheet={sheet_name!r} | rate_column={a.rate_column!r} tier={a.rate_tier!r}",
         f"-- {len(recs)} procedures, content_hash={content_hash}", ""]
    o.append(f"INSERT OR IGNORE INTO schemes (id, jurisdiction_id, name, authority, status) VALUES "
             f"({sql_str(a.scheme_id)}, {sql_str(a.jurisdiction)}, {sql_str(a.scheme_name)}, {sql_str(a.authority)}, 'active');")
    o.append(f"INSERT INTO sources (id, jurisdiction_id, authority, url, homepage, document_type, "
             f"document_date, retrieved_ts, verification_status, enabled, created_ts) VALUES "
             f"({sql_str(src)}, {sql_str(a.jurisdiction)}, {sql_str(a.authority)}, {sql_str(a.source_url)}, '', "
             f"{sql_str(p.suffix.lstrip('.').lower())}, '', {now}, 'unverified', 1, {now});")
    o.append(f"INSERT INTO scheme_versions (id, scheme_id, version_label, source_id, effective_date, "
             f"content_hash, status, published_ts, created_ts) VALUES ({sql_str(svid)}, {sql_str(a.scheme_id)}, "
             f"{sql_str(a.version_label)}, {sql_str(src)}, '', {sql_str(content_hash)}, 'draft', 0, {now});")
    o.append("")

    cols = ("id, scheme_version_id, speciality_code, speciality_name, package_code, package_name, "
            "treatment_code, treatment_name, package_amount, rate_tier, los_days, implant_criteria, "
            "stratification_criteria, icd_code")
    vals = [f"({sql_str(new_id('pkg'))}, {sql_str(svid)}, {sql_str(r['speciality_code'])}, "
            f"{sql_str(r['speciality_name'])}, {sql_str(r['package_code'])}, {sql_str(r['package_name'])}, "
            f"{sql_str(r['treatment_code'])}, {sql_str(r['treatment_name'])}, {r['package_amount']}, "
            f"{sql_str(a.rate_tier)}, {r['los_days']}, {sql_str(r['implant_criteria'])}, "
            f"{sql_str(r['stratification_criteria'])}, {sql_str(r['icd_code'])})" for r in recs]
    CHUNK = 50   # D1 rejects over-long statements (SQLITE_TOOBIG) - see the AP importer
    for i in range(0, len(vals), CHUNK):
        o.append(f"INSERT INTO packages ({cols}) VALUES\n" + ",\n".join(vals[i:i + CHUNK]) + ";")
    o.append("")
    o.append(f"INSERT INTO crawl_logs (id, ts, source_id, status, detail, rows_in, rows_out) VALUES "
             f"({sql_str(new_id('cl'))}, {now}, {sql_str(src)}, 'new', "
             f"{sql_str('ingest_hbp_workbook.py ' + p.name + ' tier=' + a.rate_tier)}, {len(rows)-hdr_i-1}, {len(recs)});")
    print("\n".join(o))
    print(f"-- {a.jurisdiction}: {len(recs)} procedures from sheet {sheet_name!r} @ {a.rate_tier}", file=sys.stderr)


if __name__ == "__main__":
    main()
