#!/usr/bin/env python3
"""Exact physical size (`mm`) for the Visible Human modules that can be rebuilt locally.

`mm` is only written where it is EXACT: the module's volume is rebuilt from the raw VHP
slices with its own segment_*_ct.py, re-sliced the way vhp_volume.py does, and every
committed NNN.webp must come back byte-identical. Then the displayed image is exactly
cols x rows voxels of known spacing (0.9375 mm in-plane from the GE header, 1 mm slices),
and mm = [cols * col_spacing, rows * row_spacing].

The build commands for these modules were not recorded, so the recipe is recovered by
search over the few ways the pipeline can produce a stack (crop before the reformat or not,
crop again after it, window, whether the picks were bounded by the labels - that bound
arrived in e728ea1f2 and only the rebuilt modules have it). A recipe counts only if it
reproduces EVERY committed slice byte for byte; a module with no such recipe gets no mm.
Modules from the 62 GB TotalSegmentator VM run (abdomen, pelvis, whole body) cannot be
rebuilt here and are not attempted. Result on 2026-09-25: EXACT for ct-hand-axial,
ct-hand-coronal, ct-hand-sagittal, ct-foot-axial, ct-foot-coronal, ct-knee-axial and
ct-head-axial; the other knee, foot, head and thorax planes used crops that were not recorded.

Usage: atlas-pipeline/.venv/bin/python atlas-pipeline/cadaver_mm.py --work /abs/path/to/work [--write]
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from vhp_volume import crop_pair, reformat, SPACING  # noqa: E402
from slices import extract_slices  # noqa: E402

# segment script -> (raw dir under work/, modules it produced)
REGIONS = {
    "hand": ("hand", ["ct-hand-axial", "ct-hand-coronal", "ct-hand-sagittal"]),
    "foot": ("foot", ["ct-foot-axial", "ct-foot-coronal", "ct-foot-sagittal"]),
    "knee": ("knee2", ["ct-knee-axial", "ct-knee-coronal", "ct-knee-sagittal"]),
    "head": ("head", ["ct-head-axial", "ct-head-coronal", "ct-head-sagittal"]),
}
# segment_thorax_ct.py on work/chest was tried (2026-09-25): no recipe reproduced any thorax
# module, so they carry no mm. Abdomen, pelvis and whole body came from the VM run.


def reproduces(mid, V, G, sp, window, bounded):
    import nibabel as nib
    shipped = json.load(open(os.path.join(_REPO, "atlas", mid, "atlas.json"), encoding="utf-8"))["slices"]
    with tempfile.TemporaryDirectory() as d:
        aff = np.diag(list(sp) + [1.0])
        nib.save(nib.Nifti1Image(V.astype(np.int16), aff), os.path.join(d, "v.nii.gz"))
        nib.save(nib.Nifti1Image(G.astype(np.uint16), aff), os.path.join(d, "g.nii.gz"))
        st = extract_slices(os.path.join(d, "v.nii.gz"), os.path.join(d, "o"), mid, 24, window, "visible-human",
                            os.path.join(d, "g.nii.gz") if bounded else None)
        if len(st) != len(shipped):
            return False
        return all(open(os.path.join(d, "o", "%03d.webp" % s["i"]), "rb").read() ==
                   open(os.path.join(_REPO, "atlas", mid, "%03d.webp" % s["i"]), "rb").read() for s in st)


def solve(mid, vol, seg):
    plane = mid.rsplit("-", 1)[1]
    for crop_first in (True, False):
        V0, G0 = crop_pair(vol, seg)[:2] if crop_first else (vol, seg)
        V, G, sp = reformat(V0, G0, plane, SPACING)
        stacks = [(V, G, False)] + ([] if plane == "axial" else [crop_pair(V, G)[:2] + (True,)])
        for (A, B, crop_after) in stacks:
            for bounded in (True, False):
                for window in ("bone", "soft-tissue", None):
                    if reproduces(mid, A, B, sp, window, bounded):
                        recipe = {"crop_first": crop_first, "crop_after": crop_after, "window": window,
                                  "label_bounded_picks": bounded}
                        mm = [round(A.shape[0] * sp[0], 1), round(A.shape[1] * sp[1], 1)]
                        return recipe, list(A.shape), mm
    return None, None, None


def main():
    import nibabel as nib
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--work", required=True)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    found = {}
    for region, (raw, mids) in REGIONS.items():
        with tempfile.TemporaryDirectory() as d:
            v, s = os.path.join(d, "v.nii.gz"), os.path.join(d, "s.nii.gz")
            subprocess.run([sys.executable, os.path.join(_HERE, "segment_%s_ct.py" % region), "--raw-dir",
                            os.path.join(a.work, raw), "--out-vol", v, "--out-seg", s], check=True, capture_output=True)
            vol, seg = np.asanyarray(nib.load(v).dataobj), np.asanyarray(nib.load(s).dataobj)
        for mid in mids:
            recipe, shape, mm = solve(mid, vol, seg)
            print("  %-20s %s" % (mid, ("EXACT %s voxels %s -> mm %s" % (recipe, shape, mm)) if recipe
                                   else "no recipe reproduces every committed slice; no mm"))
            if recipe:
                found[mid] = mm
    if a.write and found:
        p = os.path.join(_REPO, "atlas", "modules.json")
        cat = json.load(open(p, encoding="utf-8"))
        for row in cat["modules"]:
            if row["id"] in found:
                row["mm"] = found[row["id"]]
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(cat, fh, indent=1, ensure_ascii=False)
        print("wrote mm for %d modules" % len(found))
    return 0


if __name__ == "__main__":
    sys.exit(main())
