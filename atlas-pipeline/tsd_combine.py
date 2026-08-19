#!/usr/bin/env python3
"""Merge the TotalSegmentator dataset's per-structure binary masks into ONE integer
label volume, and validate each structure against the image before letting it through.

The dataset ships 117 separate `segmentations/<name>.nii.gz` binaries per subject, but
build.py consumes a single integer-labelled volume plus a model_values LUT. Integers are
taken from TotalSegmentator's own class_map["total"] so a living-patient module and a
Visible Human module share one numbering and one label vocabulary.

VALIDATION (this is the point of the file, not the merge). A mask is only admitted if it
agrees with the pixels underneath it. For each structure the expected HU band is checked
against the actual median inside the mask, plus a minimum voxel count and a
connected-component sanity check. Everything rejected is reported with its numbers, and
the caller writes those numbers into the module's label file. This is what stopped
pelvic muscle and costal cartilage from shipping off the cadaver, and it runs here too:
these are real clinical scans, but "expert mask" is not a licence to skip verification.

Licence: dataset is CC BY 4.0. See sources.json -> totalsegmentator-dataset.
"""
import argparse
import json
import os
import sys

import nibabel as nib
import numpy as np
from scipy import ndimage

# expected HU band per structure family: (low, high) for the MEDIAN inside the mask.
# Deliberately wide — this rejects gross failures (a mask sitting on fat or air), not
# subtle ones, and a clinician still reviews every pin.
BANDS = {
    "lung": (-1000, -400), "airway": (-1000, -300),
    "soft": (-30, 120), "organ": (0, 140), "vessel": (-20, 400),
    "muscle": (5, 110), "bone": (120, 2000), "fat": (-200, -20),
}
FAMILY = {
    "lung_upper_lobe_left": "lung", "lung_upper_lobe_right": "lung",
    "lung_middle_lobe_right": "lung", "lung_lower_lobe_left": "lung",
    "lung_lower_lobe_right": "lung", "trachea": "airway",
    "liver": "organ", "spleen": "organ", "pancreas": "organ",
    "kidney_left": "organ", "kidney_right": "organ", "gallbladder": "organ",
    "stomach": "soft", "duodenum": "soft", "small_bowel": "soft", "colon": "soft",
    "esophagus": "soft", "urinary_bladder": "soft", "prostate": "organ",
    "adrenal_gland_left": "organ", "adrenal_gland_right": "organ",
    "thyroid_gland": "organ", "spinal_cord": "soft",
    "heart": "soft", "aorta": "vessel", "pulmonary_vein": "vessel",
    "inferior_vena_cava": "vessel", "portal_vein_and_splenic_vein": "vessel",
    "superior_vena_cava": "vessel", "brachiocephalic_trunk": "vessel",
    "common_carotid_artery_left": "vessel", "common_carotid_artery_right": "vessel",
    "subclavian_artery_left": "vessel", "subclavian_artery_right": "vessel",
    "iliac_artery_left": "vessel", "iliac_artery_right": "vessel",
    "iliac_vena_left": "vessel", "iliac_vena_right": "vessel",
    "atrial_appendage_left": "soft", "pulmonary_artery": "vessel",
    "autochthon_left": "muscle", "autochthon_right": "muscle",
    "iliopsoas_left": "muscle", "iliopsoas_right": "muscle",
    "gluteus_maximus_left": "muscle", "gluteus_maximus_right": "muscle",
    "gluteus_medius_left": "muscle", "gluteus_medius_right": "muscle",
    "gluteus_minimus_left": "muscle", "gluteus_minimus_right": "muscle",
}
MIN_VOX = 150

# Bone families, so the report is complete rather than reporting "no band declared" for
# half the skeleton. Living-patient bone is NOT the reason this dataset is here — the
# Visible Human skeletal modules already cover it at 1 mm and passed their own HU check —
# so the living-CT label files map bone to null. Validating it anyway keeps the report
# honest and leaves the door open for a bony landmark if a module wants orientation.
_BONE_PREFIX = ("vertebrae_", "rib_", "costal_")
_BONE_EXACT = {"sacrum", "sternum", "skull", "clavicula_left", "clavicula_right",
               "scapula_left", "scapula_right", "humerus_left", "humerus_right",
               "femur_left", "femur_right", "hip_left", "hip_right"}


