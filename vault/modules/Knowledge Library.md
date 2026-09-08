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

Your library now provides device-local favourites and the twelve most recently opened diseases. The disease reader has a save/remove control with storage-failure feedback. The national antibiogram supports checkbox selection for a compact comparison; changing organism resets the selection. This view explicitly labels national data and does not claim hospital-specific data is loaded. Source metadata expansion remains excluded per the user's request.

`node test/run-library-discover-ui.mjs` verifies real catalog counts, 320/390/768/1280px widths, branch selection, pagination, abbreviation search, empty results, infective filtering, all four tabs, pinned scrolling and the disease reader. Screenshots are written to `/tmp/stewardmd-library/`.

User approved the design. The current polish is implemented on the active UI branch, awaiting review before merge.
