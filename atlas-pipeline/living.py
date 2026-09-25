#!/usr/bin/env python3
"""Exact geometry for the six modules cut from LIVING volumes, plus the extra CT windows.

Covers ct-live-torso-{axial,coronal,sagittal} (TotalSegmentator dataset s0108) and
mri-brain-{axial,coronal,sagittal} (OpenNeuro ds003563, 7 T T1). Writes:
  - atlas/<id>/atlas.json  per slice `q`: the image in the group's shared 3D frame (metres);
  - atlas/modules.json     `group`, `plane`, `mm`; torso also `windows`;
  - atlas/<id>/w/<win>/NNN.webp  torso lung and bone windows (new paths only);
  - atlas/3d manifest.json + live.json "planes": the 3D cut planes, identical to q.

Nothing here is assumed. Before anything is written the run proves:
  1. every module volume is an exact re-indexing (crop, transpose, flip) of the group's
     original volume: the integer map M below is checked voxel for voxel, image AND mask;
  2. the slice picks are the pipeline's own: slices.extract_slices is re-run and every
     committed NNN.webp and t/NNN.webp must come back byte-identical;
  3. q agrees with the original mask: sampled display pixels sent through q into 3D and
     back into the original volume land on the label the display shows;
  4. where two planes cross, both modules show the same labels at the same 3D points.
Any failure aborts before writing.

Frames. live-torso: live3d.world_from_voxel on the live_vol grid (the 3D body's frame:
x = patient left, y = superior, z = anterior; left/right MEASURED from liver vs spleen).
live-brain: the ORIGINAL t1.nii.gz affine (RAS mm), re-expressed with the same axis order
(x = -R, y = S, z = A) in metres. Brain left/right in that frame is the header's claim; q
only relates planes to one another, so nothing in the viewer depends on it.

q convention: t is the top-left CORNER of the top-left pixel, u and v span the full width and
height, so image fraction (a, b) is t + a*u + b*v and |u|, |v| are the true extents (voxel
count x spacing). resize_to_square_pixels samples nearest-neighbour at pixel centres, so
voxel n of a slab spans image fractions [n/N, (n+1)/N) exactly.

Usage (volumes live only in the main checkout's gitignored work dir):
  atlas-pipeline/.venv/bin/python atlas-pipeline/living.py --work /abs/path/to/atlas-pipeline/work [--write]
Re-run it after build.py rebuilds any of these modules: build.py writes no q.
"""
import argparse
import json
import os
import sys
import tempfile

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from orient import to_display, resize_to_square_pixels  # noqa: E402
from slices import extract_slices, DISPLAY_H  # noqa: E402

