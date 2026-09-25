#!/usr/bin/env python3
"""Exact, explicit build recipes for the six older Visible Human CT regions (18 modules).

The original builds were run by hand and their recipes were never recorded. What IS known
exactly is their output: every shipped .webp (bytes frozen since 5d651f5a5, test-enforced).
So a recipe is RECOVERED from the pixels and then PROVEN: a module's recipe is accepted only if
rebuilding with it reproduces every shipped image of that module byte for byte.

A recipe pins down everything the image path depends on, with no dependence on a segmentation:
  raw     raw slice folder (VHP frozenCT c_vm####.fro, one file per 1 mm slice)
  stack   "vhp"  = vhp_volume.stack (rows flipped: flipud(raw).T; head, thorax, TotalSegmentator runs)
          "limb" = segment_{knee,foot,hand}_ct.py stacking (columns flipped: 180 deg in-plane from vhp)
  crop0   axial crop [x0, x1, y0, y1] applied before any reformat (the segment script's own crop and/or
          vhp_volume.crop_pair), or null
  plane   axial | coronal | sagittal (vhp_volume.reformat, same code as the originals)
  crop1   crop [a0, a1, b0, b1] of the reformatted volume's first two axes, or null
  window  slices.WINDOWS key used for the soft-tissue image ("bone" for every cadaver module so far)
  picks   the exact slice index of every shipped slice, in order (frames that were dropped from a
          stack and renumbered are simply absent)

Usage:
  build_volume(recipe, raw_root) -> (volume, (col_mm, row_mm, slice_mm))   # used on the VM too
  python recipe.py discover --work <main checkout>/atlas-pipeline/work --ref <dir with 5d651f5a5 atlas/>
         --out recipes.json [--module id ...]
"""
import argparse
import glob
import io
import json
import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
_PIPE = os.path.dirname(_HERE)
sys.path.insert(0, _PIPE)
from orient import to_display, resize_to_square_pixels  # noqa: E402
from slices import apply_window, WINDOWS, DISPLAY_H, WEBP_Q  # noqa: E402
from vhp_volume import reformat, crop_pair, SPACING  # noqa: E402

HDR, DIM = 3416, 512
REGION = {   # module prefix -> (raw folder, stacking, segmenter)
    "ct-head": ("head", "vhp", "segment_head_ct.py"),
    "ct-thorax": ("chest", "vhp", "segment_thorax_ct.py"),
    "ct-knee": ("knee2", "limb", "segment_knee_ct.py"),
    "ct-abdomen": ("abdomen", "vhp", "totalsegmentator"),
    "ct-pelvis": ("pelvis", "vhp", "totalsegmentator"),
    "ct-wholebody": ("wb", "vhp", "totalsegmentator"),
}
MODULES = ["ct-%s-%s" % (r, p) for r in ("head", "thorax", "knee", "abdomen", "pelvis")
           for p in ("axial", "coronal", "sagittal")] + ["ct-wholebody-axial", "ct-wholebody-coronal"]


def region_of(mid):
    return REGION[mid.rsplit("-", 1)[0]]


def raw_files(raw_dir):
    files = sorted(glob.glob(os.path.join(raw_dir, "*.raw")), key=lambda p: int(os.path.basename(p)[:-4]))
    if not files:
        raise SystemExit("no .raw slices in " + raw_dir)
    return files


def stack(raw_dir, how):
    """int16 [X, Y, Z] from raw slices, Z = file order (VHP numbering, 0 most superior)."""
    files = raw_files(raw_dir)
    vol = np.empty((DIM, DIM, len(files)), dtype=np.int16)
    for z, f in enumerate(files):
        hu = np.frombuffer(open(f, "rb").read()[HDR:], dtype=">u2").reshape(DIM, DIM).astype(np.int32) - 1024
        vol[:, :, z] = (np.flipud(hu).T if how == "vhp" else np.flipud(hu.T)).astype(np.int16)
    return vol


def build_volume(recipe, raw_root, vol=None):
    """The image volume a recipe describes, and its (col, row, slice) spacing in mm. `vol` may pass
    an already-stacked [X, Y, Z] volume (the segmentation takes the same path via build_seg)."""
    if vol is None:
        vol = stack(os.path.join(raw_root, recipe["raw"]), recipe["stack"])
    return crop_reformat(vol, recipe)


