# RadioAnatome

Educational cross-sectional anatomy atlas. Scroll a stack of labelled slices, tap a
structure, read its definition. Interaction modelled on e-Anatomy (IMAIOS); content
built only from licence-cleared sources.

- **Entry points:** Home tile `atlas` · sidebar row `RadioAnatome` · `stewardmd://atlas` · `ATLAS.open(moduleId?)`
- **Files:** `atlas.js`, `atlas.css`, `atlas/modules.json`, `atlas/<id>/atlas.json`, `atlas/<id>/NNN.webp`, `atlas/<id>/w/<window>/NNN.webp` (CT windows), `atlas/index.json` (search), `atlas/notes.json` (review-gated clinical notes)
- **Pipeline:** `atlas-pipeline/` (dev-only, never shipped); `living.py` is the exact reproduction of the torso/brain chain; `atlas-index.mjs` writes the search index
- **Spec:** `docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md` · premium pass contract `docs/radioanatome/PREMIUM_PLAN_2026-09-25.md` · orientation evidence `docs/radioanatome/ORIENTATION.md`
- **Plans:** `docs/superpowers/plans/2026-08-17-anatomy-atlas-viewer.md` · `…-pipeline.md`
- **Tests:** `test/atlas-layout.test.mjs` (178) · `test/atlas-data.test.mjs` (490) · `test/atlas-notes.test.mjs` (11) · `test/run-atlas-ui.mjs` (147, real headless CDP touch; localhost:8996, Chrome port 9388) · `atlas-pipeline/test_pipeline.py` (283)
- **Modules:** 30 in `modules.json`, 29 visible (`brain-mri-axial-t1` is `hidden`: cadaver T1 with 0 pins)
- **Flags / storage:** `smd_atlas_notes` (default OFF; `?atlasnotes=1`) · `smd_atlas_labels` · `smd_atlas_recent` · `smd_atlas_bookmarks` · `smd_atlas_offline` · offline caches `atlas2d-<id>`
- **3D layer:** [[RadioAnatome 3D]] — BodyParts3D reference body on the same ontology; "3D Anatomy" card in the catalog, "3D" pill on a slice sheet, `ATLAS.openAt(module, sid, slice)` deep link used by its CT/MRI rows, `ATLAS.back()` unwinds the 3D layer first

## Premium pass (2026-09-25, branch `worktree-radioanatome-premium`)

Audit measured the slice at 219x190 px on a 390x844 phone (gutter labels ate the width) with one
label per PIN. Now: Pins / Labels / Off modes (Pins default on narrow portrait, slice fills the
width), one label per structure, pinch-zoom/pan/double-tap, momentum scrub, cine, Name it / Find it
quiz, mm ruler, CT lung/bone windows (torso), radiological flip + verified edge letters, search
across modules, recents, bookmarks, per-module offline download, Axial/Coronal/Sagittal switch at
the same point with a scout line, tablet side panel, review-gated Clinical tab.

## Gotchas

- **Image paths are immutable. Never rewrite the bytes of an existing `.webp`.** `_headers` serves
  `/*.webp` immutable for a year and installed apps bundle their own `atlas.json` while fetching
  images from stewardmd.in, so a changed picture pairs old pins with a new image. `slices.py`
  refuses to do it; new stacks go under `atlas/<id>/v2/`; a test pins every pre-upgrade blob.
- **Orientation is display-time only** (`flipX`/`flipY` in `modules.json`, from
  `docs/radioanatome/ORIENTATION.md`). The 3D cut planes texture the same unflipped files. Letters
  only where anatomy proved them; no cadaver module asserts R/L. Knee/foot/hand sources are stored
  rotated 180 degrees relative to every other module.
- **The app's Display setting zooms the whole document** (`home.js` `applyD` sets
  `documentElement.style.zoom`). All pointer maths goes through `stageScale`/`stagePt`, or taps land
  off by that factor.
- **A pointer whose `pointerup` never arrives** used to turn later one-finger drags into a phantom
  pinch; a new primary pointer starts a fresh gesture.
- **`SHEET_PEEK` in atlas.js must equal the peek height in atlas.css (170 px).** Labels are laid out
  in the stage the sheet leaves visible.
- **`dialog-motion.js` animates every `.sheet` in from opacity 0.7**, which made the footer bleed
  through; atlas.css pins `opacity: 1 !important` on the sheet.
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
- **The overlay is `fixed; inset:0`, so it inherits NO safe-area padding.** `.atlas-top`
  carries `env(safe-area-inset-top)` and `.atlas-foot`/`.atlas-scroll`/`.atlas-sheet-body`
  carry `env(safe-area-inset-bottom)` — every screen (catalog, viewer, grid, info) is built
  from those same classes, so that is the only place the insets belong. Without them the
  header renders under the iPhone status bar (fixed 2026-08-27).


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