# Ref index (i, j, k) of the module volume -> index in the group's original volume, as
# rows of a 3x4 integer matrix. Recovered by exact array equality (crop offsets from
# vhp_volume.crop_pair, flips from vhp_volume.reformat); verify_maps() re-proves each.
#   live_c        = live_vol[6:283, 22:262, :]
#   live_coronal  = reformat(live_c, coronal)            (crop_pair kept everything)
#   live_sagittal = reformat(live_c, sagittal)[14:226]   (crop_pair cut Y)
#   br_vol        = t1[:, :, ::-1];  br_c = br_vol[:, 18:353, :]
#   br_coronal    = reformat(br_c, coronal)[:, 68:351];  br_sagittal = reformat(br_c, sagittal)[:, 64:355]
MODULES = {
    "ct-live-torso-axial": dict(group="live-torso", plane="axial", vol="tsd/live_c.nii.gz",
                                seg="tsd/live_c_seg.nii.gz", window="soft-tissue",
                                M=[[1, 0, 0, 6], [0, 1, 0, 22], [0, 0, 1, 0]]),
    "ct-live-torso-coronal": dict(group="live-torso", plane="coronal", vol="tsd/live_coronal.nii.gz",
                                  seg="tsd/live_coronal_seg.nii.gz", window="soft-tissue",
                                  M=[[1, 0, 0, 6], [0, 0, -1, 261], [0, -1, 0, 292]]),
    "ct-live-torso-sagittal": dict(group="live-torso", plane="sagittal", vol="tsd/live_sagittal.nii.gz",
                                   seg="tsd/live_sagittal_seg.nii.gz", window="soft-tissue",
                                   M=[[0, 0, 1, 6], [-1, 0, 0, 247], [0, -1, 0, 292]]),
    "mri-brain-axial": dict(group="live-brain", plane="axial", vol="brain/br_c.nii.gz",
                            seg="brain/br_c_seg.nii.gz", window=None,
                            M=[[1, 0, 0, 0], [0, 1, 0, 18], [0, 0, 1, 0]]),
    "mri-brain-coronal": dict(group="live-brain", plane="coronal", vol="brain/br_coronal.nii.gz",
                              seg="brain/br_coronal_seg.nii.gz", window=None,
                              M=[[1, 0, 0, 0], [0, 0, -1, 352], [0, -1, 0, 315]]),
    "mri-brain-sagittal": dict(group="live-brain", plane="sagittal", vol="brain/br_sagittal.nii.gz",
                               seg="brain/br_sagittal_seg.nii.gz", window=None,
                               M=[[0, 0, 1, 0], [-1, 0, 0, 352], [0, -1, 0, 319]]),
}
SOURCE = {"live-torso": "totalsegmentator-dataset", "live-brain": "openneuro-cc0"}
ORIG = {"live-torso": ("tsd/live_vol.nii.gz", "tsd/live_seg.nii.gz"),
        "live-brain": ("brain/br_vol.nii.gz", "brain/br_seg.nii.gz")}
WINDOWS = [{"id": "soft", "label": "Soft tissue"}, {"id": "lung", "label": "Lung"}, {"id": "bone", "label": "Bone"}]
EXTRA_WINDOWS = {"lung": "lung", "bone": "bone"}          # window id -> slices.WINDOWS key
PLANE_AXIS = {"axial": 1, "coronal": 2, "sagittal": 0}    # frame axis normal to each plane
# live3d.py world_from_voxel, as a matrix: x = (143.5 - x) mm, y = (292 - z) mm + 0.62, z = (y - 143.5) mm
MM, Y0, NZ = 0.0015, 0.62, 293
F_TORSO = np.array([[-MM, 0, 0, 143.5 * MM], [0, 0, -MM, (NZ - 1) * MM + Y0], [0, MM, 0, -143.5 * MM], [0, 0, 0, 1.0]])
ND = 6                                                    # decimals kept (1 micrometre)


def _load(work, rel):
    import nibabel as nib
    return np.asanyarray(nib.load(os.path.join(work, rel)).dataobj)


def brain_frame(work):
    """br_vol index -> metres: undo the z flip to reach t1.nii.gz, apply ITS affine (RAS mm),
    then reorder to (-R, S, A) / 1000 so both groups share one axis convention."""
    import nibabel as nib
    t1 = nib.load(os.path.join(work, "brain", "t1.nii.gz"))
    nz = t1.shape[2]
    zflip = np.array([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, -1, nz - 1], [0, 0, 0, 1.0]])
    ras_to_frame = np.diag([0.001, 0.001, 0.001, 1.0]) @ np.array(
        [[-1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1.0]])
    return ras_to_frame @ t1.affine @ zflip


def frame_of(group, work):
    return F_TORSO if group == "live-torso" else brain_frame(work)


def m4(M):
    return np.vstack([np.asarray(M, dtype=float), [0, 0, 0, 1.0]])


