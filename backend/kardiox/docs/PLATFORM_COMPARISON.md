# KardioX vs ExChanGeAI — Architecture Comparison & Adoption Report

Paper: *"End-to-End Platform for Electrocardiogram Analysis and Model Fine-Tuning: Development and
Validation Study"* (PMC12858047) — the **ExChanGeAI** platform, `github.com/VargheseLab/exchangeai`,
**MIT license**. Analyzed 2026-07-21 for engineering practices, not clinical results.

**Method:** no ExChanGeAI code was copied. It is MIT-licensed (so reuse would be permitted with
attribution), but KardioX adopts its *practices*, re-implemented to fit KardioX's provider/seam
architecture. Verdicts below: **ADOPT** (took the practice), **KEEP-OURS** (KardioX already better),
**REJECT** (not applicable/inferior for our goals).

## Dimension-by-dimension

| # | Dimension | ExChanGeAI | KardioX decision | Why |
|---|---|---|---|---|
| 1 | **Dataset abstraction** | Multi-format ingest (CSV/npy/DICOM/mat/dat/xml) → unified 12-lead/10s/mV | **ADOPT** the multi-format normalizer (`app/data/formats.py`) **+ KEEP-OURS** streaming `DatasetProvider` | ExChanGeAI normalizes formats well; KardioX adds streaming + credentialed-DUA awareness + multimodal `Sample` (waveform/image/report/features) it lacks |
| 2 | **ECG preprocessing** | FFT-resample to 100 Hz, mV scale, crop/pad, NeuroKit2, Rlign median-beat | **ADOPT** FFT-resample + mV-scale + crop/pad in `formats.py`; **KEEP-OURS** OpenCV image pipeline + NeuroKit2 measurement | Their signal normalization is clean; KardioX additionally handles the *image → signal* path (their platform assumes signals) |
| 3 | **Training pipeline** | PyTorch, AdamW + ExponentialLR(γ=0.9), auto LR-finder, 50-epoch cap, early stop on weighted val loss, checkpoint best | **ADOPT** all of it (`TrainingPipeline` + `HyperparameterConfig`) | Validated, sensible defaults; re-implemented with an **injectable DL backend** so orchestration is testable |
| 4 | **Fine-tuning** | Head-only + full modes; ONNX→PyTorch convert; **automatic head adaptation** to new label count | **ADOPT** (`FineTuningPipeline`: modes + `adapt_head(n)` + freeze) | Directly matches KardioX's foundation-encoder fine-tuning need (ECG-FM/DeepECG/HeartGPT) |
| 5 | **Benchmark pipeline** | Weighted/macro F1, acc, prec/recall, Brier, ECE, confusion, per-class ROC, bootstrapped 95% CI, Fmax thresholds, FLOPs/latency; **cross-dataset external validation** | **ADOPT** (`BenchmarkPipeline` + `cross_validate`) | Richer than KardioX had; cross-dataset external validation is a strong generalization check |
| 6 | **Model registry** | ONNX-first; WebDAV "Model ExChanGe" server | **ADOPT** ONNX-first `ModelRegistry`; **REJECT** WebDAV | ONNX-first aligns with our Phase-6F seam; a WebDAV server is unneeded infra — local manifest + provenance (source/license) suffices and is auditable |
| 7 | **Experiment tracking** | Per-epoch loss/F1, label dist, base model, artifacts; **no** MLflow/W&B | **ADOPT** file-based `ExperimentTracker` (JSONL) | Dependency-free, offline, CI-friendly — matches their approach; optional MLflow can sit behind the same API |
| 8 | **Hyperparameters** | UI web forms | **KEEP-OURS** config/code-driven (`HyperparameterConfig`) | Config-as-code is reproducible + versionable + CI-testable; a UI is out of scope (and KardioX is a backend, not a web-training app) |
| 9 | **Inference architecture** | ONNX Runtime; dynamic batch; ~27 ms/ECG CPU | **KEEP-OURS** provider seam + ONNX backend (Phase 6F) | KardioX already ONNX-first inference **plus** a rule-engine/fusion/calibration/explainability/FHIR clinical layer ExChanGeAI does not have |
| 10 | **Validation workflow** | 80/20 stratified; PTB-XL fold-10 hold-out; cross-dataset; paired t-tests | **ADOPT** split + fold + cross-dataset conventions (`ValidationPipeline` + benchmark) | Solid, standard; PTB-XL fold convention baked into the PTB-XL adapter |
| 11 | **Deployment** | Containerized web app, local compute, privacy-by-default | **KEEP-OURS** Cloudflare edge + FastAPI + multi-stage Docker + R2-ephemeral + security hardening (Phase 6D/E) | KardioX's serving/security posture is more production-hardened for a commercial API |
| 12 | **Datasets / models** | PTB-XL, MIMIC-IV-ECG, Yang, EDMS; XceptionTime/InceptionTime/DSAIL-SNU/ECG-FM | **KEEP-OURS + EXTEND** — KardioX adds MIT-BIH, Chapman, CPSC, CODE-15, MEETI + the audited foundation encoders | Broader dataset + foundation-model coverage; MEETI adds true multimodal (image+report) |

## What was ADOPTED (concretely)
- `HyperparameterConfig` — AdamW + ExponentialLR(0.9), 50-epoch cap, early stop on weighted val loss,
  80/20 stratified, normalize=zscore(pretrained)/none(de-novo).
- `TrainingPipeline` — LR-finder step, epoch loop, early stopping, best-checkpoint, ONNX export + registry.
- `FineTuningPipeline` — head-only/full modes + automatic classification-head adaptation.
- `BenchmarkPipeline` — the full ExChanGeAI metric suite + bootstrapped CIs + Fmax + **cross-dataset**
  external validation + latency.
- `ModelRegistry` — ONNX-first, with provenance (source + license) as first-class fields.
- `ExperimentTracker` — file-based JSONL run tracking (no external service), like theirs.
- `app/data/formats.py` — multi-format ingest + FFT-resample + mV-scale + crop/pad normalization.

## What was REJECTED / KEPT-OURS (and why)
- **WebDAV "Model ExChanGe" server — rejected:** unnecessary infrastructure; a local manifest with
  provenance is simpler, auditable, and enough for a commercial deployment.
- **UI-form hyperparameters — kept-ours (config-as-code):** reproducibility + CI + version control.
- **Clinical decision layer — kept-ours:** ExChanGeAI is a training/benchmark platform; KardioX's
  deterministic **Rule Engine + Evidence Fusion + Confidence Calibration + Explainability + FHIR/report**
  and its **honesty/Not-Ready** discipline are a superior clinical-safety layer it does not provide.
- **Serving + security — kept-ours:** edge Worker + FastAPI + ephemeral R2 + upload validation + rate
  limiting + audit + graceful shutdown (Phase 6) exceed a local containerized web app for a commercial API.

## Net effect
KardioX gains a production **training/benchmark/fine-tuning platform** (the six requested components) built
on ExChanGeAI's validated practices, while retaining its stronger clinical-serving architecture. No code
was duplicated; no dataset is bundled; every adopted practice is re-implemented to the KardioX contracts.
