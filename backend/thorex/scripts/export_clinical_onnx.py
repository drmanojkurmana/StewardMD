"""ThoreX on-device foundation: export a CLEAN, CAM-ENABLED ONNX build of the
clinical TorchXRayVision DenseNet-121 for onnxruntime-web (no cloud).

This is additive tooling only — it does NOT modify app/runtime code. It
reads `app.pipeline.preprocess` (same preprocessing the API uses) and
`app.providers.torchxrayvision_provider.TorchXRayVisionProvider` (the exact
reference implementation whose numbers we must match), and writes artifacts
under `backend/thorex/models/`.

Why a NEW wrapper (not the prior `convert_densenet_ondevice.py` PoC output)
--------------------------------------------------------------------------
The prior PoC exported the *raw* xrv `DenseNet.forward`, which — for
"densenet121-res224-all" — has a non-None `op_threshs`, so the real forward
path is:

    features = relu(model.features(x)); pooled = GAP(features)
    logits = model.classifier(pooled)
    probs  = op_norm(sigmoid(logits), op_threshs)

`op_norm` (in torchxrayvision.models) uses BOOLEAN-MASK ASSIGNMENT
(`outputs_new[mask] = ...`), which the PoC's docstring already flagged as
the thing that broke Core ML conversion. It traces fine into a plain ONNX
graph (parity 3.3e-7 per the PoC), but it is not the clean
"conv -> GAP -> FC -> sigmoid" graph shape requested here, and boolean-mask
ops are exactly the kind of thing that trips up non-CPU execution providers
(Core ML EP / NNAPI EP) downstream.

This script's wrapper reproduces the IDENTICAL NUMERIC RESULT of op_norm
using only plain elementwise ops (`torch.where` on a `<` comparison,
`torch.sigmoid`, arithmetic) — no boolean-mask indexing/assignment. We
verified `op_threshs` for this checkpoint has zero NaNs (see report), so
the NaN-preserving branch of the original `op_norm` (which forces those
slots to 0.5) is provably a no-op here and is omitted; if that ever
changes, the parity assertion below will start failing loudly, not
silently drift.

Wrapper outputs
----------------
  probs: [1, N] sigmoid+op_norm-equivalent probabilities, N = len(model.pathologies)
         (must match TorchXRayVisionProvider.detect() exactly)
  cam:   [1, N, 7, 7] per-class CAM maps — a 1x1 conv over the RAW
         `model.features(x)` feature map (pre-ReLU, pre-GAP) using the
         classifier's weight matrix reshaped to a conv kernel
         ([N,1024] -> [N,1024,1,1]), bias=0 (standard CAM: the bias is a
         constant offset that doesn't change the localization pattern).
         Forward-only — no gradients, no backward pass needed on-device.

Usage (from backend/thorex):
    .venv/bin/python scripts/export_clinical_onnx.py
"""
from __future__ import annotations

import io
import json
import shutil
import sys
import time
import traceback
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
THOREX_ROOT = SCRIPT_DIR.parent
REPO_ROOT = THOREX_ROOT.parent.parent
MODELS_DIR = THOREX_ROOT / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
ROOT_MODELS_DIR = REPO_ROOT / "models"

sys.path.insert(0, str(THOREX_ROOT))  # so `import app...` resolves like the real backend

FP32_PATH = MODELS_DIR / "thorex_clinical.onnx"
FP16_PATH = MODELS_DIR / "thorex_clinical_fp16.onnx"
INT8_PATH = MODELS_DIR / "thorex_clinical_int8.onnx"
LABELS_PATH = MODELS_DIR / "thorex_clinical_labels.json"


def build_synthetic_input():
    """Build a real 1x1x224x224 input tensor the same way the API does:
    synthetic CXR-like PNG bytes -> app.pipeline.preprocess.prepare -> array.
    """
    import torch
    from app.pipeline import preprocess

    rng = np.random.default_rng(42)
    size = 512
    yy, xx = np.mgrid[0:size, 0:size]
    cx, cy = size / 2, size / 2
    r = np.sqrt((xx - cx) ** 2 + ((yy - cy) * 0.9) ** 2)
    base = 200 - (r / r.max()) * 140
    noise = rng.normal(0, 8, size=(size, size))
    img = np.clip(base + noise, 0, 255).astype("uint8")
    from PIL import Image
    pil = Image.fromarray(img, mode="L")
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    prepared = preprocess.prepare(png_bytes, "synthetic_cxr.png")
    array = prepared.array  # 224x224 float32, xrv-normalized
    print(f"  preprocess.prepare -> array shape={array.shape}, dtype={array.dtype}, "
          f"min={array.min():.2f}, max={array.max():.2f}")
    input_tensor = torch.from_numpy(array[None, None, ...].astype("float32"))  # 1x1x224x224
    return prepared, input_tensor


