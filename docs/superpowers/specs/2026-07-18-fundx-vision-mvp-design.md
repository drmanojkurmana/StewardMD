# FundX AI — Phase B MVP (Vision Engine) — Design Spec

Date: 2026-07-18
Status: Approved (design), implementation in progress
Branch: `feat/fundx-vision-mvp` · Recovery tag: `pre-fundx` · Flag: `smd_fundx` (default OFF)

## 1. Context

FundX AI is an AI-guided smartphone fundus-imaging + clinical-intelligence module built
**inside StewardMD** (per the FundX Master Plan). It is organized as three cleanly
separated engines that communicate only through versioned structured JSON:

- **Vision Engine** — acquires + understands retinal images. Never reasons clinically.
- **Clinical Engine** — reasons over findings + patient context. Never touches pixels. (Phase C.)
- **Steward Engine** — the existing StewardMD workflow (chart, timeline, storage, nav).

Phase A (the frozen product/UX design) is complete and delivered as an HTML handoff
(`FundX AI - Phase A.dc.html`). **Phase A is the single source of truth for UI/UX.**

### Platform decision (resolved during brainstorming)

The Master Plan's Phase B prompts were written generically for **Flutter**. StewardMD is
**not** Flutter — it is a buildless vanilla-JS/HTML/CSS web app wrapped in **Capacitor 8**
(native iOS + Android) on Cloudflare Pages/Worker/D1/R2. Decision: **build FundX inside the
existing StewardMD web/Capacitor codebase** (honors "built inside StewardMD", reuses auth,
native wrap, camera/haptics plugins, deploy pipeline, feature-flag system, one codebase).
The handoff README explicitly permits recreating the design "in whatever technology makes
sense for the target codebase."

### Vision-capability decision (resolved during brainstorming)

Full retinal-detection ML models do not exist yet and require labeled data + a physical
20D-lens test rig. Decision: **real detection where feasible now, mock behind swappable
interfaces for the rest.** Real: live camera + eye/iris/pupil/distance/motion via MediaPipe
+ focus/exposure/reflection/red-reflex heuristics. Mock: retina/disc/macula/lesion detection
and the retinal foundation model — behind an interface so real inference (Vertex AI/Gemini/
Cerebras/local ONNX or TFLite) drops in later with no UI, workflow, or data-contract change.
This matches the Master Plan's own mandated "Mock Model Support".

## 2. Scope

### In (this MVP / first PR)
Flag-gated FundX module. Live camera → real-time guided acquisition coaching (find eye ·
center pupil · working distance · hold steady · reduce reflection) → readiness meter + gate
chips → guided acquisition state machine → automatic burst capture (no shutter button) →
image quality scoring + best-frame selection → **mock** retinal findings JSON → scan
persisted to a local per-patient list, viewable. Plus **Guided Training Mode** (7 beginner
levels) — the core value: teaching a non-ophthalmologist to hold and align the 20D lens.
Entry points: Home "Retinal Scan" quick-action tile + ICU/Ward Documents-workspace launch
button (carries patient context).

### Out (explicit — follow-on PRs / Phase C)
Real retina/disc/macula/red-reflex ML models; deep image-enhancement pipeline; timeline
diff/compare UI; research mode; hospital dashboard; deep settings; cloud sync; export
formats beyond JSON; and the entire Clinical Engine (diagnosis, differential, severity,
referral, reports, AI chat). The findings-JSON contract is defined now so Phase C plugs in.

## 3. Architecture

