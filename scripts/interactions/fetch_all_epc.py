"""Stage 2d — FULL EPC breadth (toward comprehensive coverage).

Enumerates EVERY DailyMed Established Pharmacologic Class (~750), then lists all
member drugs of each. For each drug it records a tag:
  * the curated tag(s) if the class is mapped in class_taxonomy.json (so dangerous
    classes stay unified — nsaid, nitrate, qt_prolonging, …), OR
  * a readable slug of the class name otherwise ("epc:<slug>"), so the drug is
    still classified and same-class therapeutic duplication can be detected.
Writes build/all_epc.json: generic -> [tags]  and  build/epc_class_index.json:
slug -> human class name (for duplicate-rule wording).

Run: python scripts/interactions/fetch_all_epc.py
"""
import re
import _lib as L


def _slug(name):
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return "epc:" + s


def _taxonomy_epc_index():
    idx = {}
    for e in L.curated("class_taxonomy.json")["match"]:
        if e["classType"].upper() == "EPC":
            idx[L.norm(e["className"])] = e["tags"]
    return idx


def run():
    tax = _taxonomy_epc_index()
    allc = L.http_json(L.rxnav_url("rxclass/allClasses.json", classTypes="EPC"),
                       "allclasses", "EPC")
    classes = (((allc or {}).get("rxclassMinConceptList") or {}).get("rxclassMinConcept")) or []
    print(f"fetch_all_epc: {len(classes)} EPC classes")
    drug_tags = {}
    slug_names = {}
    for c in classes:
        cid, cname = c.get("classId"), c.get("className")
        if not cid:
            continue
        mapped = tax.get(L.norm(cname))
        tags = mapped if mapped else [_slug(cname)]
        if not mapped:
            slug_names[_slug(cname)] = cname
        d = L.http_json(L.rxnav_url("rxclass/classMembers.json", classId=cid,
                                    relaSource="DAILYMED", rela="has_EPC"),
                        "classmembers", f"{cid}_DAILYMED_has_EPC")
        for m in (((d or {}).get("drugMemberGroup") or {}).get("drugMember") or []):
            n = L.norm(((m.get("minConcept") or {}).get("name")))
            if n:
                s = drug_tags.setdefault(n, set())
                s.update(tags)
    out = {g: sorted(t) for g, t in drug_tags.items()}
    L.save_json(f"{L.BUILD}/all_epc.json", out)
    L.save_json(f"{L.BUILD}/epc_class_index.json", slug_names)
    print(f"  {len(out)} drugs classified across EPC; {len(slug_names)} descriptive slug classes")
    return out


if __name__ == "__main__":
    run()
