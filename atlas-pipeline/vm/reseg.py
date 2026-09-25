#!/usr/bin/env python3
"""Re-segment the six older Visible Human CT regions and rebuild their 18 modules (VM job).

Per region: rebuild the image volume exactly as the original was built, segment it with the
ORIGINAL segmenter (classical script, or TotalSegmentator where the original used it), then per
module:
  1. at the ORIGINAL picks: re-render every shipped image (match level bytes / pixels / near, see
     recipe.match_mad) and compare every pin with the pre-audit 5d651f5a5 atlas.json
     (identical / within 1 px / changed / missing / extra);
  2. write a 48-slice stack to <out>/atlas/<id>/v2/ (images, thumbs) and <out>/atlas/<id>/atlas.json,
     through the pipeline's own extract_slices -> pins_from_segmentation -> assemble;
  3. run pin_scan over the v2 stacks into <out>/pinscan/ for the human audit.
report.json and versions.json are rewritten after every step, so a crash still leaves a record.

Layout (bundle.sh builds it):  <bundle>/atlas-pipeline/...   pipeline code, labels, vm/
                               <bundle>/current/atlas/<id>/atlas.json   the committed modules
                               <bundle>/ref5d/atlas/<id>/              5d651f5a5 atlas.json + images
                               <bundle>/atlas.js                       viewer (schema check, if node)
Usage:  python reseg.py --bundle B --raw RAW --out OUT [--scratch DIR] [--ts-bin PATH --ts-python PATH]
                        [--device gpu|cpu] [--module id ...] [--no-ts]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import recipe  # noqa: E402  (puts atlas-pipeline on sys.path)
from recipe import MODULES, region_of, crop_reformat, render, match_level, worst  # noqa: E402

N_V2 = 48
SOURCE = "visible-human"
LABELS = {"ct-head": "head", "ct-thorax": "thorax", "ct-knee": "knee", "ct-abdomen": "abdomen",
          "ct-pelvis": "pelvis", "ct-wholebody": "wholebody"}
# The original invocations. abdomen: recovered verbatim from session transcript 0eeb624a
# (2026-08-18T14:49Z); pelvis and whole body: NOT recovered, see README "Provenance".
ABD_ROI = ("liver spleen kidney_left kidney_right pancreas gallbladder stomach duodenum small_bowel colon "
           "urinary_bladder aorta inferior_vena_cava adrenal_gland_left adrenal_gland_right vertebrae_L1 "
           "vertebrae_L2 vertebrae_L3 vertebrae_L4 vertebrae_L5 sacrum iliopsoas_left iliopsoas_right "
           "autochthon_left autochthon_right").split()
TS_ARGS = {"abdomen": ["--ml", "--fast", "--roi_subset"] + ABD_ROI,
           "pelvis": ["--ml"],
           "wb": ["--ml"]}
TS_TIMEOUT = {"abdomen": 3600, "pelvis": 3600, "wb": 4 * 3600}


class Run:
    def __init__(self, out):
        self.out = out
        self.report = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "regions": {}, "modules": {}}
        self.versions = {}

    def save(self):
        for name, obj in (("report.json", self.report), ("versions.json", self.versions)):
            tmp = os.path.join(self.out, name + ".tmp")
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(obj, fh, indent=1)
            os.replace(tmp, os.path.join(self.out, name))


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def nii_save(arr, sp, path):
    import nibabel as nib
    nib.save(nib.Nifti1Image(arr, np.diag(list(sp) + [1.0])), path)


def nii_load(path, dtype):
    import nibabel as nib
    return np.asanyarray(nib.load(path).dataobj).astype(dtype)


def pipeline_versions():
    import PIL
    import PIL.features
    import nibabel
    import scipy
    return {"python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__,
            "nibabel": nibabel.__version__, "pillow": PIL.__version__, "libwebp": PIL.features.version("webp")}


TS_PROBE = r"""
import json, importlib.metadata as md
out = {}
for p in ("TotalSegmentator", "nnunetv2", "torch"):
    try: out[p] = md.version(p)
    except Exception as e: out[p] = "absent (%s)" % e
