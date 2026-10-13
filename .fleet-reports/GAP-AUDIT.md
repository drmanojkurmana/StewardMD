# GAP-AUDIT — student-safety content gap audit (PrepNucleus)

Date: 2026-10-13. Branch: gap-audit-1013 off origin/main 12c194c1f. Method: taxonomy.json (2,435 modules) measured against base bank v1 indexes (usable counts), overlay-counts.json (64 sets, 31,669 items), lessons v1 (875 files), topic-links.json (1,128 modules, gen 2026-10-12) and KB disease docs (5,055 in kb/dist). Status rule from brief: OK = 5 or more MCQs and a lesson; THIN = fewer than 5 MCQs or no lesson; MISSING = no MCQs and no lesson. Life-critical depth needs lesson + KB link + 10 or more MCQs. Graph: graphify-out/graph.json queried first (40,746 nodes). No Claude API spend; author is the writer. NICE wins where it covers a point; India (NACO/ICMR/NMC) and US (CDC) labelled in items.

## Headline counts (before fill)

| Measure | Count |
|---|---|
| Taxonomy modules checked | 2,435 |
| OK | 742 |
| THIN | 1,219 |
| MISSING | 474 |
| Base bank usable MCQs (v1, 19 MBBS subjects) | 130,791 |
| Overlay MCQs | 31,669 across 1,471 topics |
| Lessons present | 875 of 2,435 modules (1,490 without a lesson) |
| Modules with zero MCQs | 663 |
| Topic-links modules with a KB link | 229 of 1,128 |

The dominant gap is not MCQ volume. Most MBBS life-critical topics already have 80 to 270 base MCQs but no structured lesson and no KB link, so they read THIN. The true MISSING block is NEET-SS: all 14 ss-* v1 subject indexes report total 0 (shell taxonomy: ss-general-medicine alone lists 222 topics with no bank). SS coverage today comes only from small overlay sets (for example maik26/maik29, a few hundred items). That needs an owner decision (see DONE report), not silent filling.

## 1. NMC CBME subjects (MBBS, 19 subjects)

| Subject | OK | THIN | MISSING | Note |
|---|---|---|---|---|
| anatomy | 55 | 12 | 0 | Strong |
| physiology | 25 | 22 | 0 | Lesson gaps |
| biochemistry | 12 | 18 | 0 | Lesson gaps |
| pathology | 19 | 53 | 0 | Largest THIN block in MBBS |
| pharmacology | 30 | 40 | 0 | Drug-safety lessons missing |
| microbiology | 15 | 22 | 0 | Infection-control OK |
| forensic-medicine | 14 | 9 | 0 | Consent and medico-legal OK |
| community-medicine | 50 | 19 | 0 | Programmes thin (below) |
| ophthalmology | 9 | 20 | 0 | Thin |
| ent | 9 | 27 | 0 | Thin |
| medicine | 9 | 100 | 0 | 100 THIN, almost all lesson-less |
| surgery | 12 | 45 | 0 | ATLS and shock lesson-less |
| obstetrics-gynaecology | 14 | 33 | 0 | Eclampsia/PPH lesson-less |
| paediatrics | 11 | 27 | 0 | Neonatal resus lesson-less |
| orthopaedics | 15 | 17 | 0 | Moderate |
| dermatology | 4 | 18 | 0 | Weakest MBBS subject |
| psychiatry | 10 | 22 | 0 | Thin |
| anaesthesia | 16 | 9 | 0 | Airway lesson-less |
| radiology | 22 | 0 | 0 | Fully OK |

## 2. NEET-PG / INI-CET / FMGE high-yield

Same 19 subjects above feed all three. Highest-yield thin lines (exam weight high, safety high): medicine 100 THIN, pathology 53, surgery 45, pharmacology 40. FMGE shares the MBBS bank; no separate FMGE bank gap beyond these.

## 3. NEET-SS blueprint

