"""Stage 1 — normalize the drug universe to RxNorm.

Reads curated/drug_universe.json (dumped from the app) + curated/universe_additions.json,
drops curated_overrides.exclude_generics, and resolves each drug to an RxNorm
RxCUI (ingredient-level where possible) plus brand names. Writes build/rxnorm.json.

Run: python scripts/interactions/fetch_rxnorm.py
"""
import _lib as L


def _drug_list():
    uni = L.curated("drug_universe.json", {"drugs": []})["drugs"]
    add = L.curated("universe_additions.json", {"drugs": []})["drugs"]
    ov = L.curated("curated_overrides.json", {})
    excluded = {L.norm(x) for x in ov.get("exclude_generics", [])}
    merged = {}
    for d in uni:
        g = L.norm(d.get("generic"))
        if g and g not in excluded:
            merged[g] = {"generic": g, "brands": list(d.get("brands", [])), "query": g}
    for d in add:
        g = L.norm(d.get("generic"))
        if not g or g in excluded:
            continue
        e = merged.setdefault(g, {"generic": g, "brands": [], "query": g})
        e["brands"] = sorted(set(e["brands"]) | set(L.norm(b) for b in d.get("brands", [])))
        if d.get("query"):
            e["query"] = d["query"]
    return [merged[k] for k in sorted(merged)]


def _resolve_rxcui(term):
    d = L.http_json(L.rxnav_url("rxcui.json", name=term, search=2), "rxcui", term)
    ids = ((d or {}).get("idGroup") or {}).get("rxnormId") or []
    if ids:
        return ids[0]
    d = L.http_json(L.rxnav_url("approximateTerm.json", term=term, maxEntries=1), "approx", term)
    cands = (((d or {}).get("approximateGroup") or {}).get("candidate")) or []
    return cands[0].get("rxcui") if cands else None


def _ingredient(rxcui):
    """Reduce a concept to its ingredient RxCUI (best class coverage)."""
    d = L.http_json(L.rxnav_url(f"rxcui/{rxcui}/related.json", tty="IN"), "related_in", str(rxcui))
    groups = (((d or {}).get("relatedGroup") or {}).get("conceptGroup")) or []
    for grp in groups:
        if grp.get("tty") == "IN":
            props = grp.get("conceptProperties") or []
            if props:
                return props[0].get("rxcui"), props[0].get("name")
    return rxcui, None


def run():
    drugs = _drug_list()
    out = {}
    print(f"fetch_rxnorm: {len(drugs)} drugs")
    miss = 0
    for d in drugs:
        g, term = d["generic"], d.get("query") or d["generic"]
        rxcui = _resolve_rxcui(term)
        rec = {"generic": g, "query": term, "rxcui": rxcui, "ingredient_rxcui": None,
               "ingredient_name": None, "brands": d["brands"]}
        if rxcui:
            ing_rxcui, ing_name = _ingredient(rxcui)
            rec["ingredient_rxcui"] = ing_rxcui
            rec["ingredient_name"] = ing_name
        else:
            miss += 1
        out[g] = rec
    L.save_json(f"{L.BUILD}/rxnorm.json", out)
    resolved = sum(1 for r in out.values() if r["rxcui"])
    print(f"  resolved {resolved}/{len(drugs)} RxCUIs ({miss} unresolved) -> build/rxnorm.json")
    return out


if __name__ == "__main__":
    run()
