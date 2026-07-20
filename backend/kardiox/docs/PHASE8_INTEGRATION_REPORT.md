# KardioX AI — Real-Model Integration Report (Phases 8–9)

Date: 2026-07-21 · Branch `feat/kardiox-ai` · PR #511 · Flag `smd_kardiox`: **OFF**

**Executive summary.** A verified foundation-model audit (primary sources — repo LICENSE files + HF cards)
**overturned** the earlier "no drop-in classifier" conclusion: **EcgLib** ships pretrained, **Apache-2.0**
binary 12-lead classifiers and is now **integrated** as real inference. Signal analysis is operational
(NeuroKit2 + WFDB). Three commercially-licensed **foundation encoders** (ECG-FM/DeepECG-SSL/HeartGPT) and a
pretrained **digitizer** (ECG-Digitiser) have real integration paths (encoder now, fine-tuned head next).
Copyleft/demo projects (ecg_ptbxl_benchmarking GPL, ECGxAI AGPL, ECG-GPT) are **rejected** with reasons.
**No inference is fabricated; no weights are shipped; nothing is enabled for end users.**

## 1. Operational (real inference, validated engine)

| Stage | Engine | License | Status |
|---|---|---|---|
| **Measurement** (HR/PR/QRS/QT/QTc/axis/per-lead/T-wave) | NeuroKit2 | MIT | **Validated vs synthetic ground truth**; `implemented=True` |
| **Signal extraction** (px→mV/ms) | WFDB/NumPy | MIT/BSD | Deterministic, unit-validated; `implemented=True` |
| **Rule validation + morphology dx + fusion + calibration + explainability + Differential Diagnosis Engine + FHIR** | in-house | — | Deterministic clinical layer, unit-tested + executed here |

## 2. Integrated model providers (real code; Not-Ready until enabled + libs/weights present — never faked)

| Provider | Source | License | What it does | Enable |
|---|---|---|---|---|
| **EcgLib** (`ecglib_provider`) | ispras/EcgLib | **Apache-2.0** | Pretrained binary classifiers AFIB/1AVB/STACH/SBRAD/IRBBB/CRBBB/PVC → fusion candidates | `KARDIOX_ECGLIB_PATHOLOGIES=…` + `pip install ecglib torch` |
| **ECG-Digitiser** | felixkrones | BSD-2 | Pretrained image→signal digitizer (nnU-Net) | `KARDIOX_PROVIDER_DIGITIZATION=external` + entrypoint |
| **Foundation encoders** | ECG-FM (MIT) / DeepECG-SSL (Apache-2.0) / HeartGPT (MIT) | permissive | Feature extractors; fine-tune a head via `FineTuningPipeline` | model-backend seam + `docs/TRAINING.md` |
| **torch_ecg** | DeepPSP | MIT | Architectures to train custom heads | `docs/TRAINING.md` |

Each raises `pipeline_unavailable` (a clean Not-Ready) until configured; outputs flow into the
weighted-fusion → Differential Diagnosis Engine (the Rule Engine validates every model finding).

## 3. Rejected (documented)
- **`ecg_ptbxl_benchmarking` — GPL-3.0** (copyleft): reference/benchmark only, never linked.
- **`ECGxAI` — AGPL-3.0 + no public weights**: not commercially usable, nothing to run.
- **`ECG-GPT` (Yale CarDS) — research web demo, no license/weights**: not integrable.

## 4. Data + training platform (this phase)
Streaming `DatasetProvider` layer (no data bundled): **MIMIC-IV-ECG** (full, credentialed) + **MEETI**
(credentialed, multimodal) + PTB-XL / MIT-BIH / Chapman / CPSC / CODE-15% (open). `TrainingPipeline` /
`FineTuningPipeline` (auto head-adaptation + provenance) / `BenchmarkPipeline` (cross-dataset, ExChanGeAI
metrics) / `ValidationPipeline`, `ModelRegistry` (ONNX-first + provenance), `ExperimentTracker`. Adopts
ExChanGeAI (MIT) practices (`docs/PLATFORM_COMPARISON.md`, `docs/DATASETS.md`). Orchestration executed here
with stub backends; the DL step runs in a training environment.

## 5. Validation status
- **Measurement**: in-repo synthetic-ground-truth validation (CI). PTB-XL reference validation pending.
- **EcgLib / foundation models**: upstream-validated by their authors; **KardioX-pipeline validation
  (on digitized signals) + calibration fitting pending** — this is the gate to `implemented`/enable.
- **Confidence calibration**: framework operational; identity (`calibrated=false`) until a temperature is fit.
- **Differential Diagnosis Engine**: deterministic; 6 tests executed here — no fabrication.

## 6. Benchmarks
Defined as CI tests + `BenchmarkPipeline` (weighted/macro/micro F1, Brier, ECE, bootstrapped CI, Fmax,
latency, cross-dataset). **Not measured in this sandbox** (no ML runtime); run in CI `test-ml` + on a
deployed pipeline. Targets: measurement < ~2 s/10-s record CPU; classical pipeline < ~3 s; p95 < 90 s.

## 7. Production readiness
- **Infrastructure + platform + clinical layer:** high (provider seam, fusion, DDx, datasets, training
  pipelines, ONNX registry, security/serving from Phase 6).
- **Clinical AI:** EcgLib gives a real classifier path; still needs KardioX-pipeline validation +
  calibration + clinician sign-off.
- **Overall: NOT READY for end users** (flag OFF).

## 8. Blockers before enabling `smd_kardiox`
1. Enable + **validate EcgLib** on KardioX-digitized signals; fit confidence calibration.
2. **Fine-tune** a foundation encoder (or train torch_ecg) for labels EcgLib doesn't cover; validate.
3. **Integrate + validate ECG-Digitiser** for robust photo→signal.
4. **PTB-XL / reference validation** of measurements + **clinician sign-off** of rules + Learn-ECG content.
5. **Deploy** (container + R2/env) + run benchmarks; **regulatory / SaMD** review.

The architecture is complete and every real model plugs in by configuration; the remaining gap is
**validation + clinical/regulatory sign-off**, not engineering.
