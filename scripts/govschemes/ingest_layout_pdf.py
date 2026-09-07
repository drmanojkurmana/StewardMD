#!/usr/bin/env python3
"""StewardMD — Government Health Schemes: pdftotext -layout adapter for headerless-continuation
HBP PDFs (docling fails on these because column headers print only on page 1; pdftotext -layout
preserves column x-position on every page without needing headers).

Emits SQL in the exact shape of ingest_hbp_workbook.py (same tables, 50-row chunks, dedupe on
(speciality_code or '', treatment_code), content_hash, crawl_logs row) - read that script first.

SAFETY (same two rules ingest_hbp_workbook.py won't bend):
  1. --rate-column-index and --rate-tier are REQUIRED, never guessed. HBP PDFs carry several
     rupee columns (NRP + Tier X/Y/Z). --rate-column-index selects which one, 0-based, by
     position among the NUMERIC tokens found after the procedure code on its own text line
     (text tokens like "No change" in between are skipped, not counted) - inspect the
     pdftotext -layout output yourself to pick it. --rate-tier is stored verbatim.
  2. treatment_code is copied through byte-for-byte from the PDF text, never altered.

WHY THIS IS NOT A ONE-LINE REGEX (the reason a plain "code + trailing numbers" regex fails):
pdftotext -layout renders each table CELL at its own vertical text position. A short cell
(a 2-letter speciality code) sits on the procedure-code row; a TALL cell (the wrapped
"Procedure Name" criteria text, or a long speciality name like "Burns Management") is centered
across the row-block it spans and prints on ITS OWN separate lines, some of which land BEFORE
the code line and some AFTER, interleaved with unrelated short noise lines (the wrapped
speciality name). And the Procedure Name column sits AFTER the code in Central/UP masters but
BEFORE the code in Haryana's - column order is not uniform across states. So this parses in
two passes per file:
  pass 1: find every code line, record the left-edge column position of its inline text
          fragment (if any) -> name_col_min, the Procedure-Name column's x-position.
  pass 2: state machine - lines with x-position >= name_col_min are treated as Procedure-Name
          continuation (appended to whichever record is "open": leading buffer before a code
          line, trailing append after one, reset by blank lines); shorter-indent lines
          (speciality-name wrap fragments, page headers) are dropped, never guessed into a field.
  post:   package_name is only trusted when it's IDENTICAL across every procedure sharing the
          same package prefix (treatment_code minus its trailing letter) - a real package name
          repeats verbatim per sibling procedure; a leaked Procedure-Name fragment (Haryana's
          column order) differs row to row and loses the majority vote, so it's left blank
          rather than shown as a name. speciality_name is not attempted (unreliable inline
          presence varies by state) - left blank, same "don't guess" call.

Usage:
  ingest_layout_pdf.py FILE --jurisdiction central --scheme-id central-pmjay-hbp \\
    --scheme-name "Ayushman Bharat PM-JAY (HBP 2022)" --authority "National Health Authority" \\
    --version-label "HBP 2022" --rate-column-index 3 --rate-tier "Tier1(X)" \\
    --source-url "https://..." > out.sql
"""
import sys, re, time, random, hashlib, subprocess, argparse, pathlib

CODE_RE = re.compile(r'^[A-Z]{2}[0-9]{3}[A-Z]$')       # treatment_code, e.g. BM001A - trailing
                                                          # letter REQUIRED (package_code has none)
PKGCODE_RE = re.compile(r'^[A-Z]{2}[0-9]{3}$')          # package_code, e.g. BM001
SPEC_RE = re.compile(r'^[A-Z]{2,3}$')                   # speciality_code, e.g. BM, MP
NUM_RE = re.compile(r'^[0-9]+(\.[0-9]+)?$')             # rate cols are mostly whole rupees but
                                                          # a few (e.g. per-coil embolization
                                                          # pricing) publish one decimal place


def is_num_token(text):
    """Haryana's "Existing Procedure Price" column prints comma thousands-separators
    ("2,000", "30,800") that the other rate columns never use - strip and re-check."""
    return bool(NUM_RE.match(text.replace(",", "")))


def to_amount(text):
    return int(round(float(text.replace(",", ""))))
HEADER_NOISE = ("Annexure", "Differential price", "SL NO", "Specialty Code", "Package Code",
                 "Procedure Name", "AB PMJAY", "AB PM ", "AB PM-JAY", "National Reference",
                 "Stratification Criteria", "Implant mapped", "Package Master", "HBP 2022",
                 "HBP 2.2", "HBP-2022", "Existing Procedure", "Status with present")


def sql_str(s):
    return "'" + str(s if s is not None else "").replace("'", "''") + "'"


def new_id(prefix):
    return f"{prefix}{int(time.time()*1000):x}{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))}"


