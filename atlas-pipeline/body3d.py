#!/usr/bin/env python3
"""Whole-body living-CT 3D surfaces (subject s1045) for the RadioAnatome 3D layer.

WHY: live3d.py meshes the torso subject (s0108, lower chest to thigh). Immersive CT needs the
body from the skull vertex down, and a body whose slices ARE the ct-live-body-* modules, so
the CT on screen and the 3D cut plane are one patient, one grid, one geometry.

WHAT: every non-empty TotalSegmentator mask of s1045 (organs, vessels, muscles, the whole
skeleton, brain), plus the body surface thresholded from the CT, meshed by marching cubes
(live3d.mesh_mask's smoothing) in the frame living.py already PROVES the module slices in:
living.tsd_frame("live-body") = x patient-left, y superior, z anterior, metres. The slice
planes come from living.build() for the same group, so meshes and planes coincide by
construction, not by fitting. Masks are re-indexed with the axes tsd_living.py MEASURED
(work/tsd/live-body/group.json), never with the header.

Output: work/body3d/{parts.bin, live3d.json} for `pack3d.mjs live --prefix body- --json body.json`,
then body_merge.py adds the result to atlas/3d/manifest.json as the third 3D source.

Usage:  .venv/bin/python body3d.py [--work work] [--out work/body3d]
"""
import argparse
import json
import os
import sys

import numpy as np
import nibabel as nib
from scipy import ndimage

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

GROUP, SUBJECT, LABELS = "live-body", "s1045", "ct-live-body-axial"
MODULES = ("ct-live-body-axial", "ct-live-body-coronal", "ct-live-body-sagittal")

# display system per mask stem prefix (the manifest's system ids; bones are skeletal)
SYSTEM = [
    ("lung_", "respiratory"), ("trachea", "respiratory"),
    ("heart", "cardiac"), ("atrial_appendage", "cardiac"),
    ("aorta", "arterial"), ("iliac_artery", "arterial"), ("brachiocephalic_trunk", "arterial"),
    ("common_carotid", "arterial"), ("subclavian_artery", "arterial"),
    ("inferior_vena_cava", "venous"), ("superior_vena_cava", "venous"), ("iliac_vena", "venous"),
    ("portal_vein", "venous"), ("pulmonary_vein", "venous"), ("brachiocephalic_vein", "venous"),
    ("esophagus", "digestive"), ("liver", "digestive"), ("pancreas", "digestive"), ("gallbladder", "digestive"),
    ("stomach", "digestive"), ("duodenum", "digestive"), ("small_bowel", "digestive"), ("colon", "digestive"),
    ("spleen", "lymphatic"), ("kidney", "urinary"), ("urinary_bladder", "urinary"),
    ("adrenal", "endocrine"), ("thyroid", "endocrine"), ("prostate", "reproductive"),
    ("brain", "nervous"), ("spinal_cord", "nervous"),
    ("autochthon", "muscular"), ("iliopsoas", "muscular"), ("gluteus", "muscular"),
    ("vertebrae_", "skeletal"), ("rib_", "skeletal"), ("costal_cartilages", "skeletal"), ("sternum", "skeletal"),
    ("clavicula", "skeletal"), ("scapula", "skeletal"), ("humerus", "skeletal"), ("hip_", "skeletal"),
    ("femur", "skeletal"), ("sacrum", "skeletal"), ("skull", "skeletal"),
]
# canonical id for stems the 2D module deliberately leaves unpinned (labels map them to null)
EXTRA_CANON = {"atrial_appendage_left": "HEART", "costal_cartilages": None,
               "vertebrae_S1": "SACRUM"}
ORD = {1: "1st", 2: "2nd", 3: "3rd"}


def system_of(stem):
    for pre, sysid in SYSTEM:
        if stem.startswith(pre):
            return sysid
    return "connective"


def side_of(stem):
    t = stem.split("_")             # rib_left_5 carries its side in the middle
    return "left" if "left" in t else "right" if "right" in t else None


