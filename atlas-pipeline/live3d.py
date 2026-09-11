#!/usr/bin/env python3
"""Living-patient 3D organ surfaces for the RadioAnatome 3D layer.

WHY: BodyParts3D's "isa" mesh set has no liver, lung, lobe or closed heart surface, and it is
a different body from every CT slice we show. The living-torso CT modules already ship
expert TotalSegmentator masks for subject s0108 (CC BY 4.0). Meshing THOSE masks gives 3D
organ surfaces from the SAME scan as the slices, so a CT slice and its 3D structure are the
same patient, the same voxels, and the slice can be drawn as a textured cut plane through
the meshes at exactly the right level.

WHAT: for every structure the living-torso label file maps (38), run marching cubes on
the mask (lightly smoothed), convert to the viewer's world frame (metres, Y-up, anterior +z),
and record each shipped slice's plane in that frame by locating the slice in the volume
through the pins it carries (so image, mask and mesh share one geometry, verified rather
than assumed). Output goes to work/live3d/ for pack3d.mjs, which simplifies, computes
normals and packs chunks; bp3d_import.py then merges it into manifest.json.

Usage:  .venv/bin/python live3d.py [--work work/tsd] [--out work/live3d]
"""
import argparse
import json
import os
import sys

import numpy as np
import nibabel as nib
from scipy import ndimage
from skimage import measure

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from orient import to_display, resize_to_square_pixels  # noqa: E402
from slices import DISPLAY_H  # noqa: E402

MODULES = {"ct-live-torso-axial": "axial", "ct-live-torso-coronal": "coronal", "ct-live-torso-sagittal": "sagittal"}
MM = 0.0015              # 1.5 mm isotropic
Y0 = 0.62                # world height (m) of volume z=0: pelvis floor sits where the reference body's does
SMOOTH_SIGMA = 0.8

SYSTEM = {
    "lung": "respiratory", "heart": "cardiac", "aorta": "arterial", "iliac_artery": "arterial",
    "inferior_vena_cava": "venous", "iliac_vena": "venous", "portal_vein": "venous", "pulmonary_vein": "venous",
    "esophagus": "digestive", "liver": "digestive", "pancreas": "digestive", "gallbladder": "digestive",
    "stomach": "digestive", "duodenum": "digestive", "small_bowel": "digestive", "colon": "digestive",
    "spleen": "lymphatic", "kidney": "urinary", "urinary_bladder": "urinary", "adrenal": "endocrine",
    "prostate": "reproductive", "spinal_cord": "nervous", "autochthon": "muscular", "iliopsoas": "muscular",
    "gluteus": "muscular",
}


def system_of(stem):
    for k, v in SYSTEM.items():
        if stem.startswith(k):
            return v
    return "connective"


def side_of(stem):
    if stem.endswith("_left"):
        return "left"
    if stem.endswith("_right"):
        return "right"
    return None


def pretty(stem, canon_name):
    s = side_of(stem)
    base = canon_name
    if stem.startswith("lung_"):
        return canon_name
    if stem.startswith("gluteus_"):
        base = stem.replace("_left", "").replace("_right", "").replace("_", " ").capitalize()
    if stem.startswith("autochthon"):
        base = "Deep back muscles"
    return (s.capitalize() + " " + base[0].lower() + base[1:]) if s else base


NZ = 293                 # slices in the axial volume; z index 0 is SUPERIOR (measured, see below)


def world_from_voxel(x, y, z):
    """Voxel index -> viewer world: x=patient-left(+x), y=superior(+y), z=anterior(+z).

    Directions were MEASURED on the masks, not read from the header: liver centroid x=200 vs
    spleen 70 (so +x is the patient's right), bladder y=155 vs spinal cord 97 (+y anterior),
    liver z=50 vs prostate 254 (+z INFERIOR, although the NIfTI affine says 'S'). The shipped
    coronal images have the liver at the top, which agrees with z=0 being superior."""
    # +x in the viewer is the patient's LEFT (BodyParts3D's frame: its left kidney sits at +x),
    # so the volume's right-increasing x is negated.
    return np.stack([(143.5 - x) * MM, (NZ - 1 - z) * MM + Y0, (y - 143.5) * MM], axis=-1)


