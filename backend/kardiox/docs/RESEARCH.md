# KardioX Pipeline — Open-Source Research & Dependency Register

Research done **before** implementing Phase 5, per the directive "reuse proven implementations; avoid
reinventing algorithms; document every external dependency and license." This is the decision record for
each stage: what we use, its license + maintenance status, why, and — critically — **where the honest
boundary is** (which stages are real classical algorithms we can implement now vs. which need a trained
model / dataset / real-image validation we do not have in-repo).

> Guiding rule from the brief: *"When a stage cannot yet be completed because an external model, dataset,
> or validation is required, clearly explain why, implement the surrounding production architecture, and
> stop at that boundary rather than inventing functionality."*

## Stage-by-stage

### 5A Image preprocessing — **OpenCV** ✅ implementable now
- **Lib:** `opencv-python-headless` (Apache-2.0), `numpy` (BSD-3). Both mature, actively maintained.
- **Why:** crop / perspective-warp / deskew / CLAHE / adaptive-threshold / grid removal / denoise / glare
  reduction are *classical, deterministic* CV — no learning required. These are standard, well-understood
  algorithms; we implement them directly.
- **Grid removal approach:** ECG grids are printed in red/orange; we mask reddish pixels in HSV and drop
  them, then adaptive-threshold the residual dark trace. This is the standard color-based technique and is
  robust to the grid without touching the (black) trace.
- **Boundary:** the *code* is real and unit-testable on synthetic images; **accuracy on real phone photos
  of paper ECGs still requires a labelled image set to tune/validate** (glare, curl, skew vary widely). The
  provider is therefore implemented but `implemented=True` is gated on that validation for live use.

### 5B Digitization (image → per-lead pixel traces) — **classical baseline now; learned digitizer is the upgrade**
- **Surveyed OSS:**
  - **PhysioNet/CinC Challenge 2024 — "Digitization and Classification of ECG Images"** (open baselines,
    BSD-style / PhysioNet). The canonical reference effort for this exact problem.
  - **`ecg-image-kit`** (PhysioNet, BSD-3) — generates + degrades synthetic ECG images from WFDB records
    and provides digitization tooling. **Primary path for training data + a plug-in learned digitizer.**
  - **ECGMiner**, **PaperECG** — academic Python digitizers (mixed GPL/research licenses; not turnkey pip).
- **Decision:** there is **no mature, drop-in pip library** that robustly digitizes a phone photo of a
  12-lead. So we (a) implement a **real classical baseline** — per-lead column-scan of the cleaned binary
  trace with pixel→mV/ms calibration from the detected grid — as `ClassicalDigitization`, and (b) keep a
  clean `DigitizationProvider` seam so a learned digitizer (trained via ecg-image-kit data) drops in later.
- **Boundary:** the classical baseline is genuine but **known-limited** on overlapping/low-contrast traces;
  production-grade accuracy needs the learned digitizer + validation. Documented, not hidden.

### 5C Signal processing / measurement — **NeuroKit2 + WFDB + SciPy** ✅ implementable now
- **Libs:** `neurokit2` (MIT), `wfdb` (MIT), `scipy` (BSD-3), `numpy` (BSD-3). All mature + maintained.
- **Why:** NeuroKit2 does real ECG cleaning, R-peak detection, and P/QRS/T **delineation**; from its
  fiducials we compute HR, PR, QRS, QT→QTc (Bazett/Fridericia), RR, signal-quality, beat locations. WFDB
  gives PhysioNet-compatible record I/O so digitized signals interoperate with datasets/tools. Axis is
  computed from lead I/aVF net QRS deflections (deterministic).
- **Boundary:** fully real given a signal; **end-to-end correctness depends on 5B digitization quality**,
  and clinical measurement accuracy needs validation against reference annotations (e.g. PTB-XL).

### 5D Rhythm / beat classification — **TorchECG interface; trained weights are the boundary**
- **Surveyed OSS:** `torch_ecg` (TorchECG, MIT) — model zoo + training for ECG (CRNN, ResNet1D, etc.);
  datasets **PTB-XL** (12-lead, open, PhysioNet), **MIT-BIH Arrhythmia** (open), **CPSC**. `torch` (BSD-3).
- **Decision:** implement `TorchECGRhythm` as a provider that **loads a checkpoint from config and runs
  inference** through a stable interface — real integration code. We do **not** ship weights.
- **Boundary (hard):** a trustworthy rhythm classifier requires **training on labelled datasets + GPU +
  clinical validation**. Per the brief we implement the integration + stop here rather than shipping an
  unvalidated or faked classifier. Until a validated checkpoint is provided, this provider stays `none`
  and rhythm is derived deterministically from 5C measurements where that is defensible (rate/regularity).

### 5E Morphology (BBB, AV block, ST, LVH/RVH, axis, QTc, WPW, Brugada, electrolytes) — **deterministic rules now; subtle patterns need a model**
- **Decision:** much of this is *criteria-based on measured features* (e.g. LVH by Sokolow-Lyon voltage,
  BBB by QRS width + morphology, WPW by short PR + delta + wide QRS, long-QT by QTc, axis deviation by axis
  degrees, ST elevation/depression by J-point deviation). We implement these as **deterministic rules**
  extending the existing Rule Engine — real and unit-testable, no model needed.
- **Boundary:** subtle/gestalt morphology (e.g. early Brugada type-1 vs type-2 nuance, ischemia patterns)
  is where an ML model adds value; that rides on 5D and is left at the model boundary.

### 5F Rule Engine integration — ✅ real (engine already implemented)
- All AI/signal outputs feed the deterministic `BuiltinRules` engine (ported from the JS `SMD_KARDIOX_RULES`).
  Every finding carries supporting evidence, matched criteria, weight/confidence, differentials, and
  what-to-verify. No diagnosis bypasses it.

### 5G Gemini explanation — ✅ implemented (constrained)
- `google-generativeai` (Apache-2.0). Gemini **never diagnoses**: prompt is built only from rule-validated
  findings, a system instruction forbids additions, and the disclaimer is enforced server-side. (See
  `services/gemini.py`.)

## Dependency register (licenses)

| Package | License | Stage | Status |
|---|---|---|---|
| opencv-python-headless | Apache-2.0 | 5A/5B | implemented |
| numpy | BSD-3 | 5A–5E | implemented |
| scipy | BSD-3 | 5C | implemented |
| neurokit2 | MIT | 5C/5E | implemented |
| wfdb | MIT | 5C | implemented |
| torch / torch_ecg | BSD-3 / MIT | 5D | interface only (weights = boundary) |
| ecg-image-kit | BSD-3 (PhysioNet) | 5B | plug-in path for learned digitizer |
| google-generativeai | Apache-2.0 | 5G | implemented |

**Datasets referenced (not bundled):** PTB-XL, MIT-BIH Arrhythmia, PhysioNet/CinC 2024 ECG-image set — all
open-access via PhysioNet under their respective data-use agreements; used for future training + validation,
never redistributed here.

## The honest boundary, in one line
Preprocessing, signal measurement, deterministic morphology, rule validation, and Gemini explanation are
**real** and testable now. Robust digitization and a trustworthy rhythm/morphology **classifier** require a
trained model + datasets + clinical validation that must be produced and signed off outside this repo — we
build the full production architecture up to that line and stop there.