def name_of(stem, canon_name):
    s = side_of(stem)
    if stem.startswith("vertebrae_"):
        return stem.split("_")[1] + " vertebra"
    if stem.startswith("rib_"):
        n = int(stem.split("_")[2])
        return "%s %s rib" % (s.capitalize(), ORD.get(n, "%dth" % n))
    if stem == "atrial_appendage_left":
        return "Left atrial appendage"
    if stem == "costal_cartilages":
        return "Costal cartilages"
    if stem.startswith("gluteus_"):
        base = "Gluteus " + stem.split("_")[1]
    elif stem.startswith("autochthon"):
        base = "Deep back muscles"
    elif stem.startswith("lung_"):
        return canon_name
    else:
        base = canon_name
    return (s.capitalize() + " " + base[0].lower() + base[1:]) if s else base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(_HERE, "work"))
    ap.add_argument("--out", default=os.path.join(_HERE, "work", "body3d"))
    a = ap.parse_args()
    work = os.path.abspath(a.work)
    os.makedirs(a.out, exist_ok=True)

    from live3d import taubin_smooth
    from skimage import measure
    from tsd_living import canonical
    import living

    g = json.load(open(os.path.join(work, "tsd", GROUP, "group.json")))
    perm, flip = tuple(g["perm"]), tuple(g["flip"])
    F = living.tsd_frame(work, GROUP)                     # index -> world (metres)
    assert np.isclose(abs(np.linalg.det(F[:3, :3])), living.MM ** 3)
    if np.linalg.det(F[:3, :3]) > 0:
        raise SystemExit("tsd_frame is not a reflection any more: re-check the face winding below")

    def mesh(mask, sigma=0.8, step=1, smooth=12):
        m = ndimage.gaussian_filter(mask.astype(np.float32), sigma) if sigma else mask.astype(np.float32)
        v, f, _, _ = measure.marching_cubes(m, level=0.5, step_size=step)
        if smooth and len(v) > 8:
            v = taubin_smooth(v, f, iters=smooth)
        w = (np.c_[v, np.ones(len(v))] @ F.T)[:, :3].astype(np.float32)
        # F is a reflection (det < 0), so marching_cubes' outward winding flips
        return w, f[:, [0, 2, 1]].astype(np.uint32)

    lab = json.load(open(os.path.join(_HERE, "labels", LABELS + ".json")))
    onto = json.load(open(os.path.join(_HERE, "ontology.json")))["structures"]
    segdir = os.path.join(work, "tsd", SUBJECT, "segmentations")
    parts, blob = [], bytearray()

    def add(pid, stem, sid, cid, name, sysid, region, w, f):
        off_p = len(blob); blob.extend(w.tobytes())
        off_i = len(blob); blob.extend(f.tobytes())
        parts.append({"id": pid, "stem": stem, "sid": sid, "canon": cid, "side": side_of(stem), "name": name,
                      "system": sysid, "region": region, "pos": off_p, "nv": int(len(w)), "idx": off_i,
                      "ni": int(len(f) * 3), "bounds": [float(x) for x in np.concatenate([w.min(0), w.max(0)])]})

    for stem in sorted(lab["model_labels"]):
        fp = os.path.join(segdir, stem + ".nii.gz")
        if not os.path.exists(fp):
            continue
        mask = canonical(np.asanyarray(nib.load(fp).dataobj) > 0, perm, flip)
        n = int(mask.sum())
        if n < 400:            # cysts (empty here) and scan-edge fragments
            continue
        sid = lab["model_labels"][stem]
        cid = sid.replace("-", "_").upper() if sid else EXTRA_CANON.get(stem)
        if cid and cid not in onto:
            raise SystemExit("%s: canonical %s missing from the ontology" % (stem, cid))
        region = onto[cid]["region"] if cid else "CHEST"
        big = n > 150000
        w, f = mesh(mask, step=2 if big else 1)
        add("BODY_" + stem, stem, sid, cid, name_of(stem, onto[cid]["display_name"] if cid else stem),
            system_of(stem), region, w, f)
        print("  %-32s %8d vox %7d tris -> %s" % (stem, n, len(f), cid))

    # body surface from the CT (HU > -350, holes filled per axial level). Every component over
    # 2% of the largest is kept: with the arms down, each arm can be its own component.
    hu = np.asanyarray(nib.load(os.path.join(work, "tsd", GROUP, "vol.nii.gz")).dataobj)
    body = ndimage.binary_opening(hu > -350, iterations=2)
    for k in range(body.shape[2]):
        body[:, :, k] = ndimage.binary_fill_holes(body[:, :, k])
    lab_, n_ = ndimage.label(body)
    sizes = ndimage.sum(body, lab_, range(1, n_ + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= 0.02 * sizes.max()]
    body = np.isin(lab_, keep)
    w, f = mesh(body, sigma=1.2, step=2)
    add("BODY_body_surface", "body_surface", None, None, "Body surface (skin)", "integumentary", "BODY", w, f)
    print("  %-32s %7d tris, %d component(s) -> skin" % ("body_surface", len(f), len(keep)))
    open(os.path.join(a.out, "parts.bin"), "wb").write(bytes(blob))

    info = living.build(work, groups=(GROUP,))
    planes = living.group_planes(info, MODULES)
    nx, ny, nz = hu.shape
    json.dump({
        "frame": {"mm": living.MM, "axes": "x=patient-left (BodyParts3D frame), y=superior, z=anterior; metres",
                  "y_range": [0.0, (nz - 1) * living.MM], "from": "living.tsd_frame('live-body')"},
        "source": {"dataset": "TotalSegmentator dataset v2.0.1, subject %s" % SUBJECT, "licence": "CC BY 4.0",
                   "doi": "10.5281/zenodo.10047292", "note": lab.get("_geometry", "")},
        "parts": parts, "planes": planes,
    }, open(os.path.join(a.out, "live3d.json"), "w"), indent=1)
    print("parts", len(parts), "MB", round(len(blob) / 1e6, 1))


if __name__ == "__main__":
    main()
