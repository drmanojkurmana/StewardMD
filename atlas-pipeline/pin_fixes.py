#!/usr/bin/env python3
"""Apply the reviewed pin decisions in pin_fixes.tsv to the shipped atlas.json files.

Every row was decided by LOOKING at a rendered crop of the pin (pin_scan.py renders them),
not by a threshold. Rule: remove when the right label is not certain (a missing pin beats a
wrong one); relabel only when certain. Rows match a pin EXACTLY (module, slice, structure, x, y),
so the script is idempotent: a row whose pin is already gone is reported, not re-applied.
Images are never touched.

Row format (tab-separated): module  slice  structure  x  y  action  reason
  action = remove | relabel:<structure-id>

Usage: atlas-pipeline/.venv/bin/python atlas-pipeline/pin_fixes.py [--write]
Re-run build.py and a module loses these fixes; re-apply with this script afterwards.
"""
import argparse
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)


def load_rows(path=os.path.join(_HERE, "pin_fixes.tsv")):
    rows = []
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        if not line.strip() or line.startswith("#"):
            continue
        c = line.rstrip("\n").split("\t")
        if len(c) != 7:
            raise SystemExit("pin_fixes.tsv line %d: expected 7 tab-separated fields" % n)
        rows.append({"m": c[0], "i": int(c[1]), "s": c[2], "x": float(c[3]), "y": float(c[4]),
                     "action": c[5], "reason": c[6]})
    return rows


def apply(rows, write=False):
    by_mod = {}
    for r in rows:
        by_mod.setdefault(r["m"], []).append(r)
    applied = already = 0
    for mid, rs in sorted(by_mod.items()):
        p = os.path.join(_REPO, "atlas", mid, "atlas.json")
        a = json.load(open(p, encoding="utf-8"))
        for r in rs:
            sl = a["slices"][r["i"] - 1]
            hit = [k for k, q in enumerate(sl["pins"]) if q["s"] == r["s"] and q["x"] == r["x"] and q["y"] == r["y"]]
            if len(hit) > 1:
                raise SystemExit("%s #%d: %d identical %s pins at %s,%s" % (mid, r["i"], len(hit), r["s"], r["x"], r["y"]))
            if not hit:
                done = r["action"].startswith("relabel:") and any(
                    q["s"] == r["action"][8:] and q["x"] == r["x"] and q["y"] == r["y"] for q in sl["pins"])
                if r["action"] == "remove" or done:
                    already += 1
                    continue
                raise SystemExit("%s #%d: no %s pin at %s,%s" % (mid, r["i"], r["s"], r["x"], r["y"]))
            if r["action"] == "remove":
                del sl["pins"][hit[0]]
            elif r["action"].startswith("relabel:"):
                sid = r["action"][8:]
                if sid not in a["structures"]:
                    raise SystemExit("%s: relabel target %s is not a structure of the module" % (mid, sid))
                sl["pins"][hit[0]]["s"] = sid
            else:
                raise SystemExit("unknown action %r" % r["action"])
            applied += 1
        used = {q["s"] for s in a["slices"] for q in s["pins"]}
        orphans = [k for k in a["structures"] if k not in used and not any(
            v.get("parent") == k for v in a["structures"].values())]
        if orphans:
            print("  note %s: structures now without pins: %s" % (mid, ", ".join(orphans)))
        if write:
            with open(p, "w", encoding="utf-8") as fh:
                json.dump(a, fh, indent=1, ensure_ascii=False)
    print("%d pin fixes applied, %d already in place, %d rows" % (applied, already, len(rows)))
    return applied


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    apply(load_rows(), a.write)
    return 0


if __name__ == "__main__":
    sys.exit(main())
