# KardioX — Producing the Classifier Weights (the Phase-8 unblock recipe)

KardioX ships **no model weights**. The classifier providers (rhythm, beat, conduction, morphology, MI)
are Not Ready because **no public, commercially-licensed, pretrained ECG classifier exists** that we can
drop in (per the frozen `MODEL_LANDSCAPE.md`: `torch_ecg` is MIT but ships architectures only;
`ecg_ptbxl_benchmarking` has weights but is GPL-3.0 → excluded for a commercial product; ECG-GPT is a
demo with no license). This document is the concrete, reproducible recipe to **train + export ONNX
weights** that plug into the existing seam with **zero code change**. It is a reference recipe — run it in
a GPU training environment, not in the app.

> This recipe produces the models; it does not certify them. Clinical validation + clinician sign-off +
> regulatory review are still required before `smd_kardiox` is enabled.

## Ingredients (all permissive / open)
- **torch_ecg** (MIT) — model architectures + training utilities. `pip install torch-ecg`.
- **PTB-XL** (CC-BY-4.0, commercial OK) — 21 799 clinical 12-lead ECGs with SCP-ECG labels + diagnostic
  **superclasses** (NORM, MI, STTC, CD, HYP) and rhythm/form statements. Download from PhysioNet.
- **MIT-BIH Arrhythmia** / **CPSC2018** — for beat-level + additional rhythm classes.
- `torch`, `onnx`, `onnxruntime`, `wfdb`, `numpy`, `scikit-learn`.

## Target contract (must match the KardioX seam)
- **Input:** `(1, 12, 5000)` float32, leads in `STANDARD_12` order, 500 Hz, 10 s, per-channel z-scored —
  exactly what `models.adapt_signal(signal, INPUT_SPECS["ptbxl_500hz_10s"])` emits.
- **Output:** class logits/probabilities; class order documented in `KARDIOX_*_MODEL_LABELS` /
  `KARDIOX_SPECIALISTS[...]["labels"]`.
- **Format:** TorchScript or **ONNX** (recommended — runs on `onnxruntime`, framework-independent).

## Recipe (rhythm / diagnostic-superclass example)

```python
# train_rhythm_ptbxl.py  — REFERENCE recipe; adapt to your torch_ecg version + hardware.
import numpy as np, torch, wfdb, ast, pandas as pd
from torch_ecg.models import ECG_CRNN            # or ECG_SEQ_LAB_NET / ResNet1D, per the task
# 1. load PTB-XL (500 Hz records) + the diagnostic superclass labels from scp_statements.csv
#    build X: (N, 12, 5000) at 500 Hz, per-channel z-score; y: multi-label superclass vector
# 2. train with a class-balanced loss; hold out the official PTB-XL test fold (strat_fold==10)
model = ECG_CRNN(classes=["NORM","MI","STTC","CD","HYP"], n_leads=12, config=...)
#    ... training loop (see torch_ecg examples) ...
# 3. export ONNX in the KardioX input shape
model.eval()
dummy = torch.randn(1, 12, 5000)
torch.onnx.export(model, dummy, "rhythm.onnx",
                  input_names=["ecg"], output_names=["logits"],
                  dynamic_axes={"ecg": {0: "batch"}}, opset_version=17)
# 4. validate: onnxruntime inference on the held-out fold; report macro-AUROC / F1 + a reliability
#    diagram; fit the temperature (KARDIOX_CALIBRATION_TEMPERATURE) from the validation logits.
```

## Wire it in (no code change)

Diagnostic-superclass model as a specialist (or as the rhythm provider):
```
KARDIOX_SPECIALISTS_JSON='{"mi": {"path": "/models/rhythm.onnx", "kind": "onnx",
  "labels": "NORM,MI,STTC,CD,HYP", "inputSpec": "ptbxl_500hz_10s", "labelMap": "ptbxl_superclass"}}'
# or the dedicated rhythm slot:
KARDIOX_PROVIDER_RHYTHM=torchecg KARDIOX_RHYTHM_MODEL_KIND=onnx \
KARDIOX_RHYTHM_MODEL_PATH=/models/rhythm.onnx KARDIOX_RHYTHM_MODEL_INPUT_SPEC=ptbxl_500hz_10s \
KARDIOX_RHYTHM_LABEL_MAP=ptbxl_superclass KARDIOX_RHYTHM_MODEL_LABELS=NORM,MI,STTC,CD,HYP
```
The output flows automatically into the **fusion → calibration → explainability → report** chain, and the
Rule Engine still validates every model finding.

## Per-task notes
| Task | Dataset(s) | torch_ecg model | Notes |
|---|---|---|---|
| Rhythm / superclass | PTB-XL | ECG_CRNN / ResNet1D | best-characterized; start here |
| Beat classification | MIT-BIH | ECG_SEQ_LAB_NET | per-beat; different output head (sequence) |
| Conduction (BBB/AVB) | PTB-XL (CD) | ECG_CRNN | overlaps deterministic rules — fuse, don't replace |
| Morphology (LVH/STTC) | PTB-XL (HYP/STTC) | ECG_CRNN | subtle patterns beyond voltage rules |
| MI | PTB-XL (MI) + PTB | ResNet1D | territory localization needs per-lead labels |

## Digitization (ECG-Digitiser)
The learned digitizer path is different — a **pretrained** model already exists: **ECG-Digitiser**
(felixkrones, **BSD-2**, PhysioNet-Challenge-2024 winner, ships nnU-Net weights via Git LFS). Install it,
then expose a wrapper as the external digitizer entrypoint (`KARDIOX_DIGITIZER_ENTRYPOINT=pkg.mod:fn`)
returning the KardioX traces contract (`{"leads": {lead: [px...]}, "calibration": {...}}`). No KardioX
code change — the `ExternalDigitization` provider + `ConsensusDigitization` already consume it.

## Validation protocol (required before enabling)
1. Hold-out **PTB-XL test fold** (never seen in training) → macro-AUROC / F1 per class + confusion matrix.
2. Measurement error vs PTB-XL+ reference intervals (bias ± limits of agreement for HR/PR/QRS/QTc/axis).
3. Fit + verify **confidence calibration** (temperature / reliability diagram).
4. Failure-mode + OOD analysis; confirm graceful degradation.
5. **Clinician sign-off** + regulatory/SaMD review.
