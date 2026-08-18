# RadioAnatome

Educational cross-sectional anatomy atlas. Scroll a stack of labelled slices, tap a
structure, read its definition. Interaction modelled on e-Anatomy (IMAIOS); content
built only from licence-cleared sources.

- **Entry points:** Home tile `atlas` · sidebar row `RadioAnatome` · `stewardmd://atlas` · `ATLAS.open(moduleId?)`
- **Files:** `atlas.js`, `atlas.css`, `atlas/modules.json`, `atlas/<id>/atlas.json`, `atlas/<id>/NNN.webp`
- **Pipeline:** `atlas-pipeline/` (dev-only, never shipped)
- **Spec:** `docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md`
- **Plans:** `docs/superpowers/plans/2026-08-17-anatomy-atlas-viewer.md` · `…-pipeline.md`
- **Tests:** `test/atlas-layout.test.mjs` (74) · `test/atlas-data.test.mjs` (143) · `atlas-pipeline/test_pipeline.py` (203)
- **Modules:** 10 — head/thorax/abdomen CT in axial + coronal + sagittal (1249 verified pins), plus brain T1 MRI images awaiting authoring

## Gotchas

- **Display name is RadioAnatome; internal identifiers are `atlas`.** `window.ATLAS`,
  `atlas.js`, `/atlas/` paths, `data-atlas-act`, `.atlas-*` CSS and `#smdAtlas` all keep
  the short name deliberately — renaming them is churn with no user benefit.
- **`close()` must call `SMD_showHome()`.** `open()` calls `SMD_hideHome()`; skipping the
  restore strands the user on a blank page. Same reason Ward Sync does it — see the
  `SMD_showHome` comment in `home.js`.
- **Pin `x`/`y` are percentages of the IMAGE box, not the viewport and not the stage.**
  `overlaySvg` converts them to stage space *before* `layoutGutter`, or every label
  drifts by the letterbox offset and the leader lines fan out diagonally.
- **Duplicate structure ids within one slice are intentional** — that is how bilateral
  structures highlight together. Selection is keyed on structure id.
- **Slice `.webp` files are NOT bundled into the native app** (~2 MB/module). `imgUrl()`
  rewrites `/atlas/*` to `https://stewardmd.in` when `SMD_IS_NATIVE`, mirroring
  `kardiox-screens.js` `kxImg()`. `scripts/build-www.sh` copies only the JSON — it is an
  explicit allowlist, so a new directory silently does not ship.
- **`ICONS.get` returns a truthy EMPTY `<svg>` for an unknown name**, so
  `ico(x) || "fallback"` renders an invisible button. `ico()` consults `has()` first.
- **The local `esc()` escapes quotes** (the house copy in `onco-home.js` does not), and
  `cssUrl()` percent-encodes CSS-breakout characters — a bare `)` closes `url()`
  regardless of HTML escaping.
- **`ResizeObserver` does not fire in headless/CDP panes at all** (verified with a control
  observer). A `window.resize` listener runs alongside it so the repaint path is
  verifiable in CI.
- **No attribution, licence or source string may be rendered** except the curated
  `modules.json.credits` lines on the info screen. `provenance` in each `atlas.json` is an
  audit trail only — it contains internal tooling paths.
- **The selected label's white pill is `paint-order: stroke`**, not a second element.


## Content status (2026-08-18)

Nine CT modules across three planes, all real Visible Human data, **1249/1249 pins
verified inside their own structure**. The brain module ships real T1 images with the
full 23-structure palette and **zero pins** — see below.

**Reformats are free.** `vhp_volume.py reformat` transposes image and label mask
identically and keeps the `[display-col, display-row-increasing-UP, slice]` convention
that `orient.to_display()` consumes, so the whole pipeline runs on a reformatted volume
unchanged. One region → three modules. Superior is up in both new planes; sagittal puts
anterior left. `build.py --labels` lets the three planes share one mapping file.

**What the data refuses to give, all measured not guessed:**
- lung lobes — lung is −540 to −570 HU here vs −700 to −850 live (never-inflated cadaver
  lungs); soft tissue reads +49 HU so calibration is fine
- liver/spleen/kidney — one undifferentiated 25–90 HU band, so TotalSegmentator found
  bowel, muscle, vertebrae, aorta and no solid organs
- left vs right — two landmarks disagree on this cadaver (8% margin, flips sign)
- brain labels — **SynthSeg was run** and produced only cortex+WM, ~2× asymmetric, most
  of the brain unlabelled: a 33-slice 4 mm stack is not the 3D T1 it needs. Evidence:
  `docs/superpowers/specs/2026-08-17-synthseg-brain-failure.png`
- rib/vertebral levels — position cannot number them

**Running TotalSegmentator on 8 GB:** it OOMs in its final resample step, not inference
(20 s). Pre-resample to 3 mm yourself, segment there, nearest-neighbour the MASK back to
full resolution. `--roi_subset` cuts inference from ~8 min/pass to 20 s.

**Running SynthSeg at all:** needs Python 3.11 + TF 2.15 + Keras 2.15 (bare
`import keras` in 30 places, so TF_USE_LEGACY_KERAS is not enough), plus patches for
`np.int` (removed in numpy 1.24) and Keras returning a list from `Model.output`.
`--crop 176 --threads 2` to fit 8 GB.

**Process:** never run the self-checks as `... | tail -1` — the pipe returns tail's exit
code and a failing test looks green.
