# SknX experimental Core ML model

`SknxVision` (iOS Core ML) runs an **experimental / uncalibrated** dermatology classifier so a captured
photo produces a real on-device classification that feeds the SknX guardrail. The model is **not** stored
in git (per the ThoreX/KardioX convention) — it is downloaded on first use from a hosted base URL.

## Source model
- **Robobyte/skin-cancer-mobilenet-v3** — HAM10000 MobileNetV3, 7-class, AUC ~0.97 (its own val set).
- Classes (softmax order): `akiec, bcc, bkl, df, mel, nv, vasc` → SknX labels
  `actinic keratosis, BCC, benign keratosis, dermatofibroma, melanoma, nevus, vascular lesion`.
- Input: RGB 224×224, **ImageNet** normalization (mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`),
  NCHW. The Swift plugin does the resize + normalize; the ONNX `.onnx` file's sha256 is
  `14aeaadb82112becf98057f21ea835cad06cd223f6f2776ec185e9b943e53254`.

## Build the .mlpackage
See `convert.py` (ONNX → Torch → Core ML; bakes softmax; iOS 15+). Produces `DermMobileNetV3.mlpackage`
(~8 MB): input `input` `[1,3,224,224]`, output `var_650` `[1,7]` probabilities.

## Host it
Upload the 3 files under the base URL the plugin fetches (default `https://models.stewardmd.in/sknx/derm-mnv3`),
preserving structure — same layout ecg-digitiser uses:
```
<base>/Manifest.json
<base>/Data/com.apple.CoreML/model.mlmodel
<base>/Data/com.apple.CoreML/weights/weight.bin
```
Override the base at runtime with `window.SMD_SKNX_REALVISION_MODEL_BASE` or
`localStorage.setItem('sknx_realvision_model_base', '<base>')`.

## IMPORTANT
This is an uncalibrated public model (~63% top-1 in our test) — it misclassifies and misses cancers.
The SknX guardrail (`sknx-engines.js`) is what routes a malignant signal to referral. **Not for clinical
decisions**; validate + calibrate `REFER_THRESHOLD` per-class before `smd_sknx_realvision` ever ships on.
