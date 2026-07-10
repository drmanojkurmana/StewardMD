"""Stage 6 — merge + dedup all rules.

Sources merged, in order: legacy_rules.json (verbatim, origin=legacy) →
mechanism_rules.json (origin=mechanism) → build_facts (origin=facts).
Dedup key = (type, frozenset of subject "kind:value"). On collision the
highest-severity rule wins and provenance/evidence is preserved; a note is
printed. Each rule is tagged with an internal `_origin` used by validate.py and
STRIPPED by emit.py so it never reaches the runtime asset. Output is sorted for
stable, reviewable diffs.
"""
import build_facts
import _lib as L

SEV_RANK = {"contraindicated": 5, "major": 4, "moderate": 3, "minor": 2, "monitor": 1}


def _subject_key(r):
    subs = r.get("subjects", [])
    return (r.get("type"), frozenset(f"{s.get('kind')}:{L.norm(s.get('value'))}" for s in subs))


def build():
    legacy = L.curated("legacy_rules.json")["rules"]
    mech = L.curated("mechanism_rules.json")["rules"]
    facts = build_facts.build()["rules"]

    tagged = []
    for r in legacy:
        r = dict(r); r["_origin"] = "legacy"; tagged.append(r)
    for r in mech:
        r = dict(r); r["_origin"] = "mechanism"; tagged.append(r)
    for r in facts:
        r = dict(r); r["_origin"] = "facts"; tagged.append(r)

    by_key = {}
    collisions = 0
    for r in tagged:
        k = _subject_key(r)
        if k not in by_key:
            by_key[k] = r
        else:
            collisions += 1
            cur = by_key[k]
            if SEV_RANK.get(r.get("severity"), 0) > SEV_RANK.get(cur.get("severity"), 0):
                by_key[k] = r
    rules = list(by_key.values())
    # stable order: severity desc, then id
    rules.sort(key=lambda r: (-SEV_RANK.get(r.get("severity"), 0), r.get("id", "")))
    if collisions:
        print(f"  build_rules: {collisions} duplicate subject-set(s) collapsed (highest severity kept)")
    return rules


if __name__ == "__main__":
    rs = build()
    from collections import Counter
    print(f"merged rules: {len(rs)}")
    print("by severity:", dict(Counter(r["severity"] for r in rs)))
    print("by origin:  ", dict(Counter(r["_origin"] for r in rs)))
