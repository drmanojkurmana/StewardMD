# RadioAnatome 3D (BodyParts3D layer)

The 3D Anatomy layer INSIDE [[RadioAnatome]]: TWO bodies on the SAME canonical ontology as the
CT/MRI slice modules, so a structure links both ways between a 3D mesh and the slices that pin it.
- **Reference body** (BodyParts3D 4.0, CC BY 4.0, packaged by Human Atlas): 2,227 meshes, whole body.
- **Living-patient CT body** (added 2026-09-06): 38 organ surfaces meshed from the expert
  TotalSegmentator masks of subject s0108, the SAME scan the three `ct-live-torso-*` modules show.
  A slice opened from those modules lands on this body with the CT image drawn as a textured cut
  plane through the meshes at exactly that level (72 registered planes); a slider walks the slices.

- **Flag:** `smd_atlas3d` · default **ON** (owner's 2026-09-04 no-per-device-gating order) · `?atlas3d=0` / `localStorage smd_atlas3d=0` closes it per device · `DEFAULT_ON` constant in `atlas3d.js`
- **Entry points:** "3D Anatomy" card at the top of the RadioAnatome catalog · "3D" pill on a slice sheet (only when the structure maps) · `ATLAS3D.open({canon:"KIDNEY"})` / `{region:"BRAIN"}` / `{partId:"FJ3145"}`
- **Files:** `atlas3d.js` (renderer + UI, ES5, no three.js) · `atlas3d.css` · `atlas/3d/manifest.json` (parts, concepts, systems, canon map, CT/MRI links, `sources`, `planes`, `lod`) · `atlas/3d/index.json` (canonical → kind, 2 KB) · geometry chunks: `<system>-N.bin.gz` (27 reference, 31.8 MB) · `<system>-N.lo.bin.gz` (20 reference LOD at 60% of the triangles, 19.6 MB) · `live-<system>-N.bin.gz` (11 living-CT, 4.5 MB) · `atlas/3d/live.json` + `lod.json` (pipeline outputs merged by the importer) · `atlas/3d/provenance.json`
- **Hosting:** geometry is served from the R2 bucket `stewardmd-models` under `atlas3d/` at `https://models.stewardmd.in/atlas3d/<file>` (`R2_BASE` in `atlas3d.js`; `dataBases()` tries same-origin first, then R2). Upload with `npx wrangler r2 object put stewardmd-models/atlas3d/<file> --file atlas/3d/<file> --content-type application/gzip --remote` for every `*.bin.gz` after a pipeline run. The files are ALSO committed (repo = source of truth; Pages serves them same-origin on the web).
- **Pipeline:** `atlas-pipeline/bp3d-map.json` (HAND-CURATED canonical ↔ FMA mapping) → `atlas-pipeline/bp3d_import.py --src <human-atlas checkout> --write` → `atlas-pipeline/ontology.py --write` (merges `bp3d` + the `3D` modality into `ontology.json`). Living body: `atlas-pipeline/live3d.py --work atlas-pipeline/work/tsd --out <dir>` (marching cubes on the masks + slice-plane registration; needs the `.venv` with nibabel/scipy/skimage and the downloaded s0108 volumes) → `node atlas-pipeline/pack3d.mjs live --in <dir> --out atlas/3d --base 2227` (meshoptimizer simplify + pack) → `bp3d_import.py --write` picks up `live.json`. LOD: `node atlas-pipeline/pack3d.mjs lod --out atlas/3d` (writes `lod.json` + `*.lo.bin.gz`), then `bp3d_import.py --write`.
- **Provenance / licence:** `HUMAN_ATLAS_PROVENANCE.md` (repo root) — upstream commit, checksums, rejects, modifications, the verbatim CC BY attribution
- **Tests:** `test/atlas3d-data.test.mjs` (55) · `test/atlas3d-pure.test.mjs` (33) · `test/run-atlas3d-ui.mjs` (60, real headless WebGL via SwiftShader; port 8995)
- **Status (2026-09-06):** built + RUN ON THE iPhone 15 Pro (build a3d8, iOS 27). Living body (66 parts: organs + skeleton + skin shell) streams in ~2 s from R2, 60 fps, cut planes register on the meshes, no JS errors. Reinstall after each web change: `build:www` → `cap copy ios` → rebuild `App` scheme → `devicectl uninstall` + `install` (wipes device-local data).

## Numbers

| | |
|---|---|
| Meshes imported | 2,227 of 2,234 (7 exact duplicates rejected) |
| FMA concepts | 3,432, all preserved |
| Canonical structures | 86 = 58 full mesh + 9 partial + 6 related-only + 6 container (region/system) + 7 unmapped |
| Living-CT surfaces | 66 = 38 organs/vessels/muscles + 27 skeleton (T10-L5+S1, sacrum, lower ribs, hip bones, femurs) + 1 body-surface shell; 6.7 MB gz |
| Registered slice planes | 72 = 24 × 3 living-torso modules (axial: 19/22 confident slices on a linear fit, rest interpolated; coronal/sagittal 24/24) |
| CT ↔ 3D linked | 43 canonical structures (38 before the living body) |
| MRI ↔ 3D linked | 13 |
| Triangles | 2,288,268 (upstream simplified 0.2%) |
| Bundled natively | manifest 724 KB + index 2 KB + js/css ~55 KB; geometry streamed from `stewardmd.in` |

## Gotchas

- **BodyParts3D "isa" has NO liver, lung or lung-lobe surface** — only the biliary tree,
  bronchial tree and caudate lobe. LIVER / LUNG / the four lobes are `kind: related` in the
  map: the sheet says so and never claims the mesh IS the organ. HEART is `partial` (chambers,
  atrial walls, one ventricular wall, valve leaflets; no closed surface). Do not "fix" these by
  mapping the vessel tree as the organ.
- **The living body needs a frame to read as a patient.** As shipped first it was ~38 organs
  floating in black (rated 0.5/10). `live3d.py` now also meshes the skeleton from the s0108
  masks (bones under 400 voxels are scan-edge fragments, skipped) and a body-surface shell by
  thresholding the CT (HU > -350). The skin is drawn as a translucent OUTLINE in its own render
  pass (a Layers > Body outline switch, `st.shell`), faded out over the scan's cut top/bottom
  edges so it reads as a body, not a tube. Small bowel / colon / duodenum are hidden by default
  (`LIVE_BOWEL` in `atlas3d.js`, a Layers > Bowel switch), the way the reference body hides
  muscles + skin, because they wrap every organ from the front.
- **iOS WebKit redraw gotchas (all fixed, worth knowing).** (1) A chunk or the slice image that
  finishes loading AFTER the open camera glide settled must schedule its own frame — the code
  calls `invalidate()`/`settleFrames()`, never a bare `st.dirty = true`. (2) The slice texture
  must upload on texture unit 1 and rebind the state texture on unit 0; leaving the slice image
  on unit 0 made the vertex shader read it as part state and discard every mesh (the user saw a
  bare CT slice with no organs). (3) `requestAnimationFrame`-driven redraws still presented the
  stale frame on iOS 27, so `settleFrames()` redraws from `setTimeout` callbacks at 60/250/700/
  1500 ms via a direct `tick()`. Debug these with `test/ios-webkit-cdp.mjs` + `Page.snapshotRect`
  over USB; a frame read back by `readPixels` can be correct while the presented frame is stale,
  so screenshot, don't just sample pixels.
- **The living-CT body fills the BodyParts3D organ gap**: a
  `related`-only structure with a living surface auto-switches to the Living CT source
  (`partsForCanon` in `atlas3d.js`), so selecting LIVER shows a real liver.
- **Living-volume axes were MEASURED, not read from the header.** The s0108 NIfTI affine says
  RAS, but the liver mask sits at z≈50 and the prostate at z≈254: z index 0 is SUPERIOR. +x is
  the patient's right (liver x≈200, spleen ≈70), +y anterior (bladder vs spinal cord). The viewer
  frame is BodyParts3D's: +x = patient LEFT (its left kidney is at +x), so `live3d.py` negates x
  and flips the marching-cubes winding (three reflections). Re-check with mask centroids, never
  with `aff2axcodes`, if the source volume ever changes.
- **The coronal/sagittal `live_*_seg.nii.gz` are transposed CROPS with in-slab flips**
  (coronal: z reversed; sagittal: y and z reversed), recovered by exact slab equality on two
  labelled slabs (edge slabs are empty and match everything, which mapped every slice to index 0
  in the first attempt). `plane_for()` derives each plane's `tl/u/v` from the SAME display chain
  the pipeline draws with (`to_display = flipud(slab.T)`), so texture and meshes coincide.
- **The living-torso 2D modules show the patient's RIGHT on the image's RIGHT** (liver at column
  205 of 277 in the displayed coronal slab; `orient.to_display` keeps X unflipped), i.e. NOT
  radiological convention. Pins are unaffected and no side is asserted, but a radiologist expects
  the liver on the image left. Pre-existing, logged in [[Roadmap]]; the 3D cut plane shows the
  slice in true 3D orientation, so from the front the liver is on the viewer's left there.
- **Cut plane rendering:** `clipPlane()` discards the half of the body on the camera's side of
  the plane, the slice quad is drawn at 88% alpha, then the SELECTION is redrawn as a 42% ghost
  with depth test off (pass 3), so the selected structure stays readable through the slice
  (without it a coronal cut hid the liver entirely).
- **LOD:** `*.lo.bin.gz` (meshoptimizer `simplify`, 60% triangles, error 0.004) is the default on
  touch devices (`isTouch()`), full detail on desktop; the Layers panel switch persists in
  `localStorage smd_atlas3d_lod`. Only the reference body has an LOD set; the living body is
  4.5 MB as is.
- **Search is unified:** a query lists the RadioAnatome structure (CT/MRI) first, then FMA
  concepts, then meshes; the pure test pins that order.
- **Human Atlas mis-files brain ventricles as `cardiac`** (and choroid plexus / flexor
  retinacula / lacrimal bones under `sensory`). `bp3d-map.json._system_corrections` relabels 11
  parts on import; `test/atlas3d-data.test.mjs` asserts the ventricles are nervous.
- **Names do not match across vocabularies.** TotalSegmentator `autochthon` = FMA iliocostalis +
  longissimus + spinalis + semispinalis; SynthSeg `ventral DC` has no FMA id; our COLON has no
  sigmoid in BP3D. Every row in `bp3d-map.json` was chosen by reading the concept's element
  list — never add a row by name similarity.
- **Laterality lives only on the 3D side.** RadioAnatome asserts no side (Visible Human), so
  the canonical id stays unsided (KIDNEY) and the map carries `left`/`right` FMA children; the
  sheet offers Left / Right / Both pills. Do not mint KIDNEY_LEFT in the ontology for this.
- **No three.js, on purpose.** The app is buildless ES5; three.js is ESM-only since r160 and
  ~650 KB. The WebGL1 renderer in `atlas3d.js` needs `OES_element_index_uint` and vertex texture
  fetch (both universal on iOS/Android WebViews). Picking is a colour-ID render pass +
  `readPixels`, not CPU raycasting.
- **Selection uses a two-pass ghost render** (selection opaque, everything else at 16% alpha
  with depth writes off) so an organ behind the colon is visible when the CT side highlights
  it. Without it the kidney selection was invisible from the front.
- **Muscles and skin are OFF by default** (muscular = 20 MB raw / 656k triangles; skin occludes
  everything). Layers panel turns them on and lazy-loads their chunks.
- **Geometry is NOT in the native bundle and NOT in the SW cache.** `build-www.sh` copies only
  the two JSONs; `dataUrl()` rewrites `/atlas/3d/*.bin.gz` to `https://stewardmd.in` natively;
  `sw.js` skips those paths so a CACHE bump never re-downloads 31 MB.
- **`.bin.gz` may arrive raw or gzipped** depending on the host's Content-Encoding; `inflate()`
  accepts both by comparing the byte length to `chunk.bytes`. Needs `DecompressionStream`
  (iOS 16.4+, Chrome 80+); otherwise the layer shows an error, never a blank canvas.
- **Attribution renders ONLY on the 3D About screen** (same rule as the atlas info screen), and
  the string must stay verbatim: "BodyParts3D, © The Database Center for Life Science licensed
  under CC Attribution 4.0 International" (licence page mandates it). The UI test asserts it
  appears exactly once.
- **`ATLAS.back()` delegates to `ATLAS3D.back()` first**, so swipe-back / Escape unwind About →
  Layers → search results → sheet → 3D layer → then the atlas. `ATLAS.openAt(module, sid, slice)`
  is the deep link the 3D rows use; it LOCKS the structure.
- **The 3D sheet has no drag-to-resize** (atlas.js's `bindSheetDrag` is file-local); tapping the
  grab handle or the title toggles `.full`. Peek height is 330 px so CT/MRI rows show.
- **Headless test needs SwiftShader flags** (`--use-angle=swiftshader --enable-unsafe-swiftshader`);
  with `--disable-gpu` alone WebGL is absent and every 3D check fails. A render+pick pass is
  ~600 ms there; that is software GL, not a device number.
