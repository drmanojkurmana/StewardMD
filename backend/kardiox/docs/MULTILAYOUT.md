# Multi-layout support — standard hospital ECG printouts

The pipeline originally assumed a full 10-second 12×1 waveform. Real hospital printouts are usually
**3×4 + rhythm strip** (2.5 s per lead cell), **6×2** (5 s), or **12×1** (full disclosure). This adds
automatic layout detection + layout-aware digitisation, feeding the existing reconstruction layer.

## What was added

- **`backend/.../digitization.py` (product):**
  - `detect_print_layout(image)` — auto-detects the layout from ink row/column structure: counts
    contiguous horizontal trace bands (rows) and a full-width bottom band (rhythm strip). 3 rows → 3×4,
    6 → 6×2, ≥10 → 12×1.
  - `digitize_auto(image, layout_hint=None)` — layout-aware digitisation: digitises each lead cell
    (reusing the classical column-scan primitive), recovers calibrated mV (grid-FFT else geometry), and
    emits the reconstruction-layer format `{leads:{name:{mv,fs}}, rhythmLead, layoutHint, calibration}`.
- **`kardiox-reconstruct.js` (already shipped)** consumes that format: places each lead's samples at its
  true **column time-offset** (3×4 = 4×2.5 s, 6×2 = 2×5 s, 12×1 = full 10 s), **masks** the unprinted
  portion with NaN (never zero-pads/interpolates/stitches), preserves timing, uses the **rhythm strip
  independently** for rate/rhythm, and gates a dense signal to **full coverage only**.

## Validation (real signals rendered as print layouts, no mock)

6 real CPSC records × 3 layouts (18 images), digitised through the product `digitize_auto`:

| layout | auto-detected | ensemble ran | mean digitiser fidelity | diagnosis path |
|---|---|---|---|---|
| 12×1 | 5/6 | 5/6 | 0.86* | full-coverage 12-lead ensemble + hybrid STEMI |
| 3×4 + rhythm | 6/6 | 0/6 (by design) | 0.86 | rhythm-strip rate + safe deferral |
| 6×2 | 6/6 | 0/6 (by design) | 0.97 | safe deferral (no continuous rhythm strip) |

**Layout auto-detection: 17/18 (94%).** *12×1 mean fidelity is dragged by the one miss (a flat normal
ECG whose low-ink rows merged into 6 bands → detected 6×2); the 5 correctly-detected 12×1 recover at
0.96–0.997 fidelity.

**End-to-end wins:**
- **12×1 (full):** the ensemble runs and the calibrated render lets the **hybrid STEMI rule fire** — the
  STE case (A0021) that the original pipeline missed is now flagged "ST elevation (STEMI pattern)"
  from the image. AF/RBBB also recovered correctly.
- **3×4 / 6×2 (partial):** the reconstruction layer **does not fabricate** a dense signal, so the
  12-lead ensemble is correctly deferred; the 3×4 rhythm strip yields rate/rhythm (e.g. 155 bpm
  slightly-irregular on an AF record), 6×2 has no continuous strip so it defers fully. This is the
  scientifically correct behaviour — full-lead ML diagnosis on 2.5 s/lead windows requires a mask-aware
  model (documented in the reconstruction validation).

## Honest limitations

- Full 12-lead ML **diagnosis** is valid only for **12×1 / full-disclosure**; 3×4 and 6×2 give
  rhythm-strip rate + per-lead morphology + safe deferral (a mask-aware classifier is the upgrade).
- Layout detection uses ink-band structure; **flat/low-amplitude tracings can merge bands** (the one
  12×1 miss). A learned lead-box/label detector is the robustness upgrade for noisy phone photos.
- Lead assignment is **positional** (standard grid order), not OCR of printed lead labels.
- Requires a calibrated fixed-gain print; real phone photos still need the learned nnU-Net digitiser
  (OOM-gated here). `smd_kardiox` stays default-OFF.
