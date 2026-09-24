# RadioAnatome premium pass (2026-09-25)

Branch `worktree-radioanatome-premium`. Audit that motivated it: native Living CT 3D body broken
since 2026-09-06 (R2 overwrite, fixed at the source by content-hashed chunk names in 7b174d1c6),
plus the UX gaps below. Owner's instruction: "do all fix all".

## Ownership (parallel work in ONE worktree, disjoint files, nobody but the lead runs git writes)

| Owner | Files |
|---|---|
| 3D agent | `atlas3d.js`, `atlas3d.css`, `test/atlas3d-pure.test.mjs`, `test/run-atlas3d-ui.mjs` |
| 2D agent | `atlas.js`, `atlas.css`, `test/atlas-layout.test.mjs`, new `test/run-atlas-ui.mjs` |
| Data agent | `atlas/modules.json`, `atlas/<module>/**`, new `atlas/index.json`, `atlas-pipeline/**`, `test/atlas-data.test.mjs`, `test/atlas-geometry.json`, `docs/radioanatome/ORIENTATION.md`; `atlas/3d/**` + `test/atlas3d-data.test.mjs` ONLY if it re-registers torso planes |
| Content agent | new `atlas/notes.json`, new `test/atlas-notes.test.mjs` |
| Lead | `index.html` tokens, `sw.js`, `scripts/build-www.sh`, `vault/**`, commits |

## Data contract (all fields OPTIONAL; the viewer must work when any is absent)

`atlas/modules.json`, per module:
- `hidden: true` - catalog skips it (e.g. the 0-pin cadaver brain module).
- `flipX: true` - viewer mirrors image AND pins horizontally at display time so the module reads in
  radiological convention (patient's right on the viewer's left). Data files are never flipped
  (the 3D cut planes texture the same images).
- `orient: {"left":"R","right":"L","top":"A","bottom":"P"}` - edge letters AFTER any flipX. Only
  set where the data agent VERIFIED it (mask centroids, never the header alone). Letters from
  R L A P S I. A module with unknown laterality may still carry top/bottom (e.g. S/I).
- `group: "live-torso"`, `plane: "axial"|"coronal"|"sagittal"` - modules cut from one volume.
- `windows: [{"id":"soft","label":"Soft tissue"},{"id":"lung","label":"Lung"},{"id":"bone","label":"Bone"}]`
  First entry = the existing images. Others live at `/atlas/<module>/w/<id>/NNN.webp`, same NNN
  as the slice's `img`.
- `mm: [width, height]` - physical size of the displayed image in millimetres (enables a ruler).

`atlas/<module>/atlas.json`, per slice:
- `q: [tx,ty,tz, ux,uy,uz, vx,vy,vz]` - the image in the group's shared 3D frame (metres): top-left
  corner `t`, `u` = vector along the full image width, `v` = full height. Point at image fraction
  (a,b) is `t + a*u + b*v`. Enables scout lines and plane switching at the same position.

`atlas/index.json` (search): `{"v":1,"structures":[{"s":"liver","n":"Liver","c":"viscus",
"m":[["ct-live-torso-axial",7,11]]}]}` - `m` rows are `[moduleId, bestSlice (1-based i), pinnedSliceCount]`,
best = slice where the structure has the most pins, ties to the middle. Hidden modules excluded.

`atlas/notes.json` (clinical notes, review-gated): `{"v":1,"review":"ai_drafted","notes":{"liver":
{"clinical":"...","imaging":"...","review":"ai_drafted"}}}` keyed by structure id. Shown only
behind flag `smd_atlas_notes` (default OFF, `?atlasnotes=1` / `localStorage smd_atlas_notes=1`),
with a visible "Draft, pending clinical review" badge.

## Non-negotiables
ES5 IIFEs, no build step, no new dependencies. No em dash and no emoji in app-facing text; icons
via `ico()`. Every new control has an `aria-label`; touch targets >= 44 px; respect
`prefers-reduced-motion`; safe-area insets stay where the vault note puts them. `close()` must still
call `SMD_showHome()`. No attribution/licence strings outside the info/About screens. Tests before
claims: unit tests AND a real headless-browser check for UI.
