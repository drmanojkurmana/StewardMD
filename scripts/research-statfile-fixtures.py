#!/usr/bin/env python3
"""Make the SPSS (.sav, .zsav) and Stata (.dta) test files for the ResearchMD
on-device file reader (research-statfile.js).

Every value here is made up for testing; no patient data. The files are
written by two independent writers: pyreadstat (ReadStat) and pandas
(its own Stata writer), so the JS reader is not only checked against files
from the same library that also reads them in the parity job.

Run once and commit the output:
    python3 scripts/research-statfile-fixtures.py
Writes test/fixtures/research/statfiles/*.sav|.zsav|.dta
Needs: pip install pyreadstat pandas
"""
import datetime as dt
import math
import os

import pandas as pd
import pyreadstat

OUT = os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", "research", "statfiles")
NAN = float("nan")


def base_frame():
    return pd.DataFrame({
        "pid": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
        "sex": [1.0, 2.0, 2.0, 1.0, 9.0, NAN],
        "age_years": [34.5, 61.0, 999.0, 47.25, 0.1, 72.0],
        "hb_gdl": [11.2, 13.85, NAN, 9.0, 950.0, 12.0],
        "smoker": ["y", "n", "n", "u", "y", ""],
        "ward_name": ["General Medicine", "ICU", "Cardiology", "General Medicine", "Nephrology", "ICU"],
        "remarks": ["café au lait spots", "తెలుగు note",
                    "x" * 600, "", "line one", "N/A"],
        "admit_date": [dt.date(2024, 1, 15), dt.date(2023, 12, 31), dt.date(1999, 2, 28),
                       None, dt.date(2026, 11, 27), dt.date(2000, 2, 29)],
        "seen_at": [dt.datetime(2024, 1, 15, 8, 30, 0), dt.datetime(2023, 12, 31, 23, 59, 59), None,
                    dt.datetime(2020, 6, 1, 0, 0, 0), dt.datetime(2026, 11, 27, 12, 5, 7),
                    dt.datetime(1970, 1, 1, 0, 0, 1)],
    })


SAV_LABELS = {
    "pid": "Participant number",
    "sex": "Sex of participant",
    "age_years": "Age (years)",
    "hb_gdl": "Haemoglobin g/dL",
    "smoker": "Current smoker",
    "ward_name": "Ward at admission",
    "remarks": "Free-text remarks",
    "admit_date": "Date of admission",
    "seen_at": "First seen (date and time)",
}
SAV_VALUE_LABELS = {
    "sex": {1: "Male", 2: "Female", 9: "Not recorded"},
    "smoker": {"y": "Yes", "n": "No", "u": "Unknown"},
    "ward_name": {"General Medicine": "Gen Med ward", "ICU": "Intensive care"},
}
SAV_MISSING = {
    "sex": [9],
    "age_years": [{"lo": 900, "hi": 999}],
    "hb_gdl": [{"lo": 900, "hi": 999}, 0],
    "smoker": ["u"],
}


def write_sav_set():
    df = base_frame()
    common = dict(file_label="ResearchMD statfile test", column_labels=SAV_LABELS,
                  variable_value_labels=SAV_VALUE_LABELS, missing_ranges=SAV_MISSING,
                  variable_format={"seen_at": "DATETIME20", "admit_date": "DATE11"})
    pyreadstat.write_sav(df, os.path.join(OUT, "rs_plain.sav"), **common)
    pyreadstat.write_sav(df, os.path.join(OUT, "rs_bytecode.sav"), row_compress=True, **common)
    pyreadstat.write_sav(df, os.path.join(OUT, "rs_zlib.zsav"), compress=True, **common)

    # Many rows so bytecode blocks cross row boundaries and small integers use
    # the one-byte codes; times of day; an all-missing column.
    n = 257
    big = pd.DataFrame({
        "id": [float(i) for i in range(n)],
        "score": [float(i % 7) - 3.0 for i in range(n)],
        "ratio": [(i * 0.37) % 5 for i in range(n)],
        "clock": [dt.time((i * 7) % 24, (i * 13) % 60, (i * 29) % 60) for i in range(n)],
        "empty": [NAN] * n,
        "grp": ["arm A" if i % 3 else "arm B" for i in range(n)],
    })
    pyreadstat.write_sav(big, os.path.join(OUT, "rs_many_bytecode.sav"), row_compress=True,
                         variable_value_labels={"score": {-3: "lowest", 3: "highest"}},
                         variable_format={"clock": "TIME8"})


def write_dta_set():
    df = base_frame()
    df["remarks"] = df["remarks"].str.slice(0, 200)
    labels = dict(SAV_LABELS)
    vvl = {"sex": {1: "Male", 2: "Female", 9: "Not recorded"}}
    for version in (8, 12, 13, 14, 15):
        d = df.copy()
        if version < 14:  # releases before 118 are not UTF-8
            d["remarks"] = [r.encode("latin-1", "replace").decode("latin-1") for r in d["remarks"]]
        pyreadstat.write_dta(d, os.path.join(OUT, "rs_v%d.dta" % version), version=version,
                             file_label="ResearchMD statfile test", column_labels=labels,
                             variable_value_labels=vvl, missing_user_values={"sex": ["a"]},
                             variable_format={"admit_date": "%td", "seen_at": "%tc"})

    # pandas writer: integer storage types, float32, strL, dates.
    pdf = pd.DataFrame({
        "pid": pd.Series([1, 2, 3, 4, 5], dtype="int32"),
        "arm": pd.Series([0, 1, 1, 0, 1], dtype="int8"),
        "dose_mg": pd.Series([2.5, 5.0, 7.3, None, 10.1], dtype="float32"),
        "count": pd.Series([10, 2000, 30000, -5, 7], dtype="int16"),
        "crp": [1.25, None, 300.5, 0.0, 12.0],
        "site": ["Visakhapatnam", "Hyderabad", "Vijayawada", "", "Guntur"],
        "visit": [dt.datetime(2024, 3, 1), dt.datetime(2024, 3, 8), None,
                  dt.datetime(1960, 1, 1), dt.datetime(1959, 12, 31)],
        "stamp": [dt.datetime(2024, 3, 1, 9, 15, 0), None, dt.datetime(2024, 3, 2, 18, 0, 30),
                  dt.datetime(1960, 1, 1, 0, 0, 0), dt.datetime(2001, 9, 9, 1, 46, 40)],
        "notes": ["first visit, all well", "", "long note " * 40, "ok", "follow up"],
    })
    var_labels = {"pid": "Participant", "arm": "Study arm", "dose_mg": "Dose (mg)",
                  "crp": "C-reactive protein mg/L", "site": "Study site", "visit": "Visit date"}
    value_labels = {"arm": {0: "Placebo", 1: "Active"}}
    for version in (114, 117, 118, 119):
        d = pdf.copy()
        kwargs = dict(write_index=False, version=version, variable_labels=var_labels,
                      data_label="pandas writer test", convert_dates={"visit": "td", "stamp": "tc"},
                      value_labels=value_labels)
        if version >= 117:
            kwargs["convert_strl"] = ["notes"]
        else:
            d["notes"] = d["notes"].str.slice(0, 244)
        d.to_stata(os.path.join(OUT, "pd_%d.dta" % version), **kwargs)


def main():
    os.makedirs(OUT, exist_ok=True)
    write_sav_set()
    write_dta_set()
    for name in sorted(os.listdir(OUT)):
        print(name, os.path.getsize(os.path.join(OUT, name)))


if __name__ == "__main__":
    main()
