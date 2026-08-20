#!/usr/bin/env python3
"""Classical (no-ML) segmenter for Visible Human thorax CT.

Why not a neural segmenter: measured on this data, lung parenchyma reads -540 to
-570 HU where live clinical lung is -700 to -850 (cadaver lungs were never
inflated; the FRESH series measures the same). TotalSegmentator is trained on live
CT and would read that as consolidation, so lobar fissure detection is unreliable.
Soft tissue reads +49 HU, i.e. the calibration is fine — it is the lung that is
non-physiological.

So this labels only what high-contrast thresholding plus position can support
honestly, and deliberately does NOT claim:
  * lung LOBES  — needs visible fissures, which need aerated lung
  * LEFT vs RIGHT — two independent landmarks disagree on this cadaver (lung
    asymmetry says one thing, heart position the other, on an 8% margin), so no
    side is asserted anywhere
  * individual rib or vertebral levels — position alone cannot number them

Emits an integer label volume for build.py's pins_from_segmentation.
"""
import argparse, glob, os
import numpy as np
from scipy import ndimage

HDR = 3416
DIM = 512

LBL = {"lung": 1, "sternum": 2, "vertebra": 3, "rib": 4, "canal": 5}


def read_hu(path):
    raw = open(path, "rb").read()[HDR:]
    return np.frombuffer(raw, dtype=">u2").reshape(DIM, DIM).astype(np.int32) - 1024


def torso_mask(hu):
    """Largest solid component of tissue — the trunk. Arms arrive as separate
    components at this level and must stay excluded, or a humerus becomes a 'rib'."""
    m = hu > -300
    m = ndimage.binary_closing(m, np.ones((9, 9)))
    lab, k = ndimage.label(m)
    if k == 0:
        return np.zeros_like(m)
    sizes = ndimage.sum(m, lab, range(1, k + 1))
    torso = lab == (int(np.argmax(sizes)) + 1)
    return ndimage.binary_fill_holes(torso)


