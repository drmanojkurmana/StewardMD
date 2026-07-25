# On-device conversion artifacts

This directory holds generated model binaries. **Binaries (`*.onnx`,
`*.mlpackage/`) are gitignored** (see `.gitignore`) — regenerate them
locally, they are not checked in. The labels JSON (`thorex_clinical_labels.json`)
and this README ARE checked in.

## Clean, CAM-enabled clinical export (current, for onnxruntime-web)

`scripts/export_clinical_onnx.py` produces the artifacts actually intended
for on-device (browser, onnxruntime-web) use:

```bash
cd backend/thorex
.venv/bin/python scripts/export_clinical_onnx.py
```

Model: `xrv.models.DenseNet(weights="densenet121-res224-all")`, wrapped so
the ONNX graph is a clean `conv -> GAP -> FC -> sigmoid` with a baked-in CAM
head — no xrv `op_norm` boolean-mask indexing in the graph (the thing that
broke coremltools in the prior PoC). The wrapper reproduces `op_norm`'s
*exact numeric result* using only plain ops (`torch.where` on a `<`
comparison instead of boolean-mask assignment), verified safe because this
checkpoint's `op_threshs` has zero NaNs (the script hard-fails if that ever
changes rather than silently drifting).

**Input:** `input`, float32 `[1,1,224,224]`, xrv-normalized 224x224 grayscale
(same preprocessing as `app/pipeline/preprocess.py`: `normalize(arr,255)` →
`XRayCenterCrop` → `XRayResizer(224)`).

**Outputs:**
- `probs` — float32 `[1,18]`, per-pathology probability in `[0,1]`, order =
  `thorex_clinical_labels.json`. Numerically identical (parity < 1e-3, see
  below) to `TorchXRayVisionProvider.detect()`.
- `cam` — float32 `[1,18,7,7]`, per-class Class Activation Map: a 1x1 conv
  over the RAW `model.features(x)` output (pre-ReLU, pre-GAP) using the
  classifier weight matrix reshaped to a conv kernel (`[18,1024]` →
  `[18,1024,1,1]`), bias=0. Forward-only, no backward pass.

### Last verified run (2026-07-25, macOS, Python 3.14.6, torch 2.13.0, onnxruntime 1.28.0)

| Artifact | Size | Parity |
|---|---|---|
| `thorex_clinical.onnx` (fp32, opset 17) | 28.31 MB | torch-vs-onnx max_abs_diff = 3.28e-07; onnx-vs-original-`detect()` max_abs_diff = 3.28e-07 (both `< 1e-3`) |
| `thorex_clinical_fp16.onnx` (via `onnxconverter_common.float16`, `keep_io_types=True`) | 14.25 MB | vs fp32: max_abs_diff = 2.81e-03, mean_abs_diff = 4.01e-04 |
| `thorex_clinical_int8.onnx` (`onnxruntime.quantization.quantize_dynamic`, `QInt8`) | 7.84 MB | vs fp32: max_abs_diff = 6.04e-02, mean_abs_diff = 2.11e-02 |

CAM sanity: shape `[1,18,7,7]` confirmed; argmax-class (`Effusion`, prob
0.92 on the synthetic test image) CAM is non-degenerate (std ≈ 5.33 over
the 7x7 map, min 4.69 / max 24.23).

Note on int8: the ~6% max_abs_diff is larger than fp16's; dynamic
quantization of a deep DenseNet-121 (many stacked Conv/BatchNorm/Gemm
layers) compounds per-layer weight-quantization error more than a typical
shallow classifier. Treat int8 as usable for coarse triage, not as a
drop-in replacement for fp32/fp16 — validate against real chest X-rays
(not just the synthetic parity check here) before shipping it as a default.

Labels: `thorex_clinical_labels.json` — the ordered 18-pathology label
list (`model.pathologies` with empty slots dropped), so the JS side maps
output index N to the correct label.

Served copy for local browser-harness verification: a copy of the fp32
model + labels is also written to the repo root at `models/thorex_clinical.onnx`
and `models/thorex_clinical_labels.json` (also gitignored for the `.onnx`;
the labels JSON there is a convenience copy, not a second source of truth).
Point onnxruntime-web / any static file server at that path, or copy the
same two files under whatever directory your dev server / Capacitor `www/`
build serves statically.

Regenerate:

```bash
cd backend/thorex
.venv/bin/python scripts/export_clinical_onnx.py
```

## Prior PoC (raw-forward export, superseded)

`scripts/convert_densenet_ondevice.py` — the original PoC that exported the
raw xrv `DenseNet.forward()` (including `op_norm`'s boolean-mask
post-processing baked into the graph) and separately probed Core ML
conversion + CAM feasibility. Kept for reference; the clean export above is
the one intended for shipping.

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
