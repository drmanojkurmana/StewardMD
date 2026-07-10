"""Orchestrator — run the full drug-interaction data pipeline.

  fetch_rxnorm -> fetch_rxclass -> fetch_openfda   (cached in build/)
  -> build_classmap -> build_rules -> validate -> emit

By default fetch stages reuse the on-disk cache (build/cache/*), so re-runs are
fast and offline. Pass --no-fetch to skip fetching entirely (build from cache),
or --fetch to force network stages. Fails (exit 1) if validation reports errors.

Run: python scripts/interactions/build_all.py
"""
import os
import sys

import _lib as L
import build_classmap
import build_rules
import emit as emit_mod
import validate as validate_mod


def _need_fetch():
    for f in ("rxnorm.json", "rxclass.json", "class_members.json", "all_epc.json", "openfda.json"):
        if not os.path.exists(os.path.join(L.BUILD, f)):
            return True
    return False


def main(argv):
    do_fetch = "--fetch" in argv or (_need_fetch() and "--no-fetch" not in argv)
    if do_fetch:
        print("== fetch stages (network; cached) ==")
        import fetch_all_epc
        import fetch_class_members
        import fetch_openfda
        import fetch_rxclass
        import fetch_rxnorm
        fetch_rxnorm.run()
        fetch_rxclass.run()
        fetch_class_members.run()
        fetch_all_epc.run()
        fetch_openfda.run()
    else:
        print("== using cached fetch output (build/*.json) ==")

    import build_gold
    build_gold.run()

    print("== classify ==")
    cm = build_classmap.build()
    print(f"  drugClasses={len(cm['drugClasses'])} generics, {len(cm['generics'])} names, "
          f"{len(cm['brands'])} brand aliases")
    if cm["unmapped"]:
        L.save_json(f"{L.BUILD}/unmapped_classes.json", dict(cm["unmapped"]))
        print(f"  {len(cm['unmapped'])} unmapped RxClass classes -> build/unmapped_classes.json "
              f"(review queue; top: {cm['unmapped'][0][0]!r} x{cm['unmapped'][0][1]})")

    print("== merge rules ==")
    rules = build_rules.build()

    print("== validate ==")
    payload = emit_mod.build_payload(cm, rules)
    errors, warnings = validate_mod.validate(payload, rules)
    for w in warnings:
        print("  WARN:", w)
    for e in errors:
        print("  FAIL:", e)
    if errors:
        print(f"\nvalidation FAILED with {len(errors)} error(s) — not emitting.")
        return 1

    print("== emit ==")
    emit_mod.emit(payload)

    # sanity probes (the reported failure case + a legacy anchor)
    dc = payload["drugClasses"]
    for g, want in (("sildenafil", "pde5_inhibitor"), ("nitroglycerin", "nitrate"),
                    ("nifedipine", "dihydropyridine_ccb"), ("warfarin", "anticoagulant")):
        ok = want in dc.get(g, [])
        print(f"  probe {g:16s} has {want:20s} {'OK' if ok else 'MISSING !!'}")
    print(f"\nDONE — {len(warnings)} warning(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
