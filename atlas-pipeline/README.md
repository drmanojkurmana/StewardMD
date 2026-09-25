# RadioAnatome content pipeline

Dev-only tooling. Turns a licence-cleared volume into `atlas/<id>/atlas.json` plus a
`.webp` slice stack. **Nothing here ships to users.**

## Setup

    python3 -m venv atlas-pipeline/.venv
    atlas-pipeline/.venv/bin/pip install -r atlas-pipeline/requirements.txt
    atlas-pipeline/.venv/bin/python atlas-pipeline/test_pipeline.py    # expect ALL n PASS

## Build a module

    # 0. Check the gate and the label mapping without touching data
    atlas-pipeline/.venv/bin/python atlas-pipeline/build.py --module brain-mri-axial-t1 --dry-run

    # 1. Segment with a CLEAR model. Brain: FastSurfer, SEGMENTATION ONLY.
    #    --seg_only is what avoids needing a FreeSurfer licence. Never run the
    #    surface pipeline.
    docker run --rm -v "$PWD/atlas-pipeline/work:/data" deepmi/fastsurfer:latest \
      --t1 /data/vol.nii.gz --sid m1 --sd /data/out --seg_only

    #    Body CT instead: TotalSegmentator (Apache-2.0 code AND weights)
    # TotalSegmentator -i atlas-pipeline/work/vol.nii.gz -o atlas-pipeline/work/seg --ml

    # 2. Find the integer label values, then map the ones you want in labels/<module>.json
    atlas-pipeline/.venv/bin/python atlas-pipeline/build.py --module x \
      --print-seg-values atlas-pipeline/work/out/m1/mri/aparc.DKTatlas+aseg.deep.nii.gz

    # 3. Build, validated against the VIEWER's own schema
    atlas-pipeline/.venv/bin/python atlas-pipeline/build.py \
      --module brain-mri-axial-t1 --volume atlas-pipeline/work/vol.nii.gz \
      --seg atlas-pipeline/work/out/m1/mri/aparc.DKTatlas+aseg.deep.nii.gz \
      --slices 24 --region Brain --modality MRI \
      --title "Brain - MRI" --subtitle "Axial - T1"

    # 4. QA EVERY auto pin, and author the white matter, then re-validate
    node test/serve.mjs . 8903     # open /atlas-pipeline/atlas-author.html
    node test/atlas-data.test.mjs

## After a build: frames, windows, 3D planes, search index

    # Living modules (ct-live-torso-*, mri-brain-*): proves every module volume is an exact
    # re-indexing of its source and that the committed images reproduce byte-for-byte, then
    # writes per-slice `q`, modules.json group/plane/mm/windows, the lung + bone windows
    # (atlas/<id>/w/<win>/) and the 3D cut planes. Without --write it only verifies.
    atlas-pipeline/.venv/bin/python atlas-pipeline/living.py --work /abs/path/to/atlas-pipeline/work --write

    # Denser stacks: proves the build reproduces every shipped living module exactly, then writes
    # N-slice stacks under atlas/<id>/v2/ (old paths untouched) and redoes q, windows, planes, links
    atlas-pipeline/.venv/bin/python atlas-pipeline/living.py --work /abs/path/to/work --prove-rebuild
    atlas-pipeline/.venv/bin/python atlas-pipeline/living.py --work /abs/path/to/work --densify 48 --write

    # A NEW living CT group from one TotalSegmentator subject (fetch it first with tsd_fetch.py
    # --subject sNNNN --mask ALL). Measures the axes from the masks (prints the evidence for
    # ORIENTATION.md), re-indexes into the torso convention, cuts axial/coronal/sagittal and writes
    # 48-slice modules; then register the printed M maps in living.py and run it for the group.
    .venv/bin/python atlas-pipeline/tsd_living.py --subject s0021 --group live-neck \
        --prefix ct-live-neck --title "Neck soft tissue - CT" --work /abs/path/to/work --write
    .venv/bin/python atlas-pipeline/living.py --work /abs/path/to/work --group live-neck --write

    # Pin QA: flag outliers, render each as a crop, LOOK, record decisions in pin_fixes.tsv
    atlas-pipeline/.venv/bin/python atlas-pipeline/pin_scan.py --out /tmp/pinscan
    atlas-pipeline/.venv/bin/python atlas-pipeline/pin_fixes.py --write
    atlas-pipeline/.venv/bin/python atlas-pipeline/bp3d_import.py --relink   # 3D links follow the pins

    # Search index (test/atlas-data.test.mjs fails when it is stale)
    node atlas-pipeline/atlas-index.mjs

Orientation (`flipX`, `orient`) is hand-set from evidence recorded in
`docs/radioanatome/ORIENTATION.md`; the data test re-checks it against the pins.
Never overwrite an existing image path: images are served `immutable`, and installed apps
pair their bundled atlas.json with images fetched live. A rebuilt stack goes under a new
directory (e.g. `atlas/<id>/v2/`), and the data test checks every pre-upgrade image by hash.

## Rules this tooling enforces

- `sources.json` is a **gate, not documentation**. `require_clear()` refuses any source
  that is not verified `CLEAR`, and every entry point calls it before touching data.
- **Never install or invoke FSL.** Its licence is non-commercial and clauses (2)/(3)
  reach the *development process*, so using it to generate coordinates taints the
  output even though no FSL code ships. That also rules out JHU ICBM-DTI-81 and every
  FSL-bundled atlas.
- **FastSurfer only ever runs with `--seg_only`.** The surface pipeline needs a
  FreeSurfer licence; the segmentation modules do not.
- **Named white matter is hand-authored** in `atlas-author.html`. No attribution-free
  named white-matter atlas exists. Do not try to automate it.
- **A human must verify every auto-derived pin.** An inside-point can still be
  correctly placed on a *mislabelled* structure; only a clinician catches that. Delete
  any pin you cannot personally vouch for — a missing label is a gap, a wrong label is
  a defect.
- **Never commit volumes, masks, or model weights.**
