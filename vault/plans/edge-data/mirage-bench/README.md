# Mirage vision bench (2026-11-13)

Evidence for the "no Mirage plugin" call in [[Decisions]] (2026-11-13). Raw console output is quoted in
[[Mirage-Eval]]; re-run before relying on it.

## Environment
| Item | Value |
|---|---|
| Machine | Cloud container, x86-64 Linux. **Not a phone.** |
| Package | `cactus-compute` 4.2.0 (PyPI), Python venv |
| Engine | Cactus 4.1.0, `Cactus-Compute/cactus` revision `4e822c9036be2eb0e47ef556df32a818bb1572ef` |
| Weights | `mirage.cact`, 21,611,043 bytes, `Cactus-Compute/mirage` revision `76c1e9e53381aca8fc3843c636216c96ff220122` |
| Telemetry | `CACTUS_TELEMETRY=0`, `DO_NOT_TRACK=1` (the Python package posts usage to a Supabase endpoint unless set) |

## Scripts
| Script | What |
|---|---|
| `make.py OUT` | Draws 7 synthetic, PHI-free images: printed Rx, italic/skewed/noisy Rx, strip label, three one-line orders, lab report |
| `run.py IMGDIR` | `describe(sections=["text"])` on each image, prints OCR lines and wall time |
| `form.py IMGDIR` | `extract()` with enum (frequency, route), text and bounded-integer fields |
| `fetch_gate.py OUT` | 5 CXR (`hf-vision/chest-xray-pneumonia`), 5 skin (`marmal88/skin_cancer`), 5 fundus (`Tejaswini628/aptos-fundus-images`), 3 ECG (`Amarsaish/ecg_images`) via the HF datasets-server first-rows API. Images stay in scratch, not committed |
| `gate.py IMGDIR` | Image-type gate with `extract` enum + scene/object description. Also needs `ecg_syn*` (drawn inline in the session), `doc_*` (from `make.py`) and `other_*` (scikit-image samples) |
| `gate2.py IMGDIR` | Same gate with short labels, argmax ignoring "-", plus object boxes on a face photo |
