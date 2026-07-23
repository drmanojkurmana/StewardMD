# KardiQ X (kardiox-image v2) — Patient-Safety-First Engineering, Clinical, Data & Regulatory Roadmap

**Honesty preamble (read first).** The LIVE model is a single EfficientNet-B3 that reads a PHOTO of a 12-lead ECG end-to-end (no digitiser), trained on 12,000 clean PTB-XL matplotlib renders. **The only honest headline is this: no real-phone-photo performance has ever been measured, so the deployable real-world metric is currently UNKNOWN.** Every internal number is a reference figure, not a claim of clinical performance:

- Internal-clean macro-AUROC 0.947 and photo-DISTORTED synthetic-proxy macro-AUROC 0.893 are LABORATORY REFERENCES on synthetic renders only. They are demoted throughout this document and must never be quoted as the product's performance.
- Threshold, sensitivity, specificity, PPV/NPV and calibration have NEVER been computed. A device with no operating point has no known false-negative rate.
- Two of 19 declared classes (STTC, LAD) are dead (effective classes = 17); labels carry `min_conf=0.0` noise; probabilities are uncalibrated (BCE `pos_weight` up to 20x); and the engine outputs ZERO acute emergencies.

Because AUROC is prevalence- and threshold-independent, it HIDES poor recall on the rare, lethal classes that matter most. Therefore, at every stage below, results LEAD with per-class **measured sensitivity and PPV/NPV at the deployed operating point and the intended-setting prevalence**, and macro-AUROC is reported only as a secondary lab reference. Diagnoses are ordered by PATIENT SAFETY (lethality × time-criticality × cost-of-a-miss). Every acute output is framed as "ECG suggests / cannot exclude," never "diagnoses." Every performance figure not explicitly labeled MEASURED is a PROJECTION with wide uncertainty, and any projection resting on data that does not yet exist openly is additionally labeled CONTINGENT.

**Declared 19-class output list (with current status).** ACTIVE = trained and emitting; DEAD = declared but structurally never fires; the roadmap must never claim a class the model cannot output.

1. NORM (ACTIVE — highest-risk output; see NORM guardrail G1)
2. AFIB (ACTIVE)
3. STACH (ACTIVE)
4. SBRAD (ACTIVE)
5. 1AVB — first-degree AV block (ACTIVE)
6. CRBBB (ACTIVE)
7. IRBBB (ACTIVE)
8. CLBBB (ACTIVE)
9. LAFB (ACTIVE)
10. IMI (ACTIVE — weak, 0.898 lab)
11. AMI (ACTIVE — weakest, 0.885 lab)
12. ASMI (ACTIVE)
13. LVH (ACTIVE)
14. ISC_ (ACTIVE)
15. STTC (DEAD — superclass, not a raw scp_code)
16. NDT (ACTIVE)
17. PVC (ACTIVE)
18. PAC (ACTIVE)
19. LAD (DEAD — read from wrong field)

Effective ACTIVE classes = 17. Every one of the 17 (including the incidentally-mentioned NORM, 1AVB, PAC/SVPB, PVC/VPB, ASMI) carries an explicit operating-point + measured-FN-rate commitment in Sections 5–6; none is exempt.

---

## SECTION 1 — COMPLETE GAP ANALYSIS

### 1A. Diagnostic coverage gaps, ordered by patient safety (most dangerous first)

All per-class positive counts in this table are **CLAIMS-TO-VERIFY** (re-counted from the actual label files before they drive any go/no-go), not confirmed facts — see Section 4D. They are individually plausible but several gate hard feasibility verdicts, so a wrong count flips a decision.

| Rank | Target | Current state | Gap severity | Root cause (count = to-verify) |
|---|---|---|---|---|
| 1 | STEMI | Not an output — 100% missed | CRITICAL | No native public STEMI label; mm-criteria themselves miss ~⅓ occlusions |
| 2 | OMI (De Winter, Wellens, hyperacute-T) | Not an output — 100% missed | CRITICAL | No OPEN angiographic label anywhere; subtlest morphology (worst for photo) |
| 3 | VF | Not an output — 100% missed | CRITICAL but modality-mismatched | VF lives on 1–2 lead monitor/AED strips, not standing 12-lead photos |
| 4 | VT | Not an output — 100% missed | CRITICAL | Only tens–low-hundreds of clean 12-lead positives publicly (to-verify) |
| 5 | Complete heart block (3AVB) | Not an output — 100% missed | HIGH | ~127 public / ~16 PTB-XL (to-verify) |
| 6 | Hyperkalemia | Not an output — 100% missed | HIGH | ECG intrinsically insensitive (~⅓–½ silent); needs MIMIC+K⁺ labels |
| 7 | Atrial flutter | Not an output — 100% missed | HIGH | PTB-XL ~73 / CinC ~8,374 (to-verify) |
| 8 | WPW / pre-excitation | Not an output — 100% missed | HIGH | PTB-XL ~70 (to-verify) |
| 9 | Long QT / QTc prolongation | Not an output — 100% missed | HIGH | Phenotype only (~1,907 CinC, to-verify); syndrome unlabelable |
| 10 | Brugada | Not an output — 100% missed | HIGH | ~76 open positives (HUCA, to-verify); PTB-XL has none |
| 11 | PE (right-heart-strain) | Not an output — 100% missed | HIGH ceiling-limited | ECG insensitive/nonspecific; no CTPA-linked public label |
| 12 | Pericarditis | Not an output — 100% missed | MODERATE (STEMI-mimic danger) | No public label; STEMI/early-repol confounding |
| 13 | High-risk ischemia / NSTEMI | ISC_ exists; STTC DEAD | MODERATE | STTC superclass bug; troponin-linked label absent |
| 14 | AFIB | ACTIVE | LOW (data-rich) | Flutter confuser not modeled; no rate/RVR sub-label |
| 15 | Complete BBB (CLBBB/CRBBB) | ACTIVE | LOW | Strong; but hides ischemia (false reassurance) |
| 16 | LVH / RVH | LVH ACTIVE; RVH absent | MODERATE | RVH ~126 (to-verify) → untrainable; LVH ceiling ~20–32% vs echo |
| 17 | Axis (LAD / RAD) | LAD DEAD; RAD absent | LOW–MODERATE | LAD read from wrong field; RAD never declared (remediation below) |

