# CliniX final-year expansion: Obstetrics, Gynaecology, Paediatrics, Surgery

Plan v1, 2026-10-18. Owner request: CliniX today has full pathways only for general medicine (22 diseases in 5 systems). Build the SAME for Obstetrics, Gynaecology, Paediatrics and Surgery (skills, OSCE modules, cases, viva, presentations, practicals) so a UG or PG student can learn in the app and rehearse for the exam. Built with muse and agy workers, orchestrated and verified by the lead.

## 1. What "the same as medicine" means (read from the code, not assumed)
Source of truth: `docs/superpowers/specs/2026-08-22-clinix-design.md`, `clinix-model.js` (validators), `vault/modules/CliniX.md`, and `clinix/diseases/pneumonia.json` as the exemplar.

| Medicine has | File / mechanism | New subjects need |
|---|---|---|
| A system with shared skill packs | `clinix/skills/<pack>.json`, listed in `clinix/manifest.json` `skillPacks` and a `systems[]` entry | Pack(s) of reusable history, examination, general-exam, approach, annexure skills per subject |
| Diseases, each a 14-chapter pathway | `clinix/diseases/<id>.json`: `chapters` (basics, approach, particulars, history, past/personal/drug/family, general exam, systemic exam, disease findings, summary, differential, investigations, diagnosis, treatment, case) plus ~10 disease skills | A disease file per roster entry (section 4) |
| A simulated-patient case per disease | `cases[]`: opening, vitals, patient, history topics with cues and replies, exam findings keyed to skills, investigations, differential/diagnosis/management marking models, teaching points | Same shape; patient stories in Indian clinical context |
| OSCE stations and viva | `osce.stations[]` (selection of skills plus a clock), `viva.skills[]` | 2 stations per disease, plus a subject station pool |
| A subject-wide OSCE and viva module | `clinix/systems/obgyn.json` (`kind: system-module`, 10 stations, viva pool, two AI-patient cases) | One per subject (obgyn exists, to be extended; paediatrics and surgery new) |
| Presentations | `clinix/presentations/*.json` ("Approach to the breathless patient") | 3 to 5 per subject |
| Annexures | skills of `kind: annexure` | Scores, tables, charts (Bishop, partograph, Apgar, Ballard, growth charts, Alvarado, Glasgow, ...) |
| A diagnosis vocabulary | `clinix/dx-vocabulary.json` | Add the new diagnoses and synonyms |
| Licence-gated media | `clinix/media/manifest.json` (`cleared: true` with a real licence) | Self-authored SVG diagrams first, CC images second |

Hard rules that carry over (each has a test today): flag-off is a no-op; no prescribing surface; the tutor never authors a dose; treatment content is grounded in the knowledge base (`kb/reference/*.json`, `kb/treatments/*.json`) and cited; doses appear only quoted from a cited source with the standard `dosingNote`; uncleared media never renders; all new content is `review.status: "ai_drafted"` (renders, owner reviews later); no em or en dash in app-facing text; British spelling.

## 2. Sources
- Knowledge base: `kb/reference` (5,222 conditions; every roster disease has a candidate) and `kb/treatments`.
- Owner textbooks (authorised, confidential, never committed, never copied; facts rewritten in our own words; no book images): A Guide to Practical Exams in Obstetrics and Gynaecology (UG and PG); Manipal Manual of Clinical Paediatrics 2nd ed; S. Das Clinical Surgery (40 examination chapters). Section files live in `~/prep-data/cxp-src` (O&G, paediatrics). Surgery to be split the same way.
- Existing repo content to reuse, not duplicate: `clinix/skills/obgyn.json` (32 skills), the Tokós OSCE module, `tokos/learn` lessons and competencies, `tokos/decks/mcq`.