def verify_map(mid, orig, ref):
    """Proof 1: the module volume (and mask) equals the original re-indexed by M."""
    (ov, os_), (rv, rs) = orig, ref
    A, B, N = rv.shape
    ii, jj = np.meshgrid(np.arange(A), np.arange(B), indexing="ij")
    M = np.asarray(MODULES[mid]["M"])
    for k in range(N):
        idx = tuple(M[r, 0] * ii + M[r, 1] * jj + M[r, 2] * k + M[r, 3] for r in range(3))
        if not (np.array_equal(ov[idx], rv[:, :, k]) and np.array_equal(os_[idx], rs[:, :, k])):
            raise SystemExit("%s: slab %d is not the original re-indexed by M" % (mid, k))
    print("  map ok   %-24s %s -> original, image and mask, every voxel" % (mid, rv.shape))


def stack_dir(atlas):
    """'/atlas/<id>' or '/atlas/<id>/v2': where this module's current stack lives."""
    return os.path.dirname(atlas["slices"][0]["img"])


def reproduce(work, mid, tmp):
    """Proof 2: re-run the pipeline's own extraction; every committed image must match."""
    m = MODULES[mid]
    atlas = json.load(open(os.path.join(_REPO, "atlas", mid, "atlas.json"), encoding="utf-8"))
    sub = stack_dir(atlas)
    stubs = extract_slices(os.path.join(work, m["vol"]), tmp, sub[len("/atlas/"):], len(atlas["slices"]), m["window"],
                           SOURCE[m["group"]], os.path.join(work, m["seg"]))
    if [s["img"] for s in stubs] != [s["img"] for s in atlas["slices"]]:
        raise SystemExit("%s: reproduced slice paths differ from atlas.json" % mid)
    for s in stubs:
        name = os.path.basename(s["img"])
        for t in ("", "t"):
            mine = open(os.path.join(tmp, t, name), "rb").read()
            ship = open(os.path.join(_REPO, sub.lstrip("/"), t, name), "rb").read()
            if mine != ship:
                raise SystemExit("%s: %s/%s is not reproduced byte-identical; refusing" % (mid, t, name))
    print("  repro ok %-24s %d slices + thumbs byte-identical in %s, z = %s" % (mid, len(stubs), sub, [s["_z"] for s in stubs]))
    return stubs, atlas


def assemble_stack(work, mid, n, out_dir):
    """The pipeline's own module build (extract_slices -> pins_from_segmentation -> assemble ->
    the viewer's validator) for an n-slice stack written to out_dir, reusing the SHIPPED
    module's curated structures, categories and provenance. Returns the atlas dict."""
    import nibabel as nib
    from build import assemble, pins_from_segmentation, validate_with_viewer
    from labels import load_mapping
    m = MODULES[mid]
    old = json.load(open(os.path.join(_REPO, "atlas", mid, "atlas.json"), encoding="utf-8"))
    rel = os.path.relpath(out_dir, os.path.join(_REPO, "atlas")) if out_dir.startswith(_REPO) else mid
    stubs = extract_slices(os.path.join(work, m["vol"]), out_dir, rel, n, m["window"], SOURCE[m["group"]],
                           os.path.join(work, m["seg"]))
    zooms = nib.load(os.path.join(work, m["vol"])).header.get_zooms()[:3]
    mapping = load_mapping("ct-live-torso-axial" if m["group"] == "live-torso" else "mri-brain-axial")
    pins = pins_from_segmentation(os.path.join(work, m["seg"]), stubs, mapping, (zooms[1], zooms[0]))
    fresh = assemble({"id": mid}, stubs, pins, mapping)
    structures = dict(old["structures"])
    for k, v in fresh["structures"].items():
        structures.setdefault(k, v)
    cats = dict(old["categories"])
    for k, v in fresh["categories"].items():
        cats.setdefault(k, v)
    atlas = {"id": mid, "provenance": old["provenance"], "categories": cats, "structures": structures,
             "slices": fresh["slices"]}
    errs = validate_with_viewer(atlas, _REPO)
    if errs:
        raise SystemExit("%s: viewer schema errors %s" % (mid, errs[:3]))
    return atlas


