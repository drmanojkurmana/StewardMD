# Home tools rearranging

September 2026: `home.js` owns home-grid and Customize-tools list ordering. Saved order uses `smd_home_tools_order`; visibility uses `smd_home_tools`. Unknown/new tools retain default placement and hidden tool IDs are retained when the visible grid is reordered.

- Hold for 450ms to lift an icon. Movement beyond 9px before activation cancels the hold, allowing ordinary scrolling. Edit also enters rearranging mode directly.
- A fixed floating copy follows the finger, with a dimmed original retaining the grid slot. Two-dimensional slot selection and short neighbor animations support horizontal and vertical movement. Edge holding scrolls the nearest scroll container.
- Done explicitly ends editing. Drag release suppresses its synthesized click and leaves edit mode active. Pointer cancellation/blur restores the pre-drag order and removes listeners/ghosts. Secondary touches cancel a drag.
- Edit plus arrow keys rearranges focused tools; Escape exits. Reduced-motion disables neighbor animation and jiggle.
- No clinical actions or eligibility flags change. Native devices require a new bundle or an authorized OTA release.

Verification: `node test/run-swipe-reorder-fix-ui.mjs` covers the shared list/grid path and persistence; `node test/run-home-reorder-touch.mjs` uses actual Chrome CDP touch input to cover scroll cancellation, horizontal placement, edit persistence, pointer cancellation, auto-scroll, and keyboard reordering. Chrome touch emulation is not physical iPhone verification.