**RAD remediation (was dropped, now documented).** RAD is not a declared output today. It is treated symmetrically with LAD: sourced from the `heart_axis` metadata / PTB-XL+ numeric QRS-axis (SNOMED 47665007, recommend +90° to +180° cutoff), NOT from scp_codes. If validated positive support and per-class recall clear the safety floor it is added; if not, it is shipped SILENT with the same justification RVH receives — never dropped silently.

### 1B. Cross-cutting engineering/data/validation gaps (each a launch blocker)
1. **Dead classes:** STTC is a PTB-XL diagnostic SUPERCLASS (raw codes NDT/NST_/ISC_/ISCAL/DIG/LNGQT etc.), so a literal "STTC" match never fires; LAD is not in PTB-XL's 71 codes at all (axis is metadata). Effective classes = 17. Misrepresenting the class list is itself a labeling/safety defect for filing.
2. **Label noise:** `build_labels(min_conf=0.0)` admits likelihood-0 ("not quantified," NOT "0% present") statements as positives.
3. **No operating metrics:** no thresholds, sensitivity/specificity, PPV/NPV, or calibration — cannot be filed or safely deployed.
4. **Uncalibrated probabilities:** BCE `pos_weight` up to 20x → scores are not risk.
5. **Unmeasured sim-to-real gap:** trained/validated ONLY on clean synthetic renders. This is the single largest gap for a photo-input claim.
6. **Weak acute-coronary classes:** AMI 0.885 / IMI 0.898 on clean renders — the exact morphology that matters most.
7. **Single-source, single-layout, single-population training** (German adult PTB-XL, one render style) → risk of render-style/site shortcutting and no pediatric/out-of-population coverage.

---

## SECTION 2 — ENGINEERING ROADMAP (no-retrain and low-lift fixes first)

Ordered to deliver safety value with least model risk; all backward-compatible (guardrails at end).

**E1. STTC / LAD dead-class label mapping (no retrain to expose the bug; retrain to fix).**
- Define STTC as an aggregate of RAW ST-T codes (PTB-XL: NDT, NST_, ISC_, ISCAL, STD_, STE_ family; CinC/SNOMED: STC 55930002, STIAb, NSSTTA 428750005, STD 429622005, STE 164931005, TAb 164934002, TInv 59931005). Verify each code resolves to real positives before training.
- LAD must be sourced from PTB-XL's `heart_axis` column / PTB-XL+ numeric QRS-axis degrees, or from Georgia/CinC/CSN/SPH (SNOMED 39732003), NOT scp_codes. **Critical labeling caution:** PTB-XL contains fascicular-block codes (LAFB/LPFB) that are easy to conflate with axis — LAFB is a conduction diagnosis, NOT a substitute for a true numeric −30° axis cutoff. Pick ONE documented cutoff (recommend −30°) and apply uniformly.

**E2. Threshold + confidence calibration (no retrain).**
- Post-hoc temperature scaling (global) then per-class isotonic/Platt on a held-out, patient-disjoint, photo-distorted set. Calibration is rank-invariant → 0 AUROC change, but converts scores into usable probabilities. Do NOT display any confidence number until this is done.
- Set per-class operating points sensitivity-weighted for dangerous classes; publish sensitivity/specificity/PPV/NPV at each point AT THE INTENDED-SETTING PREVALENCE.

**E3. Preprocessing / rendering consistency (serving + training).**
- Any newly merged signal source: resample to a common rate, window to 10 s, gain-normalize to mV (read WFDB gain/baseline per record), **lead-order BY NAME** (MIMIC is aVR-before-aVL vs PTB-XL aVL-before-aVR — reindexing by position swaps aVR/aVL), then RE-RENDER with the identical matplotlib layout/grid/mm-per-mV(10)/mm-per-s(25)/line-width/DPI as the 12k PTB-XL renders, and photo-augment identically. Otherwise the model shortcuts on render style.

