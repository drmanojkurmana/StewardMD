#!/usr/bin/env python3
"""Whole-body LIVING model from the Visible Human frozen CT.

The s0108 living body (live3d.py) is a torso only — the scan stops at the chest and the
thighs. This meshes the FULL Visible Human CT (vhp_volume.py stack -> wb_vol.nii.gz) plus
its TotalSegmentator `total` segmentation (wb_seg.nii.gz, multilabel) into a head-to-toe
living body: a skin envelope over the whole body, the full skeleton (skull, spine C1..sacrum,
ribs, sternum, shoulder girdle, arms, pelvis, femurs) and the segmented organs.

Standalone upright frame (metres), NOT co-registered to the BodyParts3D reference body:
this is its own body, viewed on its own. VHP axial array is [X, Y, Z] with X patient
left->right, Y posterior->anterior, Z slice index 0 SUPERIOR. The viewer frame is
+x = patient LEFT, +y = up, +z = anterior, so x is negated (and the winding flipped) and
z (superior->inferior) is mapped to a descending y with the feet at 0.
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
from live3d import taubin_smooth, system_of, side_of, pretty  # noqa: E402

SX = SY = 0.9375e-3   # in-plane 0.9375 mm (GE header: 480 mm FOV / 512)
SZ = 1.0e-3           # 1 mm slices

# TotalSegmentator `total` bone names -> ontology canonical (None = render as skeletal, no link).
BONE_CANON = {"skull": "SKULL", "sacrum": "SACRUM", "vertebrae_S1": "SACRUM",
              "sternum": "STERNUM", "costal_cartilages": None}
for lv in ("C1", "C2", "C3", "C4", "C5", "C6", "C7"):
    BONE_CANON["vertebrae_" + lv] = "CERVICAL_VERTEBRA"
for lv in ("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"):
    BONE_CANON["vertebrae_" + lv] = "THORACIC_VERTEBRA"
for lv in ("L1", "L2", "L3", "L4", "L5"):
    BONE_CANON["vertebrae_" + lv] = "LUMBAR_VERTEBRA"
for s in ("left", "right"):
    BONE_CANON["hip_" + s] = "HIP_BONE"
    BONE_CANON["femur_" + s] = "FEMUR"
    BONE_CANON["clavicula_" + s] = "CLAVICLE"
    BONE_CANON["scapula_" + s] = None
    BONE_CANON["humerus_" + s] = None
for i in range(1, 13):
    for s in ("left", "right"):
        BONE_CANON["rib_%s_%d" % (s, i)] = "RIB"

ORGAN_CANON = {"liver": "LIVER", "spleen": "SPLEEN", "stomach": "STOMACH", "pancreas": "PANCREAS",
               "gallbladder": "GALLBLADDER", "esophagus": "ESOPHAGUS", "duodenum": "DUODENUM",
               "small_bowel": "SMALL_BOWEL", "colon": "COLON", "urinary_bladder": "URINARY_BLADDER",
               "aorta": "AORTA", "heart": "HEART", "brain": "BRAIN"}
for s in ("left", "right"):
    ORGAN_CANON["kidney_" + s] = "KIDNEY"
    ORGAN_CANON["adrenal_gland_" + s] = "ADRENAL_GLAND"
for lobe in ("upper_lobe_left", "lower_lobe_left", "upper_lobe_right", "middle_lobe_right", "lower_lobe_right"):
    ORGAN_CANON["lung_" + lobe] = "LUNG"

REGION_BONE = {"SKULL": "HEAD", "CERVICAL_VERTEBRA": "SPINE", "THORACIC_VERTEBRA": "SPINE",
               "LUMBAR_VERTEBRA": "SPINE", "SACRUM": "PELVIS", "STERNUM": "CHEST", "RIB": "CHEST",
               "CLAVICLE": "CHEST", "HIP_BONE": "PELVIS", "FEMUR": "PELVIS"}


def wb_side(stem):
    # TotalSegmentator names ribs "rib_left_5" (side in the MIDDLE), so a trailing-token test
    # is not enough — look for the side token anywhere.
    toks = stem.split("_")
    if "left" in toks:
        return "left"
    if "right" in toks:
        return "right"
    return None


def pretty_bone(stem):
    s = wb_side(stem)
    if stem.startswith("vertebrae_"):
        return stem.split("_")[1] + " vertebra"
    if stem.startswith("rib_"):
        n = stem.split("_")[2]
        return "%s rib %s" % (s.capitalize(), n) if s else ("Rib " + n)
    base = stem.replace("_left", "").replace("_right", "").replace("clavicula", "clavicle").replace("_", " ")
    base = base[0].upper() + base[1:]
    return (s.capitalize() + " " + base[0].lower() + base[1:]) if s else base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(_HERE, "work"))
    ap.add_argument("--out", default=os.path.join(_HERE, "work", "wb3d"))
    ap.add_argument("--min-vox", type=int, default=200)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    onto = json.load(open(os.path.join(_HERE, "ontology.json")))["structures"]
    from totalsegmentator.map_to_binary import class_map
    cm = class_map["total"]                       # {label_id: name}

    seg = np.asanyarray(nib.load(os.path.join(a.work, "wb_seg.nii.gz")).dataobj).astype(np.uint16)
    hu = np.asanyarray(nib.load(os.path.join(a.work, "wb_vol.nii.gz")).dataobj).astype(np.float32)
    print("volume", seg.shape, "labels present", int(seg.max()))
    X, Y, NZ = seg.shape

    # Body mask (skin envelope) from HU, and the in-plane centre to stand the body on the axis.
    body = hu > -350
    body = ndimage.binary_opening(body, iterations=2)
    for k in range(NZ):
        body[:, :, k] = ndimage.binary_fill_holes(body[:, :, k])
    lab_, n_ = ndimage.label(body)
    if n_ > 1:
        sizes = ndimage.sum(body, lab_, range(1, n_ + 1))
        body = lab_ == (int(np.argmax(sizes)) + 1)
    bx, by, _ = np.where(body)
    cx, cy = float(bx.mean()), float(by.mean())
    print("body centre voxel (%.1f, %.1f), height %d slices (%.2f m)" % (cx, cy, NZ, NZ * SZ))

    def world(x, y, z):
        # x negated -> patient left +; z 0 superior -> descending y with feet near 0; y -> anterior.
        return np.stack([-(x - cx) * SX, (NZ - 1 - z) * SZ, (y - cy) * SY], axis=-1)

    def mesh(mask, sigma=0.8, step=1, smooth=12):
        m = mask.astype(np.float32)
        if sigma:
            m = ndimage.gaussian_filter(m, sigma)
        v, f, _, _ = measure.marching_cubes(m, level=0.5, spacing=(1.0, 1.0, 1.0), step_size=step)
        if smooth and len(v) > 8:
            v = taubin_smooth(v, f, iters=smooth)
        w = world(v[:, 0], v[:, 1], v[:, 2]).astype(np.float32)
        f = f[:, [0, 2, 1]].astype(np.uint32)     # x-negation is a reflection: flip winding
        return w, f

    parts, blob = [], bytearray()

    def add(pid, stem, sid, canon, side, name, system, region, w, f):
        off_p = len(blob); blob.extend(w.tobytes())
        off_i = len(blob); blob.extend(f.tobytes())
        parts.append({"id": pid, "stem": stem, "sid": sid, "canon": canon, "side": side,
                      "name": name, "system": system, "region": region,
                      "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
                      "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])]})
        print("  %-26s %7d tris -> %s/%s" % (stem, len(f), system, canon))

    present = [(lid, cm[lid]) for lid in range(1, int(seg.max()) + 1) if lid in cm and (seg == lid).any()]
    for lid, name in present:
        mask = seg == lid
        if int(mask.sum()) < a.min_vox:
            continue
        if name in BONE_CANON:
            canon = BONE_CANON[name]
            region = REGION_BONE.get(canon, "BODY")
            if canon and canon not in onto:
                canon = None
            add("WB_" + name, name, None, canon, wb_side(name), pretty_bone(name), "skeletal", region, *mesh(mask))
        elif name in ORGAN_CANON:
            canon = ORGAN_CANON[name]
            if canon not in onto:
                canon = None
            region = onto[canon]["region"] if canon else "BODY"
            dn = onto[canon]["display_name"] if canon else name.replace("_", " ").capitalize()
            add("WB_" + name, name, canon.lower().replace("_", "-") if canon else None, canon,
                wb_side(name), pretty(name, dn), system_of(name), region, *mesh(mask))
        # everything else (muscles, minor vessels, unmapped) is skipped for a clean first body

    # Skin envelope over the whole body.
    w, f = mesh(body, sigma=1.2, step=2)
    add("WB_body_surface", "body_surface", None, None, None, "Body surface (skin)",
        "integumentary", "BODY", w, f)

    open(os.path.join(a.out, "parts.bin"), "wb").write(bytes(blob))
    meta = {
        "frame": {"units": "m", "up": "y", "anterior": "z", "left": "x"},
        "source": {"dataset": "Visible Human Project frozen CT (U.S. National Library of Medicine)",
                   "licence": "US Government work, no copyright; NLM Terms and Conditions apply",
                   "segmentation": "TotalSegmentator `total` (Apache-2.0)"},
        "planes": {},
        "parts": parts,
    }
    json.dump(meta, open(os.path.join(a.out, "wb3d.json"), "w"))
    print("parts", len(parts), "bytes", len(blob))


if __name__ == "__main__":
    main()
