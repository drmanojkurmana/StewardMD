# Fixed common tests: coverage report (2026-10-11, branch prep-fixed-tests)

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
| FMGE | 15 (295/300) | 10 (148/150) | 15 (49/50) | 38 | 95 | 15 | 0/5 | - | image: bank holds no image items in MBBS scope |
| NEET-PG | 15 | - | 15 | 38 | 95 | 15 | 0/5 | 5 | image: same |
| INI-CET | 15 | - | 15 | 38 | 95 | 15 | 0/5 | - | image: same |
| NEET-SS | 15 | - | 15 | 30 | 49 | 15 | 5 | - | - |
| USMLE Step 1 | 15 | - | 15 | 22 | 55 (14 reduced) | 15 | 0/5 | - | image: same; topics reduced by the vignette filter |

800 papers built, 20 shortfalls. FMGE reductions are the official blueprint's unmapped Radiotherapy
quota (5/300), recorded in each paper. USMLE topic reductions are small vignette pools per topic,
recorded in each paper. Image papers exist only for NEET-SS (108 eligible image items in
ss-radiology); MBBS bank modules carry no image items, so the Image tests group stays hidden on the
other four exams until such items exist (PYQ holds recall images; mixing them into Image tests is a
possible follow-up, not done here). NEET-SS has 49 topic papers because small subjects
(ss-biostatistics: 123 items) hold fewer than 5 major topics.

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
