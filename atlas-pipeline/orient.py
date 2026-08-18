"""The single authority on slice orientation and aspect.

Every 2D array — image or label mask — passes through to_display() before anything
else touches it. A mirrored mask would place every pin on the CONTRALATERAL structure
and still look anatomically plausible, so this is deliberately the only place the
question is answered, and it has its own test.
"""
import numpy as np


def to_display(arr2d):
    """Raw axial slab (X = patient left->right, Y = posterior->anterior) to radiological
    display: rows = Y with anterior at the top, cols = X with patient left on the
    image right."""
    a = np.asarray(arr2d)
    return np.flipud(a.T)


def physical_aspect(shape_disp, spacing_disp):
    """width/height in PHYSICAL units. Voxels are rarely cubic, so pixel counts alone
    would render the anatomy squashed."""
    h, w = shape_disp[0], shape_disp[1]
    sy = spacing_disp[0] if spacing_disp[0] else 1.0
    sx = spacing_disp[1] if spacing_disp[1] else 1.0
    ph, pw = h * sy, w * sx
    if ph <= 0:
        return 1.0
    return float(pw) / float(ph)


def resize_to_square_pixels(arr2d, spacing_disp, target_h):
    """Resample so one output pixel is square in physical space.

    Nearest-neighbour throughout: masks must not be interpolated into invented
    labels, and using ONE path for both image and mask keeps their geometry
    identical — which is the whole point of this module.
    """
    a = np.asarray(arr2d)
    aspect = physical_aspect(a.shape, spacing_disp)
    out_h = max(1, int(target_h))
    out_w = max(1, int(round(out_h * aspect)))
    rows = np.clip((np.arange(out_h) + 0.5) * a.shape[0] / out_h, 0, a.shape[0] - 1).astype(int)
    cols = np.clip((np.arange(out_w) + 0.5) * a.shape[1] / out_w, 0, a.shape[1] - 1).astype(int)
    return a[np.ix_(rows, cols)]
