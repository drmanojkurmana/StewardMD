# Fixed common tests: coverage report (2026-10-11, branch prep-fixed-tests; image top-up, branch prep-image-papers)

Owner request 2026-10-11: for each exam and each test format, 10-15 ready-made tests, identical
for all students, listed in the Tests tab. Built by tools/prep-fixed-tests.mjs from the live bank
(v5 + ss-radiology v16, PYQ v5). Papers live in R2 only (prep-bank/v1/tests/, locators + metadata,
no question text), like all generated bank content; this repo holds the builder, the serving route,
the Tests tab listing, the schema and the tests.

## Decisions and interpretations

- One assembler: every paper is one prep-assess.js assemble() call with a fixed seed. No second assembler.
- "Eligible approved": the assembler's eligible() (no flag, not withdrawn, no quality blocker; disputed
  keys out). No item-quality sidecar exists on the server yet, so no status filter applies; the builder
  takes --quality <dir> when one appears. PYQ sets therefore exclude exp-pending items (stricter than
  the PYQ browser, which shows them).
- "Part test per section": part papers exist only where the profile has parts (FMGE, 2 parts, 5 papers
  each). Part 1 uses the assembler's native part path; Part 2 a derived profile (part-2 sections
  relabelled part 1, labels 2A/2B/2C kept in the record).
- "Subject mini per subject": 2 papers of 20 per subject in the exam's scope.
- "Topic per major topic": 1 paper of 20 for each of the 5 biggest topics per subject (>= 50 bank
  questions; mixed group excluded, like Tests 2 assembly).
- "Mini 15": 15 one-section papers per exam. "Daily10 x 15": 15 fixed sets per exam, separate from the
  rolling Daily 10 (fixed runs never count toward it). "Grand 10-15": 15 requested.
- USMLE papers draw vignettes per module exactly like the app (prep.js poolFor fallback included).
- PYQ sets: NEET-PG only (no other exam has PYQ), mixed recall 2017-2025, AIPGMEE excluded from timed
  papers per owner decision 9.
- Overlap: per-exam usage is tracked and passed as the assembler's soft `recent` preference; grands are
  built first. Worst grand-pair overlap is 0% on every exam.
- Shortfalls publish fewer papers and say why; reduced papers ship with deviations. Nothing is padded.

## Requested vs built

| Exam | grand | part | mini | subject | topic | daily10 | image | pyq | short |
|---|---|---|---|---|---|---|---|---|---|
| FMGE | 15 (295/300) | 10 (148/150) | 15 (49/50) | 38 | 95 | 15 | 18 | - | - |
| NEET-PG | 15 | - | 15 | 38 | 95 | 15 | 18 | 5 | - |
| INI-CET | 15 | - | 15 | 38 | 95 | 15 | 18 | - | - |
| NEET-SS | 15 | - | 15 | 30 | 49 | 15 | 7 | - | image: 2 radiology papers dropped, 75-95% repeats of papers 01-05 |
| USMLE Step 1 | 15 | - | 15 | 22 | 55 (14 reduced) | 15 | 6 | - | image: 2nd anatomy paper dropped, pool exhausted (121 items); topics reduced by the vignette filter |

862 papers built, 3 shortfalls. FMGE reductions are the official blueprint's unmapped Radiotherapy
quota (5/300), recorded in each paper. USMLE topic reductions are small vignette pools per topic,
recorded in each paper. NEET-SS has 49 topic papers because small subjects
(ss-biostatistics: 123 items) hold fewer than 5 major topics.

## Image top-up (branch prep-image-papers)

The first build's 20 image shortfalls are gone: the bank now serves image MCQs through overlay
files (maikimg1-maikimg6, radnotes3, radmax7), which the builder merges bank-first like the app's
mergeOverlay (unseen overlay ids appended, sets in sorted order). A paper records the overlay sets
its items came from (paper.overlays { subject: [sets] }); the Tests tab fetches those files for
modules with ids the bank file lacks, so papers resolve exactly what was assembled. Papers without
overlay items never pay for this (no missing ids, no extra fetch).

