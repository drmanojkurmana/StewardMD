#!/usr/bin/env python3
"""Classical (no-ML) segmenter for the Visible Human ankle and foot.

Labels: TIBIA, FIBULA, TARSAL BONE, METATARSAL BONE, PHALANX OF FOOT — as GROUPS, not as
individually named bones. See the honesty note at the bottom for why.

WHY CLASSICAL: `appendicular_bones` (the only model with tarsals, metatarsals and
phalanges) is licence-gated, and VISTA3D has none of them. Bone contrast is the one thing
this frozen cadaver reproduces faithfully.

THE PROBLEM THIS FILE SOLVES. Unlike the knee, a 300 HU threshold FUSES the whole foot
skeleton into one blob: measured, 223735 and 217858 voxels spanning nearly the entire crop,
one component per foot. The tarsal joints are too tight at 0.9 mm for the joint space to
break the connection. Raising the threshold to 600 HU — cortical bone only — separates them
into 29 components, which is the right order for 2 x (7 tarsals + 5 metatarsals + 14
phalanges) with the smallest phalanges falling under the floor.

CLASSIFICATION IS BY Z-CENTROID, and the data chose the boundaries, not me. Sorting the
components proximal to distal produced three clean GAPS with nothing in them:

  zc  24, 24, 26, 27              tibia (12987, 11701) + fibula (4412, 4764)
      ---- gap 27 -> 51 ----
  zc  51 .. 97   (13 components)  tarsals, incl. calcaneus 31181 and talus 17142
      ---- gap 97 -> 111 ----
  zc  111 .. 143 (12 components)  metatarsals, dz 40-55 = elongated shafts
      ---- gap 143 -> 156 ----
  zc  156                         phalanx

Anatomically this is simply the tarsus-metatarsus-phalanx sequence along the foot, which is
available because the cadaver's feet are plantarflexed: their long axis runs along the body
axis, so body-axial slices cut the foot proximal to distal. Tibia and fibula are told apart
by SIZE, the same 3x rule that worked at the knee, and never by side.

WHAT IS NOT CLAIMED — and this is the important part. Individual bones are NOT named. There
is no `calcaneus`, `talus`, `navicular`, `cuboid`, `cuneiform`, `first metatarsal` or
`proximal phalanx`. Naming them needs each bone matched to its neighbours by articulation,
and a z-centroid cannot do that: it can say a component is a tarsal, not WHICH tarsal.
Calcaneus and talus are individually obvious to a human eye in these images, but "obvious to
me" is not a segmentation rule, and a mislabelled cuneiform teaches wrong anatomy. Group
labels are what the geometry supports, so group labels are what ship.

Emits an integer label volume for build.py's pins_from_segmentation.
"""
import argparse
import glob
import os

import numpy as np
from scipy import ndimage

HDR = 3416
DIM = 512
LBL = {"tibia": 1, "fibula": 2, "tarsal": 3, "metatarsal": 4, "phalanx-foot": 5}

CORTICAL_HU = 600      # 300 fuses the whole foot into one component; 600 separates it
MIN_VOX = 300
FOOT_MIN_PX = 1200


def foot_mask(vol):
    """The two largest body components per slice: the feet, excluding the container."""
    out = np.zeros(vol.shape, bool)
    for z in range(vol.shape[2]):
        b = ndimage.binary_fill_holes(
            ndimage.binary_closing(vol[:, :, z] > -300, np.ones((5, 5))))
        lab, k = ndimage.label(b)
        if not k:
            continue
        sizes = ndimage.sum(b, lab, range(1, k + 1))
        for i in np.argsort(sizes)[-2:]:
            if sizes[i] > FOOT_MIN_PX:
                out[:, :, z] |= (lab == i + 1)
    return out


