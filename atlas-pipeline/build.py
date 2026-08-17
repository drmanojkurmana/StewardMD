#!/usr/bin/env python3
"""Assemble atlas.json and validate it against the VIEWER's own schema.

validate_with_viewer runs atlas.js's validateAtlas through node rather than
re-implementing it here. There is exactly one schema, it lives in the code that
consumes it, and drift between the two subsystems is therefore impossible.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

from check_sources import require_clear, load_sources
from labels import load_mapping, structure_for_label, structures_block, categories_block
from orient import to_display, resize_to_square_pixels
from pins import pins_for_mask, to_percent
from slices import extract_slices, DISPLAY_H

# ponytail: flat pixel threshold. Make it area-relative only if small structures
# actually go missing during the QA pass.
MIN_AREA_PX = 30

_NODE_VALIDATE = r"""
const {readFileSync} = require('fs');
const SRC = readFileSync(process.argv[1], 'utf8');
const mod = {exports:{}};
new Function('window','document','module',SRC)(
  {addEventListener(){}},
  {addEventListener(){},getElementById:()=>null,createElement:()=>({classList:{add(){},remove(){}}})},
  mod
);
const errs = mod.exports.validateAtlas(JSON.parse(readFileSync(process.argv[2],'utf8')));
process.stdout.write(JSON.stringify(errs));
"""


def validate_with_viewer(atlas_dict, repo_root):
    """Return the viewer's own list of schema errors ([] means valid)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(atlas_dict, fh)
        tmp = fh.name
    try:
        res = subprocess.run(
            ["node", "-e", _NODE_VALIDATE, os.path.join(repo_root, "atlas.js"), tmp],
            capture_output=True, text=True)
        if res.returncode != 0:
            return ["validator failed to run: " + (res.stderr or "").strip()]
        return json.loads(res.stdout or "[]")
    finally:
        os.unlink(tmp)


def assemble(module_meta, slice_stubs, pins_by_slice, mapping):
    """Build the atlas.json body.

    Structures that never receive a pin are dropped, except where they are needed as a
    hierarchy ancestor of one that did — so the file carries no dead weight but the
    hierarchy tab still resolves.
    """
    strs_all = structures_block(mapping)
    used = set()
    for pins in pins_by_slice.values():
        for p in pins:
            used.add(p["s"])

    frontier = list(used)
    while frontier:
        sid = frontier.pop()
        parent = (strs_all.get(sid) or {}).get("parent")
        if parent and parent not in used:
            used.add(parent)
            frontier.append(parent)

    structures = {}
    for sid in sorted(used):
        src = dict(strs_all.get(sid) or {})
        src.pop("hand_authored", None)          # pipeline bookkeeping, not schema
        structures[sid] = src

    cats_used = set(s.get("category") for s in structures.values() if s.get("category"))
    categories = {k: v for k, v in categories_block(mapping).items() if k in cats_used}

    reg = load_sources()
    return {
        "id": module_meta["id"],
        "provenance": {
            "images": module_meta.get("source_label", ""),
            "licence": reg.get(module_meta.get("source", "visible-human"), {}).get("licence", ""),
            "definitions": "Gray's Anatomy (1918)",
            "geometry": mapping.get("_geometry", ""),
            "clearedOn": module_meta.get("cleared_on", ""),
        },
        "categories": categories,
        "structures": structures,
        "slices": [
            {"i": s["i"], "img": s["img"], "aspect": s["aspect"],
             "pins": pins_by_slice.get(s["i"], [])}
            for s in slice_stubs
        ],
    }


def upsert_module(catalog, module_meta):
    """Add or replace a module row, keeping the catalog sorted and credits intact."""
    row = {k: module_meta[k] for k in ("id", "title", "subtitle", "region", "modality", "slices", "thumb")
           if k in module_meta}
    mods = [m for m in catalog.get("modules", []) if m["id"] != row["id"]]
    mods.append(row)
    mods.sort(key=lambda m: (m.get("region", ""), m.get("title", "")))
    out = dict(catalog)
    out["version"] = catalog.get("version", 1)
    out["credits"] = catalog.get("credits", [])
    out["modules"] = mods
    return out