class ThorexClinicalWrapper:
    """Built lazily below (needs torch imported first); see make_wrapper()."""
    pass


def make_wrapper(base_model):
    import torch
    import torch.nn as nn

    op_threshs = base_model.op_threshs
    assert op_threshs is not None, "expected non-None op_threshs for densenet121-res224-all"
    n_nan = int(torch.isnan(op_threshs).sum().item())
    print(f"  op_threshs: shape={tuple(op_threshs.shape)} NaN-count={n_nan}")
    if n_nan:
        raise RuntimeError(
            "op_threshs contains NaNs — the clean torch.where replication in this "
            "wrapper assumes zero NaNs (verified false here); the original xrv op_norm "
            "would force those slots to 0.5 via boolean-mask exclusion, which this "
            "wrapper deliberately does not replicate. Aborting rather than silently "
            "producing wrong numbers."
        )

    classifier = base_model.classifier
    N, C = classifier.weight.shape  # [18, 1024]

    class Wrapper(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = base_model.features           # DenseNet conv trunk -> [1,1024,7,7]
            self.classifier = classifier                    # Linear(1024, 18)
            self.register_buffer("op_threshs", op_threshs.clone().float())

            # CAM head: 1x1 conv over the RAW feature map using classifier weights.
            # weight [N,C] -> conv kernel [N,C,1,1]; bias=0 (standard CAM convention).
            self.cam_conv = nn.Conv2d(C, N, kernel_size=1, bias=False)
            with torch.no_grad():
                self.cam_conv.weight.copy_(classifier.weight.view(N, C, 1, 1))

        def forward(self, x):
            feat = self.features(x)                                       # [1,1024,7,7] raw (pre-ReLU)
            relu_feat = torch.relu(feat)
            pooled = torch.nn.functional.adaptive_avg_pool2d(
                relu_feat, (1, 1)
            ).flatten(1)                                                   # [1,1024]
            logits = self.classifier(pooled)                               # [1,18]
            sig = torch.sigmoid(logits)

            thresh = self.op_threshs.unsqueeze(0)                          # [1,18] broadcast
            below = sig / (thresh * 2.0)
            above = 1.0 - ((1.0 - sig) / ((1.0 - thresh) * 2.0))
            probs = torch.where(sig < thresh, below, above)                # plain ops only, no mask-assign

            cam = self.cam_conv(feat)                                      # [1,18,7,7]
            return probs, cam

    return Wrapper()


def step_export(wrapper, input_tensor) -> dict:
    print("\n=== ONNX export (opset 17, outputs=probs+cam) ===")
    import torch

    result = {"exported": False}
    try:
        torch.onnx.export(
            wrapper,
            (input_tensor,),
            str(FP32_PATH),
            input_names=["input"],
            output_names=["probs", "cam"],
            opset_version=17,
            dynamic_axes={"input": {0: "batch"}, "probs": {0: "batch"}, "cam": {0: "batch"}},
            dynamo=False,  # legacy TorchScript-tracing exporter (matches the prior PoC's
                           # proven-working path; torch.where traces cleanly here)
        )
        result["exported"] = True
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        print(f"  ONNX EXPORT FAILED: {result['error']}")
        traceback.print_exc()
        return result

    onnx_bytes = FP32_PATH.stat().st_size
    result["onnx_bytes"] = onnx_bytes
    print(f"  exported -> {FP32_PATH} ({onnx_bytes / 1e6:.2f} MB)")

    try:
        import onnx
        onnx_model = onnx.load(str(FP32_PATH))
        onnx.checker.check_model(onnx_model)
        result["checker_ok"] = True
        print("  onnx.checker.check_model: PASSED")
        # Confirm graph is "clean": no boolean/mask/If/Where-on-index ops besides
        # the plain elementwise Where we intentionally introduced, no loop ops.
        op_types = sorted({n.op_type for n in onnx_model.graph.node})
        result["op_types"] = op_types
        forbidden = {"Loop", "NonZero", "Compress", "ScatterND", "ScatterElements"}
        hit = forbidden & set(op_types)
        result["forbidden_ops_present"] = sorted(hit)
        print(f"  graph op types ({len(op_types)}): {op_types}")
        print(f"  forbidden mask/scatter/loop ops present: {sorted(hit) or 'NONE'}")
    except Exception as e:
        result["checker_ok"] = False
        print(f"  onnx.checker FAILED (non-fatal): {e}")

    return result


def step_parity(wrapper, input_tensor, base_model) -> dict:
    print("\n=== Parity: torch wrapper vs ONNX vs ORIGINAL TorchXRayVisionProvider.detect() ===")
    import torch
    import onnxruntime as ort
    from app.providers.torchxrayvision_provider import TorchXRayVisionProvider
    from app.providers.base import PreparedImage

    result = {}

    with torch.no_grad():
        torch_probs, torch_cam = wrapper(input_tensor)
    torch_probs = torch_probs[0].detach().cpu().numpy()
    torch_cam = torch_cam.detach().cpu().numpy()

    sess = ort.InferenceSession(str(FP32_PATH), providers=["CPUExecutionProvider"])
    onnx_probs, onnx_cam = sess.run(["probs", "cam"], {"input": input_tensor.numpy().astype("float32")})
    onnx_probs = onnx_probs[0]

    diff_torch_onnx = np.abs(torch_probs - onnx_probs)
    result["torch_vs_onnx_max_abs_diff"] = float(diff_torch_onnx.max())
    result["torch_vs_onnx_mean_abs_diff"] = float(diff_torch_onnx.mean())
    print(f"  torch  probs[:5]: {np.round(torch_probs[:5], 6)}")
    print(f"  onnx   probs[:5]: {np.round(onnx_probs[:5], 6)}")
    print(f"  [wrapper] torch vs onnx: max_abs_diff={result['torch_vs_onnx_max_abs_diff']:.8e}  "
          f"mean_abs_diff={result['torch_vs_onnx_mean_abs_diff']:.8e}")
    result["torch_vs_onnx_ok"] = result["torch_vs_onnx_max_abs_diff"] < 1e-3
    assert result["torch_vs_onnx_ok"], (
        f"torch-vs-onnx parity FAILED: {result['torch_vs_onnx_max_abs_diff']} >= 1e-3"
    )
    print("  ASSERTION PASSED: torch vs onnx max_abs_diff < 1e-3")

    # Now compare ONNX probs against the ORIGINAL provider's detect() on the
    # identical prepared input, to prove the clean re-export didn't change the
    # clinical numbers at all.
    prepared = PreparedImage(array=input_tensor.numpy()[0, 0], outbound_png=b"")
    provider = TorchXRayVisionProvider()
    # Force the provider onto the same in-process model instance we already
    # loaded (avoids re-downloading weights / a second copy in memory) —
    # still calling the REAL, unmodified detect() method.
    import app.providers.torchxrayvision_provider as txv_mod
    txv_mod._MODEL = base_model
    detect_pairs = provider.detect(prepared)
    detect_map = dict(detect_pairs)
    pathologies = base_model.pathologies
    detect_probs = np.array([detect_map.get(lbl, np.nan) for lbl in pathologies if lbl])

    # base_model.pathologies may include empty '' slots that detect() drops;
    # align onnx_probs to the same non-empty-label ordering.
    keep_idx = [i for i, lbl in enumerate(pathologies) if lbl]
    onnx_probs_aligned = onnx_probs[keep_idx]

    diff_onnx_detect = np.abs(onnx_probs_aligned - detect_probs)
    result["onnx_vs_detect_max_abs_diff"] = float(diff_onnx_detect.max())
    result["onnx_vs_detect_mean_abs_diff"] = float(diff_onnx_detect.mean())
    print(f"  detect() probs[:5]: {np.round(detect_probs[:5], 6)}")
    print(f"  [clean ONNX] onnx vs ORIGINAL detect(): max_abs_diff="
          f"{result['onnx_vs_detect_max_abs_diff']:.8e}  "
          f"mean_abs_diff={result['onnx_vs_detect_mean_abs_diff']:.8e}")
    result["onnx_vs_detect_ok"] = result["onnx_vs_detect_max_abs_diff"] < 1e-3
    assert result["onnx_vs_detect_ok"], (
        f"onnx-vs-detect() parity FAILED: {result['onnx_vs_detect_max_abs_diff']} >= 1e-3"
    )
    print("  ASSERTION PASSED: onnx vs detect() max_abs_diff < 1e-3")

    # CAM sanity: shape + non-degenerate for the argmax class.
    result["cam_shape"] = list(onnx_cam.shape)
    n_classes = onnx_cam.shape[1]
    result["cam_shape_ok"] = list(onnx_cam.shape) == [1, n_classes, 7, 7]
    argmax_class = int(np.argmax(onnx_probs))
    cam_slice = onnx_cam[0, argmax_class]
    result["argmax_class"] = pathologies[argmax_class] if argmax_class < len(pathologies) else argmax_class
    result["cam_argmax_min"] = float(cam_slice.min())
    result["cam_argmax_max"] = float(cam_slice.max())
    result["cam_argmax_std"] = float(cam_slice.std())
    result["cam_non_degenerate"] = result["cam_argmax_std"] > 1e-6
    print(f"  cam shape: {onnx_cam.shape}  (expected [1,{n_classes},7,7]: {result['cam_shape_ok']})")
    print(f"  argmax class: {result['argmax_class']} (prob={onnx_probs[argmax_class]:.4f})  "
          f"cam[argmax] min={result['cam_argmax_min']:.4f} max={result['cam_argmax_max']:.4f} "
          f"std={result['cam_argmax_std']:.6f}  non_degenerate={result['cam_non_degenerate']}")
    assert result["cam_shape_ok"], "CAM shape mismatch"
    assert result["cam_non_degenerate"], "CAM is degenerate (near-constant) for argmax class"
    print("  ASSERTION PASSED: CAM shape + non-degeneracy")

    result["pathologies"] = [lbl for lbl in pathologies if lbl]
    return result


def step_quantize(input_tensor) -> dict:
    print("\n=== Quantize: fp16 + int8 (dynamic) ===")
    result = {}

    # --- fp16 ---
    try:
        import onnx
        from onnxconverter_common import float16 as onnx_float16
        model = onnx.load(str(FP32_PATH))
        model_fp16 = onnx_float16.convert_float_to_float16(model, keep_io_types=True)
        onnx.save(model_fp16, str(FP16_PATH))
        result["fp16_ok"] = True
        result["fp16_bytes"] = FP16_PATH.stat().st_size
        print(f"  fp16 -> {FP16_PATH} ({result['fp16_bytes']/1e6:.2f} MB)")
    except Exception as e:
        result["fp16_ok"] = False
        result["fp16_error"] = f"{type(e).__name__}: {e}"
        print(f"  FP16 CONVERSION FAILED: {result['fp16_error']}")
        traceback.print_exc()

    if result.get("fp16_ok"):
        try:
            import onnxruntime as ort
            sess_fp32 = ort.InferenceSession(str(FP32_PATH), providers=["CPUExecutionProvider"])
            sess_fp16 = ort.InferenceSession(str(FP16_PATH), providers=["CPUExecutionProvider"])
            inp = input_tensor.numpy().astype("float32")
            probs_fp32 = sess_fp32.run(["probs"], {"input": inp})[0][0]
            probs_fp16 = sess_fp16.run(["probs"], {"input": inp})[0][0]
            diff = np.abs(probs_fp32 - probs_fp16)
            result["fp16_vs_fp32_max_abs_diff"] = float(diff.max())
            result["fp16_vs_fp32_mean_abs_diff"] = float(diff.mean())
            print(f"  fp16 vs fp32 probs: max_abs_diff={result['fp16_vs_fp32_max_abs_diff']:.6e}  "
                  f"mean_abs_diff={result['fp16_vs_fp32_mean_abs_diff']:.6e}")
        except Exception as e:
            result["fp16_parity_error"] = f"{type(e).__name__}: {e}"
            print(f"  fp16 parity check FAILED: {result['fp16_parity_error']}")
            traceback.print_exc()

    # --- int8 dynamic quantization ---
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        quantize_dynamic(
            model_input=str(FP32_PATH),
            model_output=str(INT8_PATH),
            weight_type=QuantType.QInt8,
        )
        result["int8_ok"] = True
        result["int8_bytes"] = INT8_PATH.stat().st_size
        print(f"  int8 -> {INT8_PATH} ({result['int8_bytes']/1e6:.2f} MB)")
    except Exception as e:
        result["int8_ok"] = False
        result["int8_error"] = f"{type(e).__name__}: {e}"
        print(f"  INT8 QUANTIZATION FAILED: {result['int8_error']}")
        traceback.print_exc()

    if result.get("int8_ok"):
        try:
            import onnxruntime as ort
            sess_fp32 = ort.InferenceSession(str(FP32_PATH), providers=["CPUExecutionProvider"])
            sess_int8 = ort.InferenceSession(str(INT8_PATH), providers=["CPUExecutionProvider"])
            inp = input_tensor.numpy().astype("float32")
            probs_fp32 = sess_fp32.run(["probs"], {"input": inp})[0][0]
            probs_int8 = sess_int8.run(["probs"], {"input": inp})[0][0]
            diff = np.abs(probs_fp32 - probs_int8)
            result["int8_vs_fp32_max_abs_diff"] = float(diff.max())
            result["int8_vs_fp32_mean_abs_diff"] = float(diff.mean())
            print(f"  int8 vs fp32 probs: max_abs_diff={result['int8_vs_fp32_max_abs_diff']:.6e}  "
                  f"mean_abs_diff={result['int8_vs_fp32_mean_abs_diff']:.6e}")
        except Exception as e:
            result["int8_parity_error"] = f"{type(e).__name__}: {e}"
            print(f"  int8 parity check FAILED: {result['int8_parity_error']}")
            traceback.print_exc()

    return result


def write_labels(pathologies: list[str]):
    labels = [lbl for lbl in pathologies if lbl]
    with open(LABELS_PATH, "w") as f:
        json.dump(labels, f, indent=2)
    print(f"\n  labels ({len(labels)}) -> {LABELS_PATH}")
    return labels


def copy_for_harness():
    print("\n=== Copying fp32 model + labels to repo-root models/ for browser harness ===")
    ROOT_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    dst_model = ROOT_MODELS_DIR / "thorex_clinical.onnx"
    dst_labels = ROOT_MODELS_DIR / "thorex_clinical_labels.json"
    shutil.copyfile(FP32_PATH, dst_model)
    shutil.copyfile(LABELS_PATH, dst_labels)
    print(f"  {FP32_PATH} -> {dst_model}")
    print(f"  {LABELS_PATH} -> {dst_labels}")
    return dst_model, dst_labels


def main():
    t0 = time.time()
    print("=== Load model ===")
    import torchxrayvision as xrv
    base_model = xrv.models.DenseNet(weights="densenet121-res224-all")
    base_model.eval()
    print(f"  xrv DenseNet121 (densenet121-res224-all), pathologies={len(base_model.pathologies)}")

    print("\n=== Build real input via app.pipeline.preprocess ===")
    prepared, input_tensor = build_synthetic_input()

    print("\n=== Build clean wrapper (probs + CAM) ===")
    wrapper = make_wrapper(base_model)
    wrapper.eval()

    export_result = step_export(wrapper, input_tensor)
    if not export_result.get("exported"):
        print("\nABORTING: export failed, cannot proceed to parity/quantization.")
        sys.exit(1)

    parity_result = step_parity(wrapper, input_tensor, base_model)
    quant_result = step_quantize(input_tensor)
    labels = write_labels(parity_result["pathologies"])
    dst_model, dst_labels = copy_for_harness()

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)
    print(f"fp32 ONNX:  {FP32_PATH}  ({export_result['onnx_bytes']/1e6:.2f} MB)")
    print(f"  torch vs onnx   max_abs_diff = {parity_result['torch_vs_onnx_max_abs_diff']:.3e}")
    print(f"  onnx vs detect() max_abs_diff = {parity_result['onnx_vs_detect_max_abs_diff']:.3e}")
    print(f"  cam shape = {parity_result['cam_shape']}  non_degenerate = {parity_result['cam_non_degenerate']}")
    if quant_result.get("fp16_ok"):
        print(f"fp16 ONNX:  {FP16_PATH}  ({quant_result['fp16_bytes']/1e6:.2f} MB)  "
              f"vs fp32 max_abs_diff = {quant_result.get('fp16_vs_fp32_max_abs_diff', 'N/A')}")
    else:
        print(f"fp16 ONNX:  FAILED — {quant_result.get('fp16_error')}")
    if quant_result.get("int8_ok"):
        print(f"int8 ONNX:  {INT8_PATH}  ({quant_result['int8_bytes']/1e6:.2f} MB)  "
              f"vs fp32 max_abs_diff = {quant_result.get('int8_vs_fp32_max_abs_diff', 'N/A')}")
    else:
        print(f"int8 ONNX:  FAILED — {quant_result.get('int8_error')}")
    print(f"labels: {LABELS_PATH} ({len(labels)} pathologies)")
    print(f"served copies: {dst_model}, {dst_labels}")
    print(f"\nElapsed: {time.time()-t0:.1f}s")

    summary = {
        "export": export_result,
        "parity": {k: v for k, v in parity_result.items()},
        "quantize": quant_result,
        "labels": labels,
    }
    with open(MODELS_DIR / "clinical_export_summary.json", "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\nMachine-readable summary written to {MODELS_DIR / 'clinical_export_summary.json'}")


if __name__ == "__main__":
    main()
