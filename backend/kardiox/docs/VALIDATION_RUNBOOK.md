# KardioX — EcgLib Validation Runbook (the path to enabling `smd_kardiox`)

The engineering is done; **enabling KardioX for users is a validation exercise, not more code.** This is
the concrete, ordered checklist to take EcgLib (the first real classifier) from *integrated* to
*clinically enabled*. Nothing here runs in the app sandbox — run it in a validation environment with GPUs,
the datasets, and clinician time. `smd_kardiox` stays **OFF** until every gate below passes.

> Applies per model. Repeat for any foundation-encoder head and for ECG-Digitiser (§7) before relying on
> the image path. No dataset is redistributed; MIMIC-IV-ECG requires credentialing + a DUA.

## 0. Prerequisites
- `pip install ecglib torch numpy scipy scikit-learn wfdb` (+ `opencv-python-headless neurokit2` for the image path).
- Datasets on local disk (set `KARDIOX_DATA_*`): **PTB-XL** (open) for primary validation; **MIMIC-IV-ECG**
  (credentialed) for external validation; **ecg-image-kit** to render images from signals for §7.
- Confirm EcgLib's `create_model` args + input length against the installed version (see MODEL_LANDSCAPE.md).

## 1. Enable + smoke-check
```
KARDIOX_MODE=live
KARDIOX_ECGLIB_PATHOLOGIES=AFIB,1AVB,STACH,SBRAD,IRBBB,CRBBB,PVC
```
- `GET /v1/health` → `specialists[]` shows `ecglib` with `ready:true`.
- `GET /v1/ready` → 200 for the stages you have wired.
- Run one known-AF record end-to-end; confirm a differential is produced (not a crash, not a fabrication).

## 2. Signal-level validation on PTB-XL (per-pathology)
Wrap EcgLib probabilities into a `model_fn` and run `BenchmarkPipeline` over the PTB-XL **test fold**:
```python
from app.data.registry import get_dataset
from app.services.ecglib_provider import EcgLibClassifier, label_for
from app.training.benchmark import BenchmarkPipeline
import asyncio
clf = EcgLibClassifier()
def model_fn(signal):                        # {KardioX label: prob}
    probs = asyncio.run(clf.probabilities(signal))
    return {label_for(p): v for p, v in probs.items()}
rep = BenchmarkPipeline().evaluate(get_dataset("ptb-xl", root="/data/ptb-xl"), model_fn,
                                   split="test", label_space=[label_for(p) for p in clf._pathologies()])
```
Record per-pathology **AUROC, sensitivity, specificity, F1, Brier, ECE**, confusion matrices, and the
Fmax thresholds. Map PTB-XL SCP labels to the EcgLib pathologies for the ground truth.

### Acceptance criteria (per pathology — tune with your clinical lead; example floor)
| Metric | Minimum |
|---|---|
| AUROC | ≥ 0.90 |
| Sensitivity @ operating point | ≥ 0.85 |
| Specificity @ operating point | ≥ 0.85 |
| ECE | ≤ 0.10 (else calibrate, §4) |

Any pathology failing → keep it **disabled** (drop it from `KARDIOX_ECGLIB_PATHOLOGIES`); do not enable it.

## 3. External validation on MIMIC-IV-ECG
Repeat §2 on MIMIC-IV-ECG (derive labels from the machine reports; acknowledge label noise). Expect some
degradation — that is the generalization signal. Use `BenchmarkPipeline.cross_validate({...})` to report
per-dataset + average/median (the ExChanGeAI cross-dataset practice).

## 4. Fit confidence calibration
From the §2/§3 validation probabilities + labels, fit temperature scaling and verify it lowers ECE:
```python
from app.services.calibration import fit_temperature, expected_calibration_error
T = fit_temperature(val_probs, val_labels)          # per pathology (or pooled)
before, after = expected_calibration_error(val_probs, val_labels), ...  # recompute on T-scaled probs
```
Set `KARDIOX_CALIBRATION_TEMPERATURE=<T>` only if it **improves** held-out ECE; otherwise leave 1.0
(identity — honest). Re-run §2 to confirm.

## 5. Differential-engine + safety review
- Confirm outputs flow through fusion → Differential Diagnosis Engine with supporting/conflicting evidence
  and the `cardiologistReviewRecommended` flag behaving sensibly on borderline/low-quality cases.
- Verify the disclaimer is on every report; verify graceful behaviour on unreadable/OOD inputs.

## 6. Clinician sign-off
A qualified cardiologist signs off on: the rule-engine criteria, the Learn-ECG content, and a **reviewed
sample of end-to-end reports** across the enabled pathologies + edge cases. Record names/dates in a
sign-off log. This is a hard gate.

## 7. Image path (ECG-Digitiser) — validate separately before trusting photos
Render images from PTB-XL signals with `ecg-image-kit`, run image → `OpenCVPreprocessing` → ECG-Digitiser
→ EcgLib, and compare recovered findings vs the signal-level results (§2). Report digitization degradation
(interval error / finding agreement). Enable the image path only if degradation is within limits.

## 8. Regulatory + staged rollout
- Complete an intended-use / SaMD determination for the target jurisdiction(s) **before any clinical claim**.
- **Staged enablement, not a global flip:** first enable `smd_kardiox` for an internal/experimental cohort
  via the existing Experimental Access framework (one-code/one-device, server-authoritative), monitor
  `/metrics` + audit logs + clinician feedback, then widen. Keep a documented rollback.

## Sign-off matrix (all required before GA)
- [ ] §2 PTB-XL acceptance met for each enabled pathology
- [ ] §3 external (MIMIC) validation reported + acceptable
- [ ] §4 calibration fit + ECE improved (or identity retained)
- [ ] §5 differential/safety review passed
- [ ] §6 clinician sign-off logged
- [ ] §7 image-path validated (if the photo workflow is used)
- [ ] §8 regulatory determination + staged-rollout plan approved

Only when every box is checked does `smd_kardiox` come on — and then staged, not global.
