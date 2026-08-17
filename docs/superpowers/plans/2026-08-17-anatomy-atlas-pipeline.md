# Anatomy Atlas Content Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a public-domain anatomical volume into a validated `atlas/<id>/atlas.json` plus its `.webp` slice stack, deriving pin coordinates automatically where a cleared model exists and by hand where none does.

**Architecture:** Offline Python 3 in `atlas-pipeline/`, never shipped to users. A volume goes in as NIfTI; slices and label masks pass through **one shared orientation function** so pins cannot mis-register against images; per-slice connected components each yield one pin placed at the mask's distance-transform maximum (guaranteed inside the structure, unlike a centroid); label names are joined to curated Terminologia Anatomica terms and Gray's 1918 definitions; the assembled JSON is validated by **the viewer's own `validateAtlas`**, invoked through `node`, so the schema cannot drift between the two subsystems.

**Tech Stack:** Python 3 · numpy · scipy · nibabel · Pillow · TotalSegmentator (Apache-2.0) · FastSurfer `--seg_only` (Apache-2.0) · plain-`assert` self-check, no test framework.

**Spec:** `docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md`

**Sibling plan:** `docs/superpowers/plans/2026-08-17-anatomy-atlas-viewer.md` (build that first — it defines and exercises the schema)

## Global Constraints

- **The app's zero-dependency rule does not apply here.** This is dev-only tooling. Python deps live in `atlas-pipeline/requirements.txt` inside a venv. **Nothing in this plan may touch `package.json`, `atlas.js`, or any shipped file** — the pipeline's only outputs are `atlas/modules.json`, `atlas/<id>/atlas.json`, and `.webp` images.
- **Clearance gate.** No task after Task 1 may run against a source lacking a `CLEAR` row in `atlas-pipeline/sources.json`. `check_sources.py` enforces it and every entry point calls it first.
- **Attribution tier B+ (owner decision, spec §9).** Nothing names a source in the slice viewer or catalog. One credit line — `Courtesy of the U.S. National Library of Medicine` — belongs on the atlas info screen, fed from `provenance.images`. Third-party licence text goes in the app's existing Settings → Legal page.
- **Cleared sources only.** Base images: NLM Visible Human, or CC0/PD-filtered Wikimedia Commons. Geometry: TotalSegmentator `total`/`total_mr`, FastSurfer `--seg_only`, SynthSeg v1.0. Names: Terminologia Anatomica individual terms. Definitions: Gray's Anatomy 1918 **from an original scan** — not Project Gutenberg (trademark notice + 20% commercial royalty), not Wikisource wikitext (editor annotations are BY-SA).
- **Forbidden, permanently:** FSL and anything distributed with it (its terms reach the development process, not just shipped bits) · JHU ICBM-DTI-81 · FreeSurfer proper and the DK/DKT/Destrieux atlas *files* · Mindboggle-101 · TCIA · FMA · UBERON · Wikipedia prose · TotalSegmentator `brain_structures` and `brain_aneurysm`. **Atlas label *names* remain usable** — a nomenclature is not protectable; only the geometry files are barred.
- **Named white matter has no clean source and is hand-authored** (Task 7). Do not attempt to automate it.
- **Coordinates are percentages of the image box**, 0–100, floats, one decimal.
- **Schema authority is `atlas.js`.** Never re-implement `validateAtlas` in Python.
- **Self-check:** `python3 atlas-pipeline/test_pipeline.py`
- **Never commit a volume, a mask, or model weights.** Add them to `.gitignore` — the repo already blocks `models/*.onnx` and `*.sqlite` for the same reason, and `kb/dist/kb.index.json` at 26 MB once silently broke every production deploy.

---

## File Structure

**Created — all under `atlas-pipeline/` unless noted:**

| File | Responsibility |
|---|---|
| `requirements.txt` | numpy, scipy, nibabel, Pillow. Pinned. |
| `sources.json` | Machine-readable clearance register. The gate. |
| `check_sources.py` | Enforces the gate; refuses unknown or non-`CLEAR` sources. |
| `orient.py` | `to_display()` — the single orientation + aspect authority. |
| `slices.py` | Volume → `NNN.webp` + `t/NNN.webp` + per-slice `aspect`. |
| `pins.py` | Label masks → pin coordinates (components + inside-point). |
| `labels.py` | Model label → structure id, TA name, category, definition. |
| `labels/brain-mri-axial-t1.json` | Curated mapping for the first module. |
| `build.py` | Orchestrates; validates via `node` against `atlas.js`. |
| `atlas-author.html` | Local QA + hand-author tool (drag, reject, add pins). |
| `test_pipeline.py` | One plain-`assert` self-check for every pure function. |
| `README.md` | How to run it, and the licence rules that bind it. |

**Modified:**

| File | Change |
|---|---|
| `.gitignore` | Ignore `atlas-pipeline/work/`, `*.nii`, `*.nii.gz`, `atlas-pipeline/.venv/`. |

Why the orientation logic gets its own file: a mirrored or transposed mask is the single most likely defect in this pipeline, it is silent, and it would put every pin in the wrong place while still looking plausible. Isolating it in one function with one test is the cheapest possible insurance.

---

### Task 1: The clearance gate

Nothing else may run until this refuses to let an uncleared source through.

