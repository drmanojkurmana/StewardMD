#!/usr/bin/env python3
"""Visible Human raw slices -> NIfTI, and the identical crop of an image/label pair.

Two jobs, both about ONE invariant: the image and its label mask must be cropped by
the same box, or every pin lands somewhere else. Keeping both operations here means a
caller cannot accidentally crop one and not the other.
"""
import argparse, glob, os
import numpy as np

HDR, DIM = 3416, 512
# From the GE header, not assumed: 0.9375 mm in-plane (480 mm FOV / 512), 1 mm slices.
SPACING = (0.9375, 0.9375, 1.0)


def read_hu(path):
    return np.frombuffer(open(path, "rb").read()[HDR:], dtype=">u2").reshape(DIM, DIM).astype(np.int32) - 1024


def stack(raw_dir):
    """Store as [X, Y, Z] with Y running posterior->anterior, which is what
    orient.to_display expects; it then reproduces the natural radiological view."""
    files = sorted(glob.glob(os.path.join(raw_dir, "*.raw")), key=lambda p: int(os.path.basename(p)[:-4]))
    if not files:
        raise SystemExit("no .raw slices in " + raw_dir)
    vol = np.zeros((DIM, DIM, len(files)), dtype=np.int16)
    for z, f in enumerate(files):
        vol[:, :, z] = np.flipud(read_hu(f)).T.astype(np.int16)
    return vol, files


def crop_pair(vol, seg, margin=22, target_aspect=1.15):
    """Crop both arrays by ONE box around the labelled anatomy, then PAD the short axis
    toward target_aspect. Padding rather than cropping means no anatomy is lost while the
    image still earns a decent share of a portrait screen."""
    occupied = (seg > 0).any(axis=2)
    if not occupied.any():
        occupied = (vol > -300).any(axis=2)
    xs, ys = np.where(occupied.any(axis=1))[0], np.where(occupied.any(axis=0))[0]
    x0, x1 = max(0, xs.min() - margin), min(vol.shape[0], xs.max() + 1 + margin)
    y0, y1 = max(0, ys.min() - margin), min(vol.shape[1], ys.max() + 1 + margin)
    w, h = x1 - x0, y1 - y0
    if w / max(h, 1) > target_aspect:
        grow = (int(w / target_aspect) - h) // 2
        y0, y1 = max(0, y0 - grow), min(vol.shape[1], y1 + grow)
    return vol[x0:x1, y0:y1, :], seg[x0:x1, y0:y1, :], (x0, x1, y0, y1)


def reformat(vol, seg, plane, spacing=SPACING):
    """Re-slice an axial [X, Y, Z] pair into another plane, transposing BOTH identically.

    Array convention in / out is [display-col axis, display-row axis (increasing UPWARD),
    slice axis], because orient.to_display() does flipud(a.T) — so keeping that convention
    means the whole downstream pipeline works on a reformatted volume unchanged, pins and
    all. Input axes: X = patient left->right, Y = posterior->anterior, Z = slice index
    with 0 most SUPERIOR (VHP numbering increases inferiorly).

    Returns (vol, seg, (col_spacing, row_spacing, slice_spacing)).
    """
    sx, sy, sz = spacing
    if plane == "axial":
        return vol, seg, (sx, sy, sz)

    if plane == "coronal":
        # cols = X (left-right), rows = superior-up (so flip Z), slices = Y anterior->posterior
        v = np.flip(np.transpose(vol, (0, 2, 1)), axis=1)
        g = np.flip(np.transpose(seg, (0, 2, 1)), axis=1)
        v, g = np.flip(v, axis=2), np.flip(g, axis=2)      # slice order A -> P
        return v, g, (sx, sz, sy)

    if plane == "sagittal":
        # cols = anterior on the LEFT (so flip Y), rows = superior-up (flip Z), slices = X
        v = np.flip(np.flip(np.transpose(vol, (1, 2, 0)), axis=0), axis=1)
        g = np.flip(np.flip(np.transpose(seg, (1, 2, 0)), axis=0), axis=1)
        return v, g, (sy, sz, sx)

    raise SystemExit("plane must be axial, coronal or sagittal")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("stack"); b.add_argument("--raw-dir", required=True); b.add_argument("--out", required=True)
    r = sub.add_parser("reformat")
    r.add_argument("--vol", required=True); r.add_argument("--seg", required=True)
    r.add_argument("--plane", required=True, choices=["axial", "coronal", "sagittal"])
    r.add_argument("--out-vol", required=True); r.add_argument("--out-seg", required=True)
    r.add_argument("--spacing", default=None, help="cx,cy,cz of the INPUT axial volume")

    c = sub.add_parser("crop")
    c.add_argument("--vol", required=True); c.add_argument("--seg", required=True)
    c.add_argument("--out-vol", required=True); c.add_argument("--out-seg", required=True)
    a = ap.parse_args()
    import nibabel as nib
    aff = np.diag(list(SPACING) + [1.0])

    if a.cmd == "reformat":
        vol = np.asanyarray(nib.load(a.vol).dataobj)
        seg = np.asanyarray(nib.load(a.seg).dataobj)
        sp = tuple(float(x) for x in a.spacing.split(",")) if a.spacing else SPACING
        v, g, out_sp = reformat(vol, seg, a.plane, sp)
        v, g, box = crop_pair(v, g)
        aff2 = np.diag(list(out_sp) + [1.0])
        nib.save(nib.Nifti1Image(v.astype(np.int16), aff2), a.out_vol)
        nib.save(nib.Nifti1Image(g.astype(np.uint16), aff2), a.out_seg)
        print("%s: %s spacing %s aspect %.2f labels %d"
              % (a.plane, v.shape, tuple(round(x, 4) for x in out_sp),
                 v.shape[0] / v.shape[1], len(np.unique(g)) - 1))
        return

    if a.cmd == "stack":
        vol, files = stack(a.raw_dir)
        nib.save(nib.Nifti1Image(vol, aff), a.out)
        print("stacked %d slices -> %s  shape %s" % (len(files), a.out, vol.shape))
    else:
        vol = np.asanyarray(nib.load(a.vol).dataobj)
        seg = np.asanyarray(nib.load(a.seg).dataobj)
        if seg.shape != vol.shape:
            raise SystemExit("shape mismatch: vol %s vs seg %s" % (vol.shape, seg.shape))
        v, s, box = crop_pair(vol, seg)
        nib.save(nib.Nifti1Image(v.astype(np.int16), aff), a.out_vol)
        nib.save(nib.Nifti1Image(s.astype(np.uint16), aff), a.out_seg)
        print("cropped x %d..%d y %d..%d -> %dx%d (aspect %.2f), labels kept: %d"
              % (box[0], box[1], box[2], box[3], v.shape[0], v.shape[1],
                 v.shape[0] / v.shape[1], len(np.unique(s)) - 1))


if __name__ == "__main__":
    main()
