# Study polish pass — report

Radius scale (stated at top of study.css): pills 999px, sheets 16px, cards 12px, chips 10px. One accent #42CDB5.

## Findings 1-10

| # | Finding | Status | Visual Verification & Notes |
|---|---------|--------|-----------------------------|
| 1 | Three rows / duplicates | Done | Visually verified in `ipad-dark-notebook-editor.png`, `iphone-dark-notebook-editor.png`: Tool row (`#stTb`) is now tools-only (zoom window, pen, eraser, highlighter, shapes, lasso, elements, image, camera, text, typing, laser) centered without duplicate undo/redo, page pill, or more menu buttons. Old duplicate header line dropped in viewer; title and navigation live cleanly in `#stP3Top`. Single page counter is `#stP3Pager` ("1 of 1"). |
| 2 | Phone top bar overflow | Done | Visually verified in `iphone-dark-editor-topbar.png`, `iphone-light-editor-topbar.png` and `iphone-dark-notebook-editor.png`: At 390px phone width, search, share, mic, and star/bookmark collapse via `.st-p3-collapse` (`display: none` ≤560px) and are accessible under the `...` More sheet (`.st-p3-phone-only`). Back, grid, title, undo, redo, add page, and more menu fit comfortably with full ≥44px touch targets. |
| 3 | Two selection UIs | Done | Visually verified in `ipad-dark-p2-selection.png`, `iphone-dark-p2-selection.png`: Lasso shows ONE compact horizontal pill bar anchored above/below selection: Cut · Copy · Delete · Duplicate · Color · More(›). AI chips (Explain, Key summary, Make deck) sit as a slim secondary row in that same bar. More popover cleanly houses Resize, Rotate, Take screenshot, Convert to text, Save as element, and Done. Phase 4 item bar is suppressed whenever lasso is active (`.st-lasso-on`). |
| 4 | Crop for shapes | Done | Visually verified in `ipad-dark-image-crop.png`, `iphone-dark-image-crop.png`: Crop overlay triggers only for images (`item.kind === "image"`), with `startCrop` refusing non-images. No Crop button exists on shape strokes or lasso bar. |
| 5 | Shape solid white box | Done | Visually verified in `ipad-dark-p2-shapes.png`, `iphone-dark-p2-shapes.png`: Shapes render outline-only by default without opaque white fill occluding content. Fill 25% uses `globalAlpha = 0.25` tinted with the stroke colour. |
| 6 | Truncated strips | Done | Visually verified in `iphone-dark-p2-lasso-settings.png`, `iphone-light-p2-lasso-settings.png`: Short toggle chips (Ink, Highlighter, Shapes, Images, Text) display without truncation at 390px. Active state is conveyed by chip style and `aria-pressed`, without noisy "on/off" text or trailing explanatory sentences. Shapes strip uses clean chips: Outline, Fill 25%, Snap. |
| 7 | Study Assistant covers page | Done | Visually verified across phone captures: Bottom-of-canvas Assistant box is removed from editor view, restoring 100% full height to the notebook canvas. Study AI actions (Explain this page, Key summary, Make deck) are housed cleanly in Notebook options (More menu). |
| 8 | Debug copy | Done | Verified: "Pages · thumbs" replaced with plain "Pages". Audited all UI labels for concise, consistent terminology ("Color", "Duplicate", "Notebook options", "Save as element"). |
| 9 | Menu icons | Done | Visually verified in `iphone-dark-more.png`, `ipad-dark-more.png`: Every menu row has a distinct, correct line icon matching the 2px stroke icon family (Search, Share, Mic, Star/Bookmark, Page, Sliders/Gear, Rotate, Template). |
| 10 | Consistency pass | Done | Verified: Stated radius scale (pills 999px, sheets 16px, cards 12px, chips 10px) and single accent `#42CDB5` applied across Phase 1-4 chrome. 44px minimum touch targets, 0.97 active press scale, focus-visible outlines, reduced-motion compliance, and legible dark/light mode contrast across all sheets and popovers. |

## Tests