**Files:**
- Create: `atlas-pipeline/sources.json`, `atlas-pipeline/check_sources.py`, `atlas-pipeline/requirements.txt`, `atlas-pipeline/README.md`, `atlas-pipeline/test_pipeline.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `load_sources(path=None) -> dict` — the register keyed by source id.
  - `require_clear(*source_ids) -> None` — raises `SourceNotCleared` unless every id exists with `"verdict": "CLEAR"`. **Every entry point calls this before touching data.**
  - `SourceNotCleared(Exception)`

- [ ] **Step 1: Write the failing test**

Create `atlas-pipeline/test_pipeline.py`:

```python
#!/usr/bin/env python3
"""Anatomy Atlas pipeline self-check. Plain asserts, no framework.
Run: python3 atlas-pipeline/test_pipeline.py"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = [0]
def ok(name, cond):
    if cond: PASS[0] += 1
    else:
        print("x FAIL:", name); sys.exit(1)

# ---------- clearance gate ----------
from check_sources import load_sources, require_clear, SourceNotCleared

SRC = load_sources()
ok("register loads", isinstance(SRC, dict) and len(SRC) > 0)
ok("every row has a verdict", all("verdict" in v for v in SRC.values()))
ok("every row cites a licence", all(v.get("licence") for v in SRC.values()))
ok("every row records where it was verified", all(v.get("verified_from") for v in SRC.values()))

# The sources the pipeline actually depends on must be CLEAR.
for sid in ["visible-human", "totalsegmentator-total", "fastsurfer-segonly", "grays-1918", "terminologia-anatomica-terms"]:
    ok("%s is present" % sid, sid in SRC)
    ok("%s is CLEAR" % sid, SRC[sid]["verdict"] == "CLEAR")

# The blocked ones must be present AND blocked, so nobody re-adds them by accident.
for sid in ["fsl", "jhu-icbm-dti-81", "freesurfer", "tcia", "fma", "uberon", "wikipedia",
            "mindboggle-101", "totalsegmentator-brain-structures"]:
    ok("%s is recorded" % sid, sid in SRC)
    ok("%s is BLOCKED" % sid, SRC[sid]["verdict"] == "BLOCKED")

require_clear("visible-human", "totalsegmentator-total")   # must not raise
try:
    require_clear("fsl"); ok("require_clear rejects a BLOCKED source", False)
except SourceNotCleared: ok("require_clear rejects a BLOCKED source", True)
try:
    require_clear("no-such-source"); ok("require_clear rejects an unknown source", False)
except SourceNotCleared: ok("require_clear rejects an unknown source", True)
try:
    require_clear("visible-human", "fsl"); ok("require_clear rejects a mixed list", False)
except SourceNotCleared: ok("require_clear rejects a mixed list", True)

print("ALL %d PASS" % PASS[0])
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 atlas-pipeline/test_pipeline.py
```

Expected: `ModuleNotFoundError: No module named 'check_sources'`.

- [ ] **Step 3: Write the register**

`atlas-pipeline/sources.json` — the machine-readable form of spec §9.2. Verdicts reflect owner attribution tier B+:

```json
{
  "_note": "Clearance register. verdict must be CLEAR before any pipeline stage may use a source. See docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md section 9.",
  "_tier": "B+ : nothing named in the slice viewer or catalog; one credit line on the atlas info screen; third-party notices in Settings > Legal.",
  "visible-human": {
    "licence": "US Government work, no copyright; NLM download Terms and Conditions apply",
    "commercial": true, "attribution": "one credit line required",
    "credit": "Courtesy of the U.S. National Library of Medicine",
    "verified_from": "https://www.nlm.nih.gov/databases/download/terms_and_conditions.html",
    "verdict": "CLEAR"
  },
  "wikimedia-cc0": {
    "licence": "CC0 / Public Domain (hard-filtered)",
    "commercial": true, "attribution": "none",
    "note": "Only files whose extmetadata License is pd or cc0. Keep the extmetadata blob per file as an audit record; Commons tags are user-asserted.",
    "verified_from": "https://commons.wikimedia.org/wiki/Commons:Licensing",
    "verdict": "CLEAR"
  },
  "totalsegmentator-total": {
    "licence": "Apache-2.0 (code and total / total_mr weights)",
    "commercial": true, "attribution": "notice retention only",
    "note": "Run on our own PD images only. Never run on the CC BY 4.0 training dataset, so nothing shipped is an adaptation of it.",
    "verified_from": "https://github.com/wasserth/TotalSegmentator",
    "verdict": "CLEAR"
  },
  "fastsurfer-segonly": {
    "licence": "Apache-2.0",
    "commercial": true, "attribution": "notice retention only",
    "note": "--seg_only (asegdkt, cereb) needs NO FreeSurfer licence. The surface pipeline does; never invoke it.",
    "verified_from": "https://github.com/Deep-MI/FastSurfer",
    "verdict": "CLEAR"
  },
  "synthseg-v1": {
    "licence": "Apache-2.0 (v1.0 weights are in-repo)",
    "commercial": true, "attribution": "notice retention only",
    "note": "v1.0 only. The 2.0 / robust / parc weights come from a separate link with no licence statement: UNVERIFIED, do not use. Take from GitHub, not from a FreeSurfer bundle.",
    "verified_from": "https://github.com/BBillot/SynthSeg",
    "verdict": "CLEAR"
  },
  "grays-1918": {
    "licence": "Public domain in the US (published before 1931)",
    "commercial": true, "attribution": "none",
    "note": "Source from an ORIGINAL 1918 scan. Not Project Gutenberg (trademark notice + 20% commercial royalty). Not Wikisource wikitext (editor annotations are BY-SA). EU/UK status unclear until 2035 if W. H. Lewis is editor of record.",
    "verified_from": "https://en.wikisource.org/wiki/Anatomy_of_the_Human_Body",
    "verdict": "CLEAR"
  },
  "terminologia-anatomica-terms": {
    "licence": "Individual terms are explicitly public domain",
    "commercial": true, "attribution": "none",
    "note": "TERMS ONLY. The TA2 document is CC BY-ND: never redistribute the PDF or a wholesale copy of its hierarchy.",
    "verified_from": "https://libraries.dal.ca/Fipat/ta2.html",
    "verdict": "CLEAR"
  },
  "spl-nac-brain-atlas": {
    "licence": "3D Slicer License Part B",
    "commercial": true, "attribution": "notice retention only",
    "note": "300+ hand-labelled structures. Highest-quality single source. Part B 1(b) notice goes in Settings > Legal.",
    "verified_from": "https://github.com/Slicer/Slicer/blob/main/License.txt",
    "verdict": "CLEAR"
  },
  "fsl": {
    "licence": "FSL Licence", "commercial": false, "attribution": "n/a",
    "blocking_clause": "Non-commercial. Clauses (2)/(3) reach the DEVELOPMENT PROCESS: using FSL to generate coordinates for a commercial product is caught even if no FSL code ships.",
    "verified_from": "https://fsl.fmrib.ox.ac.uk/fsl/docs/license.html",
    "verdict": "BLOCKED"
  },
  "jhu-icbm-dti-81": {
    "licence": "FSL (as distributed)", "commercial": false, "attribution": "n/a",
    "blocking_clause": "Distributed under the FSL licence; independent non-FSL terms UNVERIFIED. This is why named white matter is hand-authored.",
    "verified_from": "http://neuro.debian.net/debian/extracts/fsldata/copyright",
    "verdict": "BLOCKED"
  },
  "freesurfer": {
    "licence": "FreeSurfer Software License v1.0", "commercial": true, "attribution": "required in user documentation",
    "blocking_clause": "Part B 1(b) forces MGH-prefaced licence text into user documentation. Also states clinical applications are neither recommended nor advised. Use fastsurfer-segonly instead.",
    "verified_from": "https://surfer.nmr.mgh.harvard.edu/fswiki/FreeSurferSoftwareLicense",
    "verdict": "BLOCKED"
  },
  "tcia": {
    "licence": "Per-collection CC BY 3.0/4.0, some NC", "commercial": true, "attribution": "required plus DOI citation",
    "blocking_clause": "No CC0 collection found. CC BY 4.0 s3(a) attribution plus mandatory DOI citation.",
    "verified_from": "https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/",
    "verdict": "BLOCKED"
  },
  "fma": {
    "licence": "CC BY 3.0 Unported", "commercial": true, "attribution": "required",
    "blocking_clause": "CC BY attribution. Licensor's own page is offline; version taken from OBO Foundry, so PARTIALLY UNVERIFIED.",
    "verified_from": "https://obofoundry.org/ontology/fma.html",
    "verdict": "BLOCKED"
  },
  "uberon": {
    "licence": "CC BY 3.0 Unported", "commercial": true, "attribution": "required",
    "blocking_clause": "CC BY attribution. LICENSE file is unambiguous even though GitHub's detector reports NOASSERTION.",
    "verified_from": "https://github.com/obophenotype/uberon/blob/master/LICENSE",
    "verdict": "BLOCKED"
  },
  "wikipedia": {
    "licence": "CC BY-SA 4.0", "commercial": true, "attribution": "required",
    "blocking_clause": "Attribution plus share-alike, which would force our derived text under BY-SA.",
    "verified_from": "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
    "verdict": "BLOCKED"
  },
  "mindboggle-101": {
    "licence": "CC BY-NC-SA 3.0 (paper) vs CC BY 4.0 (site) - conflicting", "commercial": false, "attribution": "required",
    "blocking_clause": "Unresolved conflicting licence claims; under the paper's version it is non-commercial and share-alike. Encumbers the DKT40 classifier.",
    "verified_from": "https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2012.00171/full",
    "verdict": "BLOCKED"
  },
  "totalsegmentator-brain-structures": {
    "licence": "Proprietary; free for non-commercial, paid commercial licence required", "commercial": false, "attribution": "n/a",
    "blocking_clause": "Not covered by the Apache-2.0 grant. Commercial use requires purchase. Use fastsurfer-segonly or synthseg-v1 for brain structures.",
    "verified_from": "https://github.com/wasserth/TotalSegmentator",
    "verdict": "BLOCKED"
  }
}
```

`atlas-pipeline/check_sources.py`:

```python
"""The clearance gate. Every pipeline entry point calls require_clear() first.

