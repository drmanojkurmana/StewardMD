"""Stage 4 — build the class map + name resolution tables.

Combines, per generic:
  legacy_drugclasses tags  ∪  RxClass-derived tags  ∪  openFDA pharm_class tags
  ∪  CredibleMeds QT (qt_prolonging)  ∪  curated_overrides.pin_classes
  −  curated_overrides.deny_classes   (curated_overrides.exclude_generics dropped)
Emits an in-memory dict consumed by build_rules/emit:
  { drugClasses:{g:[tags]}, generics:[...], brands:{brand:g}, unmapped:[...] }

Run standalone to preview: python scripts/interactions/build_classmap.py
"""
import re
import _lib as L


def _taxonomy_index():
    tax = L.curated("class_taxonomy.json")["match"]
    idx = {}
    for e in tax:
        idx[(e["classType"].upper(), L.norm(e["className"]))] = e["tags"]
    return idx


_BRACKET = re.compile(r"^(.*?)\s*\[([A-Za-z0-9/ ]+)\]\s*$")
_TYPE_ALIASES = {"MOA": "MOA", "EPC": "EPC", "PE": "PE", "CS": "CHEM", "CHEM": "CHEM", "PK": "PK"}


def _parse_openfda_pharm(s):
    """'HMG-CoA Reductase Inhibitor [EPC]' -> ('EPC', 'hmg-coa reductase inhibitor')."""
    m = _BRACKET.match(s or "")
    if not m:
        return None, L.norm(s)
    name, typ = m.group(1), m.group(2).strip().upper().replace("MOA", "MOA")
    return _TYPE_ALIASES.get(typ, typ), L.norm(name)


def build():
    tax = _taxonomy_index()
    legacy = L.curated("legacy_drugclasses.json")["drugClasses"]
    overrides = L.curated("curated_overrides.json", {})
    pins = {L.norm(k): v for k, v in overrides.get("pin_classes", {}).items()}
    denies = {L.norm(k): set(v) for k, v in overrides.get("deny_classes", {}).items()}
    excluded = {L.norm(x) for x in overrides.get("exclude_generics", [])}
    aliases = {L.norm(k): L.norm(v) for k, v in overrides.get("alias_generics", {}).items()}
    qt = L.curated("crediblemeds_qt.json", {})

    try:
        rxclass = L.load_json(f"{L.BUILD}/rxclass.json")
    except FileNotFoundError:
        rxclass = {}
    try:
        class_members = L.load_json(f"{L.BUILD}/class_members.json")
    except FileNotFoundError:
        class_members = {}
    try:
        gold = L.load_json(f"{L.BUILD}/gold.json")
    except FileNotFoundError:
        gold = {}
    try:
        all_epc = L.load_json(f"{L.BUILD}/all_epc.json")
    except FileNotFoundError:
        all_epc = {}
    try:
        openfda = L.load_json(f"{L.BUILD}/openfda.json")
    except FileNotFoundError:
        openfda = {}
    try:
        rxnorm = L.load_json(f"{L.BUILD}/rxnorm.json")
    except FileNotFoundError:
        rxnorm = {}

    classes = {}   # generic -> set(tags)
    unmapped = {}  # (type,name) -> count

    def add(g, tags):
        classes.setdefault(g, set()).update(tags)

    # 1. legacy tags (verbatim base)
    for g, tags in legacy.items():
        if L.norm(g) not in excluded:
            add(L.norm(g), tags)

    # 1b. COMPREHENSIVE class-member enumeration — every drug RxClass knows to be
    #     in an interaction-relevant class (all PDE5i, nitrates, NSAIDs, statins,
    #     QT-prolongers, …), not just the app formulary. This is the bulk of coverage.
    for g, tags in class_members.items():
        if L.norm(g) not in excluded:
            add(L.norm(g), tags)

    # 2. RxClass-derived
    for g, rows in rxclass.items():
        if L.norm(g) in excluded:
            continue
        for c in rows:
            key = ((c.get("classType") or "").upper(), L.norm(c.get("className")))
            if key in tax:
                add(L.norm(g), tax[key])
            else:
                unmapped[f"{key[0]}|{c.get('className')}"] = unmapped.get(f"{key[0]}|{c.get('className')}", 0) + 1

    # 3. openFDA pharm_class-derived
    for g, rec in openfda.items():
        if L.norm(g) in excluded:
            continue
        for s in rec.get("pharm_class", []):
            typ, name = _parse_openfda_pharm(s)
            key = ((typ or "").upper(), name)
            if key in tax:
                add(L.norm(g), tax[key])

    # 3aa. FULL EPC breadth — curated tag where the class is mapped, descriptive
    #      "epc:<slug>" tag otherwise, so essentially every prescribable drug is
    #      classified (and same-class duplication is detectable).
    for g, tags in all_epc.items():
        if L.norm(g) not in excluded:
            add(L.norm(g), tags)

    # 3b. Gold composition DB — apply safe keyword-derived tags (RxClass wins where both).
    for g, rec in gold.items():
        if L.norm(g) not in excluded:
            for t in rec.get("tags", []):
                add(L.norm(g), [t])

    # 4. CredibleMeds QT membership
    for cat in ("known_risk", "possible_risk", "conditional_risk"):
        for g in qt.get(cat, []):
            if L.norm(g) not in excluded:
                add(L.norm(g), ["qt_prolonging"])

    # 5. curated pins (union) then denies (remove)
    for g, tags in pins.items():
        if g not in excluded:
            add(g, tags)
    for g, deny in denies.items():
        if g in classes:
            classes[g] -= deny

    # finalize drugClasses (sorted, drop empties only if truly no tag)
    drug_classes = {g: sorted(t) for g, t in classes.items() if t}

    # generics: every classified generic + alias canonical targets + EVERY gold
    # composition (so any drug in the app DB is RECOGNISED and screened — an
    # unclassified one still gets duplicate detection instead of being skipped).
    generic_set = set(drug_classes.keys())
    for canon in aliases.values():
        generic_set.add(canon)
    for g in gold:
        if L.norm(g) not in excluded:
            generic_set.add(L.norm(g))

    # brands: brand/synonym -> canonical generic (only when target is a known generic)
    brands = {}

    def set_brand(b, g):
        b, g = L.norm(b), L.norm(g)
        if b and g and b != g and g in generic_set:
            brands.setdefault(b, g)

    # from the dumped universe + additions
    for src in ("drug_universe.json", "universe_additions.json"):
        data = L.curated(src, {"drugs": []})
        for d in data.get("drugs", []):
            g = L.norm(d.get("generic"))
            for b in d.get("brands", []):
                set_brand(b, g)
    # from openFDA brand_name
    for g, rec in openfda.items():
        for b in rec.get("brands", []):
            set_brand(b, g)
    # explicit aliases (highest intent) — override
    for a, canon in aliases.items():
        if canon in generic_set:
            brands[a] = canon

    return {
        "drugClasses": drug_classes,
        "generics": sorted(generic_set),
        "brands": dict(sorted(brands.items())),
        "unmapped": sorted(unmapped.items(), key=lambda kv: -kv[1]),
    }


if __name__ == "__main__":
    r = build()
    print(f"drugClasses: {len(r['drugClasses'])} generics")
    print(f"generics:    {len(r['generics'])}")
    print(f"brands:      {len(r['brands'])}")
    print(f"unmapped classes (top 15): ")
    for k, n in r["unmapped"][:15]:
        print(f"   {n:4d}  {k}")
    for probe in ["sildenafil", "nitroglycerin", "nifedipine", "warfarin"]:
        print(f"   {probe:16s} -> {r['drugClasses'].get(probe)}")
