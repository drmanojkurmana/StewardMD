# KardiQ X — Complete Project Audit
_Read-only inventory. No files modified, nothing trained for this audit. Compiled 2026-07-24 from a recursive filesystem sweep + this session's benchmarks + deploy history._

Key locations:
- ML workdir: `~/.claude/jobs/f357192b/tmp/ecgf/` (models, digitiser, ECGFounder, scripts, metrics)
- Serving/repo: `StewardMD/backend/kardiox-image/` (live serving, reports) and `backend/kardiox/` (app backend)
- App client module: `StewardMD/www/kardiox-*.js`
- Datasets: `~/Downloads/gwbz3fsgp8-2` (Mendeley), `~/Downloads/SSMCH-ECG`, PTB-XL synth on the (stopped) VM `kardiox-train3`
- Cloud Run: service `kardiox-image` (us-central1), **live = revision `00010-yis` / tag `fullv31`**

---

## 1. AI Models

| Model | Architecture | Input | Output | Size | Status | Location | Performance | In use? |
|---|---|---|---|---|---|---|---|---|
| v1 | ResNet-18 | ECG image | 18-class multilabel | 44.8 MB | superseded | `ecgf/image_model.pt` | synth clean 0.916 / distorted 0.865 | No |
| **v2** | EfficientNet-B3 | ECG image 320² | 19-class multilabel | 43.4 MB | trained | `ecgf/image_model_v2.pt`; served as `backend/kardiox-image/image_model.pt` | synth clean 0.947 / distorted 0.893; **real clean MI 0.90 / photos 0.47** | **YES (live weights)** |
| v4 | EfficientNet-B3 (heavy aug) | ECG image | 18-class | 43.4 MB | rejected | `ecgf/image_model_v4.pt` + backend | distorted MI-macro worse than v2 (AMI −0.05, IMI −0.04) | No |
| mi-real (Step-2) | EfficientNet-B3, binary head | ECG image | MI-any (1 logit) | 43.3 MB | trained, not deployed | `ecgf/image_model_mireal.pt` | real clean MI **0.996** / photos 0.60 | No |
| ECGFounder 1-lead | Net1D 1D-CNN | 1-lead 500Hz×10s | 150 diagnoses | 353 MB | pretrained (MIT) | `ecgf/1_lead_ECGFounder.pth` | good on clean signal; **near-chance on reconstructed (0.49–0.60)** | benchmark only |
| ECGFounder 12-lead | Net1D 1D-CNN | 12-lead signal | 150 diagnoses | 353 MB | pretrained (MIT) | `ecgf/12_lead_ECGFounder.pth` | untested | **UNUSED** |
| Digitiser | nnU-Net (Hough+DL), PhysioNet-2024 winner | ECG image 1280×1024 | 13-class lead pixel map | 113 MB ONNX | pretrained | `ecgf/digitiser.onnx` | 92% segmentation success; downstream dx fails | benchmark only |

_(Not ours: `icl-…/*.tflite` = Chrome; `whisper *.bin` = dictation.)_

## 2. Trained Weights / Checkpoints

| File | Size | Val / epoch | Dataset | Purpose |
|---|---|---|---|---|
| `image_model.pt` (v1) | 44.8 MB | — | 12k PTB-XL synth | ResNet-18 PoC (superseded) |
| `image_model_v2.pt` | 43.4 MB | best-by-val | 12k PTB-XL synth | **production base** |
| `image_model_v4.pt` | 43.4 MB | best ep2 (val 0.931) | 13.6k synth + heavy aug | rejected (MI regression) |
| `image_model_mireal.pt` | 43.3 MB | ep5 (real-val MI 0.945) | real Mendeley+SSMCH + synth | real MI detector, not deployed |
| `1_lead_ECGFounder.pth` | 353 MB | pretrained | external (PKU) | single-lead signal dx |
| `12_lead_ECGFounder.pth` | 353 MB | pretrained | external (PKU) | 12-lead signal dx (unused) |
| `digitiser.onnx` | 113 MB | pretrained | PhysioNet-2024 | image→lead segmentation |
| `calib_v2.json` | — | temp 1.781 + thresholds | synth val | serving calibration |
| `image_test_preds.npz` | 0.12 MB | — | synth test | cached v2 preds |

## 3. ECG Pipelines