try:
    import torch
    out["torch_cuda_build"] = torch.version.cuda
    out["cuda_available"] = torch.cuda.is_available()
    out["gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    out["cudnn"] = torch.backends.cudnn.version() if torch.cuda.is_available() else None
except Exception as e:
    out["torch_error"] = str(e)
from totalsegmentator.map_to_binary import class_map
out["class_map_total"] = {str(k): v for k, v in class_map["total"].items()}
print(json.dumps(out))
"""


def ts_probe(ts_python):
    r = subprocess.run([ts_python, "-c", TS_PROBE], capture_output=True, text=True, check=True)
    return json.loads(r.stdout.strip().splitlines()[-1])


def build_region(raw, how, segmenter, a, run):
    """(volume, segmentation, source) for one raw folder, plus a copy of the mask in <out>/seg/."""
    rdir = os.path.join(a.raw, raw)
    scratch = os.path.join(a.scratch, raw)
    os.makedirs(scratch, exist_ok=True)
    os.makedirs(os.path.join(a.out, "seg"), exist_ok=True)
    info = run.report["regions"].setdefault(raw, {"segmenter": segmenter})
    t0 = time.time()
    v, g = os.path.join(scratch, "vol.nii.gz"), os.path.join(scratch, "seg.nii.gz")
    if segmenter.endswith(".py"):
        cmd = [sys.executable, os.path.join(recipe._PIPE, segmenter), "--raw-dir", rdir, "--out-vol", v, "--out-seg", g]
        info["command"] = " ".join(cmd[1:])
        log("segment", raw, "with", segmenter)
        subprocess.run(cmd, check=True)
        vol, seg, source = nii_load(v, np.int16), nii_load(g, np.uint16), "script"
    else:
        if a.no_ts:
            info["skipped"] = "TotalSegmentator not run (--no-ts or unusable, see versions.json)"
            run.save()
            return None
        from vhp_volume import stack, SPACING      # the original's own stacking code
        vol, files = stack(rdir)
        info["slices"] = len(files)
        nii_save(vol, SPACING, v)
        cmd = [a.ts_bin, "-i", v, "-o", g] + TS_ARGS[raw] + ["--device", a.device]
        info["command"] = " ".join(["TotalSegmentator"] + cmd[1:])
        log("TotalSegmentator", raw, " ".join(cmd[1:]))
        run.save()
        subprocess.run(cmd, check=True, timeout=TS_TIMEOUT[raw])
        seg, source = nii_load(g, np.uint16), "stack"
        if seg.shape != vol.shape:
            raise SystemExit("%s: TotalSegmentator mask %s != volume %s" % (raw, seg.shape, vol.shape))
    shutil.copyfile(g, os.path.join(a.out, "seg", raw + "_seg.nii.gz"))
    vals, counts = np.unique(seg, return_counts=True)
    info["voxels_per_value"] = {str(int(k)): int(c) for k, c in zip(vals, counts) if k}
    info["seconds"] = round(time.time() - t0, 1)
    run.save()
    return vol, seg, source


def mapping_for(mid, class_map, run):
    """The region's label file. For TotalSegmentator regions its model_values are re-derived BY NAME
    from the installed version's class map (only the names the original mapping listed, so the
    comparison is like for like); any id that moved is recorded."""
    from labels import load_mapping
    m = load_mapping("ct-%s-axial" % LABELS[mid.rsplit("-", 1)[0]])
    if region_of(mid)[2] != "totalsegmentator" or not class_map:
        return m
    by_name = {v: k for k, v in class_map.items()}
    old = m.get("model_values") or {}
    new = {by_name[n]: n for n in old.values() if n in by_name}
    moved = {n: [k, by_name.get(n)] for k, n in old.items() if by_name.get(n) != k}
    if moved:
        run.report["modules"][mid]["model_value_changes"] = moved
    m = dict(m)
    m["model_values"] = new
    return m


def compare_pins(old_slices, new_by_i, sizes):
    """Pair each old pin with a new pin of the same structure on the same slice (greedy, nearest
    first) and grade the pair by its distance in display pixels."""
    stats = {"identical": 0, "within_1px": 0, "changed": 0, "missing": 0, "extra": 0}
    changes = []
    for k, s in enumerate(old_slices):
        H, W = sizes[k]
        old = s["pins"]
        new = new_by_i.get(k + 1, [])

        def px(p, q):
            return float(np.hypot((p["x"] - q["x"]) / 100.0 * (W - 1), (p["y"] - q["y"]) / 100.0 * (H - 1)))
        pairs = sorted((px(p, q), i, j) for i, p in enumerate(old) for j, q in enumerate(new) if p["s"] == q["s"])
        used_o, used_n = set(), set()
        for d, i, j in pairs:
            if i in used_o or j in used_n:
                continue
            used_o.add(i)
            used_n.add(j)
            grade = "identical" if d == 0 else "within_1px" if d <= 1.0 else "changed"
            stats[grade] += 1
            if grade == "changed":
                changes.append({"i": k + 1, "s": old[i]["s"], "old": [old[i]["x"], old[i]["y"]],
                                "new": [new[j]["x"], new[j]["y"]], "px": round(d, 1)})
        for i, p in enumerate(old):
            if i not in used_o:
                stats["missing"] += 1
                changes.append({"i": k + 1, "s": p["s"], "old": [p["x"], p["y"]], "new": None})
        for j, q in enumerate(new):
            if j not in used_n:
                stats["extra"] += 1
                changes.append({"i": k + 1, "s": q["s"], "old": None, "new": [q["x"], q["y"]]})
    return stats, changes


def build_module(mid, rec, vol, seg, class_map, a, run):
    from build import assemble, pins_from_segmentation, validate_with_viewer
    from slices import extract_slices
    rep = run.report["modules"].setdefault(mid, {})
    rep.update({"recipe": {k: rec[k] for k in ("source", "crop0", "crop1", "window", "picks") if k in rec}})
    mapping = mapping_for(mid, class_map, run)
    V, sp = crop_reformat(vol, rec)
    G, _ = crop_reformat(seg, rec)
    V, G = np.ascontiguousarray(V), np.ascontiguousarray(G)
    if list(V.shape) != list(rec.get("shape", V.shape)):
        rep["error"] = "volume shape %s != recipe shape %s" % (list(V.shape), rec["shape"])
        run.save()
        return
    work = os.path.join(a.scratch, "m-" + mid)
    os.makedirs(work, exist_ok=True)
    vpath, gpath = os.path.join(work, "vol.nii.gz"), os.path.join(work, "seg.nii.gz")
    nii_save(V, sp, vpath)
    nii_save(G, sp, gpath)
    spd = (sp[1], sp[0])

    # 1. the original picks: images and pins against 5d651f5a5
    ref = json.load(open(os.path.join(a.bundle, "ref5d", "atlas", mid, "atlas.json"), encoding="utf-8"))
    levels, sizes = [], []
    for z, s in zip(rec["picks"], ref["slices"]):
        u8 = render(V, sp, z, rec["window"])
        sizes.append(u8.shape)
        levels.append(match_level(u8, os.path.join(a.bundle, "ref5d", s["img"].lstrip("/"))))
    rep["images_at_original_picks"] = {"n": len(levels), "level": worst(levels),
                                       "counts": {str(k): levels.count(k) for k in set(levels)}}
    stubs = [{"i": k + 1, "_z": int(z)} for k, z in enumerate(rec["picks"])]
    new = pins_from_segmentation(gpath, stubs, mapping, spd)
    stats, changes = compare_pins(ref["slices"], new, sizes)
    rep["pins_vs_5d651f5a5"] = dict(stats, old_total=sum(len(s["pins"]) for s in ref["slices"]),
                                    new_total=sum(len(p) for p in new.values()))
    rep["pin_differences"] = changes
    log("%-22s images %s | pins %s" % (mid, rep["images_at_original_picks"]["counts"], stats))
    run.save()

    # 2. the 48-slice v2 stack, the pipeline's own path (as living.assemble_stack)
    out_dir = os.path.join(a.out, "atlas", mid, "v2")
    stubs48 = extract_slices(vpath, out_dir, mid + "/v2", N_V2, rec["window"], SOURCE, gpath)
    pins48 = pins_from_segmentation(gpath, stubs48, mapping, spd)
    fresh = assemble({"id": mid}, stubs48, pins48, mapping)
    cur = json.load(open(os.path.join(a.bundle, "current", "atlas", mid, "atlas.json"), encoding="utf-8"))
    structures, cats = dict(cur["structures"]), dict(cur["categories"])
    for k, v in fresh["structures"].items():
        structures.setdefault(k, v)
    for k, v in fresh["categories"].items():
        cats.setdefault(k, v)
    atlas = {"id": mid, "provenance": cur["provenance"], "categories": cats, "structures": structures,
             "slices": fresh["slices"]}
    if shutil.which("node") and os.path.exists(os.path.join(a.bundle, "atlas.js")):
        rep["viewer_schema_errors"] = validate_with_viewer(atlas, a.bundle)[:10]
    else:
        rep["viewer_schema_errors"] = "not checked (no node on this machine)"
    with open(os.path.join(a.out, "atlas", mid, "atlas.json"), "w", encoding="utf-8") as fh:
        json.dump(atlas, fh, indent=1, ensure_ascii=False)
    rep["v2"] = {"slices": len(stubs48), "picks": [s["_z"] for s in stubs48],
                 "pins": sum(len(p) for p in pins48.values()),
                 "frames_without_pins": [s["i"] for s in stubs48 if not pins48.get(s["i"])]}
    log("%-22s v2 %d slices, %d pins, %d frames without pins" % (
        mid, rep["v2"]["slices"], rep["v2"]["pins"], len(rep["v2"]["frames_without_pins"])))
    shutil.rmtree(work, ignore_errors=True)
    run.save()


def pin_scan_all(mids, a, run):
    import pin_scan
    pin_scan._REPO = a.out
    out = os.path.join(a.out, "pinscan")
    os.makedirs(out, exist_ok=True)
    flags = [f for mid in mids for f in pin_scan.scan(mid)]
    for n, f in enumerate(flags, 1):
        f["png"] = os.path.relpath(pin_scan.render(f, out, n), a.out)
    json.dump(flags, open(os.path.join(out, "flags.json"), "w"), indent=1)
    run.report["pin_scan"] = {"flags": len(flags), "by_module": {m: sum(f["m"] == m for f in flags) for m in mids}}
    run.save()
    log("pin_scan: %d flags" % len(flags))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--raw", required=True, help="dir holding the raw folders (head, chest, knee2, abdomen, pelvis, wb)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scratch", default=None)
    ap.add_argument("--ts-bin", default="TotalSegmentator")
    ap.add_argument("--ts-python", default=None)
    ap.add_argument("--device", default="gpu")
    ap.add_argument("--module", nargs="*")
    ap.add_argument("--no-ts", action="store_true", help="skip TotalSegmentator regions (Mac dry run)")
    a = ap.parse_args()
    a.scratch = a.scratch or a.out.rstrip("/") + "_scratch"
    os.makedirs(a.out, exist_ok=True)
    run = Run(a.out)
    run.versions["pipeline"] = pipeline_versions()
    class_map = None
    if not a.no_ts:
        try:
            probe = ts_probe(a.ts_python or sys.executable)
            class_map = probe.pop("class_map_total")
            run.versions["totalsegmentator"] = probe
        except Exception as e:                  # classical regions still build
            run.versions["totalsegmentator"] = {"error": repr(e)}
            a.no_ts = True
            log("TotalSegmentator unusable, TS regions skipped:", repr(e))
    run.save()

    mids = a.module or MODULES
    recipes = json.load(open(os.path.join(_HERE, "recipes.json"), encoding="utf-8"))
    by_raw = {}
    for mid in mids:
        by_raw.setdefault(region_of(mid)[0], []).append(mid)
    order = [r for r in ("head", "chest", "knee2", "abdomen", "pelvis", "wb") if r in by_raw]
    built = []
    for raw in order:
        _r, how, segmenter = region_of(by_raw[raw][0])
        try:
            got = build_region(raw, how, segmenter, a, run)
        except Exception as e:                  # one region failing must not cost the others
            run.report["regions"].setdefault(raw, {})["error"] = repr(e)
            run.save()
            log("REGION FAILED", raw, repr(e))
            continue
        if got is None:
            continue
        vol, seg, source = got
        missing = [m for m in by_raw[raw] if m not in recipes]
        if missing:                             # TotalSegmentator regions: recover crop + picks now
            log("discover", missing)
            found = recipe.discover(a.raw, os.path.join(a.bundle, "ref5d"), missing, given={raw: (vol, seg, source)})
            recipes.update(found)
            with open(os.path.join(a.out, "recipes_vm.json"), "w", encoding="utf-8") as fh:
                json.dump({k: v for k, v in recipes.items() if k in found}, fh, indent=1)
            for m in missing:
                run.report["modules"].setdefault(m, {})["recipe_discovered"] = m in found
        for mid in by_raw[raw]:
            run.report["modules"].setdefault(mid, {})
            rec = recipes.get(mid)
            if not rec:
                run.report["modules"][mid]["error"] = "no recipe reproduces the shipped images"
                run.save()
                continue
            if rec.get("crop0") and rec["source"] == "script":
                from vhp_volume import crop_pair
                box = [int(x) for x in crop_pair(vol, seg)[2]]
                run.report["modules"][mid]["crop0_is_crop_pair"] = box == rec["crop0"]
            try:
                build_module(mid, rec, vol, seg, class_map, a, run)
                built.append(mid)
            except Exception as e:
                run.report["modules"][mid]["error"] = repr(e)
                run.save()
                log("MODULE FAILED", mid, repr(e))
        del vol, seg, got
    if built:
        pin_scan_all(built, a, run)
    shutil.rmtree(a.scratch, ignore_errors=True)
    run.report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    run.report["built"] = built
    run.save()
    log("done: %d of %d modules built" % (len(built), len(mids)))
    return 0 if len(built) == len(mids) else 1


if __name__ == "__main__":
    sys.exit(main())
