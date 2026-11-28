# Sci-Fix N Report: ResearchMD R Symbol on the Home Tile and In-App Marks

Branch: `rmd-logo-tile` (from origin/main @ 71727757a)
Worktree: `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixN`

## What the brief asked
The owner circled the ResearchMD tile on the home grid (green sphere, flask glyph, BETA badge) and said "Use this logo here too". Logo sheet 01 is the standalone R symbol: a separate vertical bar on the left, an R bowl, two parallel diagonal legs. The same symbol was to appear where ResearchMD draws a mark inside the tool, stored once and reused. Item 4 of the brief (owner approved) also asked for the tile subtitle to change from "Meta-analysis with sources" to "Research to publication".

## Implementation

### 1. The standalone symbol, stored once (`research.js`, after `SMD.esc`)
- `RMD_MARK_PATHS` holds the four paths of the symbol: bar (`M0 0h110v589H0z`), bowl with stem (`M135 0h122a175 175 0 0 1 0 350H135v-85h122a90 90 0 0 0 0-180H135z`), short leg (`M135 372h60l140 217h-60z`), long leg (`M250 372h80l140 217h-80z`).
- The geometry is exactly the header logo's `rmd-logo` viewBox `0 0 470 589`, so every size of the mark is the same shape and there is one source of truth for the symbol.
- `rmdMarkSvg(height, cls)` emits the inline SVG: filled paths with `fill="currentColor" stroke="none"` as presentation attributes (badge CSS sets `fill: none` on bare svgs; a presentation attribute on the path outranks an inherited value), explicit `width`/`height` attributes plus inline `style="display:block;width:Wpx;height:Hpx"` because some contexts ignore attribute-only sizing (measured: the tile svg computed 21.985px square with attributes alone; inline style pins it exactly).
- Exported twice for the two consumers: `SMD.mark` (in-IIFE) and `window.SMD_RMD_MARK = { svg: rmdMarkSvg }`.

### 2. Home tile (`home.js`)
- `toolMark(t)` returns the symbol for the research tile via `window.SMD_RMD_MARK.svg(24, "rmd-tile-mark")`; if research.js failed to load, the tile falls back to the Material flask it always had (guarded, like the existing `SMD_MAIK_MARK` pattern).
- `homeToolTile`: the mark replaces the flask inside the same `liveIcon` wrapper (`<span class="rds-icon ai-live" data-live="tilt">`), so the tile keeps the identical live-motion treatment, white color, 70px green sphere, BETA badge, label, subtitle and tap target of every other tile. Measured on the built page: svg 19.15 x 24 css px, vertically centered (22.9 above / 22.9 below in the 70px badge), `color: rgb(255,255,255)`, 4 paths, `animationName liveTilt` still running on the wrapper.
- `listIcon` (All tools / Customize lists): static mark at 24px in the same `rds-icon` span the other tools use.
- BETA badge, "ResearchMD" label and the `data-act="research"` tap target are untouched.

### 3. In-app marks
- Ask MaiK buttons (`research.js` `aiBarHtml`, `research-screen-extract.js` `aiBarHtml`): the `<span class="rmd-ai-mark">R</span>` text is now the 14px-high symbol (11.17 x 14). The chip itself is unchanged (18px `--rmd-acc-grad` rounded square, white foreground), so the mark inherits exactly the color and contrast the letter R had.
- `research-screen-extract.js` loads before `research.js` but renders at click time, so it reads `G.SMD_RMD_MARK` with the plain "R" as a fallback.
- The ResearchMD header was checked: it already renders the full two-tone logo SVG (bar + bowl + legs as `rmd-logo-a`/`rmd-logo-b` paths), not a plain R, so it is left as the two-tone brand version. "RStudy" is a text button label, not a mark, and stays text.

### 4. Two-tone decision
The brief allows a two-tone version (blue bar, cream/ink R) if it passes contrast in light and dark. On the Ask MaiK chip the bar would sit `#2457ff` on the `--rmd-acc-grad` blue chip: about 1.35:1, far below 3:1. Both themes use the same blue chip, so the monochrome `currentColor` symbol is the only variant that passes everywhere; the two-tone version stays where it already passes (the header logo on cream/dark backgrounds).

### 5. Rendering note (documented, inherent)
At the 14px chip size the gap between bar and bowl is 25/470 of the width, about 0.6 css px (1.19 device px at dsf 2). That is the sheet's own geometry at small sizes, not a defect of the redraw; at the 24px tile size the gap is about 1.0 css px and reads cleanly. The `#researchMD` context renders its UI at a uniform 0.95 scale (pre-existing; the old 18px chip computed 17.09px too), which shrinks the mark proportionally with everything around it.

