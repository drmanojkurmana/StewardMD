#!/usr/bin/env python3
"""Classical (no-ML) segmenter for the Visible Human knee and leg: FEMUR, TIBIA, FIBULA.

WHY CLASSICAL. The only model that offers tibia, fibula and patella is TotalSegmentator's
`appendicular_bones`, which sits in the package's own `commercial_models` register and
exits without a licence key. VISTA3D was checked against its own label_dict.json and has
no tibia, fibula or patella either. Bone contrast is the one thing this frozen cadaver
reproduces faithfully, so thresholding plus position is enough here — and it is free.

HOW THE THREE BONES ARE TOLD APART. Nothing is assumed; every rule below came from
measuring 3D connected components over VHP 2300-2470 (see the numbers in
labels/ct-knee-axial.json):

  tibia   102074 / 99664 vox   z 31..170   |relx| 0.65   median 643-650 HU
  femur    64958 / 61384 vox   z  0..42    |relx| 0.58   median 427-434 HU
  fibula   14427 / 13708 vox   z 49..170   |relx| 0.80   median 791-834 HU

  * Z-EXTENT separates femur from the leg bones: the femur occupies the SUPERIOR end of
    the crop and stops at the joint; tibia and fibula start at the joint and run to the
    bottom. No side is needed for this.
  * SIZE separates tibia from fibula: a 7x ratio, in every leg, on every slice.
  * LATERALITY confirms it: the fibula is the most lateral bone in the leg (|relx| 0.80
    against the tibia's 0.65). Used only as a CHECK, never to assert a left or right,
    because this atlas asserts no side anywhere.

THE ARM TRAP. The cadaver's forearms and hands lie beside the thighs at this level, and a
naive "body component over 4000 px" rule admits them — which is how the whole-body run
came to label an arm bone `femur`. The legs are the TWO LARGEST components on every slice
at this level, so that is the rule used here.

WHAT IS NOT CLAIMED. The PATELLA is deliberately absent. At the joint the epiphyseal bone
is trabecular with a thin cortex, so a >300 HU threshold fragments it: the femoral
component breaks into 20-22 separate in-plane parts at its mid-slice, against 1 for the
tibial shaft, and no patella survives as its own component. Rather than point a pin at a
fragment and call it a patella, the structure is recorded as NOT RELIABLY AVAILABLE.
Tarsals, metatarsals and phalanges are likewise not attempted here — the feet need their
own crop and the same honest treatment.

Emits an integer label volume for build.py's pins_from_segmentation.
"""
import argparse
import glob
import os

import numpy as np
from scipy import ndimage

HDR = 3416
DIM = 512
LBL = {"femur": 1, "tibia": 2, "fibula": 3}

BONE_HU = 300
MIN_COMPONENT = 3000       # below this a component is trabecular debris, not a bone
LEG_MIN_PX = 3000          # a leg cross-section; a forearm is smaller at this level


def leg_mask(vol):
    """The two largest body components per slice. Excludes forearms, hands, container."""
    out = np.zeros(vol.shape, bool)
    for z in range(vol.shape[2]):
        b = ndimage.binary_fill_holes(
            ndimage.binary_closing(vol[:, :, z] > -300, np.ones((7, 7))))
        lab, k = ndimage.label(b)
        if not k:
            continue
        sizes = ndimage.sum(b, lab, range(1, k + 1))
        for i in np.argsort(sizes)[-2:]:
            if sizes[i] > LEG_MIN_PX:
                out[:, :, z] |= (lab == i + 1)
    return out


