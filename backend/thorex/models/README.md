# On-device conversion artifacts (PoC)

This directory holds generated model binaries from
`scripts/convert_densenet_ondevice.py`. **Binaries are gitignored** (see
`.gitignore`) — regenerate them locally, they are not checked in.

Regenerate:

```bash
cd backend/thorex
.venv/bin/python scripts/convert_densenet_ondevice.py
```

## Last verified run (2026-07-25, macOS, Python 3.14.6, torch 2.13.0)

| Artifact | Size | Parity vs PyTorch |
|---|---|---|
| `thorex_densenet_clinical.onnx` (opset 17) | 28.24 MB | max_abs_diff = 3.28e-07, mean_abs_diff = 3.93e-08 (assert `< 1e-3` passes) |
| `thorex_densenet_clinical.mlpackage` (ML Program, fp32) | not produced | coremltools 9.0 fails to convert this model on torch 2.13 (`TypeError: only 0-dimensional arrays can be converted to Python scalars`, in the `int` op / `_cast` path) — a real conversion bug on this torch/coremltools combo, independent of the model's own logic |

Estimated (not measured — no Core ML artifact exists to inspect) on-device
weight footprint from the real parameter count (densenet121, ~6.97M params):
fp32 ≈ 27.86 MB, fp16 ≈ 13.93 MB, int8 ≈ 6.97 MB.

Full details, exact commands, and the reasoning behind the two independent
Core ML blockers (a MIL op conversion bug, and this Python's coremltools
build lacking the compiled local-prediction runtime) are in
`.superpowers/sdd/thorex-followups/ondevice-poc-report.md`.

CAM feasibility (forward-only, no backward pass needed): `model.features(x)`
→ `1x1024x7x7`, `model.classifier` → `Linear(1024, 18)`. Class activation map
= weighted sum of the 1024 feature channels using `classifier.weight[class]`,
confirmed by inspection.