def mesh_label(seg, value):
    return mesh_mask(seg == value)


def mesh_mask(mask, sigma=SMOOTH_SIGMA, step=1):
    m = mask.astype(np.float32)
    if sigma:
        m = ndimage.gaussian_filter(m, sigma)
    v, f, _, _ = measure.marching_cubes(m, level=0.5, spacing=(1.0, 1.0, 1.0), step_size=step)
    w = world_from_voxel(v[:, 0], v[:, 1], v[:, 2]).astype(np.float32)
    # (x, y, z) -> (-x, -z, y): a swap plus two sign flips = three reflections = a reflection,
    # so marching_cubes' outward winding must be flipped to keep faces outward.
    f = f[:, [0, 2, 1]].astype(np.uint32)
    return w, f


def locate_slices(mod_id, kind, vol_hu, atlas, spacing):
    """For every shipped slice, find the volume index whose windowed, displayed image best
    matches the shipped .webp (normalised cross-correlation at 96 px). The shipped image IS
    the ground truth of what the slice shows, so matching it verifies image, mask and mesh
    share one geometry instead of assuming the pipeline's pick list."""
    from PIL import Image
    from slices import apply_window, WINDOWS
    c, wd = WINDOWS["soft-tissue"]
    n = vol_hu.shape[2]
    S = 96

    def small(a):
        im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), mode="L").resize((S, S), Image.BILINEAR)
        v = np.asarray(im, dtype=np.float32); v -= v.mean(); return v / (np.linalg.norm(v) + 1e-6)

    cand = [small(apply_window(to_display(vol_hu[:, :, k]), c, wd)) for k in range(n)]
    out = {}
    for s in atlas["slices"]:
        path = os.path.join(_REPO, s["img"].lstrip("/"))
        if not os.path.exists(path):
            continue
        im = Image.open(path).convert("L")
        v = np.asarray(im, dtype=np.float32) / 255.0
        ref = small(v)
        scores = np.array([float((ref * ck).sum()) for ck in cand])
        k = int(scores.argmax())
        srt = np.sort(scores)
        out[s["i"]] = {"k": k, "agree": round(float(srt[-1]), 3), "margin": round(float(srt[-1] - srt[-2]), 4)}
    return out