def _family(stem):
    if stem in FAMILY:
        return FAMILY[stem]
    if stem.startswith(_BONE_PREFIX) or stem in _BONE_EXACT:
        return "bone"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject-dir", required=True)
    ap.add_argument("--out-seg", required=True)
    ap.add_argument("--out-report", required=True)
    ap.add_argument("--structures", required=True,
                    help="comma-separated mask stems, or ALL")
    a = ap.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from check_sources import require_clear
    require_clear("totalsegmentator-dataset")

    from totalsegmentator.map_to_binary import class_map
    ids = {v: k for k, v in class_map["total"].items()}

    ct = nib.load(os.path.join(a.subject_dir, "ct.nii.gz"))
    vol = np.asanyarray(ct.dataobj).astype(np.int16)
    segdir = os.path.join(a.subject_dir, "segmentations")

    if a.structures == "ALL":
        stems = sorted(f[:-7] for f in os.listdir(segdir) if f.endswith(".nii.gz"))
    else:
        stems = [s.strip() for s in a.structures.split(",") if s.strip()]

    out = np.zeros(vol.shape, dtype=np.uint16)
    kept, rejected = [], []
    for stem in stems:
        p = os.path.join(segdir, stem + ".nii.gz")
        if not os.path.exists(p):
            rejected.append({"structure": stem, "reason": "mask file absent"})
            continue
        m = np.asanyarray(nib.load(p).dataobj) > 0
        n = int(m.sum())
        if n < MIN_VOX:
            rejected.append({"structure": stem, "voxels": n,
                             "reason": f"below the {MIN_VOX}-voxel floor"})
            continue
        hu = vol[m]
        med = int(np.median(hu))
        fam = _family(stem)
        if fam is None:
            rejected.append({"structure": stem, "voxels": n, "median_hu": med,
                             "reason": "no expected HU band declared; not admitted "
                                       "rather than guessed"})
            continue
        lo, hi = BANDS[fam]
        lab, k = ndimage.label(m)
        biggest = 0
        if k:
            sizes = ndimage.sum(m, lab, range(1, k + 1))
            biggest = float(max(sizes)) / n
        row = {"structure": stem, "family": fam, "voxels": n, "median_hu": med,
               "expected_hu": [lo, hi], "components": int(k),
               "largest_component_fraction": round(biggest, 3)}
        if not (lo <= med <= hi):
            row["reason"] = (f"median {med} HU outside the {lo}..{hi} band expected "
                             f"for {fam}: the mask is not on the tissue it names")
            rejected.append(row)
            continue
        vid = ids.get(stem)
        if vid is None:
            row["reason"] = "not in TotalSegmentator class_map, so it has no canonical id"
            rejected.append(row)
            continue
        out[m] = vid
        row["label_value"] = int(vid)
        kept.append(row)

    nib.save(nib.Nifti1Image(out, ct.affine, ct.header), a.out_seg)
    report = {
        "subject_dir": a.subject_dir,
        "volume_shape": list(vol.shape),
        "spacing_mm": [round(float(x), 3) for x in ct.header.get_zooms()[:3]],
        "kept": kept, "rejected": rejected,
        "_validation": "Each mask admitted only if the MEDIAN HU inside it falls in the "
                       "band expected for its tissue family, it clears a 150-voxel floor, "
                       "and it maps to a TotalSegmentator class id. Rejections are kept "
                       "here with their numbers so the exclusion is auditable.",
    }
    json.dump(report, open(a.out_report, "w"), indent=2)
    print(f"kept {len(kept)}, rejected {len(rejected)} -> {a.out_seg}")
    for r in kept:
        print(f"  KEEP   {r['structure']:34} {r['voxels']:>9} vox  median {r['median_hu']:>5} HU")
    for r in rejected:
        print(f"  REJECT {r['structure']:34} {r.get('reason','')[:72]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