### Unit Suite
`node --test test/study*.test.mjs`
```
✔ 1.4 pressure: 0% constant, 100% doubles under hard press (4.857291ms)
✔ 1.2/1.3 pen styles: fountain tapers, ball even, brush heavy taper (0.473708ms)
✔ 1.9 split: erasing the middle of a stroke gives two pieces, ends and no-touch keep it whole (0.680708ms)
✔ 1.8 straight snap: hold gate at 500ms and snap keeps only the ends (0.164084ms)
✔ 1.16/1.17 palm and finger: pen draws, touch pans once a pen was seen, finger draws before that (0.114167ms)
✔ 1.5/1.6 settings: defaults, per-tool width, recent colours capped at 5, hex check (0.305333ms)
✔ latency outline: 500-point stroke outlines without dropping points (2.745958ms)
✔ makeItem: constructs valid item record with page-relative coordinates (3.535542ms)
✔ moveItemGeom: moves item and clamps to page bounds 0..1 (0.089875ms)
✔ resizeItemGeom: handles corner handles and enforces min dimensions (0.07975ms)
✔ rotateItemGeom: sets angle and snaps to cardinal angles (0, 90, 180, 270) (0.049041ms)
✔ compressDimensions: preserves small images, scales down large images to 2048px (0.054458ms)
✔ laserFilterPoints: discards points older than 1000ms (0.046ms)
✔ laserFadeAlpha: computes linear fade opacity over 1s (0.034208ms)
✔ text styles and system fonts: Title, H1, H2, Body definitions (0.035666ms)
✔ stickers library: contains required medical icons, arrows, and callouts as inline SVG (0.068542ms)
✔ sticker labels: provides human-readable labels for all elements (no raw ids) (0.091042ms)
✔ shape fitter: 12 noisy samples each, at least 11 of 12 correct (90%+) (9.620334ms)
✔ shape fitter: 20 handwriting samples have 0 false snaps; small dots never snap (1.255ms)
✔ fitForced never returns null for 3+ points (Shapes tool snaps every stroke) (0.886417ms)
✔ shapePts outline round-trips through the fitter for every shape type (0.44825ms)
✔ bbox, translate and scale: line width follows the scale factor (0.692542ms)
✔ rotate 90 twice is 180; clamp keeps ink on the page (0.259334ms)
✔ xform snapshots: applySnap restores before, redo reapplies after (0.312042ms)
✔ clipboard: encode/decode round trips, bad JSON and wrong version rejected (0.811709ms)
✔ lasso settings: highlighter can be excluded, pen and shapes stay (0.498667ms)
✔ handles: corners proportional, sides stretch, centre inside (0.399208ms)
✔ pickGesture: flat selection centre moves, corner resizes, degenerate axis never explodes (0.376167ms)
✔ pickGesture: tall box interior moves, edge dots resize, outside is null (0.172333ms)
✔ dwell gate: snap only at 500ms and only when enabled (0.092584ms)
✔ nearStroke finds shape outlines and misses far points (0.0855ms)
✔ templates: labels, dark detection, list covers required set (1.624958ms)
✔ addIndex: before/after/last (0.153208ms)
✔ insertAt/removeAt: does not mutate (0.400083ms)
✔ rotateStep: 90deg cycle (0.0605ms)
✔ zoom: clamp 50-400% (0.066625ms)
✔ fav: toggle per page, isFav (0.081334ms)
✔ outline flatten + filter (0.102334ms)
✔ visibleRange: lazy near viewport, no gaps (0.065959ms)
✔ fitWidth: double-tap fit (0.059791ms)
✔ flag: default off, needs prep, ?study overrides storage (1.0065ms)
✔ page-relative transform round trips at any zoom (0.699333ms)
✔ eraser hit: near a segment hits, far misses, single point works (0.450583ms)
✔ undo and redo: add, erase, redo cleared by a new op, empty stack (0.255833ms)
✔ stack is capped at 200 and survives a JSON round trip (0.2725ms)
✔ pressure: pen value kept, 0 or other pointer types fall back to 0.5 (0.119083ms)
✔ page order: move up and down, ends stay put, input not mutated (0.17925ms)
✔ page backgrounds: blank empty, ruled rows, grid squares, Cornell margin and summary, dotgrid points (0.603667ms)
✔ lasso: point in polygon and stroke containment (0.245417ms)
✔ scribble detection: fast back-and-forth zig-zag detected, line or circle is not (0.241084ms)
✔ scribble P0: 40 handwriting strokes over notes never erase (1.237833ms)
✔ scribble P0: 20 fast dense scribbles over ink erase; same scribble on blank paper does not (4.07425ms)
✔ scribble P0: erase covers only crossed strokes, a dot 15 px away survives (1.191916ms)
✔ snippet: case-insensitive, highlight split, ellipsis at cut ends, no match is null (0.20325ms)
✔ indexing label: shown until every page is done (0.042292ms)
✔ A7 page range: empty is the page on screen, typed ranges use Layer C's parser and cap (2.448708ms)
✔ A7 source ref: items and cards made from a Study Studio document carry std, others are unchanged (4.313ms)
✔ A8 zip: the streaming writer round trips every file, stored without compression (3.341792ms)
✔ A8 backup verify: a good backup passes with its records (1.472959ms)
✔ A8 backup verify: a tampered byte inside the zip is refused (sha256 mismatch) (0.655709ms)
✔ A8 backup verify: wrong record count, wrong size, extra file, missing manifest, record vs file sha (1.407834ms)
✔ A8 restore plan: skip by id or sha256, add the rest, never touch what exists (0.191125ms)
ℹ tests 62
ℹ pass 62
ℹ fail 0
```

