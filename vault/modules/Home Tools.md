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

## Grouped by role, starter set, Recently used (2026-10-13)
Owner: tools are overwhelming and hard to arrange. `tool-groups.js` (`window.SMD_TOOL_GROUPS`, loaded just before
`home.js`) holds the data; `home.js` uses it when present and the flag `smd_tool_groups` is on (default; `"0"` or
`?toolgroups=0` turns it off).
- **All tools sheet:** Recently used (up to 4, key `smd_tools_recent`, tool ids only) then one `<details>` section per
  role (`GROUPS`), the user's own role first, open and marked "Your role"; others closed (all open with no role).
  Every tool sits in one section; a tool missing from `GROUPS` lands in "More tools". Rows show `DESC[act]`, the
  one-line description, in place of the subtitle. Search: every word, any order, over title + subtitle + description;
  while searching all sections open, empty ones and Recently used hide; clearing restores what was open.
- **Starter set:** with no `smd_home_tools` saved, `homeToolVisible` shows `starter(role, kit)`: the `PACKS[kit]`
  tools, then `STARTER[role]` (or `none`), at most 8, skipping tools locked for the role and `ON_HOME_ALREADY`
  (the quick actions and chips above the grid). `homeToolPrefsForWrite()` saves the starter as explicit prefs on the
  first pin/hide, so the grid never jumps; after that it behaves exactly as before.
- **Adding a tool:** add it to `HOME_TOOLS`, to one `GROUPS[].acts` and to `DESC` (the unit test fails otherwise).
- Tests: `test/tool-groups.test.mjs`, `test/run-tool-groups-ui.mjs` (390 px, both themes, kill switch).

## Home tabs, discovery and problem search (2026-11-07)
Owner: tools should be easy for any doctor to find. `tool-groups.js` adds `TASKS` (learn, bedside, practice),
`BRANCHES` (specialty tab, mapped from `smd_my_specialty` kit ids), `PROBLEMS` (problem words per tool), and the seen
list; `home.js` `homeToolsSectionMarkup` renders the tabs.
- **Tabs:** For you (the grid as before, with `#rnavToolsGrid`, drag, All tools) | Learn | Bedside | Practice | branch.
  Task tabs show every eligible tool of that kind (locked ones after); each Home tool not in `ON_HOME_ALREADY` is in
  exactly one task (unit test). Tab remembered in `smd_home_tab` (students default to Learn); branch pick in
  `smd_home_branch`. Tapping the open branch tab (or with no kit) opens the picker. Row scrolls on phones, with a fade.
- **Discovery:** `smd_tools_seen` (tool ids) is seeded on first render with what is on Home plus Recently used; tools
  never opened get a "New" chip; `#rnavTry` offers one unseen tool per week (`tryNext`), "Not now" hides it for the
  week (`smd_tools_try_hide`). Opening any tool (`noteToolOpened`) marks it seen.
- **Problem search:** `search.js` `problemTools` puts `suggest(q)` hits first in Tools ("Fits your search"). Short
  phrases (3 letters or fewer) match whole words only. The All tools filter matches the same words.
- **Subtitles:** rewritten in plain words (max 30 chars, unit test); titles unchanged; Narke tile is "Anaesthetica".
- **Flag:** `smd_home_tabs` default on; "0" or `?hometabs=0` = the single grid.
- Tests: `test/home-tabs.test.mjs`, `test/run-home-tabs-ui.mjs` (390 px and iPad, light and dark, kill switch).
- **Design pass (owner, same day: "not AI slop, best fonts"):** Home type is **Atkinson Hyperlegible Next** (Braille
  Institute, OFL, self-hosted `assets/fonts/atkinson-next-latin*.woff2`, preloaded), scoped by overriding `--rds-font`
  on `#homeV2.rnav`; the rest of the app keeps Inter. Tabs are underline tabs (not pills), the specialty selector sits
  at the row's end, and **All tools** is a text button beside the "Clinical tools" heading (on iPad directly above the
  selector). The Try card has no eyebrow label: its heading is the action ("Try Insulin", button "Open Insulin").
  The "New" tag is a small square-cornered label. At 390 px the five tabs fit; longer branch names scroll with a fade.