def split_cols(line):
    """[(text, start_offset), ...] - columns are separated by 2+ spaces in -layout output;
    a column's own text may contain single spaces ("Thermal burns"), so split on the gap, not
    on every space."""
    cols, offset = [], 0
    for i, part in enumerate(re.split(r'(\s{2,})', line)):
        if i % 2 == 0 and part.strip():
            cols.append((part.strip(), offset + (len(part) - len(part.lstrip()))))
        offset += len(part)
    return cols


def is_header_noise(line):
    s = line.strip()
    if not s:
        return True
    if s.isdigit() and len(s) <= 4:      # stray page number
        return True
    return any(k in line for k in HEADER_NOISE)


def find_name_col_min(lines):
    """Pass 1: the Procedure-Name column's left x-position, from code lines that carry an
    inline text fragment before their first numeric token (Central/UP layout). Haryana's
    layout puts no such fragment inline, so this list can be empty there - caller falls back
    to a wide-open threshold (0) in that case, which is safe because Haryana's noise lines
    (speciality name) are filtered by HEADER_NOISE / blank-line accounting instead."""
    offsets = []
    for line in lines:
        if is_header_noise(line):
            continue
        cols = split_cols(line)
        for i, (text, off) in enumerate(cols):
            if CODE_RE.match(text):
                after = cols[i + 1:]
                if after and not is_num_token(after[0][0]):
                    offsets.append(after[0][1])
                break
    if not offsets:
        return 0
    offsets.sort()
    return offsets[max(0, len(offsets) // 20)]  # 5th percentile, tolerant of stragglers


def parse_records(lines, name_col_min, rate_column_index):
    """Pass 2: state machine over the pdftotext -layout lines. Returns (records, skipped_count)."""
    records = []
    leading_buffer = []
    current = None            # dict, still open to receive trailing continuation text
    mode = "leading"
    skipped = 0

    for line in lines:
        if not line.strip():
            mode = "leading"
            continue
        if is_header_noise(line):
            continue
        cols = split_cols(line)
        code_i = next((i for i, (t, _) in enumerate(cols) if CODE_RE.match(t)), None)

        if code_i is None:
            frag, off = " ".join(c[0] for c in cols), cols[0][1] if cols else 0
            if off < name_col_min - 3:
                continue    # noise: wrapped speciality-name fragment, not procedure-name text
            if mode == "trailing" and current is not None:
                current["treatment_name"] = (current["treatment_name"] + " " + frag).strip()
            else:
                leading_buffer.append(frag)
            continue

        treatment_code = cols[code_i][0]
        before, after = cols[:code_i], cols[code_i + 1:]

        speciality_code = next((t for t, _ in before if SPEC_RE.match(t)), "")
        pkgcode_i = next((i for i in range(len(before) - 1, -1, -1) if PKGCODE_RE.match(before[i][0])), None)
        package_code = before[pkgcode_i][0] if pkgcode_i is not None else ""
        name_candidate = before[-1][0] if before and not is_num_token(before[-1][0]) else ""

        inline_parts, numeric_tokens = [], []
        for text, _ in after:
            if is_num_token(text):
                numeric_tokens.append(to_amount(text))
            elif not numeric_tokens:
                inline_parts.append(text)

        if len(numeric_tokens) <= rate_column_index or numeric_tokens[rate_column_index] == 0:
            skipped += 1
            continue   # anomalous/garbled row, or the target column landed on a stray "0" inside
                        # jumbled free text (e.g. "Ventilator) - 9350 ICU ... Routine Ward - 2300")
                        # rather than a real rate - never emit an amount we're not confident in

        rec = {
            "speciality_code": speciality_code,
            "package_code": package_code,
            "package_name_candidate": name_candidate,
            "treatment_code": treatment_code,
            "treatment_name": " ".join(leading_buffer + inline_parts).strip(),
            "package_amount": numeric_tokens[rate_column_index],
        }
        records.append(rec)
        leading_buffer = []
        current = rec
        mode = "trailing"

    return records, skipped


def resolve_package_names(records):
    """package_name is only trusted when the candidate is IDENTICAL across every procedure
    sharing the same package prefix (treatment_code minus its trailing letter) - see module
    docstring. Mutates records in place."""
    from collections import Counter
    groups = {}
    for r in records:
        groups.setdefault(r["treatment_code"][:-1], []).append(r)
    for prefix, group in groups.items():
        counts = Counter(r["package_name_candidate"] for r in group if r["package_name_candidate"])
        if not counts:
            continue
        name, n = counts.most_common(1)[0]
        if n * 2 >= len(group):     # majority
            for r in group:
                r["package_name"] = name
    for r in records:
        r.setdefault("package_name", "")
        del r["package_name_candidate"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--jurisdiction", required=True)
    ap.add_argument("--scheme-id", required=True)
    ap.add_argument("--scheme-name", required=True)
    ap.add_argument("--authority", default="")
    ap.add_argument("--version-label", required=True)
    ap.add_argument("--rate-column-index", required=True, type=int,
                     help="0-based index into the NUMERIC tokens found after the procedure code")
    ap.add_argument("--rate-tier", required=True, help="tier/ward label stored verbatim on every row")
    ap.add_argument("--source-url", default="")
    a = ap.parse_args()

    p = pathlib.Path(a.file)
    text = subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, check=True, text=True).stdout
    lines = text.split("\n")

    name_col_min = find_name_col_min(lines)
    raw_records, skipped = parse_records(lines, name_col_min, a.rate_column_index)
    resolve_package_names(raw_records)

    recs, seen = [], set()
    for r in raw_records:
        key = (r["speciality_code"] or "", r["treatment_code"])
        if key in seen:
            continue
        seen.add(key)
        recs.append(r)
    if not recs:
        sys.exit("no rows parsed")

    canon = "\n".join("|".join([r["speciality_code"], r["treatment_code"], r["treatment_name"],
                                str(r["package_amount"])]) for r in recs)
    content_hash = hashlib.sha256(canon.encode()).hexdigest()
    now = int(time.time() * 1000)
    src, svid = new_id("gssrc"), new_id("sv")

    o = [f"-- Generated by scripts/govschemes/ingest_layout_pdf.py -- DO NOT HAND-EDIT.",
         f"-- Source: {p.name} | rate_column_index={a.rate_column_index} tier={a.rate_tier!r}",
         f"-- {len(recs)} procedures ({skipped} rows skipped as unparseable), content_hash={content_hash}",
         f"-- package_name/speciality_name are best-effort from PDF layout reconstruction; may be "
         f"blank where not confidently recovered. treatment_code/package_amount/rate_tier are exact.",
         ""]
    o.append(f"INSERT OR IGNORE INTO schemes (id, jurisdiction_id, name, authority, status) VALUES "
             f"({sql_str(a.scheme_id)}, {sql_str(a.jurisdiction)}, {sql_str(a.scheme_name)}, {sql_str(a.authority)}, 'active');")
    o.append(f"INSERT INTO sources (id, jurisdiction_id, authority, url, homepage, document_type, "
             f"document_date, retrieved_ts, verification_status, enabled, created_ts) VALUES "
             f"({sql_str(src)}, {sql_str(a.jurisdiction)}, {sql_str(a.authority)}, {sql_str(a.source_url)}, '', "
             f"'pdf', '', {now}, 'unverified', 1, {now});")
    o.append(f"INSERT INTO scheme_versions (id, scheme_id, version_label, source_id, effective_date, "
             f"content_hash, status, published_ts, created_ts) VALUES ({sql_str(svid)}, {sql_str(a.scheme_id)}, "
             f"{sql_str(a.version_label)}, {sql_str(src)}, '', {sql_str(content_hash)}, 'draft', 0, {now});")
    o.append("")

    cols = ("id, scheme_version_id, speciality_code, speciality_name, package_code, package_name, "
            "treatment_code, treatment_name, package_amount, rate_tier, los_days, implant_criteria, "
            "stratification_criteria, icd_code")
    vals = [f"({sql_str(new_id('pkg'))}, {sql_str(svid)}, {sql_str(r['speciality_code'])}, "
            f"{sql_str('')}, {sql_str(r['package_code'])}, {sql_str(r['package_name'])}, "
            f"{sql_str(r['treatment_code'])}, {sql_str(r['treatment_name'])}, {r['package_amount']}, "
            f"{sql_str(a.rate_tier)}, 0, {sql_str('')}, {sql_str('')}, {sql_str('')})" for r in recs]
    CHUNK = 50   # D1 rejects over-long statements (SQLITE_TOOBIG) - see ingest_hbp_workbook.py
    for i in range(0, len(vals), CHUNK):
        o.append(f"INSERT INTO packages ({cols}) VALUES\n" + ",\n".join(vals[i:i + CHUNK]) + ";")
    o.append("")
    o.append(f"INSERT INTO crawl_logs (id, ts, source_id, status, detail, rows_in, rows_out) VALUES "
             f"({sql_str(new_id('cl'))}, {now}, {sql_str(src)}, 'new', "
             f"{sql_str('ingest_layout_pdf.py ' + p.name + ' tier=' + a.rate_tier)}, {len(lines)}, {len(recs)});")
    print("\n".join(o))
    print(f"-- {a.jurisdiction}: {len(recs)} procedures ({skipped} skipped) @ {a.rate_tier}", file=sys.stderr)


if __name__ == "__main__":
    main()