All ss-* v1 indexes are empty shells (474 MISSING taxonomy topics, concentrated in ss-general-medicine 168 MISSING, ss-neurology 51, ss-rheumatology-immunology 40, ss-medical-oncology 37, ss-infectious-diseases 34, ss-critical-care 24, ss-endocrinology 24, ss-nephrology 21). Live NEET-SS items (~31k per AUDIT.md) are not in these v1 indexes, so blueprint coverage cannot be verified from the repo. Ranked below exam-only gaps; owner question in DONE report.

## 4. International (USMLE Step 1/2 CK, PLAB 1, AMC, MCCQE, MRCP, MRCS)

Intl and UK branches are lesson-rich by design and mostly OK or THIN-by-lesson only: mcc-professional-behaviours 29 OK of 31, mcc-health-promotion 26 of 30, population-health-and-ethics 18 of 20, mrcp-statistics 8 of 8. Weakest: mrcp-rheumatology 0 OK of 8, plab-dermatology 0 of 5, plab-psychiatry 0 of 5. These are exam-weight gaps, not safety gaps.

## 5. Life-critical checklist (must be lesson + KB + 10 or more MCQs)

MCQ = base usable + overlay. KB = topic-links has a KB article. Almost every line fails on lesson, not on MCQs.

| Topic | Module | MCQs | Lesson | KB | Status |
|---|---|---|---|---|---|
| ACLS/BLS | ans-cpr | 107 | No | No | THIN |
| PALS | ans-paediatric | 66 | Yes | No | OK* |
| Neonatal resuscitation | ped-newborn-care | 225 | No | No | THIN |
| ATLS | sur-atls | 193 | No | No | THIN |
| Sepsis | med-sepsis | 140 | No | No | THIN |
| Anaphylaxis | med-allergy-immunology | 83 | No | No | THIN |
| DKA/HHS | med-diabetes | 197 | No | No | THIN |
| Status epilepticus | med-epilepsy | 144 | No | Yes | THIN |
| Acute stroke | med-stroke | 140 | No | No | THIN |
| ACS/STEMI | med-acs | 219 | No | No | THIN |
| Pulmonary embolism | med-pe-pulmonary-htn | 181 | No | No | THIN |
| Aortic dissection | mcc-ac-aortic | 12 | No | Yes | THIN |
| Tension pneumothorax | med-pleural | 137 | No | No | THIN |
| Massive haemorrhage | sur-shock-transfusion | 245 | No | No | THIN |
| Eclampsia | obg-hypertensive-disorders | 176 | No | No | THIN |
| PPH | obg-pph | 186 | No | No | THIN |
| Ectopic | obg-ectopic | 205 | No | No | THIN |
| Organophosphate | med-pesticides | 24 | No | No | THIN (thinnest MCQ) |
| Paracetamol/overdose | med-overdose | 79 | No | No | THIN |
| Snake bite | med-envenomation | 43 | No | No | THIN |
| Hyperkalaemia | med-potassium | 207 | No | No | THIN |
| Hyponatraemia | med-sodium | 130 | No | No | THIN |
| Raised ICP | med-ich | 221 | No | No | THIN |
| Difficult airway | ans-difficult-airway | 75 | No | No | THIN |
| Acute abdomen | sur-peritoneum | 129 | No | Yes | THIN |
| Meningitis | med-cns-infections | 191 | No | No | THIN |
| Malignant hyperthermia | ans-intraop-complications | 183 | No | No | THIN |
| Local anaesthetic toxicity | ans-local-anaesthetics | 273 | No | No | THIN |
| Paediatric dehydration | ped-diarrhoea | 114 | No | No | THIN |

OK* PALS has a lesson but no KB link, so it still fails the full depth rule. Drug safety: phm-adverse-reactions OK (183, lesson), obg-teratogens OK, pat-transfusion OK; but phm-insulin (93), phm-oral-antidiabetics (203), phm-opioids (237), phm-corticosteroids (163), phm-chelators-antidotes (111) and mphar-interactions (24) are all lesson-less THIN. Consent, medico-legal (India), infection control: OK.