**E4. Low-confidence safety deferral / abstention (serving).**
- Explicit "image quality insufficient / cannot interpret" state (blur, glare, crop, partial tracing, wrong/missing leads, non-25mm/s or non-10mm/mV calibration). An uninterpretable image must NEVER be scored as "normal."
- Per-class abstention: axis when limb leads are cropped; suppress LVH under LBBB/RBBB/paced/WPW; flag wide-complex/paced contexts as "cannot assess."
- **Wide-complex-tachycardia (WCT) rule:** any wide-complex tachycardia defaults to "cannot exclude VT," never a benign/SVT label, and is routed to the "cannot assess / treat as VT until proven otherwise" abstention state. A model output of "SVT/not-VT" on a wide-complex tracing is a dangerous false negative and is forbidden.
- **QT/QTc rule:** hard-abstain on QT/QTc whenever paper-speed/gain calibration is not verified (a photographed strip at undetected non-25 mm/s or non-10 mm/mV yields a materially wrong QTc; a falsely normal QTc misses drug-induced LQTS/torsades risk).

**G1. NORM ("normal") output guardrail (serving — the single highest-risk false-reassurance path).**
- Every NORM output MUST carry a fixed, non-dismissible caveat, enumerated by name: *"A normal-appearing ECG does NOT exclude acute coronary occlusion (STEMI/OMI), hyperkalemia, pulmonary embolism, pericarditis, or NSTEMI, and does not exclude paroxysmal AF, concealed WPW, concealed LQTS, or intermittent Brugada/complete heart block. Correlate with symptoms and serial troponin."*
- NORM MUST be suppressed/downgraded to "indeterminate — clinical correlation required" whenever ANY dangerous-class score sits near its (low) threshold.
- A NORM result is NEVER presented as reassurance for any acute class.

**E5. Dead-class / low-N suppression in serving.** Any class whose positive support or validated per-class recall is below its **pre-registered safety floor** (Section 5A) is served SILENT — never emitted as a false-negative-by-construction. Explicitly applies to STTC/LAD (until remapped), RVH (~126, to-verify), RAD (until validated), Brugada, and any emergency class until it clears validation.

**E6. Label rebuild (retrain).** Raise `min_conf` above 0.0 / weight by likelihood; treat missing multi-label codes as UNKNOWN (masked BCE), not negative — mandatory when merging partial-label sources (Georgia, CPSC, CinC). Recompute `pos_weights` after any class-prior shift.

**G2. Intended-use population (serving + labeling).** Adult-only intended use. The model is trained on adult German PTB-XL; pediatric ECGs have entirely different normal ranges (axis, T-wave, intervals) and would generate dangerous misreads and false-NORMs. Add an out-of-population abstention for pediatric tracings (and a documented contraindication for pregnancy/athlete/paced-normal edge cases) at minimum.

**Backward-compatibility / no-regression guardrails (every stage):**
- Keep the frozen baseline model and its internal-clean + photo-distorted test as a regression gate; any retrain must not drop macro-AUROC or any ACTIVE-class per-class AUROC below baseline minus a pre-set epsilon on the SAME held-out set — AND must not reduce any dangerous-class measured sensitivity below its floor.
- Preserve PTB-XL's patient-level `strat_fold`; never let a test-fold patient leak into training (including via CinC copies of PTB-XL).
- Keep everything behind `smd_kardiox` default-OFF with git recovery tag `pre-kardiox` until each change clears validation.

---

## SECTION 3 — CLINICAL ROADMAP (S1 perfect-existing → S5 prospective)

**S1 — Perfect the existing 17 ACTIVE classes.** Fix STTC/LAD mapping (E1) to restore 19 effective classes, raise `min_conf` (E6), calibrate + set thresholds (E2), retrain with realistic-image augmentation (E3), add NORM guardrail G1 and adult-only gate G2. No new diagnoses. Deliverable: a locked model with a defined operating point and computed per-class sensitivity/specificity/PPV/NPV/calibration — including for the previously-incidental NORM, 1AVB, PAC/SVPB, PVC/VPB, ASMI.

**S2 — Acute ischemia / OMI (highest single safety TARGET; performance CONTINGENT).** Add STEMI + the occlusion-MI family (OMI, Wellens, De Winter, hyperacute-T). Binding constraint = label scarcity: PTB-XL has only chronic IMI/AMI/ASMI; OMI-family gold labels are angiographic and NOT openly available. This means all S2/T4 performance projections are CONTINGENT on acquiring restricted cohorts (SwED / ECG-SMART-NET / PMcardio DUAs) — they are gated, slow, and separately budgeted (Section 9). S2 is NOT fundable off open data. Deliver as a HIGH-SENSITIVITY "possible acute coronary occlusion / STEMI-equivalent — cannot exclude" ADDITIVE alert, never a diagnosis and never a rule-out. If the measured OMI/STEMI head sits below its pre-registered minimum sensitivity (Section 5A), it ships SILENT (additive-alert-only) — a low-AUROC OMI detector is net-harmful (false reassurance + alert fatigue). ECG alone is a legitimate gatekeeper to RAISE a flag but cannot confirm (needs symptoms + serial troponin + serial ECG + angiography).

**S3 — Expand emergency coverage.** Add VT, complete heart block, atrial flutter, WPW, LongQT (as QTc-prolongation phenotype). VF is treated in a SEPARATE single/2-lead pathway (modality mismatch, S/T6) and NEVER claimed on 12-lead photos. Brugada is developed but shipped SILENT (research-grade) until it clears its pre-registered sensitivity floor on external + real-photo sets — a ~0.70-AUROC lethal-arrhythmia flag is not emitted to users. Morphologically bold classes (VT/flutter/WPW/CHB) are learnable if data is pooled. Remaining out-of-scope dangerous causes documented and shipped SILENT: PE, hyperkalemia (needs MIMIC+K⁺), pericarditis.

