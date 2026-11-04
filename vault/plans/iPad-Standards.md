---
tags: [plan, ipad, layout]
---
# iPad standards (owner 2026-11-04: "fix every module page and module UI to meet iPad standards rather than make the iPhone app support iPad")

The bar is: a screen on iPad is designed for the iPad's size class, not a phone column centred on a large screen.
Everything below applies on `html.smd-tablet` (set before first paint by `index.html`, kill switch localStorage
`smd_ipad_native=0`) at **regular width, 700 px and wider**. Below 700 px (Split View, Slide Over) the phone layout is
correct and must stay as it is. Phones never get `smd-tablet`.

## Size classes we design for
| Case | Viewport (CSS px) | Notes |
| --- | --- | --- |
| iPad portrait | 820 x 1180 (also 768 x 1024, 834 x 1194) | regular width |
| iPad landscape | 1180 x 820 (also 1024 x 768) | regular width |
| iPad Pro 12.9 landscape | 1366 x 1024 | regular width |
| Split View half / third | 507 x 1024, 375 x 1024 | compact: phone layout, keep it |

## Rules
1. **Use the width.** No phone-width (560 px or narrower) content column in the middle of a regular-width screen,
   except a dialog. Lists of cards become a grid (2 columns portrait, 3 landscape, 4 on 1366 when cards are small).
   Long reading text stays a readable column (640 to 960 px), with the scroller still full width.
2. **List and detail side by side.** A module whose flow is "pick from a list, then see the item" shows a split view
   in landscape (and portrait when it fits): list column 320 to 400 px on the left, detail on the right, selection
   highlighted, no full-screen push. Drug Index already does this; it is the reference.
3. **Sheets are form sheets.** A bottom sheet that is not a full-screen task becomes a centred card 540 to 720 px
   wide (or floats above the bottom bar, as the More sheet does). Full-screen tasks use the whole screen.
4. **Bars.** A top bar spans the screen, back or close on the left, title, actions on the right. Bottom action bars
   sit within the content column or span with their buttons grouped, never a 1,300 px wide primary button.
5. **Controls keep phone sizes.** Buttons, inputs and segmented controls do not stretch edge to edge: a single
   button is its natural width (or up to 360 px), a search field up to about 720 px. Tap targets stay 44 px or more.
6. **Landscape is a real layout.** Content that fits on screen does not need scrolling because it was stacked in
   one column; welcome and hub screens lay their options out across the width.
7. **Pointer and keyboard.** Hover states only under `(any-hover: hover) and (any-pointer: fine)`. Esc closes the top
   sheet or dialog; Enter submits a single-field form. `ipad-native.js` owns the global shortcuts.
8. **No regression.** Phones (390 x 844) and Split View (507 x 1024) render exactly as before. Scope every rule under
   `html.smd-tablet` and a `min-width: 700px` media query (or a JS check of both).

## Where fixes live
- Shell (tab bar, Home, `.hv-sheet`, keyboard): `ipad-native.css`, `ipad-native.js`.
- Each module group has its own file, `ipad-<group>.css` (linked in `index.html` after `ipad-native.css`), so module
  CSS synced from another repo (Ophthalmós and others) is never edited. A behaviour change that CSS cannot do
  (a split view, a sheet that must become a dialog) goes in the module's JS behind
  `document.documentElement.classList.contains("smd-tablet")` plus a width check.
- Standalone pages (`opd.html`, `queue.html`, `followcare.html`, `wardsynq/ui/*.html`) do not load `index.html`:
  they need the same boot class snippet and their group CSS linked.

## How to check
`node test/run-ipad-module-shots.mjs "<name>=<js that opens it>" ...` screenshots each screen at the five sizes and
reports phone columns, stretched controls, clipped content and small targets. `test/run-ipad-layout-ui.mjs` is the
older width audit and must keep passing.
