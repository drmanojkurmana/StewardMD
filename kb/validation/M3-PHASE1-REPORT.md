# M3.1 — Non-infective ranking tuning (data-driven, engine-logic untouched)

**Objective (M3):** improve Dx-My-Patient ranking, measured against the M2 gold library. This phase tunes the **non-infective disease signatures** (`find` weight maps) so a disease ranks #1 on its own classic presentation, without changing any engine logic and without regressing other cases.

## Result
| Metric | Baseline | After M3.1 | Δ |
|--------|----------|-----------|---|
| **Top-1 (249 cases)** | 127 (51%) | **162 (65%)** | **+35** |
| **Top-3** | 185 (74%) | **201 (81%)** | +16 |
| Avg confidence | 85 | 87 | +2 |
| Antibiotic correctness | 70% | 70% | — |
| **Regressions (correct→wrong)** | — | **0** | ✅ |

## What changed
- **37 non-infective disease `find`-maps** enriched with their *discriminative* findings (present in the classic case, specific vs the confuser). Examples: TTP/HUS (MAHA+thrombocytopenic bleeding+renal), aortic stenosis (`newMurmur`), asthma (`wheeze` — also fixed a stale `cough`→`coughRadio` key mismatch), organophosphate (cholinergic `diarrhea`/secretions vs opioid), myxoedema (`bradycardia`/`bradypnea`), SVC obstruction (malignancy+lymphadenopathy+dysphagia), pheochromocytoma (`headacheSevere`), hyperthyroidism, ITP-vs-DIC via `inr`, etc.
- **5 targets deliberately declined** (`aki`, `ckd`, `cardiogenic_shock`, `subdural`, `ischemic_stroke`): their would-be discriminators are **shared with sibling diseases** (renal labs across all nephropathies; vascular risk factors across strokes) or the target is already clamp-saturated. Boosting them over-fires on siblings — no safe `find` change exists. These need either the near-duplicate `acceptableIds` treatment or engine-logic work, deferred.

## Method (reproducible)
1. Categorised the 120 failing targets → 41 non-infective (find-tunable, this phase) vs 79 infective (parity-constrained, later).
2. One agent per target proposed a `find` delta (analysis only; looked up its case by `targetId`, constrained to valid vocab keys the case exhibits, discriminative vs the confuser).
3. Applied to **both** signature copies — `kb/diseases/<id>.json` (→ `kb.core.js`, the runtime source of truth) and the reasoning.js DDX_NI fallback closure — via `kb/tools/apply-m3-ni.mjs`; rebuilt `kb.core.js`.
4. **Measured the full 249-case benchmark; bisected out every regression** (9 → 2 → 0 across three iterations) by removing shared/non-specific findings from the offending deltas.

## Engine-safety
- **`kb-parity`: all 51 infective syndromes `match()`/`baseScore()` byte-identical** — no infective logic touched.
- `main-engine` GREEN, `reason-api` GREEN.
- `golden`: 14 deliberate NI re-ranks (e.g. `ttp` now correctly leads NI over DIC); **no infective lead changed**. Rebaselined intentionally.
- `baseline.json` re-baselined to the new 162 top-1 for future regression protection.
- No engine scoring/gate logic was modified — this is purely disease-signature data (weights) + rebuilt artifacts. Recovery tag `reasoning-m3-baseline` remains the rollback point.

## Where M3 stands
- Non-infective ranking: **65% top-1 / 81% top-3** (from 51%/74%).
- Remaining work: **79 infective** failing targets (severity gradations like CAP-vs-bronchitis, and near-duplicate cross-accepts like MIXED_MALARIA↔MALARIA / CNS_TB↔MENINGITIS / SEPSIS↔SEPTIC_SHOCK) — the near-duplicates are gold-data `acceptableIds` fixes (clinician-reviewable), the rest need parity-safe `score`/`rule` tuning.
