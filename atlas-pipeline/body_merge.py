#!/usr/bin/env python3
"""Add the whole-body living-CT surfaces (body3d.py -> pack3d.mjs live --prefix body-
--json body.json) to atlas/3d/manifest.json as the THIRD 3D source ("body", part flag 2).

WHY a merge and not bp3d_import.py: that importer rebuilds the reference body from the Human
Atlas checkout, which a session without it cannot do, and the reference and torso data must not
move. This touches only what belongs to the whole body: it strips any earlier body data first
(so it is idempotent), appends parts/chunks at the end, adds canon[cid].body (+ sided), the
three ct-live-body-* plane sets, the source row, and regenerates the CT links with
bp3d_import.catalog_links() + mark_plane_links() (the same code --relink runs). It then proves
that everything else in the manifest is unchanged.

A structure the reference body has no row for yet (bp3d-map.json _pending_3d: thyroid, carotid,
humerus, ...) gets a canon entry of kind "live" carrying only body parts, so the 3D layer can
show it on the whole body without claiming a BodyParts3D mesh.

Usage: .venv/bin/python body_merge.py --base 2293 [--write]
"""
import argparse
import copy
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
OUT = os.path.join(_REPO, "atlas", "3d")
SRC = 2
SOURCE_ROW = {"id": "body", "name": "Whole body CT", "short": "Whole body",
              "desc": "Organ, vessel, muscle and bone surfaces from ONE living-patient CT, skull vertex to mid-thigh "
                      "(TotalSegmentator dataset subject s1045, expert masks, CC BY 4.0), the same scan as the "
                      "whole-body slice modules", "frame": "body"}
LIVE_NOTE = ("Living-CT surface only: no BodyParts3D reference row has been chosen for this structure yet "
             "(atlas-pipeline/bp3d-map.json _pending_3d).")


def strip_body(m):
    """The manifest as it was before any body merge (works on a fresh or an already-merged one)."""
    m = copy.deepcopy(m)
    keep = [i for i, p in enumerate(m["parts"]) if (p[10] if len(p) > 10 else 0) != SRC]
    if keep != list(range(len(keep))):
        sys.exit("body parts are not at the end of the parts list")
    m["parts"] = [m["parts"][i] for i in keep]
    m["chunks"] = [c for c in m["chunks"] if c.get("src") != SRC]
    for cid in list(m["canon"]):
        e = m["canon"][cid]
        if e.get("kind") == "live":
            del m["canon"][cid]
            continue
        e.pop("body", None)
        for side in ("left", "right"):
            if side in e:
                if e[side].get("body_only"):
                    del e[side]                      # created by a merge for a side only the body has
                else:
                    e[side].pop("body", None)
    for mid in [k for k in m["planes"] if k.startswith("ct-live-body-")]:
        del m["planes"][mid]
    m["sources"] = [s for s in m["sources"] if s["id"] != "body"]
    m.pop("body", None)
    m["stats"].pop("body_parts", None)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", type=int, required=True, help="the --base pack3d.mjs baked into the vertex stream")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    from bp3d_import import catalog_links, mark_plane_links

    path = os.path.join(OUT, "manifest.json")
    cur = json.load(open(path, encoding="utf-8"))
    m = strip_body(cur)
    before = copy.deepcopy(m)
    body = json.load(open(os.path.join(OUT, "body.json")))
    onto = json.load(open(os.path.join(_HERE, "ontology.json")))["structures"]
    lab = json.load(open(os.path.join(_HERE, "labels", "ct-live-body-axial.json")))
    if len(m["parts"]) != a.base:
        sys.exit("manifest has %d non-body parts but the chunks were packed with --base %d" % (len(m["parts"]), a.base))

    sys_ix = {s["id"]: i for i, s in enumerate(m["systems"])}
    regions = m["regions"]
    chunk_base = len(m["chunks"])
    for c in body["chunks"]:
        m["chunks"].append(dict(c, src=SRC))
    new_canon = []
    for j, bp in enumerate(body["parts"]):
        gi = a.base + j
        cid = bp["canon"]
        if cid and cid not in onto:
            sys.exit("%s maps to unknown canonical %s" % (bp["id"], cid))
        if cid and cid not in m["canon"]:
            o = onto[cid]
            sid = cid.replace("_", "-").lower()
            m["canon"][cid] = {"kind": "live", "fma": None, "note": LIVE_NOTE, "name": o["display_name"],
                               "region": o["region"],
                               "definition": (lab["structures"].get(sid) or {}).get("definition")}
            new_canon.append(cid)
        e = m["canon"].get(cid) if cid else None
        fma = (e.get("fma") or "") if e else ""
        if e and bp.get("side") and e.get(bp["side"]) and e[bp["side"]].get("fma"):
            fma = e[bp["side"]]["fma"]
        reg = regions.index(bp["region"]) if bp["region"] in regions else regions.index("BODY")
        m["parts"].append([bp["id"], bp["name"], fma, sys_ix[bp["system"]], reg, chunk_base + bp["chunk"],
                           bp["iStart"], bp["iCount"], bp["bounds"], cid, SRC, bp.get("side")])
        if e is not None:
            e.setdefault("body", []).append(gi)
            if bp.get("side"):
                e.setdefault(bp["side"], {"fma": None, "parts": [], "body_only": True}).setdefault("body", []).append(gi)
    m["planes"].update(body["planes"])
    m["sources"].append(dict(SOURCE_ROW, modules=sorted(body["planes"])))
    m["links"] = mark_plane_links(catalog_links(_REPO), m["planes"])
    m["body"] = {"frame": body["frame"], "source": body["source"], "stats": body["stats"]}
    m["stats"]["body_parts"] = len(body["parts"])

    # nothing outside the body may have moved (links are regenerated from the catalog, so the
    # only change allowed there is new rows for the new modules)
    chk = strip_body(m)
    for k in before:
        if k == "links":
            continue
        if chk[k] != before[k]:
            sys.exit("merge changed %r outside the whole body" % k)
    old_rows = {(cid, r["m"]) for cid, rows in before["links"].items() for r in rows}
    new_rows = {(cid, r["m"]) for cid, rows in m["links"].items() for r in rows}
    gone = old_rows - new_rows
    if gone:
        sys.exit("links lost rows: %s" % sorted(gone)[:5])
    added = sorted({r[1] for r in new_rows - old_rows})
    print("parts %d (+%d body)  chunks %d (+%d)  new live-only canon %s  link rows added for %s" % (
        len(m["parts"]), len(body["parts"]), len(m["chunks"]), len(body["chunks"]), new_canon, added))
    if not a.write:
        print("checked; nothing written (pass --write)")
        return 0
    open(path, "w", encoding="utf-8").write(json.dumps(m, separators=(",", ":"), ensure_ascii=False))
    ipath = os.path.join(OUT, "index.json")
    idx = json.load(open(ipath))
    idx = {k: v for k, v in idx.items() if v != "live"}
    for cid in new_canon:
        idx[cid] = "live"
    open(ipath, "w").write(json.dumps(idx, separators=(",", ":")))
    print("wrote", path, "and index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
