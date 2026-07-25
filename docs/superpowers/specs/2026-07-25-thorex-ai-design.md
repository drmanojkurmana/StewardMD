# ThoreX AI — Chest X-ray Interpretation Module (Design)

**Date:** 2026-07-25
**Status:** Design — awaiting user review
**Owner:** Diwakar Kurmana
**Access gate:** `smd_thorex` (Experimental Access code, DEFAULT OFF) — sibling of `smd_kardiox` / `smd_fundx`

---

## 1. Summary

ThoreX AI is a Chest X-ray (CXR) interpretation module inside StewardMD. A clinician
uploads a CXR; the module runs a modular inference pipeline (quality → detection →
localization → explainability → clinical correlation → report) and produces an explainable,
structured read that integrates with existing StewardMD modules (Antibiogram, ICU, labs,
KardioX). It mirrors the **KardioX** architecture bone-for-bone so it behaves like a native
flagship feature, not a bolted-on plugin.

**Intended use:** educational / clinical-decision-support assist for qualified clinicians.
**Not** an autonomous diagnostic device. Every result carries the mandatory safety disclaimer
and ships only through the `stewardmd-clinical-reviewer` + `stewardmd-ai-reviewer` gates.

### Reality markers (honesty contract)

This spec labels every capability by what is genuinely buildable **today** with permissively
or educationally licensed pretrained weights:

- **REAL** — works end-to-end at ship time with downloadable weights.
- **RULE** — derived/heuristic (not a trained model output); labelled as such in the UI.
- **EXPERIMENTAL** — research track, explicitly marked not-for-clinical-use in the UI.
- **FUTURE** — architecture supports it; no functional implementation in this spec.

No stubs are dressed up as REAL. No raw probabilities are shown to users.

---

## 2. Models & licensing

| Role | Model | License | Status | Notes |
|---|---|---|---|---|
| Primary detection (commercial default) | **TorchXRayVision** DenseNet (NIH/CheXpert/MIMIC/PadChest) | Apache-2.0 | REAL | ~18 findings; auto-downloads weights; commercially shippable. |
| Primary detection (educational, higher coverage) | **X-Raydar** XNet38MS ensemble (299/512/1024) | **Research / non-commercial only** | REAL (educational) | 37 findings; weights on HuggingFace `dnamodel/xraydar-cv` (PyTorch `.pth.tar`). Gated behind an educational flag, DEFAULT OFF. **Must not ship in the commercial/clinical path** without a Warwick Ventures commercial license. |
| Explainability / localization | **pytorch-grad-cam** | MIT | REAL | Grad-CAM heatmap per finding; works on both DenseNet and Inception-v3. |
| Preprocessing | **MONAI** transforms | Apache-2.0 | REAL | normalize / resize / histogram / orientation. |
| Secondary / zero-shot validation | **CheXzero** (CLIP) | research repo — license unverified | EXPERIMENTAL | Only enabled after license verification; otherwise the secondary is a second TorchXRayVision dataset head. |

**Licensing decision (user-directed):** both TorchXRayVision **and** X-Raydar are included for
**educational use**. TorchXRayVision is the permissive default; X-Raydar is a selectable
educational/research provider (flag `smd_thorex_xraydar`, DEFAULT OFF) with an in-UI
"Educational / research model — not for clinical use" banner whenever it is the active engine.

### Findings coverage

- **Model-detected (REAL):** Pneumonia/consolidation, Pleural effusion, Pneumothorax,
  Pulmonary edema, Atelectasis, Cardiomegaly, Emphysema, Fibrosis, Pulmonary nodule, Mass,
  Pleural thickening, plus (X-Raydar only) cavity, hiatal hernia, mediastinal widening,
  calcification, rib fracture, hyperinflation, and line/tube **presence**.
- **RULE (derived, labelled):** ARDS pattern (bilateral diffuse opacities + clinical context),
  ILD pattern flag. These are heuristics, never presented as a model class.
- **EXPERIMENTAL / FUTURE:** device-tip **placement evaluation** (ET/NG/PICC/central-line
  malposition), true pathology **bounding boxes** (vs Grad-CAM heatmaps). No permissive
  off-the-shelf weights exist; research track only, clearly marked.

---

## 3. Architecture

### 3.1 Provider seam = dependency injection

Screens/controllers talk **only** to `window.SMD_THOREX_PROVIDERS`. Providers are the only
layer touching network / disk / image processing. Two assemblies (mirrors KardioX):

- `mockProviders()` — deterministic, offline; drives previews + the entire test suite.
- `liveProviders()` — wraps StewardMD networking + secure storage + the real backend.

