# KardioX — ECG-Digitiser Integration (image → signal)

**ECG-Digitiser** (felixkrones, **BSD-2**, PhysioNet/CinC-2024 winner) reconstructs per-lead **mV signals**
from a photographed/scanned paper ECG using Hough gridline/lead-layout detection + an nnU-Net trace
segmentation model. It ships pretrained M1/M3 weights via Git-LFS. KardioX integrates it as the
`external` digitizer — **no weights bundled, nothing runs until you install it**.

## Why a wrapper (not our classical digitizer)
The classical `ClassicalDigitization` (column-scan) is the always-available baseline. ECG-Digitiser is the
**learned upgrade** for robust real-photo digitization. Because it emits already-calibrated mV, the wrapper
returns a `"signal"` passthrough that `WfdbSignal.to_signal` uses **directly** (no lossy pixel→mV
round-trip). Run both together via `ConsensusDigitization` to compare + flag disagreement.

## Install (operator, once)
```bash
git clone https://github.com/felixkrones/ECG-Digitiser.git
cd ECG-Digitiser && git lfs install && git lfs pull      # fetches the M1/M3 nnU-Net weights
# set up its nnU-Net environment per the repo README (torch + nnU-Net)
```
Provide a small command that reads an image and writes reconstructed signals. It must accept `{input}`
(image path) and `{output}` (output base path) and write EITHER:
- `{output}.npy` — a NumPy array shaped `(n_leads, n_samples)` in **mV**, or
- a WFDB record `{output}.hea` + `{output}.dat` (physical units mV).

## Wire it (config)
```
KARDIOX_PROVIDER_DIGITIZATION=external
KARDIOX_DIGITIZER_ENTRYPOINT=app.integrations.ecg_digitiser:digitize
KARDIOX_ECG_DIGITISER_CMD="python /path/ECG-Digitiser/reconstruct.py --input {input} --output {output}"
KARDIOX_ECG_DIGITISER_FS=500          # sampling rate of the reconstructed signal (confirm vs the tool)
KARDIOX_ECG_DIGITISER_TIMEOUT_S=120
```
For consensus digitization (classical + ECG-Digitiser, with agreement scoring):
```
KARDIOX_PROVIDER_DIGITIZATION=consensus
KARDIOX_DIGITIZER_CONSENSUS_MEMBERS=classical,external
```

## Input expectations
ECG-Digitiser was trained on `ecg-image-generator`-style layouts: standard **3×4 + 10 s rhythm strip**,
**25 mm/s · 10 mm/mV**. Photos far from that layout degrade digitization — the KardioX quality gate +
layout detection flag such images upstream.

## Behaviour + honesty
- **Not Ready** (`pipeline_unavailable`) until `KARDIOX_ECG_DIGITISER_CMD` is set and the command runs and
  produces output. Missing binary / non-zero exit / timeout / no output → Not Ready. **Never fabricates.**
- Empty image → `bad_image`. The command runs with no shell (arg-split), in a temp dir, on trusted config.
- License: **BSD-2** (commercially usable with attribution). Its training data + weights are the upstream
  project's; KardioX redistributes neither.

## Validation before enabling
Digitize a labelled image set (e.g. `ecg-image-kit`-generated from PTB-XL), run through the KardioX
pipeline, and compare recovered intervals/rhythm against the source signals (SNR / interval error) before
trusting it clinically. `smd_kardiox` stays OFF until that validation + clinician sign-off.
