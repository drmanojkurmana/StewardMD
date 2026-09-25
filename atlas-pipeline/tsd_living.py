#!/usr/bin/env python3
"""One TotalSegmentator subject -> a living-CT module group (axial, coronal, sagittal).

The ct-live-torso-* chain (s0108) was assembled by hand; this is the same chain as one
command, for any subject of the CC BY 4.0 dataset:

  1. tsd_combine.py merges and HU-validates the subject's expert masks (no model is run);
  2. the volume's anatomical axes are MEASURED from its own masks, never read from the
     header (s0108's header said RAS while z index 0 was superior): superior/inferior from a
     cervical vertebra vs a lower one, anterior/posterior from the trachea vs the spinal cord,
     left/right from the normal left aortic arch (descending aorta left of the cord,
     brachiocephalic trunk right of the trachea) and the heart when it is in the scan;
  3. the array is re-indexed into the torso convention (x = patient right, y = anterior,
     z index 0 = superior), so orient.to_display() and vhp_volume.reformat() apply unchanged;
  4. vhp_volume.crop_pair / reformat cut the axial, coronal and sagittal volumes exactly as
     for the torso, and the index maps M (module index -> group volume index) that living.py
     proves voxel for voxel are written next to them;
  5. build.py's own path (extract_slices -> pins_from_segmentation -> assemble -> the
     viewer's validator) writes atlas/<id>/NNN.webp + atlas.json, and a modules.json row.

Then `living.py --group <g> --write` proves the maps, the byte-identical images, q and the
plane crossings, and writes q, mm, windows. Orientation letters are NOT written here: they
go into modules.json by hand from the evidence this script prints (docs/radioanatome/ORIENTATION.md).

Usage:
  .venv/bin/python atlas-pipeline/tsd_living.py --subject s0021 --group live-neck \
      --prefix ct-live-neck --work /abs/atlas-pipeline/work [--write]
Without --write it only measures and prints the evidence.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)

SOURCE = "totalsegmentator-dataset"
SPACING = (1.5, 1.5, 1.5)              # the dataset authors resampled every study to 1.5 mm


def _mask(sub_dir, stem):
    import nibabel as nib
    p = os.path.join(sub_dir, "segmentations", stem + ".nii.gz")
    if not os.path.exists(p):
        return None
    m = np.asanyarray(nib.load(p).dataobj) > 0
    return m if m.sum() >= 150 else None


def _cen(m):
    return np.argwhere(m).mean(axis=0)


def measure_axes(sub_dir):
    """Return (perm, flip, evidence): canonical axis c comes from source axis perm[c], reversed
    when flip[c]. Canonical: 0 = +patient RIGHT, 1 = +ANTERIOR, 2 = +INFERIOR (index 0 superior).
    Every axis must be decided by anatomy, and every available landmark must agree."""
    ev = []
    sup = next((s for s in ("vertebrae_C2", "vertebrae_C3", "vertebrae_C4") if _mask(sub_dir, s) is not None), None)
    inf = next((s for s in ("vertebrae_T4", "vertebrae_T3", "vertebrae_T2", "vertebrae_T1", "vertebrae_C7")
                if _mask(sub_dir, s) is not None), None)
    if not sup or not inf:
        raise SystemExit("no pair of vertebrae to fix superior/inferior")
    cs, ci = _cen(_mask(sub_dir, sup)), _cen(_mask(sub_dir, inf))
    si = int(np.argmax(np.abs(cs - ci)))
    ev.append("S/I: %s centroid index %s vs %s %s -> source axis %d, +index is %s"
              % (sup, np.round(cs, 1).tolist(), inf, np.round(ci, 1).tolist(), si,
                 "INFERIOR" if ci[si] > cs[si] else "SUPERIOR"))
    s_flip = not (ci[si] > cs[si])            # want +index inferior

    tr, cord = _mask(sub_dir, "trachea"), _mask(sub_dir, "spinal_cord")
    if tr is None or cord is None:
        raise SystemExit("trachea and spinal cord are both needed for anterior/posterior")
    ct_, cc = _cen(tr), _cen(cord)
    rest = [a for a in range(3) if a != si]
    ap = max(rest, key=lambda a: abs(ct_[a] - cc[a]))
    ev.append("A/P: trachea %s vs spinal cord %s -> source axis %d, +index is %s"
              % (np.round(ct_, 1).tolist(), np.round(cc, 1).tolist(), ap,
                 "ANTERIOR" if ct_[ap] > cc[ap] else "POSTERIOR"))
    a_flip = not (ct_[ap] > cc[ap])
    lr = ({0, 1, 2} - {si, ap}).pop()

    def level_pair(m, ref):
        """Centroids of mask m and of ref on the slices (along S/I) where BOTH are present:
        a flexed or tilted neck moves the midline between levels, so a landmark is only ever
        compared with the reference at its own level."""
        zs = sorted(set(np.flatnonzero(m.any(axis=tuple(a for a in range(3) if a != si)))) &
                    set(np.flatnonzero(ref.any(axis=tuple(a for a in range(3) if a != si)))))
        if len(zs) < 3:
            return None
        sl = [slice(None)] * 3
        sl[si] = zs
        return _cen(np.take(m, zs, axis=si)), _cen(np.take(ref, zs, axis=si)), len(zs)

    votes = []
    ao = _mask(sub_dir, "aorta")
    if ao is not None:
        # descending aorta: aorta voxels posterior to the cord's front edge at the same level
        # cannot be the ascending aorta or the arch's anterior limb (normal left arch)
        d = ao.copy()
        yy = np.moveaxis(np.indices(ao.shape)[ap], 0, 0)
        d &= ((yy - cc[ap]) * (1 if not a_flip else -1)) < 20
        if d.sum() >= 150:
            r = level_pair(d, cord)
            if r:
                votes.append(("descending aorta %.1f vs spinal cord %.1f over %d shared levels (descends LEFT of the cord)"
                              % (r[0][lr], r[1][lr], r[2]), r[0][lr] < r[1][lr]))
    svc = _mask(sub_dir, "superior_vena_cava")
    if svc is not None:
        r = level_pair(svc, cord)
        if r:
            votes.append(("superior vena cava %.1f vs spinal cord %.1f over %d shared levels (RIGHT of the midline)"
                          % (r[0][lr], r[1][lr], r[2]), r[0][lr] > r[1][lr]))
    bct = _mask(sub_dir, "brachiocephalic_trunk")
    if bct is not None:
        # the trunk climbs from the arch toward the RIGHT sternoclavicular joint: its top levels
        # (the bifurcation) lie to the patient's right of its bottom levels (the origin)
        zs = np.flatnonzero(bct.any(axis=tuple(x for x in range(3) if x != si)))
        if len(zs) >= 6:
            lo_z, hi_z = (zs[:3], zs[-3:]) if s_flip else (zs[-3:], zs[:3])   # (inferior, superior)
            o, t = _cen(np.take(bct, lo_z, axis=si)), _cen(np.take(bct, hi_z, axis=si))
            votes.append(("brachiocephalic trunk origin %.1f -> bifurcation %.1f (climbs toward the RIGHT)"
                          % (o[lr], t[lr]), t[lr] > o[lr]))
    ht = _mask(sub_dir, "heart")
    if ht is not None and ht.sum() > 20000:
        r = level_pair(ht, cord)
        if r:
            votes.append(("heart %.1f vs spinal cord %.1f over %d shared levels (heart mostly LEFT of the midline)"
                          % (r[0][lr], r[1][lr], r[2]), r[0][lr] < r[1][lr]))
    if len(votes) < 2:
        raise SystemExit("fewer than two left/right landmarks: laterality not decided")
    agree = set(v for _, v in votes)
    for t, v in votes:
        ev.append("R/L: %s -> +index %d is the patient's %s" % (t, lr, "RIGHT" if v else "LEFT"))
    if len(agree) != 1:
        raise SystemExit("left/right landmarks disagree: " + "; ".join(ev))
    r_flip = not agree.pop()                  # want +index = patient right
    # the dataset's own sided labels, reported (NOT evidence: they come from the same volume)
    l, r = _mask(sub_dir, "common_carotid_artery_left"), _mask(sub_dir, "common_carotid_artery_right")
    if l is not None and r is not None:
        ev.append("(labels, not evidence) common_carotid_artery_right %.1f vs _left %.1f on axis %d"
                  % (_cen(r)[lr], _cen(l)[lr], lr))
    return (lr, ap, si), (r_flip, a_flip, s_flip), ev


def canonical(arr, perm, flip):
    """Source array -> canonical [x = +right, y = +anterior, z = +inferior] (a view, then copied)."""
    a = np.transpose(arr, perm)
    for ax, f in enumerate(flip):
        if f:
            a = np.flip(a, axis=ax)
    return np.ascontiguousarray(a)


def module_maps(shape_c, box_ax, box_co, box_sa):
    """Index maps (3x4) module ref index -> canonical group-volume index; derivation in the
    comments of living.py (live_c / live_coronal / live_sagittal). living.py re-proves them."""
    x0, _x1, y0, _y1 = box_ax
    Ny = box_ax[3] - box_ax[2]
    Nz = shape_c[2]
    a0, _, b0, _ = box_co
    s0, _, t0, _ = box_sa
    return {
        "axial": [[1, 0, 0, x0], [0, 1, 0, y0], [0, 0, 1, 0]],
        "coronal": [[1, 0, 0, a0 + x0], [0, 0, -1, Ny - 1 + y0], [0, -1, 0, Nz - 1 - b0]],
        "sagittal": [[0, 0, 1, x0], [-1, 0, 0, Ny - 1 - s0 + y0], [0, -1, 0, Nz - 1 - t0]],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--subject", required=True)
    ap.add_argument("--group", required=True, help="e.g. live-neck")
    ap.add_argument("--prefix", required=True, help="module id prefix, e.g. ct-live-neck")
    ap.add_argument("--work", required=True, help="absolute path to atlas-pipeline/work")
    ap.add_argument("--labels", help="label mapping id (default <prefix>-axial)")
    ap.add_argument("--slices", type=int, default=48)
    ap.add_argument("--title", default="")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    from check_sources import require_clear, load_sources
    require_clear(SOURCE)
    import nibabel as nib
    from vhp_volume import crop_pair, reformat
    work = os.path.abspath(a.work)
    sub_dir = os.path.join(work, "tsd", a.subject)
    gdir = os.path.join(work, "tsd", a.group)
    os.makedirs(gdir, exist_ok=True)

    perm, flip, ev = measure_axes(sub_dir)
    print("axes of %s (measured from its masks; header says %s):" % (
        a.subject, "".join(nib.aff2axcodes(nib.load(os.path.join(sub_dir, "ct.nii.gz")).affine))))
    for e in ev:
        print("  " + e)
    print("  -> canonical x = source axis %d%s, y = axis %d%s, z = axis %d%s" % (
        perm[0], " reversed" if flip[0] else "", perm[1], " reversed" if flip[1] else "",
        perm[2], " reversed" if flip[2] else ""))

    seg_src = os.path.join(gdir, "seg_source.nii.gz")
    rep = os.path.join(gdir, a.subject + "_report.json")
    if not os.path.exists(seg_src):
        subprocess.run([sys.executable, os.path.join(_HERE, "tsd_combine.py"), "--subject-dir", sub_dir,
                        "--out-seg", seg_src, "--out-report", rep, "--structures", "ALL"], check=True)
    ct = np.asanyarray(nib.load(os.path.join(sub_dir, "ct.nii.gz")).dataobj).astype(np.int16)
    sg = np.asanyarray(nib.load(seg_src).dataobj).astype(np.uint16)
    # Keep only the labels this module shows. A mask mapped to null (skull, brain, ribs) would
    # otherwise stretch the crop and the slice range: the first neck build spent 8 of 48 axial
    # slices on the brain with no pin on them.
    from labels import load_mapping
    mapping = load_mapping(a.labels or a.prefix + "-axial")
    shown = [int(v) for v, stem in mapping["model_values"].items() if mapping["model_labels"].get(stem)]
    sg = np.where(np.isin(sg, shown), sg, 0).astype(np.uint16)
    vol, seg = canonical(ct, perm, flip), canonical(sg, perm, flip)
    del ct, sg
    aff = np.diag(list(SPACING) + [1.0])

    def save(v, g, name):
        nib.save(nib.Nifti1Image(v.astype(np.int16), aff), os.path.join(gdir, name + ".nii.gz"))
        nib.save(nib.Nifti1Image(g.astype(np.uint16), aff), os.path.join(gdir, name + "_seg.nii.gz"))

    save(vol, seg, "vol")
    vc, gc, box_ax = crop_pair(vol, seg)
    save(vc, gc, "axial")
    vo, go, _sp = reformat(vc, gc, "coronal", SPACING)
    vo, go, box_co = crop_pair(vo, go)
    save(vo, go, "coronal")
    vs, gs, _sp = reformat(vc, gc, "sagittal", SPACING)
    vs, gs, box_sa = crop_pair(vs, gs)
    save(vs, gs, "sagittal")
    maps = {k: [[int(x) for x in r] for r in v] for k, v in module_maps(vol.shape, box_ax, box_co, box_sa).items()}
    meta = {"subject": a.subject, "group": a.group, "prefix": a.prefix, "shape": list(vol.shape),
            "perm": list(perm), "flip": [bool(f) for f in flip], "evidence": ev,
            "boxes": {"axial": list(map(int, box_ax)), "coronal": list(map(int, box_co)),
                      "sagittal": list(map(int, box_sa))},
            "M": maps}
    json.dump(meta, open(os.path.join(gdir, "group.json"), "w"), indent=1)
    print("  volumes: canonical %s, axial %s, coronal %s, sagittal %s -> %s"
          % (vol.shape, vc.shape, vo.shape, vs.shape, gdir))
    if not a.write:
        print("measured; nothing written to atlas/ (pass --write)")
        return 0

    from build import assemble, pins_from_segmentation, validate_with_viewer, upsert_module
    from slices import extract_slices
    reg = load_sources()
    cat_path = os.path.join(_REPO, "atlas", "modules.json")
    catalog = json.load(open(cat_path, encoding="utf-8"))
    credit = reg[SOURCE]["credit"]
    for plane in ("axial", "coronal", "sagittal"):
        mid = "%s-%s" % (a.prefix, plane)
        out_dir = os.path.join(_REPO, "atlas", mid)
        vpath, spath = os.path.join(gdir, plane + ".nii.gz"), os.path.join(gdir, plane + "_seg.nii.gz")
        stubs = extract_slices(vpath, out_dir, mid, a.slices, "soft-tissue", SOURCE, spath)
        zooms = nib.load(vpath).header.get_zooms()[:3]
        pins = pins_from_segmentation(spath, stubs, mapping, (zooms[1], zooms[0]))
        atlas = assemble({"id": mid, "source": SOURCE, "source_label": credit, "cleared_on": "2026-08-17"},
                         stubs, pins, mapping)
        atlas["provenance"]["subject"] = a.subject
        atlas["provenance"]["dataset"] = "TotalSegmentator dataset v2.0.1 (Zenodo record 10047292)"
        atlas["provenance"]["doi"] = "10.5281/zenodo.10047292"
        atlas["provenance"]["definitions"] = mapping.get("_definitions_short", atlas["provenance"]["definitions"])
        errs = validate_with_viewer(atlas, _REPO)
        if errs:
            raise SystemExit("%s: viewer schema errors %s" % (mid, errs[:5]))
        with open(os.path.join(out_dir, "atlas.json"), "w", encoding="utf-8") as fh:
            json.dump(atlas, fh, indent=1, ensure_ascii=False)
        row = {"id": mid, "title": a.title, "subtitle": plane.capitalize() + " - living patient",
               "region": mapping.get("_region", "Head and neck"), "modality": "CT", "slices": len(stubs),
               "thumb": "/atlas/%s/t/%03d.webp" % (mid, len(stubs) // 2 + 1), "credit": credit,
               "notice": mapping.get("_student_notice", "")}
        catalog = upsert_module(catalog, row)
        print("  wrote %-28s %d slices, %d pins, z %s..%s" % (mid, len(stubs), sum(len(v) for v in pins.values()),
                                                           stubs[0]["_z"], stubs[-1]["_z"]))
    if credit not in catalog["credits"]:
        catalog["credits"].append(credit)
    with open(cat_path, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, indent=1, ensure_ascii=False)
    print("NEXT: living.py --group %s --write (q, mm, windows), then pin_scan.py, orientation by hand" % a.group)
    return 0


if __name__ == "__main__":
    sys.exit(main())
