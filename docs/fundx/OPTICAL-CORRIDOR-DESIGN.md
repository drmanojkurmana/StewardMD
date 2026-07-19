# FundX — The Optical Corridor
### A lens-first, spatial-AR retinal acquisition instrument

**Status:** Unified design (synthesis of 5 facet designs) · **Flag:** `smd_fundx_corridor` (default OFF) · **Recovery:** tag `pre-fundx-corridor`, branch `feat/fundx-corridor` · **Parent flag:** `smd_fundx` (stays OFF until on-device + clinical validation)

---

## 1. Vision — from camera app to instrument

FundX today renders acquisition as a **flat SVG ring** (`#fundxRingFg`) plus a directional arrow (`.fundx-arrow`), a numeric-ish score, and coach chips. It reads like a camera app with a progress bar. That framing produced the reported defect: on a **bare face with no 20D lens and no fundus**, generic image-quality and eye/pupil signals leak through, the readiness ring blooms, and the instrument reports readiness for the *wrong optical system*.

This design reframes FundX as a **spatial instrument**, not a camera app. The operator is guided down an invisible **Optical Corridor** — the physical light path `Camera -> Condensing Lens -> Patient Pupil -> Retina` — rendered as a world-attached, predictive 3D tunnel over the live camera. Guidance is **motion before text**: the geometry leans, narrows, and settles; a single word appears only after the motion has played. Confidence is communicated by **shape** (the corridor narrowing) before color, and never by flashing.

Two hard truths shape everything below and are treated as load-bearing, not decoration:

1. **The transparent-lens reality.** A 20D/28D condensing lens is optically transparent with only a thin bright rim. Conventional CV detects it unreliably and intermittently. An earlier build made the lens a **hard prerequisite gate and stalled forever**; the over-correction made the lens **invisible** and produced false readiness on a bare eye. The correct third position — the spine of this design — is: **the lens is a first-class, confidence-weighted actor that arms the instrument and shapes guidance, but is NEVER a boolean gate.** The physical proof of the whole optical chain (the red reflex / fundus glow) is what actually unlocks capture.

2. **Through-the-lens optics.** In indirect ophthalmoscopy the phone **rear** camera images the aerial inverted image formed by the 20D lens, so MediaPipe FaceLandmarker will frequently **not see a normal face at all**. Eye detection is intrinsically unreliable in the real use-case. Any model that treats the eye as the entry gate is fragile by construction; the eye is demoted to a **supporting** signal.

**How this design fixes the reported bug, structurally.** The corridor has four illuminated segments (lens, axis, reflex, retina). The **retina segment only lights from optical evidence a lens+fundus physically produce** (`redReflex` + circular `fundus` + `vessels`). Therefore a bare face can reach **eye-lock at most**; the corridor stays wide and open, the retina segment stays dark, and "capture readiness" is physically unreachable. The interface cannot *look* ready on a face — the visual language itself now carries the constraint that the flat ring did not.

---

## 2. The lens-first acquisition pipeline

### 2.1 Architecture decision (conflict resolution)

Two implementation philosophies exist across the source facets, and they genuinely conflict:

