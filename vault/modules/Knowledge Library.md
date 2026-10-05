# Knowledge Library / Syndromes

## Discover redesign

User selected option B, Discover: Apple-inspired type hierarchy, a quiet reference header, collection feature, and branch tiles with live counts. The same hierarchy now spans Syndromes, Antibiogram, AWaRe and Guidelines, with tab-specific introductions, filtering and result counts.

- Live `KB_ENRICHMENT.byId` catalog verified in Chrome: 4,804 entries grouped into 12 branches by existing `kbBranch`. Headline uses 4,800+ only when the loaded index reaches that threshold; otherwise it shows the actual count.
- `reasoning.js`: `kbRenderLibrary`, `kbPaintLibrary`, and delegated navigation. Existing abbreviation expansion, relevance ranking and clinical references are reused.
- `knowledge-library.css`: additive Discover presentation, loaded from index.html with a version token. Shared native build copies root CSS automatically.
- First view offers four featured branches; See all exposes every other branch. Search or filters hide discovery content to bring results forward.
- Result rendering starts with 40 entries and supports Show more. Previously the index rendered at most 400 with no way to reach the rest through browsing.
- The overlay is a pinned app surface, not a pullable web sheet. The shell is locked to the visible viewport and only its content region scrolls, with contained overscroll.
- Disease selections open a matching Knowledge Library reader with shared violet accents, large disease hierarchy and consistent evidence cards. The reader keeps the full-screen shell and existing clinical content/actions.
- No new clinical content, scores or source claims. Branch counts count catalog entries, using the existing grouping rules.

## Verification

All shared disease/syndrome evidence views remove displayed page citations, including expanded clinical details. Option C uses one Know more control for the complete reference content, without nested duplicate sections. The footer lists up to three distinct recorded references, with editions and page locators removed; when only one source is recorded, it shows that source. No randomly assigned textbook citations are added. Clinical quantities and emphasis are preserved; original source records remain unchanged.

The separate non-infective syndrome management page no longer shows the generic decision-support/Harrison disclaimer card beneath its content.

Your library now provides device-local favourites and the twelve most recently opened diseases. The disease reader has a save/remove control with storage-failure feedback. The national antibiogram supports checkbox selection for a compact comparison; changing organism resets the selection. This view explicitly labels national data and does not claim hospital-specific data is loaded. Source metadata expansion remains excluded per the user's request.

`node test/run-library-discover-ui.mjs` verifies real catalog counts, 320/390/768/1280px widths, branch selection, pagination, abbreviation search, empty results, infective filtering, all four tabs, pinned scrolling and the disease reader. Screenshots are written to `/tmp/stewardmd-library/`.

User approved the design. The current polish is implemented on the active UI branch, awaiting review before merge.

## Mobile reader fit (2026-09-21)

The disease reader is pinned to all four viewport edges and no longer inherits a narrower phone-width shell. Its content column stays centred with equal gutters. On phones, the header keeps equal flexible columns on both sides of the title, so “Knowledge Library” is centred on the screen even though the Back control exists only on the left.

The browser harness verifies the reader at 320, 375, 390, 393 and 430 CSS-pixel widths, including full-width geometry, zero horizontal overflow, centred title and equal content gutters.


## Disease reader branding (2026-09-22)

The disease-name hero now carries a compact StewardMD Knowledge Base banner and a low-contrast StewardMD logo watermark. Both stay behind the existing disease hierarchy, adapt to dark appearance, and remain non-interactive and decorative for assistive technology. The reader's clinical content and source claims are unchanged.


## Protocols tab (2026-09-25)

A fifth tab, Protocols, joins Syndromes / Antibiogram / AWaRe / Guidelines: bedside clinical protocols
across every specialty, on the same tool-page hierarchy. It lives in its own module, see
[[Clinical Protocols]] (`kb-protocols.js`, flag `smd_kb_protocols`). The four original tabs are
unchanged; app.js still renders them and `kb-protocols.js` appends the fifth button.

## Disease reader de-slop (2026-09-29)