def split_by_gaps(zcs, n_expected=3):
    """Find the n_expected widest gaps in a sorted list of z-centroids.

    Boundaries come from the DATA rather than being hard-coded, so a different crop or a
    differently positioned foot still splits at its own joints instead of at my constants.
    """
    if len(zcs) < n_expected + 1:
        return []
    gaps = sorted(((zcs[i + 1] - zcs[i], i) for i in range(len(zcs) - 1)),
                  reverse=True)[:n_expected]
    cuts = sorted((zcs[i] + zcs[i + 1]) / 2.0 for _, i in gaps)
    return cuts


def classify(vol, feet):
    bone = (vol > CORTICAL_HU) & feet
    lab, k = ndimage.label(bone)
    if not k:
        return np.zeros(vol.shape, np.uint8), [], []
    sizes = ndimage.sum(bone, lab, range(1, k + 1))
    nz = vol.shape[2]

    comps = []
    for i, s in enumerate(sizes, start=1):
        if s < MIN_VOX:
            continue
        m = lab == i
        prof = m.sum(axis=(0, 1))
        zc = float(np.average(np.arange(nz), weights=prof))
        zs = np.where(prof > 0)[0]
        comps.append({"idx": i, "vox": int(s), "zc": zc,
                      "dz": int(zs.max() - zs.min() + 1)})
    if not comps:
        return np.zeros(vol.shape, np.uint8), [], []

    comps.sort(key=lambda c: c["zc"])
    # TWO gaps, not three. Asking for three picked a spurious 13-unit gap inside the
    # tarsus (z 61 -> 74) that tied with the real metatarsophalangeal one (143 -> 156) and
    # won, which pushed the navicular/cuboid/cuneiforms into the metatarsal band. The
    # ankle and the tarsometatarsal joints ARE clean gaps; the metatarsophalangeal one is
    # not, because the toes curl and overlap in z. So z decides the first two boundaries
    # and SHAPE decides the last.
    cuts = split_by_gaps([c["zc"] for c in comps], 2)
    for c in comps:
        b = sum(1 for cut in cuts if c["zc"] > cut)
        if b == 0:
            c["band"] = "leg"
        elif b == 1:
            c["band"] = "tarsal"
        else:
            # measured: metatarsal shafts run dz 40-55 slices; phalanges dz 13-26.
            c["band"] = "metatarsal" if c["dz"] >= 38 else "phalanx-foot"

    # the most proximal band is tibia + fibula; SIZE tells them apart, never side
    leg = [c for c in comps if c["band"] == "leg"]
    leg.sort(key=lambda c: -c["vox"])
    for rank, c in enumerate(leg):
        c["bone"] = "tibia" if rank < 2 else "fibula"
        c["rule"] = ("one of the two largest components in the most proximal band"
                     if rank < 2 else "smaller component in the most proximal band")
    for c in comps:
        if c["band"] != "leg":
            c["bone"] = c["band"]
            c["rule"] = f"z-centroid {c['zc']:.0f} falls in the {c['band']} band"

    seg = np.zeros(vol.shape, np.uint8)
    for c in comps:
        if c["bone"] in LBL:
            seg[lab == c["idx"]] = LBL[c["bone"]]
    return seg, comps, cuts


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
    vol = np.flip(np.transpose(vol, (1, 0, 2)), axis=0)

    feet = foot_mask(vol)
    seg, comps, cuts = classify(vol, feet)

    print("band boundaries chosen from the data (z):", [round(c, 1) for c in cuts])
    from collections import Counter
    print("components per label:", dict(Counter(c["bone"] for c in comps)))
    for c in comps:
        print(f"  {c['bone']:13} vox={c['vox']:>6} zc={c['zc']:>5.0f}")
    print("voxels per label:", {k: int((seg == v).sum()) for k, v in LBL.items()})

    aff = np.diag([0.9375, 0.9375, 1.0, 1.0])
    nib.save(nib.Nifti1Image(vol.astype(np.int16), aff), a.out_vol)
    nib.save(nib.Nifti1Image(seg.astype(np.uint16), aff), a.out_seg)
    print(f"wrote {a.out_vol} and {a.out_seg}")


if __name__ == "__main__":
    main()
