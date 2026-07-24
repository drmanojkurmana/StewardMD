# KardiQ X — Real-Data MI/STEMI Protocol (multi-source corpus)
_Plan only — no compute spent yet. Extensible: more datasets can be added to the same corpus._

## 0. The real-data corpus (two sources so far — different countries, capture styles, layouts)

### A. Mendeley "ECG Images of Cardiac Patients" (`gwbz3fsgp8-2`, Pakistan) — 928 imgs
Clean **digital exports**, standard 3×4 + rhythm layout (SE-3), ~2213×1572.
| Label | n | notes |
|---|---|---|
| Myocardial Infarction | 239 | MI, acuteness unspecified |
| History of MI | 172 | old / recovered |
| Abnormal heartbeat | 233 | arrhythmia etc. |
| Normal | 284 | |

### B. SSMCH-ECG (India) — 849 imgs + metadata CSV + demographics
Real **phone photos of paper printouts** (skew, paper texture, handwriting, glare; BH-1200 machine, non-standard multi-row layout), ~3006×2223. CSV: `patient_id, image_name, gender, age, heart_rate, abnormality_type (free text), class_name`.
| Label | n | notes |
|---|---|---|
| **MI (`abnormality_type = "ACUTE MI / STEMI"`)** | 71 | **explicit acute-STEMI label** — the capability PTB-XL can't give |
| Abnormal | 344 | incl. **70 with free-text located infarcts** (lateral 64, inferior 59, anterolateral 19, anterior 11, septal 9, posterior 1 — multi-label) = old/incidental infarcts |
| Normal | 434 | |

### Combined (~1,777 real ECGs)
- **Acute MI / STEMI-ish positives:** SSMCH 71 (explicit acute STEMI) + Mendeley MI 239 ≈ **310**
- **Old / other infarct patterns:** Mendeley HxMI 172 + SSMCH located-infarct 70 ≈ **242**
- **Normal:** 718 · **Abnormal (non-infarct):** ~507
- **Two capture styles** (clean export + phone photo) and **two centers/countries** → enables real generalization testing.

## 1. Why this is now materially stronger
Together the two sources hit **every gap** I flagged earlier:
1. **Real pathology** (both) — the model has never seen a real infarct.
2. **Messy phone capture** (SSMCH photos) — the deployment condition.
3. **Acute-STEMI labels** (SSMCH 71) — partial STEMI capability, the real clinical prize.
4. **Infarct location** (SSMCH free-text) — partial localization.
5. **Cross-source diversity** (Pakistan + India, two machines, two layouts).

## 2. Honest caveats (unchanged discipline)
- **Small STEMI n (71 explicit)** — enough to *evaluate* and *fine-tune a detector*, not to make clinical claims.
- **Labels are ECG-read, not troponin/cath-confirmed.** "ACUTE MI / STEMI" is a read, not an outcome.
- **Layout heterogeneity is large** (PTB-XL synthetic 3×4 vs Mendeley 3×4 clean vs SSMCH photographed continuous multi-row). The model squashes whole images to 320×320 — layout normalization/cropping will matter and must be handled per-source.
- **SSMCH free-text is noisy** (auto/human interpretation, "possible…", multi-finding). Needs curation before use as location labels.
- **Governance:** SSMCH photos contain handwriting/signatures (potential PHI). Public-research use is fine; keep de-identified, don't surface raw images, keep experimental framing + all v3 safety guards. Not sufficient for a clinical claim.

## 3. Unified label schema (harmonize both sources)
Per image: `source, path, patient_id, split, y_normal, y_mi_any, y_acute_stemi, y_loc_{ant,inf,lat,sept,post}` (loc from SSMCH free-text parse; null where unavailable). Definitions:
- `y_mi_any` = 1 for Mendeley MI+HxMI, SSMCH acute-STEMI + located-infarct rows.
- `y_acute_stemi` = 1 for SSMCH "ACUTE MI / STEMI" (and, cautiously, Mendeley MI as weak positive — flagged separately).
- Normal = both Normals.

## 4. Splits (patient-level, stratified, seeded)
- Within-source 60/15/25 train/val/**sacred test**.
- **PLUS a cross-source generalization test:** train on A, test on B and vice-versa — the strongest real-world signal (does it transfer across center/machine/capture?).

## 5. Step 1 — Measure v2 on real data (decisive, ~$1–2)
- MI-any score = `max(P_AMI,P_IMI,P_ASMI)`; report per source and pooled.
- **Task A:** acute-STEMI (SSMCH 71) vs Normal → AUROC. **Task B:** MI-any vs Normal → AUROC, per source.
- Compare vs v2 synthetic distorted MI (~0.85) → size the real gap; expect a bigger drop on SSMCH photos (layout + capture shift) than on Mendeley (clean).
- Report per-source AUROC, confusion at 0.5, defer-rate, and full-image vs waveform-crop.

## 6. Step 2 — Fine-tune / adapt (only if Step 1 shows a fixable gap, ~$3–6)
- Add dedicated real-data heads (leave PTB-XL 18 heads intact): **`mi_any`** and **`acute_stemi`**.
- Train on pooled real train split + synthetic (anti-forgetting); **hard no-regression gate on PTB-XL distorted MI**.
- **Include real phone-photo augmentation** (perspective/rotation/glare/JPEG) — now validated against *actual* SSMCH photos, not guessed.
- Per-source layout handling (crop/normalize the waveform region).
- **Gate:** beat v2 on the sacred within-source test **and** the cross-source test **and** hold PTB-XL MI. Stage no-traffic → smoke test → human flip. Never auto-flip.
- Optional: location head (SSMCH parsed) and acute-vs-old head.

## 7. Honest expectations
- Step 1 likely shows v2 drops on real data, more so on SSMCH photos — that finding is the point.
- Step 2 can plausibly yield a real-world **MI detector** and a first-cut **acute-STEMI detector** that beat v2 on real ECGs — but small n and single-read labels cap confidence and generalization; more centers + outcome-confirmed labels needed for any clinical claim.

## 8. Budget & trigger
- Step 1 ~$1–2; Step 2 ~$3–6; total < $10.
- Ready for **more datasets** — same schema/corpus. When you're done adding, say **"run step 1"** and I execute §5 and report real numbers before any training spend.