**S4 — External validation (measures truth; changes no weights).** Freeze S3 and evaluate on independent datasets (SPH is the best genuinely-independent external set; plus Chapman-Shaoxing/Georgia/CPSC) AND, critically, a curated REAL phone-photo set across devices/lighting/paper. Expect an HONEST DROP; the point is to quantify sim-to-real and cross-population gaps. **Any internal AMI/IMI gain from the small PTB Diagnostic cohort (T3) is treated as UNVALIDATED until confirmed here** (see S1/T3 constraint).

**S5 — Prospective clinical validation (deployment truth, regulatory-grade).** In-workflow study, real prevalence, real users/phones, adjudicated ground truth (serial ECG, troponin, EP, outcomes), IRB/ethics approval, pre-specified endpoints, subgroup/bias analysis. Labeled strictly as ECG-alone decision support with mandatory physician confirmation. ECG alone remains fundamentally limited.

**Clinical-sufficiency ledger (state on EVERY relevant output).**
- ECG-DIAGNOSABLE alone → AFIB, atrial flutter, complete HB, BBB, **VT (12-lead only, with the WCT caveat: any wide-complex tachycardia = "cannot exclude VT," never a benign/SVT label)**, **VF only in the native 1–2-lead pathway — NEVER from the 12-lead photo product**, WPW pattern, axis, QT-interval measurement (with the calibration caveat: a measured-normal QTc does NOT exclude concealed/intermittent LQTS).
- NOT ECG-sufficient (needs labs/imaging/serial/context) → STEMI/OMI (troponin+angiography), NSTEMI (troponin), hyperkalemia (serum K⁺), LongQT syndrome (QTc+meds+electrolytes+genetics), Brugada syndrome (provocation+context), PE (CTPA), pericarditis (ESC ≥2/4), LVH/RVH (echo).
- A normal ECG NEVER excludes paroxysmal AF, concealed WPW, concealed LQTS, intermittent Brugada/CHB, PE, hyperkalemia, pericarditis, or NSTEMI (this line appears on the actual NORM output per G1, not only in this ledger).

---

## SECTION 4 — DATASET ROADMAP

### 4A. Canonical dataset roster and ingestion order

All per-class revival counts below are **CLAIMS-TO-VERIFY** (Section 4D). The roster is 11 primary datasets, numbered explicitly; access-restricted emergency supplements and native-modality VT/VF DBs are itemized separately so the count is unambiguous.

