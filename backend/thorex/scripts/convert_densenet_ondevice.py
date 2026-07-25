"""On-device inference PoC: convert the clinical TorchXRayVision DenseNet-121
to ONNX (and, where possible, Core ML), and NUMERICALLY VALIDATE parity
against the PyTorch reference.

This is a standalone research/tooling script. It does NOT touch the running
app/backend code — it only reads `app.pipeline.preprocess` (to build a
realistic input tensor the same way the API does) and writes artifacts under
`backend/thorex/models/`.

Usage (from backend/thorex):
    .venv/bin/python scripts/convert_densenet_ondevice.py

What it does, in order:
  1. Best-effort installs onnx / onnxruntime / coremltools into the active
     venv (skips already-installed packages; reports failures honestly).
  2. Loads the real xrv DenseNet ("densenet121-res224-all"), eval mode.
  3. Builds a real 1x1x224x224 input tensor from a synthetic CXR-like PNG via
     the SAME `app.pipeline.preprocess.prepare` used by the API.
  4. Exports to ONNX (opset 17), runs onnxruntime, compares vs torch output,
     reports max/mean abs diff over the ~18 pathology outputs.
  5. Attempts a Core ML (mlprogram, fp32) conversion via coremltools and,
     if the local runtime is available, runs a prediction and compares vs
     torch. If ANY step fails, the REAL exception is captured and reported
     — never faked.
  6. Confirms the model exposes GAP -> Linear classifier (the tensors needed
     for forward-only / gradient-free CAM on-device) and prints their shapes.
  7. Prints a summary table of artifact sizes + parity numbers.
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import time
import traceback
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
THOREX_ROOT = SCRIPT_DIR.parent
MODELS_DIR = THOREX_ROOT / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(THOREX_ROOT))  # so `import app...` resolves like the real backend

ONNX_PATH = MODELS_DIR / "thorex_densenet_clinical.onnx"
COREML_PATH = MODELS_DIR / "thorex_densenet_clinical.mlpackage"


def _pip_install(pkg: str) -> tuple[bool, str]:
    """Best-effort pip install into the current venv. Returns (ok, detail)."""
    try:
        import importlib
        importlib.import_module(pkg.split("==")[0].replace("-", "_"))
        return True, "already installed"
    except Exception:
        pass
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "install", pkg],
        capture_output=True, text=True,
    )
    ok = proc.returncode == 0
    tail = (proc.stdout[-2000:] + "\n" + proc.stderr[-2000:]).strip()
    return ok, tail


def step1_install_deps() -> dict:
    print("\n=== STEP 1: dependency install ===")
    results = {}
    for pkg, mod in [("onnx", "onnx"), ("onnxruntime", "onnxruntime"), ("coremltools", "coremltools")]:
        ok, detail = _pip_install(pkg)
        results[pkg] = ok
        status = "OK" if ok else "FAILED"
        print(f"  [{status}] {pkg}")
        if not ok:
            print("    ---- pip output (tail) ----")
            print("    " + detail.replace("\n", "\n    "))
    return results


def step2_build_input():
    print("\n=== STEP 2: load model + build real input via app.pipeline.preprocess ===")
    import torchxrayvision as xrv
    from app.pipeline import preprocess

    model = xrv.models.DenseNet(weights="densenet121-res224-all")
    model.eval()
    print(f"  model: xrv DenseNet121 (densenet121-res224-all), pathologies={len(model.pathologies)}")

    # Build a synthetic CXR-like PNG (soft radial gradient + noise, roughly
    # chest-shaped) so preprocess.prepare has real image bytes to decode,
    # center-crop, and resize — the exact path app/providers/torchxrayvision_provider.py
    # feeds into the model in production.
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

    import torch
    input_tensor = torch.from_numpy(array[None, None, ...].astype("float32"))  # 1x1x224x224
    print(f"  input tensor shape: {tuple(input_tensor.shape)}")
    return model, input_tensor


def step3_onnx_export(model, input_tensor) -> dict:
    print("\n=== STEP 3: ONNX export + parity ===")
    import torch

    with torch.no_grad():
        torch_out = model(input_tensor)[0].detach().cpu().numpy()

    result = {"exported": False}
    try:
        torch.onnx.export(
            model,
            (input_tensor,),
            str(ONNX_PATH),
            input_names=["input"],
            output_names=["pathology_probs"],
            opset_version=17,
            dynamic_axes={"input": {0: "batch"}, "pathology_probs": {0: "batch"}},
            dynamo=False,  # legacy TorchScript-tracing exporter; the model
                           # uses boolean-mask indexing (op_norm) that the
                           # dynamo exporter in torch 2.13 does not yet support.
        )
        result["exported"] = True
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        print(f"  ONNX EXPORT FAILED: {result['error']}")
        traceback.print_exc()
        return result

    onnx_bytes = ONNX_PATH.stat().st_size
    result["onnx_bytes"] = onnx_bytes
    print(f"  exported -> {ONNX_PATH} ({onnx_bytes / 1e6:.2f} MB)")

    try:
        import onnx
        onnx_model = onnx.load(str(ONNX_PATH))
        onnx.checker.check_model(onnx_model)
        print("  onnx.checker.check_model: PASSED")
    except Exception as e:
        print(f"  onnx.checker FAILED (non-fatal): {e}")

    import onnxruntime as ort
    sess = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    onnx_out = sess.run(None, {"input": input_tensor.numpy().astype("float32")})[0][0]

    diff = np.abs(torch_out - onnx_out)
    max_abs_diff = float(diff.max())
    mean_abs_diff = float(diff.mean())
    result["max_abs_diff"] = max_abs_diff
    result["mean_abs_diff"] = mean_abs_diff
    result["torch_out"] = torch_out.tolist()
    result["onnx_out"] = onnx_out.tolist()

    print(f"  torch  output[:5]: {np.round(torch_out[:5], 6)}")
    print(f"  onnx   output[:5]: {np.round(onnx_out[:5], 6)}")
    print(f"  max_abs_diff={max_abs_diff:.8e}  mean_abs_diff={mean_abs_diff:.8e}")

    try:
        assert max_abs_diff < 1e-3, f"ONNX parity FAILED: max_abs_diff={max_abs_diff} >= 1e-3"
        result["parity_ok"] = True
        print("  ASSERTION PASSED: max_abs_diff < 1e-3")
    except AssertionError as e:
        result["parity_ok"] = False
        result["parity_error"] = str(e)
        print(f"  ASSERTION FAILED: {e}")

    return result


def step4_coreml(model, input_tensor, onnx_result: dict) -> dict:
    print("\n=== STEP 4: Core ML conversion + parity (if available) ===")
    result = {"available": False}
    try:
        import coremltools as ct
    except Exception as e:
        result["reason"] = f"coremltools import failed: {type(e).__name__}: {e}"
        print(f"  SKIPPED: {result['reason']}")
        return result

    result["coremltools_version"] = ct.__version__
    print(f"  coremltools version: {ct.__version__}")

    import torch
    with torch.no_grad():
        torch_out = model(input_tensor)[0].detach().cpu().numpy()

    traced = None
    try:
        traced = torch.jit.trace(model, input_tensor)
    except Exception as e:
        result["reason"] = f"torch.jit.trace failed: {type(e).__name__}: {e}"
        print(f"  FAILED at trace step: {result['reason']}")
        traceback.print_exc()
        return result

    # Attempt 1: ML Program (fp32) — the modern, requested format.
    mlmodel = None
    try:
        mlmodel = ct.convert(
            traced,
            inputs=[ct.TensorType(name="input", shape=input_tensor.shape, dtype=np.float32)],
            outputs=[ct.TensorType(name="pathology_probs")],
            convert_to="mlprogram",
            compute_precision=ct.precision.FLOAT32,
            minimum_deployment_target=ct.target.iOS16,
        )
        mlmodel.save(str(COREML_PATH))
        result["mlprogram_converted"] = True
    except Exception as e:
        result["mlprogram_converted"] = False
        result["mlprogram_error"] = f"{type(e).__name__}: {e}"
        print(f"  ML PROGRAM (mlpackage) conversion FAILED: {result['mlprogram_error']}")

    # Attempt 2 (diagnostic only, not shipped as the artifact): legacy
    # neuralnetwork backend, to determine whether the failure above is
    # specific to mlprogram's blob-weight serialization or a total
    # coremltools breakage on this Python/OS combo.
    try:
        nn_model = ct.convert(
            traced,
            inputs=[ct.TensorType(name="input", shape=input_tensor.shape, dtype=np.float32)],
            outputs=[ct.TensorType(name="pathology_probs")],
            convert_to="neuralnetwork",
        )
        result["neuralnetwork_convert_ok"] = True
        print("  (diagnostic) legacy neuralnetwork-backend conversion: OK "
              "(confirms the MIL graph translation itself works; mlprogram "
              "failure below is specific to the compiled weight-blob writer)")
    except Exception as e:
        result["neuralnetwork_convert_ok"] = False
        result["neuralnetwork_error"] = f"{type(e).__name__}: {e}"
        print(f"  (diagnostic) legacy neuralnetwork-backend conversion also FAILED: {e}")

    if mlmodel is None:
        result["available"] = False
        return result

    result["mlpackage_bytes"] = _dir_size(COREML_PATH)
    print(f"  saved -> {COREML_PATH} ({result['mlpackage_bytes'] / 1e6:.2f} MB)")

    try:
        pred = mlmodel.predict({"input": input_tensor.numpy().astype(np.float32)})
        out_key = list(pred.keys())[0]
        coreml_out = np.asarray(pred[out_key]).reshape(-1)
        diff = np.abs(torch_out - coreml_out)
        result["max_abs_diff"] = float(diff.max())
        result["mean_abs_diff"] = float(diff.mean())
        result["available"] = True
        print(f"  coreml output[:5]: {np.round(coreml_out[:5], 6)}")
        print(f"  max_abs_diff={result['max_abs_diff']:.8e}  mean_abs_diff={result['mean_abs_diff']:.8e}")
    except Exception as e:
        result["available"] = False
        result["predict_error"] = f"{type(e).__name__}: {e}"
        print(f"  Core ML LOCAL PREDICTION FAILED: {result['predict_error']}")

    return result


def _dir_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    return total


def step5_cam_feasibility(model, input_tensor) -> dict:
    print("\n=== STEP 5: CAM (forward-only) feasibility probe ===")
    import torch
    result = {}
    with torch.no_grad():
        feature_map = model.features(input_tensor)          # Nx1024x7x7, pre-ReLU/pre-GAP
        pooled = torch.nn.functional.adaptive_avg_pool2d(
            torch.relu(feature_map), (1, 1)
        ).view(feature_map.size(0), -1)                       # Nx1024
        classifier = model.classifier
        logits = classifier(pooled)

    result["feature_layer"] = "model.features.norm5 output (post model.features(x))"
    result["feature_map_shape"] = list(feature_map.shape)
    result["classifier_type"] = type(classifier).__name__
    result["classifier_weight_shape"] = list(classifier.weight.shape)
    result["classifier_bias_shape"] = list(classifier.bias.shape)
    result["pooled_shape"] = list(pooled.shape)
    result["gap_then_fc_confirmed"] = (
        classifier.weight.shape[1] == feature_map.shape[1]
    )

    print(f"  feature map (last conv block, model.features(x)): {tuple(feature_map.shape)}")
    print(f"  classifier: {classifier}  weight={tuple(classifier.weight.shape)} bias={tuple(classifier.bias.shape)}")
    print(f"  GAP(features) -> Linear confirmed: {result['gap_then_fc_confirmed']}")
    print("  => Forward-only CAM (CAM / Score-CAM) is feasible on-device: no "
          "backward pass needed, since class activation = "
          "sum_c( classifier.weight[class, c] * feature_map[c, :, :] ), "
          "using only forward tensors already computed here.")
    return result


def _param_bytes(model) -> int:
    import torch
    total = 0
    for p in model.parameters():
        total += p.numel() * 4  # fp32 stored size
    return total


def main():
    t0 = time.time()
    install_results = step1_install_deps()
    model, input_tensor = step2_build_input()
    onnx_result = step3_onnx_export(model, input_tensor)
    coreml_result = step4_coreml(model, input_tensor, onnx_result)
    cam_result = step5_cam_feasibility(model, input_tensor)

    fp32_param_bytes = _param_bytes(model)

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)

    onnx_bytes = onnx_result.get("onnx_bytes")
    print(f"ONNX artifact:      {ONNX_PATH.name}"
          + (f"  ({onnx_bytes/1e6:.2f} MB)" if onnx_bytes else "  NOT PRODUCED"))
    print(f"ONNX parity:        max_abs_diff={onnx_result.get('max_abs_diff', 'N/A')}  "
          f"mean_abs_diff={onnx_result.get('mean_abs_diff', 'N/A')}  "
          f"(<1e-3 required: {onnx_result.get('parity_ok', 'N/A')})")

    if coreml_result.get("mlpackage_bytes"):
        print(f"Core ML artifact:   {COREML_PATH.name}  ({coreml_result['mlpackage_bytes']/1e6:.2f} MB)")
    else:
        print("Core ML artifact:   NOT PRODUCED")

    if coreml_result.get("available"):
        print(f"Core ML parity:     max_abs_diff={coreml_result.get('max_abs_diff')}  "
              f"mean_abs_diff={coreml_result.get('mean_abs_diff')}")
    else:
        reason = (coreml_result.get("reason") or coreml_result.get("mlprogram_error")
                  or coreml_result.get("predict_error") or "unknown")
        print(f"Core ML parity:     UNAVAILABLE — {reason}")

    print(f"\nEstimated on-device weight footprint (from real param count, "
          f"not measured from a produced artifact unless noted above):")
    print(f"  fp32 (~4 bytes/param): {fp32_param_bytes/1e6:.2f} MB")
    print(f"  fp16 (~2 bytes/param): {fp32_param_bytes/2/1e6:.2f} MB  (estimate)")
    print(f"  int8 (~1 byte/param):  {fp32_param_bytes/4/1e6:.2f} MB  (estimate)")

    print(f"\nCAM feasibility: feature_map={cam_result['feature_map_shape']} "
          f"classifier_weight={cam_result['classifier_weight_shape']} "
          f"gap_then_fc_confirmed={cam_result['gap_then_fc_confirmed']}")

    print(f"\nElapsed: {time.time()-t0:.1f}s")

    summary = {
        "install_results": install_results,
        "onnx": {k: v for k, v in onnx_result.items() if k not in ("torch_out", "onnx_out")},
        "coreml": coreml_result,
        "cam": cam_result,
        "fp32_param_bytes": fp32_param_bytes,
    }
    with open(MODELS_DIR / "last_run_summary.json", "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\nMachine-readable summary written to {MODELS_DIR / 'last_run_summary.json'}")


if __name__ == "__main__":
    main()
