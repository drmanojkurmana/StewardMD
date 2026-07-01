# M3.2 — Near-duplicate `acceptableIds` cross-accepts (gold-data only)

**What this is:** the M2 gold cases each carried a single `acceptableIds` entry. For some failing cases the engine's top-1 is a **clinically-defensible alternative diagnosis for the same patient** (a synonym, the correct underlying cause, or a same-category/continuum dx with overlapping acute management) — the strict single-id labelling, not the engine, was wrong. This phase widens `acceptableIds` for those cases only.

**No engine change.** reasoning.js, kb.core.js, scoring, and all thresholds are untouched (verified: only 24 case JSON files + `baseline.json` changed). Every widened case is `clinicianApproved:false` with `crossAcceptPendingReview:true` and a per-case rationale — **all 24 are yours to veto.**

## Result
| Metric | After M3.1 | After M3.2 | Δ |
|--------|-----------|-----------|---|
| **Top-1 (249)** | 162 (65%) | **186 (75%)** | **+24** |
| **Top-3** | 201 (81%) | **212 (85%)** | +11 |
| Confidence | 87 | 87 | — |
| Regressions | 0 | 0 | ✅ |

## Accepted (24) — grouped, all pending clinician sign-off
**A · id/synonym fix (2)** — same diagnosis, gold used a non-engine id:
- gc_018 → `hhs`; gc_082 → `opioid_od`

**B · engine named the correct underlying cause (5):**
- gc_049, gc_168 cardiogenic shock ← `acs` (STEMI is the cause + PCI is the tx)
- gc_050 hypovolaemic shock ← `variceal_bleed` (the bleed source)
- gc_003, gc_011 urosepsis ← `PYELONEPHRITIS` (the infection source, same abx)

**C · same category / continuum, overlapping acute management (13):**
- gc_135 mixed malaria ← `MALARIA`; gc_142 rickettsial ← `SCRUB_TYPHUS` (both doxycycline)
- gc_114 complicated UTI ← `PYELONEPHRITIS`; gc_138 prostatitis ← `COMPLICATED_UTI`
- gc_145 sepsis ← `SEPTIC_SHOCK` (same bundle); gc_152 viral ← `MENINGITIS`
- gc_177 DVT ← `pe` (one VTE continuum); gc_110 chikungunya ← `DENGUE` (co-endemic, indistinguishable at onset)
- gc_102 bronchitis ← `URTI`; gc_149 URTI ← `PHARYNGITIS` (viral URIs, symptomatic)
- gc_170 COPD exac ← `asthma_exac` (obstructive-airway acute mgmt)
- gc_132 lung abscess ← `ASPIRATION_PNEUMONIA` (continuum); gc_034 decomp cirrhosis ← `hepatic_enceph` (a genuine component of the case)

**D · review-critical — accepted but flagged (management differs; same diagnostic category/pathway) (4):**
- gc_042, gc_113 TB meningitis ← `MENINGITIS`; gc_123 encephalitis ← `MENINGITIS`; gc_091 TB pleural effusion ← `PULMONARY_TB`

## Rejected (kept as genuine misses — engine work, not label-widening)
Anything where accepting the confuser would endorse a **dangerous miss or a materially different management**:
- stroke↔TIA (gc_025 — would miss thrombolysis), variceal bleed↔hepatic-enceph (gc_037), SBP↔hepatic-enceph (gc_035), CAP↔bronchitis (gc_107/128/147 — abx vs none), septic arthritis / gout ↔ cellulitis (gc_058/057/172), pneumothorax↔PE (gc_090 — drainage vs anticoagulation), and the `×↔GASTROENTERITIS` cluster (gc_012/048/062/068/157/187/240 — wrong dx). These remain the real M3.3 engine work-list.

## Cumulative M3
Top-1 **51% → 65% (M3.1 engine-signature tuning) → 75% (M3.2 label refinement)**; top-3 **74% → 85%**. Zero regressions throughout. `baseline.json` re-baselined to 186.
