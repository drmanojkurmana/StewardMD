# Adult Normal Values

Adult lab reference ranges with a source on every row. Owner-approved 2026-10-04; **clinical sign-off: owner, 2026-10-05** (Draft badge removed; reuse of ABIM/RCPA ranges approved). No flag: a read-only page.

## Files
- `data/ref/adult-ref-values.json`: groups (electrolytes, renal, liver, cbc, coag, glucose, lipids, thyroid, cardiac, abg, urine, iron, inflam). Row `{ analyte, aka?, specimen?, sex?, value, unit, src, quote, note? }`. Values copied as published, never converted; `quote` is the source table row as read on 2026-10-04.
- `adult-ref.js` (`window.SMD_ADULT_REF`, `?v=aref1`): pure `match(text)` (analyte names + aliases of 3+ chars; a name inside a longer matched name is dropped), `isNeonatal`, `rowsFor`, `passage` (one evidence passage per analyte, sources named), `load`, plus the page `open({q})` / `close`. Own overlay `#adultRef`, styled with the neonatal hub's tokens and classes (`nh-card`, `nh-row`, `nh-src`), so it works with `smd_neo` off.
- `scripts/build-www.sh` ships `data/ref/*.json`.

## Sources
- ABIM Laboratory Test Reference Ranges, January 2026 (conventional units). The PDF sits behind Incapsula; curl gets a bot page, `firecrawl scrape` reads it.
- RCPA SPIA Chemical Pathology Harmonised Reference Intervals (RCPA Manual Table 6, page updated 25-Nov-2024; SI units). curl/WebFetch get 403; firecrawl reads it.
- NCBI StatPearls is behind a reCAPTCHA for curl, WebFetch and firecrawl: not usable as a source from here.
- Not in either source, so left out: INR reference range, SI for urea / glucose / albumin / urate / lipids / HbA1c (mmol/mol), urine pH and dipstick.

## Reached from
- Search: `search.js` EXTRA_TOOLS `adultref` ("Adult normal values"), `home.js` `ACT.adultref`, `SMD_openRoute("adultref")`.
- Edge / MaiK: the tool card carries `data-maik-toolq` (the question); `maikToolOpener("adultref", q)` opens the page on the analyte the question named, row highlighted.
- Adult vs neonatal: `edge-router.js` `candidates()` drops `neo:ref` unless the request names a newborn/infant/child/NICU word, and drops `adultref` when it does. "normal values" alone is the neonatal page's title, but adult wins (owner default).

## MaiK grounding
`maik-local.js` `refEvidence(pkg)`: a `VALUE_Q` question (not neonatal) naming a table analyte gets that analyte's rows as the leading passage(s) in `withCurated`; the answer's Source line names the table's sources (`sourceLine`). Needs the book linked (`ragEligible`), same as all Lite evidence. Cloud path not changed.

## Tests
- `test/adult-ref.test.mjs`: schema, match, Edge adult/neonatal routing, Lite grounding for potassium, newborn never gets the table.
- `test/run-adult-ref-ui.mjs`: headless page check (search potassium, range + source, note on top, highlight from a question, 360 px no sideways scroll).
- `test/run-maik-edge-ui.mjs`: "normal adult potassium range?" offers Adult normal values, not the neonatal page.