def pins_from_segmentation(seg_path, slice_stubs, mapping, spacing_disp):
    """Per slice, per model label, one pin per connected component.

    The mask goes through the SAME to_display + resize_to_square_pixels as the image in
    slices.py, which is what keeps pins on their structures.
    """
    import nibabel as nib
    seg = np.asanyarray(nib.load(seg_path).dataobj)

    lut = {}
    for k, v in (mapping.get("model_values") or {}).items():
        lut[int(k)] = v

    out = {}
    for stub in slice_stubs:
        plane = seg[:, :, stub["_z"]]
        pins = []
        for val in np.unique(plane):
            if val == 0:
                continue
            model_label = lut.get(int(val), str(int(val)))
            sid = structure_for_label(mapping, model_label)
            if not sid:
                continue
            m = resize_to_square_pixels(to_display(plane == val), spacing_disp, DISPLAY_H)
            for (r, c) in pins_for_mask(m, MIN_AREA_PX):
                x, y = to_percent(r, c, m.shape)
                pins.append({"s": sid, "x": x, "y": y})
        out[stub["i"]] = pins
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a RadioAnatome module.")
    ap.add_argument("--module", required=True)
    ap.add_argument("--volume", help="input NIfTI (omit with --dry-run)")
    ap.add_argument("--seg", help="segmentation NIfTI from a CLEAR model")
    ap.add_argument("--slices", type=int, default=24)
    ap.add_argument("--window", default=None,
                    help="brain|soft-tissue|lung|bone|mediastinum (CT only; omit for MR)")
    ap.add_argument("--source", default="visible-human")
    ap.add_argument("--title", default=None)
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--region", default="Brain")
    ap.add_argument("--modality", default="MRI")
    ap.add_argument("--print-seg-values", metavar="NIFTI",
                    help="print the integer label values in a segmentation and exit")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    if a.print_seg_values:
        import nibabel as nib
        vals = sorted(int(v) for v in np.unique(np.asanyarray(nib.load(a.print_seg_values).dataobj)) if v)
        print(json.dumps(vals))
        return 0

    require_clear(a.source)                    # gate BEFORE any data is touched
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mapping = load_mapping(a.module)
    out_dir = os.path.join(repo, "atlas", a.module)

    if a.dry_run:
        print("gate ok (%s CLEAR); mapping ok (%d structures); would write %s"
              % (a.source, len(structures_block(mapping)), out_dir))
        return 0

    if not a.volume:
        print("--volume is required unless --dry-run", file=sys.stderr)
        return 2

    import nibabel as nib
    zooms = nib.load(a.volume).header.get_zooms()[:3]
    spacing_disp = (zooms[1], zooms[0])

    stubs = extract_slices(a.volume, out_dir, a.module, a.slices, a.window, a.source)
    pins = pins_from_segmentation(a.seg, stubs, mapping, spacing_disp) if a.seg else {}

    reg = load_sources()
    meta = {
        "id": a.module,
        "title": a.title or a.module,
        "subtitle": a.subtitle,
        "region": a.region,
        "modality": a.modality,
        "source": a.source,
        "source_label": reg.get(a.source, {}).get("credit", ""),
        "cleared_on": "2026-08-17",
    }
    atlas = assemble(meta, stubs, pins, mapping)

    errs = validate_with_viewer(atlas, repo)
    if errs:
        print("SCHEMA ERRORS (nothing written):", file=sys.stderr)
        for e in errs[:20]:
            print("  -", e, file=sys.stderr)
        return 1

    with open(os.path.join(out_dir, "atlas.json"), "w", encoding="utf-8") as fh:
        json.dump(atlas, fh, indent=1, ensure_ascii=False)

    cat_path = os.path.join(repo, "atlas", "modules.json")
    catalog = json.load(open(cat_path, encoding="utf-8")) if os.path.exists(cat_path) else {"version": 1, "credits": [], "modules": []}
    mid = len(stubs) // 2 + 1
    meta["slices"] = len(stubs)
    meta["thumb"] = "/atlas/%s/t/%03d.webp" % (a.module, mid)
    catalog = upsert_module(catalog, meta)

    # The credit line the info screen renders. Only added when the source needs one.
    credit = reg.get(a.source, {}).get("credit")
    if credit and credit not in catalog["credits"]:
        catalog["credits"].append(credit)

    with open(cat_path, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, indent=1, ensure_ascii=False)

    total_pins = sum(len(v) for v in pins.values())
    hand = [k for k, v in structures_block(mapping).items() if v.get("hand_authored")]
    print("wrote %d slices, %d auto pins" % (len(stubs), total_pins))
    if hand:
        print("STILL TO HAND-AUTHOR in atlas-author.html: %s" % ", ".join(sorted(hand)))
    print("NEXT: QA every auto pin in atlas-author.html, then re-run "
          "`node test/atlas-data.test.mjs`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