def map_ref_to_orig(kind, seg_orig, seg_ref):
    """The coronal/sagittal volumes are transposed CROPS of the original. Recover, for each
    reformatted slice k, the original index along the slice axis plus the crop offsets of
    the other two axes, by exact slab equality."""
    X, Y, Z = seg_orig.shape
    a, b, n = seg_ref.shape
    # Match on two slabs that CONTAIN labels. The edge slabs are empty and equal every empty
    # slab of the original, which is how a first version mapped every slice to index 0.
    counts = (seg_ref > 0).reshape(-1, n).sum(axis=0)
    k1 = int(counts.argmax())
    k2 = int(max((k for k in range(n) if counts[k] > 0 and abs(k - k1) >= 8), key=lambda k: counts[k], default=-1))
    if k2 < 0:
        raise SystemExit(f"{kind}: not enough labelled slabs to register the crop")

    def find(kslab, matcher):
        hits = [i for i in range(matcher.n) if np.array_equal(seg_ref[:, :, kslab], matcher.slab(i))]
        return hits

    # Measured (dbg): coronal slab == fliplr(orig[x0:x0+a, y, :]) i.e. ref[c, zz, k] = orig[x0+c, y_k, Z-1-zz];
    # sagittal slab == flipud(fliplr(orig[x, y0:y0+a, :])) i.e. ref[j, zz, k] = orig[x_k, y0+a-1-j, Z-1-zz].
    if kind == "coronal":
        for x0 in range(0, X - a + 1):
            m = type("M", (), {"n": Y, "slab": staticmethod(lambda i, x0=x0: np.fliplr(seg_orig[x0:x0 + a, i, :]))})
            h1, h2 = find(k1, m), find(k2, m)
            if len(h1) == 1 and len(h2) == 1:
                step = (h2[0] - h1[0]) / (k2 - k1)
                if abs(abs(step) - 1) > 1e-6:
                    raise SystemExit(f"coronal: unexpected step {step}")
                return {"x0": x0, "y_of_k": [max(0, min(Y - 1, int(round(h1[0] + (k - k1) * step)))) for k in range(n)], "z0": 0}
        raise SystemExit("coronal crop could not be matched")
    if kind == "sagittal":
        for y0 in range(0, Y - a + 1):
            m = type("M", (), {"n": X, "slab": staticmethod(lambda i, y0=y0: np.flipud(np.fliplr(seg_orig[i, y0:y0 + a, :])))})
            h1, h2 = find(k1, m), find(k2, m)
            if len(h1) == 1 and len(h2) == 1:
                step = (h2[0] - h1[0]) / (k2 - k1)
                if abs(abs(step) - 1) > 1e-6:
                    raise SystemExit(f"sagittal: unexpected step {step}")
                return {"y0": y0, "x_of_k": [max(0, min(X - 1, int(round(h1[0] + (k - k1) * step)))) for k in range(n)], "z0": 0}
        raise SystemExit("sagittal crop could not be matched")
    return {}


