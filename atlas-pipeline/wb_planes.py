#!/usr/bin/env python3
"""Register the shipped Visible Human CT slice modules to the whole-body volume.

Every VHP CT module in atlas/ (whole body, head, thorax, abdomen, pelvis, in their axial /
coronal / sagittal reformats) was cut from the SAME 1877-slice frozen-CT stack that
live3d_wb.py meshes, but each was cropped to its own box before export and the crop boxes
were never recorded. This finds each shipped image again inside the volume by normalised
cross-correlation (skimage match_template): first a coarse scale + slice sweep on the
module's middle image, then every image at the fixed scale, then a straight-line fit of
slice index against image number (the exporter picks evenly spaced slices, so the line is
a hard constraint and a stray match is thrown out by it).

The result is, per module and per image, the voxel frame of the displayed picture: the
voxel under its top-left pixel and the voxel steps that span its columns and rows. The
caller (live3d_wb.py) turns those into world-space cut planes with the same world()
transform it meshes with, which is what makes the picture sit on the surfaces.
"""
import json
import os

import numpy as np
from PIL import Image
from skimage.feature import match_template
from skimage.transform import resize

from orient import to_display
from slices import apply_window, WINDOWS
from vhp_volume import reformat, SPACING

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)

# module id -> (plane, window). Only modules cut from the whole-body VHP stack.
VHP_MODULES = {
    "ct-wholebody-axial": ("axial", "bone"), "ct-wholebody-coronal": ("coronal", "bone"),
    "ct-head-axial": ("axial", "bone"), "ct-head-coronal": ("coronal", "bone"), "ct-head-sagittal": ("sagittal", "bone"),
    "ct-thorax-axial": ("axial", "bone"), "ct-thorax-coronal": ("coronal", "bone"), "ct-thorax-sagittal": ("sagittal", "bone"),
    "ct-abdomen-axial": ("axial", "soft-tissue"), "ct-abdomen-coronal": ("coronal", "soft-tissue"), "ct-abdomen-sagittal": ("sagittal", "soft-tissue"),
    "ct-pelvis-axial": ("axial", "bone"), "ct-pelvis-coronal": ("coronal", "bone"), "ct-pelvis-sagittal": ("sagittal", "bone"),
}
COARSE_MM = 6.0
FINE_MM = 3.0
MIN_NCC = 0.72


def _views(vol):
    """Reformatted VIEWS of the axial stack (no copies) + display spacing (row mm, col mm)."""
    out = {}
    sx, sy, sz = SPACING
    out["axial"] = (vol, (sy, sx))
    v, _, sp = reformat(vol, vol[:1, :1, :1], "coronal")      # seg argument unused: pass a stub
    out["coronal"] = (v, (sp[1], sp[0]))
    v, _, sp = reformat(vol, vol[:1, :1, :1], "sagittal")
    out["sagittal"] = (v, (sp[1], sp[0]))
    return out


def _slab_stack(view, spacing_disp, window, mm_per_px, ks):
    """Windowed display slabs at a coarse physical resolution, for the given slab indices."""
    c, w = WINDOWS[window]
    rows_mm = view.shape[1] * spacing_disp[0]
    cols_mm = view.shape[0] * spacing_disp[1]
    H, W = max(8, int(round(rows_mm / mm_per_px))), max(8, int(round(cols_mm / mm_per_px)))
    rr = np.clip(((np.arange(H) + 0.5) * view.shape[1] / H), 0, view.shape[1] - 1).astype(int)
    cc = np.clip(((np.arange(W) + 0.5) * view.shape[0] / W), 0, view.shape[0] - 1).astype(int)
    st = np.zeros((len(ks), H, W), np.float32)
    for n, k in enumerate(ks):
        d = to_display(view[:, :, k])                    # rows x cols, display orientation
        d = d[np.ix_(rr, cc)]
        st[n] = apply_window(d, c, w)
    return st


def _load_gray(path):
    im = Image.open(path).convert("L")
    return np.asarray(im, dtype=np.float32) / 255.0


