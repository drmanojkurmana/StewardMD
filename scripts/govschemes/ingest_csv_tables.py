#!/usr/bin/env python3
"""StewardMD — Government Health Schemes: generic docling CSV tables adapter.

Reads CSV tables extracted by docling (pdf_tables.py) from government package-master PDFs.
Emits SQL matching functions/db/govschemes_schema.sql + functions/db/migrate_govschemes_hbp_fields.sql
as ONE new scheme_version with 50-row INSERT chunking.

SAFETY RULES:
  1. --code-column, --name-column, --rate-column, and --rate-tier are REQUIRED.
     Headers must match exactly; failing loudly if missing - never guess.
  2. Native codes and names are copied byte-for-byte.
  3. Deduplication on (speciality_code or '', treatment_code) within the version.

Usage:
  ingest_csv_tables.py DIR_OR_CSV --jurisdiction <id> --scheme-id <id> \\
    --scheme-name <name> --version-label <label> --rate-tier <tier> \\
    --code-column <col> --name-column <col> --rate-column <col> \\
    [--authority <auth>] [--source-url <url>] ... > out.sql
"""
import sys, os, re, json, time, random, hashlib, argparse, pathlib, csv

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

def norm_str(s):
    return re.sub(r"[\s\-_./]+", "", str(s or "").strip().lower())

def find_col_idx(header, target):
    """Exact match first, then normalized and multi-level (dot-separated) header support."""
    if not target:
        return None, False
    t_norm = norm_str(target)
    
    # 1. Exact string match
    for i, h in enumerate(header):
        if h == target:
            return i, False
            
    # 2. Normalized full string match
    for i, h in enumerate(header):
        if norm_str(h) == t_norm:
            return i, False

    # 3. Docling merged row 1 prefix (e.g. "Package Code.222" where 222 is data row)
    for i, h in enumerate(header):
        if "." in h:
            parts = h.split(".", 1)
            if norm_str(parts[0]) == t_norm:
                # If second part looks like data (e.g. numeric or short code), mark as merged row
                is_data = bool(re.search(r"^\d+$|^[A-Z0-9]{2,10}$", parts[1].strip()))
                return i, is_data

    # 4. Multi-level sub-header (e.g. "Rates for Semi-Private Ward.Non- NABH" or "AB.CD")
    for i, h in enumerate(header):
        if "." in h:
            parts = [norm_str(p) for p in h.split(".")]
            if t_norm in parts:
                return i, False

    # 5. Known docling merged rate header 'NABH Rate Non-NABH Rate'
    if t_norm in ["nabhrate", "nabh"]:
        for i, h in enumerate(header):
            if "nabh" in norm_str(h):
                return i, False
    elif t_norm in ["nonnabhrate", "nonnabh"]:
        matches = [i for i, h in enumerate(header) if "nonnabh" in norm_str(h)]
        if matches:
            # If two columns contain nonnabh (e.g. "NABH Rate Non-NABH Rate" duplicated), pick the second
            return matches[-1], False

    # 6. All significant tokens present (e.g. "Name 2022.Procedure" for "Procedure Name 2022")
    target_tokens = set(re.findall(r"[a-z0-9]+", target.lower()))
    if len(target_tokens) >= 2:
        for i, h in enumerate(header):
            if all(tok in norm_str(h) for tok in target_tokens):
                return i, False
            
    return None, False