def plane_for(kind, k, crop, shape_orig, shape_ref):
    """World-space frame of the displayed slice: `tl` is the voxel under the image's top-left
    pixel, `u` spans the columns, `v` spans the rows (downwards). Derived from the SAME chain
    the pipeline draws with (to_display = flipud(slab.T)), so texture and meshes coincide.

      axial:    display[r, c] = orig[c, Y-1-r, k]
      coronal:  display[r, c] = orig[x0+c, y_k, r]          (ref slab is z-flipped)
      sagittal: display[r, c] = orig[x_k, y0+a-1-c, r]      (ref slab is y- and z-flipped)
    """
    X, Y, Z = shape_orig
    def frame(v_tl, v_u, v_v, axis):
        tl = world_from_voxel(*v_tl); pu = world_from_voxel(*v_u); pv = world_from_voxel(*v_v)
        return {"axis": axis, "pos": float(tl["xyz".index(axis)]),
                "tl": [float(x) for x in tl], "u": [float(x) for x in (pu - tl)], "v": [float(x) for x in (pv - tl)]}
    if kind == "axial":
        return frame((0, Y - 1, k), (X - 1, Y - 1, k), (0, 0, k), "y")
    a, b, n = shape_ref
    if kind == "coronal":
        y = crop["y_of_k"][k]; x0 = crop["x0"]
        return frame((x0, y, 0), (x0 + a - 1, y, 0), (x0, y, Z - 1), "z")
    if kind == "sagittal":
        x = crop["x_of_k"][k]; y0 = crop["y0"]
        return frame((x, y0 + a - 1, 0), (x, y0, 0), (x, y0 + a - 1, Z - 1), "x")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(_HERE, "work", "tsd"))
    ap.add_argument("--out", default=os.path.join(_HERE, "work", "live3d"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    lab = json.load(open(os.path.join(_HERE, "labels", "ct-live-torso-axial.json")))
    onto = json.load(open(os.path.join(_HERE, "ontology.json")))["structures"]
    mv = {int(k): v for k, v in lab["model_values"].items()}
    ml = lab["model_labels"]
    sid_of_value = {k: ml.get(v) for k, v in mv.items() if ml.get(v)}

    seg = np.asanyarray(nib.load(os.path.join(a.work, "live_seg.nii.gz")).dataobj).astype(np.uint16)
    print("volume", seg.shape)

    # ---- meshes ----
    parts, blob = [], bytearray()
    for value in sorted(sid_of_value):
        stem, sid = mv[value], sid_of_value[value]
        if not (seg == value).any():
            continue
        cid = sid.replace("-", "_").upper()
        w, f = mesh_label(seg, value)
        off_p = len(blob); blob.extend(w.tobytes())
        off_i = len(blob); blob.extend(f.tobytes())
        parts.append({
            "id": "LIVE_" + stem, "stem": stem, "sid": sid, "canon": cid, "side": side_of(stem),
            "name": pretty(stem, onto[cid]["display_name"]), "system": system_of(stem),
            "region": onto[cid]["region"], "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
            "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])],
        })
        print(f"  {stem:32} {len(f):7d} tris -> {cid}")
    # ---- the skeleton and the body surface: what makes it read as a patient, not floating organs ----
    # The slice modules deliberately dropped bone (see the label file's _why_bone_dropped); the 3D
    # body needs it as a frame. Masks come from the dataset's per-structure files (same subject,
    # same grid: the merged live_seg only carries the mapped organs). Bones below ~400 voxels are
    # fragments clipped by the scan edge (T9, right 6th rib) and are skipped.
    segdir = os.path.join(a.work, "s0108", "segmentations")
    extra = []
    for lv in ("T10", "T11", "T12"):
        extra.append((f"vertebrae_{lv}", "THORACIC_VERTEBRA", "SPINE", f"{lv} vertebra"))
    for lv in ("L1", "L2", "L3", "L4", "L5"):
        extra.append((f"vertebrae_{lv}", "LUMBAR_VERTEBRA", "SPINE", f"{lv} vertebra"))
    extra.append(("vertebrae_S1", "SACRUM", "SPINE", "S1 vertebra"))
    extra.append(("sacrum", "SACRUM", "PELVIS", "Sacrum"))
    ORD = {6: "6th", 7: "7th", 8: "8th", 9: "9th", 10: "10th", 11: "11th", 12: "12th"}
    for side in ("left", "right"):
        for n in range(6, 13):
            extra.append((f"rib_{side}_{n}", "RIB", "CHEST", f"{side.capitalize()} {ORD[n]} rib"))
        extra.append((f"hip_{side}", "HIP_BONE", "PELVIS", f"{side.capitalize()} hip bone"))
        extra.append((f"femur_{side}", "FEMUR", "PELVIS", f"{side.capitalize()} femur"))
    extra.append(("costal_cartilages", None, "CHEST", "Costal cartilages"))
    for stem, cid, region, name in extra:
        fp = os.path.join(segdir, stem + ".nii.gz")
        if not os.path.exists(fp):
            continue
        mask = np.asanyarray(nib.load(fp).dataobj) > 0
        if mask.sum() < 400:
            continue
        if cid and cid not in onto:
            raise SystemExit(f"{stem}: canonical {cid} missing from the ontology")
        w, f = mesh_mask(mask)
        off_p = len(blob); blob.extend(w.tobytes())
        off_i = len(blob); blob.extend(f.tobytes())
        parts.append({
            "id": "LIVE_" + stem, "stem": stem, "sid": None, "canon": cid, "side": side_of(stem),
            "name": name, "system": "skeletal", "region": region,
            "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
            "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])],
        })
        print(f"  {stem:32} {len(f):7d} tris -> {cid}")

    # Body surface from the CT itself (HU > -350, holes filled per slice, largest component).
    hu = np.asanyarray(nib.load(os.path.join(a.work, "live_vol.nii.gz")).dataobj)
    body = hu > -350
    body = ndimage.binary_opening(body, iterations=2)
    for k in range(body.shape[2]):
        body[:, :, k] = ndimage.binary_fill_holes(body[:, :, k])
    lab_, n_ = ndimage.label(body)
    if n_ > 1:
        sizes = ndimage.sum(body, lab_, range(1, n_ + 1))
        body = lab_ == (int(np.argmax(sizes)) + 1)
    w, f = mesh_mask(body, sigma=1.2, step=2)
    off_p = len(blob); blob.extend(w.tobytes())
    off_i = len(blob); blob.extend(f.tobytes())
    parts.append({
        "id": "LIVE_body_surface", "stem": "body_surface", "sid": None, "canon": None, "side": None,
        "name": "Body surface (skin)", "system": "integumentary", "region": "BODY",
        "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
        "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])],
    })
    print(f"  {'body_surface':32} {len(f):7d} tris -> skin (HU threshold)")
    open(os.path.join(a.out, "parts.bin"), "wb").write(bytes(blob))

    # ---- slice planes ----
    planes = {}
    for mod_id, kind in MODULES.items():
        ap_ = os.path.join(_REPO, "atlas", mod_id, "atlas.json")
        if not os.path.exists(ap_):
            continue
        atlas = json.load(open(ap_))
        seg_ref = None
        crop = {}
        if kind != "axial":
            seg_ref = np.asanyarray(nib.load(os.path.join(a.work, f"live_{kind}_seg.nii.gz")).dataobj).astype(np.uint16)
            crop = map_ref_to_orig(kind, seg, seg_ref)
        spacing = (MM * 1000, MM * 1000)
        hu = np.asanyarray(nib.load(os.path.join(a.work, "live_vol.nii.gz" if kind == "axial" else f"live_{kind}.nii.gz")).dataobj).astype(np.float32)
        loc = locate_slices(mod_id, kind, hu, atlas, spacing)
        # The stack is 24 evenly spaced picks (slices.pick_slice_indices), so index k must be
        # linear in slice number i. Fit the confidently located slices, reject any that is
        # more than 2 voxels off the line, and fill the rest FROM the line. This turns "the
        # pins agree" into "the pins agree AND the geometry is where the pipeline put it".
        good = {i: r for i, r in loc.items() if r["agree"] >= 0.6}
        if len(good) < 4:
            raise SystemExit(f"{mod_id}: only {len(good)} slices located")
        xs = np.array(sorted(good)); ys = np.array([good[i]["k"] for i in xs])
        slope, icpt = np.polyfit(xs, ys, 1)
        resid = ys - (slope * xs + icpt)
        keep = np.abs(resid) <= 2.0
        slope, icpt = np.polyfit(xs[keep], ys[keep], 1)
        n_tot = len(atlas["slices"])
        planes[mod_id] = {}
        for s in atlas["slices"]:
            i = s["i"]
            k = int(round(slope * i + icpt))
            k = max(0, min((seg_ref.shape[2] if seg_ref is not None else seg.shape[2]) - 1, k))
            p = plane_for(kind, k, crop, seg.shape, seg_ref.shape if seg_ref is not None else None)
            p["agree"] = loc.get(i, {}).get("agree", 0.0)
            p["k"] = k
            planes[mod_id][str(i)] = p
        print(f"  {mod_id}: {int(keep.sum())}/{len(good)} confident slices on the line "
              f"(slope {slope:.2f} idx/slice, max residual {np.abs(resid[keep]).max():.1f}); "
              f"{n_tot} planes written")

    json.dump({
        "frame": {"mm": MM, "y0": Y0, "axes": "x=patient-left (BodyParts3D frame), y=superior, z=anterior; metres"},
        "source": {"dataset": "TotalSegmentator dataset v2.0.1, subject s0108", "licence": "CC BY 4.0",
                   "doi": "10.5281/zenodo.10047292", "note": lab.get("_geometry", "")},
        "parts": parts, "planes": planes,
    }, open(os.path.join(a.out, "live3d.json"), "w"), indent=1)
    print("parts", len(parts), "bytes", len(blob))


if __name__ == "__main__":
    main()
