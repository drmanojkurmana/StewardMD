# FundX AI — Acquisition Internals (field-test reference)

Exact, code-grounded description of how the heuristic acquisition engine works, for
real-device testing. Source: `fundx-detect.js` (pixel heuristics) + `fundx-vision.js`
(engine). All values are the current defaults in `SMD_FUNDX_VISION.CFG`.

## 1. How detection works

All signals are computed on a downscaled central region of each analyzed frame (camera loop
analyzes at ~110 ms cadence; capture burst uses full-res frames).

### Red reflex (`Heuristic.analyze`)
The warm central glow of light returning from the retina. Per region pixel, `warm = R −
(G+B)/2` and `lum = 0.299R+0.587G+0.114B`:
```
redReflex = clamp01( (mean(warm)/90) × (0.4 + 0.6 × (mean(lum)/255)) × 1.6 )
```
i.e. **central warmth scaled by brightness** — high when a bright red/orange field fills the
centre, low for a dim or colour-neutral view.

### Fundus (circular illuminated field) (`Heuristic.fundus`)
Power-agnostic — the fundus seen through any indirect lens is a warm, roughly circular field.
Mask = pixels with `40 < lum < 250` and `warm > 16`. From the mask:
- `centroid (cx,cy)` → **`fundusCenter`** = offset from frame centre, normalized −1..1 (drives left/right/up/down).
- `rArea = √(count/π)` (radius from area); `rg = √(mean squared distance from centroid)`.
- **`fundusCircularity = clamp01(1 − |rg·√2 − rArea| / rArea)`** → ≈1 for a filled disk, lower for irregular/partial fields.
- **`fundusSize = clamp01(2·rArea / min(w,h))`** → fraction of frame filled (drives closer/farther).
- **`fundusConf = clamp01( min(1, maskFraction/0.15) × (0.5 + 0.5·circularity) )`**.
- **`fundusVisible`** = maskFraction ≥ 0.04 AND circularity ≥ 0.35 AND size > 0.2.

### Vessels (curvilinear structure) (`Heuristic.vessels`)
Dark curvilinear ridges in the green channel of the central region:
```
meanGrad = mean(|Gx| + |Gy|)                 // region-wide edge energy
density  = fraction of pixels darker than their 4-neighbour mean by >6   // dark ridges
vesselScore = clamp01( (meanGrad/25)×0.6 + (density/0.15)×0.4 )
```
High for a real fundus with a vessel tree; ~0 for a flat/blank field.

### Diagnostic score — the auto-capture gate (`diagnosticScore`, `fundx-vision.js`)
The composite "is a usable retinal image actually present" score. Auto-capture requires it
to exceed `CFG.diagnosticMin` (0.62), sustained:
```
fundus = fundusConf × (fundusCircularity ≥ 0.45 ? 1 : 0.6)
glare  = 1 − reflection
diagnostic = clamp01( 0.24·fundus + 0.20·vesselScore + 0.16·redReflex
                    + 0.16·focus + 0.12·exposure + 0.08·glare + 0.04·contrast )
```

## 2. Signals contributing to the quality scores + weights

There are **two** composites — keep them distinct:

**(a) Live diagnostic score** (gates auto-capture, per frame) — weights above:
| signal | weight |
|---|---|
| fundus (conf × circularity factor) | 0.24 |
| vesselScore | 0.20 |
| redReflex | 0.16 |
| focus | 0.16 |
| exposure | 0.12 |
| glare (1 − reflection) | 0.08 |
| contrast | 0.04 |

**(b) Readiness composite** (drives the gate chips + overall %, `GATE_WEIGHTS`) — a weighted
count of the per-gate booleans:
| gate | weight | gate | weight |
|---|---|---|---|
| fundus | 0.14 | reflection (glare) | 0.08 |
| pupil | 0.12 | exposure | 0.08 |
| focus | 0.12 | distance | 0.06 |
| eye | 0.10 | motion | 0.06 |
| redReflex | 0.10 | vessels | 0.06 |
| — | — | level (roll) | 0.04 |
| — | — | quality (diagnostic) | 0.04 |

**(c) Post-capture QualityScore** (scores the saved best frame 0–100, `QualityEngine`):
focus 2 · sharpness 1.5 · exposure 1.5 · **fundusVisibility 2.5** · **vesselVisibility 2** ·
reflection 1.5 · redReflex 1 · contrast 1 · noise 1 · fieldOfView 1.

## 3. Fixed vs. adaptive thresholds

**All detection thresholds are FIXED** (static `CFG` values) — nothing auto-adapts per frame
or per environment yet. There are exactly **two runtime modifiers, both user/config-driven
(not automatic)**:
- **Sensitivity preset** (Settings: Easier/Balanced/Strict) sets `captureReadiness`
  (0.82/0.90/0.95) and `readySustainFrames` (4/6/8).
- **Operator-confirm fallback** (`smd_fundx_lens_confirm`, off by default) — on a stall, only
  relaxes the setup proxies `distance` and `redReflex`; never the fundus/vessel/quality gates.

Everything else (`fundusMin`, `fundusCircularityMin`, `vesselMin`, `redReflexMin`, `focusMin`,
`diagnosticMin`, etc.) is fixed and tuned manually — see the calibration table in
`VALIDATION.md`. (No dynamic/auto-calibration is implemented; that would be a future addition.)

## 4. Debug overlay (developer mode)

Enable: Settings → **Developer mode** (`smd_fundx_dev`) or `?fundxdev=1`. A live panel on the
camera shows, per frame, colour-coded pass/fail vs each gate: **focus, glare(reflection),
motion, distance, roll, red reflex, vessel, fundus (conf·circularity), DIAGNOSTIC, readiness,
and the capture decision** (state + ● CAPTURE).

## 5. Developer-mode frame recorder

With developer mode on, every analyzed frame is recorded to an in-memory buffer (last ~6000
frames, reset each time FundX opens). Tap **Export frames** on the overlay to download a CSV
with one row per frame: `t, state, focus, glare, motion, distance, roll, rollState, redReflex,
vessel, fundusConf, fundusCirc, diagnostic, readiness, eyeConf, pupilOffset, capture`. Use this
to plot quality-score progression and tune the CFG thresholds against real footage.

## 6. Guidance is signal-driven (verified)

The acquisition flow contains **no timers and no fixed sequence**:
- `AcquisitionStateMachine.step()` recomputes all gates from the frame's signals and sets the
  state to the *first unsatisfied gate* — it advances or regresses purely on the measured
  signals. The only temporal element is `readySustainFrames` (a **frame-count debounce**:
  READY must hold N consecutive frames), not a wall-clock timer.
- `Coach.cueFor()` is a **pure function** of the frame: direction from the measured fundus/pupil
  offset, closer/farther from distance + fundus size, rotate cw/ccw from phone roll, hold-steady
  from motion, glare from reflection.
- The only `setTimeout`s are post-readiness UX (capture flash, the ~180 ms pre-burst pause,
  processing-screen animation text) — none drive acquisition progression.

Automated proof (`test/fundx.test.mjs`): identical frames yield identical states/decisions
regardless of timestamp; degrading a single signal (e.g. focus) flips its gate and regresses
the state; restoring it re-advances; coaching direction follows the measured offset.
