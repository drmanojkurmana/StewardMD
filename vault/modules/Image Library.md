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
  the pearl figures (`prep/pearl-figs/credits.json`). Plus openly licensed pathology and histology
  micrographs from Wikimedia Commons (`kb/imglib/commons-pathology.json`, made by
  `tools/fetch-commons-pathology.mjs`; owner 2026-11-04): CC BY, CC BY-SA, CC0 or public domain only, JPEG or PNG
  400 px or wider, and only files whose uploader wrote an English description (that is the caption, markup stripped,
  never rewritten). Disease tissue sits under its organ system ("Commons pathology", kinds Histopathology, Cytology,
  Immunohistochemistry, Gross specimen), normal tissue under Anatomy ("Commons histology"). The viewer shows author and
  licence and its button opens the Commons file page (`lk: "commons"`, `u` = page URL) through the Capacitor Browser,
  which is the attribution CC BY needs. Re-run the fetch to refresh; it refuses to overwrite with 40% fewer images. It writes
  `kb/dist/imglib/index.json` plus one small file per canonical system (29 systems,
  about 5.7 MB total with the Commons set, 10,199 images, largest file about 630 KB; Commons images fill each system only up to a 680 KB budget so the in-app images always fit), copied by `scripts/build-www.sh`.
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
- **Lesson and PYQ figures carry it in-line (owner 2026-11-13):** before this only the full-screen viewer did.
  `prep-lessons.js` wmImg/wmOv put the overlay on plain, spot, label and compare figures; `prep-pyq.js figure` on
  question images. `.pn-wmh` hugs the picture (`--ar` from lesson data, or set on load for PYQ) so the corner lockup
  never lands in a letterbox. Checked in `test/run-prep-lessons-ui.mjs` (step 5).
- **Watermark (owner 2026-11-11):** `image-watermark.js` overlays carry two looks and `image-viewer.css` picks by
  ancestry: inside `#smdPrep` (PrepNucleus, exists only while open) or `.igl-overlay` (this library, grid and viewer) =
  one faint centre PrepNucleus mark + the "PrepNucleus | Powered by StewardMD" lockup in the bottom right corner;
  anywhere else (Knowledge Library figures, the shared viewer opened outside PrepNucleus) = one small StewardMD logo in
  the bottom right corner. Press and hold an image (260 ms, still) fades the corner badges to 14% (`.smd-wm-peek`; the centre mark never fades), release
  restores. Gotcha: `.igl-viewer` needs its `z-index: 5; isolation: isolate`; without it the grid's thumbnail
  overlays (z-index 1) painted through the viewer as a 5 x 3 grid of PrepNucleus marks over the image and caption
  panel on iPad. Tests: `test/image-report.test.mjs`, `test/run-image-report-ui.mjs`.
- **Where to read (owner 2026-11-13):** each entry may carry `ls`/`lm`/`lsj`/`lst` (the PrepNucleus lesson that shows it,
  best title match when several reuse the image) and `ka`/`kn` (the shipped KB article holding it, via
  `kb/tools/kb-placement.mjs`). The viewer shows "Open the lesson" (Pro; paywall without) and "Read the article"
  (opens `SMD_KB.open(ka)` and scrolls to the figure); entries with neither keep the old single link.
  Test: `test/run-imglib-links-ui.mjs`. Larger entries leave a little less of each system's Commons budget.
- **Teaching animations (owner 2026-11-23):** one GIF per mechanism, shared by every module (KB, PrepNucleus, CliniX,
  Drugs, SurgX). Each is three files in `media/anim/` (owner 2026-11-24, "both"): `NAME.webp` a still poster (middle frame; the grid, strip and thumbnails stay `<img>`), `NAME.av1.mp4` (SVT-AV1 crf 32) and `NAME.mp4` (HEVC crf 24, `hvc1` tag), encoded from the Gemini GIFs at the same timing. The viewer (`playAnim` in `image-library.js`) plays a muted looping `<video>`, AV1 when `canPlayType` says so, else HEVC. About 4 to 5 times smaller than the GIFs; animated WebP was dropped because it saved only 28% and was bigger than the GIF for 45 of 311. Owner 2026-11-23: kept in Cloudflare storage. `scripts/build-www.sh` copies them, and with `SMD_REMOTE_MEDIA=1` leaves them out: `remote-media.js` then loads `/media/anim/*` from R2 `app/media/anim/` (signed-in, cached on the phone), uploaded by `tools/upload-app-media.mjs`, listed with title, caption and system in
  `kb/imglib/gifs.json`; the builder adds them as kind "Animation", from "Animations", credit "AI-generated with Google
  Gemini", licence "StewardMD original". The 3 SurgX GIFs stay in `surgx/media/` and are listed in place. Made by
  Gemini (Nano Banana keyframes, Python only to join them and write the labels) from prompts GIF1 to GIF4, topics
  ranked by how many modules mention them. GIF2, GIF3 and GIF4 are in (158 GIFs with GIF1, about 150 MB). Left out for errors: gif077 P2Y12 (platelets drawn as red cells), gif114 urinary catheter (balloon labelled in the urethra). Not yet shown inline
  inside KB articles, lessons or drug pages; that needs a topic-to-GIF lookup per module.
- **One picture bank reused by every module (owner 2026-11-23):** the builder tags every picture with the topics its
  title and caption name (KB disease and reference names and aliases, drug generics from `drugs.js` and
  `prep/figures/figures.json`, drug classes via the figure `terms` so a class picture reaches every drug in the class,
  SurgX operation titles and aliases, short picture titles, animation titles) and writes `kb/dist/imglib/topics.json`
  (about 11,700 topics, 700 KB, up to 16 pictures each; title hits before caption hits, then animation, own, Commons).
  Qualifier words ("severe", "early", "management"...) and organ words are never topics (`TOPIC_GENERIC`).
  Client: `SMD_IMGLIB.strip(host, phrases, {before, skip})` finds the longest topics named in the screen's title
  (`topicKeys`, same key rule as the builder; brackets dropped; a thin topic tops up from the shorter topic inside it)
  and draws a "Pictures and animations" row; tap opens the viewer over the module (`.igl-top`), Back closes only the
  viewer. Shown on: Drugs monograph (`api.js renderDetail`: generic + class), Knowledge Library article
  (`reasoning.js openDiseaseRef`, minus pictures the article already has), PrepNucleus lesson finished screen
  (`prep-lessons.js draw`, minus the lesson's own), CliniX topic (`clinix-screens.js renderDisease`), SurgX operation
  first section (`surgx-screens.js relatedPictures`). Test: `test/run-imglib-strip-ui.mjs`; topic unit tests in
  `test/image-library.test.mjs`.
