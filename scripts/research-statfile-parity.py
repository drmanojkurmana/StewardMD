#!/usr/bin/env python3
"""Read every SPSS and Stata test file with pyreadstat and write what it found
to test/fixtures/research/parity-statfile.json, for
test/research-statfile-parity.test.mjs to compare with the app's on-device
reader (research-statfile.js).

pyreadstat is only a checker here, run in CI. The app never sends these files
anywhere; it reads them on the phone.

Run: python3 scripts/research-statfile-parity.py
Needs: pip install pyreadstat pandas
"""
import datetime as dt
import json
import math
import os

import pandas as pd
import pyreadstat

ROOT = os.path.join(os.path.dirname(__file__), "..")
IN_DIR = os.path.join(ROOT, "test", "fixtures", "research", "statfiles")
OUT = os.path.join(ROOT, "test", "fixtures", "research", "parity-statfile.json")


def key(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def cell(v):
    if v is None or (pd.isna(v) if not isinstance(v, (str, bytes)) else False):
        return None
    if isinstance(v, float):
        return None if math.isnan(v) else v
    if isinstance(v, dt.datetime):
        s = v.strftime("%Y-%m-%d %H:%M:%S")
        if v.microsecond:
            s += ".%03d" % round(v.microsecond / 1000)
        return s
    if isinstance(v, dt.date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, dt.time):
        s = v.strftime("%H:%M:%S")
        if v.microsecond:
            s += ".%03d" % round(v.microsecond / 1000)
        return s
    if hasattr(v, "item"):
        return cell(v.item())
    if isinstance(v, int):
        return v
    return str(v)


def missing_of(meta, name):
    out = {"values": [], "range": None}
    for m in (meta.missing_ranges or {}).get(name, []):
        lo, hi = m["lo"], m["hi"]
        if lo == hi:
            out["values"].append(lo)
        else:
            out["range"] = [lo, hi]
    return out


def read_one(path):
    if path.endswith(".dta"):
        df, meta = pyreadstat.read_dta(path)
    else:
        df, meta = pyreadstat.read_sav(path)
        # missing_ranges is only filled when user-missing values are kept.
        _, meta_um = pyreadstat.read_sav(path, metadataonly=True, user_missing=True)
        meta.missing_ranges = meta_um.missing_ranges
    names = list(meta.column_names)
    labels = list(meta.column_labels)
    rows = []
    for rec in df.itertuples(index=False, name=None):
        rows.append([cell(v) for v in rec])
    vvl = {}
    for var, table in (meta.variable_value_labels or {}).items():
        vvl[var] = {key(k): v for k, v in table.items()}
    return {
        "columns": names,
        "labels": [l or "" for l in labels],
        "valueLabels": vvl,
        "missing": {n: missing_of(meta, n) for n in names} if not path.endswith(".dta") else {},
        "fileLabel": meta.file_label or "",
        "rows": rows,
    }


def main():
    files = sorted(f for f in os.listdir(IN_DIR) if f.endswith((".sav", ".zsav", ".dta")))
    out = {"generator": "pyreadstat " + pyreadstat.__version__, "files": {}}
    for f in files:
        out["files"][f] = read_one(os.path.join(IN_DIR, f))
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, allow_nan=False)
    print("wrote", OUT, "files:", len(files))


if __name__ == "__main__":
    main()
