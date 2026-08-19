#!/usr/bin/env python3
"""Classical (no-ML) segmenter for the Visible Human hand and wrist.

Labels ONE structure: BONE OF THE HAND. That is deliberate, and the reason is the point of
this file.

WHY NOT CARPAL / METACARPAL / PHALANX. The foot worked because the cadaver's feet are
plantarflexed: their long axis runs along the body axis, so body-axial slices cut them
proximal to distal and the tarsus, metatarsus and phalanges fall into three z-bands
separated by clean gaps. The hands do NOT lie that way. They rest flat against the thighs,
and the whole hand occupies only VHP 1805-1885 — 81 slices, about 8 cm, which is a hand's
WIDTH, not its 19 cm length. So axial slices cut ACROSS the hand and no z-banding exists.

Two attempts to recover the groups anyway, both recorded because both failed:
  * SIZE: at 600 HU the 21 components span 1180-2681 voxels, near-uniform. A carpal, a
    metacarpal and a phalanx are not separable by volume here.
  * PCA along each hand's own long axis: the projected centroids produced scattered gaps
    (23.0, 7.3, 7.5, 15.9, 26.3, 18.5, 6.1, 23.3, 0.7) with no three-band structure, and
    the dominant axis it returned was contaminated by the left/right split used to
    separate the two hands in the first place.

So the geometry supports "this is a bone of the hand" and nothing finer. Naming individual
carpals needs articulation-based matching, which needs the licensed `appendicular_bones`
model or hand-authoring in atlas-author.html. A module that says `metacarpal` when it
cannot tell a metacarpal from a proximal phalanx would teach wrong anatomy, so it does not.

The 600 HU cortical threshold is used for the same reason as the foot: at 250 HU the hand
skeleton fuses into 8 blobs (28323 and 25661 voxels among them), at 600 HU it separates
into 21 individually sensible bones.
"""
import argparse
import glob
import os

import numpy as np
from scipy import ndimage

HDR = 3416
DIM = 512
LBL = {"hand-bone": 1}

CORTICAL_HU = 600
MIN_VOX = 200
HAND_PX_MIN, HAND_PX_MAX = 800, 20000     # a hand cross-section; the torso is far larger


def hand_mask(vol):
    """Body components that are hand-sized, per slice. The LARGEST component on these
    slices is the torso or thigh and is always excluded."""
    out = np.zeros(vol.shape, bool)
    for z in range(vol.shape[2]):
        b = ndimage.binary_fill_holes(
            ndimage.binary_closing(vol[:, :, z] > -300, np.ones((5, 5))))
        lab, k = ndimage.label(b)
        if not k:
            continue
        sizes = ndimage.sum(b, lab, range(1, k + 1))
        for i in np.argsort(sizes)[::-1][1:]:
            if HAND_PX_MIN < sizes[i] < HAND_PX_MAX:
                out[:, :, z] |= (lab == i + 1)
    return out


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

    hands = hand_mask(vol)
    bone = (vol > CORTICAL_HU) & hands
    lab, k = ndimage.label(bone)
    seg = np.zeros(vol.shape, np.uint8)
    kept = 0
    if k:
        sizes = ndimage.sum(bone, lab, range(1, k + 1))
        for i, s in enumerate(sizes, start=1):
            if s < MIN_VOX:
                continue
            m = lab == i
            med = int(np.median(vol[m]))
            if med < CORTICAL_HU:          # must actually be bone-dense, not a partial edge
                continue
            seg[m] = LBL["hand-bone"]
            kept += 1
    print(f"hand mask voxels: {int(hands.sum())}")
    print(f"bone components kept: {kept}  (a hand pair has 54 bones; this crop covers "
          f"~8 cm of hand width, so a subset is expected)")
    print(f"labelled voxels: {int((seg > 0).sum())}")

    aff = np.diag([0.9375, 0.9375, 1.0, 1.0])
    nib.save(nib.Nifti1Image(vol.astype(np.int16), aff), a.out_vol)
    nib.save(nib.Nifti1Image(seg.astype(np.uint16), aff), a.out_seg)
    print(f"wrote {a.out_vol} and {a.out_seg}")


if __name__ == "__main__":
    main()
