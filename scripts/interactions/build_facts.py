"""Stage 5 — normalize open interaction FACTS into rules.

Currently the ONC High-Priority DDI list and CredibleMeds QT categories are
carried as curated seeds: the ONC-derived pairwise rules already live verbatim
in legacy_rules.json (migrated), and CredibleMeds QT membership is applied in
build_classmap (pins qt_prolonging, which the QT mechanism rules act on). This
stage is the seam for future structured fact sources; today it optionally
attaches openFDA label text as `evidence` provenance to matching rules and
otherwise returns no new rules.

Run standalone: python scripts/interactions/build_facts.py
"""
import _lib as L


def build():
    onc = L.curated("onc_hpddi.json", {"rules": []})
    rules = list(onc.get("rules", []))
    for r in rules:
        r.setdefault("evidence", "established")
        r.setdefault("reviewDate", "2026-07-10")
        r.setdefault("doseTimingSeparation", False)
        r.setdefault("specialistReview", False)
    return {"rules": rules}


if __name__ == "__main__":
    print(f"facts rules: {len(build()['rules'])}")