1. **Image → EfficientNet(v2) → calibrated v3.1 serving (LIVE).** 19 logits → temperature 1.781 → per-class threshold verdict; says "Normal"; **defers when unsure**; SBRAD barred from headline (worse-than-chance on real); STTC/LAD suppressed. `backend/kardiox-image/main.py`.
2. **Image → digitiser → rhythm-strip → ECGFounder-1lead → 150-dx.** `e2e_realphoto.py`, `bench_dig.py`. **Benchmarked: near-chance (see §7).**
3. **Image → digitiser → 12-lead reconstruct → re-render (QA).** `e2e.py` (partial).
4. **WFDB signal → ECGFounder.** `diag_from_wfdb.py` (clean-signal gold path).
5. **v2.1 STTC splice ensemble** — parked (verdict-eligibility bug).
6. **Binary MI real-data detector (Step-2)** — not deployed.
7. **Calibration** — `calibrate_v2.py`.
8. **App-side (client) module** `www/kardiox-*.js`: `digitize`, `digitize-learned`, `reconstruct`, `ecgwave`, `signal`, `engines`, `models`, `vertex` (Vertex AI provider), `providers` — experimental in-browser digitize/reconstruct + provider routing (largely legacy).

## 4. Datasets

| Dataset | Type | Count | Labels | Location |
|---|---|---|---|---|
| PTB-XL synthetic renders | synthetic images | ~13,591 tr / 1,698 val / 1,701 test | 18-class scp_codes | VM `~/images` + `labels.csv` |
| Mendeley "ECG Images of Cardiac Patients" | **real, clean digital exports** | 928 | MI 239 / HxMI 172 / Abnormal 233 / Normal 284 | `~/Downloads/gwbz3fsgp8-2` |
| SSMCH-ECG | **real phone photos of paper** | 849 | acute-STEMI 71 / Abnormal 344 / Normal 434 + demographics + free-text (with location) | `~/Downloads/SSMCH-ECG` |
| Owner real photos | real phone photos | ~11 (IMG_8311/18-24/8351/8355/8376) | ad-hoc | `~/Downloads` |
| PTB-XL WFDB samples | signals + renders | 6 records + `rec.dat` | full PTB-XL | `ecgf/*.hea/.dat/.png` |
| Metadata tables | csv | `ptbxl_db.csv` (6,240), `labels.csv` (20,553) | — | `ecgf/` |

**Combined real corpus:** ~1,777 images · ~552 MI-positive (71 explicit acute-STEMI) · ~718 normal · 2 countries · 2 capture styles.

## 5. Integrations
**Live:** PyTorch, timm/EfficientNet, ONNX Runtime, ECGFounder (Net1D, MIT), felixkrones digitiser (ONNX), FastAPI, Cloud Run + Cloud Build + Artifact Registry, Capacitor native app, Vertex AI (app-side), Whisper (dictation, unrelated).
**Available, not wired:** 12-lead ECGFounder. **Absent (notable gaps):** OCR, dedicated image-enhancement / perspective-correction, TensorRT.
**Researched, not integrated:** PMcardio (photo→OMI, CE-marked), Cardiologs/Philips, AccurKardia (signal, FDA), Yale ECG-GPT (weights not released).

## 6. Scripts
**Train:** `train_v2.py`, `train_mi.py`, `train_step2.py`, `train/render.py`, `train/build_labels.py`, `train/master_run_v2.sh`, `setup_v4.sh`.
**Eval/bench:** `eval_realdata.py`, `eval_perclass.py`, `bench_dig.py`, `eval_both.py`, `eval_distort.py`, `validate_real.py`, `metrics_*.json`.
**Pipeline:** `e2e.py`, `e2e_realphoto.py`, `diag_from_wfdb.py`, `convert_ecgfounder.py`, `calibrate_v2.py`, `prep_realeval.py`, `build_perclass_manifest.py`, `train/predict_photo.py`.
**Infra:** `one_sweep.sh`, `gpu_retry.sh` (GPU-VM cycling — GPU stocked out everywhere, ran on CPU throughout).

## 7. Benchmarks

| Benchmark | Dataset | Result | Inference |
|---|---|---|---|
| v1 vs v2 (synthetic) | 800 held-out PTB-XL | clean 0.916→**0.947**; distorted 0.865→**0.893** | ~1–2 s |
| v4 vs v2 (synthetic distorted) | 1,701 | MI-macro v2 **0.876** vs v4 lower; AMI −0.05, IMI −0.04 | — |
| MI fine-tune (synthetic) | 1,701 | MI-macro 0.8724 vs v2 0.8756 (tie/worse) | — |
| **Step-1 real** | 1,777 real | MI-any: **Mendeley 0.90 / SSMCH 0.47**; acute-STEMI 0.48 | — |
| **Step-2 real fine-tune** | held-out real | Mendeley **0.996** / SSMCH 0.60; synth held 0.845 | — |
| **Per-class real (image model)** | real (SSMCH labels) | AFib 0.71 · tachy 0.56 · brady 0.38 · ISC 0.48 · NDT 0.48 · LVH 0.57 | — |
| Live serving batch | 16 real | before: ~14/16 confident-wrong; after v3.1: calibrated + defers | ~1–2 s |
| **digitize→ECGFounder (1-lead)** | 332 real (305 digitised) | **AFib 0.49 · tachy 0.54 · brady 0.60 · MI 0.57 — near-chance.** Digitise success: Mendeley 99%, SSMCH 89% | ~3.9 s/img CPU |