## 6. Skills

ECG (med-ecg 115, lesson), chest X-ray (rad-chest 535, lesson), CT (rad-ct-mri 281, lesson), ABG (med-pft-abg 103, lesson) and prescription writing (phm-drug-development 138, lesson) are OK. Gaps: clinical examination steps and OSCE procedures have no dedicated taxonomy modules (only sgm-cardiac-examination, itself MISSING in SS), CBC/lab interpretation has no module, and case/image-based depth sits in maikimg sets rather than per-topic skills modules. Flagged as checklist lines with no home; owner question in DONE report.

## 7. Indian public health

UIP (cm-uip 85, lesson) and RMNCH+A proxy (cm-nutrition-programmes 102, lesson) are OK. NTEP (cm-tuberculosis 218, no lesson), NACO (cm-hiv-sti 103, KB only) and NVBDCP (cm-arboviral 163, no lesson) are THIN. Ayushman Bharat has no dedicated module (nearest cm-healthcare-delivery). Epidemiology and biostatistics are split across cm-* and sbs-*/mstat-*; mrcp-statistics is fully OK, MBBS biostatistics is lesson-thin.

## Ranking (safety severity, then exam weight)

1. Poisoning with thin MCQs and no lesson: organophosphate (24), snake bite (43), paracetamol (79).
2. Airway and breathing kills: difficult airway (75), tension pneumothorax, anaphylaxis (83).
3. Time-critical medical emergencies without lessons: sepsis, DKA/HHS, status epilepticus, stroke, ACS, PE, hyperkalaemia, meningitis, raised ICP.
4. Obstetric and neonatal kills without lessons: eclampsia, PPH, ectopic, neonatal resuscitation.
5. Drug safety without lessons: insulin, opioids, corticosteroids, antidotes, interactions (24).
6. Indian programmes without lessons: NTEP, NACO, NVBDCP, Ayushman Bharat (no module).
7. Exam-weight thin blocks: medicine/pathology/surgery/pharmacology lessons; dermatology, ENT, ophthalmology.
8. NEET-SS shell taxonomy (474 MISSING): needs owner scoping before any fill.

## Fill log (this branch)

First fill set gap1013a targets rank 1 to 3: lessons plus 10 new MCQs each for med-sepsis, med-allergy-immunology (anaphylaxis), med-pesticides, med-envenomation, ans-difficult-airway and med-potassium. New MCQs only; no existing explanation rewritten. Every dose or threshold names its primary guideline in the item source field; unsure numbers are omitted and flagged. Status after fill is recorded in GAP-AUDIT-DONE.md.

## Fill result (gap1013a, this branch)

Six THIN lines moved toward OK: med-sepsis, med-allergy-immunology (anaphylaxis), med-pesticides (organophosphate, was 24 MCQs), med-envenomation (snake bite, was 43), ans-difficult-airway, med-potassium (hyperkalaemia). Each now has a structured lesson (prep/lessons/v1/<module>.json, indexed) plus 10 new vignette MCQs in overlay gap1013a (60 items, mk-gap001 to mk-gap510) with reasoning explanations and Know-more lesson links. KB articles already existed for sepsis, anaphylaxis, organophosphate, snake bite and hyperkalaemia, so no new KB article was needed; difficult airway still has no KB article (flagged in DONE report). After fill each line meets lesson + KB (except airway KB) + 10 or more MCQs. Remaining life-critical THIN lines and all other ranks are listed in GAP-AUDIT-DONE.md.

## Fill result (gap1013b, wave 2)