### 6. Tile subtitle (brief item 4, owner approved)
- `home.js` `HOME_TOOLS` research entry: `sub: "Meta-analysis with sources"` is now `sub: "Research to publication"`.
- `git grep "Meta-analysis with sources"` returns only this one source. The Home grid, the search index and the All tools / Customize lists all read the same `HOME_TOOLS` entry (via `window.SMD_HOME_TOOLS`, `orderedHomeTools` and the `hv-at-row` builder), so there is no second copy to change. The "what's new" / Try card uses `T.desc(a) || t.sub` and therefore picks the new line up automatically.
- No em dash; length is 23 characters, the same two-line fit the old subtitle had.

## Cache busting
- `index.html`: `-scin1` appended to the `?v=` chains of `research-screen-extract.js` (line 2501), `research.js` (line 2546) and `home.js` (line 2605); all other tokens kept.
- `sw.js` line 16: `-scin1` appended to the single `CACHE` string after `-scik1`; all earlier markers kept.

## Screenshots (390x844 @2x, committed under `shots/`)
All taken with the CDP harness pattern of `test/run-research-ui.mjs` (static server, POST `/api/research/v1/projects` stub, headless Chrome, `Target.attachToTarget` flatten). Home shots boot with `smd_home_tools = {"research":true}` so the research tile is pinned; the ResearchMD shots create a real project through the new-project modal (practice projects gate the AI screens) and land on the Search screen where the Ask MaiK chip renders.

| Shot | Before | After |
| --- | --- | --- |
| Home grid, light | `shots/n-before-home-390-light.png` | `shots/n-after-home-390-light.png` |
| Home grid, dark | `shots/n-before-home-390-dark.png` | `shots/n-after-home-390-dark.png` |
| ResearchMD search screen, light | `shots/n-before-researchmd-390-light.png` | `shots/n-after-researchmd-390-light.png` |
| ResearchMD search screen, dark | `shots/n-before-researchmd-390-dark.png` | `shots/n-after-researchmd-390-dark.png` |

Before: flask ligature on the tile, old subtitle "Meta-analysis with sources", letter R in the chip. After: the R symbol in both places, same size class, color and motion as the neighbors, and the tile subtitle "Research to publication".

## Verification

### Harness suites (headless Chrome)
- `test/run-research-ui.mjs`: all passed (includes the Ask MaiK bar screens, zero horizontal overflow at 390/768/1024, zero em/en dashes).
- `test/run-home-live-icons-ui.mjs`: all passed (every unlocked tile icon still moves; stagger and reduced-motion rules intact).
- `test/run-home-tabs-ui.mjs`: flaky on this machine. Run 1 failed at step 8 with `window.openSearch is not a function`; run 2 failed the reload-dependent tab assertions ("the last tab is remembered", Bedside, Practice). The same suite fails at the same points on pristine origin/main (`0afd731d0`), so the flakiness is pre-existing and no tile assertion fails.
- `test/run-all-tools-ui.mjs`: 1 failure, "solid parts of the drawn icons are filled: 0", reproduced identically on pristine origin/main (`0afd731d0`). Pre-existing, unrelated to this change.
- `test/research-po-button.test.mjs` and `test/research-ai-draft-phi-client.test.mjs` were checked for mark coupling: the first only mocks `barHtml` without asserting the mark's content, the second asserts notice text and class names only. Neither needed changes.

### Full unit suite
- `npm test` in this worktree: every test passes except 10 files that fail only because the mandated worktree path contains spaces. Those tests build a path with `new URL(..., import.meta.url).pathname` and do not decode `%20`, so they look for `/Volumes/WD%20BLACK%20SN7100%201TB%20Media/...` and get ENOENT; the failures are `build-slim`, `edge-schemas`, `narke-drills`, `no-side-stripes`, `remote-media`, `tokos-drill-core`, `tokos-learn-gyA`, `wardsynq-i18n-unwrapped`, `wardsynq-reachability` and `wardsynq-support-ops`.
- Those same 10 files were re-run at the branch base commit `71727757a` in a path without spaces (`/tmp/scin-base717`): all pass. They were then run again in `/tmp/scin-verify` with this branch's five changed source files copied in: all pass. So `npm test` has no new failures from this change; the 10 failures are purely the worktree path.
- Everything else in the suite (browser-independent tests included) passed on this branch.

## Compliance (ui rules)
- Read the required skill files before building (anti-slop, styling, brand and craft references, including the icon guidance: icons drawn as authored SVG in one consistent weight, never emoji or unicode stand-ins; this change replaces a generic glyph with the product's own drawn mark, which is the direction the rules ask for).
- `impeccable detect --json research.js home.js research-screen-extract.js index.html sw.js`: 154 findings, 146 in `index.html` and 7 in `home.js` / 1 in `research.js`, all pre-existing patterns (width/height transitions, an Inter reference, the rnavJiggle keyframe, dark-glow and halo backgrounds in legacy index styles). None falls on any line this brief added; the new SVG paths, the chip markup and the tile branches are clean.
- Contrast: tile mark `#fff` on the sphere (same as every neighbor), chip mark `#fff` on `--rmd-acc-grad` (same as the letter it replaces), two-tone variant rejected on the 1.35:1 measurement above.
- No em dashes in any new UI string or in this report.
