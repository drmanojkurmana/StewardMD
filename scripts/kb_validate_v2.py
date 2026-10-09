#!/usr/bin/env python3
"""Validate KB schema v2 keys (flowcharts, valueTables, figures, citations).

Usage: python3 scripts/kb_validate_v2.py <file.json> [...]
Exits non-zero if any file breaks a v2 rule. Files without v2 keys pass.
"""
import json
import sys


def check_flowchart(fc, errs):
    nodes = {n["id"]: n for n in fc.get("nodes", [])}
    if len(nodes) != len(fc.get("nodes", [])):
        errs.append(f"flowchart {fc.get('id')}: duplicate node id")
    if fc.get("start") not in nodes:
        errs.append(f"flowchart {fc.get('id')}: start node missing")
    out = {nid: [] for nid in nodes}
    for e in fc.get("edges", []):
        if e["from"] not in nodes or e["to"] not in nodes:
            errs.append(f"flowchart {fc.get('id')}: edge {e['from']}->{e['to']} has unknown endpoint")
            continue
        if not e.get("label"):
            errs.append(f"flowchart {fc.get('id')}: edge {e['from']}->{e['to']} unlabelled")
        out[e["from"]].append(e)
    for nid, n in nodes.items():
        if n.get("type") == "decision" and len(out[nid]) < 2:
            errs.append(f"flowchart {fc.get('id')}: decision {nid} has <2 outgoing edges")
        if n.get("type") == "outcome" and out[nid]:
            errs.append(f"flowchart {fc.get('id')}: outcome {nid} has outgoing edges")
        if not n.get("cite"):
            errs.append(f"flowchart {fc.get('id')}: node {nid} has no cite")


def check_value_table(vt, errs):
    for row in vt.get("rows", []):
        if not row.get("cite"):
            errs.append(f"valueTable {vt.get('id')}: row '{row.get('parameter')}' has no cite")
        for cell in row.get("cells", []):
            has_num = "op" in cell or "range" in cell
            if has_num and "value" not in cell and "range" not in cell:
                errs.append(f"valueTable {vt.get('id')}: numeric cell without value")
            if "needs-source" in cell.get("text", "") and has_num:
                errs.append(f"valueTable {vt.get('id')}: needs-source cell carries a number")


def check_figure(fig, errs):
    if not fig.get("cite"):
        errs.append(f"figure {fig.get('id')}: no cite")
    if fig.get("type") == "svg-spec" and ("src" in fig or "image" in json.dumps(fig).lower()):
        errs.append(f"figure {fig.get('id')}: svg-spec must not reference an image")
    if fig.get("type") == "photo" and (not fig.get("src") or not fig.get("credit")):
        errs.append(f"figure {fig.get('id')}: photo needs src and credit")


def validate(path):
    errs = []
    with open(path) as fh:
        d = json.load(fh)
    cites = {c["id"] for c in d.get("citations", [])}
    for fc in d.get("flowcharts", []):
        check_flowchart(fc, errs)
    for vt in d.get("valueTables", []):
        check_value_table(vt, errs)
    for fig in d.get("figures", []):
        check_figure(fig, errs)
    for ref in [x.get("cite") for x in d.get("flowcharts", []) + d.get("valueTables", []) + d.get("figures", [])]:
        if ref and ref not in cites:
            errs.append(f"cite '{ref}' not in citations")
    review = d.get("review") or {}
    if review.get("clinicianApproved") is True and review.get("status") != "approved":
        errs.append("clinicianApproved true without status approved")
    return errs


def main(paths):
    failed = 0
    for p in paths:
        try:
            errs = validate(p)
        except (OSError, json.JSONDecodeError) as exc:
            errs = [f"cannot read: {exc}"]
        status = "FAIL" if errs else "ok"
        print(f"{status} {p}")
        for e in errs:
            print(f"   - {e}")
        failed += bool(errs)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