def read_table_csv(csv_path, code_col, name_col, rate_col, opt_cols):
    with open(csv_path, newline='', encoding='utf-8', errors='replace') as f:
        reader = list(csv.reader(f))
    if not reader:
        return [], 0, "empty"
    
    header = [c.strip() for c in reader[0]]
    code_idx, code_merged = find_col_idx(header, code_col)
    name_idx, name_merged = find_col_idx(header, name_col)
    rate_idx, rate_merged = find_col_idx(header, rate_col)

    # Check if this table matches required columns
    matched_req = sum(x is not None for x in [code_idx, name_idx, rate_idx])
    if matched_req == 0:
        # Non-procedure table (e.g. cover page, TOC, legend)
        return [], len(reader) - 1, "skipped_no_required_cols"
    if code_idx is None:
        return [], len(reader) - 1, f"skipped_missing_code_column_{code_col}"
    if name_idx is None:
        return [], len(reader) - 1, f"missing_name_column_{name_col}"
    if rate_idx is None:
        return [], len(reader) - 1, f"missing_rate_column_{rate_col}"

    # Map optional columns
    opt_indices = {}
    for field, col_name in opt_cols.items():
        if col_name:
            idx, _ = find_col_idx(header, col_name)
            if idx is not None:
                opt_indices[field] = idx

    rows = []
    # If docling merged row 1 into header, reconstruct row 1
    if code_merged or name_merged or rate_merged:
        reconstructed = []
        for cell in header:
            if "." in cell:
                reconstructed.append(cell.split(".", 1)[1])
            else:
                reconstructed.append("")
        rows.append(reconstructed)

    for r in reader[1:]:
        rows.append(r)

    parsed = []
    for r in rows:
        def get_val(idx):
            return r[idx].strip() if idx is not None and idx < len(r) else ""

        code = get_val(code_idx)
        name = get_val(name_idx)
        if code_idx == name_idx and ":" in code:
            parts = code.split(":", 1)
            code = parts[0].strip()
            name = parts[1].strip()
        if not code or not name:
            continue
        # Filter out repeated header rows embedded in table
        if code == code_col or name == name_col:
            continue

        item = {
            "treatment_code": code,
            "treatment_name": name,
            "package_amount": money(get_val(rate_idx)),
            "speciality_code": get_val(opt_indices.get("speciality_code")),
            "speciality_name": get_val(opt_indices.get("speciality_name")),
            "package_code": get_val(opt_indices.get("package_code")),
            "package_name": get_val(opt_indices.get("package_name")),
            "los_days": money(get_val(opt_indices.get("los_days"))),
            "implant_criteria": get_val(opt_indices.get("implant_criteria")),
            "stratification_criteria": get_val(opt_indices.get("stratification_criteria")),
            "icd_code": get_val(opt_indices.get("icd_code")),
        }
        parsed.append(item)

    return parsed, len(rows), "ok"

