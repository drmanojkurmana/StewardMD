"""Stage 3 — openFDA label enrichment (public domain).

For each generic, fetches one openFDA label and harvests: openfda.rxcui,
pharm_class_* (extra classification signal), brand_name (brand aliases), and
the drug_interactions / contraindications / boxed_warning free text (kept as
EVIDENCE/provenance only — never NLP-mined into rules). Writes build/openfda.json.

Run: python scripts/interactions/fetch_openfda.py
"""
import _lib as L

FIELDS_TEXT = ["drug_interactions", "contraindications", "boxed_warning"]
FIELDS_CLASS = ["pharm_class_epc", "pharm_class_moa", "pharm_class_pe", "pharm_class_cs"]


def run():
    rx = L.load_json(f"{L.BUILD}/rxnorm.json")
    out = {}
    print(f"fetch_openfda: {len(rx)} drugs")
    hit = 0
    for g in sorted(rx):
        term = rx[g].get("query") or g
        url = L.openfda_url(search=f'openfda.generic_name:"{term}"', limit=1)
        d = L.http_json(url, "openfda", term, throttle=0.30)
        rec = {"generic": g, "found": False, "pharm_class": [], "brands": [], "evidence": {}}
        results = (d or {}).get("results") or []
        if results and not (d or {}).get("__notfound"):
            r = results[0]
            of = r.get("openfda", {}) or {}
            pc = []
            for f in FIELDS_CLASS:
                pc += of.get(f, []) or []
            rec["found"] = True
            rec["pharm_class"] = sorted(set(pc))
            rec["brands"] = sorted({L.norm(b) for b in (of.get("brand_name") or [])})
            rec["rxcui"] = of.get("rxcui", [])
            for f in FIELDS_TEXT:
                val = r.get(f)
                if val:
                    rec["evidence"][f] = " ".join(val) if isinstance(val, list) else str(val)
            hit += 1
        out[g] = rec
    L.save_json(f"{L.BUILD}/openfda.json", out)
    print(f"  {hit}/{len(out)} labels matched -> build/openfda.json")
    return out


if __name__ == "__main__":
    run()
