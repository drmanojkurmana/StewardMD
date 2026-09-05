# RadioAnatome 3D (BodyParts3D layer)

The 3D Anatomy layer INSIDE [[RadioAnatome]]: an adult-male reference body (BodyParts3D 4.0,
CC BY 4.0, packaged by Human Atlas) keyed on the SAME canonical ontology as the CT/MRI slice
modules, so a structure links both ways between a 3D mesh and the slices that pin it.

- **Flag:** `smd_atlas3d` · default **ON** (owner's 2026-09-04 no-per-device-gating order) · `?atlas3d=0` / `localStorage smd_atlas3d=0` closes it per device · `DEFAULT_ON` constant in `atlas3d.js`
- **Entry points:** "3D Anatomy" card at the top of the RadioAnatome catalog · "3D" pill on a slice sheet (only when the structure maps) · `ATLAS3D.open({canon:"KIDNEY"})` / `{region:"BRAIN"}` / `{partId:"FJ3145"}`
- **Files:** `atlas3d.js` (renderer + UI, ES5, no three.js) · `atlas3d.css` · `atlas/3d/manifest.json` (parts, concepts, systems, canon map, CT/MRI links) · `atlas/3d/index.json` (canonical → kind, 2 KB) · `atlas/3d/<system>-N.bin.gz` (27 chunks, 31.8 MB) · `atlas/3d/provenance.json`
- **Pipeline:** `atlas-pipeline/bp3d-map.json` (HAND-CURATED canonical ↔ FMA mapping) → `atlas-pipeline/bp3d_import.py --src <human-atlas checkout> --write` → `atlas-pipeline/ontology.py --write` (merges `bp3d` + the `3D` modality into `ontology.json`)
- **Provenance / licence:** `HUMAN_ATLAS_PROVENANCE.md` (repo root) — upstream commit, checksums, rejects, modifications, the verbatim CC BY attribution
- **Tests:** `test/atlas3d-data.test.mjs` (41) · `test/atlas3d-pure.test.mjs` (26) · `test/run-atlas3d-ui.mjs` (44, real headless WebGL via SwiftShader; port 8995)
- **Status (2026-09-06):** built + browser-verified; NOT yet run on a phone. Native needs `build-www` → `cap sync` → rebuild.

## Numbers

| | |
|---|---|
| Meshes imported | 2,227 of 2,234 (7 exact duplicates rejected) |
| FMA concepts | 3,432, all preserved |
| Canonical structures | 86 = 58 full mesh + 9 partial + 6 related-only + 6 container (region/system) + 7 unmapped |
| CT ↔ 3D linked | 38 canonical structures |
| MRI ↔ 3D linked | 13 |
| Triangles | 2,288,268 (upstream simplified 0.2%) |
| Bundled natively | manifest 724 KB + index 2 KB + js/css ~55 KB; geometry streamed from `stewardmd.in` |

## Gotchas

- **BodyParts3D "isa" has NO liver, lung or lung-lobe surface** — only the biliary tree,
  bronchial tree and caudate lobe. LIVER / LUNG / the four lobes are `kind: related` in the
  map: the sheet says so and never claims the mesh IS the organ. HEART is `partial` (chambers,
  atrial walls, one ventricular wall, valve leaflets; no closed surface). Do not "fix" these by
  mapping the vessel tree as the organ.
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
