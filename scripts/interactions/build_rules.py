"""Stage 6 — merge + dedup all rules.

Sources merged, in order: legacy_rules.json (verbatim, origin=legacy) →
mechanism_rules.json (origin=mechanism) → build_facts (origin=facts).
Dedup key = (type, frozenset of subject "kind:value"). On collision the
highest-severity rule wins and provenance/evidence is preserved; a note is
printed. Each rule is tagged with an internal `_origin` used by validate.py and
STRIPPED by emit.py so it never reaches the runtime asset. Output is sorted for
stable, reviewable diffs.
"""
import re

import build_facts
import _lib as L

SEV_RANK = {"contraindicated": 5, "major": 4, "moderate": 3, "minor": 2, "monitor": 1}

# EPC classes where "two of the same class" is NOT a meaningful therapeutic
# duplication to flag (avoids alert fatigue). Substring match on the class name.
_DUP_SKIP = re.compile(
    r"vaccine|allergen|toxoid|immune globulin|antibody|antitoxin|diagnostic|contrast|"
    r"radioactive|imaging|topical|ophthalmic|otic|dermatologic|emollient|lubricant|"
    r"sunscreen|tissue|cell therapy|gene therapy|vector|scaffold|graft|dressing|"
    r"nutrient|amino acid|electrolyte|mineral|vitamin|dietary|irrigant|solution|"
    r"local anesthetic|anesthetic|dye|barrier|device|bulk-forming|standardized",
    re.I,
)


def _auto_duplicate_rules(curated_dup_tags):
    """Low-severity 'monitor' duplicate_class rules for systemic EPC classes with
    >=2 members, skipping noise classes and any tag already covered by a curated
    duplicate rule. Makes same-class therapeutic duplication broadly detectable."""
    try:
        all_epc = L.load_json(f"{L.BUILD}/all_epc.json")
        names = L.load_json(f"{L.BUILD}/epc_class_index.json")
    except FileNotFoundError:
        return []
    counts = {}
    for tags in all_epc.values():
        for t in tags:
            if t.startswith("epc:"):
                counts[t] = counts.get(t, 0) + 1
    rules = []
    for slug, n in sorted(counts.items()):
        if n < 2 or slug in curated_dup_tags:
            continue
        cname = names.get(slug, slug)
        if _DUP_SKIP.search(cname):
            continue
        rules.append({
            "id": "dup-" + slug.replace("epc:", ""),
            "type": "duplicate_class",
            "subjects": [{"kind": "class", "value": slug}],
            "severity": "monitor",
            "mechanism": "Two or more medicines from the same pharmacologic class (" + cname + ").",
            "effect": "Possible therapeutic duplication — additive effect and adverse-effect risk without added benefit.",
            "action": "Confirm the overlap is intended (e.g. cross-titration); otherwise consolidate to a single agent.",
            "monitoring": "Review the indication for each same-class medicine.",
            "sourceId": "rxnorm-rxclass",
            "evidence": "class-based",
            "reviewDate": "2026-07-10",
            "doseTimingSeparation": False,
            "specialistReview": False,
            "_origin": "auto_dup",
        })
    return rules


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

    # Auto duplicate_class rules for the broad EPC slug classes (skip tags a
    # curated duplicate rule already covers).
    curated_dup_tags = {s.get("value") for r in (legacy + mech)
                        if r.get("type") == "duplicate_class"
                        for s in r.get("subjects", [])}
    for r in _auto_duplicate_rules(curated_dup_tags):
        tagged.append(r)

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
