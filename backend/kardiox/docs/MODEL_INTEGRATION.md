# KardioX — Model Integration Guide (Phase 6F)

How to plug a trained ECG model into the pipeline **without changing any application code, routes, or the
iOS app**. KardioX ships **no weights**; until a validated checkpoint is provided, the model-backed
providers report *not ready* and raise `pipeline_unavailable`.

## The seam

```
Provider (e.g. TorchECGRhythm)  ──uses──▶  ModelBackend  ──wraps──▶  your trained artifact
        (unchanged)                      (config-selected)          (.pt / .onnx / SavedModel)
```

A `ModelBackend` (see `app/services/models/`) exposes `predict(signal_tensor) → {label, confidence, probs}`.
Providers depend only on this interface. Swapping a model is a **config change**, not a code change.

### Input contract
`signal_tensor(signal)` converts the pipeline's signal dict to a normalized `float32` array shaped
`(1, C, T)` in `STANDARD_LEADS` order (`I, II, III, aVR, aVL, aVF, V1..V6`), z-scored per channel. Your
checkpoint must accept that shape (or adapt it inside a wrapper you script into the artifact). Document
the exact `C`/`T`/sampling rate your checkpoint expects next to the file.

### Output contract
Logits or probabilities over your classes. `predict` applies softmax + argmax and maps the index to
`KARDIOX_RHYTHM_MODEL_LABELS` (comma-separated, in class order).

## Supported backends

| kind | runtime | artifact | notes |
|---|---|---|---|
| `torchscript` | torch | `model.pt` (scripted/traced) | recommended: self-contained, no architecture code |
| `onnx` | onnxruntime | `model.onnx` | portable, CPU/GPU EPs |
| `torch_statedict` | torch | `state_dict.pt` + a `module_factory` | needs the architecture in code (pass `module_factory`) |
| `tensorflow` | tensorflow | SavedModel dir | uses `serving_default` |
| `ensemble` | — | N member backends | averages member probability vectors |

## Enable a rhythm model (example: TorchScript)

1. Train + **validate** a model (PTB-XL / MIT-BIH). Script it: `torch.jit.script(model).save("rhythm.pt")`.
2. Put `rhythm.pt` on the model-serving image (build with `--build-arg INSTALL_ML=true`, add `torch`).
3. Set env — **no code change**:
   ```
   KARDIOX_MODE=live
   KARDIOX_PROVIDER_RHYTHM=torchecg
   KARDIOX_RHYTHM_MODEL_KIND=torchscript      # or onnx | torch_statedict | tensorflow
   KARDIOX_RHYTHM_MODEL_PATH=/models/rhythm.pt
   KARDIOX_RHYTHM_MODEL_LABELS=sinus,af,aflutter,svt,vt,paced,other
   ```
4. `GET /v1/ready` turns green only when the checkpoint loads. Flip `implemented=True` on the provider
   **after clinical validation**, and only then consider enabling the frontend flag.

## Ensembling

```python
from app.services.models import load_backend, EnsembleBackend
members = [load_backend("torchscript", "/models/a.pt"), load_backend("onnx", "/models/b.onnx")]
ens = EnsembleBackend(members, labels=[...])
```

## Non-negotiables
- **Never fabricate output.** A missing runtime/checkpoint → `UpstreamUnavailable`, never a fake label.
- A model producing a *diagnosis* still flows through the deterministic **Rule Engine** for validation +
  explainability; Gemini only explains rule-validated findings. Adding a model does not bypass that.
