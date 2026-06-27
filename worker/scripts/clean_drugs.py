#!/usr/bin/env python3
"""
StewardMD — Phase 2 drug-database cleaning & local SQLite build.

Reads the raw Indian branded-drug CSV, cleans + de-duplicates to unique
(brand, composition) rows, and builds a LOCAL SQLite database with an FTS5
search index — matching worker/schema.sql.

This is LOCAL ONLY: it writes nothing to Cloudflare D1 and ships nothing to the
client. Output .sqlite lives under worker/data/ (gitignored).

Usage:
    python3 clean_drugs.py [SRC_CSV] [OUT_SQLITE]
Defaults:
    SRC_CSV    = ~/Downloads/Stewardmd/stewardmd_drug_database.csv
    OUT_SQLITE = worker/data/stewardmd-drugs.sqlite
"""
import csv, os, sqlite3, sys, time

csv.field_size_limit(10**7)

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))            # worker/scripts
WORKER = os.path.dirname(HERE)                               # worker
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HOME, "Downloads", "Stewardmd", "stewardmd_drug_database.csv")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(WORKER, "data", "stewardmd-drugs.sqlite")

# CSV header -> drugs column
COLS = {
    "Brand": "brand", "Composition": "composition", "Therapeutic Class": "class",
    "Chemical Class": "chem_class", "Action Class": "action_class",
    "Manufacturer": "manufacturer", "Dosage Form": "form", "Pack": "pack",
    "MRP_INR": "mrp", "Uses": "uses", "Side Effects": "side_effects",
    "Substitute Brands": "substitutes", "Habit Forming": "habit_forming",
    "Discontinued": "discontinued",
}

def norm(s):
    return (s or "").strip()

def to_float(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None

def to_bool_int(s):
    return 1 if norm(s).lower() in ("true", "1", "yes") else 0

def main():
    if not os.path.exists(SRC):
        sys.exit(f"ERROR: source CSV not found: {SRC}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    t0 = time.time()
    seen = {}            # (brand_lc, comp_lc) -> row dict
    raw = 0; skipped_no_brand = 0

    with open(SRC, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for r in reader:
            raw += 1
            brand = norm(r.get("Brand"))
            comp = norm(r.get("Composition"))
            if not brand:
                skipped_no_brand += 1
                continue
            key = (brand.lower(), comp.lower())
            mrp = to_float(r.get("MRP_INR"))
            if key in seen:
                # collapse pack variants: keep the lowest non-null MRP, count variants
                ex = seen[key]
                ex["variants"] += 1
                if mrp is not None and (ex["mrp"] is None or mrp < ex["mrp"]):
                    ex["mrp"] = mrp
                # prefer a non-discontinued representative
                if ex["discontinued"] and not to_bool_int(r.get("Discontinued")):
                    ex["discontinued"] = 0
                continue
            seen[key] = {
                "brand": brand, "composition": comp,
                "class": norm(r.get("Therapeutic Class")),
                "chem_class": norm(r.get("Chemical Class")),
                "action_class": norm(r.get("Action Class")),
                "manufacturer": norm(r.get("Manufacturer")),
                "form": norm(r.get("Dosage Form")),
                "pack": norm(r.get("Pack")),
                "mrp": mrp,
                "uses": norm(r.get("Uses")),
                "side_effects": norm(r.get("Side Effects")),
                "substitutes": norm(r.get("Substitute Brands")),
                "habit_forming": norm(r.get("Habit Forming")),
                "discontinued": to_bool_int(r.get("Discontinued")),
                "variants": 1,
            }

    rows = list(seen.values())
    print(f"raw rows read      : {raw:,}")
    print(f"skipped (no brand) : {skipped_no_brand:,}")
    print(f"unique brand/comp  : {len(rows):,}")

    db = sqlite3.connect(OUT)
    db.executescript("""
        PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
        CREATE TABLE drugs (
          id INTEGER PRIMARY KEY, brand TEXT NOT NULL, composition TEXT, class TEXT,
          chem_class TEXT, action_class TEXT, manufacturer TEXT, form TEXT, pack TEXT,
          mrp REAL, uses TEXT, side_effects TEXT, substitutes TEXT, habit_forming TEXT,
          discontinued INTEGER DEFAULT 0
        );
        CREATE INDEX idx_drugs_brand ON drugs(brand);
        CREATE INDEX idx_drugs_comp  ON drugs(composition);
        CREATE VIRTUAL TABLE drugs_fts USING fts5(
          brand, composition, class, content='drugs', content_rowid='id',
          tokenize='unicode61 remove_diacritics 2'
        );
    """)
    cols = ["brand","composition","class","chem_class","action_class","manufacturer",
            "form","pack","mrp","uses","side_effects","substitutes","habit_forming","discontinued"]
    placeholders = ",".join("?" * len(cols))
    db.executemany(
        f"INSERT INTO drugs ({','.join(cols)}) VALUES ({placeholders})",
        [tuple(r[c] for c in cols) for r in rows],
    )
    # build FTS from the content table, then add sync triggers + optimize
    db.executescript("""
        INSERT INTO drugs_fts(drugs_fts) VALUES('rebuild');
        CREATE TRIGGER drugs_ai AFTER INSERT ON drugs BEGIN
          INSERT INTO drugs_fts(rowid, brand, composition, class)
          VALUES (new.id, new.brand, new.composition, new.class);
        END;
        CREATE TRIGGER drugs_ad AFTER DELETE ON drugs BEGIN
          INSERT INTO drugs_fts(drugs_fts, rowid, brand, composition, class)
          VALUES ('delete', old.id, old.brand, old.composition, old.class);
        END;
        CREATE TRIGGER drugs_au AFTER UPDATE ON drugs BEGIN
          INSERT INTO drugs_fts(drugs_fts, rowid, brand, composition, class)
          VALUES ('delete', old.id, old.brand, old.composition, old.class);
          INSERT INTO drugs_fts(rowid, brand, composition, class)
          VALUES (new.id, new.brand, new.composition, new.class);
        END;
        INSERT INTO drugs_fts(drugs_fts) VALUES('optimize');
    """)
    db.commit()

    # ---- validation ----
    def one(q, *a):
        return db.execute(q, a).fetchone()
    total = one("SELECT count(*) FROM drugs")[0]
    distinct_brands = one("SELECT count(DISTINCT brand) FROM drugs")[0]
    disc = one("SELECT count(*) FROM drugs WHERE discontinued=1")[0]
    print(f"\nrows in drugs      : {total:,}")
    print(f"distinct brands    : {distinct_brands:,}")
    print(f"discontinued flag  : {disc:,}")

    print("\n--- sample FTS searches (top 5 by rank) ---")
    for term in ["augmentin", "pantop", "dolo", "azithral", "monocef", "clexane"]:
        res = db.execute(
            "SELECT d.brand, d.composition, d.class FROM drugs_fts f "
            "JOIN drugs d ON d.id=f.rowid WHERE drugs_fts MATCH ? ORDER BY rank LIMIT 5",
            (term + "*",),
        ).fetchall()
        print(f"  '{term}' -> " + (" | ".join(f"{b} [{(c or '')[:28]}]" for b, c, _ in res) or "(none)"))

    db.close()
    size_mb = os.path.getsize(OUT) / 1e6
    print(f"\nSQLite file        : {OUT}")
    print(f"file size          : {size_mb:.1f} MB")
    print(f"elapsed            : {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