Model swapping happens **inside** a provider; the UI never changes. This is the mechanism that
makes TorchXRayVision ↔ X-Raydar ↔ future Core ML interchangeable.

### 3.2 Backend inference interfaces (Python)

```
InferenceProvider (ABC)
├── LocalInferenceProvider        # in-process PyTorch/ONNX (single-node GPU/CPU)
├── CloudInferenceProvider        # HTTP client to the ThoreX serving container
└── FutureCoreMLProvider          # FUTURE — on-device conversion, same interface
```

Pipeline is a chain of independent, injectable stages — each a class with one responsibility
and a typed interface, never tightly coupled:

```
ImageInput
  → ImageQualityAssessment   (AP/PA, portable, exposure, rotation, inspiration, cropping)
  → PrimaryDetection         (TorchXRayVision | X-Raydar)
  → SecondaryValidation      (EXPERIMENTAL — CheXzero or 2nd head)
  → Localization             (Grad-CAM heatmaps)
  → ExplainabilityEngine     (heatmap overlay + per-finding rationale)
  → ClinicalCorrelationEngine(P2 — pulls StewardMD patient data)
  → ReportGenerator          (structured report)
  → StewardMDIntegration     (stewardship, FHIR, timeline)
```

### 3.3 Serving

- **FastAPI + Docker**, ONNX Runtime (GPU-ready), mirroring `backend/kardiox/`.
- Weights **auto-download on first boot**; mode-gated deps (`requirements-ml.txt`) so the base
  image stays small until ML mode is on — exactly the KardioX pattern.
- Secure endpoint `POST /api/thorex/v1/analyze` (health-gated; client falls back to
  "inference unavailable", never a fabricated result).
- **Deployment boundary (stated plainly):** this design produces runnable backend code + exact
  deploy commands. Actual GPU-cloud deployment and real GPU inference are **operator steps run
  by the user** — they are not performed or verified from the build session (no GPU, multi-GB
  weights). On-device Core ML is FUTURE.

### 3.4 Frontend module layout (mirrors `kardiox-*.js`)

| File | Responsibility |
|---|---|
| `thorex-flags.js` | `SMD_THOREX_FLAGS` registry (`smd_thorex`, `smd_thorex_cloud`, `smd_thorex_xraydar`, `smd_thorex_dev`, …). |
| `thorex-providers.js` | `SMD_THOREX_PROVIDERS` seam — mock + live assemblies. |
| `thorex-store.js` | Case/finding/report persistence (offline-db backed). |
| `thorex-models.js` | Label maps, severity bands, confidence-band mapping, sample fixtures. |
| `thorex-quality.js` | Client-side quality pre-check + acknowledgement gate. |
| `thorex-report.js` | Structured report builder + PDF/share/copy/save-case. |
| `thorex-correlate.js` | P2 — clinical correlation + stewardship launch. |
| `thorex-timeline.js` | P3 — longitudinal storage + follow-up comparison. |
| `thorex-fhir.js` | P2 — FHIR `DiagnosticReport` / `ImagingStudy` export. |
| `thorex-screens.js` + `thorex-screens.css` | All screens (upload, analyzing, result, report). |
| `thorex.css` | Base module styling (StewardMD design language). |
| `thorex.js` | Entry controller; complete **no-op when `smd_thorex` is off**. |

Loaded in `index.html` as versioned `defer` scripts, after the KardioX block. Access gated via
`SMD_XACCESS.gate("thorex", openThoreX)`.

---

## 4. Feature specification by phase

Spec covers all four phases; **build is sequential**, each phase ends at its own clinical review.

### Phase 1 — Functional CXR core (flagship MVP) — REAL

- **Image input:** camera, photo library, files; PNG / JPEG / HEIC / PDF→raster. Duplicate-upload
  rejection (perceptual hash). DICOM / FHIR ImagingStudy / PACS = FUTURE.
- **Preprocessing (MONAI):** normalize, resize, contrast/histogram, orientation correction,
  lung-region crop. Background removal best-effort.
- **Image-quality gate:** classify AP/PA·portable·lateral, exposure, rotation, motion,
  inspiration, cropping. If inadequate → warn + require explicit acknowledgement before proceeding.
- **Detection + localization:** TorchXRayVision (default) or X-Raydar (educational) → findings;
  Grad-CAM heatmap per positive finding.
- **AI output rules:** never show raw probabilities. Show Finding · Confidence **band**
  (High/Med/Low) · Severity · Location · Clinical relevance · Heatmap. (Bounding box = FUTURE;
  heatmap is the localization primitive in P1.)
- **Structured report:** Clinical Information · Technique · Image Quality · Findings · Impression ·
  Recommendations · Urgency · Follow-up. Export PDF / Share Sheet / Copy / Save Case.
