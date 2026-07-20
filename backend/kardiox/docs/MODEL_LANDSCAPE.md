# KardioX — Open-Source ECG Model Landscape, Comparison & Recommendation

Research dates: 2026-07-21 (initial) + foundation-model audit (verified from primary sources — repo
LICENSE files + Hugging Face model cards). Purpose: choose which open-source ECG projects to integrate for
(a) image **digitization**, (b) **signal analysis/measurement**, (c) **classification/rhythm**, and
(d) **foundation encoders**, judged on license, weights availability, input, datasets, maintenance, ONNX
feasibility, and **commercial-integration suitability**.

> Honesty guardrails: license + weight-availability facts were checked against each project's repository /
> HF card and **must be re-confirmed at integration time** (licenses/gating change). This document makes
> **no diagnostic-performance claim** for KardioX; upstream numbers are the authors' for *their* systems.

## Verdict summary

| Project | Role | License | Weights public | Verdict | KardioX status |
|---|---|---|---|---|---|
| **NeuroKit2** | signal analysis / measurement | MIT | n/a (algorithms) | INTEGRATE_FULL | **operational** (measurement) |
| **WFDB** | signal I/O + calibration | MIT | n/a | INTEGRATE_FULL | **operational** (signal extraction) |
| **EcgLib** (ispras) | **pretrained classifiers** | **Apache-2.0** | **yes** (28 `.pt`, GH release) | **INTEGRATE_FULL** | **integrated** (`ecglib_provider`), Not-Ready until enabled |
| **ECG-Digitiser** (felixkrones) | image→signal digitizer | **BSD-2** | **yes** (Git-LFS nnU-Net) | INTEGRATE_FULL | integration path (external digitizer entrypoint) |
| **ECG-FM** (bowang-lab) | foundation encoder | **MIT** | yes (HF `wanglab/ecg-fm`) | INTEGRATE_ENCODER | encoder seam + fine-tune recipe |
| **DeepECG-SSL** (HeartWise-AI) | foundation encoder | Apache-2.0* | yes (HF `heartwise`) | INTEGRATE_ENCODER | encoder seam (*confirm bare-encoder license) |
| **HeartGPT** (H. Davies) | foundation encoder | **MIT** | yes (in-repo) | INTEGRATE_ENCODER | encoder seam |
| **torch_ecg** (DeepPSP) | classifier framework | MIT | no (train) | NEEDS_TRAIN | training recipe (`TRAINING.md`) |
| **ecg_ptbxl_benchmarking** | reference benchmark | **GPL-3.0** ⚠️ | yes | REJECT (copyleft) | reference only — never linked |
| **ECGxAI** (UMCUtrecht) | explainable VAE | **AGPL-3.0** ⚠️ + no weights | no | **REJECT** | not integrable |
| **ECG-GPT** (Yale CarDS) | image→report demo | none published | no | REJECT | research demo — not integrable |

### Datasets (for training/validation)
PTB-XL (CC-BY-4.0), MIT-BIH (ODC-BY), Chapman (CC-BY-4.0), CPSC-2018 (CC-BY-4.0), CODE-15% (Zenodo),
**MIMIC-IV-ECG** + **MEETI** (PhysioNet **credentialed + DUA** — adapter+docs only, never redistributed).
All wired via the streaming `DatasetProvider` layer (`docs/DATASETS.md`).

## The commercial-license trap (verified)
- **`ecg_ptbxl_benchmarking` = GPL-3.0** and **`ECGxAI` = AGPL-3.0**: strong/network copyleft — **not usable**
  in a closed commercial product; both **rejected** for linking (ECGxAI additionally ships no weights).
- **`ECG-GPT`** is a research web demo with **no published weights or license** — rejected.
- The commercially-safe set is **MIT/BSD/Apache/CC-BY**: EcgLib (Apache-2.0), ECG-Digitiser (BSD-2),
  ECG-FM/HeartGPT (MIT), DeepECG-SSL (Apache-2.0), torch_ecg (MIT), NeuroKit2/WFDB (MIT), PTB-XL (CC-BY).

## Recommended architecture (implemented)

**ONNX-first interchange** on the KardioX provider seam, with three model tiers:

1. **Turnkey pretrained classifiers → EcgLib (Apache-2.0).** Real binary 12-lead models
   (AFIB/1AVB/STACH/SBRAD/IRBBB/CRBBB/PVC) run via `create_model(pretrained=True)`; positives become
   **fusion candidates** the Rule Engine validates. Integrated as `EcgLibClassifier` (Not-Ready until
   `KARDIOX_ECGLIB_PATHOLOGIES` set + ecglib installed).
2. **Foundation encoders → ECG-FM / DeepECG-SSL / HeartGPT.** Load as feature extractors; attach + fine-tune
   a head for KardioX's label set (they are self-supervised backbones, not ready classifiers). Integration =
   the model-backend seam + the `FineTuningPipeline` (head adaptation) with the exact fine-tune recipe in
   `TRAINING.md`. Encoders are used *now*; clinical heads require fine-tuning + validation.
3. **Custom trained models → torch_ecg on PTB-XL → ONNX.** For labels no pretrained model covers.

**Digitization:** ECG-Digitiser (BSD-2, pretrained) via the `external` digitizer entrypoint +
`ConsensusDigitization`. **Signal analysis:** NeuroKit2 + WFDB (operational). **Fusion → calibration →
explainability → Differential Diagnosis Engine → FHIR** remains KardioX's deterministic clinical layer,
into which every model output flows as weighted evidence (never a bare model verdict).

## Model-input contracts (confirm per checkpoint)
- EcgLib: 12-lead, ~500 Hz (`ptbxl_500hz_10s` spec) — confirm length vs installed ecglib.
- ECG-FM: 12-lead 500 Hz, 5 s segments (2500), z-scored (wav2vec2, via fairseq-signals).
- DeepECG-SSL: 12-lead 250 Hz, 10 s (2500).
- HeartGPT: tokenized single-lead time-series (GPT-style).
Adapters (`app/services/models/adapters.py` `INPUT_SPECS` + `LabelMap`) normalize KardioX signals to each.

## What KardioX does NOT do
Ship weights, fabricate inference, or claim diagnostic performance. Model-backed providers stay Not-Ready
(raise `pipeline_unavailable`) until enabled + validated; `smd_kardiox` stays OFF until clinical validation
+ clinician sign-off + regulatory review.

## Sources (verified)
- EcgLib — https://github.com/ispras/EcgLib (Apache-2.0; release v1.1.0 weights)
- ECG-Digitiser — https://github.com/felixkrones/ECG-Digitiser (BSD-2; PhysioNet-2024 winner)
- ECG-FM — https://github.com/bowang-lab/ECG-FM + https://huggingface.co/wanglab/ecg-fm (MIT)
- DeepECG-SSL — https://github.com/HeartWise-AI/DeepECG_Docker + HF `heartwise` (Apache-2.0*)
- HeartGPT — https://github.com/harryjdavies/HeartGPT (MIT)
- torch_ecg — https://github.com/DeepPSP/torch_ecg (MIT); PTB-XL — https://physionet.org/content/ptb-xl (CC-BY-4.0)
- REJECTED: ecg_ptbxl_benchmarking (GPL-3.0), ECGxAI https://github.com/UMCUtrecht-ECGxAI/ecgxai (AGPL-3.0, no weights),
  ECG-GPT https://www.cards-lab.org/ecg-gpt (demo, no license/weights)
