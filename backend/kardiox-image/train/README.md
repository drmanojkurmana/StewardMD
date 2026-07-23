# KardiQ X image model — training pipeline (v4, "ECG-GPT recipe")

Reproduces the end-to-end **ECG photo → diagnosis** image model served by `backend/kardiox-image`.
Reads 12-lead signals from open datasets, renders them into ECG *images* in multiple layouts, and
trains an EfficientNet-B3 multi-label classifier with heavy photo-realistic augmentation.

> **Model artifacts (`image_model*.pt`) are NOT in git** — they are large and are served from
> Cloud Run (`kardiox-image`). This directory holds only the code to regenerate them.

## Scripts
| File | Role |
|---|---|
| `build_labels.py` | PTB-XL `scp_codes` → curated **18-class** multi-label + patient-disjoint `strat_fold` split. STTC mapped via `scp_statements.csv` `diagnostic_class` (it is a superclass, not a raw code); LAD dropped (not a PTB-XL scp_code). |
| `render.py` | Renders each record to a standard ECG image, rotating through 3×4 / 3×4+rhythm layout variants (Yale-style layout diversity). Downloads WFDB on demand. |
| `train_v2.py` | Trains EfficientNet-B3 with heavy photo augmentation (perspective/affine/shear, lighting-gradient sim, colour jitter, blur, JPEG, random-erasing), then **temperature calibration** and a **real operating point**: per-class sensitivity/specificity/PPV/NPV/F1 (thresholds chosen on val, measured on test) on clean AND photo-distorted held-out. Saves `{backbone, classes, state_dict, temperature, thresholds}` + `metrics_v4.json`, and runs a head-to-head vs the previous model. |
| `eval_both.py` | Standalone clean-vs-photo-distorted honesty eval, v1-vs-v2 style. |
| `predict_photo.py` | Run a trained checkpoint on a real photo (sanity check). |
| `setup_v4.sh` | Provisions a venv (CPU torch) on a fresh VM and launches `master_run_v2.sh`. |
| `master_run_v2.sh` | Orchestrates: labels → multi-layout render → train+calibrate+eval. |

## Run (on a GPU or CPU VM)
```bash
# uploads assume build_labels.py/render.py/train_v2.py/master_run_v2.sh + image_model_v2.pt in ~/
bash setup_v4.sh            # installs deps, then nohup master_run_v2.sh > ~/run.log
# tune via env: LIMIT (records to render), EPOCHS, BS, WORKERS
```

## Classes (18)
`NORM, AFIB, STACH, SBRAD, 1AVB, CRBBB, IRBBB, CLBBB, LAFB, IMI, AMI, ASMI, LVH, ISC_, STTC, NDT, PVC, PAC`

## Data
PTB-XL 1.0.3 (CC-BY). Roadmap (`docs/ecg-engine-roadmap.md`) covers dataset expansion
(Georgia / Chapman-Shaoxing / Ningbo / CPSC / SPH / MIMIC-IV-ECG) with harmonization + leakage rules.

## Honesty note
Internal AUROC on synthetic renders is a **laboratory reference only** — the deployable metric is
per-class **real-photo** sensitivity/PPV, which requires an independent real-photo validation set
(not yet built). See the roadmap. This model is decision support, not a diagnosis, and does not
detect acute emergencies (STEMI/OMI, VT/VF, complete heart block, hyperkalaemia, etc.).