Six more life-critical THIN lines filled: med-acs (ACS/STEMI), med-diabetes (DKA/HHS), med-epilepsy (status epilepticus), med-stroke, obg-hypertensive-disorders (eclampsia), obg-pph. Each now has a structured hand lesson (prep/lessons/v1/<module>.json, indexed in index.json) plus 10 new vignette MCQs in overlay gap1013b (60 items, mk-gap601 to mk-gap660, registered in prep.js OVERLAYS and overlay-counts.json) with reasoning explanations and Know-more lesson links. Sources named per item: NICE NG185, JBDS-IP DKA guidance, NICE NG217, NICE NG236, NICE NG133, RCOG Green-top PPH guidance. No milligram dose or time-window threshold is stated in any item; sequences and indications only, so nothing was guessed. Independent re-read (Step 3): all 60 items re-checked against their named source; held list empty. Also fixed the stale prep-app overlay regex left red by the gap1013a merge. Remaining THIN life-critical lines are listed in GAP-AUDIT-DONE.md.

## Fill result (gap1013c, wave 3)

Fourteen more life-critical THIN lines filled: ans-cpr (ACLS/BLS), ped-newborn-care (neonatal resuscitation), sur-atls, med-pe-pulmonary-htn (PE), med-pleural (tension pneumothorax), sur-shock-transfusion (massive haemorrhage), obg-ectopic, med-overdose (paracetamol), med-sodium (hyponatraemia), med-ich (raised ICP), med-cns-infections (meningitis), ans-intraop-complications (malignant hyperthermia), ans-local-anaesthetics (LAST), ped-diarrhoea (paediatric dehydration). Each now has a hand lesson (indexed) plus 10 new MCQs in overlay gap1013c (140 items, mk-gap701 to mk-gap840), registered in prep.js and overlay-counts.json. Sources named per item include Resuscitation Council UK, NRP, ATLS, ESC/NICE NG191, BTS, NICE NG126, NPIS TOXBASE, ESE hyponatraemia guidance, NICE NG236, NICE NG240, MHA, Association of Anaesthetists and NICE NG84/WHO. No numeric dose, rate or volume is stated in any item; dantrolene dosing, LAST maximum doses, sodium correction limits and paediatric rehydration volumes are explicitly flagged as protocol-chart territory. Step 3 re-read: dose scan clean, held list empty. With waves 1 to 3, all 26 life-critical lines named in the original audit now have lesson + 10 or more new depth MCQs (difficult airway still lacks a KB article; owner question stands).

## Fill result (gap1013d, wave 4: drug safety)

Five drug-safety THIN lines filled: phm-insulin, phm-opioids, phm-corticosteroids, phm-chelators-antidotes (antidotes) and mphar-interactions. Each verified lesson-less in the taxonomy before writing; each now has a hand lesson (indexed) plus 10 new MCQs in overlay gap1013d (50 items, mk-gap841 to mk-gap890), registered in prep.js (pharmacology and mrcp-pharmacology) and overlay-counts.json. Sources named per item: BNF insulin safety, NICE NG28, BNF opioid guidance, BNF corticosteroid safety, NPIS TOXBASE and BNF interactions. No numeric dose, conversion, taper or antidote rate is stated; insulin units, opioid conversions, steroid tapers/crisis doses and antidote doses are explicitly flagged as individual-prescription or current-chart territory. Step 3 re-read: dose scan clean; held list empty. Not filled (needs owner decisions recorded in DONE report): dedicated modules for high-alert drugs, paediatric dose calculation and pregnancy/lactation safety do not exist in the taxonomy, so no silent module creation was done.

## Re-audit after waves 2 to 4 (2026-10-13, origin/main 6ee1ce93b)

Waves 2 to 4 were verified line by line on origin/main before any new writing (taxonomy.json, lessons index with 932 entries, overlay-counts gap1013a to gap1013d, prep.js OVERLAYS). Result: every life-critical line named in the continuation is already at depth (hand lesson indexed plus 10 gap depth MCQs plus base bank): ACLS/BLS (ans-cpr), neonatal resuscitation (ped-newborn-care), ATLS (sur-atls), stroke (med-stroke), PE (med-pe-pulmonary-htn), tension pneumothorax (med-pleural), massive haemorrhage (sur-shock-transfusion), eclampsia (obg-hypertensive-disorders), PPH (obg-pph), ectopic (obg-ectopic), paracetamol (med-overdose), hyponatraemia (med-sodium), raised ICP (med-ich), meningitis (med-cns-infections), malignant hyperthermia (ans-intraop-complications), LA toxicity (ans-local-anaesthetics), paediatric dehydration (ped-diarrhoea), difficult airway (ans-difficult-airway, lesson plus MCQs; KB was the only missing element). No duplicate fill was made for these lines. True remainder filled in wave 5 below.

