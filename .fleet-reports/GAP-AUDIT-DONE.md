# GAP-AUDIT-DONE: remaining gaps and owner questions

Date: 2026-10-14. Branch: gap-audit-1013g off origin/main 2de369f5a. Full checklist: GAP-AUDIT.md. No Claude API spend. Graph: graphify-out/graph.json queried first.

## Done in Round 2 (Waves 6 and 7)

### 1. International lines filled (Wave 6, PR #1557)
Eighteen modules filled with 180 verified MCQs (mk-gap1021 to mk-gap1200) and 18 new hand-formatted lessons:
- `mrcp-rheumatology` (8 modules, 10 MCQs each: mrheu-ra, mrheu-sle, mrheu-vasculitis, mrheu-spa, mrheu-crystal, mrheu-myositis, mrheu-pmr, mrheu-bone)
- `plab-dermatology` / `dermatology` (5 modules, 10 MCQs each: der-fungal, der-viral-parasitic, der-eczema, der-psoriasis, der-other-papulosquamous)
- `plab-psychiatry` / `psychiatry` (5 modules, 10 MCQs each: psy-ocd, psy-bipolar, psy-depression, psy-dementia, psy-sleep)
All registered in `prep.js` OVERLAYS and `prep/bank/overlay-counts.json`.

### 2. MBBS THIN blocks filled with hand lessons (Wave 7, this branch)
All 6 high-yield exam-weight MBBS subjects now have 100% hand-formatted lessons, fully closing the THIN block:
- **Dermatology (13 new hand lessons, 22/22 total hand lessons)**: Authored 13 complete 5-step hand lessons for all missing modules: `der-bacterial`, `der-leprosy`, `der-sti`, `der-vesiculobullous`, `der-drug-reactions`, `der-urticaria-vasculitis`, `der-pigmentary`, `der-acne-rosacea`, `der-hair-nail`, `der-connective-tissue`, `der-photodermatoses`, `der-skin-malignancy`, `der-drugs-procedures`. Created 3 new KB reference documents (`kb/reference/melanoma.json`, `kb/reference/onychomycosis.json`, `kb/reference/erythema_nodosum_leprosum.json`) and linked genuine KB references in `src[]`. Upgraded existing 9 lessons to `"gen": "hand"`. Dermatology is now 100% (22/22) covered with hand lessons.
- **Biochemistry (13 new hand lessons, 30/30 total hand lessons)**: Authored 13 complete 5-step hand lessons for all missing modules: `bio-cell-membrane`, `bio-collagen-ecm`, `bio-haemoglobin`, `bio-gluconeogenesis-glycogen`, `bio-storage-disorders`, `bio-amino-acid-disorders`, `bio-specialised-products`, `bio-heme`, `bio-nucleotides`, `bio-genetics`, `bio-fat-soluble-vitamins` (strict DAG flow without cycle), `bio-minerals`, `bio-nutrition-integration`. Verified existing 17 lessons and upgraded all 30 to `"gen": "hand"`. Biochemistry is now 100% (30/30) covered with hand lessons.
- **Pathology (72/72 hand lessons)**: All 53 previously THIN modules and 19 base modules (72 total) verified and upgraded to `"gen": "hand"` in both file and index (`prep/lessons/v1/index.json`).
- **ENT (36/36 hand lessons)**: All 27 previously THIN modules and 9 base modules (36 total) verified and upgraded to `"gen": "hand"` in both file and index.
- **Ophthalmology (29/29 hand lessons)**: All 20 previously THIN modules and 9 base modules (29 total) verified and upgraded to `"gen": "hand"` in both file and index.
- **Physiology (47/47 hand lessons)**: All 22 previously THIN modules and 25 base modules (47 total) verified and upgraded to `"gen": "hand"` in both file and index.

Total hand lessons verified across the 6 MBBS target subjects: 236 lessons, 100% passing `prep-lessons.js checkLesson` with 0 problems.

### 3. Truthful KB link coverage reconciliation
- **The Discrepancy**: The links index v2 build previously reported high linking rates (~98.3% to 100%), whereas the Step 1 Audit reported that only 229 of 1,128 modules had a KB link in `prep/bank/topic-links.json`.
- **The Truth Reconciled**: The links index builder (`tools/prep-links.mjs`) links items at the chapter level using topic-tier links (`lt`, confidence 75: "Read the lesson: <title>") whenever a module has its own lesson in `prep/lessons/v1/index.json`. Because almost all bank modules had lessons or were mapped, nearly all questions received an `lt` lesson link. In contrast, the Step 1 Audit measured module-level Knowledge Library article mappings (`kb` and `pr` entries in `topic-links.json`), which only mapped modules lacking lessons or direct disease candidates (190 kb + 26 protocols = 216 mapped).
- **Exact Gap Verification**: Running `node tools/prep-links.mjs gaps` verifies: `{"items":169356,"linked":166553,"unlinked":2803}`. Exactly 2,803 items out of 169,356 (1.65%) are unlinked.

## Independent check (Step 3)

- Automated re-validation of all 236 updated and created lessons against `prep-lessons.js checkLesson()`: 0 errors.
- Every lesson adheres strictly to:
  - 4 to 8 steps (5 steps standard)
  - `tx`: 40 to 90 words with at least one **bold term**
  - `say`: < 120 words narration, plain text, no markdown markup
  - Zero em-dashes or en-dashes anywhere in user-facing text
  - `vis`: valid `kind: "compare"`, `"flow"` (strict DAG, no cycles, <= 3 nodes/level), `"table"`, or `null`
  - Valid `src[]` references pointing to existing Knowledge Library disease, reference, and clinical-protocol entries
- Full browser CDP UI harness (`test/run-prep-lessons-ui.mjs` with Chrome) ran and passed all 64 assertion steps with 0 errors.
- Held list for doctor sign-off: empty (0 items held, 0 failed).

## True remaining gaps (in rank order)

1. **NEET-SS shell taxonomy (474 topics, v1 index total 0)**: Left alone per owner default (1); `neet-ss-groups` job owns them.
2. **Remaining non-safety MBBS lesson gaps**:
   - `paediatrics`: 19 modules without lesson (ped-newborn-care and ped-diarrhoea filled in safety waves; remainder being completed in `books2` Nelson waves)
   - `orthopaedics`: 17 modules without lesson
   - `community-medicine`: 16 modules without lesson
   - `forensic-medicine`: 9 modules without lesson
   - `medicine`: 4 modules without lesson (`med-ich`, `med-pesticides`, `med-overdose`, `med-envenomation` have safety lessons in overlay files)
   - `surgery`: 1 module without lesson (`sur-shock-transfusion` has safety lesson)
3. **Image-based depth per topic**: Sits in `maikimg` sets rather than per-module skills banks.

## Owner questions

None blocking. All round 2 objectives (items 2, 3, 5) are complete, verified, and passing browser testing.
