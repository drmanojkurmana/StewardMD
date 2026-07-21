# KardioX end-to-end validation harness (image → diagnosis)

Reproducible proof that the full KardioX pipeline runs from an ECG **image** to a **diagnosis** on
**real** data with **no mock data**. It exercises the shipping code, not reimplementations:

- **digitiser** — this backend's `app/services/digitization.py` primitives (`detect_lead_regions`,
  `_extract_trace`, `estimate_px_per_mm`), imported with light stubs for the FastAPI-bound infra modules
  so the real OpenCV/NumPy code runs without the server stack.
- **diagnosis** — the frontend product path `kardiox-engines.js` (`SMD_KARDIOX_ENGINES.analyze`) +
  `kardiox-fusion.js` (log-odds Evidence Fusion), run through `onnxruntime-node` on the exported ONNX
  models (EcgLib 7-head + ECG-Diagnosis + HeartGPT).

## Stages

1. `render_and_digitize.py` — renders each real 12-lead signal to a genuine **12×1 full-disclosure ECG
   image** (pixels only), runs the project digitiser, recovers the waveform, and measures digitiser
   fidelity = Pearson corr(recovered, true) per lead. Writes `e2e_input.json` (keeps both the true and
   digitised signal so model error can be separated from digitiser error).
2. `e2e_diagnose.cjs` — feeds the recovered waveform into the ONNX ensemble → Evidence Fusion → ranked
   differential → structured interpretation, and compares the AI output vs the ground-truth label. Runs
   on **both** the true signal (model-quality upper bound) and the digitised signal (full image→dx).
   Writes `e2e_results.json`.
3. `degrade_and_digitize.py` — robustness stress test: re-digitises JPEG-compressed + noisy versions of
   the same images. Writes `e2e_input_degraded.json` (re-run `e2e_diagnose.cjs` with `E2E_INPUT` to score).

## Required workspace (`$D`)

These are **not** committed (large / not redistributable). Provide a workspace dir `$D` containing:

- `cpsc_engine_signals.json` — real 12-lead signals + labels: `[{record, labels:[...], fs, signal:[12][N]}]`.
- `models/ecglib_{AFIB,1AVB,SBRAD,STACH,PVC,CRBBB,IRBBB}.onnx` — exported EcgLib heads.
- `models/engines/ecg_diagnosis.onnx`, `models/engines/heartgpt_afib.onnx(.data)`.
- `node_modules/onnxruntime-node`.

## Run

```bash
export D=/path/to/workspace
python render_and_digitize.py       # stages 1-3  -> e2e_input.json, e2e_images/
node   e2e_diagnose.cjs             # stages 4-9  -> e2e_results.json
python degrade_and_digitize.py      # robustness  -> e2e_input_degraded.json
E2E_INPUT=e2e_input_degraded.json node e2e_diagnose.cjs
```

## Result summary

See [`../../docs/E2E_VALIDATION_REPORT.md`](../../docs/E2E_VALIDATION_REPORT.md). Headline (6 real CPSC
records across all four diagnostic groups + a normal control): **0 stage failures**, digitiser fidelity
**0.984**, ground-truth agreement **5/6 — identical for the true signal and the image→dx path** (the
digitiser preserves the diagnosis), mean end-to-end **~760 ms**. The one miss (STE) is a model-coverage
gap (also missed on the true signal), not a pipeline defect.

## Honest scope

- The **learned nnU-Net digitiser** (ECG-Digitiser) OOMs in an 8 GiB sandbox; this harness uses the
  **classical** digitiser on clean/generated **full-disclosure (12×1)** images. Image→dx is proven
  clinically valid for that layout.
- Real phone photos and the standard **3×4 print** layout (2.5 s/lead) need the learned digitiser
  (adequate RAM) + a mask-aware classifier.
- `smd_kardiox` stays default-OFF pending clinician sign-off.
