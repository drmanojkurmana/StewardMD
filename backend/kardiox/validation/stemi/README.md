# STEMI hybrid-detector validation harness

Reproduces the before/after numbers in [`../../docs/STEMI_DETECTION.md`](../../docs/STEMI_DETECTION.md).
Runs the shipping code (`kardiox-stemi.js` + `kardiox-engines.js` via `onnxruntime-node`) on real signals.

- `build_cpsc_stemi.py` — builds the **primary** validation set from LOCAL CPSC data (curated challenge
  labels), held-out folds 9–10: 40 STE+ / 60 negatives (SNR + RBBB + LBBB). → `cpsc_stemi_valset.json`
- `build_stemi_valset.py` — builds a cross-dataset stress set from **PTB-XL** (PhysioNet): territory-
  labelled injury records + NORM + RBBB/LBBB hard-negatives. → `stemi_valset.json`
- `stemi_validate.cjs` — runs NN-only vs hybrid (NN + rule) and reports sensitivity / specificity /
  accuracy, per-group false positives, per-territory sensitivity, and gained/lost vs NN.

## Workspace (`$D`) — not committed (large / credentialed)

`cpsc_data/CPSC/*.hea|*.mat` + `labels.csv` (CPSC2018), `ptbxl_database.csv`, `models/` (ecglib_*.onnx +
engines/ecg_diagnosis.onnx + engines/heartgpt_afib.onnx), `node_modules/onnxruntime-node`.

## Run

```bash
export D=/path/to/workspace
python build_cpsc_stemi.py                                   # -> cpsc_stemi_valset.json
VALSET=cpsc_stemi_valset.json node stemi_validate.cjs        # primary metric (curated CPSC held-out)
python build_stemi_valset.py                                 # -> stemi_valset.json (needs network)
VALSET=stemi_valset.json node stemi_validate.cjs             # cross-dataset + BBB stress
```

Result: NN-only STEMI sensitivity **0.000**, hybrid **0.675** at **0.917** specificity on CPSC held-out;
**100%** specificity on the PTB-XL RBBB/LBBB stress negatives.