Owner picked from three variants: the top of the reader follows "Textbook", the Know more panel
follows "Handbook". The disease name is set in the system serif (New York on Apple), and sections are
separated by hairlines instead of cards. The watermark, kicker pill and brand block are gone from the hero;
"StewardMD Knowledge Base" now sits under the header title. Red is used only for red flags and "Act now".
The practice update (bulletins.js) is a dated note under a rule, with no stripe or pill.
Know more is a handbook table: a narrow small-caps label column (Act now, Exam, Pitfall, Tests, Tip,
Don't miss), a 2px opening rule, and no per-row icons or tags. Inside the reader the `md-*` term colours
are neutralised. Drug names keep the owner's drug-link glow (drug-link.js, 2026-09-24), which rests as
plain bold after about 5 s. Styles: the reader block at the end of `knowledge-library.css`
(two-id scope, no `!important`). The reader was removed from the appearance.css glass-card rules.
The India "unknown" label now reads "Status not confirmed" (the row already says "In India").

## Whole-module de-slop and high-yield bolding (2026-09-30)

Owner asked for the same treatment across the module, a friendlier search, the banner with the logo
kept, and high-yield points bolded in every disease's text.
- **Banner:** one `kbBannerHTML()` (reasoning.js, also `window.SMD_KB_BANNER` for kb-protocols.js):
  `/logo.png` (transparent) beside "StewardMD / Knowledge Base", on Discover, every tab, the disease
  reader hero and the management page. The faded watermark and all uppercase kickers are gone.
- **Search:** `kbSearchHTML()` wraps each input in `.kblib-searchbox` with a drawn magnifier (input ids
  unchanged). Discover shows "Try" suggestions (`[data-kbtry]`, wired in `kbWireLibrary`).
- **Bolding:** `medFormat` highlight classes are bold ink, never colour (global in `evInjectCSS`).
  New MED_RULES: `md-dose` (dose, duration, threshold with units or a comparator: "2 g", "10-14 days",
  "&lt;0.4", "80%", ">50y") and pitfall phrases (do not, avoid, should not, not recommended, beware)
  as `md-abs`. Tests are 600, organisms italic. `window.SMD_MEDFORMAT` also formats protocol steps.
- **Management page** (`openMgmt`): reader layout (`dx-reader dx-mgmt-page`), banner, serif sections,
  medFormat text; from the reader, Back returns to the disease page (`r.back`).
- **Tabs:** 13px, all five fit from 375px (run-kb-protocols-ui rule); below that the row scrolls with an
  edge fade (`can-scroll`/`at-end`) and the active tab centred.
- **Surfaces:** library sections, rows (beats home.js `body.ui-v2 .sbref-row/.sbref-gl !important`),
  AWaRe groups and protocol sections are hairline sections; `appearance.css` no longer puts glass or
  a teal wash on the library. Gotcha: `:has()` nested inside `:is()` is dropped by the browser; write
  those selectors out.

## Live search above the keyboard + iPad fit (2026-09-30)

Owner: on phone/iPad, typing in search left the results below the keyboard. Now:
- Discover has a search mode (`.kblib-searching`, toggled in `kbPaintLibrary`): hero, Try, Your
  library, Refine and the label hide, results sit under the search box.
- Every `.kblib-searchbox` in `#sbrefBody` is sticky; typing on a tool tab calls `kbLiftSearch`
  (scrolls the box to the top); a focused search adds 60vh of scroll room (`::after`).
- Protocols hides its verify-sources note while a query is active (`.kbp-searching`).
- iPad: the shell is full width (was the 900px `.sbref-shell` column), body 840px centred, header
  titled "Knowledge Library". Test: `test/run-kb-live-search-ui.mjs` (short viewport = keyboard up).
  Gotcha: the app applies a zoom on wide screens, so compare computed widths, not rect widths.

## Ask MaiK on every disease page (2026-10-04, branch `kb-nav-askmaik`)

The reader hero has "Ask MaiK" beside Save (`.dx-reader-acts`, `.dx-reader-askmaik`; reasoning.js
`openDiseaseRef`). It calls `window.SMD_askMaikTopic(id, name)` (home.js), which opens MaiK over the page with
that disease as the topic: a clearable "About: <disease>" chip above the composer and an Ask / Research
choice (Research only when `smd_maik_research` is on). The button is not rendered when MaiK is not loaded.
MaiK can also reach these pages by name: "pneumonia" or "open pneumonia" in MaiK gives a card listing the
pneumonia pages (see [[StewardMD Edge]]). Headless check: `test/run-kb-nav-askmaik-ui.mjs`.