**Primary 11 (the brief's roster):**
1. **PTB-XL (base — DO NOT re-merge).** 21,799 records / 18,869 patients, 71 SCP statements, CC-BY, `strat_fold` (folds 9–10 = cleaner test). Re-adding it (directly or via any CinC bundle) duplicates train AND contaminates test = memorization. Used only to (a) fix STTC/LAD internally, (b) raise `min_conf`, (c) serve as a low-leakage internal benchmark.
2. **Georgia G12EC (10,344 training, CC-BY via CinC).** First merge. Revives LAD (~940, to-verify; SNOMED 39732003), boosts LVH (~1,232, to-verify), rhythms, PAC, PVC(=VPB, equivalence). Independent US population. Partial-label MASKING mandatory (localized MI absent → mask IMI/AMI/ASMI for Georgia rows).
3. **Chapman-Shaoxing (via CSN).** CinC-2021 labels this subset ~10,247; the canonical STANDALONE figshare release (Zheng et al. 2020) is 10,646 patients. **Number is provenance-specific — annotate which you pulled; never mix.** Source via CSN only.
4. **Ningbo (via CSN).** Adds atrial flutter (~445, to-verify), PVC (~1,091, to-verify), LAFB (~380, to-verify). CSN (Chapman-Shaoxing + Ningbo) = 45,152 total, CC-BY, and subsumes the standalone Chapman release.
5. **CPSC-2018 (6,877).** Reinforces NORM/AFIB/1AVB/CLBBB/CRBBB/PAC/PVC + ST-depression; independent Chinese generalization set. No MI/emergency value.
6. **PTB Diagnostic (549 records / 290 subjects — standalone ptbdb v1.0.0 ONLY).** Targeted MI/NORM booster for weakest AMI/IMI/ASMI (148-patient localized-MI cohort). Free-text→19-class hand mapping; drop Frank leads; exclude no-summary subjects. **Small-N constraint: internal AMI/IMI gains from this cohort must NOT raise operating points or claims without independent real-phone-photo confirmation (treat as unvalidated until S4).**
7. **MIMIC-IV-ECG (~800k ECGs / ~160k patients, open ODbL 1.0 waveforms).** High-volume, non-overlapping. NLP-extract free-text reports to revive STTC/LAD and SEED harder classes. **Cost warning: this is a LABOR project, not a cheap CPU job — report-derived labels are noisy, cart-vendor-dependent, negation-prone, and require clinician adjudication of a validation sample (budgeted in Section 9 as a labor line, NOT compute).** The linked ICD/notes modules are CREDENTIALED and a leaky morphology proxy — gate behind credentialing; only the OPEN waveform module is needed for the labeling work here.
8. **SPH (25,770 records / 24,666 patients, AHA statements, not in CinC).** Reserve primarily as the independent EXTERNAL validation set (best available honest generalization measure). Dedup the reported ~144 duplicate ECGs — **but confirm that duplicate figure against the source before relying on the dedup step (currently unverified).**
9. **INCART / St. Petersburg (≈74 CinC records; original database is 75 records / 32 patients).** Ingested as a small conduction/arrhythmia supplement; keep whole per patient, never split a patient's segments; used for rhythm/conduction context only, not as a primary class source.
10. **VFDB / CUDB (native VT/VF strips).** SEPARATE 1–2-lead pathway (T6) — not fused into the 12-lead photo model.
11. **SDDB / MIT-BIH (mitdb) (native VT/VF + rhythm strips).** Same separate pathway as #10.

**Access-restricted emergency supplements (NOT part of the primary 11; require DUAs, gated/slow, separately budgeted):** SwED, ECG-SMART-NET, PMcardio (OMI); Brugada-HUCA (~76, to-verify) + registries. S2/T4 performance is CONTINGENT on these.

### 4B. Harmonization to a common ontology
Build ONE crosswalk: SCP-ECG (PTB-XL) ↔ native (Chapman AHA/CSN) ↔ SNOMED-CT (Georgia/CinC/CSN) ↔ AHA statements (SPH) ↔ the 19 classes. Fold CinC equivalence pairs (CRBBB≡RBBB, PAC≡SVPB, PVC≡VPB, CLBBB≡LBBB, LPR≡prolonged-PR). Define STTC and LAD (and RAD) as SNOMED code-GROUPS. SR≠NORM (only NORM when no abnormal code present). Generic un-localized MI must NOT be forced into localized AMI/IMI/ASMI (weak-label only). SNOMED-CT is the cleanest pivot.

### 4C. Dedup + patient-leakage prevention
- **PTB-XL is fully embedded in CinC-2020 and CinC-2021 (2021 lists PTB-XL 21,837 + PTB 516); PTB Diagnostic too.** Never ingest PTB-XL or PTB via a CinC bundle.
- **CSN already contains Chapman-Shaoxing** — never add standalone Chapman on top of CSN.
- **Pick one canonical provenance per record;** run signal-hash / near-duplicate dedup across figshare/PhysioNet/Kaggle mirrors before splitting.
- **Keep every split patient-disjoint AND source-stratified.** PTB↔PTB-XL overlap is UNVERIFIABLE (same institution) → keep ALL of PTB on one split side. CPSC/Georgia have NO patient IDs → split by record with that caveat noted. INCART = 32 patients → keep whole. Dedup SPH's reported duplicates (count to-confirm, 4A).

### 4D. Count-verification gate (mandatory before any feasibility verdict)
Every small per-class positive count in this document is a CLAIM-TO-VERIFY, re-counted from the actual label files before it drives "untrainable / research-grade / ship SILENT." Specifically unverified and load-bearing: 3AVB, atrial flutter, WPW, Brugada, LongQT, RVH, and all Georgia/Ningbo revival counts (LAD 940, LVH 1,232, LAFB 380, PVC 1,091, flutter 445). A wrong count flips a decision, so no go/no-go is issued on an unverified count.

---

## SECTION 5 — TRAINING ROADMAP (only where improvement is likely)

Ordered by clinical value per unit risk. Compute assumptions in Section 9. "Dangerous-FN" = clinically dangerous false negatives. **Results LEAD with per-class measured sensitivity/PPV at the deployed operating point and real prevalence; AUROC is a secondary lab reference.**

### 5A. Pre-registered minimum sensitivity floors (set BEFORE T4/T5, gated on real-photo measurement)
No emergency head deploys unless it meets a pre-specified minimum MEASURED (real-photo) sensitivity at a defined operating point; below floor → SILENT. These are pass/fail acceptance criteria, not post-hoc rationalizations of whatever the model achieves. Illustrative pre-registration (final values ratified with clinical governance before training):

| Class | Min measured real-photo sensitivity | Below floor → |
|---|---|---|
| STEMI / acute occlusion alert | ≥ 0.90 (high-sensitivity gatekeeper) | SILENT / additive-alert-only |
| OMI family | ≥ 0.75 target; hard floor ≥ 0.60 | SILENT if below hard floor |
| VT (12-lead) | ≥ 0.90 | SILENT |
| Complete heart block | ≥ 0.90 | SILENT |
| Atrial flutter | ≥ 0.85 | SILENT |
| WPW pattern | ≥ 0.85 | SILENT |
| LongQT phenotype | ≥ 0.85 (with QT abstain rule E4) | SILENT |
| Brugada type-1 pattern | ≥ 0.85 | SILENT (research-grade until met) |
| Each ACTIVE class (incl. AMI/IMI) | no regression below baseline-measured sensitivity − epsilon | block release |

### 5B. Task table

| Task | Lab AUROC (secondary ref) | Measured dangerous-FN impact (headline) | FP change | GPU-hrs | $ (spot) | Value |
|---|---|---|---|---|---|---|
| T1. Fix STTC/LAD + min_conf + calibrate, retrain w/ realistic aug | ~flat (0.945–0.955); recovers 2 dead classes | leads with per-class sensitivity at operating point; ~0 change for true emergencies (none added) | ↓ FP at matched sensitivity | 20–60 | $40–150 | HIGH (unblocks everything; honest metrics) |
| T2. Merge Georgia+CSN+CPSC (masked BCE), re-render, retrain | macro ~0.93–0.94 | modest; revives LAD/rhythm recall | slight ↑ then ↓ after recalibration | 60–150 | $150–400 | HIGH (breadth, cross-population) |
| T3. MI booster (PTB Diagnostic + MIMIC MI mining) | AMI/IMI +0.01–0.04 (UNVALIDATED until S4) | **any internal AMI/IMI gain is unvalidated; no operating-point/claim change without real-photo confirmation** | slight ↑ | 40–100 | $100–250 | HIGH (weakest safety-critical) |
| T4. S2 acute ischemia/OMI head (CONTINGENT on DUA cohorts) | STEMI 0.85–0.90, OMI 0.72–0.83 (PROJECTED, CONTINGENT — no open occlusion corpus, no empirical basis until DUAs land) | **CLINICAL TARGET is HIGHEST; deployable model may not clear 5A. Residual miss is the headline: even at target, ~20–40% of clear STEMI and ~40–60% of OMI REMAIN MISSED. A negative acute-coronary screen NEVER lowers clinical suspicion. Below 5A floor → SILENT.** | ↑ (low thresholds) | 80–200 + label curation | $200–500 + DUA/adjudication (Sec 9) | TARGET HIGHEST; deployability contingent |
| T5. S3 emergency heads (VT, flutter, WPW, CHB, LongQT-phenotype; Brugada built-but-SILENT) | VT/flutter/WPW/CHB 0.90–0.96; Brugada 0.70–0.82 (SILENT); LongQT 0.88–0.93 (all PROJECTED) | LARGE for lethal arrhythmias IF 5A floors met; Brugada SILENT until floor met | modest ↑ | 100–250 | $250–600 | HIGH |
| T6. Separate 1–2-lead VT/VF pathway (VFDB/CUDB/SDDB/mitdb) | high but WIDE-CI at ~70–75 unique patients — do NOT quote a single >0.98 point estimate; screening-only, non-generalizing to 12-lead photo | closes VT/VF in native modality only | artifact-driven FP (needs quality gate) | 20–60 | $40–150 | MODERATE (screening only) |

**VF is EXCLUDED from all 12-lead heads (T5).** VF performance belongs ONLY to T6's native 1–2-lead pathway and is never projected or claimed for the 12-lead photo product.

**Explicitly NOT worth training now (would create dangerous dead/false-reassuring classes → ship SILENT):** RVH (~126, to-verify), hyperkalemia (needs MIMIC+K⁺ label build — a data project), pericarditis (no in-pipeline label; STEMI-mimic danger), PE (no CTPA-linked public label; physiologic ceiling), congenital LongQT / Brugada stratification / OMI as standalone gold class (labels proprietary/absent), RAD (until count-verified and floor-cleared).

---

## SECTION 6 — VALIDATION ROADMAP

**Governing rule (applies to Sections 5 and 10 too): report the REAL-PHOTO, patient-disjoint, per-class MEASURED sensitivity and PPV/NPV at the deployed operating point and real prevalence as the honest headline — NEVER the clean-render 0.947 or the distorted-proxy 0.893. Macro-AUROC is a secondary lab reference only. Every dangerous class must report its measured false-negative rate against its pre-registered 5A floor (pass/fail).**

1. **Internal (retrospective):** PTB-XL patient-disjoint `strat_fold` (folds 9–10). Per-class sensitivity/PPV + calibration; AUROC secondary.
2. **External (retrospective):** SPH (primary independent), Chapman-Shaoxing, Georgia, CPSC — source-stratified, mapped through the crosswalk. Guards against site/render shortcutting.
3. **Smartphone-photo (the decisive gap):** curated REAL phone-photo test set — converts the projected 0.893 proxy into MEASURED real-world numbers. Explicit stratified factors:
   - PAPER LAYOUTS: 3×4, 3×4+1 rhythm strip, 6×2, rhythm-strip-only.
   - MANUFACTURERS/carts: GE, Philips, Schiller, Burdick/Spacelabs, on-screen monitor captures.
   - CAPTURE DISTORTIONS: rotation, folding/creasing, low-light, glare/specular, moiré, shadow, perspective/skew, blur, JPEG compression, partial crop (missing limb or precordial leads).
   - PRINTED COPIES: photocopies, faxed/scanned, thermal-paper fade, differing paper speed (≠25 mm/s) and gain (≠10 mm/mV).
   - NOISE: baseline wander, EMG/tremor, 50/60 Hz interference, lead-off/flatline, motion.
4. **Calibration analysis:** reliability diagrams, ECE, per-class calibration at the deployed threshold, on photo-distorted AND real-photo sets (not clean renders).
5. **Per-class validation coverage is exhaustive:** every one of the 17 ACTIVE classes — including NORM (with G1 behavior tested), 1AVB, PAC/SVPB, PVC/VPB, ASMI — has a measured operating point and FN rate; none is validated only "incidentally."
6. **Prospective (S5):** adjudicated, in-workflow, regulatory-grade (Section 3).

---

## SECTION 7 — REGULATORY READINESS

**Positioning (lowest-risk, still a device):** clinician-facing decision SUPPORT / triage adjunct; mandatory physician confirmation of the actual tracing; calibrated confidence + explicit abstention + the NORM guardrail G1 + adult-only intended-use G2 + unavoidable ECG-alone caveat; narrow defensible claims only; a foregrounded "does NOT detect emergencies / not for chest-pain triage" warning. Interim posture: "investigational / not for diagnostic use," IRB-approved study, flag default-OFF. Decision-support framing lowers class but does NOT escape device regulation and does NOT qualify for the US non-device CDS carve-out — it fails Criterion 1 (analyzes an ECG image, the excluded function) and Criterion 4 (a black-box CNN's basis cannot be independently reviewed).

**Jurisdictions (lead with India):**
- **India CDSCO (primary market):** diagnostic SaMD → likely Class C; Central Licensing route (test/loan licence → MD9 manufacture / MD15 import), ISO 13485 + Essential Principles + clinical evidence. All software regulated since Oct 2022; AI/ML framework maturing — engage early. Plus **DPDP Act 2023** (Data Fiduciary duties; prefer on-device inference; document Cloudflare/Vertex processing).
- **EU MDR (Rule 11):** IIa/IIb (assume IIb given missed-emergency lethality); Notified Body assessment (ISO 13485, IEC 62304/14971/62366, MDCG 2020-1/2019-16, Annex XIV + PMCF); EU AI Act high-risk obligations layering 2026–2027; GDPR special-category data.
- **US FDA:** 510(k) for narrow per-condition claims (predicates AliveCor KardiaMobile, Eko, Anumana); De Novo for the novel broad photo→multi-class interpretation (no clean predicate); consider Breakthrough (PMcardio "Queen of Hearts" is the closest photo-input-ECG analog). Adopt GMLP + a Predetermined Change Control Plan (PCCP) so retrains are pre-authorized.
- **Verify ALL predicate clearance statuses** against FDA/EUDAMED/CDSCO — cited from training knowledge, not web-verified.

**Blockers before ANY market claim:** (1) compute per-class thresholds + sensitivity/specificity/PPV/NPV + calibration, gated against pre-registered 5A floors; (2) close the sim-to-real gap with a prospective real-phone-photo study; (3) fix/relabel STTC/LAD and never claim a class the model cannot output; (4) retrain without `min_conf=0.0`; (5) ISO 14971 risk file centered on dangerous false negatives (the 100%-missed emergencies, the NORM false-reassurance path, and weak AMI/IMI); (6) IEC 62366 human-factors for photo capture + hard image-quality gate + adult-only population control.

---

## SECTION 8 — TIMELINE

- **Phase 0 — Validation-ready (2–4 months):** T1 (fix STTC/LAD, `min_conf`, calibrate, realistic-aug retrain); NORM guardrail + adult-only gate; compute operating metrics; pre-register 5A floors; de-scope claims. Deliverable: locked model + defined operating point. Runs alongside E1–E6, G1–G2.
- **Phase 1 — Real-world photo clinical validation (6–12 months):** protocol + IRB, multi-device/multi-source/multi-layout photo collection, cardiologist over-read gold standard, subgroup/bias analysis. QMS (ISO 13485) + IEC 62304/14971/62366 + cybersecurity/privacy in PARALLEL (~6–9 months). T2–T5 iterations feed in; T4 (S2) additionally gated on DUA acquisition timelines (may extend beyond this window).
- **Phase 2 — Submissions (parallel once dossier exists):** India Class C ~9–18 months from complete dossier; EU MDR CE (IIa/IIb) ~12–24 months (NB queue is the variable) + AI Act layering; US 510(k) (narrow) ~9–15 months, De Novo (broad) ~12–24+ months, optional Breakthrough.
- **Aggregate:** earliest defensible entry via India ~12–18 months if resourced now; EU/US authorization ~18–30 months. `smd_kardiox` stays OFF / investigational until then.

---

## SECTION 9 — PROGRAM COST (GPU is the SMALL line; labor and access dominate)

**GPU assumptions:** EfficientNet-B3 photo classifier; corpus grows ~12k → ~150k rendered+augmented images; ~30–50 epochs/run; A100-class GPU. Spot pricing is commonly ~$1.0–1.6/hr (RunPod/Lambda) with on-demand ~$1.3–3.5/hr; we cost at a conservative ~$2/hr, so the GPU total below is padded upward, not rosy. The memory's "≤$35 overnight" prior referred to a far smaller job and is NOT a floor for this program. To avoid double-counting, this section reports program totals and the NON-GPU lines; the per-task GPU-hr detail lives in Section 5B and is not re-litigated here.

| GPU line (summary of Section 5B) | GPU-hrs | $ (spot) |
|---|---|---|
| T1–T6 + calibration/eval/regression reruns | ~350–900 | ~$900–2,300 |

**Non-GPU lines (these dominate program cost):**
- **Real-phone-photo data collection + cardiologist over-read** (Sections 6.3, 8 Phase 1) — major labor line.
- **MIMIC free-text label adjudication** — clinician-hours to validate NLP-extracted emergency labels (per Section 4A #7); this is LABOR, not the "cheap CPU" it might appear.
- **Restricted OMI/Brugada cohort access (DUAs)** for T4/S2 — fees + legal + lead time; T4 is not fundable off open data.
- **QMS / regulatory consulting, Notified Body fees, prospective study, IRB.**
- **Storage/egress:** MIMIC ~800k 10-s 500 Hz records ≈ low-hundreds-of-GB to ~1 TB (verify actual footprint before calling it "minor"); PhysioNet egress is free and object storage cheap. Only the OPEN waveform module is needed for the labeling work. CSN adds a minor increment.

**Net:** GPU spend (~$0.9–2.3k) is a rounding error next to data-collection, clinician-adjudication, DUA, and regulatory labor — the real program cost.

---

## SECTION 10 — EXPECTED PERFORMANCE AFTER EACH STAGE

**All figures below are PROJECTIONS with wide uncertainty unless labeled MEASURED; CONTINGENT figures depend on data that does not yet exist openly. Per the Section 6 governing rule, each stage LEADS with per-class measured sensitivity/PPV at the operating point and real prevalence; AUROC is a demoted lab reference. Baseline lab references only: internal-clean 0.947, photo-distorted proxy 0.893; weakest AMI 0.885 / IMI 0.898. The deployable real-world metric is currently UNKNOWN.**

**After S1 (perfect existing):**
- HEADLINE (to be measured): per-class sensitivity/PPV/NPV at the calibrated operating point for all 17 ACTIVE classes, including NORM behavior under G1.
- Lab reference: internal-clean 0.945–0.955 (≈flat; recovering harder STTC/LAD dilutes macro). Photo-distorted proxy 0.90–0.92 after realistic aug. Real phone-photo PROJECTED 0.80–0.88, still UNMEASURED.
- Dangerous-FN: small reduction within ischemia-adjacent bucket; ~0 for true emergencies (none added).
- FP: DOWN at matched sensitivity (calibrated thresholds replace uncalibrated `pos_weight`).

**After S2 (acute ischemia/OMI — CONTINGENT on DUA cohorts):**
- HEADLINE safety number: RESIDUAL MISS. Even at target, ~20–40% of clear STEMI and ~40–60% of OMI-family REMAIN MISSED; a negative acute-coronary screen NEVER lowers suspicion. If below the 5A floor, the head ships SILENT.
- CONTINGENT projections (no empirical basis until DUAs land): STEMI 0.85–0.90, OMI/Wellens/De Winter 0.72–0.83; largest sim-to-real drop expected here (subtle ST/hyperacute-T degrades most on photos).
- FP: INCREASES (low thresholds to avoid lethal misses) — needs alert-fatigue guardrails + mandatory over-read.

**After S3 (emergency expansion):**
- HEADLINE: measured sensitivity vs 5A floors for VT (12-lead), flutter, WPW, CHB, LongQT-phenotype. Brugada held SILENT until floor met. VF NOT included here (T6 pathway only).
- Lab reference: VT 0.90–0.96, flutter 0.92–0.96, WPW 0.90–0.95, CHB 0.90–0.95, LongQT-phenotype 0.88–0.93, Brugada 0.70–0.82 (SILENT); macro held ~0.92–0.94.
- Dangerous-FN: LARGE drop for lethal arrhythmias IF floors met. PE/hyperkalemia/pericarditis remain uncovered → still SILENT + caveated (NORM guardrail names them).
- FP: modest increase (patterns fairly specific).

**After S4 (external validation — measures, does not improve):**
- FIRST real measurement: real-photo per-class sensitivity/PPV and macro-AUROC likely MEASURED at 0.80–0.88 macro (scarce/acute classes lower). Any T3 AMI/IMI internal gain is confirmed-or-refuted HERE. Expect FN and FP HIGHER than internal — that is correct, not a regression.

**After S5 (prospective — deployment truth, regulatory-grade):**
- HEADLINE: adjudicated per-class dangerous-FN rate vs outcomes/troponin/EP at real prevalence, with CIs. Real-photo macro-AUROC PROJECTED ~0.78–0.88; low emergency prevalence pulls PPV down → more absolute FP alerts (drives human-over-read policy).
- This IS the ceiling: ECG alone is fundamentally limited (needs clinical context, serial ECGs, troponin), so KardiQ X must remain human-over-read decision support.

---

**Final safety posture.** The single highest-value, lowest-regret moves are S1 (fix dead classes, calibrate, honest per-class metrics, NORM guardrail, adult-only gate) and the S2 high-sensitivity "possible acute coronary occlusion — cannot exclude" additive alert, because acute-coronary misses are the deadliest current gap — even though S2's deployable performance is CONTINGENT on restricted data and gated by pre-registered sensitivity floors. Never present a negative as reassurance for any acute class; the NORM output always names STEMI/OMI, hyperkalemia, PE, pericarditis, and NSTEMI as conditions it cannot exclude. Never emit a class the model cannot actually output; never quote clean-render AUROC as performance; never display a confidence number before calibration; never claim VF on a 12-lead photo; never label a wide-complex tachycardia as benign/SVT; hard-abstain on QTc without verified calibration; and keep everything behind `smd_kardiox` default-OFF with the "not for emergency triage / adult-only / ECG-alone / requires clinician confirmation" caveats until real-phone-photo and prospective validation exist.