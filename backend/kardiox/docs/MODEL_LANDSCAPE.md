# KardioX — Open-Source ECG Model Landscape, Comparison & Recommendation

Research date: 2026-07-21. Purpose: choose which open-source ECG projects to integrate for (a) image
**digitization**, (b) **signal analysis/measurement**, and (c) **classification/rhythm**, judged on
license, input requirements, validation datasets, maintenance, and **commercial-integration suitability**
for KardioX AI.

> Honesty guardrails: license + maintenance facts below were checked against each project's repository/
> paper on the research date and **must be re-confirmed at integration time** (licenses change). This
> document makes **no diagnostic-performance claim** for KardioX; performance numbers cited are what the
> upstream authors report for *their* systems, not validated in KardioX.

## The three sub-problems

1. **Digitization** (photo/scan of paper ECG → per-lead signal) — the hardest, most model-dependent step.
2. **Signal analysis** (beats, intervals, axis, ST) — largely deterministic; mature libraries exist.
3. **Classification** (rhythm/morphology/diagnosis) — needs a trained, validated model.

## Comparison

| Project | Role | License | Maintained | Ships weights | Input | Datasets / validation | Commercial fit |
|---|---|---|---|---|---|---|---|
| **NeuroKit2** | signal analysis | **MIT** | yes | n/a (algorithms) | 1-lead signal + fs | broadly benchmarked | ✅ integrated (5C) |
| **WFDB (wfdb-python)** | signal I/O | **MIT** | yes | n/a | WFDB records | PhysioNet standard | ✅ integrated (5C) |
| **ECG-Digitiser** (felixkrones) | digitization | **BSD-2** | yes | **yes** (nnU-Net, Git LFS) | 3×4 + 10s rhythm image @25mm/s·10mm/mV | **PhysioNet Challenge 2024 — 1st place** | ✅ **recommended** for learned digitization |
| **ecg-image-kit** (alphanumericslab) | image gen + digitize utils | **BSD-3** | v1.0.0 (2024) | n/a | time-series → synthetic images | used by PhysioNet 2024 | ✅ **recommended** for synthetic training data |
| **torch_ecg** (DeepPSP) | classifier architectures | **MIT** | yes (v0.0.31, 2025) | no (train yourself) | configurable fs (~400–500 Hz), 12-lead, ~4000–5000 samples | MIT-BIH, CinC2020/21, CPSC | ✅ **recommended** as the model framework (train + export) |
| **ecg_ptbxl_benchmarking** (helme) | reference benchmark | **GPL-3.0** ⚠️ | yes | yes (research) | PTB-XL 100/500 Hz, 12-lead | PTB-XL | ⚠️ **reference only — do NOT link into the product** (copyleft) |
| **ECG-GPT** (Yale CarDS) | image → report (vision enc-dec) | not published / web demo | web app | no public weights | 12-lead ECG **image** | multinational (EHJ-DH 2026) | ❌ **not integrable** (demo/research only, "not for clinical use", no license/weights) |
| **WAVIE** (CinC 2024) | digitization | see repo | 2024 | — | paper ECG | PhysioNet 2024 | 🔍 candidate; confirm license |
| **"Digitizing paper ECGs at scale"** (npj Digit Med 2025) | digitization | see repo | 2025 | — | paper ECG | clinical-research cohort | 🔍 candidate; confirm license |

### Dataset licenses (for training your own model)
- **PTB-XL** — **CC-BY-4.0** (commercial OK with attribution); 21k 12-lead, SCP-coded. Primary choice.
- **MIT-BIH / CPSC / PhysioNet CinC** — open via PhysioNet data-use agreements; confirm per-set terms.
- **PhysioNet/CinC 2024 ECG-image set** + ecg-image-kit synthetic generation — for the digitizer.

## The commercial-license trap (important)
`ecg_ptbxl_benchmarking` is **GPL-3.0**: excellent as a *reference* and for reproducing benchmarks, but
**linking or distributing derivative code** brings copyleft obligations that conflict with a closed
commercial product. **Do not import it into the KardioX backend.** Prefer permissive stacks: train with
**torch_ecg (MIT)** on **PTB-XL (CC-BY)**, and integrate **ECG-Digitiser (BSD-2)** for digitization.
`ECG-GPT` is a strong image-to-report *reference*, but it is a research web demo with no published weights
or license — not integrable, and explicitly "not for clinical use."

## Recommended architecture

**Interchange format = ONNX.** Train in PyTorch (torch_ecg) or adapt any framework, then **export to
ONNX** and serve via `onnxruntime`. This (a) decouples KardioX from any single framework's license/runtime,
(b) runs CPU or GPU, and (c) lets a model be swapped by dropping a `.onnx` file + changing config — which
is exactly what the Phase-6F `ModelBackend` seam already provides (`OnnxBackend`, `TorchScriptBackend`, …).

