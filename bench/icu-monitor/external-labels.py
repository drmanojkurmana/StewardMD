#!/usr/bin/env python3
"""external-labels.py <drafts.tsv> [--confirmed <case,case,...>]

Writes the drafted displayed values from a labels TSV into fixtures/external/cases/<prefix>-NNN.json.
Default TSV columns: case hr spo2 rr sbp dbp map; a "#cols: ..." header line overrides them (any of hr
spo2 rr sbp dbp map pulse etco2 temp pvc). Values: number (visible), -- (not_visible), ? (ambiguous),
. (unlabelled: the dataset has no box for it; never scored). "#source: art" (or nibp) records that the
displayed pressure is that source, so the ART / NIBP field is scored too; otherwise both are unlabelled.
labelStatus stays "draft" (group external-draft) unless the case is listed in --confirmed (a human
checked it: group external-real).
"""
import sys, os, json

tsv = sys.argv[1]
confirmed = set(sys.argv[sys.argv.index("--confirmed") + 1].split(",")) if "--confirmed" in sys.argv else set()
CASES = os.path.dirname(os.path.abspath(tsv))
prefix = os.path.basename(tsv).split("-drafts")[0]
cols, source = ["hr", "spo2", "rr", "sbp", "dbp", "map"], None
ALL = ["hr", "spo2", "rr", "sbp", "dbp", "map", "pulse", "etco2", "temp", "pvc"]
n = 0
for line in open(tsv):
    if line.startswith("#cols:"):
        cols = line.split(":", 1)[1].split(); continue
    if line.startswith("#source:"):
        source = line.split(":", 1)[1].strip(); continue
    if line.startswith("#confirmed:"):   # human-checked cases recorded in the TSV itself
        confirmed |= set(line.split(":", 1)[1].split()[0].split(",")); continue
    if not line.strip() or line.startswith("#"):
        continue
    body, _, note = line.partition("#")
    parts = body.split()
    cid, vals = parts[0], parts[1:1 + len(cols)]
    path = os.path.join(CASES, f"{prefix}-{cid}.json")
    case = json.load(open(path))
    fields = {}
    for k, v in zip(cols, vals):
        if v == ".":
            fields[k] = {"status": "unlabelled"}
        elif v == "--":
            fields[k] = {"status": "not_visible", "why": "shown as dashes"}
        elif v == "?":
            fields[k] = {"status": "ambiguous", "why": note.strip() or "box unreadable"}
        else:
            fields[k] = {"status": "visible", "value": float(v) if "." in v else int(v)}
    for k in ALL:
        fields.setdefault(k, {"status": "unlabelled"})
    for s in ["art", "nibp"]:
        fields[s] = {"status": "unlabelled"}
    if source in ("art", "nibp"):
        p = [fields[k] for k in ("sbp", "dbp", "map")]
        if p[0]["status"] == "visible" and p[1]["status"] == "visible":
            fields[source] = {"status": "visible", "value": {"sbp": p[0]["value"], "dbp": p[1]["value"], "map": p[2].get("value")}}
            for k in ("sbp", "dbp", "map"):
                if fields[k]["status"] == "visible":
                    fields[k]["source"] = source.upper()
    case["fields"] = fields
    case["labelStatus"] = "confirmed" if cid in confirmed else "draft"
    case["group"] = "external-real" if cid in confirmed else "external-draft"
    if note.strip():
        case["labelNote"] = note.strip()
    json.dump(case, open(path, "w"), indent=2)
    n += 1
print(f"{prefix}: {n} cases labelled ({len(confirmed)} confirmed)")
