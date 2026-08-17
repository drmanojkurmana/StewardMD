#!/usr/bin/env python3
"""RadioAnatome pipeline self-check. Plain asserts, no framework.
Run: python3 atlas-pipeline/test_pipeline.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = [0]


def ok(name, cond):
    if cond:
        PASS[0] += 1
    else:
        print("x FAIL:", name)
        sys.exit(1)


# ---------- clearance gate ----------
from check_sources import load_sources, require_clear, SourceNotCleared

SRC = load_sources()
ok("register loads", isinstance(SRC, dict) and len(SRC) > 0)
ok("notes are not treated as sources", not any(k.startswith("_") for k in SRC))
ok("every row has a verdict", all("verdict" in v for v in SRC.values()))
ok("every row cites a licence", all(v.get("licence") for v in SRC.values()))
ok("every row records where it was verified", all(v.get("verified_from") for v in SRC.values()))
ok("every BLOCKED row names its blocking clause",
   all(v.get("blocking_clause") for v in SRC.values() if v["verdict"] == "BLOCKED"))

for sid in ["visible-human", "totalsegmentator-total", "fastsurfer-segonly",
            "grays-1918", "terminologia-anatomica-terms"]:
    ok("%s is present" % sid, sid in SRC)
    ok("%s is CLEAR" % sid, SRC[sid]["verdict"] == "CLEAR")

# The blocked ones stay recorded so nobody re-adds them by accident.
for sid in ["fsl", "jhu-icbm-dti-81", "freesurfer", "tcia", "fma", "uberon",
            "wikipedia", "mindboggle-101", "totalsegmentator-brain-structures", "radiopaedia"]:
    ok("%s is recorded" % sid, sid in SRC)
    ok("%s is BLOCKED" % sid, SRC[sid]["verdict"] == "BLOCKED")

ok("the credit line for the info screen is recorded",
   SRC["visible-human"].get("credit") == "Courtesy of the U.S. National Library of Medicine")

require_clear("visible-human", "totalsegmentator-total")  # must not raise
for bad, label in [("fsl", "a BLOCKED source"), ("no-such-source", "an unknown source")]:
    try:
        require_clear(bad)
        ok("require_clear rejects " + label, False)
    except SourceNotCleared:
        ok("require_clear rejects " + label, True)
try:
    require_clear("visible-human", "fsl")
    ok("require_clear rejects a mixed list", False)
except SourceNotCleared:
    ok("require_clear rejects a mixed list", True)
try:
    require_clear("fsl")
except SourceNotCleared as e:
    ok("the rejection explains WHY", "DEVELOPMENT PROCESS" in str(e))

# ---------- orientation invariant ----------
import numpy as np
from orient import to_display, physical_aspect, resize_to_square_pixels

# A marker must land at the SAME display coordinate via the image path and the mask
# path. A mirrored mask would put every pin on the contralateral structure and still
# look anatomically plausible — the worst kind of bug, because it survives review.
raw = np.zeros((40, 60), dtype=np.float32)
raw[7, 11] = 1.0
mask = np.zeros((40, 60), dtype=bool)
mask[7, 11] = True
di, dm = to_display(raw), to_display(mask)
ok("display shapes agree", di.shape == dm.shape)
ok("marker lands identically on both paths",
   tuple(np.argwhere(di > 0)[0]) == tuple(np.argwhere(dm)[0]))
ok("to_display preserves the pixel count", int(dm.sum()) == 1)
ok("to_display preserves dtype kind", to_display(mask).dtype == bool)

# Radiological convention: anterior up, patient-left on image right.
probe = np.zeros((4, 6), dtype=np.uint8)
probe[3, 0] = 1                       # max X (patient right), min Y (posterior)
d = to_display(probe)
ok("display is (rows=Y, cols=X)", d.shape == (6, 4))
r_, c_ = np.argwhere(d)[0]
ok("posterior maps to the bottom row", r_ == d.shape[0] - 1)
ok("patient right maps to the right column", c_ == d.shape[1] - 1)

ok("square voxels give the pixel aspect", abs(physical_aspect((100, 50), (1.0, 1.0)) - 0.5) < 1e-9)
ok("anisotropic voxels are corrected", abs(physical_aspect((100, 50), (2.0, 1.0)) - 0.25) < 1e-9)
ok("aspect is positive for degenerate spacing", physical_aspect((10, 10), (0, 0)) > 0)

sq = resize_to_square_pixels(np.zeros((100, 50), dtype=np.float32), (2.0, 1.0), 200)
ok("resize hits the target height", sq.shape[0] == 200)
ok("resize makes physical pixels square", sq.shape[1] == 50)
ok("resize of a mask stays boolean",
   resize_to_square_pixels(np.ones((10, 10), dtype=bool), (1.0, 1.0), 20).dtype == bool)
ok("resize does not invent labels",
   set(np.unique(resize_to_square_pixels(mask, (1.0, 1.0), 80))) <= {False, True})

# ---------- pin derivation ----------
from pins import inside_point, pins_for_mask, to_percent

ok("empty mask yields no point", inside_point(np.zeros((20, 20), bool)) is None)

solid = np.zeros((21, 21), bool)
solid[5:16, 5:16] = True
r_, c_ = inside_point(solid)
ok("solid block point is inside", bool(solid[r_, c_]))
ok("solid block point is near the centre", abs(r_ - 10) <= 1 and abs(c_ - 10) <= 1)

# THE case a centroid gets wrong: a C shape whose centre of mass is in the gap.
C = np.zeros((31, 31), bool)
C[5:26, 5:11] = True      # spine
C[5:11, 5:26] = True      # top arm
C[20:26, 5:26] = True     # bottom arm
cy, cx = np.argwhere(C).mean(axis=0)
ok("this C-shape really does have an outside centroid",
   not bool(C[int(round(cy)), int(round(cx))]))
r_, c_ = inside_point(C)
ok("inside_point stays inside a C shape", bool(C[r_, c_]))

ring = np.zeros((41, 41), bool)
yy, xx = np.mgrid[0:41, 0:41]
d2 = (yy - 20) ** 2 + (xx - 20) ** 2
ring[(d2 <= 18 ** 2) & (d2 >= 12 ** 2)] = True
ok("annulus centroid is in the hole", not bool(ring[20, 20]))
r_, c_ = inside_point(ring)
ok("inside_point stays inside an annulus", bool(ring[r_, c_]))

# One pin per component: this is how bilateral structures get two pins.
two = np.zeros((30, 60), bool)
two[10:20, 5:15] = True
two[10:20, 45:55] = True
pts = pins_for_mask(two, min_area_px=20)
ok("two blobs yield two pins", len(pts) == 2)
ok("both pins are inside their blob", all(bool(two[p[0], p[1]]) for p in pts))
ok("pins are ordered left to right", pts[0][1] < pts[1][1])

noisy = np.zeros((30, 60), bool)
noisy[10:20, 5:15] = True
noisy[0, 59] = True
ok("sub-threshold components are dropped", len(pins_for_mask(noisy, min_area_px=20)) == 1)
ok("min_area of 1 keeps the sliver", len(pins_for_mask(noisy, min_area_px=1)) == 2)
ok("empty mask yields no pins", pins_for_mask(np.zeros((10, 10), bool), 1) == [])
ok("diagonal touching counts as one component",
   len(pins_for_mask(np.array([[1, 0], [0, 1]], dtype=bool), 1)) == 1)

x, y = to_percent(0, 0, (101, 101))
ok("origin maps to 0,0", x == 0.0 and y == 0.0)
x, y = to_percent(100, 100, (101, 101))
ok("far corner maps to 100,100", x == 100.0 and y == 100.0)
x, y = to_percent(50, 25, (101, 101))
ok("x comes from the column", x == 25.0)
ok("y comes from the row", y == 50.0)
ok("percentages carry one decimal", to_percent(1, 1, (3, 3)) == (50.0, 50.0))
ok("single-pixel axis does not divide by zero", to_percent(0, 0, (1, 1)) == (0.0, 0.0))
ok("percentages never leave 0..100",
   all(0.0 <= v <= 100.0 for v in to_percent(999, 999, (10, 10))))

# ---------- slice extraction ----------
from slices import apply_window, pick_slice_indices, WINDOWS

hu = np.array([-1000, -100, 0, 40, 80, 1000], dtype=np.float32)
w = apply_window(hu, center=40, width=80)          # brain window: 0..80 HU
ok("window clamps below the floor", w[0] == 0.0 and w[1] == 0.0)
ok("window maps the centre to mid-grey", abs(float(w[3]) - 0.5) < 1e-6)
ok("window clamps above the ceiling", w[5] == 1.0)
ok("window output stays in 0..1", w.min() >= 0.0 and w.max() <= 1.0)
ok("zero width does not divide by zero", bool(np.isfinite(apply_window(hu, 40, 0)).all()))
ok("the conventional windows are present",
   all(k in WINDOWS for k in ["brain", "soft-tissue", "lung", "bone", "mediastinum"]))

idx = pick_slice_indices(200, 24)
ok("picks the requested count", len(idx) == 24)
ok("starts at the first slice", idx[0] == 0)
ok("ends at the last slice", idx[-1] == 199)
ok("indices ascend strictly", all(b > a for a, b in zip(idx, idx[1:])))
ok("fewer available than wanted degrades", pick_slice_indices(5, 24) == [0, 1, 2, 3, 4])
ok("single slice is safe", pick_slice_indices(1, 24) == [0])
ok("zero available yields nothing", pick_slice_indices(0, 24) == [])

# ---------- label mapping ----------
import re
from labels import load_mapping, structure_for_label, structures_block, categories_block

M = load_mapping("brain-mri-axial-t1")
cats, strs = categories_block(M), structures_block(M)
ok("mapping loads", isinstance(M, dict))
ok("mapping declares categories", len(cats) > 0)
ok("mapping declares structures", len(strs) > 0)
ok("every structure has a name", all(s.get("name") for s in strs.values()))
ok("every structure category resolves", all(s.get("category") in cats for s in strs.values()))
ok("every parent resolves", all(s["parent"] in strs for s in strs.values() if s.get("parent")))
ok("every category has a colour", all(str(c.get("color", "")).startswith("#") for c in cats.values()))
ok("every category has a label", all(c.get("label") for c in cats.values()))
ok("structure ids are kebab-case", all(re.match(r"^[a-z0-9-]+$", k) for k in strs))

ok("a known model label maps", structure_for_label(M, "Left-Thalamus") is not None)
ok("mapped targets exist as structures", structure_for_label(M, "Left-Thalamus") in strs)
ok("left and right collapse to ONE structure (bilateral pins, one entry)",
   structure_for_label(M, "Left-Thalamus") == structure_for_label(M, "Right-Thalamus"))
ok("an unmapped label is skipped", structure_for_label(M, "Some-Label-We-Do-Not-Show") is None)
ok("an explicitly nulled label is skipped", structure_for_label(M, "Unknown") is None)
ok("white matter structures are marked hand-authored",
   any(s.get("hand_authored") for s in strs.values()))
ok("every hand-authored structure is white matter",
   all(s.get("category") == "white-matter" for s in strs.values() if s.get("hand_authored")))
ok("mapping cites no blocked source",
   not re.search(r"(?i)freesurfer licen|fsl licen|jhu|mindboggle", json.dumps(M)))

# ---------- assembly and cross-language validation ----------
from build import assemble, validate_with_viewer, upsert_module

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = {"id": "brain-mri-axial-t1", "title": "Brain - MRI", "subtitle": "Axial - T1",
        "region": "Brain", "modality": "MRI", "source": "visible-human",
        "source_label": "Courtesy of the U.S. National Library of Medicine",
        "cleared_on": "2026-08-17"}
STUBS = [{"i": 1, "img": "/atlas/brain-mri-axial-t1/001.webp", "aspect": 0.9, "_z": 0, "_shape": (900, 810)},
         {"i": 2, "img": "/atlas/brain-mri-axial-t1/002.webp", "aspect": 0.9, "_z": 5, "_shape": (900, 810)}]
PINS = {1: [{"s": "thalamus", "x": 45.0, "y": 52.0}, {"s": "thalamus", "x": 55.0, "y": 52.0}],
        2: [{"s": "putamen", "x": 40.0, "y": 48.0}]}

A_ = assemble(META, STUBS, PINS, M)
ok("assemble sets the id", A_["id"] == "brain-mri-axial-t1")
ok("assemble emits every slice", len(A_["slices"]) == 2)
ok("assemble strips private keys", all(not any(k.startswith("_") for k in s) for s in A_["slices"]))
ok("assemble carries pins through", len(A_["slices"][0]["pins"]) == 2)
ok("assemble keeps bilateral duplicates",
   A_["slices"][0]["pins"][0]["s"] == A_["slices"][0]["pins"][1]["s"])
ok("assemble records provenance", isinstance(A_.get("provenance"), dict))
ok("assemble prunes unpinned structures", "cuneus" not in A_["structures"])
ok("assemble keeps pinned structures", "thalamus" in A_["structures"] and "putamen" in A_["structures"])
ok("assemble keeps hierarchy ancestors", "telencephalon" in A_["structures"])
ok("assemble drops hand_authored bookkeeping",
   all("hand_authored" not in s for s in A_["structures"].values()))
ok("assemble keeps only the categories in use", set(A_["categories"]) == {"grey-matter"})

# THE important one: the schema is defined ONCE, in atlas.js.
errs = validate_with_viewer(A_, REPO)
if errs:
    print("   validator said:", errs[:3])
ok("assembled atlas passes the VIEWER's validator", errs == [])
bad = json.loads(json.dumps(A_)); bad["slices"][0]["pins"][0]["s"] = "no-such-structure"
ok("viewer validator catches a dangling pin", validate_with_viewer(bad, REPO) != [])
bad2 = json.loads(json.dumps(A_)); bad2["slices"][1]["i"] = 9
ok("viewer validator catches a bad slice index", validate_with_viewer(bad2, REPO) != [])
bad3 = json.loads(json.dumps(A_)); bad3["slices"][0]["pins"][0]["x"] = 150
ok("viewer validator catches an out-of-range coordinate", validate_with_viewer(bad3, REPO) != [])

cat = upsert_module({"version": 1, "credits": [], "modules": []},
                    dict(META, slices=2, thumb="/atlas/x/t/001.webp"))
ok("upsert adds a new module", len(cat["modules"]) == 1)
ok("upsert keeps only schema keys", "source_label" not in cat["modules"][0])
cat = upsert_module(cat, dict(META, slices=7, thumb="/atlas/x/t/001.webp"))
ok("upsert replaces rather than duplicates", len(cat["modules"]) == 1 and cat["modules"][0]["slices"] == 7)
cat["credits"] = ["keep me"]
ok("upsert preserves credits", upsert_module(cat, dict(META, slices=7, thumb="/t.webp"))["credits"] == ["keep me"])

# ---------- end-to-end: synthetic volume -> webp -> pins -> validated atlas.json ----------
# Proves the whole chain without fabricating anatomy: the geometry here is deliberately
# obvious test shapes (two bilateral blobs + one C shape), written to a temp dir and
# never added to the shipped catalog. What it verifies is the PLUMBING and, critically,
# that the image and mask paths agree on orientation.
import tempfile
import nibabel as nib
from slices import extract_slices, DISPLAY_H
from build import pins_from_segmentation

with tempfile.TemporaryDirectory() as tmp:
    NX, NY, NZ = 60, 80, 6
    vol = np.zeros((NX, NY, NZ), dtype=np.float32)
    seg = np.zeros((NX, NY, NZ), dtype=np.int16)

    # label 10: two blobs, left and right of midline  -> must yield TWO pins
    # label 20: a single C shape whose centroid is outside itself -> ONE inside pin
    for z in range(NZ):
        vol[10:22, 30:45, z] = 800.0
        seg[10:22, 30:45, z] = 10
        vol[38:50, 30:45, z] = 800.0
        seg[38:50, 30:45, z] = 10
        vol[25:35, 10:16, z] = 500.0; seg[25:35, 10:16, z] = 20        # spine
        vol[25:29, 10:26, z] = 500.0; seg[25:29, 10:26, z] = 20        # top arm
        vol[31:35, 10:26, z] = 500.0; seg[31:35, 10:26, z] = 20        # bottom arm

    aff = np.diag([0.5, 0.5, 3.0, 1.0])        # deliberately ANISOTROPIC voxels
    nib.save(nib.Nifti1Image(vol, aff), os.path.join(tmp, "vol.nii.gz"))
    nib.save(nib.Nifti1Image(seg, aff), os.path.join(tmp, "seg.nii.gz"))

    MAP = {
        "_geometry": "synthetic self-test",
        "categories": {"grey-matter": {"label": "Grey matter", "color": "#7ee081"},
                       "white-matter": {"label": "White matter", "color": "#ffffff"}},
        "structures": {"thalamus": {"name": "Thalamus", "category": "grey-matter", "parent": "telencephalon"},
                       "telencephalon": {"name": "Telencephalon", "category": "grey-matter"},
                       "fornix": {"name": "Fornix", "category": "white-matter"}},
        "model_labels": {"blob": "thalamus", "cshape": "fornix"},
        "model_values": {"10": "blob", "20": "cshape"},
    }

    out_dir = os.path.join(tmp, "out")
    stubs = extract_slices(os.path.join(tmp, "vol.nii.gz"), out_dir, "selftest", 4, None, "visible-human")
    ok("e2e: wrote the requested number of slices", len(stubs) == 4)
    ok("e2e: every webp exists", all(os.path.exists(os.path.join(out_dir, "%03d.webp" % s["i"])) for s in stubs))
    ok("e2e: every thumbnail exists", all(os.path.exists(os.path.join(out_dir, "t", "%03d.webp" % s["i"])) for s in stubs))
    ok("e2e: slice indices are 1-based and contiguous", [s["i"] for s in stubs] == [1, 2, 3, 4])
    ok("e2e: img paths are absolute /atlas/ urls", all(s["img"].startswith("/atlas/selftest/") for s in stubs))
    ok("e2e: aspect is positive", all(s["aspect"] > 0 for s in stubs))
    # anisotropic 0.5 x 0.5 in-plane is isotropic, so display aspect = 60/80 = 0.75
    ok("e2e: aspect reflects PHYSICAL extent, not voxel counts", abs(stubs[0]["aspect"] - 0.75) < 0.02)

    zooms = nib.load(os.path.join(tmp, "vol.nii.gz")).header.get_zooms()[:3]
    pins = pins_from_segmentation(os.path.join(tmp, "seg.nii.gz"), stubs, MAP, (zooms[1], zooms[0]))
    ok("e2e: pins produced for every slice", set(pins) == {1, 2, 3, 4})
    p1 = pins[1]
    ok("e2e: the bilateral label yields TWO pins", len([p for p in p1 if p["s"] == "thalamus"]) == 2)
    ok("e2e: the C shape yields ONE pin", len([p for p in p1 if p["s"] == "fornix"]) == 1)
    ok("e2e: every pin is in range", all(0 <= p["x"] <= 100 and 0 <= p["y"] <= 100 for p in p1))
    tha = sorted([p for p in p1 if p["s"] == "thalamus"], key=lambda p: p["x"])
    ok("e2e: bilateral pins sit either side of the midline", tha[0]["x"] < 50 < tha[1]["x"])

    # Orientation invariant, end to end: the blob is at Y=30..45 of 80 (posterior half),
    # so after to_display (anterior up) it must appear in the LOWER half of the image.
    ok("e2e: posterior structure renders in the lower half", all(p["y"] > 40 for p in tha))

    META2 = {"id": "selftest", "title": "Self test", "subtitle": "", "region": "Test",
             "modality": "MRI", "source": "visible-human",
             "source_label": "Courtesy of the U.S. National Library of Medicine",
             "cleared_on": "2026-08-17"}
    atlas = assemble(META2, stubs, pins, MAP)
    errs = validate_with_viewer(atlas, REPO)
    if errs:
        print("   e2e validator said:", errs[:3])
    ok("e2e: the assembled atlas passes the VIEWER's validator", errs == [])
    ok("e2e: unpinned structures pruned but ancestors kept",
       "telencephalon" in atlas["structures"] and set(atlas["structures"]) == {"thalamus", "telencephalon", "fornix"})
    ok("e2e: provenance carries the credit line, not internal notes",
       atlas["provenance"]["images"] == "Courtesy of the U.S. National Library of Medicine")

print("ALL %d PASS" % PASS[0])
