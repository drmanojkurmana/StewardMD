"""Volume -> display-ready webp slices.

Every array leaves here having passed through orient.to_display and
orient.resize_to_square_pixels, and build.py applies the SAME two functions with the
same arguments to the label masks. That shared path is what guarantees pins land on
their structures.
"""
import os

import numpy as np
from PIL import Image

from check_sources import require_clear
from orient import to_display, physical_aspect, resize_to_square_pixels

THUMB_H = 128
DISPLAY_H = 900
WEBP_Q = 82

# Conventional display windows, in HU. CT only.
WINDOWS = {
    "brain": (40, 80),
    "soft-tissue": (50, 400),
    "lung": (-600, 1500),
    "bone": (400, 1800),
    "mediastinum": (50, 350),
}


def apply_window(arr, center, width):
    """HU (or raw MR intensity) -> 0..1 float for display."""
    a = np.asarray(arr, dtype=np.float32)
    if not width:
        width = 1.0
    lo = center - width / 2.0
    hi = center + width / 2.0
    if hi <= lo:
        hi = lo + 1.0
    return np.clip((a - lo) / (hi - lo), 0.0, 1.0)


def pick_slice_indices(n_available, n_wanted):
    """Evenly spaced indices including both ends — the reference stack is 24 slices
    spanning the whole volume, not a contiguous run."""
    if n_available <= 0:
        return []
    if n_available <= n_wanted:
        return list(range(n_available))
    return [int(round(i * (n_available - 1) / (n_wanted - 1))) for i in range(n_wanted)]


def visible_slices(vol, window, frac=0.0005):
    """First and last z index that renders as something, so the 24-slice stack is not
    spent on frames the viewer shows as pure black.

    Blankness is a property of the WINDOW, not of the voxels. A coronal plane through the
    hand can be full of soft tissue and still render solid black under a bone window, so
    thresholding the raw volume misses it - that is why the first version of this trim left
    ct-hand-coronal with blank frames, merely different ones. Measure what will actually be
    displayed: apply the same window, then keep the z-range that has visible pixels.
    """
    v = np.asanyarray(vol)
    if v.shape[2] == 0:
        return np.arange(0)
    if window is None:
        lo, hi = np.percentile(v, [1.0, 99.5])
        g = np.clip((v - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    else:
        c, wd = WINDOWS[window] if isinstance(window, str) else window
        g = apply_window(v, c, wd)
    frac_visible = (g > 0.06).mean(axis=(0, 1))
    nz = np.flatnonzero(frac_visible > frac)
    if nz.size == 0:                      # nothing visible anywhere: fall back to the lot
        return np.arange(v.shape[2])
    return nz


def extract_slices(nifti_path, out_dir, module_id, n_wanted, window, source_id):
    """Write NNN.webp and t/NNN.webp; return slice stubs for build.py.

    The returned _z and _shape let the mask path reproduce this geometry exactly.
    """
    require_clear(source_id)
    import nibabel as nib

    img = nib.load(nifti_path)
    vol = np.asanyarray(img.dataobj)
    zooms = img.header.get_zooms()[:3]

    os.makedirs(os.path.join(out_dir, "t"), exist_ok=True)
    # Sample only where there is anatomy. Without this the stack spends slices on empty
    # margins and ships pure-black frames (ct-hand-coronal shipped six in a row).
    vis = visible_slices(vol, window)
    picks = [int(vis[i]) for i in pick_slice_indices(len(vis), n_wanted)]
    # Display spacing after to_display (which transposes): rows = Y, cols = X.
    spacing_disp = (zooms[1], zooms[0])

    out = []
    for n, z in enumerate(picks, start=1):
        disp = to_display(vol[:, :, z])
        disp = resize_to_square_pixels(disp, spacing_disp, DISPLAY_H)

        if window is None:                      # MR: percentile stretch, no HU scale
            lo, hi = np.percentile(disp, [1.0, 99.5])
            g = np.clip((disp - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
        else:
            c, wd = WINDOWS[window] if isinstance(window, str) else window
            g = apply_window(disp, c, wd)

        pil = Image.fromarray((g * 255.0).astype(np.uint8), mode="L")
        name = "%03d.webp" % n
        pil.save(os.path.join(out_dir, name), "WEBP", quality=WEBP_Q)
        tw = max(1, int(round(THUMB_H * pil.width / pil.height)))
        pil.resize((tw, THUMB_H)).save(os.path.join(out_dir, "t", name), "WEBP", quality=80)

        out.append({
            "i": n,
            "img": "/atlas/%s/%s" % (module_id, name),
            "aspect": round(float(pil.width) / float(pil.height), 4),
            "_z": int(z),
            "_shape": (pil.height, pil.width),
        })
    return out
