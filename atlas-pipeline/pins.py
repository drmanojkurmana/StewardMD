"""Label mask -> pin coordinates.

Two deliberate choices:

* The pin is the mask's distance-transform maximum, NOT its centroid. Arch- and
  ring-shaped structures (fornix, corpus callosum, cortical ribbon) have centroids
  that fall outside themselves; a centroid pin would point at the ventricle next door.
* One pin per connected COMPONENT, not per label. A bilateral structure therefore
  emits two pins naturally, which is exactly what the viewer's multi-instance
  highlight consumes. No special cases anywhere.
"""
import numpy as np
from scipy import ndimage

# 8-connectivity: a diagonal bridge is the same structure, not two.
_CONN = np.ones((3, 3), dtype=bool)


def inside_point(mask2d):
    """Deepest interior point of mask2d, or None if empty.
    Guaranteed to satisfy mask2d[point] is True."""
    m = np.asarray(mask2d, dtype=bool)
    if not m.any():
        return None
    dist = ndimage.distance_transform_edt(m)
    r, c = np.unravel_index(int(np.argmax(dist)), m.shape)
    return int(r), int(c)


def pins_for_mask(mask2d, min_area_px):
    """One inside-point per connected component of at least min_area_px, ordered left
    to right so output is stable across runs."""
    m = np.asarray(mask2d, dtype=bool)
    if not m.any():
        return []
    lab, n = ndimage.label(m, structure=_CONN)
    out = []
    for k in range(1, n + 1):
        comp = lab == k
        if int(comp.sum()) < int(min_area_px):
            continue
        p = inside_point(comp)
        if p is not None:
            out.append(p)
    out.sort(key=lambda p: (p[1], p[0]))
    return out


def to_percent(row, col, shape):
    """(row, col) -> (x, y) as percentages of the image box, one decimal.
    x is horizontal (columns), y vertical (rows) — the order the schema expects."""
    h, w = shape[0], shape[1]
    y = 0.0 if h <= 1 else (float(row) / (h - 1)) * 100.0
    x = 0.0 if w <= 1 else (float(col) / (w - 1)) * 100.0
    return (round(min(max(x, 0.0), 100.0), 1), round(min(max(y, 0.0), 100.0), 1))
