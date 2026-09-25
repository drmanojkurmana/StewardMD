#!/usr/bin/env python3
"""Living-patient 3D organ surfaces for the RadioAnatome 3D layer.

WHY: BodyParts3D's "isa" mesh set has no liver, lung, lobe or closed heart surface, and it is
a different body from every CT slice we show. The living-torso CT modules already ship
expert TotalSegmentator masks for subject s0108 (CC BY 4.0). Meshing THOSE masks gives 3D
organ surfaces from the SAME scan as the slices, so a CT slice and its 3D structure are the
same patient, the same voxels, and the slice can be drawn as a textured cut plane through
the meshes at exactly the right level.

WHAT: for every structure the living-torso label file maps (38), run marching cubes on
the mask (lightly smoothed), convert to the viewer's world frame (metres, Y-up, anterior +z),
and record each shipped slice's plane in that frame from the exact pipeline chain proven by
living.py (crop, reformat flips, the pipeline's own picks), so image, mask and mesh share one
geometry. Output goes to work/live3d/ for pack3d.mjs, which simplifies, computes
normals and packs chunks; bp3d_import.py then merges it into manifest.json.

Usage:  .venv/bin/python live3d.py [--work work/tsd] [--out work/live3d]
"""
import argparse
import json
import os
import sys

import numpy as np
import nibabel as nib
from scipy import ndimage
from skimage import measure

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)

MM = 0.0015              # 1.5 mm isotropic
Y0 = 0.62                # world height (m) of volume z=0: pelvis floor sits where the reference body's does
SMOOTH_SIGMA = 0.8

SYSTEM = {
    "lung": "respiratory", "heart": "cardiac", "aorta": "arterial", "iliac_artery": "arterial",
    "inferior_vena_cava": "venous", "iliac_vena": "venous", "portal_vein": "venous", "pulmonary_vein": "venous",
    "esophagus": "digestive", "liver": "digestive", "pancreas": "digestive", "gallbladder": "digestive",
    "stomach": "digestive", "duodenum": "digestive", "small_bowel": "digestive", "colon": "digestive",
    "spleen": "lymphatic", "kidney": "urinary", "urinary_bladder": "urinary", "adrenal": "endocrine",
    "prostate": "reproductive", "spinal_cord": "nervous", "autochthon": "muscular", "iliopsoas": "muscular",
    "gluteus": "muscular",
}


def system_of(stem):
    for k, v in SYSTEM.items():
        if stem.startswith(k):
            return v
    return "connective"


def side_of(stem):
    if stem.endswith("_left"):
        return "left"
    if stem.endswith("_right"):
        return "right"
    return None


def pretty(stem, canon_name):
    s = side_of(stem)
    base = canon_name
    if stem.startswith("lung_"):
        return canon_name
    if stem.startswith("gluteus_"):
        base = stem.replace("_left", "").replace("_right", "").replace("_", " ").capitalize()
    if stem.startswith("autochthon"):
        base = "Deep back muscles"
    return (s.capitalize() + " " + base[0].lower() + base[1:]) if s else base


NZ = 293                 # slices in the axial volume; z index 0 is SUPERIOR (measured, see below)


def world_from_voxel(x, y, z):
    """Voxel index -> viewer world: x=patient-left(+x), y=superior(+y), z=anterior(+z).

    Directions were MEASURED on the masks, not read from the header: liver centroid x=200 vs
    spleen 70 (so +x is the patient's right), bladder y=155 vs spinal cord 97 (+y anterior),
    liver z=50 vs prostate 254 (+z INFERIOR, although the NIfTI affine says 'S'). The shipped
    coronal images have the liver at the top, which agrees with z=0 being superior."""
    # +x in the viewer is the patient's LEFT (BodyParts3D's frame: its left kidney sits at +x),
    # so the volume's right-increasing x is negated.
    return np.stack([(143.5 - x) * MM, (NZ - 1 - z) * MM + Y0, (y - 143.5) * MM], axis=-1)


def mesh_label(seg, value):
    return mesh_mask(seg == value)