### Real-Browser UI Suite
`node test/run-study-ui.mjs`
```
PASS flag off: no Study tab
PASS flag off: study.js is not even loaded
PASS flag on: the Study tab shows
PASS library: empty state
PASS library: imported PDF listed with 2 pages
...
PASS P2 menu: Cut, Duplicate, Resize and More actions present
PASS P2 move: selection lands where dropped
PASS P2 move: exactly one undo step
PASS P2 move: undo restores the position
PASS P2 move: redo reapplies the position
PASS P2 resize: handle drag scales the selection proportionally
PASS P2 resize: undo restores the size
PASS P2 colour: selection takes the picked colour
PASS P2 colour: undo restores the old colour
PASS P2 rotate: 90 degrees applied as one undo step
PASS P2 rotate: undo restores the rotation (within clamping)
PASS P2 screenshot: action runs and closes the panel
PASS P2 duplicate: copy appears
PASS P2 duplicate: one undo removes the copy
PASS P2 duplicate: redo brings it back
PASS P2 clipboard: copy persists in localStorage
PASS P2 cut: removes the selection in one undo step
PASS P2 cut: undo brings it back
PASS P2 paste: copied stroke pastes onto page 2
PASS P2 paste: one undo removes the paste across pages
PASS P2 shapes: wobbly circle becomes a circle
PASS P2 shapes: optional fill colour at 25% opacity
PASS P2 draw and hold: held circle snaps to a perfect shape
PASS P2 convert: clearly labelled server stub
...
PASS P3 top bar: GoodNotes-style top bar and page counter are present
PASS P3 top bar: counter 1 of 1
PASS P3 top bar: grid, search, share, mic, add icons exist
PASS P3 Add: Before/After/Last segmented control
PASS P3 3.1: ruled page added before page 1 (n=2)
PASS P3 3.2/3.3: template change keeps the ink
PASS P3 3.4: More menu has Copy, Rotate, Outline, Change Template, Go to Page, Clear
PASS P3 3.4: Copy Page duplicates page + strokes
PASS P3 3.4: Rotate Page updates rotMap (90° steps)
PASS P3 3.9: Add Page to Outline adds user entry
PASS P3 3.8: Bookmark star stores favPages
PASS P3 3.8: Favorites tab lists starred pages
PASS P3 3.8: starred page jumps on tap
PASS P3 3.7: thumbnails render page + strokes (not blank)
PASS P3 3.9: Outlines filter finds user chapter
PASS P3 3.5: Settings scrolling direction persists per notebook
PASS P3 3.10: pinch zoom 50-400% via setZoom
PASS P3 3.10: zoom clamped to 400%
PASS P3 top bar: tapping page counter opens Go to Page and jumps
PASS P3 3.11: Zoom window strip element present
PASS no uncaught page error 

ALL PASSED
```

## Screenshots Generated
Captured via `node test/capture-study-shots.mjs after` for:
- Devices: `iphone` (390x844, 2x), `ipad` (1024x768, 2x)
- Themes: `dark`, `light`

Outputs in `.fleet-reports/study-ui/after`:
- `*-study-home-empty.png`, `*-study-home-items.png`, `*-search-results.png`, `*-backup.png`
- `*-notebook-editor.png`, `*-colour-width-popover.png`
- `*-text-format-bar.png`, `*-text-style-sheet.png`
- `*-sticker-tray.png`, `*-sticker-on-page.png`
- `*-image-with-handles.png`, `*-image-crop.png`
- `*-laser-trail.png`, `*-lasso-ai-chips.png`, `*-lasso-ai-explain-sheet.png`
- `*-p1-pen-popover.png`, `*-p1-highlighter-strip.png`, `*-p1-eraser-popover.png`
- `*-p2-lasso-settings.png`, `*-p2-selection.png`, `*-p2-color.png`, `*-p2-shapes.png`
- `*-page-sheet.png`, `*-pdf-viewer.png`

Outputs in `.fleet-reports/study-p3`:
- `*-editor-topbar.png`
- `*-add-page.png`
- `*-more.png`
- `*-navigator.png`
- `*-favorites-empty.png`

## Known Issues
- None blocking. Lasso bar anchoring is computed dynamically on selection bounding box; it stays anchored to current selection.
