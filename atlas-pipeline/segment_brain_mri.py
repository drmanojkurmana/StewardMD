#!/usr/bin/env python3
"""Classical tissue segmenter for Visible Human brain T1 MRI.

T1 grey/white contrast on this series is genuinely good (verified visually), so
intensity-based tissue classification -- the textbook approach on T1 -- supports:

  * Cerebral white matter  - the bright interior
  * Cerebral cortex        - the intermediate-intensity ribbon at the brain surface
  * Lateral ventricle      - dark CSF enclosed within the white matter

What is NOT claimed: individual nuclei (thalamus, putamen, caudate, hippocampus) and
named white-matter tracts. Those are defined by LOCATION, not intensity -- they sit in
the same intensity band as the surrounding tissue -- so naming them from intensity
alone would be a guess. They need an atlas-based model (SynthSeg / FastSurfer) or
hand-authoring. No left/right is asserted, as in the other modules.

MRI has no absolute calibration (unlike CT's Hounsfield scale), so all thresholds are
percentiles OF THE BRAIN ITSELF, never fixed intensities.
"""
import argparse, glob, os
import numpy as np
from scipy import ndimage

HDR, DIM = 7900, 256
LBL = {"white-matter": 1, "cortex": 2, "lateral-ventricle": 3}


def read_slice(path):
    return np.frombuffer(open(path, "rb").read()[HDR:], dtype=">u2").reshape(DIM, DIM).astype(np.float32)


def brain_mask(vol):
    """Extract the brain in 3D. Scalp and skull marrow are also bright on T1, but a dark
    CSF/skull layer separates them from the brain, so the brain survives as its own
    component once thin bridges are eroded."""
    p = np.percentile(vol[vol > 0], 55) if (vol > 0).any() else 0
    m = vol > p
    # Erode HARD in-plane. On T1 the scalp and skull marrow are bright too, separated
    # from the brain only by a thin dark skull/CSF ring; a weak erosion leaves bridges
    # and the "brain" mask swallows the scalp, which then poisons every percentile
    # threshold computed from it (measured: cortex 7.8k vox, ventricle 113k -- both wrong).
    m = ndimage.binary_erosion(m, np.ones((3, 3, 1)), iterations=6)
    lab, k = ndimage.label(m)
    if k == 0:
        return np.zeros_like(m)
    sizes = ndimage.sum(m, lab, range(1, k + 1))
    m = lab == (int(np.argmax(sizes)) + 1)
    m = ndimage.binary_dilation(m, np.ones((3, 3, 1)), iterations=5)
    for z in range(m.shape[2]):
        m[:, :, z] = ndimage.binary_fill_holes(m[:, :, z])
    return m


def segment(vol):
    out = np.zeros(vol.shape, dtype=np.uint8)
    brain = brain_mask(vol)
    if brain.sum() < 5000:
        return out, brain
    vals = vol[brain]
    # percentiles OF THE BRAIN: MRI intensity has no absolute scale
    lo, hi = np.percentile(vals, 25), np.percentile(vals, 70)

    wm = brain & (vol >= hi)
    wm = ndimage.binary_opening(wm, np.ones((3, 3, 1)))
    out[wm] = LBL["white-matter"]

    cortex = brain & (vol >= lo) & (vol < hi)
    # the cortex is the OUTER ribbon; interior intermediate voxels are not cortex
    rim = brain & ~ndimage.binary_erosion(brain, np.ones((7, 7, 1)))
    cortex = cortex & ndimage.binary_dilation(rim, np.ones((5, 5, 1)))
    cortex = ndimage.binary_opening(cortex, np.ones((3, 3, 1)))
    out[cortex] = LBL["cortex"]

    # ventricles: dark CSF ENCLOSED by white matter, so peripheral dark voxels
    # (sulcal CSF, background) are excluded by requiring a white-matter surround
    dark = brain & (vol < lo)
    inner = ndimage.binary_erosion(brain, np.ones((15, 15, 1)))
    for z in range(vol.shape[2]):
        d = dark[:, :, z] & inner[:, :, z]
        d = ndimage.binary_opening(d, np.ones((2, 2)))
        lab, k = ndimage.label(d)
        for i in range(1, k + 1):
            c = lab == i
            if c.sum() >= 25:
                out[:, :, z][c] = LBL["lateral-ventricle"]
    return out, brain


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", required=True)
    ap.add_argument("--out-vol", required=True)
    ap.add_argument("--out-seg", required=True)
    a = ap.parse_args()
    import nibabel as nib
    from vhp_volume import crop_pair

    fs = sorted(glob.glob(os.path.join(a.raw_dir, "*.raw")), key=lambda p: int(os.path.basename(p)[:-4]))
    vol = np.zeros((DIM, DIM, len(fs)), dtype=np.float32)
    for z, f in enumerate(fs):
        vol[:, :, z] = np.flipud(read_slice(f)).T
    seg, brain = segment(vol)
    v16 = vol.astype(np.int16)
    v16, seg, box = crop_pair(v16, seg, margin=10, target_aspect=1.15)
    aff = np.diag([1.01562, 1.01562, 4.0, 1.0])
    nib.save(nib.Nifti1Image(v16, aff), a.out_vol)
    nib.save(nib.Nifti1Image(seg.astype(np.uint16), aff), a.out_seg)
    print("slices:", len(fs), "cropped to %dx%d" % (v16.shape[0], v16.shape[1]))
    print("voxels:", {k: int((seg == v).sum()) for k, v in LBL.items()})
    print("slices w/ label:", {k: int(sum(1 for z in range(seg.shape[2]) if (seg[:, :, z] == v).any())) for k, v in LBL.items()})


if __name__ == "__main__":
    main()