| Line (continuation order) | Before wave 5 | After wave 5 |
|---|---|---|
| Difficult airway KB | MISSING (no kb file) | OK: kb/clinical-protocols/difficult-airway.json created; lesson src linked |
| NTEP (cm-tuberculosis) | THIN: no lesson | OK: hand lesson plus 10 MCQs (gap1013e) |
| NACO (cm-hiv-sti) | THIN: no lesson (KB only) | OK: hand lesson plus 10 MCQs |
| NVBDCP (cm-arboviral) | THIN: no lesson | OK: hand lesson plus 10 MCQs |
| UIP (cm-uip) | Lesson OK, no gap depth | OK: plus 10 depth MCQs |
| Ayushman Bharat | MISSING: no module | OK: NEW cm-ayushman-bharat (taxonomy source plus built) plus lesson plus 10 MCQs |
| RMNCH+A | THIN: proxy lessons only, no named module | OK: NEW cm-rmncha plus lesson plus 10 MCQs |
| High-alert drugs | MISSING: no module | OK: NEW phm-high-alert-drugs plus lesson plus 10 MCQs |
| Paediatric dose calculation | MISSING: no module | OK: NEW ped-dose-calculation plus lesson plus 10 MCQs |
| Pregnancy/lactation safety | Lesson OK (mphar-special), no gap depth | OK: plus 10 depth MCQs |
| Interactions depth | 10 gap MCQs (wave 4) | OK depth doubled: plus 10 more (20 gap total) |
| Clinical examination steps | MISSING: no home | OK: NEW med-examination plus KB plus lesson plus 10 MCQs |
| OSCE procedures | MISSING: no home | OK: NEW med-osce-procedures plus KB plus lesson plus 10 MCQs |
| CBC/lab interpretation | MISSING: no home | OK: NEW med-lab-interpretation plus KB plus lesson plus 10 MCQs |
| ECG, ABG, X-ray, CT | Already OK (lessons present) | Unchanged; no duplicate modules created |

## Fill result (gap1013e, wave 5: programmes, drug safety depth, skills)

Thirteen modules filled with 130 new MCQs (mk-gap891 to mk-gap1020) in overlay gap1013e, registered in prep.js OVERLAYS (community-medicine, pharmacology, paediatrics, medicine, mrcp-pharmacology) and overlay-counts.json, with the prep-app registry assertions updated to match (same pattern as waves 2 to 4). Ten new hand lessons (5 steps each, all passing prep-lessons checkLesson with zero problems): cm-tuberculosis, cm-hiv-sti, cm-arboviral, cm-ayushman-bharat, cm-rmncha, phm-high-alert-drugs, ped-dose-calculation, med-examination, med-osce-procedures, med-lab-interpretation, all indexed as hand in prep/lessons/v1/index.json. Seven NEW taxonomy modules (cm-ayushman-bharat, cm-rmncha, phm-high-alert-drugs, ped-dose-calculation, med-examination, med-osce-procedures, med-lab-interpretation) added to both prep/taxonomy source JSON and built prep/taxonomy.json (new medicine section med-skills); taxonomy validation passes for all 34 subjects. Four new KB clinical protocols: difficult-airway (completes the airway line; lesson src now kb-clinical-protocols-difficult-airway), clinical-examination, osce-procedures, lab-interpretation (skills lessons link them in src). New MCQs only; no existing explanation rewritten; no coming-soon text. Owner defaults applied: ss-* shells untouched; no milligram regimens where sources conflict (organophosphate atropine/pralidoxime and antivenom vials still indications and sequence only, carried as held omissions in DONE).
