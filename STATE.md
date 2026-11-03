# Lane A State: Super-Speciality Lessons

- **Lane**: A
- **Session Started**: 2026-11-03
- **Current Subject**: Medical Oncology (`ss-medical-oncology`)
- **Current Stage**: Stage 2 (Lessons Authoring)
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
| ss-medical-oncology | Done (PR #1891) | In progress | Pending | Pending | PR #1891 (Stage 1) |
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
- [x] Medical Oncology Stage 1: Blueprint written (91 topics, 728 mustKnow facts, DeVita 12e / Harrison 22e / guidelines) -> PR #1891 opened
- [x] Updated `.fleet-reports/SS-QUEUE.md` with `blueprint: A-done (PR #1891)`

## Lane A Topic Allocation (Medical Oncology, index i % 3 == 0)
Total topics: 91. Lane A has 31 topics:
- [x] 0. `son-hallmarks`: Hallmarks of cancer and carcinogenesis (existing lesson)
- [x] 3. `son-tumour-markers`: Tumour markers (existing lesson)
- [x] 6. `son-epidemiology`: Cancer epidemiology, prevention and screening (existing lesson)
- [x] 9. `son-antimetabolites`: Antimetabolites (existing lesson)
- [x] 12. `son-monoclonals-adc`: Monoclonal antibodies and antibody drug conjugates (existing lesson)
- [x] 15. `son-hormonal`: Endocrine therapy in oncology (existing lesson)
- [x] 18. `son-radiation-principles`: Radiation oncology for the medical oncologist (existing lesson)
- [ ] 21. `son-nsclc-driver`: Oncogene addicted NSCLC
- [ ] 24. `son-mesothelioma-thymic`: Mesothelioma and thymic tumours
- [x] 27. `son-breast-her2`: HER2-positive breast cancer (existing lesson)
- [ ] 30. `son-breast-special`: Special situations in breast cancer
- [ ] 33. `son-crc-metastatic`: Metastatic colorectal cancer
- [ ] 36. `son-hcc`: Hepatocellular carcinoma
- [ ] 39. `son-net`: Neuroendocrine neoplasms
- [ ] 42. `son-bladder`: Urothelial carcinoma
- [x] 45. `son-penile-adrenal`: Penile and adrenal cancers (existing lesson)
- [ ] 48. `son-endometrium`: Endometrial cancer
- [ ] 51. `son-npc-salivary`: Nasopharyngeal and salivary gland cancers
- [ ] 54. `son-melanoma`: Melanoma
- [x] 57. `son-bone-sarcoma`: Bone sarcomas (existing lesson)
- [ ] 60. `son-aml`: Acute myeloid leukaemia
- [ ] 63. `son-cml`: Chronic myeloid leukaemia
- [ ] 66. `son-hodgkin`: Hodgkin lymphoma
- [ ] 69. `son-tcell`: T cell and NK cell lymphomas
- [x] 72. `son-paeds`: Paediatric solid tumours (existing lesson)
- [x] 75. `son-cardio-oncology`: Cardio-oncology (existing lesson)
- [x] 78. `son-organ-tox`: Organ-specific toxicities of cytotoxics (existing lesson)
- [x] 81. `son-infusion-extravasation`: Infusion reactions, hypersensitivity and extravasation (existing lesson)
- [ ] 84. `son-paraneoplastic`: Paraneoplastic syndromes
- [ ] 87. `son-bone-mets`: Bone metastases and skeletal related events
- [ ] 90. `son-effusions-nutrition`: Malignant effusions, cachexia and nutrition

Total to author for Lane A: 17 lessons. Batch PRs of up to 25 lessons.