Rationale: the licence research found that several obvious, high-quality sources
are unusable for a commercial product (FSL's terms even reach the development
process). A gate in code is cheaper than remembering.
"""
import json, os

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT = os.path.join(_HERE, "sources.json")


class SourceNotCleared(Exception):
    pass


def load_sources(path=None):
    with open(path or _DEFAULT, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def require_clear(*source_ids):
    """Raise unless every id is present in the register with verdict CLEAR."""
    reg = load_sources()
    for sid in source_ids:
        row = reg.get(sid)
        if row is None:
            raise SourceNotCleared(
                "%r is not in the clearance register. Add a verified row to "
                "atlas-pipeline/sources.json before using it." % sid)
        if row.get("verdict") != "CLEAR":
            raise SourceNotCleared(
                "%r is %s: %s" % (sid, row.get("verdict"),
                                  row.get("blocking_clause") or row.get("note") or "not cleared"))
```

`atlas-pipeline/requirements.txt`:

```
numpy==2.1.3
scipy==1.14.1
nibabel==5.3.2
Pillow==11.0.0
```

`atlas-pipeline/README.md`:

```markdown
# Anatomy Atlas content pipeline

Dev-only tooling. Turns a public-domain volume into `atlas/<id>/atlas.json` plus
a `.webp` slice stack. Nothing here ships to users.

## Setup

    python3 -m venv atlas-pipeline/.venv
    atlas-pipeline/.venv/bin/pip install -r atlas-pipeline/requirements.txt

## Run

    atlas-pipeline/.venv/bin/python atlas-pipeline/build.py --module brain-mri-axial-t1
    python3 atlas-pipeline/test_pipeline.py

## Rules this tooling enforces

- `sources.json` is a gate, not documentation. `require_clear()` refuses any
  source that is not verified `CLEAR`.
- **Never** install or invoke FSL. Its licence is non-commercial and its terms
  reach the development process, so using it to generate coordinates taints the
  output even though no FSL code ships.
- FastSurfer only ever runs with `--seg_only`. The surface pipeline needs a
  FreeSurfer licence; the segmentation modules do not.
- Named white matter is hand-authored in `atlas-author.html`. No cleared source
  exists. Do not automate it.
- Never commit volumes, masks, or model weights.
```

`.gitignore` additions:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && printf '\n# Anatomy Atlas pipeline: volumes, masks and venv are regenerated, never committed\natlas-pipeline/work/\natlas-pipeline/.venv/\n*.nii\n*.nii.gz\n' >> .gitignore && tail -6 .gitignore
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && python3 atlas-pipeline/test_pipeline.py
```

Expected: `ALL 36 PASS`.

- [ ] **Step 5: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas-pipeline/ .gitignore && git commit -m "feat(atlas-pipeline): machine-enforced licence clearance gate"
```

---

### Task 2: Orientation — the invariant that keeps pins on their structures

A transposed or mirrored mask puts every pin in the wrong place *while still
looking plausible*. One function, used by both the image and the mask path, with a
test that proves they agree.

**Files:**
- Create: `atlas-pipeline/orient.py`
- Modify: `atlas-pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `to_display(arr2d) -> np.ndarray` — radiological axial display orientation (anterior up, patient left on image right). **The only place orientation is decided.**
  - `physical_aspect(shape_disp, spacing_disp) -> float` — display width/height in physical units.
  - `resize_to_square_pixels(arr2d, spacing_disp, target_h) -> np.ndarray` — resample so one output pixel is square in physical space.

- [ ] **Step 1: Write the failing test**

Append to `test_pipeline.py` before the final print:

```python
# ---------- orientation invariant ----------
import numpy as np
from orient import to_display, physical_aspect, resize_to_square_pixels

# A marker in the raw array must land at the SAME display coordinate whether it
# arrives via the image path or the mask path. This is the whole point of the module.
raw = np.zeros((40, 60), dtype=np.float32)
raw[7, 11] = 1.0
mask = np.zeros((40, 60), dtype=bool)
mask[7, 11] = True
di, dm = to_display(raw), to_display(mask)
ok("display shapes agree", di.shape == dm.shape)
ok("marker lands identically on both paths",
   tuple(np.argwhere(di > 0)[0]) == tuple(np.argwhere(dm)[0]))
ok("to_display is idempotent in shape", to_display(di).shape == di.shape)
ok("to_display preserves the pixel count", int(dm.sum()) == 1)
ok("to_display preserves dtype kind", to_display(mask).dtype == bool)

# Radiological convention: anterior up, patient-left on image right. Our raw NIfTI
# axial slab is (X=L->R, Y=P->A), so display = transpose then flip vertically.
probe = np.zeros((4, 6), dtype=np.uint8)
probe[3, 0] = 1                       # max X (patient right), min Y (posterior)
d = to_display(probe)
ok("display is (rows=Y, cols=X)", d.shape == (6, 4))
r, c = np.argwhere(d)[0]
ok("posterior maps to the bottom row", r == d.shape[0] - 1)
ok("patient right maps to the right column", c == d.shape[1] - 1)

# aspect uses PHYSICAL extent, not pixel counts - voxels are rarely cubic.
ok("square voxels give the pixel aspect", abs(physical_aspect((100, 50), (1.0, 1.0)) - 0.5) < 1e-9)
ok("anisotropic voxels are corrected", abs(physical_aspect((100, 50), (2.0, 1.0)) - 0.25) < 1e-9)
ok("aspect is positive for degenerate spacing", physical_aspect((10, 10), (0, 0)) > 0)

sq = resize_to_square_pixels(np.zeros((100, 50), dtype=np.float32), (2.0, 1.0), 200)
ok("resize hits the target height", sq.shape[0] == 200)
ok("resize makes physical pixels square", sq.shape[1] == 50)
ok("resize of a mask stays boolean-safe",
   resize_to_square_pixels(np.ones((10, 10), dtype=bool), (1.0, 1.0), 20).dtype == bool)
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ModuleNotFoundError: No module named 'orient'`.

- [ ] **Step 3: Write the implementation**

`atlas-pipeline/orient.py`:

```python
"""The single authority on slice orientation and aspect.

Every 2D array - image or label mask - passes through to_display() before anything
else touches it. A mirrored mask would place every pin on the contralateral
structure and still look anatomically plausible, so this is deliberately the only
place the question is answered.
"""
import numpy as np


def to_display(arr2d):
    """Raw axial slab (X = patient left->right, Y = posterior->anterior) to
    radiological display: rows = Y with anterior at the top, cols = X with
    patient left on the image right."""
    a = np.asarray(arr2d)
    return np.flipud(a.T)


def physical_aspect(shape_disp, spacing_disp):
    """width/height in physical units. Voxels are rarely cubic, so pixel counts
    alone would render the anatomy squashed."""
    h, w = shape_disp[0], shape_disp[1]
    sy = spacing_disp[0] if spacing_disp[0] else 1.0
    sx = spacing_disp[1] if spacing_disp[1] else 1.0
    ph, pw = h * sy, w * sx
    if ph <= 0:
        return 1.0
    return float(pw) / float(ph)


def resize_to_square_pixels(arr2d, spacing_disp, target_h):
    """Resample so one output pixel is square in physical space. Nearest-neighbour
    throughout: masks must not be interpolated into invented labels, and using one
    path for both keeps image and mask geometry identical."""
    a = np.asarray(arr2d)
    aspect = physical_aspect(a.shape, spacing_disp)
    out_h = int(target_h)
    out_w = max(1, int(round(out_h * aspect)))
    rows = np.clip((np.arange(out_h) + 0.5) * a.shape[0] / out_h, 0, a.shape[0] - 1).astype(int)
    cols = np.clip((np.arange(out_w) + 0.5) * a.shape[1] / out_w, 0, a.shape[1] - 1).astype(int)
    return a[np.ix_(rows, cols)]
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ALL 50 PASS`. If the radiological-convention assertions fail, fix `to_display` — do not relax them; they encode the anatomy.

- [ ] **Step 5: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas-pipeline/ && git commit -m "feat(atlas-pipeline): single orientation authority with physical aspect"
```

---

### Task 3: Pin derivation — components and inside-points

The algorithmic core. Two non-obvious requirements drive it:

1. **A centroid is wrong.** The fornix, corpus callosum and every C-shaped
   structure have centroids that fall *outside* the structure. The pin must sit at
   the mask's distance-transform maximum, which is guaranteed inside.
2. **One pin per connected component, not per label.** That is what makes a
   bilateral structure emit two pins that highlight together, exactly as the spec
   requires — with no special-casing.

**Files:**
- Create: `atlas-pipeline/pins.py`
- Modify: `atlas-pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `orient.to_display` (callers pass already-oriented masks).
- Produces:
  - `inside_point(mask2d) -> (row, col) | None` — deepest interior point; `None` if empty.
  - `pins_for_mask(mask2d, min_area_px) -> [(row, col)]` — one per qualifying component.
  - `to_percent(row, col, shape) -> (x, y)` — 0–100 floats, one decimal, x from cols.

- [ ] **Step 1: Write the failing test**

Append to `test_pipeline.py`:

```python
# ---------- pin derivation ----------
from pins import inside_point, pins_for_mask, to_percent

ok("empty mask yields no point", inside_point(np.zeros((20, 20), bool)) is None)

solid = np.zeros((21, 21), bool); solid[5:16, 5:16] = True
r, c = inside_point(solid)
ok("solid block point is inside", solid[r, c])
ok("solid block point is near the centre", abs(r - 10) <= 1 and abs(c - 10) <= 1)

# THE case a centroid gets wrong: a C shape whose centre of mass is in the gap.
C = np.zeros((31, 31), bool)
C[5:26, 5:11] = True      # spine
C[5:11, 5:26] = True      # top arm
C[20:26, 5:26] = True     # bottom arm
cy, cx = np.argwhere(C).mean(axis=0)
ok("this C-shape really does have an outside centroid", not C[int(round(cy)), int(round(cx))])
r, c = inside_point(C)
ok("inside_point stays inside a C shape", C[r, c])

ring = np.zeros((41, 41), bool)
yy, xx = np.mgrid[0:41, 0:41]
d2 = (yy - 20) ** 2 + (xx - 20) ** 2
ring[(d2 <= 18 ** 2) & (d2 >= 12 ** 2)] = True
ok("annulus centroid is in the hole", not ring[20, 20])
r, c = inside_point(ring)
ok("inside_point stays inside an annulus", ring[r, c])

# One pin per component: this is how bilateral structures get two pins.
two = np.zeros((30, 60), bool); two[10:20, 5:15] = True; two[10:20, 45:55] = True
pts = pins_for_mask(two, min_area_px=20)
ok("two blobs yield two pins", len(pts) == 2)
ok("both pins are inside their blob", all(two[p[0], p[1]] for p in pts))
ok("pins are ordered left to right", pts[0][1] < pts[1][1])

# Slivers at the edge of a structure's z-extent must not become pins.
noisy = np.zeros((30, 60), bool); noisy[10:20, 5:15] = True; noisy[0, 59] = True
ok("sub-threshold components are dropped", len(pins_for_mask(noisy, min_area_px=20)) == 1)
ok("min_area of 1 keeps the sliver", len(pins_for_mask(noisy, min_area_px=1)) == 2)
ok("empty mask yields no pins", pins_for_mask(np.zeros((10, 10), bool), 1) == [])
ok("diagonal touching counts as one component",
   len(pins_for_mask(np.array([[1, 0], [0, 1]], dtype=bool), 1)) == 1)

# percentages: x from columns, y from rows, one decimal, clamped 0-100
x, y = to_percent(0, 0, (101, 101))
ok("origin maps to 0,0", x == 0.0 and y == 0.0)
x, y = to_percent(100, 100, (101, 101))
ok("far corner maps to 100,100", x == 100.0 and y == 100.0)
x, y = to_percent(50, 25, (101, 101))
ok("x comes from the column", x == 25.0)
ok("y comes from the row", y == 50.0)
ok("percentages carry one decimal", to_percent(1, 1, (3, 3)) == (50.0, 50.0))
ok("single-pixel axis does not divide by zero", to_percent(0, 0, (1, 1)) == (0.0, 0.0))
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ModuleNotFoundError: No module named 'pins'`.

- [ ] **Step 3: Write the implementation**

`atlas-pipeline/pins.py`:

```python
"""Label mask -> pin coordinates.