def main():
    ap = argparse.ArgumentParser(description="Ingest docling CSV tables into SQLite/D1 SQL")
    ap.add_argument("path", help="Directory containing table_*.csv or single CSV file")
    ap.add_argument("--jurisdiction", required=True)
    ap.add_argument("--scheme-id", required=True)
    ap.add_argument("--scheme-name", required=True)
    ap.add_argument("--authority", default="")
    ap.add_argument("--version-label", required=True)
    ap.add_argument("--rate-tier", required=True, help="tier/ward label stored verbatim on every row")
    ap.add_argument("--code-column", required=True, help="Exact header of the procedure/treatment code column")
    ap.add_argument("--name-column", required=True, help="Exact header of the procedure/treatment name column")
    ap.add_argument("--rate-column", required=True, help="Exact header of the price column to ingest")
    
    # Optional columns
    ap.add_argument("--speciality-code-column", default="")
    ap.add_argument("--speciality-name-column", default="")
    ap.add_argument("--package-code-column", default="")
    ap.add_argument("--package-name-column", default="")
    ap.add_argument("--los-column", default="")
    ap.add_argument("--implant-column", default="")
    ap.add_argument("--stratification-column", default="")
    ap.add_argument("--icd-column", default="")
    ap.add_argument("--source-url", default="")
    a = ap.parse_args()

    p = pathlib.Path(a.path)
    if not p.exists():
        sys.exit(f"Error: path not found: {a.path}")

    csv_files = []
    if p.is_file():
        csv_files = [p]
    else:
        manifest_path = p / "tables.json"
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text())
                csv_files = [p / m["csv"] for m in manifest if (p / m["csv"]).exists()]
            except Exception:
                csv_files = sorted(p.glob("table_*.csv"))
        else:
            csv_files = sorted(p.glob("table_*.csv"))

    if not csv_files:
        sys.exit(f"Error: no CSV files found in {a.path}")

    opt_cols = {
        "speciality_code": a.speciality_code_column,
        "speciality_name": a.speciality_name_column,
        "package_code": a.package_code_column,
        "package_name": a.package_name_column,
        "los_days": a.los_column,
        "implant_criteria": a.implant_column,
        "stratification_criteria": a.stratification_column,
        "icd_code": a.icd_column,
    }

    all_recs = []
    seen = set()
    total_rows_in = 0
    tables_matched = 0
    tables_skipped = 0
    errors = []

    for cf in csv_files:
        recs, rows_in, status = read_table_csv(cf, a.code_column, a.name_column, a.rate_column, opt_cols)
        total_rows_in += rows_in
        if status == "ok":
            tables_matched += 1
            for r in recs:
                key = (r["speciality_code"] or "", r["treatment_code"])
                if key in seen:
                    continue
                seen.add(key)
                all_recs.append(r)
        elif status.startswith("skipped"):
            tables_skipped += 1
        else:
            errors.append(f"{cf.name}: {status}")

    if errors:
        sys.exit(f"Error matching columns across tables:\n" + "\n".join(errors[:10]))

    if not all_recs:
        sys.exit(f"Error: 0 procedures extracted from {len(csv_files)} tables. Tables matched: {tables_matched}, skipped: {tables_skipped}")

    canon = "\n".join("|".join([r["speciality_code"], r["treatment_code"], r["treatment_name"],
                                str(r["package_amount"])]) for r in all_recs)
    content_hash = hashlib.sha256(canon.encode()).hexdigest()
    now = int(time.time() * 1000)
    src, svid = new_id("gssrc"), new_id("sv")

    o = [
        f"-- Generated by scripts/govschemes/ingest_csv_tables.py -- DO NOT HAND-EDIT.",
        f"-- Source: {p.name} | rate_column={a.rate_column!r} tier={a.rate_tier!r}",
        f"-- {len(all_recs)} procedures, content_hash={content_hash}",
        ""
    ]
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
    vals = [
        f"({sql_str(new_id('pkg'))}, {sql_str(svid)}, {sql_str(r['speciality_code'])}, "
        f"{sql_str(r['speciality_name'])}, {sql_str(r['package_code'])}, {sql_str(r['package_name'])}, "
        f"{sql_str(r['treatment_code'])}, {sql_str(r['treatment_name'])}, {r['package_amount']}, "
        f"{sql_str(a.rate_tier)}, {r['los_days']}, {sql_str(r['implant_criteria'])}, "
        f"{sql_str(r['stratification_criteria'])}, {sql_str(r['icd_code'])})"
        for r in all_recs
    ]
    CHUNK = 50   # D1 rejects over-long statements (SQLITE_TOOBIG)
    for i in range(0, len(vals), CHUNK):
        o.append(f"INSERT INTO packages ({cols}) VALUES\n" + ",\n".join(vals[i:i + CHUNK]) + ";")
    o.append("")
    o.append(f"INSERT INTO crawl_logs (id, ts, source_id, status, detail, rows_in, rows_out) VALUES "
             f"({sql_str(new_id('cl'))}, {now}, {sql_str(src)}, 'new', "
             f"{sql_str('ingest_csv_tables.py ' + p.name + ' tier=' + a.rate_tier)}, {total_rows_in}, {len(all_recs)});"
    )

    print("\n".join(o))
    print(f"-- {a.jurisdiction}: {len(all_recs)} procedures from {tables_matched} tables @ {a.rate_tier} (skipped {tables_skipped} non-procedure tables)", file=sys.stderr)

if __name__ == "__main__":
    main()
