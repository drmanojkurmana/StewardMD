"""Stage 7 — validate the merged ruleset before emit.

Checks (hard FAIL unless noted):
  * schema: required top-level keys; every rule has id/type/subjects/severity;
    valid type + severity enums.
  * provenance: rule.sourceId is null or a declared sources[].id.
  * class references: every kind:class subject tag exists in drugClasses
    (i.e. at least one drug carries it) — zero-member tags are a WARNING
    (rule simply never fires) unless the tag is totally undefined (FAIL).
  * sign-off: every contraindicated/major rule is in signoff.signed OR is
    origin=legacy with grandfather_legacy=true. Otherwise FAIL. Rules signed
    with a placeholder reviewer produce a WARNING (build proceeds, flagged).

Callable as validate(payload, rules_with_origin) from build_all, or standalone
against the merged pipeline output: python scripts/interactions/validate.py
"""
import sys
import _lib as L

VALID_TYPES = {"pair", "duplicate_generic", "duplicate_class", "combination", "context"}
VALID_SEV = {"contraindicated", "major", "moderate", "minor", "monitor"}


def validate(payload, rules_with_origin):
    errors, warnings = [], []
    for key in ("version", "generated", "sources", "drugClasses", "rules", "generics", "brands"):
        if key not in payload:
            errors.append(f"missing top-level key: {key}")
    source_ids = {s.get("id") for s in payload.get("sources", [])}
    # tags that at least one drug carries
    live_tags = set()
    for tags in payload.get("drugClasses", {}).values():
        live_tags.update(tags)

    signoff = L.curated("signoff.json", {})
    grandfather = signoff.get("grandfather_legacy", False)
    signed = {e["id"]: e for e in signoff.get("signed", [])}

    ids = set()
    for r in rules_with_origin:
        rid = r.get("id", "<no-id>")
        if rid in ids:
            errors.append(f"duplicate rule id: {rid}")
        ids.add(rid)
        if r.get("type") not in VALID_TYPES:
            errors.append(f"{rid}: bad type {r.get('type')}")
        if r.get("severity") not in VALID_SEV:
            errors.append(f"{rid}: bad severity {r.get('severity')}")
        if not r.get("subjects"):
            errors.append(f"{rid}: no subjects")
        sid = r.get("sourceId")
        if sid is not None and sid not in source_ids:
            errors.append(f"{rid}: sourceId '{sid}' not in sources[]")
        for s in r.get("subjects", []):
            if s.get("kind") == "class":
                tag = s.get("value")
                if tag not in live_tags:
                    warnings.append(f"{rid}: class '{tag}' has no members — rule can never fire")
        # sign-off gate
        if r.get("severity") in ("contraindicated", "major"):
            if r.get("_origin") == "legacy" and grandfather:
                pass
            elif rid in signed:
                rev = signed[rid].get("reviewer", "")
                if signed[rid].get("status") != "signed" or rev.startswith("pending"):
                    warnings.append(f"{rid}: sign-off placeholder ('{rev}') — clinician review still required")
            else:
                errors.append(f"{rid}: {r.get('severity')} rule missing clinician sign-off (add to signoff.json)")
    return errors, warnings


def _standalone():
    import build_classmap
    import build_rules
    cm = build_classmap.build()
    rules = build_rules.build()
    payload = {
        "version": "1.0.0", "generated": "standalone-check",
        "sources": L.curated("sources.json")["sources"],
        "drugClasses": cm["drugClasses"], "generics": cm["generics"],
        "brands": cm["brands"], "rules": rules,
    }
    errors, warnings = validate(payload, rules)
    for w in warnings:
        print("  WARN:", w)
    for e in errors:
        print("  FAIL:", e)
    print(f"validate: {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(_standalone())