## 3. Architecture decisions
1. Systems: `obstetrics` and `gynaecology` (two systems sharing the existing `obgyn` skill pack, which is extended), `paediatrics`, `surgery`. The current single `obgyn` system entry becomes the two; deep link `tokos-osce` keeps working.
2. Order of work is dictated by referential integrity: shared skill packs FIRST (stable ids), then diseases that reference them, then OSCE/viva pools and presentations that reference both.
3. The "disease factory": one worker run builds one disease from a brief bundle (KB entry text, book section text, the pack's skill catalogue, a trimmed exemplar), writes one JSON, and must pass the validator before reporting. The lead registers it in the manifest.
4. Practicals (spotters: instruments, drugs, procedures, specimens, X-rays, staging, charts) are a new content kind `clinix/practicals/<subject>/<section>.json` (schema `docs/clinix/practicals-schema.md`) with one new CliniX runner (browse with image above and text below, spotter quiz, viva rehearsal). Decks are already being generated from the books. Medicine gets no change.
5. Pro lock: respiratory stays the free sample; the new systems follow the existing rule (Pro) unless the owner says otherwise. Locked systems stay visible with a Pro badge.
6. Images: self-authored SVG diagrams (the `clinix-diagrams.js` pattern) for anatomy, pelvis, skull, charts; Wikimedia Commons CC0, CC BY, CC BY-SA or public domain photographs with recorded author and licence; AI-generated images (agy or Gemini) only after a factual check. Registered with `cleared: true` only when the licence is real.

## 4. Scope (roster in `docs/clinix/expansion-roster.json`: 98 diseases, tier 1 = 52, tier 2 = 46)
Tier 1 (first, the high-yield long and short cases):
- Obstetrics (10): antenatal care, anaemia in pregnancy, pre-eclampsia and eclampsia, gestational diabetes, placenta praevia, abruptio placentae, postpartum haemorrhage, preterm labour and PPROM, breech presentation, obstructed labour.
- Gynaecology (10): fibroid, abnormal uterine bleeding, endometriosis and adenomyosis, PCOS, carcinoma cervix, ovarian tumours, genital prolapse, vaginal discharge and PID, infertility, menopause.
- Paediatrics (12): malnutrition, rickets, acute diarrhoea and dehydration, pneumonia, nephrotic syndrome, febrile seizures and epilepsy, meningitis, neonatal jaundice, neonatal sepsis, birth asphyxia, anaemia and thalassaemia, rheumatic fever and congenital heart disease.
- Surgery (20): thyroid swelling, breast lump, inguinal hernia, acute appendicitis, intestinal obstruction, peritonitis and perforation, gallstones, obstructive jaundice, varicose veins, peripheral arterial disease and gangrene, ulcer, sinus fistula abscess, lymph node enlargement, BPH, urinary calculus, dysphagia and oesophageal carcinoma, colorectal carcinoma, anorectal conditions, acute pancreatitis, head injury.
Tier 2: the remaining roster entries (abortion, ectopic, post-term, twins, FGR, Rh, puerperal sepsis, cardiac disease, hyperemesis, caesarean; amenorrhoea, endometrial carcinoma, incontinence, GTD, CIN, contraception; asthma and bronchiolitis, AGN, UTI, TB, enteric/dengue/malaria, CP and development, Down syndrome, T1DM, prematurity, hypothyroidism; salivary, scrotal swellings, GI bleed, DVT, trauma, burns, stomach cancer, neck swellings, oral cancer, congenital anomalies).
Per subject also: skill pack(s) (examination, history, procedures, annexures), a subject OSCE and viva module (10 to 12 stations), 3 to 5 presentations, practicals decks, dx vocabulary additions, competency mapping, media.

## 5. Work packages and owners
| WP | Work | Worker | Depends on |
|---|---|---|---|
| 0 | Plan, roster, templates, validators, brief builder, manifest registrar | lead | |
| 1 | Skill packs: `paediatrics.json` (case sheet, development, diet, immunisation, anthropometry, SMR, system exams, neonatal exam, procedures, annexures), `surgery.json` (case taking, lump, ulcer, sinus, vascular, varicose, lymphatics, nerves, bone and joint basics, head and spine injury, hand, foot, neck, thyroid, breast, chest, dysphagia, acute and chronic abdomen, abdominal lump, rectal, urinary, hernia, genitalia, procedures), extend `obgyn.json` (labour, partograph, newborn, puerperium, gynae examinations, procedures) | agy (Gemini) per chapter group; claude-sonnet-4-6 via agy for review | 0 |
| 2 | Pilot: one disease per subject end to end (pre-eclampsia, fibroid, nephrotic syndrome, thyroid swelling), registered and viewed in the app | agy then lead review | 0, 1 (draft packs) |
| 3 | Tier 1 diseases in batches of 5 parallel workers | agy (Gemini 3.8 Flash High), muse spark for repairs | 1, 2 |
| 4 | Subject OSCE and viva modules, presentations, annexures, dx vocabulary | muse (when quota returns), agy | 1, 3 |
| 5 | Practicals decks (running now) and the Practicals runner in CliniX (+ Tokós atlas/spotter already building) | agy decks; muse wonder runner | schema (done) |
| 6 | Images: SVG diagrams, Commons CC photos, AI images for gaps | lead + agy | 1, 5 |
| 7 | Tier 2 diseases | agy | 3 |
| 8 | QA: validators on every file, `node --test test/clinix-*.test.mjs`, new per-subject content tests, UI runner `test/run-clinix-ui.mjs` extended per system, screenshots at 390/820/1194, independent verification pass (a second model checks 12 claims per disease against the KB and book), sample read by the lead | lead + agy (claude) | all |
| 9 | Delivery: one PR per subject behind the existing `smd_clinix` flag, owner review notes, OTA left to the owner | lead | 8 |

## 6. Validation gates (a deliverable is done only when all pass)
1. `tools/clinix-disease-validate.mjs`: `clinix-model.validatePack` on the pack plus the system's shared skills (schema, referential integrity, kinds, probes, rubric, sources), case schema, marking models present, 14 chapters (or the documented subset), OSCE stations reference real skills, viva skills real, ASCII punctuation, no lorem, copy-overlap against book text (7-word shingles, fail over 45 percent), numbers not found in KB or book flagged, `review.status = ai_drafted`, no unsourced doses (every `dosingNote` skill cites a source).
2. Existing suite: `node --test --experimental-test-module-mocks --experimental-sqlite test/clinix-*.test.mjs` unchanged and green.
3. Real headless Chrome UI runs per system: open system, open a disease, play a lesson turn, run the case, run an OSCE station, run viva; screenshots read by the lead.
4. Independent verification report per disease (claims checked against `kb/reference` and the book) with every mismatch resolved or listed in `unsure[]`.
5. Owner clinical review is the only step that can change `review.status`; nothing is marked reviewed by a worker.

## 7. Schedule (two working days, parallel)
- Day 1 morning: WP0, WP1 packs (agy x5), WP2 pilot; template fixes from pilot findings. Muse quota returns about 19:12 IST.
- Day 1 afternoon to night: WP3 tier 1 in batches (about 10 diseases per hour at 5 workers, validated as they land), WP4 and WP5 in parallel on muse, WP6 images.
- Day 2: finish tier 1, WP7 tier 2 as far as time allows, WP8 QA and screenshot review, WP9 PRs per subject.
Realistic output in two days: all four packs and OSCE modules, all 52 tier 1 diseases, practicals decks and runner, presentations; tier 2 partly.

## 8. Risks and mitigations
- Medical accuracy of generated content: KB grounding, citation requirement, numbers-not-in-source check, verification pass, `ai_drafted` label, owner review before any change of status.
- Copyright: facts only, own words, overlap check, no book images, Commons or AI images with recorded licences.
- Consistency across hundreds of files: validators and the brief bundle (exemplar plus skill catalogue) rather than free-form prompts.
- Throughput and quota (agy about 5 parallel, muse paused until 19:12 IST): queue runner with a concurrency cap; each disease is an independent job so failures are retried alone.
- Engine drift: new content kinds touch the engine only for Practicals and system registration; everything else is data.

## 9. Owner decisions (defaults chosen, all reversible)
1. Two systems for O&G (obstetrics, gynaecology) instead of one. Default: yes.
2. Pro lock on the new systems. Default: Pro, respiratory stays the free sample.
3. Doses: quoted only from a cited source with the CliniX `dosingNote`; book drug chapters are cited as an exam reference. Default: yes.
4. Disease priorities in the roster. Default: as listed; reorder freely.
5. AI-generated images allowed for gaps after a factual check. Default: yes.
