# Home tools rearranging

September 2026: `home.js` owns home-grid and Customize-tools list ordering. Saved order uses `smd_home_tools_order`; visibility uses `smd_home_tools`. Unknown/new tools retain default placement and hidden tool IDs are retained when the visible grid is reordered.

- Hold for 450ms to lift an icon. Movement beyond 9px before activation cancels the hold, allowing ordinary scrolling. A focused tool also supports Space to enter rearranging mode.
- A fixed floating copy follows the finger, with a dimmed original retaining the grid slot. Two-dimensional slot selection and short neighbor animations support horizontal and vertical movement. Edge holding scrolls the nearest scroll container.
- Tap outside the icons or press Escape to end editing. There is no Edit/Done button. The long-press hint disappears ten seconds after becoming visible. Drag release suppresses its synthesized click and leaves edit mode active. Pointer cancellation/blur restores the pre-drag order and removes listeners/ghosts. Secondary touches cancel a drag.
- Space plus arrow keys rearranges focused tools; Escape exits. Reduced-motion disables neighbor animation and jiggle.
- No clinical actions or eligibility flags change. Native devices require a new bundle or an authorized OTA release.

Verification: `node test/run-swipe-reorder-fix-ui.mjs` covers the shared list/grid path and persistence; `node test/run-home-reorder-touch.mjs` uses actual Chrome CDP touch input to cover scroll cancellation, horizontal placement, edit persistence, pointer cancellation, auto-scroll, and keyboard reordering. Chrome touch emulation is not physical iPhone verification.

## All tools sheet (2026-09-28)
Tester: "I only want 3 tools on Home, but at times I need the others." The last grid tile is now
**All tools** (`data-act="alltools"`, `home.js` `openAllTools`), replacing "Add Tool". It lists every
eligible tool (`orderedHomeTools()`), each row opens the tool directly (no pinning needed); the pin at
the row's right edge adds/removes it from Home (`smd_home_tools`); a filter box; **Customize** inside
the sheet opens the old reorder sheet (`openToolsCustomize`, still `ACT.customizetools`, reachable from
search). Role-locked tools are listed and explain themselves on tap. Search lists "All tools" too
(`search.js` EXTRA_TOOLS). Test: `test/run-all-tools-ui.mjs`; `run-home-sheet-drag-handle.mjs` and
`run-govschemes-ui.mjs` reach Customize through the new route.