def classify(vol, legs):
    """Label the bone components. Returns (seg, report)."""
    bone = (vol > BONE_HU) & legs
    lab, k = ndimage.label(bone)
    if not k:
        return np.zeros(vol.shape, np.uint8), []
    sizes = ndimage.sum(bone, lab, range(1, k + 1))
    keep = [(int(s), i + 1) for i, s in enumerate(sizes) if s >= MIN_COMPONENT]
    if not keep:
        return np.zeros(vol.shape, np.uint8), []

    xs = np.where(legs.any(axis=(1, 2)))[0]
    mid = (xs.min() + xs.max()) / 2.0
    half = max((xs.max() - xs.min()) / 2.0, 1.0)
    nz = vol.shape[2]

    rows = []
    for s, i in keep:
        m = lab == i
        z = np.where(m.any(axis=(0, 1)))[0]
        cx = ndimage.center_of_mass(m)[0]
        rows.append({"idx": i, "vox": s, "zmin": int(z.min()), "zmax": int(z.max()),
                     "relx": round(float((cx - mid) / half), 3),
                     "median_hu": int(np.median(vol[m]))})

    # FEMUR: the components whose mass sits in the superior third and which END before
    # the bottom of the crop. TIBIA/FIBULA: the components that reach the bottom.
    for r in rows:
        reaches_bottom = r["zmax"] >= nz - 5
        r["bone"] = None
        if not reaches_bottom and r["zmin"] <= nz * 0.1:
            r["bone"] = "femur"
        elif reaches_bottom:
            r["bone"] = "leg"          # tibia or fibula, decided by size next

    legbones = [r for r in rows if r["bone"] == "leg"]
    if legbones:
        # per SIDE (sign of relx), the larger is the tibia and the smaller the fibula.
        for sign in (-1, 1):
            side = [r for r in legbones if (r["relx"] < 0) == (sign < 0)]
            side.sort(key=lambda r: -r["vox"])
            for rank, r in enumerate(side):
                r["bone"] = "tibia" if rank == 0 else "fibula"
                r["rule"] = ("largest bone reaching the bottom on this side"
                             if rank == 0 else
                             "smaller bone reaching the bottom on this side")
        # sanity: the fibula must be the more lateral of the pair
        for sign in (-1, 1):
            pair = [r for r in legbones if (r["relx"] < 0) == (sign < 0)]
            t = [r for r in pair if r["bone"] == "tibia"]
            f = [r for r in pair if r["bone"] == "fibula"]
            if t and f:
                ok = abs(f[0]["relx"]) > abs(t[0]["relx"])
                for r in pair:
                    r["laterality_check"] = ("PASS fibula is more lateral" if ok
                                             else "FAIL fibula is not the lateral bone")

    seg = np.zeros(vol.shape, np.uint8)
    for r in rows:
        if r["bone"] in LBL:
            seg[lab == r["idx"]] = LBL[r["bone"]]
    return seg, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", required=True)
    ap.add_argument("--out-vol", required=True)
    ap.add_argument("--out-seg", required=True)
    a = ap.parse_args()

    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from check_sources import require_clear
    require_clear("visible-human")
    import nibabel as nib

    files = sorted(glob.glob(os.path.join(a.raw_dir, "*.raw")),
                   key=lambda p: int(os.path.basename(p)[:-4]))
    if not files:
        raise SystemExit("no .raw slices in " + a.raw_dir)
    vol = np.stack([
        np.frombuffer(open(p, "rb").read()[HDR:], dtype=">u2")
          .reshape(DIM, DIM).astype(np.int32) - 1024 for p in files], axis=-1)
    vol = np.flip(np.transpose(vol, (1, 0, 2)), axis=0)   # match vhp_volume.stack

    legs = leg_mask(vol)
    seg, rows = classify(vol, legs)

    for r in sorted(rows, key=lambda r: -r["vox"]):
        print(f"  {str(r.get('bone')):7} vox={r['vox']:>7} z {r['zmin']:>3}..{r['zmax']:<3} "
              f"relx={r['relx']:+.2f} medHU={r['median_hu']:>4} "
              f"{r.get('laterality_check','')}")
    counts = {k: int((seg == v).sum()) for k, v in LBL.items()}
    print("voxels per label:", counts)

    aff = np.diag([0.9375, 0.9375, 1.0, 1.0])
    nib.save(nib.Nifti1Image(vol.astype(np.int16), aff), a.out_vol)
    nib.save(nib.Nifti1Image(seg.astype(np.uint16), aff), a.out_seg)
    print(f"wrote {a.out_vol} and {a.out_seg}")


if __name__ == "__main__":
    main()