def taubin_smooth(v, f, iters=12, lamb=0.5, mu=-0.53):
    """Taubin lambda/mu smoothing: alternating Laplacian passes whose signs cancel the
    shrinkage a plain Laplacian causes, so the mesh keeps its volume while the marching-cubes
    voxel staircase melts away. Uniform (umbrella) weights, built once as a sparse operator."""
    from scipy import sparse
    n = len(v)
    i = np.concatenate([f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]])
    j = np.concatenate([f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]])
    A = sparse.coo_matrix((np.ones(len(i), np.float32), (i, j)), shape=(n, n)).tocsr()
    A.data[:] = 1.0                                   # collapse duplicate edges to 1
    deg = np.asarray(A.sum(1)).ravel()
    deg[deg == 0] = 1.0
    W = sparse.diags(1.0 / deg) @ A                   # row-normalised neighbour average
    v = v.astype(np.float32)
    for _ in range(iters):
        v = v + lamb * (W @ v - v)
        v = v + mu * (W @ v - v)
    return v


def mesh_mask(mask, sigma=SMOOTH_SIGMA, step=1, smooth=12):
    m = mask.astype(np.float32)
    if sigma:
        m = ndimage.gaussian_filter(m, sigma)
    v, f, _, _ = measure.marching_cubes(m, level=0.5, spacing=(1.0, 1.0, 1.0), step_size=step)
    if smooth and len(v) > 8:
        v = taubin_smooth(v, f, iters=smooth)
    w = world_from_voxel(v[:, 0], v[:, 1], v[:, 2]).astype(np.float32)
    # (x, y, z) -> (-x, -z, y): a swap plus two sign flips = three reflections = a reflection,
    # so marching_cubes' outward winding must be flipped to keep faces outward.
    f = f[:, [0, 2, 1]].astype(np.uint32)
    return w, f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(_HERE, "work", "tsd"))
    ap.add_argument("--out", default=os.path.join(_HERE, "work", "live3d"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    lab = json.load(open(os.path.join(_HERE, "labels", "ct-live-torso-axial.json")))
    onto = json.load(open(os.path.join(_HERE, "ontology.json")))["structures"]
    mv = {int(k): v for k, v in lab["model_values"].items()}
    ml = lab["model_labels"]
    sid_of_value = {k: ml.get(v) for k, v in mv.items() if ml.get(v)}

    seg = np.asanyarray(nib.load(os.path.join(a.work, "live_seg.nii.gz")).dataobj).astype(np.uint16)
    print("volume", seg.shape)

    # ---- meshes ----
    parts, blob = [], bytearray()
    for value in sorted(sid_of_value):
        stem, sid = mv[value], sid_of_value[value]
        if not (seg == value).any():
            continue
        cid = sid.replace("-", "_").upper()
        w, f = mesh_label(seg, value)
        off_p = len(blob); blob.extend(w.tobytes())
        off_i = len(blob); blob.extend(f.tobytes())
        parts.append({
            "id": "LIVE_" + stem, "stem": stem, "sid": sid, "canon": cid, "side": side_of(stem),
            "name": pretty(stem, onto[cid]["display_name"]), "system": system_of(stem),
            "region": onto[cid]["region"], "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
            "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])],
        })
        print(f"  {stem:32} {len(f):7d} tris -> {cid}")
    # ---- the skeleton and the body surface: what makes it read as a patient, not floating organs ----
    # The slice modules deliberately dropped bone (see the label file's _why_bone_dropped); the 3D
    # body needs it as a frame. Masks come from the dataset's per-structure files (same subject,
    # same grid: the merged live_seg only carries the mapped organs). Bones below ~400 voxels are
    # fragments clipped by the scan edge (T9, right 6th rib) and are skipped.
    segdir = os.path.join(a.work, "s0108", "segmentations")
    extra = []
    for lv in ("T10", "T11", "T12"):
        extra.append((f"vertebrae_{lv}", "THORACIC_VERTEBRA", "SPINE", f"{lv} vertebra"))
    for lv in ("L1", "L2", "L3", "L4", "L5"):
        extra.append((f"vertebrae_{lv}", "LUMBAR_VERTEBRA", "SPINE", f"{lv} vertebra"))
    extra.append(("vertebrae_S1", "SACRUM", "SPINE", "S1 vertebra"))
    extra.append(("sacrum", "SACRUM", "PELVIS", "Sacrum"))
    ORD = {6: "6th", 7: "7th", 8: "8th", 9: "9th", 10: "10th", 11: "11th", 12: "12th"}
    for side in ("left", "right"):
        for n in range(6, 13):
            extra.append((f"rib_{side}_{n}", "RIB", "CHEST", f"{side.capitalize()} {ORD[n]} rib"))
        extra.append((f"hip_{side}", "HIP_BONE", "PELVIS", f"{side.capitalize()} hip bone"))
        extra.append((f"femur_{side}", "FEMUR", "PELVIS", f"{side.capitalize()} femur"))
    extra.append(("costal_cartilages", None, "CHEST", "Costal cartilages"))
    for stem, cid, region, name in extra:
        fp = os.path.join(segdir, stem + ".nii.gz")
        if not os.path.exists(fp):
            continue
        mask = np.asanyarray(nib.load(fp).dataobj) > 0
        if mask.sum() < 400:
            continue
        if cid and cid not in onto:
            raise SystemExit(f"{stem}: canonical {cid} missing from the ontology")
        w, f = mesh_mask(mask)
        off_p = len(blob); blob.extend(w.tobytes())
        off_i = len(blob); blob.extend(f.tobytes())
        parts.append({
            "id": "LIVE_" + stem, "stem": stem, "sid": None, "canon": cid, "side": side_of(stem),
            "name": name, "system": "skeletal", "region": region,
            "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
            "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])],
        })
        print(f"  {stem:32} {len(f):7d} tris -> {cid}")

    # Body surface from the CT itself (HU > -350, holes filled per slice, largest component).
    hu = np.asanyarray(nib.load(os.path.join(a.work, "live_vol.nii.gz")).dataobj)
    body = hu > -350
    body = ndimage.binary_opening(body, iterations=2)
    for k in range(body.shape[2]):
        body[:, :, k] = ndimage.binary_fill_holes(body[:, :, k])
    lab_, n_ = ndimage.label(body)
    if n_ > 1:
        sizes = ndimage.sum(body, lab_, range(1, n_ + 1))
        body = lab_ == (int(np.argmax(sizes)) + 1)
    w, f = mesh_mask(body, sigma=1.2, step=2)
    off_p = len(blob); blob.extend(w.tobytes())
    off_i = len(blob); blob.extend(f.tobytes())
    parts.append({
        "id": "LIVE_body_surface", "stem": "body_surface", "sid": None, "canon": None, "side": None,
        "name": "Body surface (skin)", "system": "integumentary", "region": "BODY",
        "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
        "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])],
    })
    print(f"  {'body_surface':32} {len(f):7d} tris -> skin (HU threshold)")
    open(os.path.join(a.out, "parts.bin"), "wb").write(bytes(blob))

    # ---- slice planes ----
    # From the EXACT pipeline chain (crop offsets, reformat flips, the pipeline's own slice
    # picks, each proven by living.py), not from matching images. The first version located
    # slices by image correlation plus a linear fit and framed the axial quad on the full
    # 288x288 grid; the axial module is the 277x240 crop, so its texture sat up to 39 mm off.
    import living
    info = living.build(os.path.dirname(os.path.abspath(a.work)), groups=("live-torso",))
    planes = living.torso_planes(info)

    json.dump({
        "frame": {"mm": MM, "y0": Y0, "axes": "x=patient-left (BodyParts3D frame), y=superior, z=anterior; metres"},
        "source": {"dataset": "TotalSegmentator dataset v2.0.1, subject s0108", "licence": "CC BY 4.0",
                   "doi": "10.5281/zenodo.10047292", "note": lab.get("_geometry", "")},
        "parts": parts, "planes": planes,
    }, open(os.path.join(a.out, "live3d.json"), "w"), indent=1)
    print("parts", len(parts), "bytes", len(blob))


if __name__ == "__main__":
    main()