- **Safety:** mandatory disclaimer on every result (exact text in §6). Educational-model banner
  when X-Raydar is active.

### Phase 2 — Clinical correlation + antibiotic stewardship — REAL (rules) + REAL (integration)

- **Correlation engine** pulls, where available: ABG, CBC, CRP, procalcitonin, BNP, EF (KardioX),
  microbiology, antibiogram, vitals, symptoms, medication list, renal/liver function, timeline.
- Produces reasoning, e.g. *"Pulmonary edema favoured over pneumonia: diffuse bilateral opacities +
  elevated BNP + reduced EF + normal procalcitonin."* Correlation weighting is **RULE**-based and
  labelled; it augments, never overrides, the imaging read.
- **Differential diagnosis:** ranked list with confidence bands (CAP, HAP, aspiration, edema, ARDS,
  TB, malignancy…), derived from findings + correlation.
- **Stewardship auto-launch:** on pneumonia → Antibiogram, empirical antibiotics, renal dosing,
  IV→PO conversion, de-escalation/duration/culture reminders (reuse existing modules).
- **FHIR:** `DiagnosticReport` (+ `ImagingStudy` reference) export.

### Phase 3 — Timeline + follow-up comparison — REAL (storage) + RULE (interval)

- Store original image, AI findings, report, severity, heatmap per study.
- Longitudinal compare; interval-change flag Improved / Stable / Worsened via per-finding
  severity delta (RULE). True image registration/overlay = FUTURE (labelled).

### Phase 4 — Native depth + R&D — mixed

- **REAL:** iOS/Android polish (HIG / Material You, dark mode, VoiceOver, Dynamic Type, haptics,
  iPad layout), background inference, lazy loading, model caching, cloud fallback.
- **EXPERIMENTAL:** device/tube **placement** evaluation + true detection **bounding boxes**
  (research track, marked not-for-clinical-use).
- **FUTURE:** on-device Core ML / TensorRT; CT / MRI / lung-US / POCUS / mammography / bone —
  the pipeline + provider interfaces are shaped to accept them without UI/business-logic change.

---

## 5. Data flow, storage & security

- **Analyze:** image → client quality pre-check → provider → (live) upload to ThoreX serving →
  pipeline → structured result → render + optional Save Case.
- **Storage:** encrypted at rest (StewardMD offline-db / secure storage); cases scoped to the
  signed-in account + device, consistent with KardioX/FundX.
- **Security requirements:** no patient images in logs (image bytes never logged; only opaque
  ids/metrics); temporary inference images deleted after analysis; HIPAA-architecture / DPDP /
  GDPR-ready posture per `SECURITY_FRAMEWORK.md`. Cloud inference requires explicit consent
  (`smd_thorex_cloud`, tri-state ask-once, like `smd_kardiox_cloud`).
- Must pass `stewardmd-security-reviewer` (upload + data + network change).

---

## 6. Safety & compliance

Every result **must** display verbatim:

> "AI-generated findings are intended to assist qualified healthcare professionals and must always
> be interpreted in conjunction with clinical assessment, radiologist review where appropriate,
> laboratory findings and other investigations."

Plus: never overstate certainty; never hide uncertainty (confidence bands always shown);
educational-model banner when X-Raydar is active; low image-quality warning is blocking until
acknowledged. Mandatory review gates: **R1 clinical** + **R2 AI** (blocking), R3 security,
R5 UX/accessibility, R6 performance, R7 release before any flag flip.

---

## 7. Testing

- **Unit (Node, provider layer):** confidence-band mapping, severity, dedup hashing, report
  builder, correlation rules, differential ranking, quality-gate logic — all against `mockProviders`.
- **Backend (pytest):** each pipeline stage in isolation; contract tests for `InferenceProvider`
  implementations; a smoke test that loads TorchXRayVision weights and runs one real inference on a
  bundled sample CXR (proves REAL, not stubbed).
- **Golden regression:** fixed sample CXRs → expected finding sets/bands, wired into the existing
  clinical golden-regression harness.
- **No network in unit tests;** live paths covered by backend integration tests behind a marker.

---

## 8. Out of scope (this spec)

Autonomous diagnosis; DICOM/PACS ingest; true bounding-box detection; device placement scoring;
on-device Core ML; non-CXR modalities. All are FUTURE and must not be represented as functional.

---

## 9. Build order

P1 backend (models + API, real inference smoke test) → P1 frontend module (mock providers, full
UI + tests) → wire live provider to backend → **R1/R2 review** → P2 → review → P3 → review → P4.
Each phase gets its own implementation plan via the writing-plans skill.
