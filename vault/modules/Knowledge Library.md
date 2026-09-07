# Knowledge Library / Syndromes

## Discover redesign

User selected option B, Discover: Apple-inspired type hierarchy, a quiet reference header, collection feature, and branch tiles with live counts. Chrome stays scoped to the Syndromes tab; other reference tabs retain their presentation.

- Live `KB_ENRICHMENT.byId` catalog verified in Chrome: 4,804 entries grouped into 12 branches by existing `kbBranch`. Headline uses 4,800+ only when the loaded index reaches that threshold; otherwise it shows the actual count.
- `reasoning.js`: `kbRenderLibrary`, `kbPaintLibrary`, and delegated navigation. Existing abbreviation expansion, relevance ranking and clinical references are reused.
- `knowledge-library.css`: additive Discover presentation, loaded from index.html with a version token. Shared native build copies root CSS automatically.
- First view offers four featured branches; See all exposes every other branch. Search or filters hide discovery content to bring results forward.
- Result rendering starts with 40 entries and supports Show more. Previously the index rendered at most 400 with no way to reach the rest through browsing.
- No new clinical content, scores or source claims. Branch counts count catalog entries, using the existing grouping rules.

## Verification

`node test/run-library-discover-ui.mjs` verifies real catalog counts, 320/390/768/1280px widths, branch selection, pagination, abbreviation search, empty results, infective filtering and opening disease references. Screenshots are written to `/tmp/stewardmd-library/` (light/dark mobile and desktop).

User approved the design. Implementation on `codex/knowledge-discover`, awaiting review before merge.
