"""Stage 2b — COMPREHENSIVE classification by class-member enumeration.

Inverts the per-drug lookup: for every class in class_taxonomy.json, asks
RxClass for ALL member drugs of that class in a single call. This is what makes
the checker cover *any* drug — not just the app formulary — because every drug
RxNorm knows to be (e.g.) a PDE5 inhibitor, nitrate, NSAID, statin, QT-prolonger
etc. is pulled in and tagged. A few dozen calls classify thousands of drugs.

Writes build/class_members.json: generic(lowercased ingredient name) -> [tags].

Run: python scripts/interactions/fetch_class_members.py
"""
import _lib as L

# How to enumerate members for each RxClass classType (relaSource, rela).
RELA_BY_TYPE = {
    "EPC": [("DAILYMED", "has_EPC")],
    "MOA": [("DAILYMED", "has_MoA"), ("MEDRT", "has_MoA")],
    "PE": [("MEDRT", "has_PE")],
    "CHEM": [("DAILYMED", "has_Chemical_Structure"), ("MEDRT", "has_Chemical_Structure")],
    "ATC": [("ATC", "")],
}


def _class_ids(class_type, class_name):
    d = L.http_json(L.rxnav_url("rxclass/class/byName.json", className=class_name),
                    "classbyname", f"{class_type}|{class_name}")
    out = []
    for c in (((d or {}).get("rxclassMinConceptList") or {}).get("rxclassMinConcept") or []):
        if (c.get("classType") or "").upper() == class_type.upper():
            out.append(c.get("classId"))
    return out


def _members(class_id, relaSource, rela):
    params = {"classId": class_id, "relaSource": relaSource}
    if rela:
        params["rela"] = rela
    key = f"{class_id}_{relaSource}_{rela or 'all'}"
    d = L.http_json(L.rxnav_url("rxclass/classMembers.json", **params), "classmembers", key)
    names = []
    for m in (((d or {}).get("drugMemberGroup") or {}).get("drugMember") or []):
        n = ((m.get("minConcept") or {}).get("name"))
        if n:
            names.append(L.norm(n))
    return names


def run():
    tax = L.curated("class_taxonomy.json")["match"]
    member_tags = {}   # generic -> set(tags)
    per_class = {}     # "TYPE|Name" -> member count
    print(f"fetch_class_members: {len(tax)} taxonomy classes")
    for e in tax:
        ctype, cname, tags = e["classType"].upper(), e["className"], e["tags"]
        ids = _class_ids(ctype, cname)
        names = set()
        for cid in ids:
            for relaSource, rela in RELA_BY_TYPE.get(ctype, [("DAILYMED", "")]):
                names.update(_members(cid, relaSource, rela))
        per_class[f"{ctype}|{cname}"] = len(names)
        for n in names:
            member_tags.setdefault(n, set()).update(tags)
    out = {g: sorted(t) for g, t in member_tags.items()}
    L.save_json(f"{L.BUILD}/class_members.json", out)
    L.save_json(f"{L.BUILD}/class_member_counts.json", per_class)
    print(f"  {len(out)} distinct drugs classified from class membership -> build/class_members.json")
    top = sorted(per_class.items(), key=lambda kv: -kv[1])[:6]
    for k, n in top:
        print(f"    {n:5d}  {k}")
    return out


if __name__ == "__main__":
    run()
