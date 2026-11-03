# Lane A State: Super-Speciality Lessons

- **Lane**: A
- **Session Started**: 2026-11-03
- **Current Subject**: Medical Oncology (`ss-medical-oncology`)
- **Current Stage**: Stage 1 (Blueprint & Taxonomy)
- **Subject Order**:
  1. Medical Oncology (`ss-medical-oncology`)
  2. Cardiology (`ss-cardiology`)
  3. Gastroenterology (`ss-gastroenterology`)
  4. Radiology (`ss-radiology` — ~670 radbook/ctcbook lessons exist, map to blueprint first and fill gaps)
  5. Neurology (`ss-neurology`)
  6. Nephrology (`ss-nephrology`)
  7. Endocrinology (`ss-endocrinology`)
  8. Critical Care (`ss-critical-care`)
  9. Rheumatology + Clinical Immunology (`ss-rheumatology-immunology`)

## Progress Summary
| Subject | Stage 1 (Blueprint & Taxonomy) | Stage 2 (Lessons Written) | Coverage Pass | Gates Pass | PR Link |
|---|---|---|---|---|---|
| ss-medical-oncology | In progress | Pending | Pending | Pending | - |
| ss-cardiology | Pending | Pending | Pending | Pending | - |
| ss-gastroenterology | Pending | Pending | Pending | Pending | - |
| ss-radiology | Pending | Pending | Pending | Pending | - |
| ss-neurology | Pending | Pending | Pending | Pending | - |
| ss-nephrology | Pending | Pending | Pending | Pending | - |
| ss-endocrinology | Pending | Pending | Pending | Pending | - |
| ss-critical-care | Pending | Pending | Pending | Pending | - |
| ss-rheumatology-immunology | Pending | Pending | Pending | Pending | - |

## Initial Gates & Tooling Setup
- [x] Initial Dark-Mode Lesson Card Bug Fix (`prep-pearl.css:21`, follow `body.dark`) -> PR #1890 opened
- [x] Cherry-pick Gate 2 & Gate 3 tools from Lane B (`commit a5d765940`)
- [x] Initialise Lane A `STATE.md`

## Next Immediate Steps (Medical Oncology)
1. Examine book sources for Medical Oncology: DeVita, Harrison Oncology, precision-oncology / pharmacology reviews, ESMO / NCCN guidelines.
2. Check existing Medical Oncology taxonomy in `prep/taxonomy/` / `taxonomy.json` / `taxonomy-extra.json` and MCQ bank counts.
3. Write `prep/blueprints/ss/ss-medical-oncology.json` (40-120 high-yield topics, 8-15 mustKnow facts per topic with citations).
4. Update taxonomy so modules match the blueprint (never rename/delete existing module IDs).
5. Open Stage 1 PR (Blueprint & Taxonomy) for review.