Two deliberate choices:

* The pin is the mask's distance-transform maximum, not its centroid. Arch- and
  ring-shaped structures (fornix, corpus callosum, cortical ribbon) have centroids
  outside themselves; a centroid pin would point at the ventricle next door.
* One pin per connected component, not per label. A bilateral structure therefore
  emits two pins naturally, which is exactly what the viewer's multi-instance
  highlight consumes. No special cases.
"""
import numpy as np
from scipy import ndimage

# 8-connectivity: a diagonal bridge is the same structure, not two.
_CONN = np.ones((3, 3), dtype=bool)


def inside_point(mask2d):
    """Deepest interior point of mask2d, or None if it is empty.
    Guaranteed to satisfy mask2d[point] is True."""
    m = np.asarray(mask2d, dtype=bool)
    if not m.any():
        return None
    dist = ndimage.distance_transform_edt(m)
    idx = int(np.argmax(dist))
    r, c = np.unravel_index(idx, m.shape)
    return int(r), int(c)


def pins_for_mask(mask2d, min_area_px):
    """One inside-point per connected component of at least min_area_px, ordered
    left to right so output is stable across runs."""
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
    x is horizontal (columns), y vertical (rows) - the order the schema expects."""
    h, w = shape[0], shape[1]
    y = 0.0 if h <= 1 else (float(row) / (h - 1)) * 100.0
    x = 0.0 if w <= 1 else (float(col) / (w - 1)) * 100.0
    return (round(min(max(x, 0.0), 100.0), 1), round(min(max(y, 0.0), 100.0), 1))
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ALL 72 PASS`. The C-shape and annulus assertions are the ones that matter; if they fail, the pins will be visibly wrong in the app.

- [ ] **Step 5: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas-pipeline/ && git commit -m "feat(atlas-pipeline): pin derivation via components and interior distance maxima"
```

---

### Task 4: Slice extraction — volume to webp

**Files:**
- Create: `atlas-pipeline/slices.py`
- Modify: `atlas-pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: `orient.to_display`, `orient.physical_aspect`, `orient.resize_to_square_pixels`, `check_sources.require_clear`.
- Produces:
  - `apply_window(hu, center, width) -> np.ndarray` — float 0–1.
  - `pick_slice_indices(n_available, n_wanted) -> [int]` — evenly spaced, inclusive of both ends.
  - `extract_slices(nifti_path, out_dir, module_id, n_wanted, window, source_id) -> [dict]` — writes `NNN.webp` + `t/NNN.webp`, returns slice stubs `{i, img, aspect, _z, _shape}`.

- [ ] **Step 1: Write the failing test**

Append to `test_pipeline.py`:

```python
# ---------- slice extraction ----------
from slices import apply_window, pick_slice_indices

hu = np.array([-1000, -100, 0, 40, 80, 1000], dtype=np.float32)
w = apply_window(hu, center=40, width=80)          # brain window: 0..80 HU
ok("window clamps below the floor", w[0] == 0.0 and w[1] == 0.0)
ok("window maps the centre to mid-grey", abs(w[3] - 0.5) < 1e-6)
ok("window clamps above the ceiling", w[5] == 1.0)
ok("window output stays in 0..1", w.min() >= 0.0 and w.max() <= 1.0)
ok("window floor maps to 0", apply_window(np.array([0.0]), 40, 80)[0] == 0.0)
ok("zero width does not divide by zero", np.isfinite(apply_window(hu, 40, 0)).all())

idx = pick_slice_indices(200, 24)
ok("picks the requested count", len(idx) == 24)
ok("starts at the first slice", idx[0] == 0)
ok("ends at the last slice", idx[-1] == 199)
ok("indices ascend", all(b > a for a, b in zip(idx, idx[1:])))
ok("fewer available than wanted degrades", pick_slice_indices(5, 24) == [0, 1, 2, 3, 4])
ok("single slice is safe", pick_slice_indices(1, 24) == [0])
ok("zero available yields nothing", pick_slice_indices(0, 24) == [])
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ModuleNotFoundError: No module named 'slices'`.

- [ ] **Step 3: Write the implementation**

`atlas-pipeline/slices.py`:

```python
"""Volume -> display-ready webp slices.

Every array leaves here having passed through orient.to_display and
orient.resize_to_square_pixels, and the mask path in build.py applies the same two
functions with the same arguments. That shared path is what guarantees pins land
on their structures.
"""
import os
import numpy as np
from PIL import Image

from check_sources import require_clear
from orient import to_display, physical_aspect, resize_to_square_pixels

THUMB_H = 128
DISPLAY_H = 900
JPEG_Q = 82

# Conventional display windows, HU. Only used for CT.
WINDOWS = {
    "brain": (40, 80),
    "soft-tissue": (50, 400),
    "lung": (-600, 1500),
    "bone": (400, 1800),
    "mediastinum": (50, 350),
}


def apply_window(arr, center, width):
    """HU (or raw MR intensity) -> 0..1 float for display."""
    a = np.asarray(arr, dtype=np.float32)
    if not width:
        width = 1.0
    lo = center - width / 2.0
    hi = center + width / 2.0
    if hi <= lo:
        hi = lo + 1.0
    return np.clip((a - lo) / (hi - lo), 0.0, 1.0)


def pick_slice_indices(n_available, n_wanted):
    """Evenly spaced indices including both ends - the reference stack is 24 slices
    spanning the whole volume, not a contiguous run."""
    if n_available <= 0:
        return []
    if n_available <= n_wanted:
        return list(range(n_available))
    return [int(round(i * (n_available - 1) / (n_wanted - 1))) for i in range(n_wanted)]


