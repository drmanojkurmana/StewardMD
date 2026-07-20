# KardioX AI — Phase 8 Real-Model Integration Report

Date: 2026-07-21 · Branch `feat/kardiox-ai` · PR #511 · Flag `smd_kardiox`: **OFF**

**Executive summary.** Phase 8 replaced "Not-Ready" providers with real models **wherever a suitable
public, commercially-licensed model actually exists**. The honest finding — grounded in the frozen
`MODEL_LANDSCAPE.md`, not new research — is that **the ECG deep-learning ecosystem has no drop-in,
permissively-licensed, pretrained 12-lead classifier**. Consequently:

- The **signal-analysis engines are operational** on validated open-source libraries (NeuroKit2 + WFDB).
- The **five learned classifiers remain adapters, BLOCKED on unavailable public weights** — each is
  documented with the exact evidence required, and `docs/TRAINING.md` gives the reproducible recipe to
  produce them. **No inference is fabricated.**

This environment cannot download weights, install torch/onnxruntime, or hold PTB-XL, so model *training*
and *clinical validation* happen outside it; what could be built + validated here (measurement against
synthetic ground truth) was.

## 1. Operational providers (real inference, validated engine)

| Stage | Engine | License | Validation status |
|---|---|---|---|
| **Measurement** (HR/PR/QRS/QT/QTc/axis/per-lead/T-wave) | **NeuroKit2** | MIT | **Validated vs synthetic ground truth** (HR within ±8 bpm at 55/75/100; intervals physiologic; T-wave polarity) — `tests/test_measurement_validation.py`. `implemented=True`. |
| **Signal extraction** (px→mV/ms calibration) | WFDB / NumPy | MIT/BSD | Deterministic, unit-validated (amplitude + timing). `implemented=True`. |
| **Rule validation** (criteria + morphology dx + confidence) | Built-in (ported) | in-house | Deterministic, unit-tested. `implemented=True`. |
| **Clinical explanation** (constrained) | Gemini | Apache-2.0 (SDK) | Real; disclaimer-enforced; needs an API key. `implemented=True`. |
| **Rhythm — rate/regularity only** | NeuroKit2 (deterministic) | MIT | Real rate/regularity; **NOT a diagnostic classifier** (see §2). |
| Quality gate / layout / classical digitization | OpenCV (classical) | Apache-2.0 | Real code; thresholds/accuracy need real-photo calibration → `implemented=False`. |

The deterministic decision layer — **evidence fusion, confidence calibration, explainability, serial
comparison, FHIR/report** — is fully operational and feeds off whatever providers are active.

## 2. Remaining adapters — BLOCKED (kept, documented, never faked)

| Priority | Provider | Why blocked | Evidence required to enable |
|---|---|---|---|
| 1 | **Rhythm (diagnostic)** `torchecg` | torch_ecg ships architectures, **no weights**; GPL alternative excluded | Train on PTB-XL → ONNX (`docs/TRAINING.md`) + validation |
| 2 | **Beat classification** | no permissive pretrained beat model | Train on MIT-BIH → ONNX + validation |
| 3 | **Conduction disorders** | no permissive pretrained model | PTB-XL (CD) model; fuse with deterministic BBB/AVB rules |
| 4 | **Morphology** (LVH/STTC) | no permissive pretrained model | PTB-XL (HYP/STTC) model + validation |
| 5 | **MI detection** | no permissive pretrained model | PTB-XL (MI) model; per-lead labels for territory |
| 7 | **Learned digitization** (ECG-Digitiser) | **weights exist (BSD-2)** but require install + on-device validation; cannot run in this sandbox | `pip install` ECG-Digitiser + wire `KARDIOX_DIGITIZER_ENTRYPOINT`; validate digitization accuracy |
| — | **OOD / novelty** (quality) | no shipped model | Train an OOD detector on the target distribution |

Every blocked provider stays in its safe **Not-Ready** state: it raises `pipeline_unavailable` (never
fabricates a label) until a validated checkpoint is configured, and plugs in by **config alone**.

## 3. Model sources & licenses (from the frozen landscape)
- **torch_ecg** — MIT — architectures for all classifiers (train yourself). https://github.com/DeepPSP/torch_ecg
- **PTB-XL** — CC-BY-4.0 (commercial OK) — training/validation data. https://physionet.org/content/ptb-xl/
- **ECG-Digitiser** — BSD-2 — pretrained digitizer (nnU-Net). https://github.com/felixkrones/ECG-Digitiser
- **ecg-image-kit** — BSD-3 — synthetic training images. **NeuroKit2 / WFDB / onnxruntime** — MIT.
- **Excluded:** `ecg_ptbxl_benchmarking` (GPL-3.0 — copyleft), ECG-GPT (research demo, no weights/license).

## 4. Validation status
- **Measurement:** in-project synthetic-ground-truth validation (this repo, CI `test-ml`). PTB-XL
  reference-interval validation pending (needs data + runtime).
- **Classifiers:** none integrated → none validated. Validation protocol specified in `docs/TRAINING.md`.
- **Confidence calibration:** framework operational; **identity (uncalibrated) until temperature is fit**
  on a validation set — honestly reported as `calibrated=false`.

## 5. Benchmark results
Benchmarks are defined as CI tests (`test_measurement_validation.py::test_benchmark_completes_quickly`
+ the `/metrics` per-stage histograms). **They are not measured in this sandbox** (no ML runtime here);
they execute in the CI `test-ml` job and against a deployed pipeline. Targets: measurement < ~2 s/10-s
record on CPU; end-to-end classical pipeline < ~3 s; p95 end-to-end < 90 s (client timeout).

## 6. Remaining blockers before enabling `smd_kardiox`
1. **Train + validate** the classifier ONNX models (rhythm/beat/conduction/morphology/MI) per
   `docs/TRAINING.md`; wire via config.
2. **Integrate + validate ECG-Digitiser** for robust photo→signal digitization.
3. **PTB-XL / reference validation** of measurements + **clinician sign-off** of rules + Learn-ECG content.
4. **Deploy** the pipeline (container + R2/env) and run the benchmarks on target hardware.
5. **Regulatory / SaMD** determination.

Until 1–5 close, KardioX stays flag-OFF. The architecture is complete and every real model plugs in by
configuration; the gap is trained weights + clinical validation, not engineering.
