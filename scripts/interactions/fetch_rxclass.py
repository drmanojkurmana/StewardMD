"""Stage 2 — auto-classify each drug via RxClass.

For every resolved RxCUI (build/rxnorm.json) pulls classes from:
  DAILYMED relas=has_epc         -> FDA Established Pharmacologic Class (cleanest)
  MEDRT   relas=has_moa,has_pe   -> Mechanism of Action / Physiologic Effect
  ATC     (hierarchy membership)
IMPORTANT: MEDRT is queried with explicit relas so it returns only the drug's
OWN classes — unfiltered MEDRT leaks interacts-with (ci_with) relationships and
would mis-tag e.g. nitroglycerin as a PDE5 inhibitor.
Writes build/rxclass.json: generic -> [ {classType, className, classId, source} ].

Run: python scripts/interactions/fetch_rxclass.py
"""
import _lib as L

# (relaSource, relas) pairs to query; relas="" means no filter (safe for ATC/DAILYMED-EPC).
QUERIES = [
    ("DAILYMED", "has_epc"),
    ("DAILYMED", "has_moa"),
    ("MEDRT", "has_moa"),
    ("MEDRT", "has_pe"),
    ("ATC", ""),
]


def _classes_for(rxcui, relaSource, relas):
    params = {"rxcui": rxcui, "relaSource": relaSource}
    if relas:
        params["relas"] = relas
    key = f"{rxcui}_{relaSource}_{relas or 'all'}"
    d = L.http_json(L.rxnav_url("rxclass/class/byRxcui.json", **params), "rxclass", key)
    infos = (((d or {}).get("rxclassDrugInfoList") or {}).get("rxclassDrugInfo")) or []
    out = []
    for c in infos:
        m = c.get("rxclassMinConceptItem") or {}
        if m.get("className"):
            out.append({"classType": m.get("classType"), "className": m.get("className"),
                        "classId": m.get("classId"), "source": relaSource})
    return out


def run():
    rx = L.load_json(f"{L.BUILD}/rxnorm.json")
    out = {}
    print(f"fetch_rxclass: {len(rx)} drugs")
    for g, rec in rx.items():
        rxcui = rec.get("ingredient_rxcui") or rec.get("rxcui")
        classes = []
        if rxcui:
            seen = set()
            for src, relas in QUERIES:
                for c in _classes_for(rxcui, src, relas):
                    k = (c["classType"], c["className"])
                    if k not in seen:
                        seen.add(k)
                        classes.append(c)
        out[g] = classes
    L.save_json(f"{L.BUILD}/rxclass.json", out)
    total = sum(len(v) for v in out.values())
    classified = sum(1 for v in out.values() if v)
    print(f"  {classified}/{len(out)} drugs got >=1 class, {total} class rows -> build/rxclass.json")
    return out


if __name__ == "__main__":
    run()