def crop_reformat(arr, recipe):
    """crop0 -> vhp_volume.reformat (the originals' own code) -> crop1. Works for image or mask."""
    c0 = recipe.get("crop0")
    if c0:
        arr = arr[c0[0]:c0[1], c0[2]:c0[3], :]
    if recipe["plane"] == "axial":
        sp = SPACING
    else:
        arr, _same, sp = reformat(arr, arr, recipe["plane"], SPACING)
    c1 = recipe.get("crop1")
    if c1:
        arr = arr[c1[0]:c1[1], c1[2]:c1[3], :]
    return arr, tuple(float(x) for x in sp)


def render(vol, sp, z, window):
    """slices._render's pixels for slab z, before encoding (uint8, 900 rows)."""
    disp = resize_to_square_pixels(to_display(vol[:, :, z]), (sp[1], sp[0]), DISPLAY_H)
    if window is None:
        lo, hi = np.percentile(disp, [1.0, 99.5])
        g = np.clip((disp - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    else:
        c, wd = WINDOWS[window]
        g = apply_window(disp, c, wd)
    return (g * 255.0).astype(np.uint8)


def webp_bytes(u8, quality=WEBP_Q):
    from PIL import Image
    b = io.BytesIO()
    Image.fromarray(u8, mode="L").save(b, "WEBP", quality=quality)
    return b.getvalue()


LEVELS = ("bytes", "pixels", "near")   # best first


def _decode(b):
    from PIL import Image
    return np.asarray(Image.open(io.BytesIO(b)).convert("L"), dtype=np.int16)


def match_mad(u8, ref_path):
    """(level, mad): how closely rendered pixels reproduce a shipped image once encoded.
    bytes  = identical .webp file (same libwebp as the Mac that built it)
    pixels = different file, identical decoded pixels
    near   = decoded pixels differ by <= 0.5 grey levels on average (a different libwebp build
             encodes the same pixels slightly differently; a 1-voxel crop shift or the next
             slab costs far more than that)
    None   = not this image."""
    mine, ref = webp_bytes(u8), open(ref_path, "rb").read()
    if mine == ref:
        return "bytes", 0.0
    a, b = _decode(mine), _decode(ref)
    if a.shape != b.shape:
        return None, 999.0
    mad = float(np.abs(a - b).mean())
    return ("pixels" if mad == 0 else "near" if mad <= 0.5 else None), mad


def match_level(u8, ref_path):
    return match_mad(u8, ref_path)[0]


def worst(levels):
    return None if None in levels else max(levels, key=LEVELS.index) if levels else None


def find_picks(vol, sp, ref_imgs, windows=("bone", "soft-tissue", None, "lung", "mediastinum", "brain")):
    """For each shipped image, the slab and window that reproduce it (see match_mad), or None.
    Returns {"window", "picks", "level"}; level is the worst match over all picks."""
    from PIL import Image
    shipped = [np.asarray(Image.open(p).convert("L")) for p in ref_imgs]
    H, W = shipped[0].shape
    probe = resize_to_square_pixels(to_display(vol[:, :, 0]), (sp[1], sp[0]), DISPLAY_H)
    if probe.shape != (H, W):
        return None
    S = 5
    small_ref = np.stack([s[::S, ::S].astype(np.int16) for s in shipped])
    for window in windows:
        small = np.stack([render(vol, sp, z, window)[::S, ::S].astype(np.int16) for z in range(vol.shape[2])])
        picks, levels = [], []
        for k, ref in enumerate(small_ref):
            mad = np.abs(small - ref[None]).mean(axis=(1, 2))
            order = np.argsort(mad, kind="stable")
            # every near-tie is a candidate (blank end frames all score ~0), verified exactly
            cands = [z for z in order if mad[z] <= mad[order[0]] + 1.0][:60] or list(order[:3])
            hit = None                                  # (level rank, mad, z): best wins
            for z in cands:
                lv, m = match_mad(render(vol, sp, int(z), window), ref_imgs[k])
                if lv and (hit is None or (LEVELS.index(lv), m) < hit[:2]):
                    hit = (LEVELS.index(lv), m, int(z))
                    if lv == "bytes":
                        break
            if hit is None:
                break
            picks.append(hit[2])
            levels.append(LEVELS[hit[0]])
        if len(picks) == len(ref_imgs):
            return {"window": window, "picks": picks, "level": worst(levels)}
    return None


def _ncc(big, tmpl):
    """Normalised cross-correlation of tmpl over every position inside big ('valid')."""
    from scipy.signal import fftconvolve
    th, tw = tmpl.shape
    if th > big.shape[0] or tw > big.shape[1] or th < 4 or tw < 4:
        return None
    t = tmpl - tmpl.mean()
    tn = np.sqrt((t ** 2).sum()) + 1e-6
    num = fftconvolve(big, t[::-1, ::-1], mode="valid")
    c1 = np.pad(big, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    c2 = np.pad(big ** 2, ((1, 0), (1, 0))).cumsum(0).cumsum(1)

    def box(c):
        return c[th:, tw:] - c[:-th, tw:] - c[th:, :-tw] + c[:-th, :-tw]
    s1, s2 = box(c1), box(c2)
    var = np.maximum(s2 - s1 ** 2 / (th * tw), 1e-6)
    return num / (np.sqrt(var) * tn)


def search_crop(vol, sp, ref_img, window, fix_rows=False, fix_cols=False, zstep=1, f=4):
    """Find the crop (on volume axes 0/1) and slab that render ref_img. The crop is searched in
    DISPLAY space (to_display = flipud(slab.T): columns = axis 0, rows = axis 1 reversed), coarse by
    normalised cross-correlation over slabs and crop heights, then refined exactly. Returns
    (crop [a0, a1, b0, b1], z) or None."""
    from PIL import Image
    ref = np.asarray(Image.open(ref_img).convert("L"))
    H, W = ref.shape
    A0, A1, Z = vol.shape
    sx, sy = sp[0], sp[1]
    # coarse: every slab's full display at 1/f voxel resolution
    zs = list(range(0, Z, zstep))
    c, wd = WINDOWS[window] if window else (None, None)

    def disp_small(z):
        d = to_display(vol[:, :, z]).astype(np.float32)
        g = apply_window(d, c, wd) if window else d / max(float(np.percentile(d, 99.5)), 1e-6)
        return g[::f, ::f]
    smalls = {z: disp_small(z) for z in zs}
    hs = [A1] if fix_rows else range(max(8, f * 4), A1 + 1, f)
    best = (-2, None)
    for h in hs:
        w_exact = W * h * sy / (900.0 * sx)
        w = A0 if fix_cols else int(round(w_exact))
        if w > A0 or w < 8 or abs(round(900 * w * sx / (h * sy)) - W) > 1:
            continue
        tmpl = np.asarray(Image.fromarray(ref).resize((max(4, w // f), max(4, h // f)), Image.BILINEAR),
                          dtype=np.float32) / 255.0
        for z, s in smalls.items():
            r = _ncc(s, tmpl)
            if r is None:
                continue
            k = int(np.argmax(r))
            if r.flat[k] > best[0]:
                top, left = np.unravel_index(k, r.shape)
                best = (float(r.flat[k]), (z, h, w, int(top) * f, int(left) * f))
    if best[1] is None:
        return None
    z0, h0, w0, top0, left0 = best[1]
    if fix_rows:
        top0 = 0
    if fix_cols:
        left0 = 0
    if os.environ.get("RECIPE_DEBUG"):
        print("    coarse best ncc %.3f at z=%d h=%d w=%d top=%d left=%d" % ((best[0],) + best[1]), flush=True)
    # exact: every (h, w, top, left) near the coarse hit whose output width is W, at slabs near z0.
    # A byte-identical hit returns at once; otherwise the lowest-MAD "pixels"/"near" hit wins.
    best_near = None
    for dz in sorted(range(-2 * zstep, 2 * zstep + 1), key=abs):
        z = z0 + dz
        if not 0 <= z < Z:
            continue
        for dh in (sorted(range(-f - 2, f + 3), key=abs) if not fix_rows else [0]):
            h = h0 + dh
            ws = [A0] if fix_cols else [w for w in range(int(W * h * sy / (900 * sx)) - 2, int(W * h * sy / (900 * sx)) + 3)
                                        if w <= A0 and round(900 * w * sx / (h * sy)) == W]
            for w in ws:
                for dt in (sorted(range(-f - 2, f + 3), key=abs) if not fix_rows else [0]):
                    top = top0 + dt
                    for dl in (sorted(range(-f - 2, f + 3), key=abs) if not fix_cols else [0]):
                        left = left0 + dl
                        if top < 0 or left < 0 or top + h > A1 or left + w > A0:
                            continue
                        b1 = A1 - top
                        sub = vol[left:left + w, b1 - h:b1, z:z + 1]
                        u8 = render(sub, sp, 0, window)
                        mad = np.abs(u8.astype(np.int16) - ref).mean() if u8.shape == ref.shape else 999
                        if os.environ.get("RECIPE_DEBUG") and mad < 6:
                            print("    near z=%d h=%d w=%d top=%d left=%d mad=%.2f" % (z, h, w, top, left, mad))
                        if mad > 3:
                            continue
                        lv, m = match_mad(u8, ref_img)
                        if lv == "bytes":
                            return [left, left + w, b1 - h, b1], z
                        if lv and (best_near is None or m < best_near[0]):
                            best_near = (m, ([left, left + w, b1 - h, b1], z))
    return best_near[1] if best_near else None


def discover(work, ref_root, mids, given=None):
    """Recover each module's recipe. `given` maps a raw folder to an already-built
    (volume, segmentation or None, source) so the VM can pass its fresh TotalSegmentator mask."""
    import subprocess
    import tempfile
    import nibabel as nib
    out = {}
    cache = dict(given or {})
    for mid in mids:
        raw, how, segmenter = region_of(mid)
        plane = mid.rsplit("-", 1)[1]
        ref = json.load(open(os.path.join(ref_root, "atlas", mid, "atlas.json"), encoding="utf-8"))
        imgs = [os.path.join(ref_root, s["img"].lstrip("/")) for s in ref["slices"]]
        if raw not in cache:
            if segmenter.endswith(".py"):
                with tempfile.TemporaryDirectory() as d:
                    v, g = os.path.join(d, "v.nii.gz"), os.path.join(d, "g.nii.gz")
                    subprocess.run([sys.executable, os.path.join(_PIPE, segmenter), "--raw-dir", os.path.join(work, raw),
                                    "--out-vol", v, "--out-seg", g], check=True, capture_output=True)
                    cache[raw] = (np.asanyarray(nib.load(v).dataobj).astype(np.int16),
                                  np.asanyarray(nib.load(g).dataobj).astype(np.uint16), "script")
            else:
                cache[raw] = (stack(os.path.join(work, raw), how), None, "stack")
        vol, seg, source = cache[raw]
        found = None
        base = dict(raw=raw, stack=how, segmenter=segmenter, source=source, plane=plane)
        variants = []                                  # (crop0, volume before crop1, seg or None)
        for crop_first in ((True, False) if seg is not None else (False,)):
            if crop_first:
                V0, G0, b0 = crop_pair(vol, seg)
                variants.append(([int(x) for x in b0], V0, G0))
            else:
                variants.append((None, vol, seg))
        # 1) the pipeline's own crops (crop_pair on the segmentation), explicit picks
        for crop0, V0, G0 in variants:
            if plane == "axial":
                cands = [(V0, SPACING, None)]
            else:
                V, G, sp = reformat(V0, G0 if G0 is not None else V0, plane, SPACING)
                cands = [(V, sp, None)]
                if G0 is not None:
                    Vc, _Gc, b1 = crop_pair(V, G)
                    cands.append((Vc, sp, [int(x) for x in b1]))
            for V, sp, crop1 in cands:
                r = find_picks(V, sp, imgs)
                if r:
                    found = dict(base, crop0=crop0, crop1=crop1, spacing=[float(x) for x in sp],
                                 shape=[int(x) for x in V.shape], **r)
                    break
            if found:
                break
        # 2) no seg-derived crop reproduces it: search the crop in pixel space (full rows first)
        if not found:
            mid_img = imgs[len(imgs) // 2]
            for crop0, V0, _G0 in variants:
                if plane == "axial":
                    V, sp = V0, SPACING
                else:
                    V, _g, sp = reformat(V0, V0, plane, SPACING)
                for win in ("bone", "soft-tissue", "mediastinum", None):
                    hit = None
                    for fr in (True, False):
                        hit = search_crop(V, sp, mid_img, win, fix_rows=fr, zstep=4 if V.shape[2] > 600 else 1)
                        if hit:
                            break
                    if hit:
                        c1 = hit[0]
                        Vc = V[c1[0]:c1[1], c1[2]:c1[3], :]
                        r = find_picks(Vc, sp, imgs, windows=(win,))
                        if r:
                            found = dict(base, crop0=crop0, crop1=c1, spacing=[float(x) for x in sp],
                                         shape=[int(x) for x in Vc.shape], **r)
                            break
                if found:
                    break
        print("  %-22s %s" % (mid, ("MATCH(%s) %s window=%s picks=%s" % (
            found["level"], {k: found[k] for k in ("crop0", "crop1", "shape")}, found["window"], found["picks"])) if found
            else "NOT reproduced"), flush=True)
        if found:
            out[mid] = found
    return out


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("discover")
    d.add_argument("--work", required=True)
    d.add_argument("--ref", required=True)
    d.add_argument("--out", required=True)
    d.add_argument("--module", nargs="*")
    a = ap.parse_args()
    found = discover(a.work, a.ref, a.module or MODULES)
    old = json.load(open(a.out)) if os.path.exists(a.out) else {}
    old.update(found)
    json.dump(old, open(a.out, "w"), indent=1)
    print("%d recipes in %s" % (len(old), a.out))


if __name__ == "__main__":
    main()
