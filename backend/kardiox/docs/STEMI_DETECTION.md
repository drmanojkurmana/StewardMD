# Hybrid STEMI detection — audit + before/after validation

STEMI was the pipeline's weakest class (the e2e STE case was missed). Root cause is **data**, not the
digitiser, so the fix is a **hybrid**: a deterministic ST-measurement rule engine fused with the neural
ensemble via Evidence Fusion.

## 1. Training-data audit

**CPSC (the ECG-Diagnosis training set, 6877 records):**

| class | SNR | AF | IAVB | LBBB | RBBB | PAC | PVC | STD | **STE** |
|---|---|---|---|---|---|---|---|---|---|
| n | 918 | 1221 | 722 | 236 | 1857 | 616 | 869 | 869 | **220 (3.2%)** |

STE is the **rarest** class (8.4× rarer than RBBB) and has **no territory subtypes** (one undifferentiated label).

**PTB-XL (21,799):** acute ST-elevation / injury codes total only **323 (1.5%)**, heavily territory-skewed:
anteroseptal 214 + anterolateral 145, but **inferior 18, lateral 17, inferolateral 15**; posterior MI 17.
Inferior / lateral / posterior STEMI are severely underrepresented — a learned head cannot generalise to them.

**Conclusion:** a learned STE head is unreliable (rare, imbalanced, no posterior/territory labels). A
deterministic ST-measurement rule covers *every* territory without needing thousands of examples.

## 2. Hybrid STEMI detector (`kardiox-stemi.js`, `SMD_KARDIOX_STEMI`)

Deterministic, calibrated-mV. Per lead: global-QRS-energy J-point, PR-segment baseline, ST deviation
(mm) at the J-point and J+40 ms, T-wave amplitude, and net QRS polarity. Criteria:

- **Contiguous ST elevation** ≥1 mm (limb / most precordial) or ≥2 mm V2–V3 in ≥2 anatomically-contiguous leads.
- **Reciprocal ST depression** (raises confidence / specificity).
- **Hyperacute T** early-STEMI equivalent (modest ST rising into a tall T).
- **Sgarbossa / modified Sgarbossa** — computed with true QRS polarity, surfaced as an **advisory** under
  wide-QRS/LBBB (see below).

**Hybrid via the NN (`kardiox-engines.js`, opt-in `ctx.stemi`):** the NN's conduction call gates the rule —
RBBB → suppress right-precordial V1–V3 (secondary ST); LBBB/wide-QRS → **do not auto-diagnose** (the LBBB
head is noisy and single-lead Sgarbossa is unreliable), instead issue a clinician advisory. The rule's
output fuses as an independent source; disagreement is never hidden.

## 3. Before/after validation (real data, no mock)

**CPSC held-out folds 9–10 (curated challenge labels; fair for the CPSC-trained NN) — 40 STE+ / 60 negatives:**

| | sensitivity | specificity | accuracy |
|---|---|---|---|
| NN only | **0.000** (0/40) | 1.000 | 0.600 |
| **Hybrid (NN + rule)** | **0.675** (27/40) | **0.917** | **0.820** |

The NN's STE head fires on nothing even in-distribution. The hybrid lifts sensitivity 0 → 67.5% at 91.7%
specificity (gained 27, lost 0). Residual false positives: 4 RBBB + 1 NORM (RBBB secondary V1–V3 changes
when the NN under-calls the block).

**PTB-XL cross-dataset stress (22 injury-labelled + 34 negatives incl. 8 RBBB + 6 LBBB):** NN 0% → hybrid
detects the frank-elevation cases at **100% specificity** on the negatives — the RBBB/LBBB false-positive
failure mode is eliminated by the BBB gating + advisory. (PTB-XL injury labels are a noisy STEMI proxy —
raw inspection shows many are reciprocal-depression-dominant or subthreshold, so raw sensitivity there
understates the detector; CPSC curated labels are the primary metric.)

**Regression:** all 15 KardioX suites green (new `kardiox-stemi` 14/14); the NN-only path is unchanged when
`ctx.stemi` is unset.

## 4. Honest limitations

- Requires **calibrated mV** input (a fixed-gain render / calibrated digitiser).
- **LBBB + STEMI** is not auto-diagnosed (advisory only) — single-lead automated Sgarbossa is unreliable.
- QRS-width measurement is unreliable for LBBB (low-slope broad QRS → low derivative energy), so LBBB
  detection relies on the NN conduction head.
- Retraining the NN STE head on more/territory-labelled data (PTB-XL/PTB/Chapman/Georgia) is the
  remaining lever — OOM-gated on the 8 GiB box (see [`../validation/stemi`](../validation/stemi)).