def segment_slice(hu):
    out = np.zeros((DIM, DIM), dtype=np.uint8)
    body = torso_mask(hu)
    if body.sum() < 5000:
        return out
    cols = np.where(body.any(axis=0))[0]
    rows = np.where(body.any(axis=1))[0]
    mid = int((cols.min() + cols.max()) / 2)

    # ---- lung: low density inside the trunk, generic (NO side asserted) ----
    # No binary_fill_holes here: it bridges the two lungs across the mediastinum and
    # swallows the heart into the "lung" label. Small internal holes (vessels) are
    # closed individually instead, which cannot cross the midline.
    lung = ndimage.binary_opening(body & (hu < -250), np.ones((5, 5)))
    llab, lk = ndimage.label(lung)
    lung_keep = np.zeros_like(lung)
    for i in range(1, lk + 1):
        c = llab == i
        if c.sum() < 1500:
            continue
        c = ndimage.binary_closing(c, np.ones((5, 5)))
        lung_keep |= c
    out[lung_keep] = LBL["lung"]

    # ---- bone ----
    # HU>200, then CLOSING (not opening): the sternal plate is only a few pixels
    # thick and a 3x3 opening erased it entirely, while >300 HU missed trabecular
    # bone in the vertebral body. Verified against the midline HU profile, which
    # shows the sternum at ~730 HU and the vertebral body at 695-963 HU.
    bone = body & (hu > 200)
    bone = ndimage.binary_closing(bone, np.ones((3, 3)))

    NEAR_MID = 45
    band = np.zeros_like(bone)
    band[:, max(0, mid - NEAR_MID):mid + NEAR_MID] = True
    mid_row = int((rows.min() + rows.max()) / 2)

    # Central bone forms two runs down the midline: the anterior one is the sternum,
    # the posterior one the vertebra. That is far more robust than picking components
    # by size, because both fragment at this contrast.
    clab, ck = ndimage.label(bone & band)
    cands = []
    for i in range(1, ck + 1):
        c = clab == i
        a = int(c.sum())
        if a < 60:
            continue
        cr, _ = ndimage.center_of_mass(c)
        cands.append((cr, a, c))
    if cands:
        ant = min(cands, key=lambda t: t[0])
        pos = max(cands, key=lambda t: t[0])
        if pos[0] > mid_row and pos[1] >= 150:
            out[pos[2]] = LBL["vertebra"]
            filled = ndimage.binary_fill_holes(pos[2])
            hole = filled & ~pos[2]
            hlab, hk = ndimage.label(hole)
            for i in range(1, hk + 1):
                c = hlab == i
                if 40 <= c.sum() <= 900:
                    out[c] = LBL["canal"]
        if ant is not pos and ant[0] < mid_row and ant[1] >= 80:
            out[ant[2]] = LBL["sternum"]

    # ribs: peripheral bone, but ONLY inside the rib cage. The arms are joined to the
    # trunk by a fat bridge, so they survive the "largest component" test, and a
    # humerus is well under the size cap -- it was being labelled a rib. The cage is
    # bounded by the pleural (lung) extent, which is derived from this slice rather
    # than hard-coded, with a fallback for slices above/below the lungs.
    if lung_keep.any():
        lc = np.where(lung_keep.any(axis=0))[0]
        cage_lo, cage_hi = lc.min() - 30, lc.max() + 30
    else:
        half = int(0.34 * (cols.max() - cols.min()))
        cage_lo, cage_hi = mid - half, mid + half

    rlab, rk = ndimage.label(bone & ~band)
    for i in range(1, rk + 1):
        c = rlab == i
        a = int(c.sum())
        if a < 60 or a > 2500:
            continue
        if out[c].any():
            continue
        _, cc = ndimage.center_of_mass(c)
        if cc < cage_lo or cc > cage_hi:
            continue                     # outside the rib cage: arm bone, not a rib
        out[c] = LBL["rib"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", required=True)
    ap.add_argument("--out-vol", required=True)
    ap.add_argument("--out-seg", required=True)
    a = ap.parse_args()

    import nibabel as nib
    files = sorted(glob.glob(os.path.join(a.raw_dir, "*.raw")), key=lambda p: int(os.path.basename(p)[:-4]))
    if not files:
        raise SystemExit("no .raw slices in " + a.raw_dir)

    nz = len(files)
    vol = np.zeros((DIM, DIM, nz), dtype=np.int16)
    seg = np.zeros((DIM, DIM, nz), dtype=np.uint8)
    for z, f in enumerate(files):
        hu = read_hu(f)
        s = segment_slice(hu)
        # Store as [X, Y, Z] with Y running posterior->anterior, which is what
        # orient.to_display expects; it reproduces the natural radiological view.
        vol[:, :, z] = np.flipud(hu).T.astype(np.int16)
        seg[:, :, z] = np.flipud(s).T

    # Crop to the body, using ONE box for the whole volume: a per-slice box would make
    # the anatomy jump while scrubbing. Image and mask are cropped by the identical box,
    # so every pin coordinate stays valid — that invariant is the whole point of orient.py.
    # Crop to the LABELLED anatomy, not to all tissue: the arms span the full width and
    # defeat a body-based crop (512 -> 512). The segmentation already excludes arm bone,
    # so its bounding box is the thorax. Cropping the arms is normal for a chest study.
    occupied = (seg > 0).any(axis=2)
    if not occupied.any():
        occupied = (vol > -300).any(axis=2)
    xs = np.where(occupied.any(axis=1))[0]
    ys = np.where(occupied.any(axis=0))[0]
    if xs.size and ys.size:
        m = 22
        x0, x1 = max(0, xs.min() - m), min(DIM, xs.max() + 1 + m)
        y0, y1 = max(0, ys.min() - m), min(DIM, ys.max() + 1 + m)
        # A chest cross-section is genuinely wider than tall (aspect ~1.66). On a portrait
        # phone, minus two label gutters, that leaves a postage stamp. So PAD the short
        # axis toward square rather than cropping anatomy away — nothing is lost, the
        # image just gets a bigger share of the screen.
        TARGET = 1.15
        w_, h_ = x1 - x0, y1 - y0
        if w_ / max(h_, 1) > TARGET:
            want = int(w_ / TARGET)
            grow = (want - h_) // 2
            y0, y1 = max(0, y0 - grow), min(DIM, y1 + grow)
        vol = vol[x0:x1, y0:y1, :]
        seg = seg[x0:x1, y0:y1, :]
        print(f"cropped to body: x {x0}..{x1} y {y0}..{y1} -> {vol.shape[0]}x{vol.shape[1]}")

    # 0.9375 mm in-plane, 1 mm slices — read from the GE header, not assumed.
    aff = np.diag([0.9375, 0.9375, 1.0, 1.0])
    nib.save(nib.Nifti1Image(vol, aff), a.out_vol)
    nib.save(nib.Nifti1Image(seg, aff), a.out_seg)
    counts = {k: int((seg == v).sum()) for k, v in LBL.items()}
    print("slices:", nz, "\nvoxels per label:", counts)
    per = {k: int(sum(1 for z in range(nz) if (seg[:, :, z] == v).any())) for k, v in LBL.items()}
    print("slices containing each label:", per)


if __name__ == "__main__":
    main()
