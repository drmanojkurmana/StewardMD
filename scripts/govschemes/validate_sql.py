#!/usr/bin/env python3
"""StewardMD — Validate generated govschemes SQL files against in-memory SQLite."""
import sqlite3
import pathlib
import sys
import glob

def validate_file(sql_path):
    p = pathlib.Path(sql_path)
    if not p.exists():
        print(f"File not found: {sql_path}", file=sys.stderr)
        return False

    db = sqlite3.connect(":memory:")
    
    # Pre-seed schema
    schema_sql = pathlib.Path("functions/db/govschemes_schema.sql").read_text()
    db.executescript(schema_sql)
    
    # Run additive migration
    migrate_sql = pathlib.Path("functions/db/migrate_govschemes_hbp_fields.sql").read_text()
    db.executescript(migrate_sql)

    # Load target SQL
    content = p.read_text()
    try:
        db.executescript(content)
    except Exception as e:
        print(f"FAIL {p.name}: SQLite execution error: {e}", file=sys.stderr)
        return False

    # Check row count
    cur = db.cursor()
    cur.execute("SELECT count(*) FROM packages")
    total_packages = cur.fetchone()[0]

    if total_packages == 0:
        print(f"FAIL {p.name}: 0 packages loaded!", file=sys.stderr)
        return False

    # Check zero-rate count
    cur.execute("SELECT count(*) FROM packages WHERE package_amount = 0")
    zero_packages = cur.fetchone()[0]
    zero_pct = (zero_packages / total_packages) * 100.0

    # Sample row
    cur.execute("SELECT treatment_code, treatment_name, package_amount, rate_tier FROM packages WHERE package_amount > 0 LIMIT 1")
    sample = cur.fetchone()
    if not sample:
        cur.execute("SELECT treatment_code, treatment_name, package_amount, rate_tier FROM packages LIMIT 1")
        sample = cur.fetchone()

    code, name, amt, tier = sample if sample else ("?", "?", 0, "?")

    # Duplicate check on (speciality_code, treatment_code) within the scheme_version
    cur.execute("""
        SELECT speciality_code, treatment_code, count(*)
        FROM packages
        GROUP BY scheme_version_id, speciality_code, treatment_code
        HAVING count(*) > 1
    """)
    dups = cur.fetchall()
    if dups:
        print(f"FAIL {p.name}: {len(dups)} duplicate keys found! (e.g. {dups[0]})", file=sys.stderr)
        return False

    # Check crawl_logs and scheme_versions
    cur.execute("SELECT count(*) FROM schemes")
    n_schemes = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM scheme_versions")
    n_versions = cur.fetchone()[0]

    status = "OK"
    if zero_pct > 5.0:
        status = f"WARN (zero rate {zero_pct:.1f}% > 5%)"

    print(f"[{status}] {p.stem}: {total_packages} rows (zero-rate: {zero_packages} / {zero_pct:.1f}%), tier: {tier!r}, sample: {code} -> {name[:40]} -> ₹{amt}")
    return True

def main():
    if len(sys.argv) > 1:
        targets = sys.argv[1:]
    else:
        targets = sorted(glob.glob("data/govschemes/sql/*.sql"))

    all_ok = True
    for t in targets:
        ok = validate_file(t)
        if not ok:
            all_ok = False

    sys.exit(0 if all_ok else 1)

if __name__ == "__main__":
    main()