Confusion / FP-FN detail: `MI_REPORT.md`, `MI_STEP2_RESULTS.md`, `MI_REALDATA_STEP1_RESULTS.md`, `metrics_*.json`, `bench_dig_result.json`.

## 8. Failed Experiments

| Experiment | Why it failed | Salvage in a hybrid? |
|---|---|---|
| **Digitiser→ECGFounder** | reconstructed waveform not faithful enough → **near-chance dx even when segmentation succeeds** (AFib 0.49 on the rhythm strip) | **No** — confirmed dead end on real data |
| v4 heavy-aug retrain | heavy augmentation smears fine MI morphology | No (only the "don't over-augment" lesson) |
| MI-focused fine-tune (synthetic) | synthetic-data ceiling for MI | No |
| STTC splice (v2.1) | calibrated STTC could outrank a real MI (under-triage) | Yes IF made finding-only + fail-closed |
| Full multi-class on real | synthetic-only training doesn't transfer; over-fires class-after-class (SBRAD, then IRBBB) | Partially — MI-on-clean only |
| Client-side JS digitize/reconstruct | in-browser digitization unreliable | No |

## 9. Unused Assets
- **12-lead ECGFounder** (353 MB) — never wired. Low expectation now (1-lead rhythm strip already at chance) but the only fully-untested signal asset.
- `image_model_mireal.pt` (real MI detector, clean 0.996) — trained, not deployed.
- `image_model_v4.pt` — rejected; still present in some build contexts.
- Parked Cloud Run revisions `00006-jud` (v21 STTC), `00009-bej` (miscreen); `00003-rqx` kept for rollback.
- App-side `kardiox-digitize-learned.js` / `-reconstruct.js` / `-ecgwave.js` — experimental, unused.
- `ptbxl_db.csv`, WFDB samples — validation only.
- **Never built, cheap, high value:** OCR of the printed machine diagnosis; input-quality/perspective gate.

## 10. Best Possible Hybrid (design only)

**Core principle:** each component has one validated strength — route to strengths; don't force one model to do everything. **The signal path is dropped** (benchmarked dead).

```
Image
 └─ Stage 0  QUALITY + TYPE GATE  (grid/sharpness/layout → clean-export | phone-photo | unreadable→defer)
 └─ Stage 1  OCR the printed machine diagnosis   [free, high-precision — the device's own read]
 └─ Stage 2  IMAGE MODEL (v2, calibrated)         [strength: MI on clean, 0.90]
 └─ Stage 3  FUSE:  MI ← image model ;  cross-check ← OCR text ;  agree → confident, disagree → defer
 └─ Stage 4  CALIBRATION (temp 1.781 + per-class thresholds)
 └─ Stage 5  NORMAL detection + CONFIDENCE + PHYSICIAN-REVIEW defer
 └─ Stage 6  honest "confirm on 12-lead" framing
```

**Why better than any single piece:** uses the image model where proven (MI-clean), OCR to reuse the ECG machine's own validated interpretation for free, and calibration+defer to kill the confident-wrong failure mode. No unreliable signal reconstruction.

**Estimates (rough):**
- Latency: ~1–2 s (image model + OCR). No signal path → no +5–7 s penalty.
- RAM: image model ~0.5 GB + OCR (Tesseract/lightweight) ~0.2 GB ≈ **<1 GB** → fits a 2 GB Cloud Run instance (current). (Signal path would have needed ~2.5 GB / 4 GB instance — avoided.)
- Model size on disk: v2 43 MB (+ OCR engine). ECGFounder (706 MB) and digitiser (113 MB) no longer needed in the serving path.
- Accuracy (honest): MI-on-clean **~0.90** (proven, live); OCR adds high-precision confirmation on any sheet carrying a printed read; rhythm/arrhythmia on real remains the open gap (needs real per-class data). Phone photos remain the hard case.

**Roadmap — ranked by clinical benefit ÷ effort:**
1. **OCR the printed machine diagnosis** — highest benefit / lowest effort. Most 12-leads already carry the machine's read as text; read + cross-check. (~1 day)
2. **Input-quality/type gate** — stops confident mislabeling of unreadable/photo inputs (route to defer). (1–2 days)
3. **Harden the calibrated MI-on-clean screen** (live v3.1) — confidence display, defer tuning, honest UI. (1–2 days)
4. **Real-data collection → per-class fine-tune** — the true ceiling-breaker (esp. phone photos + acute-MI labels). (weeks + data)
5. **Commercial photo→OMI API (PMcardio)** — optional high-accuracy STEMI path. (business/contract, not eng)
6. ~~Digitiser→ECGFounder signal path~~ — **dropped (benchmarked near-chance).**

**One-line verdict:** we have more parts than we've used, but the signal-reconstruction path is now proven dead; the best near-term system is a **quality-gated image-model + OCR-cross-check** with calibration and honest deferral — cheap, and it reuses what already works.
