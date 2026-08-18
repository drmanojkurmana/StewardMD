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
    picks = pick_slice_indices(vol.shape[2], n_wanted)
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