Pipeline mapping (no backend/frontend change needed — all seams already exist):

```
image → [ECG-Digitiser, BSD-2]  →  signal → [NeuroKit2/WFDB, MIT]  →  measurements ┐
              (DigitizationProvider = "external", entrypoint wrapper)               ├→ Rule Engine → report
        (optional) → [torch_ecg→ONNX classifier]  → rhythm/morphology candidates ───┘   (validates every
                        (RhythmProvider = "torchecg" + ONNX backend + adapters)            model output)
```

- **Digitization:** integrate **ECG-Digitiser** behind `provider_digitization=external` + a thin
  `KARDIOX_DIGITIZER_ENTRYPOINT="yourpkg.ecgdig:digitize"` wrapper returning our traces dict. Its expected
  layout (3×4 + 10s strip, 25mm/s·10mm/mV) matches KardioX's assumption. Use ecg-image-kit to generate
  training/eval images. Classical baseline stays as the fallback.
- **Signal analysis:** keep **NeuroKit2 + WFDB** (already real, Phase 5C).
- **Classification:** train a **torch_ecg** model on **PTB-XL** (+ CPSC/MIT-BIH), export **ONNX**, serve
  via `OnnxBackend`. Feed outputs through the deterministic **Rule Engine** — a model never diagnoses
  unvalidated.
- **Explanation:** Gemini, constrained to rule-validated findings (already real).

## How this plugs in (adapters — implemented this phase)

`app/services/models/adapters.py`:
- **`ModelInputSpec` + `adapt_signal`** — resample to the model's fs, fit sample count, order/zero-fill
  leads, normalize. Named presets (`ptbxl_500hz_10s`, `ptbxl_100hz_10s`, `torch_ecg_12lead`,
  `lead_ii_500hz_10s`) are **templates — confirm against the checkpoint's model card.**
- **`LabelMap`** — translate a model's native classes (e.g. PTB-XL SCP superclasses) into KardioX
  vocabulary; model labels are **candidates the Rule Engine still validates**.
- **`resolve_entrypoint`** — dynamically load an external digitizer/model wrapper by `module:function`.
- **`ExternalDigitization`** provider — plug a learned digitizer in by config, with **no backend change**.

Config to activate (once a validated model/checkpoint exists — KardioX ships none):
```
KARDIOX_PROVIDER_DIGITIZATION=external   KARDIOX_DIGITIZER_ENTRYPOINT=yourpkg.ecgdig:digitize
KARDIOX_PROVIDER_RHYTHM=torchecg  KARDIOX_RHYTHM_MODEL_KIND=onnx  KARDIOX_RHYTHM_MODEL_PATH=/models/rhythm.onnx
KARDIOX_RHYTHM_MODEL_INPUT_SPEC=ptbxl_500hz_10s  KARDIOX_RHYTHM_LABEL_MAP=ptbxl_superclass
KARDIOX_RHYTHM_MODEL_LABELS=NORM,MI,STTC,CD,HYP
```

## What KardioX does NOT do
Ship weights, fabricate inference, or claim diagnostic performance. Until a permissively-licensed,
**clinically validated** model is trained/obtained and signed off, the model-backed providers stay
`ready=false` and `smd_kardiox` stays OFF.

## Sources (checked 2026-07-21)
- torch_ecg — https://github.com/DeepPSP/torch_ecg (MIT)
- ECG-Digitiser — https://github.com/felixkrones/ECG-Digitiser (BSD-2; PhysioNet 2024 winner)
- ecg-image-kit — https://github.com/alphanumericslab/ecg-image-kit (BSD-3) · paper https://arxiv.org/abs/2307.01946
- ecg_ptbxl_benchmarking — https://github.com/helme/ecg_ptbxl_benchmarking (GPL-3.0)
- PTB-XL — https://physionet.org/content/ptb-xl/ (CC-BY-4.0) · https://www.nature.com/articles/s41597-020-0495-6
- PhysioNet/CinC Challenge 2024 — https://moody-challenge.physionet.org/2024/
- "Digitizing paper ECGs at scale" — https://www.nature.com/articles/s41746-025-02327-1 · https://arxiv.org/pdf/2510.19590
- ECG-GPT (Yale CarDS) — https://www.cards-lab.org/ecg-gpt · https://www.medrxiv.org/content/10.1101/2024.02.17.24302976v2.full
- NeuroKit2 (MIT), WFDB-python (MIT), onnxruntime (MIT) — per each project's repository.