Only the **Vision Engine** is implemented. It is an **independent, reusable module** (Addition
#4) — no dependency on FundX UI internals, consumable by other StewardMD features. Its parts
sit behind small interfaces so implementations swap without touching consumers (Addition #2).

### Vision Engine components
- `FundxCamera` — `getUserMedia({video:{facingMode:"environment"}})` → `<video playsinline
  muted autoplay>` → `requestAnimationFrame` loop → `canvas.drawImage` → `getImageData`.
  Greenfield (no live-camera precedent in the app). Throttled analysis cadence off the paint
  path. Permissions already declared natively (NSCameraUsageDescription; CAMERA).
- `VisionDetector` (interface) `analyzeFrame(frame) -> FrameAnalysis`:
  - `MediaPipeDetector` (REAL) — FaceLandmarker + iris; eye presence, pupil/iris center →
    centering, iris diameter → working distance, landmark delta → motion/stability.
  - `HeuristicDetector` (REAL) — focus (Laplacian variance), brightness/exposure (histogram),
    reflection (specular-highlight ratio), red-reflex proxy (central redness+brightness).
- `IRetinaModel` (interface) `analyze(bestFrame, ctx) -> RetinalFindings`:
  - `MockRetinaModel` (STUB, deterministic) — retina/disc/macula/lesions/cup-disc/DR-grade;
    `provider:"mock"`, `model_version:"mock-0.1"`; clearly labeled non-diagnostic. Real
    providers (Vertex/Gemini/Cerebras/ONNX/TFLite) implement the same interface later.
- `AlignmentEngine` — fuses FrameAnalysis → optical-path + working-distance confidences.
- `ReadinessScore` — weighted composite 0–100 + per-gate booleans.
- `AcquisitionStateMachine` — the guided workflow (states below); drives coaching; adaptive,
  never a fixed sequence.
- `CoachDirector` — state + analysis → cues (text / directional arrow / haptic / voice).
- `SmartCapture` — auto burst (N frames) when readiness > threshold; no shutter.
- `QualityEngine` + `BestFrameSelector` — per-frame scoring; pick best overall/disc/macula.
- `FindingsJSON` — assembles the stable, versioned Vision output contract.

### Acquisition state machine (from Master Plan Part 2 Module 11)
Searching Eye → Eye Detected → Searching Pupil → Pupil Centered → 20D Lens Detected →
Aligning Optical Path → Searching Red Reflex → Red Reflex Stable → Retina Detected →
Improving Focus → Reducing Reflection → Improving Exposure → Finding Optic Disc →
Finding Macula → Capture Ready → Auto Burst → Selecting Best Frame → Quality Review.
(Lens/red-reflex/retina/disc/macula gates are driven by mock/heuristic signals in the MVP.)

### Engine boundary contract
Vision Engine emits only `RetinalFindings` JSON + `QualityScore` JSON. It never renders
clinical language and never recommends treatment. Clinical Engine (Phase C) will consume
these. Boundary is a versioned schema.

## 4. Data models (immutable-style plain objects + JSON schemas, each `schemaVersion`)

`FrameAnalysis`, `AlignmentResult`, `ReadinessScore`, `QualityScore`, `RetinalFindings`,
`CaptureSession`, `LearningProgress`, `OperatorStats`, and the persisted `ScanRecord`.

### `ScanRecord` — every saved scan persists (Addition #3)
1. **Original image** (raw best frame, on-device)
2. **Enhanced image** (real enhancement pipeline `fundx-enhance.js`: reflection-suppress ·
   denoise · gray-world WB · contrast/gamma · unsharp; original never mutated)
3. **Quality metrics** (`QualityScore`: focus/blur/exposure/reflection/FOV/visibility/overall)
4. **Acquisition metadata** (session stats: duration, attempts, motion/lens stability,
   readiness trace, eye R/L, state transitions, capture timing)
5. **Structured Vision JSON** (`RetinalFindings`, versioned `schemaVersion`)
6. **Patient context** (patientRef/MRN, age/sex, relevant vitals if passed from ICU.summary)
7. **Timestamp** (capture datetime, ISO)
8. **Device / app version** (platform, model hint, StewardMD gold version, app build)
9. **Provider / model version** (`provider`, `model_version`, e.g. `mock`/`mock-0.1`)
Plus **audit info** (operator id/name, created/edited actions, record version).

## 5. Storage — `FundxStore` (native/web abstracted)
- Images (native): `Filesystem.writeFile({directory:"DATA", path:"fundx/<id>-orig.jpg" | "-proc.jpg" | "-thumb.jpg", data:b64})`; `getUri` for display. Web: IndexedDB/dataURL fallback.
- Metadata index: JSON in `localStorage` under `stewardmd.fundx.scans` + per-patient index
  `stewardmd.fundx.byPatient.<ref>`; learning/operator under `stewardmd.fundx.learning` /
  `.operator`. All try/catch wrapped (existing convention).
- Everything on-device (no cloud sync in MVP); architecture reserves a sync hook.

## 6. Files
- `fundx-vision.js` — Vision Engine: interfaces, detectors, mock retina model, alignment,
  readiness, quality, state machine, findings JSON. Pure logic; headless-testable; exposes
  `window.SMD_FUNDX_VISION`. **Independent + reusable** (Addition #4).
- `fundx-store.js` — `FundxStore` (`window.SMD_FUNDX_STORE`).
- `fundx.js` — `window.FUNDX`: overlay UI, screens, `CoachDirector`, `FundxVoice`, wiring;
  `FUNDX.open(ctx)/close()/isOpen()`.
- `fundx.css` — screens on `--rds-*` / `--sev-*` tokens + `body.dark`.
- Vendored MediaPipe under `assets/vendor/mediapipe/` (WASM + model, each < 25 MiB; lazy).
- Edits: `index.html` (`<link>` + `<script defer>` after `image-engine.js` + `swipe-back.js`,
  `?v=goldN`); `sw.js` (`CACHE` bump); `home.js` (`ACT.retinalscan` + tile + settings toggle);
  `icu.js` (FundX launch button in Documents workspace, passing `ICU.summary()`).

## 7. UI — Phase A frozen (Addition #1)
Full-screen `#fundxRoot` overlay (`position:fixed;inset:0;z-index:10000;.on` toggles). Screens:
FundX Home (recent scans / New scan / Training / empty) → Pre-capture (eye R/L, 20D-lens hold
primer, permission) → **Live Camera + AR overlay** (video, alignment reticle, coaching text +
arrows, readiness meter, gate chips, state label, haptics + voice, no shutter, auto-burst
animation) → Processing → Quality Review (accept/reject, breakdown, why-rejected + retake) →
Result (image + quality + mock findings, "Vision detection preview — not a diagnosis", save)
→ Guided Training Mode (7 levels + progress). Every data screen carries the 5 canonical states
(empty · loading · success · error · offline). **UI reproduces Phase A; any deviation forced
by a technical limitation is documented inline in code + in the Deviations log (§12).**

## 8. Coaching channels
Text + animated directional arrows (always) · Haptics `SMD_HAPTICS` (iOS auto no-op elsewhere)
· Voice `FundxVoice` — OFF by default, Web Speech where available, no-op on iOS WKWebView;
`@capacitor-community/text-to-speech` noted as reliable-iOS fast-follow (not this PR).

## 9. Reversibility (Addition #6)
Additive only: module returns early when flag off; entry points render only when on; zero
change to existing behavior. Recovery tag `pre-fundx`; branch `feat/fundx-vision-mvp`; PR at
end. Nothing merged until approved.

## 10. Testing + verification (Addition #5)
Every milestone passes: **static analysis** (`node --check` on changed JS) + **automated tests**
(`npm test`, incl. new `test/fundx.test.mjs`: flag default-OFF, state-machine transitions,
readiness/quality math, findings-JSON schema+versioning, ScanRecord round-trip with stubbed
localStorage) + **manual verification** (headless `test/run-fundx.mjs`: `?fundx=1` shows tile +
opens overlay, `?fundx=0` no-op; camera/MediaPipe guarded + tested via injected mock detector)
— before proceeding to the next milestone. Commit at each logically complete milestone.

## 11. Milestones
- **M1 Foundation** — `fundx-vision.js` skeleton (interfaces, data models, findings schema,
  readiness/quality/state-machine pure logic), `fundx-store.js`, flag `smd_fundx`, `fundx.js`
  overlay shell, `fundx.css` tokens, index.html/sw.js wiring, Home tile + settings toggle,
  `test/fundx.test.mjs`. Flag OFF ⇒ no-op. Verify.
- **M2 Detectors + camera** — MediaPipe (vendored, lazy, graceful fallback), heuristic
  detector, mock retina model, `FundxCamera` live preview + throttled loop, alignment +
  working distance. Verify.
- **M3 Guided acquisition UX** — Live Camera + AR overlay, coaching (text/arrows/haptic/voice),
  readiness meter + gate chips, state machine driving flow, SmartCapture burst, best-frame,
  processing/quality-review/result screens, pre-capture setup. Verify.
- **M4 Persistence + patient integration** — full `ScanRecord` (all 9 fields + audit), save/
  list/view per patient, ICU Documents launch button w/ context, FundX Home recent list. Verify.
- **M5 Guided Training Mode** — 7 levels + progress + operator stats. Verify.
- **M6 Polish + docs + PR** — accessibility, canonical states, safety labeling, developer docs
  (architecture, extension points, Phase C handoff), final full verification, push + PR.
- **M7 Enhancement pipeline** — real `fundx-enhance.js` (pure, swappable `IEnhancer`);
  persists a genuine enhanced image distinct from the original. Verify.
- **M8 Provider abstraction / AI Router** — `fundx-providers.js`: register/select/validate/
  fallback/health; mock active by default; isolated adapters for Vertex(Gemini)/Cerebras
  (cloud, real fetch when configured) + ONNX/TFLite (on-device, lazy when configured).
  Capture flow routes findings through the router. Verify.
- **M9 Timeline + Compare** — per-patient scan history + quality trend; current-vs-previous
  compare with metric deltas. Verify.
- **M10 Settings + Export** — AI-provider selector, capture sensitivity, voice toggle,
  delete-all; scan → JSON export (native Share / web download). Verify.
- **M11 Clinical Engine foundation (Phase C)** — `fundx-clinical.js`: deterministic,
  evidence-based, advisory rule engine (findings + patient → severity/urgency/referral/
  follow-up/safety/confidence/evidence) behind a clinical provider seam; nested flag
  `smd_fundx_clinical` (default OFF). Verify.
- **Integration** — `test/run-fundx.mjs`: headless Chrome + fake camera drives the real
  flow end-to-end (flag→tile→overlay→camera mount→training; ?fundx=0 no-op). 15/15 green.

## 12. Deviations from Phase A (log)
Phase A UI is frozen and reproduced. Deviations forced by the web/Capacitor target or by
the absence of trained models are recorded here with rationale:

- **Home entry placement** — the "Retinal Scan" entry sits as the first tile in the Home
  "Clinical tools" grid rather than as a 5th button in the fixed 4-up quick-action row
  (that row is a strict 4-column grid; a 5th item would break its layout). Same icon,
  label, and destination as Phase A; presentation only.
- **MediaPipe delivery** — real eye/pupil/distance/motion detection loads MediaPipe from
  the jsDelivr CDN on first camera use, with graceful fallback to heuristic-only if it
  cannot load. Vendoring the assets locally (see `assets/vendor/mediapipe/README.md`) is a
  documented follow-up for full offline support; no UI/contract impact either way.
- **Acquisition redesigned to observable optical/image-quality cues (no lens detection).**
  Supersedes the earlier simulated `SimRetina` gating. The state machine progresses on
  eye/pupil (MediaPipe), working distance, red reflex, real **circular-fundus** + **vessel**
  heuristics, focus/exposure/glare/motion, and phone **roll**, and auto-captures only when a
  composite **diagnostic-quality** score is met. Lens power (20D/28D/40D) is never identified
  or required; an optional operator-confirm fallback (`smd_fundx_lens_confirm`, default off)
  only un-sticks a stalled setup phase and never bypasses the real image-quality gate. Live
  disc/macula remain an optional findings-level provider seam (mock → Vertex on the capture).
- **Voice coaching (TTS)** — off by default; Web Speech where available; reliable-iOS TTS
  (`@capacitor-community/text-to-speech`) is a documented fast-follow, not in this MVP.

## 13. Phase C handoff notes
`RetinalFindings` JSON (versioned) + `QualityScore` are the stable Vision→Clinical contract.
`IRetinaModel` is the inference swap point (mock → Vertex/Gemini/Cerebras/ONNX/TFLite). The
Vision Engine module (`SMD_FUNDX_VISION`) is reusable by other StewardMD features. No
architectural refactor should be required to add the Clinical Engine.
