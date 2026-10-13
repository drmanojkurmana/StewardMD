# BOOKS-2 STATE2 (batch 2 first, per lead 2026-10-13 18:20)

- Job: books-2, branch prefix `books2-*`, overlay prefix `maikbook2-` (set `maikbook2`).
- This run: muse Wonder, no Anthropic API calls, spend $0.00. Agy quota out until about 20:30 IST.
- Sandbox cannot write to SSD. PDFs read read-only from SSD. Chunks, if needed, go to /tmp/books2-work/. Text-only; no image extraction. Original illustrations only if free disk stays above 4 GB (currently about 5 GB free, so text-only).
- Working copies: /tmp/books2-work/STATE2.md and COVERAGE2.md, mirrored to ~/Developer/StewardMD/.fleet-reports/BOOKS2-STATE.md and BOOKS2-COVERAGE.md.
- Order: batch 2 first (Robbins, Psychiatry, Pharmacology x3, Parson Eye, Microbiology and Parasitology), then the original 15-book set. Wave 1 of the original set (OBG, 16 modules) is already complete.
- Method: check graphify-out/graph.json, prep/lessons/v1/index.json, prep/taxonomy.json, KB and overlays first; fill only lesson-less taxonomy modules; write facts in own words; new MCQs only; validate with LP.checkLesson, kb schema and repo tests.

## Coverage baseline measured 2026-10-13 (taxonomy vs indexed lessons)

| Subject | Taxonomy modules | With lesson | Lesson-less (to fill) |
|---|---|---|---|
| Pathology | 72 | 19 | 53 |
| Pharmacology | 71 | 31 | 40 |
| Psychiatry | 32 | 15 | 17 |
| Ophthalmology | 29 | 9 | 20 |
| Microbiology (incl. parasitology) | 37 | 15 | 22 |
| Total batch 2 target | 241 | 89 | 152 |

## Batch 2 books on SSD (incoming/batch2-part1/Part 1)

| Book | Pages | Role |
|---|---|---|
| Robbins Basic Pathology 9th | 924, 24 chapters | Primary for pathology wave |
| Psychiatry Marrow e6 | reference only (third-party notes) | Topic selection for psychiatry; own words and structure |
| Ananthanarayan and Paniker Microbiology | 672 | Microbiology; overlaps Sastry book in original set |
| Paniker Medical Parasitology 8th | to map | Parasitology modules |
| Parson Diseases of the Eye 23rd | to map | Ophthalmology |
| Kaplan Pharmacology | 353 | Pharmacology (USMLE-style topic check) |
| KD Tripathi Essentials 8th (2019) | 1072 | Pharmacology (India exam weighting) |
| Clinical Pharmacology Made Incredibly Easy 3rd | 450 | Pharmacology (plain-language cross-check) |

## Progress

- Wave B2-1 MERGED via PR #1568 (squash). Browser harness note: local sandbox blocks the CDP server (EPERM on listen, no Chromium at /opt/pw-browsers); CI clinix-ui passed on the PR. Unit-tests were pending at merge time but identical content passed locally 36/36.
- Wave B2-2 DONE (branch books2-batch2-systemic, PR #1570): 12 systemic modules, bk2-pat-121 to 240, tests 36/36.

- Wave B2-1 DONE on branch books2-batch2-robbins: 12 modules (pat-chronic-granulomatous, pat-thrombosis-embolism, pat-shock, pat-autoimmune, pat-immunodeficiency, pat-amyloidosis, pat-iron-deficiency, pat-megaloblastic, pat-haemoglobinopathies, pat-acute-leukaemias, pat-hodgkin-lymphoma, pat-coagulation-disorders), 12 lessons, 12 KB articles, 120 MCQs (bk2-pat-001 to 120). LP.checkLesson 12/12 pass, kb_validate_v2 12/12 ok, repo tests 36/36 pass. Generator: tools/generate-books2-batch2.mjs.
- Next waves: remaining 41 pathology modules, then psychiatry (17), pharmacology (40), ophthalmology (20), microbiology and parasitology (22).
- Wave B2P2-ENT DONE (branch books2-batch2p2-ent): 12 ENT modules, bk2-ent-001 to 120, tests pass. Batch2-part2 inventory: only Dhingra ENT 8th (576pp) + duplicate Tripathi; no derm/ortho/vascular PDFs arrived. Disk 2.6 GB free: text-only, no illustrations. Next: remaining ENT 15, then psychiatry 17 / pharmacology 40 / ophthalmology 20 / microbiology 22 / pathology 29, derm/ortho/vascular when books arrive.