def _template(img, h_mm, mm_per_px):
    h = max(6, int(round(h_mm / mm_per_px)))
    w = max(6, int(round(h * img.shape[1] / img.shape[0])))
    return resize(img, (h, w), anti_aliasing=True, preserve_range=True).astype(np.float32)


def _best(stack, tpl):
    """(ncc, slab n, row, col) of the best template position over a slab stack."""
    if tpl.shape[0] >= stack.shape[1] or tpl.shape[1] >= stack.shape[2]:
        return (-1.0, 0, 0, 0)
    best = (-1.0, 0, 0, 0)
    for n in range(stack.shape[0]):
        m = match_template(stack[n], tpl)
        j = int(np.argmax(m))
        r, c = np.unravel_index(j, m.shape)
        if m[r, c] > best[0]:
            best = (float(m[r, c]), n, int(r), int(c))
    return best


def locate_module(mod_id, plane, window, view, spacing_disp, log=print):
    """Return {i: {k, top_mm, left_mm, h_mm, w_mm, ncc}} for every shipped image, or None."""
    a = json.load(open(os.path.join(_REPO, "atlas", mod_id, "atlas.json")))
    imgs = {s["i"]: _load_gray(os.path.join(_REPO, s["img"].lstrip("/"))) for s in a["slices"]}
    NK = view.shape[2]
    rows_mm = view.shape[1] * spacing_disp[0]

    # 1. coarse: middle image, sweep scale (image height in mm) and every 2nd slab
    mid = sorted(imgs)[len(imgs) // 2]
    ks = list(range(0, NK, 2))
    coarse = _slab_stack(view, spacing_disp, window, COARSE_MM, ks)
    best = None
    # Image height in mm: a regional coronal crop is ~250 mm on a 1877 mm slab, the whole
    # body fills it, so sweep from 100 mm to the full slab.
    for h_mm in np.linspace(100.0, 1.0 * rows_mm, 60):
        tpl = _template(imgs[mid], h_mm, COARSE_MM)
        ncc, n, r, c = _best(coarse, tpl)
        if best is None or ncc > best[0]:
            best = (ncc, ks[n], r, c, h_mm)
    del coarse
    ncc0, k0, r0, c0, h0 = best
    log("  %-24s coarse: ncc %.2f at k %d, height %.0f mm" % (mod_id, ncc0, k0, h0))
    if ncc0 < MIN_NCC:
        return None

    # 2. refine the scale on the middle image at the fine resolution, around the coarse k
    ks = list(range(max(0, k0 - 6), min(NK, k0 + 7)))
    fine = _slab_stack(view, spacing_disp, window, FINE_MM, ks)
    best = None
    for h_mm in np.linspace(h0 * 0.94, h0 * 1.06, 13):
        tpl = _template(imgs[mid], h_mm, FINE_MM)
        ncc, n, r, c = _best(fine, tpl)
        if best is None or ncc > best[0]:
            best = (ncc, ks[n], r, c, h_mm)
    del fine
    _, _, _, _, h_mm = best

    # 3. every image at the fixed scale: full slab sweep at the fine resolution (stride 1)
    ks = list(range(NK))
    fine = _slab_stack(view, spacing_disp, window, FINE_MM, ks)
    found = {}
    for i, img in imgs.items():
        tpl = _template(img, h_mm, FINE_MM)
        ncc, n, r, c = _best(fine, tpl)
        found[i] = {"k": ks[n], "top_mm": r * FINE_MM, "left_mm": c * FINE_MM,
                    "h_mm": float(h_mm), "w_mm": float(h_mm * img.shape[1] / img.shape[0]), "ncc": ncc}
    del fine

    # 4. the exporter picks evenly spaced slabs, so k must be linear in i
    good = {i: f for i, f in found.items() if f["ncc"] >= MIN_NCC}
    if len(good) < 4:
        log("  %-24s only %d confident images" % (mod_id, len(good)))
        return None
    xs = np.array(sorted(good)); ys = np.array([good[i]["k"] for i in xs], float)
    slope, icpt = np.polyfit(xs, ys, 1)
    keep = np.abs(ys - (slope * xs + icpt)) <= 3.0
    if keep.sum() < 4:
        log("  %-24s images do not sit on a line" % mod_id)
        return None
    slope, icpt = np.polyfit(xs[keep], ys[keep], 1)
    top = float(np.median([good[i]["top_mm"] for i in xs[keep]]))
    left = float(np.median([good[i]["left_mm"] for i in xs[keep]]))
    out = {}
    for i, f in found.items():
        k = int(round(slope * i + icpt))
        out[i] = {"k": max(0, min(NK - 1, k)), "top_mm": top, "left_mm": left,
                  "h_mm": f["h_mm"], "w_mm": f["w_mm"], "ncc": f["ncc"]}
    log("  %-24s %d/%d on the line (slope %.2f slab/img, box top %.0f left %.0f, %.0fx%.0f mm)"
        % (mod_id, int(keep.sum()), len(found), slope, top, left, out[mid]["w_mm"], out[mid]["h_mm"]))
    return out


def voxel_frame(plane, f, shape):
    """Voxel coordinates (x, y, z in the ORIGINAL axial array) of the image's top-left
    pixel and of the pixels at the end of its first row / first column."""
    X, Y, NZ = shape
    sx, sy, sz = SPACING
    if plane == "axial":
        # display[r, c] = orig[c, Y-1-r, k]
        x0, y0 = f["left_mm"] / sx, (Y - 1) - f["top_mm"] / sy
        tl = (x0, y0, f["k"]); pu = (x0 + f["w_mm"] / sx, y0, f["k"]); pv = (x0, y0 - f["h_mm"] / sy, f["k"])
        return tl, pu, pv, "y"
    if plane == "coronal":
        # display[r, c] = orig[c, y, r] with y = Y-1-k (slabs run anterior -> posterior)
        x0, z0, y = f["left_mm"] / sx, f["top_mm"] / sz, (Y - 1) - f["k"]
        tl = (x0, y, z0); pu = (x0 + f["w_mm"] / sx, y, z0); pv = (x0, y, z0 + f["h_mm"] / sz)
        return tl, pu, pv, "z"
    if plane == "sagittal":
        # display[r, c] = orig[k, Y-1-c, r] (anterior on the image left)
        y0, z0, x = (Y - 1) - f["left_mm"] / sy, f["top_mm"] / sz, f["k"]
        tl = (x, y0, z0); pu = (x, y0 - f["w_mm"] / sy, z0); pv = (x, y0, z0 + f["h_mm"] / sz)
        return tl, pu, pv, "x"
    raise ValueError(plane)


def register_all(vol, world, log=print, only=None):
    """{module: {"i": plane}} in WORLD space via the caller's world(x, y, z) function."""
    views = _views(vol)
    planes = {}
    for mod_id, (plane, window) in VHP_MODULES.items():
        if only and mod_id not in only:
            continue
        if not os.path.exists(os.path.join(_REPO, "atlas", mod_id, "atlas.json")):
            continue
        view, sp = views[plane]
        found = locate_module(mod_id, plane, window, view, sp, log=log)
        if not found:
            continue
        planes[mod_id] = {}
        for i, f in found.items():
            tl, pu, pv, axis = voxel_frame(plane, f, vol.shape)
            wt = world(*[np.float64(v) for v in tl]); wu = world(*[np.float64(v) for v in pu]); wv = world(*[np.float64(v) for v in pv])
            planes[mod_id][str(i)] = {
                "axis": axis, "pos": float(wt["xyz".index(axis)]),
                "tl": [float(v) for v in wt], "u": [float(v) for v in (wu - wt)], "v": [float(v) for v in (wv - wt)],
                "k": int(f["k"]), "agree": round(float(f["ncc"]), 3),
            }
    return planes
