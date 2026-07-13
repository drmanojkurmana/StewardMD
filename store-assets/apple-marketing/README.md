# StewardMD — App Store screenshots (1290 × 2796)

Professional marketing screenshots for the App Store Connect unified **iPhone
6.5″ / 6.7″ / 6.9″ Display** slot. That slot accepts only these sizes:
1260 × 2736, 1320 × 2868, or **1290 × 2796** (and their landscape variants) — so
these are rendered at **1290 × 2796** (the common 6.7″ size). Each is a real, current
capture of the live app (guest mode) at deviceScaleFactor 3, then framed with the
StewardMD brand — deep-teal gradient, mint eyebrow chip, Space Grotesk headline, a
realistic iPhone-Pro device (Dynamic Island + 9:41 status bar), and a faint ECG line.

Upload the first 3 as the install-sheet hero set; App Store Connect down-scales this
set to smaller devices.

| # | File | Feature | Headline |
|---|------|---------|----------|
| 1 | `01-home.png` | Home | Antibiotic decisions, right at the bedside |
| 2 | `02-clinical-decision.png` | Case → QUICK DECISION | From findings to a clear first move |
| 3 | `03-antibiogram.png` | Antibiogram (light) | Know what covers what — instantly |
| 4 | `04-lab-watch.png` | Lab Watch 24/7 | Your labs, watched round the clock |
| 5 | `05-icu-snapshot.png` | ICU snapshot | The whole ICU picture, at a glance |
| 6 | `06-antibiogram-dark.png` | Antibiogram (dark) | Coverage and resistance, decoded |
| 7 | `07-dark-mode.png` | Dark mode (home) | Calm and clear, on every night shift |
| 8 | `08-drug-index.png` | Drug Index (412,224 brands) | 1,200+ diseases, 4 lakh+ drug brands |

The drug-index shot shows live data from the production API (`api.stewardmd.in` →
`/health` reports 412,224 rows), so the "4 lakh+ brands" figure is verifiable on screen.

All clinical output is decision-support only and carries the in-product
"verify locally / not a substitute for clinical judgment" disclaimers.

## Regenerate

```bash
# 1) capture live app screens → screens/*.png  (headless Chrome @ DSF3)
node scripts/store/capture.mjs
# 2) compose the marketing frames → 0N-*.png
node scripts/store/render.mjs
```

- `screens/` — raw, unframed source captures (1284 × 2778) + the recolored brand
  `mark.png` and the cropped `08-decision.png` (real meningitis QUICK DECISION,
  header trimmed so it leads with the decision card).
- `_frame.html` — the parametric marketing template (background, headline, device
  frame). Edit copy/colors here or in `scripts/store/render.mjs`.
- Capture runs in guest mode and bypasses the intro/consent gate via `?tour=0` +
  seeded localStorage; it enters no real credentials and touches no patient data.
