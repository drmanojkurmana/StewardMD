#!/usr/bin/env python3
"""Classical segmenter for Visible Human HEAD CT.

Air-bone contrast is the strongest and most trustworthy signal in cadaver CT, which is
why the head yields more than the abdomen does classically. What is claimed here is
only what that contrast supports:

  * Skull     - all bone in the head. Per Terminologia Anatomica the skull comprises
                 the neurocranium AND the viscerocranium (facial bones, mandible), so
                 labelling all head bone "Skull" is correct, not a shortcut.
  * Air cells - enclosed air: paranasal sinuses and mastoid air cells. WHICH sinus would
                 be a position guess, so it is not asserted.

BRAIN WAS TRIED AND REMOVED. Detection flickered between adjacent slices because the
temporal squama here falls under the bone threshold, so the skull ring is open in 2D and
fill_holes leaked to the scalp (slice 1080 "cavity" measured mean -66 HU; 1100 enclosed
nothing). CT also cannot show internal brain anatomy - grey/white differ by ~10 HU even
in life - which is why the reference app uses MRI for brain. Cervical vertebra was also
removed: it fired on 135 of 201 slices, labelling skull-base bone as vertebra.

No left/right anywhere, for the same reason as the thorax module.
"""
import argparse, glob, os
import numpy as np
from scipy import ndimage

HDR, DIM = 3416, 512
LBL = {"skull": 1, "air_cell": 2}


def read_hu(p):
    return np.frombuffer(open(p, "rb").read()[HDR:], dtype=">u2").reshape(DIM, DIM).astype(np.int32) - 1024


def torso_mask(hu):
    m = ndimage.binary_closing(hu > -300, np.ones((7, 7)))
    lab, k = ndimage.label(m)
    if k == 0:
        return np.zeros_like(m)
    sz = ndimage.sum(m, lab, range(1, k + 1))
    return ndimage.binary_fill_holes(lab == (int(np.argmax(sz)) + 1))


def segment_slice(hu):
    out = np.zeros((DIM, DIM), dtype=np.uint8)
    body = torso_mask(hu)
    if body.sum() < 4000:
        return out
    rows = np.where(body.any(axis=1))[0]
    cols = np.where(body.any(axis=0))[0]
    mid = int((cols.min() + cols.max()) / 2)
    mid_row = int((rows.min() + rows.max()) / 2)

    bone = ndimage.binary_closing(body & (hu > 200), np.ones((3, 3)))

    # --- skull: ALL bone in the head. In Terminologia Anatomica the skull comprises the
    # neurocranium AND the viscerocranium including the mandible, so this is correct
    # rather than a compromise. Trying to isolate the cranial vault alone was tried and
    # removed: detection flickered on and off between adjacent slices (fired at 1025-1045,
    # died to 1115, returned at 1125) because the temporal squama in this frozen cadaver
    # falls below the bone threshold, leaving the ring open so fill_holes leaked to scalp.
    blab, bk = ndimage.label(bone)
    for i in range(1, bk + 1):
        c = blab == i
        if c.sum() >= 120:
            out[c] = LBL["skull"]

    # --- enclosed air: paranasal sinuses and mastoid air cells. Air OUTSIDE the head is
    # excluded by the body mask, so only enclosed pockets survive. WHICH sinus (frontal,
    # maxillary, sphenoid, ethmoid) would be a position guess and is NOT asserted.
    air = ndimage.binary_opening(body & (hu < -400), np.ones((3, 3)))
    alab, ak = ndimage.label(air)
    for i in range(1, ak + 1):
        c = alab == i
        a = int(c.sum())
        if a < 80 or a > 9000:
            continue
        if out[c].any():
            continue
        out[c] = LBL["air_cell"]

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", required=True)
    ap.add_argument("--out-vol", required=True)
    ap.add_argument("--out-seg", required=True)
    a = ap.parse_args()
    import nibabel as nib
    from vhp_volume import SPACING, crop_pair

    files = sorted(glob.glob(os.path.join(a.raw_dir, "*.raw")), key=lambda p: int(os.path.basename(p)[:-4]))
    vol = np.zeros((DIM, DIM, len(files)), dtype=np.int16)
    seg = np.zeros((DIM, DIM, len(files)), dtype=np.uint8)
    for z, f in enumerate(files):
        hu = read_hu(f)
        vol[:, :, z] = np.flipud(hu).T.astype(np.int16)
        seg[:, :, z] = np.flipud(segment_slice(hu)).T
    vol, seg, box = crop_pair(vol, seg)
    aff = np.diag(list(SPACING) + [1.0])
    nib.save(nib.Nifti1Image(vol, aff), a.out_vol)
    nib.save(nib.Nifti1Image(seg.astype(np.uint16), aff), a.out_seg)
    print("slices:", len(files), "cropped to %dx%d" % (vol.shape[0], vol.shape[1]))
    print("voxels:", {k: int((seg == v).sum()) for k, v in LBL.items()})
    print("slices w/ label:", {k: int(sum(1 for z in range(seg.shape[2]) if (seg[:, :, z] == v).any())) for k, v in LBL.items()})


if __name__ == "__main__":
    main()
