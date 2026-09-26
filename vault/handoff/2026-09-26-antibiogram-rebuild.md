# 2026-09-26 - Antibiogram rebuild: census of Indian antibiograms, extraction, review

The owner asked for every public antibiogram on Indian hospital websites to be found and integrated,
and for the module to reach 10/10. Architecture and rules: [[Antibiogram]]. Decisions: `Decisions.md`
entries of 2026-09-26. Owner items: [[Roadmap]] (Antibiogram section).

## Census (data/antibiogram/register.json, census/*.json)
- 856 websites checked, 6,699 pages crawled, 209 search queries and 86 navigation paths logged, by
  region slices (north, south, east, west, central, networks, AIIMS) plus a sweep. Search results are
  US-indexed and some Indian portals refuse connections from the cloud proxy, so "not found" means not
  found from here, not "does not exist".
- 222 documents found; 88 integrated into 108 source files: 66 institution editions from 19 institutions
  (Sir Ganga Ram Hospital's fungal issues are their own series), 24 network reports (ICMR AMRSN, NARS-Net 2017 to 2025, KARS-NET 2021 to 2025 with 4 districts and the
  Shigella series, TARS-Net, AARSNET), and 18 published hospital studies (shown on their own, never pooled).
- Not integrated, each with its reason in the register: 37 journal articles (not an institution's
  antibiogram), 28 policies or plans without susceptibility tables, 6 older ICMR editions (their national
  figures are in the 2024 trend tables), 6 NARS-Net half-year bulletins (superseded by the annual
  reports), unreachable links (refused 5, 403 3, 404 3, login 3, 502 1, password-protected 2), documents
  that are not cumulative antibiograms (MDR subsets, ranked choices, pooled Gram-positive/negative charts,
  top-drug charts), 2 illegible or non-percentage editions (BVDU 2019 scan; RMLIMS 2020 and 2021 print
  counts under "percentage" headings), and 5 held documents (below).
- Held for permission, extracted but not in the app: UCMS and GTB Hospital antibiograms 2023, 2023-24 and
  2025 ("forbids copying or reproduction without the permission of its editorial board"), CMC Ludhiana
  2012 and RGGWCH Puducherry 2017 ("for internal use only"). Integrate only if the owner gets permission.
- Added later on the owner's instruction (2026-09-26): the UCMS & GTB Hospital Antimicrobial Policy 2026-27
  (`UCMS_GTBH_2025`), which is openly published and carries no restriction notice; the owner takes
  responsibility for its use. Ranked % susceptible lists for 2025 by infection type, no isolate numbers,
  so its figures are shown grey and never pooled. The three UCMS antibiogram booklets stay held.
- Regions: north 26 institution editions, west 13, south 3 (plus 12 network reports: TARS-Net, KARS-NET),
  east and North-East 3 (RIMS Imphal 2022-23 to 2024-25; plus AARSNET and studies from Assam and Odisha).
- Gap-state census (`census/gaps.json`, 41 searches and 7 site navigations, 2026-09-26): still no public
  institutional antibiogram for West Bengal, Odisha, Bihar, Jharkhand, Tamil Nadu, Karnataka, Gujarat,
  Mumbai or the smaller North-East states (journal articles only). It found the Sir Ganga Ram Hospital
  Microbiology Newsletter archive (served only by POST from sgrh.com/en/publications): bacterial
  antibiograms 2012 to 2021 (no 2018 issue is served) and fungal (Candida) antibiograms 2011 to 2021,
  all now integrated. Leads it could not open: AIIMS Bhopal Jan-Jun 2025, AIIMS Jodhpur 2018 policy,
  Gandhi Hospital HICC manual (connections refused; retried 2026-09-26). web.archive.org is unreachable
  from this network, so the archived-only documents (Sumandeep, GIMSR) stay unread.

## Extraction and verification
- Every integrated document was read by one agent and re-read by an independent second agent: a seeded
  random 25% of cells at least (a whole table re-read if more than 2% of its sampled cells were wrong),
  and in most files every cell, every row n and every count, from page images (brief `VERIFY.md` in the
  session scratchpad). 107 of 108 sources are "double-checked"; 1 is the transcribed ICMR 2024 summary (no
  n, never pooled). Where a second reader corrected a value, the fix is logged in the file's `issues`.
- Bundle: 4,344 rows (+1,889 derived), 44,260 cells: 42,288 shown, 1,059 with a caution, 807 intrinsic
  resistance, 78 not relevant to the specimen, 28 not shown; 1,475 rows under 30 isolates (shown grey,
  never pooled); 90 count-table disagreements, each the source's own and listed on its sheet. 3.9 MB
  (590 KB gzipped), fetched on demand.
- RIMS Imphal 2022-23 and 2023-24: second reading done (every cell; no errors; one cell left out while
  two readings disagreed was settled from the vector chart bar), integrated.
- SGRH 2012 to 2021 (9 bacterial editions, 11 fungal): extracted by three agents plus one for the
  fungal issues, each re-read by a different agent from the page images (every cell, n, row colour,
  organism label, header and chart panel): no transcription errors in 8,727 bacterial and 573 fungal
  cells.
- Rules added because of what the documents contained (copied figures across editions, exceptional
  resistance, tetracycline above doxycycline, pus aspirate filed as deep, n from the organism table, other
  species groups, enterococcal high-level gentamicin only when stated, ambiguous cells left out): see the
  decisions log.

## Review
- Round 1 (independent agent, clinical microbiologist and engineer brief): 7/10. Every must-fix and
  nice-to-have item was addressed: syndrome-inappropriate agents, fallbacks, page numbers scrubbed from
  screens, MRSA/MSSA combination, studies in pools, register honesty, per-institution profiles, notes,
  other-species groups, breakpoint revisions, the data kill switch, cefotaxime/ceftriaxone, exports,
  keyboard access, WISCA wording, the % resistant import check.
- Round 2 was launched but stopped by the account usage limit before it reported. Run it again
  (brief `REVIEW.md` in the session scratchpad) before calling the module 10/10.

## Process slips to know about
- Early in the census, crawl scripts ran with TLS verification off for about an hour before this was
  caught and stopped; no credentials were involved and everything since goes through the proxy CA bundle.
- Agents: one second reader ran the build once (identical output); several ran read-only `git status`;
  some moved or overwrote shared scratch tools. No repository file was committed by an agent.
- No source PDF is committed (AIIMS Rishikesh MICU 2023 slide 8 shows patient names and UHIDs).

## Tests
`node --test test/antibiogram-rules.test.mjs test/antibiogram-build.test.mjs test/antibiogram-store.test.mjs`
(60 pass) and `node test/run-antibiogram-ui.mjs` (ALL PASS: screen, keyboard, search, exports, breakpoint
notes, sources, imports, console, reasoning, flag off, kill switch off). CI runs both checks and the UI test
(`.github/workflows/antibiogram-ui.yml`). Recovery point before the rebuild: `dbc92bad9`.