Each exam gets 5 general Image tests plus one paper per subject with >= 22 eligible image items
(two at >= 80), all 20 questions at the exam's own pace, sharing one numbering per exam
(--subjects-only builds the subject papers alone, for top-ups like NEET-SS). Image pools at build
time: FMGE/NEET-PG/INI-CET 975 each (pathology 308, anatomy 160, surgery 155, ophthalmology 93,
microbiology 79, dermatology 58, orthopaedics 50, community medicine 36, radiology 36), NEET-SS 194
(ss-radiology 108, ss-cardiology 86 ECG), USMLE Step 1 121 (anatomy 113, microbiology 8, after the
per-module vignette rule).

3 papers assembled but not shipped (repeat-majority, dropped rather than padding): USMLE Anatomy
Image Test 07 (20/20 repeats), NEET-SS Radiology Image Tests 08 (15/20) and 09 (19/20). Worst
sharing pair among shipped image papers: 0/20 on FMGE/NEET-PG/INI-CET, 2/20 on NEET-SS, 1/20 on
USMLE (excluding the dropped papers). One bank datum found: item mk-99da9d08dfb4 is served from
two overlay modules (maikimg1 pathology|pat-tumour-diagnosis and maikimg6
microbiology|mic-other-dna-viruses, different stems); verify now accepts either triple.

## Publish route (after the PR merges)

1. Re-run the builder against the live bank (numbers continue past existing papers; identical
   rebuilds are skipped, changed content under an old id is refused):
   node tools/prep-fixed-tests.mjs fetch && node tools/prep-fixed-tests.mjs build
2. Upload papers + index (index last, short cache; papers immutable):
   node tools/prep-upload-bank.mjs --dir <papers>/v1 --as v1/tests --yes --no-ids
3. OTA publish for the app code (Tests tab + route): gh workflow run ota-publish.yml, only after
   the PR is merged green.

## Generated detail (from the builder)

Built 800 papers, 20 shortfalls.
Worst grand-test pair overlap: fmge 0%, neet-pg 0%, ini-cet 0%, neet-ss 0%, usmle-step1 0%.

### FMGE
- grand: 15 built, all 295/300 (unmapped Radiotherapy 5)
- part: 10 built, all 148/150 (same reason, halved)
- mini: 15 built, all 49/50 (same reason, apportioned)
- subject_mini: 38 built
- topic: 95 built
- daily10: 15 built
- image: 0 built, 5 short (No eligible questions for this test yet.)

### NEET-PG
- grand: 15 built
- mini: 15 built
- subject_mini: 38 built
- topic: 95 built
- daily10: 15 built
- image: 0 built, 5 short
- pyq: 5 built

### INI-CET
- grand: 15 built
- mini: 15 built
- subject_mini: 38 built
- topic: 95 built
- daily10: 15 built
- image: 0 built, 5 short

### NEET-SS
- grand: 15 built
- mini: 15 built
- subject_mini: 30 built
- topic: 49 built
- daily10: 15 built
- image: 5 built

### USMLE Step 1
- grand: 15 built
- mini: 15 built
- subject_mini: 22 built
- topic: 55 built, 14 reduced (vignette pools smaller than 20, recorded per paper)
- daily10: 15 built
- image: 0 built, 5 short

### Bank pools (eligible questions at build time)
- fmge: 124838 eligible
- neet-pg: 124838 eligible
- ini-cet: 124838 eligible
- neet-ss: 31402 eligible
- usmle-step1: 31243 eligible (after the per-module vignette rule)
- pyq pool (neet-pg recall 2017+): 1280 eligible

### Image top-up (branch prep-image-papers)

Built 62 papers, 0 assembly shortfalls, 3 repeat-majority papers dropped (see above).
Worst image-pair sharing: fmge 0/20, neet-pg 0/20, ini-cet 0/20, neet-ss 2/20, usmle-step1 1/20.

- fmge image: 18 built (5 general + anatomy 2, community-medicine 1, dermatology 1, microbiology 1, ophthalmology 2, orthopaedics 1, pathology 2, radiology 1, surgery 2)
- neet-pg image: 18 built (same split)
- ini-cet image: 18 built (same split)
- neet-ss image: 2 built (ss-cardiology 2, numbered 06-07 past the 5 general)
- usmle-step1 image: 6 built (5 general + anatomy 1)

Bank pools at top-up build time (bank modules + overlays, eligible questions):
- fmge: 136211 eligible, image 975
- neet-pg: 136211 eligible, image 975
- ini-cet: 136211 eligible, image 975
- neet-ss: 32040 eligible, image 194
- usmle-step1: 33184 eligible, image 121 (after the per-module vignette rule)