def prove_rebuild(work, mid):
    """Before densifying: the same build at the SHIPPED slice count must reproduce the shipped
    module exactly (every slice path, aspect and pin)."""
    old = json.load(open(os.path.join(_REPO, "atlas", mid, "atlas.json"), encoding="utf-8"))
    with tempfile.TemporaryDirectory() as d:
        a = assemble_stack(work, mid, len(old["slices"]), os.path.join(d, "x"))
    same = [(s["aspect"], s["pins"]) == (o["aspect"], o["pins"]) for s, o in zip(a["slices"], old["slices"])]
    if len(a["slices"]) != len(old["slices"]) or not all(same):
        raise SystemExit("%s: rebuild at %d slices differs from the shipped module on %d slices"
                         % (mid, len(old["slices"]), same.count(False)))
    print("  rebuild  %-24s %d slices: every aspect and all %d pins identical to the shipped module"
          % (mid, len(old["slices"]), sum(len(s["pins"]) for s in old["slices"])))


def densify(work, mid, n):
    """Write an n-slice stack under atlas/<id>/v2/ (old images are never touched) and point the
    module's atlas.json and catalog row at it. q, windows and planes follow in build()/main()."""
    out = os.path.join(_REPO, "atlas", mid, "v2")
    a = assemble_stack(work, mid, n, out)
    if not a["slices"][0]["img"].startswith("/atlas/%s/v2/" % mid):
        raise SystemExit("%s: v2 paths wrong: %s" % (mid, a["slices"][0]["img"]))
    with open(os.path.join(_REPO, "atlas", mid, "atlas.json"), "w", encoding="utf-8") as fh:
        json.dump(a, fh, indent=1, ensure_ascii=False)
    cp = os.path.join(_REPO, "atlas", "modules.json")
    cat = json.load(open(cp, encoding="utf-8"))
    for row in cat["modules"]:
        if row["id"] == mid:
            row["slices"] = len(a["slices"])
            row["thumb"] = "/atlas/%s/v2/t/%03d.webp" % (mid, len(a["slices"]) // 2 + 1)
    with open(cp, "w", encoding="utf-8") as fh:
        json.dump(cat, fh, indent=1, ensure_ascii=False)
    print("  densify  %-24s %d slices, %d pins -> %s" % (mid, len(a["slices"]), sum(len(s["pins"]) for s in a["slices"]),
                                                       os.path.dirname(a["slices"][0]["img"])))


def q_for(mid, F, shape, k):
    """Corner-exact frame of slab k: fraction (a, b) <-> ref index (a*A - .5, B - .5 - b*B, k)."""
    A, B = shape[0], shape[1]
    T = F @ m4(MODULES[mid]["M"])
    t = T @ np.array([-0.5, B - 0.5, k, 1.0])
    u = T[:3, :3] @ np.array([A, 0.0, 0.0])
    v = T[:3, :3] @ np.array([0.0, -float(B), 0.0])
    return [round(float(x), ND) + 0.0 for x in list(t[:3]) + list(u) + list(v)]


def display_mask(seg_slab, zooms):
    return resize_to_square_pixels(to_display(seg_slab), (zooms[1], zooms[0]), DISPLAY_H)


def check_roundtrip(mid, q, D, Finv, oseg, step=5):
    """Proof 3: display pixel -> q -> original volume -> same label."""
    H, W = D.shape
    rr, cc = np.meshgrid(np.arange(0, H, step), np.arange(0, W, step), indexing="ij")
    a = (cc + 0.5) / W
    b = (rr + 0.5) / H
    t, u, v = np.array(q[0:3]), np.array(q[3:6]), np.array(q[6:9])
    P = t[None, None, :] + a[..., None] * u + b[..., None] * v
    oc = np.einsum("ij,hwj->hwi", Finv[:3, :3], P) + Finv[:3, 3]
    o = np.floor(oc + 0.5).astype(int)
    # A pixel centre that falls exactly on a voxel boundary (e.g. column 325 of 651 over 212
    # voxels) is a tie that the resampler breaks one way and a flipped axis the other. It says
    # nothing about q, so it is excluded, and q's 1e-6 m rounding sets the tie width.
    edge = np.abs(oc + 0.5 - np.rint(oc + 0.5)) < 1e-3
    keep = ~np.any(edge, axis=-1)
    inside = np.all((o >= 0) & (o < np.array(oseg.shape)), axis=-1)
    lab = np.where(inside, oseg[np.clip(o[..., 0], 0, oseg.shape[0] - 1),
                                np.clip(o[..., 1], 0, oseg.shape[1] - 1),
                                np.clip(o[..., 2], 0, oseg.shape[2] - 1)].astype(int), -1)
    return int(((lab != D[rr, cc]) & keep).sum()), int(keep.sum())


def frac_in(q, P):
    t, u, v = np.array(q[0:3]), np.array(q[3:6]), np.array(q[6:9])
    d = P - t
    a, b = d @ u / (u @ u), d @ v / (v @ v)
    off = np.abs(d - np.outer(a, u) - np.outer(b, v)).max() if len(P) else 0.0
    return a, b, off


def cross_check(g, info, F, oseg, pixels):
    """Proof 4: points on the line where two slices cross carry the same label in both
    displays (and in the original mask). For CT, where both planes share one fixed window,
    the SHIPPED pixel values along that line are compared too."""
    mids = [m for m in MODULES if MODULES[m]["group"] == g]
    tot = bad = 0
    diffs = []
    worst_off = 0.0
    for x in range(len(mids)):
        for y in range(x + 1, len(mids)):
            m1, m2 = mids[x], mids[y]
            for s1 in info[m1]["slices"][::3]:
                for s2 in info[m2]["slices"][::3]:
                    pts = crossing(m1, s1["k"], m2, s2["k"], oseg.shape)
                    if not len(pts):
                        continue
                    P = (F[:3, :3] @ pts.T).T + F[:3, 3]
                    labs, vals = [], []
                    for mid, s in ((m1, s1), (m2, s2)):
                        a, b, off = frac_in(s["q"], P)
                        worst_off = max(worst_off, off)
                        H, W = s["D"].shape
                        r = np.clip(np.floor(b * H).astype(int), 0, H - 1)
                        c = np.clip(np.floor(a * W).astype(int), 0, W - 1)
                        labs.append(s["D"][r, c])
                        vals.append(pixels(mid, s["i"])[r, c].astype(float))
                    truth = oseg[pts[:, 0], pts[:, 1], pts[:, 2]]
                    bad += int(((labs[0] != truth) | (labs[1] != truth)).sum())
                    tot += len(pts)
                    diffs.append(np.abs(vals[0] - vals[1]).mean())
    return tot, bad, float(np.mean(diffs)), worst_off


def crossing(m1, k1, m2, k2, shape):
    """Original-grid voxels lying on slab k1 of m1 AND slab k2 of m2, inside both crops."""
    M1, M2 = np.asarray(MODULES[m1]["M"]), np.asarray(MODULES[m2]["M"])
    a1 = int(np.flatnonzero(M1[:, 2])[0]); a2 = int(np.flatnonzero(M2[:, 2])[0])
    free = ({0, 1, 2} - {a1, a2}).pop()
    pts = np.zeros((shape[free], 3), dtype=int)
    pts[:, a1] = M1[a1, 2] * k1 + M1[a1, 3]
    pts[:, a2] = M2[a2, 2] * k2 + M2[a2, 3]
    pts[:, free] = np.arange(shape[free])
    keep = np.ones(len(pts), bool)
    for mid in (m1, m2):
        Minv = np.linalg.inv(m4(MODULES[mid]["M"]))
        ref = np.rint((Minv[:3, :3] @ pts.T).T + Minv[:3, 3]).astype(int)
        keep &= np.all((ref >= 0) & (ref < np.array(MODULES[mid]["_shape"])), axis=1)
    return pts[keep]


EVIDENCE = {
    # label sets (integer mask values) used for the orientation evidence in ORIENTATION.md
    "live-torso": {"liver": [5], "spleen": [1], "heart": [51], "spinal cord": [79],
                   "urinary bladder": [21], "right middle lobe": [13], "left upper lobe": [10]},
    "live-brain": {"caudate": [11, 50], "cerebellar cortex": [8, 47], "brainstem": [16],
                   "cerebral cortex": [3, 42], "hemisphere labelled LEFT": [2, 3], "hemisphere labelled RIGHT": [41, 42]},
}


def centroids(group, slices):
    acc = {}
    for name, labs in EVIDENCE[group].items():
        sx = sy = n = 0.0
        for s in slices:
            D = s["D"]
            r, c = np.nonzero(np.isin(D, labs))
            sx += ((c + 0.5) / D.shape[1]).sum(); sy += ((r + 0.5) / D.shape[0]).sum(); n += len(r)
        if n:
            acc[name] = (sx / n, sy / n)
    return acc


def windows(work, mid, picks, stack, ref_dims):
    """Lung and bone renders of the SAME picks through the SAME code path, next to the stack
    (<stack>/w/<id>/NNN.webp). First proves the picks path reproduces the committed soft-tissue
    images byte for byte."""
    m = MODULES[mid]
    root = os.path.join(_REPO, stack.lstrip("/"))
    with tempfile.TemporaryDirectory() as tmp:
        extract_slices(os.path.join(work, m["vol"]), tmp, mid, len(picks), m["window"], SOURCE[m["group"]],
                       picks=picks, thumbs=False)
        for n in range(1, len(picks) + 1):
            name = "%03d.webp" % n
            if open(os.path.join(tmp, name), "rb").read() != open(os.path.join(root, name), "rb").read():
                raise SystemExit("%s: picks path does not reproduce %s" % (mid, name))
    from PIL import Image
    for wid, key in EXTRA_WINDOWS.items():
        out = os.path.join(root, "w", wid)
        extract_slices(os.path.join(work, m["vol"]), out, mid, len(picks), key, SOURCE[m["group"]],
                       picks=picks, thumbs=False)
        for n in range(1, len(picks) + 1):
            if Image.open(os.path.join(out, "%03d.webp" % n)).size != ref_dims[n - 1]:
                raise SystemExit("%s: %s window slice %d has different dimensions" % (mid, wid, n))
    print("  windows  %-24s soft reproduced through the picks path; lung + bone rendered in %s/w, dims match" % (mid, stack))


def torso_planes(info):
    """3D cut planes = the slice frames q, plus the slice's own image path (`img`): the 3D layer
    textures the plane with it, so a stack moved to a new directory (v2/) cannot be paired with
    an old image by a guessed file name."""
    out = {}
    for mid in ("ct-live-torso-axial", "ct-live-torso-coronal", "ct-live-torso-sagittal"):
        ax = PLANE_AXIS[MODULES[mid]["plane"]]
        out[mid] = {str(s["i"]): {"axis": "xyz"[ax], "pos": s["q"][ax], "tl": s["q"][0:3], "u": s["q"][3:6],
                                  "v": s["q"][6:9], "k": s["k"], "img": s["img"]} for s in info[mid]["slices"]}
    return out


def build(work, groups=tuple(ORIG)):
    """Run every proof, one group at a time (8 GB machines); return per-module info. Writes nothing."""
    import nibabel as nib
    from PIL import Image
    if "live-brain" in groups:
        t1 = _load(work, "brain/t1.nii.gz")
        same = np.array_equal(_load(work, ORIG["live-brain"][0]), t1[:, :, ::-1])
        del t1
        if not same:
            raise SystemExit("br_vol is not t1.nii.gz flipped on z: the brain frame would be wrong")
    info = {}
    for g in groups:
        ov, osg = ORIG[g]
        orig = (_load(work, ov), _load(work, osg))
        F = frame_of(g, work)
        Finv = np.linalg.inv(F)
        for mid in [m for m in MODULES if MODULES[m]["group"] == g]:
            m = MODULES[mid]
            ref = (_load(work, m["vol"]), _load(work, m["seg"]))
            m["_shape"] = ref[0].shape
            verify_map(mid, orig, ref)
            zooms = nib.load(os.path.join(work, m["vol"])).header.get_zooms()[:3]
            with tempfile.TemporaryDirectory() as tmp:
                stubs, _atlas = reproduce(work, mid, tmp)
            slices, bad, tot = [], 0, 0
            for st in stubs:
                q = q_for(mid, F, ref[1].shape, st["_z"])
                D = display_mask(ref[1][:, :, st["_z"]], zooms).astype(np.uint8)
                b, n = check_roundtrip(mid, q, D, Finv, orig[1])
                bad += b; tot += n
                slices.append({"i": st["i"], "k": st["_z"], "q": q, "D": D, "img": st["img"]})
            del ref
            if bad:
                raise SystemExit("%s: %d of %d display pixels map through q to a different label" % (mid, bad, tot))
            u, v = np.array(slices[0]["q"][3:6]), np.array(slices[0]["q"][6:9])
            mm = [round(float(np.linalg.norm(u)) * 1000, 1), round(float(np.linalg.norm(v)) * 1000, 1)]
            print("  q ok     %-24s %d/%d sampled pixels land on their own label in 3D; mm %s" % (mid, tot - bad, tot, mm))
            info[mid] = {"slices": slices, "mm": mm, "picks": [st["_z"] for st in stubs],
                         "stack": os.path.dirname(stubs[0]["img"]),
                         "dims": [Image.open(os.path.join(_REPO, st["img"].lstrip("/"))).size for st in stubs]}

        def pixels(mid, i):
            return np.asarray(Image.open(os.path.join(_REPO, "atlas", mid, "%03d.webp" % i)).convert("L"))
        tot, bad, mad, off = cross_check(g, info, F, orig[1], pixels)
        if bad or off > 1e-6:
            raise SystemExit("%s: %d of %d crossing points disagree (plane offset %.2g m)" % (g, bad, tot, off))
        print("  cross ok %-24s %d points where two planes cross carry the same label in both displays and in "
              "the original mask; mean |shipped pixel difference| there %.1f/255%s"
              % (g, tot, mad, "" if g == "live-torso" else " (MR: per-slice stretch, not comparable)"))
        for mid in [m for m in MODULES if MODULES[m]["group"] == g]:
            c = centroids(g, info[mid]["slices"])
            print("  evidence %-24s " % mid + "; ".join("%s x=%.2f y=%.2f" % (k, v[0], v[1]) for k, v in c.items()))
        if g == "live-brain":
            header_check(work, orig[1])
        del orig
    return info


def header_check(work, br_seg):
    """Brain left/right comes from the ORIGINAL t1.nii.gz header, accepted only if (1) its affine
    is a sane, non-degenerate, axis-aligned voxel-to-RAS map and (2) its A/P and S/I codes agree
    with the anatomy of the same volume: caudate anterior to cerebellar cortex, cerebral cortex
    superior to brainstem, measured in t1 voxel indices. A header that gets A/P and S/I right
    is trusted for R/L; nothing in a head-only T1 can check R/L itself. Raises on failure."""
    import nibabel as nib
    t1 = nib.load(os.path.join(work, "brain", "t1.nii.gz"))
    A = t1.affine[:3, :3]
    zooms = np.sqrt((A ** 2).sum(axis=0))
    off = np.abs(A) > 1e-6 * zooms.max()
    sane = abs(np.linalg.det(A)) > 1e-9 and np.all(off.sum(axis=0) == 1) and np.all(off.sum(axis=1) == 1) \
        and np.all((zooms > 0.1) & (zooms < 5))
    codes = nib.aff2axcodes(t1.affine)
    nz = t1.shape[2]

    def cen(labs):
        idx = np.argwhere(np.isin(br_seg, labs)).astype(float)
        idx[:, 2] = nz - 1 - idx[:, 2]                         # br_vol z -> t1 z
        return idx.mean(axis=0)
    ap = next(k for k, c in enumerate(codes) if c in "AP")
    si = next(k for k, c in enumerate(codes) if c in "SI")
    caud, cbl, ctx, bs = cen([11, 50]), cen([8, 47]), cen([3, 42]), cen([16])
    ap_ok = (caud[ap] > cbl[ap]) == (codes[ap] == "A")
    si_ok = (ctx[si] > bs[si]) == (codes[si] == "S")
    lr = next(k for k, c in enumerate(codes) if c in "RL")
    print("  header   t1.nii.gz codes %s, zooms %s, axis-aligned and non-degenerate: %s; A/P axis %d: caudate %.1f vs "
          "cerebellar cortex %.1f -> %s; S/I axis %d: cortex %.1f vs brainstem %.1f -> %s; so +index %d is the patient's %s"
          % ("".join(codes), np.round(zooms, 4).tolist(), bool(sane), ap, caud[ap], cbl[ap], "agrees" if ap_ok else "DISAGREES",
             si, ctx[si], bs[si], "agrees" if si_ok else "DISAGREES", lr, "RIGHT" if codes[lr] == "R" else "LEFT"))
    if not (sane and ap_ok and si_ok):
        raise SystemExit("brain header check FAILED: do not assert brain left/right")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--work", required=True, help="absolute path to atlas-pipeline/work (main checkout)")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--prove-rebuild", action="store_true",
                    help="only prove the build reproduces every shipped module (paths, aspects, pins)")
    ap.add_argument("--densify", type=int, metavar="N",
                    help="with --write: rebuild each module as an N-slice stack under atlas/<id>/v2/")
    a = ap.parse_args()
    if a.prove_rebuild or a.densify:
        for mid in MODULES:
            prove_rebuild(os.path.abspath(a.work), mid)
        if a.prove_rebuild:
            return 0
        if not a.write:
            ap.error("--densify writes; pass --write")
        for mid in MODULES:
            densify(os.path.abspath(a.work), mid, a.densify)
    info = build(os.path.abspath(a.work))
    if not a.write:
        print("verified; nothing written (pass --write)")
        return 0
    work = os.path.abspath(a.work)
    for mid in MODULES:
        if MODULES[mid]["window"]:
            windows(work, mid, info[mid]["picks"], info[mid]["stack"], info[mid]["dims"])
        p = os.path.join(_REPO, "atlas", mid, "atlas.json")
        atlas = json.load(open(p, encoding="utf-8"))
        for s, mine in zip(atlas["slices"], info[mid]["slices"]):
            pins = s.pop("pins")
            s["q"] = mine["q"]
            s["pins"] = pins
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(atlas, fh, indent=1, ensure_ascii=False)
    cp = os.path.join(_REPO, "atlas", "modules.json")
    cat = json.load(open(cp, encoding="utf-8"))
    for row in cat["modules"]:
        m = MODULES.get(row["id"])
        if m:
            row.update({"group": m["group"], "plane": m["plane"], "mm": info[row["id"]]["mm"]})
            if m["window"]:
                row["windows"] = WINDOWS
    with open(cp, "w", encoding="utf-8") as fh:
        json.dump(cat, fh, indent=1, ensure_ascii=False)
    from bp3d_import import replace_key, relink
    planes = torso_planes(info)
    replace_key(os.path.join(_REPO, "atlas", "3d", "manifest.json"), "planes", planes, "live")
    replace_key(os.path.join(_REPO, "atlas", "3d", "live.json"), "planes", planes, "parts")
    relink()
    print("wrote q, group/plane/mm/windows, window images, the 3D planes and links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
