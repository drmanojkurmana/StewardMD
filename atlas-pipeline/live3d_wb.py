#!/usr/bin/env python3
"""Whole-body LIVING model from the Visible Human frozen CT.

The s0108 living body (live3d.py) is a torso only - the scan stops at the chest and the
thighs. This meshes the FULL Visible Human CT (vhp_volume.py stack -> wb_vol.nii.gz) plus
its TotalSegmentator `total` segmentation (ts_wb_full.py -> wb_seg_full.nii.gz, multilabel,
1.5 mm model) into a head-to-toe living body: a skin envelope over the whole body, the full
skeleton, the organs, the great vessels, the deep muscles, and the brain and spinal cord.

Standalone upright frame (metres), NOT co-registered to the BodyParts3D reference body:
this is its own body, viewed on its own. VHP axial array is [X, Y, Z] with X patient
left->right, Y posterior->anterior, Z slice index 0 SUPERIOR. The viewer frame is
+x = patient LEFT, +y = up, +z = anterior, so x is negated (and the winding flipped) and
z (superior->inferior) is mapped to a descending y with the feet at 0.

Cut planes: every shipped VHP CT slice module (whole body, head, thorax, abdomen, pelvis)
was cut from this same stack; wb_planes.py finds each shipped picture in the volume again
and the frames are written out through the SAME world() used for the meshes.

Known limits of the cadaver, measured earlier in this atlas (labels/ct-wholebody-axial.json):
frozen soft tissue reads off-scale (lung -540 HU, pelvic muscle on fat), so organ and muscle
surfaces here are the model's best reading of a frozen body, not clinical ground truth;
bone is unambiguous. The arms lie alongside the trunk, which the model mislabels as femur /
humerus / scapula in places: long-bone components are re-sided and re-assigned by height
against the pelvis before meshing.
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
from live3d import taubin_smooth, system_of, pretty  # noqa: E402

SX = SY = 0.9375e-3   # in-plane 0.9375 mm (GE header: 480 mm FOV / 512)
SZ = 1.0e-3           # 1 mm slices

# ---- TotalSegmentator `total` class -> (canonical, system, region). canonical None = shown, unlinked.
BONES = {"skull": ("SKULL", "HEAD"), "sacrum": ("SACRUM", "PELVIS"), "vertebrae_S1": ("SACRUM", "PELVIS"),
         "sternum": ("STERNUM", "CHEST"), "costal_cartilages": (None, "CHEST")}
for lv in ("C1", "C2", "C3", "C4", "C5", "C6", "C7"):
    BONES["vertebrae_" + lv] = ("CERVICAL_VERTEBRA", "SPINE")
for lv in ("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"):
    BONES["vertebrae_" + lv] = ("THORACIC_VERTEBRA", "SPINE")
for lv in ("L1", "L2", "L3", "L4", "L5"):
    BONES["vertebrae_" + lv] = ("LUMBAR_VERTEBRA", "SPINE")
for s in ("left", "right"):
    BONES["hip_" + s] = ("HIP_BONE", "PELVIS")
    BONES["femur_" + s] = ("FEMUR", "LOWER_LIMB")
    BONES["clavicula_" + s] = ("CLAVICLE", "CHEST")
    BONES["scapula_" + s] = (None, "UPPER_LIMB")
    BONES["humerus_" + s] = (None, "UPPER_LIMB")
    for i in range(1, 13):
        BONES["rib_%s_%d" % (s, i)] = ("RIB", "CHEST")

SOFT = {  # name: (canonical, system, region)
    "brain": ("BRAIN", "nervous", "BRAIN"), "spinal_cord": ("SPINAL_CORD", "nervous", "SPINE"),
    "trachea": (None, "respiratory", "NECK"), "thyroid_gland": (None, "endocrine", "NECK"),
    "esophagus": ("ESOPHAGUS", "digestive", "CHEST"),
    "lung_upper_lobe_left": ("UPPER_LOBE_LEFT", "respiratory", "CHEST"), "lung_lower_lobe_left": ("LOWER_LOBE_LEFT", "respiratory", "CHEST"),
    "lung_upper_lobe_right": (None, "respiratory", "CHEST"), "lung_middle_lobe_right": ("MIDDLE_LOBE_RIGHT", "respiratory", "CHEST"),
    "lung_lower_lobe_right": ("LOWER_LOBE_RIGHT", "respiratory", "CHEST"),
    "heart": ("HEART", "cardiac", "CHEST"), "atrial_appendage_left": (None, "cardiac", "CHEST"),
    "aorta": ("AORTA", "arterial", "CHEST"), "brachiocephalic_trunk": (None, "arterial", "CHEST"),
    "superior_vena_cava": (None, "venous", "CHEST"), "pulmonary_vein": (None, "venous", "CHEST"),
    "inferior_vena_cava": ("INFERIOR_VENA_CAVA", "venous", "ABDOMEN"), "portal_vein_and_splenic_vein": ("PORTAL_VEIN", "venous", "ABDOMEN"),
    "liver": ("LIVER", "digestive", "ABDOMEN"), "gallbladder": ("GALLBLADDER", "digestive", "ABDOMEN"),
    "spleen": ("SPLEEN", "lymphatic", "ABDOMEN"), "pancreas": ("PANCREAS", "digestive", "ABDOMEN"),
    "stomach": ("STOMACH", "digestive", "ABDOMEN"), "duodenum": ("DUODENUM", "digestive", "ABDOMEN"),
    "small_bowel": ("SMALL_BOWEL", "digestive", "ABDOMEN"), "colon": ("COLON", "digestive", "ABDOMEN"),
    "urinary_bladder": ("URINARY_BLADDER", "urinary", "PELVIS"), "prostate": ("PROSTATE", "reproductive", "PELVIS"),
}
for s in ("left", "right"):
    SOFT["kidney_" + s] = ("KIDNEY", "urinary", "ABDOMEN")
    SOFT["adrenal_gland_" + s] = ("ADRENAL_GLAND", "endocrine", "ABDOMEN")
    SOFT["common_carotid_artery_" + s] = (None, "arterial", "NECK")
    SOFT["subclavian_artery_" + s] = (None, "arterial", "CHEST")
    SOFT["brachiocephalic_vein_" + s] = (None, "venous", "CHEST")
    SOFT["iliac_artery_" + s] = ("ILIAC_ARTERY", "arterial", "PELVIS")
    SOFT["iliac_vena_" + s] = ("ILIAC_VEIN", "venous", "PELVIS")
    SOFT["autochthon_" + s] = ("AUTOCHTHONOUS_BACK_MUSCLE", "muscular", "SPINE")
    SOFT["iliopsoas_" + s] = ("ILIOPSOAS", "muscular", "PELVIS")
    for g in ("maximus", "medius", "minimus"):
        SOFT["gluteus_%s_%s" % (g, s)] = ("GLUTEAL_MUSCLE", "muscular", "PELVIS")

NAMES = {"trachea": "Trachea", "thyroid_gland": "Thyroid gland", "atrial_appendage_left": "Left atrial appendage",
         "brachiocephalic_trunk": "Brachiocephalic trunk", "superior_vena_cava": "Superior vena cava",
         "pulmonary_vein": "Pulmonary veins", "portal_vein_and_splenic_vein": "Portal and splenic veins",
         "lung_upper_lobe_right": "Upper lobe of right lung", "common_carotid_artery": "Common carotid artery",
         "subclavian_artery": "Subclavian artery", "brachiocephalic_vein": "Brachiocephalic vein",
         "iliac_vena": "Iliac vein", "iliac_artery": "Iliac artery", "spinal_cord": "Spinal cord", "brain": "Brain"}


def wb_side(stem):
    # TotalSegmentator names ribs "rib_left_5" (side in the MIDDLE), so a trailing-token test
    # is not enough - look for the side token anywhere.
    toks = stem.split("_")
    if "left" in toks:
        return "left"
    if "right" in toks:
        return "right"
    return None


def pretty_bone(stem):
    s = wb_side(stem)
    if stem.startswith("vertebrae_"):
        return stem.split("_")[1] + " vertebra"
    if stem.startswith("rib_"):
        n = stem.split("_")[2]
        return "%s rib %s" % (s.capitalize(), n) if s else ("Rib " + n)
    base = stem.replace("_left", "").replace("_right", "").replace("clavicula", "clavicle").replace("_", " ")
    base = base[0].upper() + base[1:]
    return (s.capitalize() + " " + base[0].lower() + base[1:]) if s else base


def pretty_soft(stem, onto, canon):
    s = wb_side(stem)
    base = stem.replace("_left", "").replace("_right", "")
    if canon and canon in onto:
        return pretty(stem, onto[canon]["display_name"])
    name = NAMES.get(stem) or NAMES.get(base) or base.replace("_", " ").capitalize()
    return (s.capitalize() + " " + name[0].lower() + name[1:]) if s else name


def largest_cc(mask):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def fix_long_bones(seg, ids, cx, log=print):
    """The cadaver's arms lie against the trunk, and the model calls stretches of them femur
    or scapula (and stretches of the thigh humerus). Pool humerus + femur, then decide each
    connected piece by height against the hip bones: above the pelvis it is an arm bone,
    below it a thigh bone; side comes from which side of the midline it lies. Scapula pieces
    below the pelvis top are arm too, and are dropped from scapula."""
    hip = np.zeros(seg.shape[2], bool)
    for n in ("hip_left", "hip_right"):
        if n in ids:
            hip |= (seg == ids[n]).any(axis=(0, 1))
    if not hip.any():
        log("  long bones: no hip found, left as segmented")
        return
    # Top of the pelvis (slice 0 is the vertex). A percentile, not the first hit: the model
    # leaves stray hip-labelled blobs far up the body and one sat in the head.
    zs_hip = np.repeat(np.arange(seg.shape[2]), [int((seg[:, :, z] == ids.get("hip_left", -1)).sum() + (seg[:, :, z] == ids.get("hip_right", -1)).sum()) if hip[z] else 0 for z in range(seg.shape[2])])
    z_hip = int(np.percentile(zs_hip, 2))
    pool = np.zeros(seg.shape, bool)
    for n in ("humerus_left", "humerus_right", "femur_left", "femur_right"):
        if n in ids:
            pool |= seg == ids[n]
            seg[seg == ids[n]] = 0
    lab, k = ndimage.label(pool)
    objs = ndimage.find_objects(lab)
    moved = 0
    for j, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        comp = lab[sl] == j
        nvox = int(comp.sum())
        if nvox < 2000:
            continue
        xs, _, zs = np.nonzero(comp)
        zc = sl[2].start + zs.mean()
        xc = sl[0].start + xs.mean()
        side = "left" if xc > cx else "right"
        # Arm if its centre sits above the pelvis top; thigh if below.
        bone = "humerus_" if zc < z_hip else "femur_"
        name = bone + side
        if name not in ids:
            continue
        seg[sl][comp] = ids[name]
        moved += 1
    for n in ("scapula_left", "scapula_right"):
        if n not in ids:
            continue
        m = seg == ids[n]
        lab, k = ndimage.label(m)
        for j, sl in enumerate(ndimage.find_objects(lab), start=1):
            if sl is None:
                continue
            comp = lab[sl] == j
            zc = sl[2].start + np.nonzero(comp)[2].mean()
            if zc > z_hip:
                seg[sl][comp] = 0
    log("  long bones: pelvis top at slice %d, %d humerus/femur pieces re-assigned by height" % (z_hip, moved))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(_HERE, "work"))
    ap.add_argument("--out", default=os.path.join(_HERE, "work", "wb3d"))
    ap.add_argument("--seg", default=None, help="multilabel NIfTI (default: wb_seg_full.nii.gz, else wb_seg.nii.gz)")
    ap.add_argument("--min-vox", type=int, default=400)
    ap.add_argument("--sigma", type=float, default=1.0)
    ap.add_argument("--smooth", type=int, default=12)
    ap.add_argument("--no-planes", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    onto = json.load(open(os.path.join(_HERE, "ontology.json")))["structures"]
    from totalsegmentator.map_to_binary import class_map
    cm = class_map["total"]                       # {label_id: name}
    ids = {v: k for k, v in cm.items()}

    seg_path = a.seg or (os.path.join(a.work, "wb_seg_full.nii.gz") if os.path.exists(os.path.join(a.work, "wb_seg_full.nii.gz"))
                         else os.path.join(a.work, "wb_seg.nii.gz"))
    seg = np.asanyarray(nib.load(seg_path).dataobj).astype(np.uint8)
    hu = np.asanyarray(nib.load(os.path.join(a.work, "wb_vol.nii.gz")).dataobj)     # int16, no copy
    print("volume", seg.shape, "labels present", len(np.unique(seg)) - 1, "from", os.path.basename(seg_path), flush=True)
    X, Y, NZ = seg.shape

    # Body mask (skin envelope) from HU, and the in-plane centre to stand the body on the axis.
    body = hu > -350
    body = ndimage.binary_opening(body, iterations=2)
    for k in range(NZ):
        body[:, :, k] = ndimage.binary_fill_holes(body[:, :, k])
    body = largest_cc(body)
    bx, by, _ = np.nonzero(body[:, :, ::8])
    cx, cy = float(bx.mean()), float(by.mean())
    print("body centre voxel (%.1f, %.1f), height %d slices (%.2f m)" % (cx, cy, NZ, NZ * SZ), flush=True)

    def world(x, y, z):
        # x negated -> patient left +; z 0 superior -> descending y with feet near 0; y -> anterior.
        return np.stack([-(x - cx) * SX, (NZ - 1 - z) * SZ, (y - cy) * SY], axis=-1)

    fix_long_bones(seg, ids, cx)

    def mesh(mask, origin, scale=1, sigma=a.sigma, step=1, smooth=a.smooth):
        # `mask` is a bounding-box crop; `origin` its voxel offset; `scale` the voxels per
        # crop cell (2 for the half-resolution skin). Blur just past the voxel step, march,
        # Taubin-smooth (volume preserving) so the surface reads as anatomy.
        m = mask.astype(np.float32)
        if sigma:
            m = ndimage.gaussian_filter(m, sigma)
        v, f, _, _ = measure.marching_cubes(m, level=0.5, spacing=(1.0, 1.0, 1.0), step_size=step)
        if smooth and len(v) > 8:
            v = taubin_smooth(v, f, iters=smooth)
        v = v * scale + np.asarray(origin, np.float32)
        w = world(v[:, 0], v[:, 1], v[:, 2]).astype(np.float32)
        f = f[:, [0, 2, 1]].astype(np.uint32)     # x-negation is a reflection: flip winding
        return w, f

    parts, blob = [], bytearray()

    def add(pid, stem, sid, canon, side, name, system, region, w, f):
        off_p = len(blob); blob.extend(w.tobytes())
        off_i = len(blob); blob.extend(f.tobytes())
        parts.append({"id": pid, "stem": stem, "sid": sid, "canon": canon, "side": side,
                      "name": name, "system": system, "region": region,
                      "pos": off_p, "nv": int(len(w)), "idx": off_i, "ni": int(len(f) * 3),
                      "bounds": [float(v) for v in np.concatenate([w.min(0), w.max(0)])]})
        print("  %-30s %7d tris -> %s/%s" % (stem, len(f), system, canon), flush=True)

    PAD = 4
    boxes = ndimage.find_objects(seg)
    for lid, sl in enumerate(boxes, start=1):
        if sl is None or lid not in cm:
            continue
        name = cm[lid]
        if name not in BONES and name not in SOFT:
            continue                                   # kidney cysts and anything unmapped
        sl = tuple(slice(max(0, s.start - PAD), min(n, s.stop + PAD)) for s, n in zip(sl, seg.shape))
        mask = seg[sl] == lid
        if int(mask.sum()) < a.min_vox:
            continue
        mask = largest_cc(mask)
        origin = [s.start for s in sl]
        if name in BONES:
            canon, region = BONES[name]
            if canon and canon not in onto:
                canon = None
            add("WB_" + name, name, None, canon, wb_side(name), pretty_bone(name), "skeletal", region, *mesh(mask, origin))
        else:
            canon, system, region = SOFT[name]
            if canon and canon not in onto:
                canon = None
            add("WB_" + name, name, canon.lower().replace("_", "-") if canon else None, canon,
                wb_side(name), pretty_soft(name, onto, canon), system, region, *mesh(mask, origin))
    del seg

    # Skin envelope over the whole body, meshed at half resolution (it is a smooth envelope,
    # and the full-grid blur alone would need 2 GB).
    body2 = body[::2, ::2, ::2]
    del body
    w, f = mesh(body2, (0, 0, 0), scale=2, sigma=0.8, step=1)
    add("WB_body_surface", "body_surface", None, None, None, "Body surface (skin)",
        "integumentary", "BODY", w, f)
    del body2

    open(os.path.join(a.out, "parts.bin"), "wb").write(bytes(blob))

    planes = {}
    if not a.no_planes:
        from wb_planes import register_all
        print("registering the shipped VHP slice modules as cut planes", flush=True)
        planes = register_all(hu, world)

    meta = {
        "frame": {"units": "m", "up": "y", "anterior": "z", "left": "x", "centre_voxel": [cx, cy], "slices": NZ,
                  "spacing_mm": [SX * 1e3, SY * 1e3, SZ * 1e3]},
        "source": {"dataset": "Visible Human Project frozen CT (U.S. National Library of Medicine)",
                   "licence": "US Government work, no copyright; NLM Terms and Conditions apply",
                   "segmentation": "TotalSegmentator `total` 1.5 mm model (Apache-2.0), run in z-chunks (ts_wb_full.py)",
                   "caveat": "Frozen cadaver: soft-tissue HU are off-scale, so organ and muscle surfaces are the model's "
                             "reading of a frozen body; bone is unambiguous. Forearm and lower-leg bones are not in "
                             "the `total` model (the appendicular model is licence-blocked)."},
        "planes": planes,
        "parts": parts,
    }
    json.dump(meta, open(os.path.join(a.out, "wb3d.json"), "w"))
    print("parts", len(parts), "bytes", len(blob), "plane modules", sorted(planes), flush=True)


if __name__ == "__main__":
    main()