def extract_slices(nifti_path, out_dir, module_id, n_wanted, window, source_id):
    """Write NNN.webp and t/NNN.webp; return slice stubs for build.py.

    The returned _z and _shape let the mask path reproduce this geometry exactly.
    """
    require_clear(source_id)
    import nibabel as nib

    img = nib.load(nifti_path)
    vol = np.asanyarray(img.dataobj)
    zooms = img.header.get_zooms()[:3]

    os.makedirs(os.path.join(out_dir, "t"), exist_ok=True)
    picks = pick_slice_indices(vol.shape[2], n_wanted)
    # Display spacing after to_display (which transposes): rows=Y, cols=X.
    spacing_disp = (zooms[1], zooms[0])

    out = []
    for n, z in enumerate(picks, start=1):
        disp = to_display(vol[:, :, z])
        disp = resize_to_square_pixels(disp, spacing_disp, DISPLAY_H)

        if window is None:                      # MR: percentile stretch, no HU scale
            lo, hi = np.percentile(disp, [1.0, 99.5])
            g = np.clip((disp - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
        else:
            c, wd = WINDOWS[window] if isinstance(window, str) else window
            g = apply_window(disp, c, wd)

        pil = Image.fromarray((g * 255.0).astype(np.uint8), mode="L")
        name = "%03d.webp" % n
        pil.save(os.path.join(out_dir, name), "WEBP", quality=JPEG_Q)
        tw = max(1, int(round(THUMB_H * pil.width / pil.height)))
        pil.resize((tw, THUMB_H)).save(os.path.join(out_dir, "t", name), "WEBP", quality=80)

        out.append({
            "i": n,
            "img": "/atlas/%s/%s" % (module_id, name),
            "aspect": round(float(pil.width) / float(pil.height), 4),
            "_z": int(z),
            "_shape": (pil.height, pil.width),
        })
    return out
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ALL 86 PASS`.

- [ ] **Step 5: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas-pipeline/ && git commit -m "feat(atlas-pipeline): windowed slice extraction to webp with physical aspect"
```

---

### Task 5: Label mapping — model output to anatomy

**Files:**
- Create: `atlas-pipeline/labels.py`, `atlas-pipeline/labels/brain-mri-axial-t1.json`
- Modify: `atlas-pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `load_mapping(module_id) -> dict` — `{categories, structures, model_labels}`.
  - `structure_for_label(mapping, model_label) -> str | None` — model label to structure id; `None` means "deliberately not shown".
  - `structures_block(mapping) -> dict` — the schema's `structures` object.
  - `categories_block(mapping) -> dict` — the schema's `categories` object.

- [ ] **Step 1: Write the failing test**

Append to `test_pipeline.py`:

```python
# ---------- label mapping ----------
from labels import load_mapping, structure_for_label, structures_block, categories_block

M = load_mapping("brain-mri-axial-t1")
ok("mapping loads", isinstance(M, dict))
ok("mapping declares categories", len(categories_block(M)) > 0)
ok("mapping declares structures", len(structures_block(M)) > 0)

cats, strs = categories_block(M), structures_block(M)
ok("every structure has a name", all(s.get("name") for s in strs.values()))
ok("every structure category resolves", all(s.get("category") in cats for s in strs.values()))
ok("every parent resolves", all(s["parent"] in strs for s in strs.values() if s.get("parent")))
ok("every category has a colour", all(c.get("color", "").startswith("#") for c in cats.values()))
ok("every category has a label", all(c.get("label") for c in cats.values()))
ok("structure ids are kebab-case", all(__import__("re").match(r"^[a-z0-9-]+$", k) for k in strs))

ok("a known model label maps", structure_for_label(M, "Left-Thalamus") is not None)
ok("mapped targets exist as structures", structure_for_label(M, "Left-Thalamus") in strs)
ok("left and right map to ONE structure (bilateral pins, one entry)",
   structure_for_label(M, "Left-Thalamus") == structure_for_label(M, "Right-Thalamus"))
ok("an unmapped label is skipped", structure_for_label(M, "Some-Label-We-Do-Not-Show") is None)
ok("an explicitly nulled label is skipped", structure_for_label(M, "Unknown") is None)

# The register bars the atlas FILES, not the nomenclature; definitions must be ours/PD.
blob = json.dumps(M)
ok("mapping cites no blocked source", not __import__("re").search(r"(?i)freesurfer license|fsl|jhu|mindboggle", blob))
ok("white matter structures are marked hand-authored",
   any(s.get("hand_authored") for s in strs.values()))
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ModuleNotFoundError: No module named 'labels'`.

- [ ] **Step 3: Write the implementation**

`atlas-pipeline/labels.py`:

```python
"""Model label -> anatomy.

model_labels maps a segmentation model's own label string to one of our structure
ids. Left/Right variants deliberately map to the SAME structure id: the viewer
highlights every pin sharing an id, so one entry plus two components gives the
bilateral behaviour for free.

A label mapped to null is one we have decided not to show. Absent and null are
treated the same; both are recorded so the decision is visible.
"""
import json, os

_HERE = os.path.dirname(os.path.abspath(__file__))


def load_mapping(module_id):
    with open(os.path.join(_HERE, "labels", module_id + ".json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


def categories_block(mapping):
    return mapping.get("categories", {})


def structures_block(mapping):
    return mapping.get("structures", {})


def structure_for_label(mapping, model_label):
    sid = mapping.get("model_labels", {}).get(model_label)
    if not sid:
        return None
    return sid if sid in structures_block(mapping) else None
```

`atlas-pipeline/labels/brain-mri-axial-t1.json` — names are Terminologia Anatomica
terms (public domain); definitions are Gray's 1918 (PD-US). `hand_authored` marks
the structures with no cleared geometry source, which the author tool must supply:

```json
{
  "_names": "Terminologia Anatomica individual terms (public domain)",
  "_definitions": "Gray's Anatomy 1918, original scan (PD-US)",
  "_geometry": "fastsurfer-segonly asegdkt for cortex/nuclei/ventricles; hand_authored structures placed in atlas-author.html",
  "categories": {
    "grey-matter": { "label": "Grey matter", "color": "#7ee081" },
    "white-matter": { "label": "White matter", "color": "#ffffff" },
    "csf": { "label": "CSF space", "color": "#7fd9e8" }
  },
  "structures": {
    "telencephalon": { "name": "Telencephalon", "category": "grey-matter" },
    "frontal-lobe": { "name": "Frontal lobe", "category": "grey-matter", "parent": "telencephalon" },
    "superior-frontal-gyrus": { "name": "Superior frontal gyrus", "category": "grey-matter", "parent": "frontal-lobe", "definition": "The superior frontal gyrus occupies the upper margin of the frontal lobe and is continuous over the medial surface with the medial frontal gyrus." },
    "middle-frontal-gyrus": { "name": "Middle frontal gyrus", "category": "grey-matter", "parent": "frontal-lobe", "definition": "The middle frontal gyrus lies between the superior and inferior frontal sulci." },
    "precentral-gyrus": { "name": "Precentral gyrus", "category": "grey-matter", "parent": "frontal-lobe", "definition": "The precentral gyrus lies immediately in front of the central sulcus and contains the primary motor cortex." },
    "postcentral-gyrus": { "name": "Postcentral gyrus", "category": "grey-matter", "parent": "telencephalon", "definition": "The postcentral gyrus lies immediately behind the central sulcus and receives the somatosensory projection." },
    "thalamus": { "name": "Thalamus", "category": "grey-matter", "parent": "telencephalon", "definition": "The thalamus is a large ovoid mass of grey matter forming much of the lateral wall of the third ventricle." },
    "putamen": { "name": "Putamen", "category": "grey-matter", "parent": "telencephalon", "definition": "The putamen is the outer and larger part of the striatum, separated from the globus pallidus by a lamina of white matter." },
    "caudate-nucleus": { "name": "Caudate nucleus", "category": "grey-matter", "parent": "telencephalon", "definition": "The caudate nucleus is an elongated arched mass of grey matter closely related to the lateral ventricle throughout its length." },
    "hippocampus": { "name": "Hippocampus", "category": "grey-matter", "parent": "telencephalon", "definition": "The hippocampus is a curved elevation of grey matter in the floor of the temporal horn of the lateral ventricle." },
    "lateral-ventricle": { "name": "Lateral ventricle", "category": "csf", "definition": "The lateral ventricles are two irregular cavities within the cerebral hemispheres, communicating with the third ventricle through the interventricular foramina." },
    "third-ventricle": { "name": "Third ventricle", "category": "csf", "definition": "The third ventricle is a narrow median cleft between the two thalami." },
    "fornix": { "name": "Fornix", "category": "white-matter", "hand_authored": true, "definition": "The fornix is a longitudinal, arch-shaped lamella of white substance situated below the corpus callosum, consisting of two symmetrical bands, one for either hemisphere." },
    "corpus-callosum": { "name": "Corpus callosum", "category": "white-matter", "hand_authored": true, "definition": "The corpus callosum is the great transverse commissure uniting the cerebral hemispheres." },
    "internal-capsule": { "name": "Internal capsule", "category": "white-matter", "hand_authored": true, "definition": "The internal capsule is a broad band of white matter lying between the caudate nucleus and thalamus medially and the lentiform nucleus laterally." },
    "external-capsule": { "name": "External capsule", "category": "white-matter", "hand_authored": true, "definition": "The external capsule is a thin lamina of white matter lying between the putamen and the claustrum." },
    "corona-radiata": { "name": "Corona radiata", "category": "white-matter", "hand_authored": true, "definition": "The corona radiata is the fan-shaped mass of projection fibres passing between the internal capsule and the cerebral cortex." }
  },
  "model_labels": {
    "Left-Thalamus": "thalamus",
    "Right-Thalamus": "thalamus",
    "Left-Thalamus-Proper": "thalamus",
    "Right-Thalamus-Proper": "thalamus",
    "Left-Putamen": "putamen",
    "Right-Putamen": "putamen",
    "Left-Caudate": "caudate-nucleus",
    "Right-Caudate": "caudate-nucleus",
    "Left-Hippocampus": "hippocampus",
    "Right-Hippocampus": "hippocampus",
    "Left-Lateral-Ventricle": "lateral-ventricle",
    "Right-Lateral-Ventricle": "lateral-ventricle",
    "3rd-Ventricle": "third-ventricle",
    "ctx-lh-superiorfrontal": "superior-frontal-gyrus",
    "ctx-rh-superiorfrontal": "superior-frontal-gyrus",
    "ctx-lh-rostralmiddlefrontal": "middle-frontal-gyrus",
    "ctx-rh-rostralmiddlefrontal": "middle-frontal-gyrus",
    "ctx-lh-precentral": "precentral-gyrus",
    "ctx-rh-precentral": "precentral-gyrus",
    "ctx-lh-postcentral": "postcentral-gyrus",
    "ctx-rh-postcentral": "postcentral-gyrus",
    "Unknown": null,
    "Left-VentralDC": null,
    "Right-VentralDC": null,
    "CSF": null,
    "Left-vessel": null,
    "Right-vessel": null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ALL 103 PASS`.

- [ ] **Step 5: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas-pipeline/ && git commit -m "feat(atlas-pipeline): TA/Gray label mapping with bilateral collapse"
```

---

### Task 6: Assemble and validate against the viewer's own schema

**Files:**
- Create: `atlas-pipeline/build.py`
- Modify: `atlas-pipeline/test_pipeline.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `assemble(module_meta, slice_stubs, pins_by_slice, mapping) -> dict` — a complete `atlas.json`.
  - `validate_with_viewer(atlas_dict, repo_root) -> [str]` — invokes `atlas.js`'s `validateAtlas` through `node`. **The single schema authority.**
  - `upsert_module(catalog_path, module_meta) -> dict` — adds/updates the `modules.json` row.
  - CLI: `python build.py --module <id> --volume <nii> --seg <nii> [--slices 24] [--window brain] [--dry-run]`

- [ ] **Step 1: Write the failing test**

Append to `test_pipeline.py`:

```python
# ---------- assembly and cross-language validation ----------
from build import assemble, validate_with_viewer, upsert_module

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = {"id": "brain-mri-axial-t1", "title": "Brain - MRI", "subtitle": "Axial - T1",
        "region": "Brain", "modality": "MRI"}
STUBS = [{"i": 1, "img": "/atlas/brain-mri-axial-t1/001.webp", "aspect": 0.9, "_z": 0, "_shape": (900, 810)},
         {"i": 2, "img": "/atlas/brain-mri-axial-t1/002.webp", "aspect": 0.9, "_z": 5, "_shape": (900, 810)}]
PINS = {1: [{"s": "thalamus", "x": 45.0, "y": 52.0}, {"s": "thalamus", "x": 55.0, "y": 52.0}],
        2: [{"s": "fornix", "x": 50.0, "y": 56.0}]}

A = assemble(META, STUBS, PINS, M)
ok("assemble sets the id", A["id"] == "brain-mri-axial-t1")
ok("assemble emits every slice", len(A["slices"]) == 2)
ok("assemble strips private keys", all(not any(k.startswith("_") for k in s) for s in A["slices"]))
ok("assemble carries pins through", len(A["slices"][0]["pins"]) == 2)
ok("assemble keeps bilateral duplicates", A["slices"][0]["pins"][0]["s"] == A["slices"][0]["pins"][1]["s"])
ok("assemble records provenance", isinstance(A.get("provenance"), dict))
ok("provenance names the image source for the info screen",
   "National Library of Medicine" in json.dumps(A["provenance"]) or A["provenance"].get("images"))
ok("assemble prunes structures with no pins anywhere",
   all(sid in json.dumps(A["slices"]) or sid in [s.get("parent") for s in A["structures"].values()]
       for sid in A["structures"]))

# THE important one: the schema is defined once, in atlas.js.
errs = validate_with_viewer(A, REPO)
ok("assembled atlas passes the VIEWER's validator", errs == [], )
bad = json.loads(json.dumps(A)); bad["slices"][0]["pins"][0]["s"] = "no-such-structure"
ok("viewer validator catches a dangling pin", validate_with_viewer(bad, REPO) != [])
bad2 = json.loads(json.dumps(A)); bad2["slices"][1]["i"] = 9
ok("viewer validator catches a bad slice index", validate_with_viewer(bad2, REPO) != [])

cat = upsert_module({"version": 1, "modules": []}, dict(META, slices=2, thumb="/atlas/x/t/001.webp"))
ok("upsert adds a new module", len(cat["modules"]) == 1)
cat = upsert_module(cat, dict(META, slices=7, thumb="/atlas/x/t/001.webp"))
ok("upsert replaces rather than duplicates", len(cat["modules"]) == 1 and cat["modules"][0]["slices"] == 7)
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ModuleNotFoundError: No module named 'build'`.

- [ ] **Step 3: Write the implementation**

`atlas-pipeline/build.py`:

```python
#!/usr/bin/env python3
"""Assemble atlas.json and validate it against the viewer's own schema.

validate_with_viewer runs atlas.js's validateAtlas through node rather than
re-implementing it here. There is exactly one schema, it lives in the code that
consumes it, and drift between the two subsystems is therefore impossible.
"""
import argparse, json, os, subprocess, sys, tempfile

import numpy as np

from check_sources import require_clear, load_sources
from labels import load_mapping, structure_for_label, structures_block, categories_block
from orient import to_display, resize_to_square_pixels
from pins import pins_for_mask, to_percent
from slices import extract_slices, DISPLAY_H

MIN_AREA_PX = 30          # ponytail: flat threshold. Make it area-relative only if
                          # small structures actually go missing in QA.

_NODE_VALIDATE = r"""
const {readFileSync} = require('fs');
const SRC = readFileSync(process.argv[1], 'utf8');
const mod = {exports:{}};
new Function('window','document','module',SRC)(
  {addEventListener(){}},
  {addEventListener(){},getElementById:()=>null,createElement:()=>({classList:{add(){},remove(){}}})},
  mod
);
const errs = mod.exports.validateAtlas(JSON.parse(readFileSync(process.argv[2],'utf8')));
process.stdout.write(JSON.stringify(errs));
"""


def validate_with_viewer(atlas_dict, repo_root):
    """Return the viewer's own list of schema errors ([] means valid)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(atlas_dict, fh)
        tmp = fh.name
    try:
        res = subprocess.run(
            ["node", "-e", _NODE_VALIDATE, os.path.join(repo_root, "atlas.js"), tmp],
            capture_output=True, text=True)
        if res.returncode != 0:
            return ["validator failed to run: " + (res.stderr or "").strip()]
        return json.loads(res.stdout or "[]")
    finally:
        os.unlink(tmp)


def assemble(module_meta, slice_stubs, pins_by_slice, mapping):
    """Build the atlas.json body. Drops structures that never receive a pin and
    are not needed as a hierarchy parent, so the file carries no dead weight."""
    strs_all = structures_block(mapping)
    used = set()
    for pins in pins_by_slice.values():
        for p in pins:
            used.add(p["s"])
    # keep ancestors of anything used, so the hierarchy tab still resolves
    frontier = list(used)
    while frontier:
        sid = frontier.pop()
        parent = (strs_all.get(sid) or {}).get("parent")
        if parent and parent not in used:
            used.add(parent)
            frontier.append(parent)

    structures = {}
    for sid in sorted(used):
        src = dict(strs_all.get(sid) or {})
        src.pop("hand_authored", None)          # pipeline bookkeeping, not schema
        structures[sid] = src

    cats_used = {s.get("category") for s in structures.values() if s.get("category")}
    categories = {k: v for k, v in categories_block(mapping).items() if k in cats_used}

    reg = load_sources()
    return {
        "id": module_meta["id"],
        "provenance": {
            "images": reg["visible-human"].get("credit") or "",
            "licence": reg["visible-human"]["licence"],
            "definitions": "Gray's Anatomy (1918)",
            "geometry": mapping.get("_geometry", ""),
            "clearedOn": "2026-08-17",
        },
        "categories": categories,
        "structures": structures,
        "slices": [
            {"i": s["i"], "img": s["img"], "aspect": s["aspect"],
             "pins": pins_by_slice.get(s["i"], [])}
            for s in slice_stubs
        ],
    }


def upsert_module(catalog, module_meta):
    mods = [m for m in catalog.get("modules", []) if m["id"] != module_meta["id"]]
    mods.append(module_meta)
    mods.sort(key=lambda m: (m.get("region", ""), m.get("title", "")))
    return {"version": catalog.get("version", 1), "modules": mods}


def pins_from_segmentation(seg_path, slice_stubs, mapping, spacing_disp):
    """Per slice, per model label, one pin per connected component.

    The mask goes through the SAME to_display + resize_to_square_pixels as the
    image in slices.py, which is what keeps pins on their structures.
    """
    import nibabel as nib
    seg = np.asanyarray(nib.load(seg_path).dataobj)
    lut = {}                                   # integer value -> model label string
    for k, v in (mapping.get("model_values") or {}).items():
        lut[int(k)] = v

    out = {}
    for stub in slice_stubs:
        plane = seg[:, :, stub["_z"]]
        pins = []
        for val in np.unique(plane):
            if val == 0:
                continue
            model_label = lut.get(int(val), str(int(val)))
            sid = structure_for_label(mapping, model_label)
            if not sid:
                continue
            m = resize_to_square_pixels(to_display(plane == val), spacing_disp, DISPLAY_H)
            for (r, c) in pins_for_mask(m, MIN_AREA_PX):
                x, y = to_percent(r, c, m.shape)
                pins.append({"s": sid, "x": x, "y": y})
        out[stub["i"]] = pins
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build an anatomy atlas module.")
    ap.add_argument("--module", required=True)
    ap.add_argument("--volume", help="input NIfTI (omit with --dry-run)")
    ap.add_argument("--seg", help="segmentation NIfTI from a CLEAR model")
    ap.add_argument("--slices", type=int, default=24)
    ap.add_argument("--window", default=None, help="brain|soft-tissue|lung|bone|mediastinum (CT only)")
    ap.add_argument("--source", default="visible-human")
    ap.add_argument("--title", default=None)
    ap.add_argument("--region", default="Brain")
    ap.add_argument("--modality", default="MRI")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    require_clear(a.source)                    # gate before any data is touched
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mapping = load_mapping(a.module)
    out_dir = os.path.join(repo, "atlas", a.module)

    if a.dry_run:
        print("gate ok; mapping ok; would write", out_dir)
        return 0

    import nibabel as nib
    zooms = nib.load(a.volume).header.get_zooms()[:3]
    spacing_disp = (zooms[1], zooms[0])

    stubs = extract_slices(a.volume, out_dir, a.module, a.slices, a.window, a.source)
    pins = pins_from_segmentation(a.seg, stubs, mapping, spacing_disp) if a.seg else {}

    meta = {"id": a.module, "title": a.title or a.module, "subtitle": a.subtitle,
            "region": a.region, "modality": a.modality}
    atlas = assemble(meta, stubs, pins, mapping)

    errs = validate_with_viewer(atlas, repo)
    if errs:
        print("SCHEMA ERRORS (nothing written):", file=sys.stderr)
        for e in errs[:20]:
            print("  -", e, file=sys.stderr)
        return 1

    with open(os.path.join(out_dir, "atlas.json"), "w", encoding="utf-8") as fh:
        json.dump(atlas, fh, indent=1, ensure_ascii=False)

    cat_path = os.path.join(repo, "atlas", "modules.json")
    catalog = json.load(open(cat_path, encoding="utf-8")) if os.path.exists(cat_path) else {"version": 1, "modules": []}
    mid = len(stubs) // 2 + 1
    catalog = upsert_module(catalog, dict(meta, slices=len(stubs),
                                          thumb="/atlas/%s/t/%03d.webp" % (a.module, mid)))
    with open(cat_path, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, indent=1, ensure_ascii=False)

    total_pins = sum(len(v) for v in pins.values())
    hand = [k for k, v in structures_block(mapping).items() if v.get("hand_authored")]
    print("wrote %d slices, %d pins" % (len(stubs), total_pins))
    print("STILL TO HAND-AUTHOR in atlas-author.html: %s" % (", ".join(hand) or "none"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Add `model_values` to `labels/brain-mri-axial-t1.json` — the integer→label LUT for the
segmentation you actually run. Print the real values first and map only what you need:

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python -c "
import sys, numpy as np, nibabel as nib
print(sorted(int(v) for v in np.unique(np.asanyarray(nib.load(sys.argv[1]).dataobj)) if v))" atlas-pipeline/work/seg.nii.gz
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py
```

Expected: `ALL 117 PASS`. The `passes the VIEWER's validator` assertion requires
`atlas.js` to export `validateAtlas` — i.e. viewer Task 2 must be done first.

- [ ] **Step 5: Verify the gate and the dry run**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && atlas-pipeline/.venv/bin/python atlas-pipeline/build.py --module brain-mri-axial-t1 --dry-run --source visible-human && atlas-pipeline/.venv/bin/python atlas-pipeline/build.py --module brain-mri-axial-t1 --dry-run --source fsl; echo "exit=$? (expect non-zero: fsl is BLOCKED)"
```

Expected: the first prints `gate ok`; the second raises `SourceNotCleared` naming the non-commercial clause.

- [ ] **Step 6: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas-pipeline/ && git commit -m "feat(atlas-pipeline): assemble atlas.json, validated by the viewer's own schema"
```

---

### Task 7: The QA and hand-author tool

Where a human verifies every auto-derived pin and supplies the white-matter layer
that has no cleared source. Without this the pipeline ships plausible-looking
mistakes.

**Files:**
- Create: `atlas-pipeline/atlas-author.html`

**Interfaces:**
- Consumes: `atlas/<id>/atlas.json` and its `.webp` slices, served by the dev server.
- Produces: a corrected `atlas.json` via download. No server, no build step.

- [ ] **Step 1: Write the tool**

Single self-contained file — it is dev tooling, so it may use modern syntax and is
exempt from the app's ES5 and no-emoji rules. Load it from the dev server so the
`/atlas/...` image paths resolve:

```html
<!doctype html>
<meta charset="utf-8">
<title>Atlas author / QA</title>
<style>
  body { margin: 0; font: 14px system-ui; background: #111; color: #eee; display: flex; height: 100vh; }
  #side { width: 300px; flex: 0 0 300px; overflow-y: auto; padding: 12px; background: #191919; }
  #main { flex: 1; position: relative; overflow: hidden; }
  #wrap { position: absolute; inset: 0; display: grid; place-items: center; }
  #box { position: relative; }
  img { display: block; max-width: 100%; max-height: 88vh; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  circle { cursor: grab; }
  .row { display: flex; gap: 6px; align-items: center; padding: 3px 0; }
  .row.on { outline: 1px solid #3b9dff; }
  button { background: #2b2b2b; color: #eee; border: 0; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
  select, input { background: #222; color: #eee; border: 1px solid #444; border-radius: 4px; padding: 4px; }
  #bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px; background: #000c; display: flex; gap: 8px; align-items: center; }
  .warn { color: #ffb4b4; }
</style>
<div id="side">
  <p><b>Atlas QA</b></p>
  <p>Module <input id="mid" value="brain-mri-axial-t1" size="20"></p>
  <p><button id="load">Load</button> <button id="save">Download JSON</button></p>
  <p>Add pin as:<br><select id="pick"></select></p>
  <p style="opacity:.7">Click the image to add a pin of the selected structure.
     Drag a pin to move it. Shift-click a pin to delete it.</p>
  <div id="list"></div>
  <p id="todo" class="warn"></p>
</div>
<div id="main">
  <div id="wrap"><div id="box"><img id="img" alt=""><svg id="ov" viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div></div>
  <div id="bar">
    <button id="prev">&larr;</button><span id="cnt">-</span><button id="next">&rarr;</button>
    <input id="rng" type="range" min="1" max="1" value="1" style="flex:1">
  </div>
</div>
<script>
let A = null, i = 1, drag = null;
const $ = (id) => document.getElementById(id);
const cur = () => A.slices[i - 1];

async function load() {
  const id = $("mid").value.trim();
  A = await (await fetch("/atlas/" + id + "/atlas.json")).json();
  i = 1;
  $("rng").max = A.slices.length;
  $("pick").innerHTML = Object.keys(A.structures).sort()
    .map((k) => `<option value="${k}">${A.structures[k].name}</option>`).join("");
  const hand = Object.keys(A.structures).filter((k) => A.structures[k].hand_authored);
  $("todo").textContent = hand.length ? "Hand-author still pending: " + hand.join(", ") : "";
  draw();
}

function draw() {
  const s = cur();
  $("img").src = s.img;
  $("cnt").textContent = i + "/" + A.slices.length;
  $("rng").value = i;
  $("ov").innerHTML = (s.pins || []).map((p, n) => {
    const col = (A.categories[A.structures[p.s].category] || {}).color || "#fff";
    return `<circle data-n="${n}" cx="${p.x}" cy="${p.y}" r="1.1" fill="${col}" stroke="#000" stroke-width=".3"/>`
         + `<text x="${p.x + 1.8}" y="${p.y}" fill="${col}" font-size="2.4">${A.structures[p.s].name}</text>`;
  }).join("");
  $("list").innerHTML = (s.pins || []).map((p, n) =>
    `<div class="row"><code>${p.s}</code> <span style="opacity:.6">${p.x},${p.y}</span></div>`).join("");
}

function xy(e) {
  const r = $("img").getBoundingClientRect();
  return [ +(((e.clientX - r.left) / r.width) * 100).toFixed(1),
           +(((e.clientY - r.top) / r.height) * 100).toFixed(1) ];
}

$("ov").addEventListener("pointerdown", (e) => {
  const c = e.target.closest("circle"); if (!c) return;
  const n = +c.dataset.n;
  if (e.shiftKey) { cur().pins.splice(n, 1); draw(); return; }
  drag = n; e.preventDefault();
});
window.addEventListener("pointermove", (e) => {
  if (drag === null) return;
  const [x, y] = xy(e); Object.assign(cur().pins[drag], { x, y }); draw();
});
window.addEventListener("pointerup", () => { drag = null; });
$("img").addEventListener("click", (e) => {
  const [x, y] = xy(e);
  (cur().pins = cur().pins || []).push({ s: $("pick").value, x, y });
  draw();
});
$("prev").onclick = () => { if (i > 1) { i--; draw(); } };
$("next").onclick = () => { if (i < A.slices.length) { i++; draw(); } };
$("rng").oninput = () => { i = +$("rng").value; draw(); };
$("load").onclick = load;
$("save").onclick = () => {
  // hand_authored is pipeline bookkeeping; strip it so the shipped file stays schema-clean
  const out = JSON.parse(JSON.stringify(A));
  Object.values(out.structures).forEach((s) => delete s.hand_authored);
  const b = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = "atlas.json"; a.click();
};
load();
</script>
```

- [ ] **Step 2: Verify it round-trips**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && node test/serve.mjs . 8903
```

Open `http://localhost:8903/atlas-pipeline/atlas-author.html`. Confirm: the module
loads, pins render in category colours, dragging a pin updates its numbers,
shift-click deletes, clicking the image adds a pin of the selected structure, and
**Download JSON** produces a file with no `hand_authored` keys.

- [ ] **Step 3: Verify the corrected file still validates**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && cp ~/Downloads/atlas.json atlas/brain-mri-axial-t1/atlas.json && node test/atlas-data.test.mjs
```

Expected: `ALL n PASS`. This is the loop that keeps hand edits honest — the viewer's
validator is the same gate the pipeline uses.

- [ ] **Step 4: Do the QA pass and author the white matter**

For the first real module: step through every slice and confirm each auto-derived
pin sits inside its structure and is correctly named. Then place the white-matter
pins that have no cleared source — fornix, corpus callosum (genu/body/splenium),
internal capsule, external capsule, corona radiata — on the slices where each is
visible. Names come from the mapping (TA terms); definitions are already in it
(Gray's). Delete every pin you cannot personally vouch for; a missing label is a
gap, a wrong label is a defect.

- [ ] **Step 5: Commit**

```bash
cd /Users/diwakarkumar/Developer/StewardMD && git add atlas-pipeline/atlas-author.html atlas/ && git commit -m "feat(atlas-pipeline): QA and hand-author tool for pin verification"
```

---

## How to run it end to end

Once the tasks are done, one real module looks like this. Nothing here is committed
except the outputs under `atlas/`.

```bash
# 1. Fetch a cleared volume into atlas-pipeline/work/ (gitignored) and convert to NIfTI.
#    Visible Human requires the credit line already wired into provenance.

# 2. Segment with a CLEAR model. Brain: FastSurfer, segmentation only.
#    --seg_only is what avoids needing a FreeSurfer licence. Never run the surface pipeline.
docker run --rm -v "$PWD/atlas-pipeline/work:/data" deepmi/fastsurfer:latest \
  --t1 /data/vol.nii.gz --sid m1 --sd /data/out --seg_only

# 2b. Body CT instead: TotalSegmentator (Apache-2.0 code and weights)
# TotalSegmentator -i atlas-pipeline/work/vol.nii.gz -o atlas-pipeline/work/seg --ml

# 3. Build, validating against the viewer's schema.
atlas-pipeline/.venv/bin/python atlas-pipeline/build.py \
  --module brain-mri-axial-t1 --volume atlas-pipeline/work/vol.nii.gz \
  --seg atlas-pipeline/work/out/m1/mri/aparc.DKTatlas+aseg.deep.mgz.nii.gz \
  --slices 24 --modality MRI --region Brain \
  --title "Brain - MRI" --subtitle "Axial - T1"

# 4. QA + author the white matter, then re-validate.
node test/serve.mjs . 8903     # open /atlas-pipeline/atlas-author.html
node test/atlas-data.test.mjs
```

## Self-Review

**Spec coverage.** §4.1 `modules.json` → `upsert_module` (Task 6). §4.2 every field:
`x`/`y` percentages → `to_percent` (3); `aspect` from physical extent →
`physical_aspect` (2); contiguous `i` → `extract_slices` (4) and asserted by the
viewer's validator (6); duplicate `s` per slice → one pin per component (3),
asserted in 6; `parent` resolution → `labels` test (5) and ancestor retention in
`assemble` (6); `definition` optional → mapping allows it (5); `provenance` recorded
but never rendered → `assemble` (6), and it now feeds the info screen's single credit
line per the owner decision. §9 clearance → Task 1, gating every entry point. §9's
white-matter dead end → Task 7 Step 4. §4.3 budget → `DISPLAY_H`/`JPEG_Q` (4).

**Placeholder scan.** No TBD/TODO. Two genuine external dependencies are named
rather than faked: `model_values` must be populated from a real segmentation's
integer values (Task 6 gives the exact command to print them), and Task 7 Step 4 is
human work that cannot be code. `MIN_AREA_PX` carries a `ponytail:` note with its
upgrade condition.

**Type consistency.** `to_display` → 2D ndarray, used identically in `slices.py` and
`build.pins_from_segmentation` — this is the alignment invariant, and it is the same
two calls with the same `spacing_disp` and `DISPLAY_H` on both paths.
`pins_for_mask` → `[(row, col)]`, always fed to `to_percent(row, col, shape)` →
`(x, y)`; the row/col vs x/y swap happens in exactly one place. `slice_stubs` carry
`_z`/`_shape` between Tasks 4 and 6 and are stripped in `assemble`, asserted.
`structure_for_label` returns `str | None` and every caller checks for `None`.
`validate_with_viewer` returns `[str]` in both the success (`[]`) and failure paths.
`load_sources` strips `_`-prefixed keys, so the register's `_note`/`_tier` cannot be
mistaken for sources — asserted in Task 1.

**One risk I could not close by writing code.** FastSurfer's *weights* licence, as
distinct from its Apache-2.0 code, is marked UNVERIFIED in the register, as is the
provenance of its training labels (its README says it mimics FreeSurfer's DKTatlas).
The register's row is `CLEAR` on the code licence. If that distinction matters to
counsel, the fallback is SynthSeg v1.0 for subcortical structures plus a
hand-authored cortical layer — more manual work, no new licence question.
