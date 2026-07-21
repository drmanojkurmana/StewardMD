# Multi-layout digitiser validation harness

Reproduces [`../../docs/MULTILAYOUT.md`](../../docs/MULTILAYOUT.md). Exercises the PRODUCT digitiser
(`app/services/digitization.py`: `detect_print_layout` + `digitize_auto`) and the shipped
`kardiox-reconstruct.js` + inference path.

- `render_digitize_layouts.py` — renders real 12-lead signals as **3×4 + rhythm**, **6×2**, **12×1**
  print layouts (fixed 10 mm/mV + mm grid → calibrated mV), then runs the product `digitize_auto` with
  automatic layout detection. → `layouts_input.json` + `layout_images/`.
- `layouts_diagnose.cjs` — reconstruct → full coverage (12×1) → ensemble + hybrid STEMI; partial
  (3×4/6×2) → rhythm-strip rate + safe deferral (never fabricates). → `layouts_results.json`.

## Workspace (`$D`) — not committed

`cpsc_engine_signals.json` (real 12-lead signals + labels), `models/` (ecglib_*.onnx + engines/*.onnx),
`node_modules/onnxruntime-node`.

## Run

```bash
export D=/path/to/workspace
python render_digitize_layouts.py     # render + auto-detect + digitise (product code)
node   layouts_diagnose.cjs           # reconstruct + inference per layout
```

Result: layout auto-detection **17/18**; 12×1 → full 12-lead ensemble (STEMI now fires from the image);
3×4/6×2 → rhythm-strip rate + safe deferral (mask-aware full-lead dx on 2.5 s windows is a documented upgrade).
