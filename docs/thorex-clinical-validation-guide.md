# ThoreX AI — Clinical Validation Guide

**Audience:** the validating clinician (you).
**Purpose:** how to build, enable, run, and evaluate ThoreX for clinical validation — and exactly what is and isn't validated so you know what you're signing off.

> ThoreX is **decision support, not a diagnosis.** Every result carries the mandatory disclaimer and must be read alongside clinical assessment and radiologist review. Nothing here changes that.

---

## 1. What ThoreX does (architecture)

- **Fully on-device inference — no cloud, no GPU, image never leaves the phone.** Two ONNX models run in the app's WebView via onnxruntime-web (which uses the Core ML execution provider on iOS / NNAPI on Android under the hood for native acceleration):
  - **Clinical engine** — TorchXRayVision DenseNet-121 (18 findings, 224×224). Apache-2.0, commercially shippable. This drives the clinical result and the report.
  - **Educational engine** — X-Raydar (38 findings, 512×512). **Research/non-commercial licence — educational use only, shown in a separate "Learning" panel with a "not for clinical use" banner.** Never drives clinical actions.
- **Explainability:** a forward-only **CAM heatmap** (no gradients) overlays the top clinical finding.
- **Structured radiology impression:** a deterministic report (Clinical info · Technique · Image quality · Findings · Impression · Recommendations · Urgency · Follow-up), offline, from the clinical engine only.
- **"Learn more" + correlation narrative:** an online LLM layer (Groq → Google/Gemini → deterministic offline) that only ever sees **de-identified text** (finding labels, bands, and lab/ABG values you enter) — never the image, never identifiers.
- **Correlation:** enter EF / BNP / PCT / CRP / WBC / troponin / ABG / electrolytes / vitals → rule-based differential (e.g. edema vs pneumonia) + LLM narrative.

The parity-validated ONNX models were exported from the same PyTorch weights the reference `backend/thorex` FastAPI service runs (ONNX vs PyTorch max-abs-diff ~1e-7). That backend is the reference/parity oracle — **you do not need it for on-device operation.**

---

## 2. Your build steps (the parts that need your device/toolchain)

1. **Host or bundle the model files.** The app fetches them from a base path (default `/models`, overridable — see §4). Place these where the app can load them (bundled in the native `www/`, or on a URL/CDN you control):
   - `thorex_clinical.onnx` (~28 MB fp32, or `..._fp16.onnx` ~14 MB — recommended for size) + `thorex_clinical_labels.json`
   - `thorex_xraydar.onnx` (~88 MB fp32, or `..._fp16.onnx` ~44 MB) + `thorex_xraydar_labels.json`
   - Regenerate any time: `backend/thorex/scripts/export_clinical_onnx.py` and `export_xraydar_onnx.py` (run in the `backend/thorex/.venv`). **int8 variants exist (~8 / ~22 MB) but carry ~3–6 % numeric error — validate before using int8.**
   - First run downloads + caches them on-device (Cache API/IndexedDB); afterwards it's offline.
2. **Native build.** Standard Capacitor build. onnxruntime-web is already vendored; the on-device path runs in the WebView. (A future native ORT-Mobile plugin would add extra acceleration, but the WebView path works today.)
3. **LLM key (optional, for "learn more"/narratives).** Put `GROQ_API_KEY` as a `wrangler secret` (server-side) for the `/api/thorex/llm` Cloudflare Function. Fallback order is Groq → your existing Google/Gemini → deterministic offline, so the app is fully usable with no key. **Rotate the key you shared in chat.**

---

## 3. Enabling ThoreX for validation

Flags (query param or `localStorage`, per the app's flag system):
- `smd_thorex=1` — master (default OFF).
- `smd_thorex_ondevice=1` — **prefer fully on-device inference** (default OFF; turn ON for the native validation build).
- Access/role: ThoreX opens via the Experimental-Access gate. Grant yourself access and a tier from the **admin console** (Experimental → ThoreX): **V1** (physician → clinical engine only) or **V2 Beta** (student/resident → clinical + educational dual panel). On a debug build the access gate dev-bypasses on localhost.
- `smd_thorex_cloud` — consent for the Free/HF "Lite" cloud tier; irrelevant when running on-device.

---

## 4. Model source config

`thorex-ort.js` reads the model base from `localStorage["smd_thorex_model_base"]` (default `/models`). Set it to point at your hosted/bundled model directory without any code change. Individual URLs can also be overridden via the on-device provider opts (`modelUrl`, `eduModelUrl`).

---

## 5. How to validate

For each real chest X-ray:
1. Open ThoreX → **Analyze a chest X-ray** → camera / photo / file / PDF.
2. Review the **Clinical** panel: findings, **confidence bands** (High/Medium/Low — never raw probabilities), severity, one-line relevance, and the **CAM heatmap** on the top finding (does it localize to the right region?).
3. (V2 Beta) Review the **Learning** panel (X-Raydar) — educational only.
4. Open **Radiology report** → check the structured Impression / Recommendations / Urgency.
5. **Correlate** → enter EF/BNP/PCT/CRP/WBC/ABG/etc. → check the differential reasoning (e.g. does ↑BNP + ↓EF + normal PCT correctly push edema over pneumonia?).
6. Use **"Why this finding?"** for the LLM explanation (educational).

**Suggested evaluation:** run a labelled set (with radiologist ground truth), and record per-finding sensitivity/specificity at the band thresholds, heatmap localization quality, and correlation-reasoning agreement. The band cut-offs (≥0.60 High / ≥0.30 Medium / ≥0.10 Low) and the band→severity mapping are **tunable** — your validation should tell us where to set them.

---

## 6. Known limitations — what is NOT validated (read before signing off)

- **Not a diagnostic device.** AI decision support; requires radiologist review.
- **Finding set is fixed by the models:** 18 clinical labels (TorchXRayVision) / 38 educational (X-Raydar). Anything outside those label sets is not detected. ARDS/cavity/device-placement are not discrete model outputs.
- **Frontal single-view only** in this slice; X-Raydar uses one resolution (is512) of its multi-scale ensemble.
- **Thresholds are textbook cut-offs**, not guideline-pinned; band→severity mapping needs your clinical sign-off.
- **Correlation inputs EF/BNP/troponin are manual-entry today** (no automatic source exists in the app yet); other values best-effort.
- **int8 models** trade ~3–6 % numeric error for size — validate before shipping int8.
- **X-Raydar is educational/non-commercial** — must not ship in the clinical path without a Warwick Ventures licence; keep it in the Learning panel / V2 Beta only.
- **"Learn more"/narratives are AI-generated educational text** (Groq/Gemini) — not a diagnosis; only de-identified text is sent.
- Ships only through the R1 clinical / R2 AI / R3 security review gates before any production flag flip.

---

## 7. Where the code lives

- On-device: `thorex-ort.js` (engine + CAM + model cache), `thorex-providers.js` (on-device analyzer), `thorex-report.js` (impression), `thorex-llm.js` + `functions/api/thorex/[[path]].js` (LLM proxy), `thorex-correlate.js` (correlation), `thorex-screens.js` (UI), `thorex-flags.js`.
- Models/conversion: `backend/thorex/scripts/export_*_onnx.py`, `models/` (binaries gitignored — regenerate).
- Reference backend (optional): `backend/thorex/` (FastAPI parity oracle).
- All on PR #544 (branch `claude/stewardmd-new-project-2808a7`).
