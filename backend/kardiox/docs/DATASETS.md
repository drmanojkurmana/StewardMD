# KardioX — Datasets & Training Platform

KardioX **bundles no data**. Every dataset is loaded from an operator-supplied local directory obtained
under that dataset's own license / data-use agreement. Adapters **stream** (memory-safe) and never
redistribute. Adding a dataset = **one `DatasetProvider` module + one registry entry**.

## Registered datasets (`app/data/sources/`)

| Dataset | Access | License | Modalities | fs | Labels | Obtain |
|---|---|---|---|---|---|---|
| **MIMIC-IV-ECG** | **credentialed + DUA** | PhysioNet Credentialed Health Data 1.5.0 | waveform, report, features | 500 | machine reports (free-text) | physionet.org/content/mimic-iv-ecg (credentialing) |
| **MEETI** | **credentialed** (derived from MIMIC-IV-ECG) | inherits MIMIC DUA | waveform, image, report, features | 500 | LLM interpretations | HF `PKUDigitalHealth/MEETI` |
| **PTB-XL** | open | CC-BY-4.0 | waveform, labels, report | 500 | NORM/MI/STTC/CD/HYP | physionet.org/content/ptb-xl |
| **MIT-BIH** | open | ODC-BY 1.0 | waveform, labels | 360 | AAMI beat classes | physionet.org/content/mitdb |
| **Chapman** | open | CC-BY-4.0 | waveform, labels | 500 | SNOMED conditions | Chapman-Shaoxing 12-lead |
| **CPSC (2018)** | open | CC-BY-4.0 | waveform, labels | 500 | 9 classes (AF/I-AVB/...) | CPSC 2018 challenge |
| **CODE-15%** | open (Zenodo) | verify terms (research) | waveform, labels | ~400 | 6 labels (1dAVb/RBBB/LBBB/SB/AF/ST) | Zenodo CODE-15% |

Set a root per dataset (`KARDIOX_DATA_MIMIC_IV_ECG=/path`), or a shared `KARDIOX_DATA_ROOT` with a
`<name>/` subdir. `describe()` reports `available: false` (honestly) until the files are present.

### MIMIC-IV-ECG (first-class, full integration)
`app/data/sources/mimic_iv_ecg.py` (`MimicIVECG`):
- **record-list parser** — streams `record_list.csv` (subject_id, study_id, path, file_name) row-by-row.
- **machine-measurements parser** — `machine_measurements.csv` → `report_0..17` concatenated as the note +
  numeric measurement columns as `features`; loaded column-bounded, opt-out via `include_reports=False`.
- **waveform loader** — lazy `wfdb.rdrecord` per study (500 Hz, 12-lead, 10 s); `include_waveform=False`
  streams labels/reports only (memory-light).
- **waveform↔note linking** — joined on `study_id`.
- **incremental index** — `build_index(jsonl)` for resumable/streamed processing over ~800k records.
- **streaming** — never materializes waveforms; the only in-RAM index is the (opt-out) report lookup.
- **Not redistributed** — adapter + docs only; obtain via credentialed PhysioNet + DUA.

## Multi-format loader (`app/data/formats.py`)
`load_ecg(path)` normalizes CSV / .npy/.npz / .mat / WFDB / (optional) DICOM & XML → a 12-lead,
`target_fs`×`seconds` mV array (FFT-resample, crop/pad) — adopted from ExChanGeAI. Undecodable input
raises rather than fabricating a signal.

## Training platform (`app/training/`) — adopts ExChanGeAI (MIT) practices
- **`HyperparameterConfig`** — AdamW + ExponentialLR(0.9), 50-epoch cap, early-stop on weighted val loss,
  80/20 stratified, z-score (pretrained) / none (de-novo), head-only / full.
- **`TrainingPipeline`** — LR-finder step, epoch loop, early stopping, best-checkpoint, ONNX export,
  registers a `ModelCard`. The **DL step is an injectable backend** (`fit_epoch`/`evaluate`/`export_onnx`
  …) so the orchestration is unit-tested without torch; a real torch/fairseq backend implements it.
- **`FineTuningPipeline`** — head-only/full modes + **automatic classification-head adaptation** to the
  dataset's label count + base-model provenance (audited in the `ModelCard`). Documented base encoders:
  ECG-FM (MIT, 500 Hz/5 s), DeepECG-SSL (Apache-2.0, 250 Hz/10 s), HeartGPT (MIT).
- **`BenchmarkPipeline`** — weighted/macro/micro F1, accuracy, exact-match, hamming-accuracy, Brier, ECE,
  per-class, confusion, bootstrapped 95% CI, Fmax thresholds, latency; `cross_validate()` for
  ExChanGeAI-style cross-dataset external validation.
- **`ValidationPipeline`** — data-integrity checks on a provider's stream (schema, label consistency,
  lead/fs sanity).
- **`ModelRegistry`** (ONNX-first, provenance) + **`ExperimentTracker`** (file-based JSONL; no MLflow dep).

## Usage
```python
from app.data.registry import get_dataset
from app.training.pipeline import TrainingPipeline
from app.training.config import HyperparameterConfig

ds = get_dataset("ptb-xl", root="/data/ptb-xl")     # or KARDIOX_DATA_PTB_XL
assert ds.available()                               # False until you download it
TrainingPipeline(HyperparameterConfig()).run(ds, backend=my_torch_backend, run_id="ptbxl-crnn-v1")
```
The DL `backend` (torch/fairseq/ONNX) is supplied in a training environment; KardioX ships the
orchestration, not the trainer weights.