- **Presentation-first (adopted for Phases 1–4, recommended default).** The lens-first *stages* are surfaced by a **presentation-stage resolver** over the **existing, validated** engine. `fundx-vision.js` gates, `fundx-engine.js` decisions, `fundx-detect.js`, and all capture timing are **untouched**. This fixes the reported symptom with zero clinical-safety risk and is instantly reversible (flag off = today's app).
- **Engine-first (offered as later, separately-flagged Phase 5E).** The deeper correctness fix: refactor `fundx-vision.js` so `ORDER[0]` is no longer `g.eye`, add a `LensEngine`, and invert the one line in `ReadinessScore.compute`. This directly addresses the through-lens eye-unreliability, but it changes golden FSM behavior and needs a rebaseline.

**Both agree on the invariants** (lens = confidence never a gate; glow-override; degrade-forward never-stall; corridor-narrowing = confidence rising). The pipeline below is written as the **logical target**, annotated with which parts Phase 1 delivers as presentation (safe) and which belong to the optional engine refactor.

### 2.2 Stages, gates, and never-stall recovery

The pipeline is a **soft, confidence-ordered corridor** of stages — not a chain of boolean gates. Each stage carries an enter-confidence, an exit-confidence (hysteresis so bands never flicker), and a **leapfrog** rule (a strong downstream signal skips forward). Every pre-corridor stage has a **watchdog** (frames-in-state) that on firing **never freezes** — it **degrades forward** (drops lens weighting, elevates the glow path, simplifies guidance) and always keeps a path to capture.

| Stage | State value | Purpose | Enter | Exit | Confidence driver | Never-stall recovery |
|---|---|---|---|---|---|---|
| **Searching** | `searching` | Understand the scene; find the **instrument**, not the eye | session start / deep-regression reset | `lensConf >= PROBABLE` **or** `glow >= 0.35` -> Lens detected; **leapfrog** to Red reflex if `glow >= redReflexMin` | `opticalCorridor` | Nothing to stall on; ambient only tunes guidance, never terminates |
| **Lens detected** | `lens_detected` | A condensing-lens candidate exists (probable) | `lensConf` in PROBABLE band | up: sustained toward LOCK -> Lens pose; down: `< UNCERTAIN` -> Searching (soft) | `lensConf` band | If it dithers at PROBABLE, proceed on best-available center; never hold |
| **Lens pose** | `lens_pose` | Estimate lens distance/tilt/rotation from disc geometry (+depthRing if present) | stable disc center/radius | pose variance low & `lensConf` climbing -> Lens locked | persist + steady (+depthRing) | Pose is guidance refinement; pass through flagged low-confidence if unresolved |
| **Lens locked** | `lens_locked` | Commit to a lens plane; anchor ghost lens + corridor origin | `lensConf >= LOCK` for `lensLockFrames` **or** glow-override | up -> Eye detected; **down (occlusion) -> Lens pose, not Searching** | `lensConf` | Sticky: hysteresis + ~12-frame occlusion grace before demotion |
| **Eye detected** | `eye_detected` | Find pupil/eye within/behind the locked disc — **OPTIONAL** | MediaPipe eye **or** dark round pupil candidate inside disc | -> Optical axis | `eyeAlignment` | **CRITICAL:** eye often invisible through the lens. If not found within `eyeStallFrames` but glow present, **skip to Red reflex** — the reflex proves the eye is on-axis. Eye is a helper, never a wall |
| **Optical axis** | `optical_axis` | Camera-lens-pupil colinearity + working distance (corridor centerline) | lens center & pupil/glow center known | `opticalAxisConfidence >= alignMin` -> Aligning | `AlignmentEngine.opticalAxisConfidence` | If pupil unknown, use fundus/glow centroid as axis proxy; distance falls back to `fundusSize` when depth null |
| **Aligning** | `aligning` | Signature corridor-narrowing phase | axis known, not yet tight | -> Red reflex when glow appears (corridor may be narrow before a reflex — expected) | `opticalAxisConfidence` + steady | Motion prediction guides before degradation; drift widens & re-guides, never drops state |
| **Red reflex** | `red_reflex` | The reflex is the navigation target | `redReflex >= redReflexMin` inside disc | -> Focus stabilize | `glow` | Loss re-guides via `moveDir`, does not restart |
| **Focus stabilize** | `optimizing` | Focus + exposure + glare + motion + level | unchanged | unchanged | quality subsystems | Critical-glare safety override (existing hysteresis) preempts but never terminates |
| **Capture ready** | `ready` | Diagnostic quality held | `ReadinessScore.ready` && `gates.quality` | `readySustainFrames` -> Capturing (auto) | readiness | Manual Capture Best Frame remains available at `manualThreshold` |
| **Capturing / Verify / Review / Done** | `capturing`/`assessing_quality`+`processing`/`review`/`done` | UI-driven tail; QualityEngine retinal gate + BestFrameSelector + CaptureRingBuffer | unchanged | unchanged | — | unchanged |

**The three never-stall keystones (all must survive code review, or the forever-stall returns):**

1. **Glow-override.** A real red reflex is physically impossible without a correctly placed condensing lens, so a real reflex **floors** `lensConf` high regardless of rim/spec:
   `glowOverride = glow >= 0.5 ? 0.85 : (glow >= 0.35 ? 0.6 : 0)`; `lensConf = clamp01(max(wFuse, glowOverride))`.
2. **Degrade-forward watchdog** on every pre-corridor state (above).
3. **RESTART basis = `rank(RED_REFLEX)`.** We only ever deep-restart after we truly *had* the retina and lost it — **lens hunting can never trigger a restart loop.**

### 2.3 Lens confidence engine (transparent-lens multi-signal fusion)

`lensConf ∈ [0,1]` is fused from signals that are **observable this frame** (weights renormalize over the observed mask, so a missing sensor never skews the scalar low). No signal is a gate.

| Signal | What it is | Availability |
|---|---|---|
| `rim` | Circular-rim / coarse Hough score on the 384px analysis downscale (the opaque holder ring) | REAL today (moderate) |
| `spec` | Specular-disc cluster: the lens throws a catchlight that moves rigidly with the phone | REAL today |
| `glow` | Red-reflex / fundus glow **spatially gated to the candidate disc** — the strongest signal | REAL today |
| `steady` | `1 - motion` from IMU | REAL today |
| `depthRing` | Near-field depth annulus (the rim returns depth even when glass does not) | Depth tier only; `null` otherwise |
| `persist` | Temporal EMA of a smoothly-parallaxing rigid circular candidate | REAL today |
| `assist` | Optional operator tap / `smd_fundx_lens_confirm` | REAL today, default OFF |

**Full model (target):** weighted fusion `{rim:0.22, spec:0.16, persist:0.14, steady:0.10, depthRing:0.18, glow:0.20}` normalized over the observed mask, then glow-override.

**Buildable-today derivation (Phase 1–2, presentational, no glass detection):**
```
lensConf = clamp01(
    0.45 * fundusCircularity * (fundusVisible?1:0)   // a warm CIRCULAR field
  + 0.30 * redReflex                                 // the orange-red return
  + 0.15 * rimSpecularScore                          // annular glint at the lens edge
  + 0.10 * temporalPersistence )                     // held across frames (median)
```
All inputs already exist in `Heuristic` (`fundx-detect.js`). **Bands with hysteresis** (README 04): `LOST <0.2 | UNCERTAIN 0.2–0.45 | PROBABLE 0.45–0.7 | LOCKED >=0.72` sustained ~5 frames; enter/exit differ by `lensHysteresis 0.08`.

All tunables live in a `CFG`/`CORRIDOR_CFG` object so tuning never edits logic: `lensProbable`, `lensLock`, `lensHysteresis`, `lensLockFrames`, `lensGlowOverride`, `corridorArm 0.30`.

### 2.4 The `opticalCorridor` scalar and the one-line engine fix (Phase 5E)

```
opticalCorridor = clamp01( 0.55*lensConf + 0.45*glow )   // health of the whole instrument
```
The engine-first option inverts exactly one line in `ReadinessScore.compute`:
```
// OLD — the eye arms the HUD (the bug: bare face -> eye+pupil -> bloom):
//   if (!gates.eye) ov = 0;
// NEW — suppress false progress until the instrument is understood:
if (opticalCorridor < CFG.corridorArm && fa.redReflex < CFG.redReflexMin && fa.fundusConf < CFG.fundusMin) ov = 0;
```
Eye+pupil on a bare face -> corridor ~0 -> readiness 0 -> no bloom. Capture remains gated downstream by the **untouched** QualityEngine retinal gate, so nothing unsafe is ever accepted even if `lensConf` is falsely high on a lamp. **This is offered as Phase 5E**, because the presentation-layer honesty (§1) already removes the *visible* symptom without touching the validated engine.

---

## 3. The Optical Corridor — signature interaction (model + rendering)

### 3.1 Where it plugs in

The corridor is a **presentation + geometry layer, not a new decision authority.** Capture timing stays with the validated FSM (`SMD_FUNDX_VISION`) and Decision Engine (`SMD_FUNDX_ENGINE.observe`), which already return `state`, `alignment.opticalAxisConfidence`, `gates`, `confidence.subsystems`, `stability{stable,trend,variance,smoothedReadiness}`, `readiness.overall`, `capture.{decision,ready,sustained}`, and `step`. One new buildless module `fundx-hud.js` (`window.SMD_FUNDX_HUD`, same IIFE + dual `module.exports`/`window` export as `fundx-vision.js`) consumes those plus raw `FrameAnalysis` in two parts:

1. **CorridorModel** — pure, DOM-free, headless-testable. `model(step, fa) -> SpatialFrame`.
2. **CorridorRenderer** — canvas/WebGL, running its **own 60fps `requestAnimationFrame`** loop.

### 3.2 The `SpatialFrame` contract (the degradation seam)

The renderer is written **once** against one struct. Tiers differ only in *which fields are populated and at what confidence* — the draw code never forks on platform (`worldPose===null` => screen-space; `distanceMetric===null` => ordinal depth; `depthOccluder===null` => no occlusion).

```
SpatialFrame = {
  anchor2D:        {x,y}       // preview-normalized eye/pupil/fundus centre
  anchorConf:      0..1        // low => corridor recenters slowly
  roll:            deg|null
  distanceOrdinal: 'near'|'ok'|'far'|'unknown'
  distanceMetric:  mm|null     // filled only when depth is real
  distanceConf:    0..1
  motion:          0..1
  velLead:         {dx,dy}|null // predicted short-term drift (motion-before-text)
  lensConf:        0..1        // DERIVED, never a gate
  corridorTight:   0..1        // 0 = wide/searching, 1 = snapped
  locks:           {lens,eye,axis,reflex,retina}   // each 0..1 progress
  readiness:       0..1
  deviation:       { lat:{x,y,mag}, depth, tilt, glow }  // renderable decomposition
  A:               0..1        // corridor "closeness" (anchored to engine, see 3.3)
  worldPose:       Matrix4|null // present only at ARKit/ARCore tiers
  depthOccluder:   Float32|null // present only at LiDAR/Depth tiers
}
```

### 3.3 The geometric model

Four collinear centres define the ideal axis: **camera principal point -> lens centre -> pupil centre -> fovea.** The corridor is a truncated cone (frustum) of *tolerance* around that axis, with **asymmetric narrowing**: wide at the camera (large error recoverable), tight at the pupil (through a 20D lens the acceptable pointing error is fractions of a degree).

**Deviation vector** (four orthogonal, individually-normalised terms, each with a graceful fallback so a missing sensor never zeroes the model):
- **Lateral `d_lat`:** `fa.fundusCenter` when visible (the light actually returning down the column) -> fallback `fa.pupilDir` (MediaPipe iris offset) -> none = stay Searching.
- **Depth `d_depth`:** native `fa.distanceMm` vs the working band `[0.20, 0.55] m` -> fallback `fa.fundusSize` blended with `fa.distanceState`.
- **Tilt `d_tilt`:** `fa.roll` (`|roll|/45`), + pitch only when AR supplies it.
- **Optical throughput `d_glow = 1 - max(fa.redReflex, fa.fundusConf)`.** This term **replaces lens tracking**: geometry can look perfect on a bare face, but with no glow `d_glow ~= 1`, so `A` cannot rise and the corridor cannot lock.

**Fuse** (stage-weighted L2, weights in `CORRIDOR_CFG`, shifting so `wglow` dominates from RED_REFLEX on):
```
D = sqrt( Σ w_i · d_i² ) / sqrt( Σ w_i );   A = 1 - D
```
**`A` is anchored to the engine** — blended with `step.alignment.opticalAxisConfidence` (already fuses eye+pupil+dist+glow with validated weights) — so the visuals never disagree with capture behaviour. The deviation vector is only the *renderable decomposition*.

### 3.4 The three signature behaviours

**Corridor width `W` (narrows on pipeline depth AND confidence):**
```
progress = mix( rankNorm(state), A );
W_render = lerp(W_far, W_near, smoothstep(progress)) * (1 + 0.5*variance);   // jitter widens slightly
```
Rings converge from a wide camera-plane mouth to a tight aperture at the target. **This narrowing IS the corridor.**

**Snap-to-alignment (critically-damped, with hysteresis mirroring `glareHysteresis`):**
- Enter lock when `A >= 0.80` AND `step.stability.stable` AND `d_lat.mag <= snapTol` for `snapFrames`.
- Release only when `A < 0.70` (no chatter).
- On snap the reticle glides onto the exact target via a critically-damped spring (`k~0.18` rising to ~0.35 at lock) so it clicks in without jumping; the converging rings collapse into one crisp lock ring; soft `selection` haptic.

**Predictive lead (windshield feel):** `t_lead = t + vel*tau` (`tau ~ 80–110ms`, clamped), `vel` from a 1-euro-filtered centroid velocity today, from AR camera velocity at higher tiers. The reticle sits where the eye is *about to be*.

**Quieting as confidence rises:** one scalar `q = smoothstep(A) * (stable ? 1 : 0.6)`. As `q -> 1`: chips fade, coach text collapses to a single word then nothing, the directional vector shrinks, rings thin and desaturate toward calm green. This makes Beginner/Standard/Expert a **continuous** function of confidence (mode is only a floor on verbosity).

### 3.5 Rendering — TODAY (2D signal-driven pseudo-3D)

Three stacked full-screen layers inside `.fundx-cam` (already `position:absolute; inset:0`):
- **L0 camera** — existing `<video>` or native GPU preview (`body.fundx-gpu`).
- **L1 `<canvas id="fundxHudGL">`** (`z:4`, `mix-blend-mode:screen`, WebGL, **progressive enhancement**, additive blending only): corridor depth-volume, reflex bloom, vessel shimmer, lock shockwaves. Drop-if-slow.
- **L2 `<canvas id="fundxHud2D">`** (`z:5`, 2D, **always present**): reticle, rings, directional vector-field, depth ladder, brackets, capture arc. This layer **alone** fully delivers the interaction on any device.
- **L3 DOM text** (`z:6`): reuse `#fundxCoach`/`#fundxStep` `aria-live`. Appears **last**.

In monocular mode we have no true extrinsics, so the corridor is an **honest artistic 1-point perspective whose parameters are entirely signal-driven** — it reads as 3D without claiming metric 3D. K concentric rings from a wide outer ring shrinking to a vanishing point at the target (`radius_i = W_render*(1 - i/K)^p`, `centre_i = lerp(boresight, target, i/K)`), advancing inward each frame to convey flow *into* the eye. Ghost optical axis = a soft dashed boresight->vanishing-point line. Ghost condensing lens = a translucent ring at the estimated lens plane, `opacity = lensConf`, dashed while `< PROBABLE` ("assumed, not measured"), solid when the optical effect confirms it. The reticle reuses `.fundx-reticle`; `#fundxRingFg` becomes the corridor mouth / confidence ring.

**Two-loop timing (critical):** analysis is ~8fps (`analyzeEveryMs:120`); the renderer runs its own 60fps rAF and **springs** toward the latest `SpatialFrame`, so motion never judders. Honour `prefers-reduced-motion` (block already in `fundx.css`): disable flow/spring, snap statically, keep ghost objects static.

### 3.6 Rendering — with ARKit / ARCore / LiDAR

When the `FundxDepth` plugin session is active, the corridor becomes a **real object**: back-project the MediaPipe pupil pixel using depth into camera space, transform to world via the 6-DoF camera pose, and create an anchor so the corridor stays glued to the eye through phone motion. The frustum becomes a metric truncated cone with tolerance in mm/degrees; deviation becomes true angular boresight-vs-axis + perpendicular distance feeding the *same* `d_lat/d_depth/d_tilt` slots. Render via SceneKit/RealityKit or a WebGL layer over the GPU camera texture; LiDAR adds true occlusion. **The same CorridorModel scalars drive both renderers** — only the *source* of deviation (world-metric vs screen-proxy) and the *renderer* change. Interaction philosophy is invariant across tiers (§6).

> **World-anchor caveat (honest):** the patient eye is not a static world feature, so a pose-only anchor lags a moving eye. Re-seed the pupil anchor from MediaPipe every frame; use pose only to smooth between detections (pose for high-frequency stability, MediaPipe for absolute position).

---

## 4. Per-stage HUD visual language (motion before text)

Colour language (**no flashing, ever**): `--fx-green #34d399` (locked), `--fx-blue #5b8cff` (searching/info), `--fx-amber #f6c453` (adjust), `--fx-red #f0776a` (critical — *steady* desaturated glow + vignette, never blinking, driven by the engine's `criticalGlare` hysteresis), plus a physical **reflex warm `#ff7a4d`**. Colour is **never the only channel** — every state also carries a distinct shape + motion + tone glyph (`smd_fundx_a11y_cvd`). Text policy: the one-line `Coach.cueFor` label fades in ~300–400ms *after* the motion, honoring the One Instruction Rule.

1. **Searching** — ambient blue; a soft breathing search reticle (r 90->110px, 0.15 alpha, ~3.5s sine) drifts; sparse motes; no ghost lens, no numbers. Delayed word: "Point at the eye."
2. **Condensing-lens detected** — a **ghost lens** materialises at the mid-Z waypoint: glassy double-ring, radial-gradient rim, faint chromatic edge; `ghostAlpha = 0.15 + 0.5*lensConf`; drawn *even at `lensConf=0`* — tracking only upgrades it.
3. **Lens pose** — the ghost lens gains 3D: affine tilt/skew from `roll` (today) or ellipse axes / face-plane normal (AR). A thin pose-normal stub grows from its centre. No text.
4. **Lens locked** — four bracket corners rotate in and clamp (AF-box close); one **single** soft ring pulse; `ghostAlpha` -> solid; `selection` haptic. On loss: brackets ease back out, ghost dims to base — **no red, never removed, flow never halts.** Word: "Lens ready."
5. **Patient eye detected** — reticle rings converge onto the pupil; an iris-fit ellipse traces the eye; scale settle `1.06 -> 1.0`; green tint; haptic. Loss = soft dissolve.
6. **Optical axis estimated** — a dashed receding beam Camera->lens->pupil with depth parallax; low confidence = bent/scattered dashes; as confidence rises it **straightens and glows**; achieved = single beam-snap + haptic. Zero numbers.
7. **Alignment guidance** — two **visually distinct** channels (README: lens vs phone guidance must differ):
   - *Lateral:* an **animated chevron vector-field** streaming reticle -> target, speed ∝ `|pupilDir|`, dissolving to nothing as it centres. Replaces the static `.fundx-arrow` — it *shows the motion*, never renders "Move Left."
   - *Depth:* a **breathing corridor / depth ladder** (Eye/Lens/Phone ellipses) with Z-chevrons flowing inward (come closer) / outward (ease back); too-close adds a soft steady red vignette. No mm shown.
8. **Retinal reflex appears** — the far end **ignites**: a warm radial bloom (`#ff7a4d`, additive) from the pupil, alpha easing 0->target over ~400–700ms, radius ∝ `redReflex`; rings pick up warm rim light. The emotional beat, colour/motion before any word. `selection` haptic.
9. **Focus stabilizing** — reticle **tremor damps** as `fa.motion` -> 0 (crystallizes); the fundus ring goes from a blurred *double* stroke to a single crisp stroke as `fa.focus` rises; glare shows as a calm directional red rim (engine hysteresis), never blinking. Corridor narrows sharply.
10. **Capture readiness** — the HUD reaches its quietest: everything fades except a single tight green ring and a **capture arc** that fills `0 -> 360°` over `readyFrames/readySustainFrames` (6). **The closing arc IS the countdown** — no digits. Retina-lock: vessel-tracery shimmer ∝ `vesselScore`, one expanding green confirm ring, `success` haptic.
11. **Automatic capture** — the arc completes -> an **iris-in "optical shutter"**: an eased soft luminance lift (~180ms, reuse `#fundxFlash` gently — *not* the 220ms strobe), freeze-frame settle, green check. The clinician pressed nothing.
12. **Quality verification** — corridor dissolves outward; a calm concentric "reading" pulse; quality shown as the **word** from `qualityWord()`, never 0–100. If rejected: corridor gently re-opens amber, reticle steps back one stage — recovery framing.
13. **Clinical review** — HUD hands off: elements exhale away, the frame lifts into the review card. No live reticle.

---

## 5. Microinteraction + motion/haptic catalog

**Motion grammar (every interaction inherits it):** critically-damped springs for all *arrivals/settles* (no overshoot; `stiffness 120` ~380ms settle, `60` ~650ms for large re-centering); easing tweens for reveals/dissolves (settle `cubic-bezier(0.22,1,0.36,1)`, dissolve `(0.4,0,0.2,1)`, collapse `(0.83,0,0.17,1)`; durations micro 180 / standard 320 / ceremonial 520ms); 1-euro predictive lead; pseudo-world-attachment today, true world-attachment at AR tiers.

**Rising/falling-edge wiring** (replaces the crude "haptic on state change"): fire microinteractions only on **edges** with hysteresis — `eyeAcquire/eyeLost` on `gates.eye`; `axis` on `opticalAxisConfidence>=0.55`; `reflex` on `gates.redReflex`; `ready` on READY entry; `recovery` on `stability.trend==='degrading' && confidence.level==='low'` before the engine's RESTART; lens edges on the HUD's own `lensConf` (0.5 up / 0.35 down).

| # | Microinteraction | Trigger | Visual | Duration + easing | Haptic |
|---|---|---|---|---|---|
| 1 | Searching | `SEARCHING`, no eye | 4 faint rings drift/rotate; scanning streaks; 0.25Hz breath | continuous | none (calm) |
| 2 | Lens acquired | `lensConf` up-cross 0.5 | ghost lens coalesces from particles; Camera>Lens segment glows | 520ms settle | `lensLock` |
| 3 | Lens lost | `lensConf` down-cross 0.35 | ghost thins to 15% and **holds** (does not vanish); corridor stays drawn. No red | 320ms dissolve | `lensSoft` |
| 4 | Eye acquired | `gates.eye` ↑ | reticle springs in from oversize, settles on pupil; lock-ring draws 0->360° | 380ms spring + 300ms | `eyeAcquire` |
| 5 | Eye lost | `gates.eye` ↓ | lock-ring un-draws; reticle expands 1.15x + softens; corridor re-widens one step | 300ms | `eyeSoft` |
| 6 | Optical axis achieved | `opticalAxisConfidence>=0.55` ↑ | beam ignites; single bloom travels once; mid-rings snap-align | bloom 600 / align 400ms | `axis` |
| 7 | Retinal reflex | `redReflex` ↑ | warm amber bloom from pupil; corridor tint cool->warm | 700ms easeOut | `reflex` |
| 8 | Focus stabilizing | `OPTIMIZING`, focus climbing | reticle edges sharpen; micro-jitter damps ∝ `motion` | continuous | `focusTick` (converging cadence 500->160ms; suppressed in Expert) |
| 9 | Capture countdown | READY, `readyFrames` climbing | 4 rings collapse to 1 aperture; arc fills; HUD quiets | ~700ms easeInOut | `countdown` (quickening ticks) |
| 10 | Capture success | quality accepted | aperture closes (iris) + eased white bloom -> calm check + frame slide-in | close 180 + bloom 300ms | `captureSuccess` |
| 11 | Capture failed | quality rejected / `retinalGate:false` | aperture re-opens **gently** (never red flash); eases back to last good stage; amber underline | 420ms easeOut | `captureFailed` (**warning, not error**) |
| 12 | Recovery | degrading + `deepRegression` rising, `lostFrames < 12` | corridor re-widens to regained-lock; ghost lens thins but persists; RESTART = widest re-widen, **not** a teardown | 650ms spring | `recovery` (soft) |
| 13 | Idle | stalled in SETUP / backgrounded | everything slows to 0.2Hz breath; dims to ~40%; ramps back on resume | continuous | none |

**Haptic sequencer — `SMD_FUNDX_HAPTICS`** — composed entirely from `SMD_HAPTICS` primitives (`light/medium/heavy/selection/success/warning/error`). `play(name)` runs a `[{at_ms, prim}]` timeline via `setTimeout` at **>=55ms** spacing (clears the 45ms gate); a per-pattern lock + 120ms global cooldown prevents machine-gun firing during fast FSM churn. Patterns: `lensLock [0:selection,90:medium]`, `lensSoft/eyeSoft/recovery [0:light]` (loss is **graceful** — never warning/error), `eyeAcquire [0:selection]`, `axis [0:light,80:light]`, `reflex [0:light,120:medium]`, `focusTick [0:selection]` (shrinking interval, stops when stable), `ready [0:medium]`, `captureSuccess [0:success,140:light]`, `captureFailed [0:warning]`. `error` is reserved for hard faults (camera-permission-denied).

> **Android reality (hard constraint):** `SMD_HAPTICS` is iOS-only by design; on Android/web the entire haptic column is a **no-op**. Every lock/loss/capture microinteraction **must carry full meaning through motion (+ optional sound) alone** — never ship an interaction whose only success signal is a buzz.

---

## 6. Tiered implementation map (graceful degradation)

**One rule: the renderer degrades on *confidence*, not on *tier*.** It never asks "do I have ARKit?" — it asks "how confident is this anchor / depth / lens estimate?" and simplifies. Missing capabilities are **silent** (no dialogs, no feature selection). A MediaPipe-only Redmi runs the *identical* corridor journey as an iPhone Pro — narrow, snap, capture — differing only in steadiness.

| Element | **Today (T0)** — bare phone | **ARKit** | **ARCore** | **LiDAR** | **Future** |
|---|---|---|---|---|---|
| Optical Corridor | screen-space pseudo-3D cone, half-angle `mix(28°,3°,corridorTight)`, spring recenter | world-anchored (correct parallax, no swim) | world-anchored on Android | occluded 3D geometry, sub-cm | volumetric on Vision Pro / Android XR |
| Ghost lens | ellipse at mid-axis, `opacity=lensConf`, dashed until PROBABLE | anchored to eye's 3D point | anchored via ARCore pose | correctly occluded at true depth | fiducial/IMU clip-on lens -> **measured** 6DoF, real lens-lock |
| Ghost axis / reticle | 2D dashed beam; reticle led by IMU-EMA `velLead` | true world ray; ARKit camera-velocity lead | ARCore pose lead | depth-occluded | ML-learned anticipatory lead |
| Depth indicator | ordinal near/ok/far from `irisW`+`fundusSize` | SceneDepth coarse metric contributor | ARCore Depth -> **continuous metric** vs `[0.20,0.55]m` | LiDAR sub-cm; tighter readiness | depth-from-defocus, no ToF |
| Lens/eye/axis/reflex/retina locks | all buildable from existing booleans/scores, rising-edge | steadier (less thrash) | steadier | metric | real retina model -> genuine retina-lock |
| Motion prediction | 1-euro centroid velocity | CoreMotion angular velocity | ARCore pose velocity | — | learned per-operator pacing |

**Real vs simulated (honesty about the stack):**
- **REAL today (pixel math):** focus, exposure, brightness, contrast, specular/reflection, `redReflex`, fundus circle, vessels, + new `lensRim` (Sobel + coarse Hough), `lensSpec` (specular clustering), `persist` EMA, `rimSpecularScore` — all headless-testable.
- **REAL today (MediaPipe):** eye/pupil/pupilDir/coarse distance/motion — **unreliable through the 20D lens** (hence eye is optional). **REAL (deviceorientation):** roll.
- **REAL on depth tier only (FundxDepthPlugin):** metric `distanceMm`, `distanceConfidence`, roll/pitch, `depthRing` — `null` and renormalized-out otherwise.
- **SIMULATED / MOCK:** retinal disease findings (`MockRetinaModel`) behind the `IRetinaModel` swap point. **Acquisition never depends on the clinical layer.**

---

## 7. Phased build plan (reversible, flag-gated)

**Recovery point first:** `git tag pre-fundx-corridor` and branch `feat/fundx-corridor` (per the StewardMD reversible-changes convention: flag + recovery tag, permanent only after owner approval). Every phase is independently shippable and flag-off = today's app exactly.

- **Phase 1 — T0 corridor HUD (replaces the flat circle).** New `fundx-hud.js` (`SMD_FUNDX_HUD`): mount L1 (WebGL, drop-if-slow) + L2 (2D, always-on) canvases in `screenCamera()` (between `.fundx-cam-scrim` and `.fundx-cam-top`, `pointer-events:none`); derive `SpatialFrame` from `eng.observe()`; render corridor + ghost lens/axis + predictive reticle + ordinal depth ring + all locks + core microinteractions; drive haptics/voice via existing `haptic()`/`VOICE`. `updateCameraUI(step, fa)` gains one branch: when `smd_fundx_corridor` is on and the HUD initialized, call `HUD.push(step, fa)` and fade the legacy ring/arrow/chips (they become the a11y fallback layer); otherwise the current path runs **verbatim**. **Zero changes** to `fundx-vision.js`/`fundx-engine.js`/`fundx-detect.js`. Retina segment lights only from real optical evidence -> **fixes the reported bug in the visual language.**

- **Phase 2 — T0 depth of interaction.** Add the derived `lensConf` + a **no-tap soft-advance timer** (if `lensConf < PROBABLE` for ~45 frames while eye is good, proceed with the ghost lens dashed/"assumed" and `locks.lens` frozen — always a path forward, no user tap, no config flag), ghost-lens states, full lock/microinteraction polish, chevron motion vectors, `velLead` from IMU (`smd_fundx_sensors`), and a pure `rimSpecularScore` helper in `Heuristic`. Still no engine/gate changes. Add `fundx-haptics.js` sequencer + `fundx-motion.js` math (or fold into `fundx-hud.js`).

- **Phase 3 — T1/T2 world-anchoring (reuse `smd_fundx_depth`).** Extend the FundxDepth plugins to stream the full **camera transform** (ARKit ARSCNView pose / ARCore session pose — today only roll/pitch/distance surface). Populate `SpatialFrame.worldPose` + metric `distanceMetric`. The renderer switches to world-anchored + predictive **automatically** because the fields are now non-null. Absent -> Phase-1/2 screen-space behaviour.

- **Phase 4 — T3 LiDAR occlusion.** Swift plugin streams SceneDepth/LiDAR into `SpatialFrame.depthOccluder`; renderer enables ghost occlusion + sub-cm depth. Still behind `smd_fundx_depth`; non-LiDAR devices skip it silently.

- **Phase 5 — future + optional engine refactor.**
  - **5A–5D:** external fiducial/IMU lens adapter -> measured `locks.lens`; swap `MockRetinaModel` via `registerRetinaModel()` for a real on-device retina model -> genuine retina-lock; Vision Pro / Android XR reuse the identical `SpatialFrame` with no redesign.
  - **5E (owner decision — the engine-first option):** the lens-first FSM refactor in `fundx-vision.js` (new STATE head + soft confidence-ordered ORDER + `LensEngine`) **and** the one-line `ReadinessScore` inversion (`opticalCorridor` arm-gate replacing the hard-eye-gate). Extend `fundx-engine.js` `fuseConfidence`/RANK/`failureFor` with the lens stages; move the RESTART basis to `rank(RED_REFLEX)`. This changes golden FSM behaviour and **requires a golden rebaseline** — scheduled only after the presentation layer proves the lens-first model on-device.

**Tests** (mirroring `test/fundx-vision.test.mjs`): feed synthetic `step`+`fa` sequences and assert deviation decomposition, `A`/`W` monotonic narrowing, snap hysteresis, the quieting curve, and — **the standing lesson** — that **`lensConf = 0` never changes `snap`/lock/readiness/`shouldCapture`** (byte-identical), so the corridor can never block capture without a lens.

---

## 8. Feature flag + recovery recommendation

- **New master flag:** `smd_fundx_corridor` (bool, default **false**, query alias `?fundxcorridor=1`), added to `fundx-flags.js` `DEFS` — one line, consistent with the existing registry.
- **Reuse:** `smd_fundx_depth` for world-anchor/metric/occlusion tiers; `smd_fundx_ar_guidance` for overlays on/off (off -> camera + text coach only); `smd_fundx_dev` to expose `SpatialFrame` + tier + `lensConf` in the Developer HUD; `smd_fundx_lens_confirm` stays default OFF (optional operator assist, never required).
- **Recovery:** tag `pre-fundx-corridor`; branch `feat/fundx-corridor`; keep the flat SVG ring as the **live fallback** so flipping the flag off is an instant, no-deploy revert.
- **Rollout posture:** make default-ON only after on-device validation; the parent `smd_fundx` stays default OFF until on-device + clinical validation, consistent with the FundX posture.

---

## 9. Open decisions for the owner

1. **Engine refactor vs presentation-only (the one real conflict).** Phases 1–4 fix the reported symptom with zero engine risk. Phase 5E (lens-first FSM + the one-line `ReadinessScore` inversion) is the deeper correctness fix for the through-lens eye-unreliability, but touches golden FSM behaviour and needs a rebaseline. **Approve / defer / reject Phase 5E?**
2. **The one-line `ReadinessScore` change on its own** is the single highest-leverage engine-side fix. Ship it standalone-flagged now, fold it into 5E, or rely solely on presentation honesty? (`corridorArm 0.30` needs on-device tuning.)
3. **Phase-1 substrate:** two-canvas WebGL+2D split (recommended) or 2D-only first with WebGL deferred? WebGL over the GPU-composited native preview has WebView z-order pitfalls to validate on-device.
4. **Default-ON criteria:** demo sign-off, headless-green, or a clinical acquisition-success-rate threshold?
5. **`lensConf` bands + false-positive tolerance:** confirm the untouched QualityEngine retinal gate is the sole clinical backstop and set detected/probable/uncertain/lost thresholds via on-device calibration.
6. **Android haptics:** confirm motion (+optional sound) must fully carry meaning; add an opt-in WebAudio tone layer (default OFF) to compensate?
7. **Sound:** all UI sound OFF by default (recommended, clinical), or a subtle opt-in acquisition-tone set for the reflex-ignite and capture beats?
8. **Module naming:** consolidate on one `fundx-hud.js` (recommended) or split into `fundx-hud`/`fundx-corridor`/`fundx-haptics`/`fundx-motion`?

---

### Load-bearing invariants (do not drop in implementation)
- **Lens = confidence, never a boolean gate.** Enforced by glow-override + degrade-forward watchdog + `RESTART` basis = `rank(RED_REFLEX)`. Drop any one and the forever-stall returns.
- **Eye is optional** (invisible through the 20D lens) — a clinical-optics reality, not a tuning knob.
- **Capture is gated only by the untouched engine + QualityEngine retinal gate.** No `ORDER` gate, no `ready`, no `shouldCapture`, and no snap ever reads `lensConf` — so a transparent, untrackable lens can drop `lensConf` to 0 forever and the pipeline still advances on glow/fundus/quality.
- **Nothing jumps; nothing flashes.** Springs + predictive lead are load-bearing; loss is graceful (soft light, corridor re-widen), `warning` reserved for capture-failed, `error` for hard faults only.
- **Acquisition-only.** Lens-lock/retina-lock are acquisition cues, never diagnostic claims; the Vision/Clinical firewall and `MockRetinaModel` disclaimer stand.
