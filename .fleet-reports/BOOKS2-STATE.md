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
- Wave B2-PHARMA1 DONE (branch books2-batch2-pharma1): 12 pharmacology modules (phm-anticholinesterases, phm-neuromuscular-blockers, phm-adrenergic-agonists, phm-alpha-blockers, phm-nsaids, phm-asthma-cough, phm-antiemetics, phm-laxatives-ibd, phm-diuretics, phm-antihypertensives, phm-antiarrhythmics, phm-shock-pah), 12 lessons, 12 KB, 120 MCQs bk2-phm-001 to 120. LP.checkLesson 12/12, kb_validate_v2 12/12 ok, prep-books-mcqs 2/2, prep-lessons/subject 23/23. Generator: tools/generate-books2-pharma1.mjs. Remaining pharmacology: 28 modules.
- Wave B2P2-ENT DONE (branch books2-batch2p2-ent): 12 ENT modules, bk2-ent-001 to 120, tests pass. Batch2-part2 inventory: only Dhingra ENT 8th (576pp) + duplicate Tripathi; no derm/ortho/vascular PDFs arrived. Disk 2.6 GB free: text-only, no illustrations. Next: remaining ENT 15, then psychiatry 17 / pharmacology 40 / ophthalmology 20 / microbiology 22 / pathology 29, derm/ortho/vascular when books arrive.
- Wave B2P2-ENT MERGED (PR #1573 squash). Wave3 pathology MERGED (PR #1571). Psychiatry wave1 PR #1574, wave2 PR #1577 open (CI pending; unit-tests fail on main itself, pre-existing). Psychiatry subject complete 32/32 pending merges. Recovery ref refs/tbh/recovery/before-discard/20261013T132253Z-56101 retained. Disk cleanup applied (regenerable only); worktrees removed after push to free space; text-only continues (3.5 GB free).
- Wave ENT-FINAL DONE (branch books2-ent-final, PR #1584 open): 3 modules (ent-airway, ent-neck-masses, ent-sleep-apnoea), 3 lessons, 3 KB, 30 MCQs bk2-ent-241 to 270. ENT subject now 36/36 on main after merge. LP.checkLesson 3/3, kb_validate_v2 3/3, repo tests 36/36. Generator: tools/generate-books2-ent3.mjs. maikbook2 total 1050 -> 1080. Dhingra PDF is scanned (no text layer, pymupdf 0 chars); topic-map authoring in own words per established pattern. Batch2-part2 re-listed: still only Dhingra ENT 8th + duplicate Tripathi; no derm/ortho/vascular books. Next: ophthalmology 20 (Parson), microbiology 22, pathology 17, pharmacology 28.
- PR #1584 MERGED (squash aca99a569): ENT subject complete 36/36 on main. Batch2-part2 re-listed: only Dhingra ENT 8th + duplicate Tripathi; no derm/ortho/vascular books.
- Wave OPH1 DONE (branch books2-oph1, PR #1585 open, rebased onto post-#1584 main): 10 ophthalmology modules (oph-lids, oph-orbit, oph-conjunctiva, oph-cornea, oph-corneal-degenerations, oph-sclera, oph-anterior-uveitis, oph-posterior-uveitis, oph-cataract, oph-glaucoma), 10 lessons, 9 KB (anterior_uveitis KB pre-exists, not duplicated), 100 MCQs bk2-oph-001 to 100. LP.checkLesson 10/10, kb_validate_v2 9/9, repo tests 36/36. Generator: tools/generate-books2-oph1.mjs. maikbook2 total 1080 -> 1180. Parson text chunks in /tmp/books2-work/parson/ (8 chapters, 0.7MB). Fixes during authoring: 1 step trimmed to 90-word cap; 2 stray-word typos caught (non-English fragment, 'Palindrome'). Remaining: ophthalmology 10 (wave 2: secondary-glaucoma, vitreous, retinal-vascular, retinal-detachment, macula, tumours, optic-nerve, pupil, strabismus, trauma), microbiology 22, pathology 17, pharmacology 28.
- Wave OPH2 DONE (branch books2-oph2, from origin/main post-#1584; PR to open): 10 ophthalmology modules (oph-secondary-glaucoma, oph-vitreous, oph-retinal-vascular, oph-retinal-detachment, oph-macula, oph-tumours, oph-optic-nerve, oph-pupil, oph-strabismus, oph-trauma), 10 lessons, 8 KB (secondary-glaucoma maps to pre-existing glaucoma KBs incl. congenital/neovascular/steroid-induced; retinal_detachment KB pre-exists, neither duplicated), 100 MCQs bk2-oph-101 to 200. LP.checkLesson 10/10, kb_validate_v2 8/8, prep-books-mcqs 2/2, prep-lessons 23/23. Generator: tools/generate-books2-oph2.mjs (fixed for unmerged-OPH1 base: test patch targets main base 1080 -> 1180 + ophthalmology subject loop; 1 step trimmed to 90-word cap). All 10 confirmed lesson-less on main index + taxonomy before writing. maikbook2 total 1080 -> 1180 on this branch (1280 after OPH1 merges). Ophthalmology subject complete 20/20 pending both merges. prep-lessons-100 targetModules failure re-verified pre-existing on clean main (identical 2 pass/1 fail with wave files removed). Next: microbiology 22, pathology 17, pharmacology 28.
- Wave MICRO1 DONE (branch books2-micro1, from origin/main; PR to open): 12 microbiology modules (staphylococcus, streptococcus, neisseria, enterobacteriaceae, salmonella, vibrio-campylobacter, non-fermenters, haemophilus-zoonotic, ntm-leprosy, rickettsia-chlamydia-mycoplasma, innate-antigens, immunodeficiency-transplant), 12 lessons, 12 KB (topic-links kb:[] for all 12, no pre-existing module KB), 120 MCQs bk2-mic-001 to 120. LP.checkLesson 12/12, kb_validate_v2 12/12, prep-books-mcqs 2/2, prep-lessons 23/23. Generator: tools/generate-books2-micro1.mjs. Source note: Ananthanarayan PDF is scanned (0 text chars, pymupdf), so topic-map authoring in own words per Dhingra-ENT precedent; Paniker parasitology text extracted to /tmp/books2-work/micro/ (264 pp, 809KB) feeds MICRO2. Sastry overlap: Sastry book unprocessed, no existing lessons from it; 16 pre-existing mic-* lessons all disjoint. Fixes: added 4th resistance step to enterobacteriaceae; caught 2 stray non-English fragments. maikbook2 total 1080 -> 1200 on this branch. Next: MICRO2 (10: 5 virology + systemic mycoses + 4 parasitology).
- Wave MICRO2 DONE (branch books2-micro2, from origin/main; PR to open): 10 microbiology modules (herpesviruses, picorna-enteric, respiratory-rna-viruses, arbo-rabies, hepatitis-viruses, systemic-opportunistic-mycoses, intestinal-protozoa, blood-tissue-protozoa, cestodes-trematodes, nematodes), 10 lessons, 10 KB (topic-links kb:[] for all 10), 100 MCQs bk2-mic-121 to 220. LP.checkLesson 10/10, kb_validate_v2 10/10, prep-books-mcqs 2/2, prep-lessons 23/23. Generator: tools/generate-books2-micro2.mjs. Parasite modules grounded in Paniker text chunks (/tmp/books2-work/micro/, spot-checked malaria/filaria sections); virology/mycology topic-map authored in own words. Fixes: niclosamide typo, leading-space typo. maikbook2 total 1080 -> 1180 on this branch (1300 after MICRO1 merges). Microbiology subject complete 22/22 pending both merges. Next: pathology 17, pharmacology 28.
