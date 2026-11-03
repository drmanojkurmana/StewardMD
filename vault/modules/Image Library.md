# Image Library

One central image bank of every captioned image in the app, opened to learn from.
Owner request 2026-11-04: a separate Image Library in PrepNucleus and the Knowledge
Library, plus the same screen in Ophthalmós filtered to Eye, and ECGs included.

- **Entry points:** Knowledge Library home "Image Library" entry (`reasoning.js`
  `kbRenderLibrary`) · PrepNucleus subject screen "Image Library" button next to the
  atlases (`prep-imglearn.js` `subjectButton`, act `il-imglib`) · Ophthalmós Learn
  home row (`ophthalmos-learn.js` `imglibRow`, act `lnimglib`, opens filtered to Eye).
  All three call `SMD_IMGLIB.open()`; Ophthalmós passes `{ system: "eye" }`.
- **Flag + default:** `smd_imglib`, default **ON**. `?imglib=0` or
  `localStorage.smd_imglib = "0"` turns it off; every entry point hides and
  `open()` returns false. Rule lives in `image-library.js` (`enabled`).
- **Files:** `image-library.js` (`window.SMD_IMGLIB`, ES5) + `image-library.css`
  (`.igl-*`, follows `body.dark`), loaded in `index.html` at `?v=imglib1`.
- **Data (no hand copying, no image files duplicated):** `tools/build-image-library.mjs`
  reads the Knowledge Library figures (`kb/reference`, `kb/diseases` `figures[]`),
  PrepNucleus lesson images (`prep/lessons/v1` `vis.kind "image"`), the ECG library
  (`SMD_KARDIOX_CONTENT.ecgs` base + textbook pack, the same ECGs as the
  `prep-imglearn.js` ECG atlas), the Eye and PSM chart atlases (`prep/imglearn/*.json`),
  the specialty learn media (`ophthalmos/learn/media/credits.json`, Tokós, Narkē),
  licence-cleared CliniX skill images (`clinix/media/manifest.json`, cleared only) and
  the pearl figures (`prep/pearl-figs/credits.json`). It writes
  `kb/dist/imglib/index.json` plus one small file per canonical system (29 systems,
  about 3.6 MB total, largest file about 524 KB), copied by `scripts/build-www.sh`.
  Images load from their existing URLs (the `/api/prep/bank/` R2 bank, the bundled
  learn media, Wikimedia); the bank stores only src, title, caption, alt, aspect
  ratio, kind, origin, source module, credit and licence. An image with no caption
  takes its existing title, alt or finding text; no clinical text is invented.
- **Screen:** systems first (count and a sample thumbnail each), then a lazy
  thumbnail grid with search over title and caption, a "where it is from" filter,
  kind filters (ECG, X-ray, CT, MRI, ultrasound, histology, fundus, OCT and more
  where the data supports it) and a Commons versus StewardMD source filter. Tap
  opens a full-screen viewer: caption, credit, pinch zoom, double-tap zoom, swipe
  or buttons for next and previous, and a link back to the article, lesson or
  module the image comes from. Already-cached systems and images work offline.
- **Tests:** `test/image-library.test.mjs` (builder counts, src and caption on
  every entry, no duplicates, per-system sizes, pure search and filters) and the
  headless `test/run-image-library-ui.mjs` (all three entry points, grid, search,
  viewer, back, 390 px, light and dark, flag off, no uncaught error).
- **Gotchas:** source system names are free text, so the builder folds them into
  canonical specialties (`canonicalSystem` in the builder); keep substring traps
  in mind (`adrenal` contains `renal`, `developmental` contains `mental`). ECG
  tracings shared by several textbook entries are deduped by image URL. The
  Ophthalmós Learn row is a StewardMD-side edit to a synced file: its hash in
  `test/ophthalmos-sync.json` was regenerated here, and the same change must be
  ported to the Ophthalmós module repo before the next sync or it is overwritten.
