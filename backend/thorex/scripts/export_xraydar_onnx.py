"""ThoreX on-device foundation, part 2: export a CLEAN ONNX build of the
X-Raydar (XNet38MS, single-scale is512) EDUCATIONAL engine for
onnxruntime-web (no cloud). Sibling to `export_clinical_onnx.py`.

This is additive tooling only — it does NOT modify app/runtime code. It
loads the model via `app.providers.xraydar_provider._model()` (the exact,
reviewed loader — pinned HF revision, `_MIN_MATCH_FRACTION` guard, no
fabrication) and `app.providers.xraydar_provider._to_model_input()` (the
exact is512 preprocessing the API uses), and writes artifacts under
`backend/thorex/models/`.

Wrapper output
--------------
  probs: [1, 38] sigmoid probabilities over the full X-Raydar 38-class
         taxonomy (`_XRAYDAR_LABELS_38`, index-aligned) — Inception3 in eval
         mode never touches `AuxLogits` (the vendored `forward()` doesn't
         reference it at all, train or eval), so this is a plain
         `sigmoid(fc(GAP(features(x))))`, no aux-branch handling needed.

  cam:   [1, 38, h, w] per-class Class Activation Map — a 1x1 conv over the
         RAW `Mixed_7c` output (the pre-GAP feature map, already ReLU'd
         internally by each branch's `BasicConv2d`, unlike the clinical
         DenseNet's pre-ReLU trunk output) using the `fc` weight matrix
         reshaped to a conv kernel ([38,2048] -> [38,2048,1,1]), bias=0.
         Forward-only, no gradients. h,w depend on the 512x512 input's
         stride-32 downsample through Inception3's stem + two stride-2
         Inception blocks (measured, not hardcoded, in the export below).
         Attempted per the task's "do so if clean" instruction: exposing
         Mixed_7c only requires calling the vendored submodules directly in
         the same order as `Inception3.forward` (fully available on the
         loaded instance) — this traces the identical computation graph as
         the real model, not an approximation, so it is included as a
         second output.

Labels
------
`thorex_xraydar_labels.json` holds all 38 entries, INDEX-ALIGNED to `probs`,
each name passed through the same `_SHARED_LABEL_MAP` remapping
`XRaydarProvider.detect()` applies (shared-vocabulary name where one exists,
else the raw X-Raydar name unchanged) — so the JS side's `probs[i]` maps to
the identical label string as `detect()`'s i-th `(label, prob)` pair, with
no dict-lookup ambiguity (`detect()` does not drop or reorder classes).

Usage (from backend/thorex):
    .venv/bin/python scripts/export_xraydar_onnx.py
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

FP32_PATH = MODELS_DIR / "thorex_xraydar.onnx"
FP16_PATH = MODELS_DIR / "thorex_xraydar_fp16.onnx"
INT8_PATH = MODELS_DIR / "thorex_xraydar_int8.onnx"
LABELS_PATH = MODELS_DIR / "thorex_xraydar_labels.json"


def build_synthetic_input():
    """Build a real outbound PNG + is512 model tensor the same way the API
    does: synthetic CXR-like PNG bytes -> XRaydarProvider's own
    `_to_model_input` (decode -> grayscale -> pad-to-square -> resize 512 ->
    Normalize(0.491, 0.271)).
    """
    from app.providers import xraydar_provider as xp
    from app.providers.base import PreparedImage

    rng = np.random.default_rng(7)
    size = 700  # deliberately non-square-friendly/non-512 so pad-to-square + resize are BOTH exercised
    w, h = size, int(size * 0.8)
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    r = np.sqrt(((xx - cx) / 1.0) ** 2 + ((yy - cy) * 0.9) ** 2)
    base = 195 - (r / r.max()) * 150
    noise = rng.normal(0, 9, size=(h, w))
    img = np.clip(base + noise, 0, 255).astype("uint8")
    from PIL import Image
    pil = Image.fromarray(img, mode="L")
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    prepared = PreparedImage(array=np.zeros((224, 224), dtype="float32"), outbound_png=png_bytes)
    input_tensor = xp._to_model_input(png_bytes)  # 1x1x512x512, X-Raydar's native pipeline
    print(f"  _to_model_input -> tensor shape={tuple(input_tensor.shape)}, dtype={input_tensor.dtype}, "
          f"min={input_tensor.min():.4f}, max={input_tensor.max():.4f}")
    return prepared, input_tensor


def make_wrapper(net):
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    N, C = net.fc.weight.shape  # [38, 2048]

    class Wrapper(nn.Module):
        def __init__(self):
            super().__init__()
            self.net = net
            # CAM head: 1x1 conv over the RAW Mixed_7c feature map (already ReLU'd
            # internally by each branch's BasicConv2d) using fc's weights.
            # weight [N,C] -> conv kernel [N,C,1,1]; bias=0 (standard CAM convention).
            self.cam_conv = nn.Conv2d(C, N, kernel_size=1, bias=False)
            with torch.no_grad():
                self.cam_conv.weight.copy_(net.fc.weight.view(N, C, 1, 1))

        def forward(self, x):
            n = self.net
            # Reproduces Inception3.forward's exact sequence of ops (the vendored
            # source in app/providers/xraydar_provider.py) up through Mixed_7c, so
            # we can capture the pre-GAP feature map for CAM. AuxLogits is never
            # referenced by that forward() (train or eval), so there is nothing
            # aux-related to special-case here.
            x = n._transform_input(x)
            x = n.Conv2d_1a_3x3(x)
            x = n.Conv2d_2a_3x3(x)
            x = n.Conv2d_2b_3x3(x)
            x = F.max_pool2d(x, kernel_size=3, stride=2)
            x = n.Conv2d_3b_1x1(x)
            x = n.Conv2d_4a_3x3(x)
            x = F.max_pool2d(x, kernel_size=3, stride=2)
            x = n.Mixed_5b(x)
            x = n.Mixed_5c(x)
            x = n.Mixed_5d(x)
            x = n.Mixed_6a(x)
            x = n.Mixed_6b(x)
            x = n.Mixed_6c(x)
            x = n.Mixed_6d(x)
            x = n.Mixed_6e(x)
            x = n.Mixed_7a(x)
            x = n.Mixed_7b(x)
            feat = n.Mixed_7c(x)                                              # [1,2048,h,w]
            pooled = F.adaptive_avg_pool2d(feat, (1, 1)).flatten(1)           # [1,2048]
            logits = n.fc(pooled)                                             # [1,38]
            probs = torch.sigmoid(logits)
            cam = self.cam_conv(feat)                                         # [1,38,h,w]
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
            dynamo=False,  # legacy TorchScript-tracing exporter (matches export_clinical_onnx.py's
                           # proven-working path for this same family of ops)
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


def step_parity(wrapper, input_tensor, prepared, labels_out) -> dict:
    print("\n=== Parity: torch wrapper vs ONNX vs ORIGINAL XRaydarProvider.detect() ===")
    import torch
    import onnxruntime as ort
    from app.providers.xraydar_provider import XRaydarProvider

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

    # Compare ONNX probs against the ORIGINAL provider's detect() on the
    # identical outbound PNG bytes, to prove the export didn't change the
    # educational numbers or the shared-label mapping at all.
    provider = XRaydarProvider()
    detect_pairs = provider.detect(prepared)  # already-loaded _model() singleton is reused (cached)
    detect_labels = [lbl for lbl, _ in detect_pairs]
    detect_probs = np.array([p for _, p in detect_pairs])

    result["labels_match_detect_order"] = detect_labels == labels_out
    print(f"  labels_out == detect() label order: {result['labels_match_detect_order']}")
    assert result["labels_match_detect_order"], "label order mismatch between exported labels.json and detect()"

    diff_onnx_detect = np.abs(onnx_probs - detect_probs)
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
    n_classes, cam_h, cam_w = onnx_cam.shape[1], onnx_cam.shape[2], onnx_cam.shape[3]
    result["cam_shape_ok"] = onnx_cam.shape[0] == 1 and n_classes == len(labels_out)
    argmax_class = int(np.argmax(onnx_probs))
    cam_slice = onnx_cam[0, argmax_class]
    result["argmax_class"] = labels_out[argmax_class]
    result["cam_argmax_min"] = float(cam_slice.min())
    result["cam_argmax_max"] = float(cam_slice.max())
    result["cam_argmax_std"] = float(cam_slice.std())
    result["cam_non_degenerate"] = result["cam_argmax_std"] > 1e-6
    print(f"  cam shape: {onnx_cam.shape}  (batch=1,classes={len(labels_out)}: {result['cam_shape_ok']})")
    print(f"  argmax class: {result['argmax_class']} (prob={onnx_probs[argmax_class]:.4f})  "
          f"cam[argmax] min={result['cam_argmax_min']:.4f} max={result['cam_argmax_max']:.4f} "
          f"std={result['cam_argmax_std']:.6f}  non_degenerate={result['cam_non_degenerate']}")
    assert result["cam_shape_ok"], "CAM shape mismatch"
    assert result["cam_non_degenerate"], "CAM is degenerate (near-constant) for argmax class"
    print("  ASSERTION PASSED: CAM shape + non-degeneracy")

    return result


def step_quantize(input_tensor) -> dict:
    print("\n=== Quantize: fp16 + int8 (dynamic) ===")
    result = {}

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


def write_labels(labels_out: list[str]):
    with open(LABELS_PATH, "w") as f:
        json.dump(labels_out, f, indent=2)
    print(f"\n  labels ({len(labels_out)}) -> {LABELS_PATH}")
    return labels_out


def copy_for_harness():
    print("\n=== Copying fp32 model + labels to repo-root models/ for browser harness ===")
    ROOT_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    dst_model = ROOT_MODELS_DIR / "thorex_xraydar.onnx"
    dst_labels = ROOT_MODELS_DIR / "thorex_xraydar_labels.json"
    shutil.copyfile(FP32_PATH, dst_model)
    shutil.copyfile(LABELS_PATH, dst_labels)
    print(f"  {FP32_PATH} -> {dst_model}")
    print(f"  {LABELS_PATH} -> {dst_labels}")
    return dst_model, dst_labels


def main():
    t0 = time.time()
    print("=== Load model (app.providers.xraydar_provider._model(), pinned HF revision) ===")
    from app.providers import xraydar_provider as xp

    net = xp._model()
    net.eval()
    match_info = xp.key_match_info()
    print(f"  Inception3 (is512, num_classes=38), key_match_info={match_info}")
    labels_out = [xp._SHARED_LABEL_MAP.get(lbl, lbl) for lbl in xp._XRAYDAR_LABELS_38]
    print(f"  labels ({len(labels_out)}), shared-mapped where applicable: {labels_out}")

    print("\n=== Build real input via XRaydarProvider's native is512 preprocessing ===")
    prepared, input_tensor = build_synthetic_input()

    print("\n=== Build wrapper (probs + CAM) ===")
    wrapper = make_wrapper(net)
    wrapper.eval()

    export_result = step_export(wrapper, input_tensor)
    if not export_result.get("exported"):
        print("\nABORTING ONNX EXPORT: see error above. Nothing further can be verified without a")
        print("model file, so this run stops here rather than fabricating parity/size numbers.")
        sys.exit(1)

    try:
        parity_result = step_parity(wrapper, input_tensor, prepared, labels_out)
    except Exception as e:
        print(f"\nPARITY CHECK FAILED: {type(e).__name__}: {e}")
        traceback.print_exc()
        print("\nStill delivering the fp32 ONNX (per instructions) — parity is NOT verified, do not")
        print("trust these numbers for a real device without investigating the failure above.")
        parity_result = {"error": f"{type(e).__name__}: {e}"}

    quant_result = step_quantize(input_tensor)
    write_labels(labels_out)
    dst_model, dst_labels = copy_for_harness()

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)
    print(f"fp32 ONNX:  {FP32_PATH}  ({export_result['onnx_bytes']/1e6:.2f} MB)")
    if "torch_vs_onnx_max_abs_diff" in parity_result:
        print(f"  torch vs onnx    max_abs_diff = {parity_result['torch_vs_onnx_max_abs_diff']:.3e}")
        print(f"  onnx vs detect() max_abs_diff = {parity_result['onnx_vs_detect_max_abs_diff']:.3e}")
        print(f"  cam shape = {parity_result['cam_shape']}  non_degenerate = {parity_result['cam_non_degenerate']}")
    else:
        print(f"  PARITY: FAILED — {parity_result.get('error')}")
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
    print(f"labels: {LABELS_PATH} ({len(labels_out)} classes)")
    print(f"served copies: {dst_model}, {dst_labels}")
    print(f"\nElapsed: {time.time()-t0:.1f}s")

    summary = {
        "export": export_result,
        "parity": parity_result,
        "quantize": quant_result,
        "labels": labels_out,
        "key_match_info": match_info,
    }
    with open(MODELS_DIR / "xraydar_export_summary.json", "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\nMachine-readable summary written to {MODELS_DIR / 'xraydar_export_summary.json'}")

    if "error" in parity_result:
        sys.exit(2)  # non-zero: model + sizes delivered, but parity is unverified — flag it honestly


if __name__ == "__main__":
    main()
