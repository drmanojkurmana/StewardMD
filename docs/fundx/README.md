# FundX AI — Developer Guide (Phase B MVP · Vision Engine)

AI-guided smartphone fundus imaging, built **inside StewardMD** (web + Capacitor).
This is the Phase B MVP: the **Vision Engine** — guided 20D-lens acquisition, quality
scoring, and structured findings — plus local persistence and StewardMD integration.
The **Clinical Engine** (diagnosis, reports, AI chat) is Phase C and is intentionally
absent; the interfaces below are the seams it plugs into.

Design spec: `docs/superpowers/specs/2026-07-18-fundx-vision-mvp-design.md`.

## Enable

Flag `smd_fundx`, **default OFF**. Turn on with `?fundx=1` (off with `?fundx=0`) or
Settings → "FundX AI · Retinal (Beta)". When off, `fundx.js` returns early and the
module is a complete no-op — no entry points, no globals beyond a stub.

Entry points (only when enabled): Home → "Retinal Scan" tile; ICU/Ward chart →
Records → "FundX AI" sub-tab (opens for the current patient).

## Files

| File | Role | Global |
|---|---|---|
| `fundx-vision.js` | **Vision Engine core** — pure, DOM-free, reusable, headless-testable | `window.SMD_FUNDX_VISION` |
| `fundx-enhance.js` | Image-enhancement pipeline (pure), swappable `IEnhancer` | `window.SMD_FUNDX_ENHANCE` |
| `fundx-providers.js` | Retinal-inference provider abstraction / AI Router | `window.SMD_FUNDX_PROVIDERS` |
| `fundx-clinical.js` | Clinical Engine (Phase C) — rule-based advisory, provider-seamed | `window.SMD_FUNDX_CLINICAL` |
| `fundx-detect.js` | Perception — heuristic pixels, MediaPipe adapter, sim-retina, camera | `window.SMD_FUNDX_DETECT` |
| `fundx-store.js` | Local persistence (images + metadata index) | `window.SMD_FUNDX_STORE` |
| `fundx.js` | Overlay UI, screen router, coaching, capture flow, training | `window.FUNDX` |
| `fundx.css` | Presentation on `--rds-*` / `--sev-*` tokens + `body.dark` | — |

Wired in `index.html` (`<link>` + 4 `<script defer>` after `image-engine.js` /
`swipe-back.js`); `sw.js` CACHE and per-file `?v=` bump on ship. Buildless:
`scripts/build-www.sh` copies root files into `www/` automatically.

## Architecture (three engines, JSON contracts)

Only the **Vision Engine** is built here. It is independent + reusable — no dependency
on the FundX UI. Its sub-components sit behind small interfaces so implementations swap
without touching the engine, the UI, or the data contracts:

```
FundxCamera → VisionDetector(Heuristic + MediaPipe) ─┐
                                                     ├→ DetectorHub → FrameAnalysis
              SimRetina (swappable retina signals) ──┘
FrameAnalysis → AlignmentEngine → ReadinessScore/gates → AcquisitionStateMachine → CoachDirector
             → SmartCapture (burst) → QualityEngine + BestFrameSelector
             → IRetinaModel.analyze(bestFrame) → Findings JSON  ── the Vision→Clinical contract
```

State machine (adaptive, never fixed): searching_eye → centering_pupil → detecting_lens
→ aligning → red_reflex → retina → optimizing → framing → ready → (auto burst) →
selecting → processing → review.

## Extension / swap points

- **Retinal inference (AI Router)** — the capture flow routes through
  `SMD_FUNDX_PROVIDERS.analyzeFindings(input, ctx) → RetinalFindings` (async). The registry
  seeds `mock` (active default, deterministic, non-diagnostic) plus isolated adapters
  `vertex-gemini`, `cerebras` (cloud; real `fetch` once `configure({endpoint, model})` is
  set), and `onnx`, `tflite` (on-device; lazy runtime+model once `configure({modelUrl,
  loader, infer})` is set). Connect a real provider with
  `SMD_FUNDX_PROVIDERS.configure(id, cfg); SMD_FUNDX_PROVIDERS.setActive(id)` — the router
  validates the response against the schema and falls back to `mock` on error/invalid
  output. UI + persisted `ScanRecord.vision` schema are unchanged. (The lower-level
  `SMD_FUNDX_VISION.registerRetinaModel` still exists for direct swaps.)
- **Image enhancement** — `SMD_FUNDX_ENHANCE.enhance(imageData, opts) → imageData` (pure,
  modular pipeline: reflection-suppress · denoise · gray-world WB · contrast/gamma ·
  unsharp). `registerEnhancer(impl)` swaps the whole enhancer (e.g. a super-resolution
  model). Produces the persisted **enhanced image**; the original is never mutated.
- **Live retina/disc/macula signals** — during acquisition these are simulated
  (`SimRetina`) so beginners reach Capture-Ready before a real fundus detector exists.
  Replace via `DetectorHub.setRetinaSignalProvider(fn)` or `makeHub({ mediapipe })`.
- **Eye/pupil/distance detector** — `makeMediaPipe()` behind the hub; any adapter whose
  `analyze()` returns the same partial replaces it. See
  `assets/vendor/mediapipe/README.md` to vendor MediaPipe locally (offline / no CDN).
- **Storage** — `FundxStore.configure(deps)` injects `{ localStorage, filesystem,
  isNative }`; a cloud-sync backend can wrap it later (hook reserved).

## Data contracts

- `FrameAnalysis` — normalized per-frame observation (`makeFrameAnalysis`).
- `QualityScore` — `{ overall(0-100), subscores, accepted, reasons[] }`, versioned.
- `RetinalFindings` (Findings.build) — `{ schemaVersion, engine:"vision", generatedAt,
  provider, modelVersion, quality, findings }`. **This is the stable Vision→Clinical
  contract.** `validate.findings()` enforces it.
- `ScanRecord` — persisted, nine mandated fields + audit: originalImage, processedImage,
  quality, acquisition, vision (versioned), patientContext, timestamp, device/app
  version, provider/model version, audit. `validate.scanRecord()` enforces presence.

## Clinical Engine (Phase C foundation)

`fundx-clinical.js` (`SMD_FUNDX_CLINICAL`) reasons over the Vision `RetinalFindings` JSON +
patient context → a structured, **advisory** `ClinicalAssessment` (severity · urgency ·
referral · follow-up · investigations · safety flags · missing-data · continuous confidence
· evidence trail). It never touches pixels and is **never a diagnosis**. The default is a
deterministic, evidence-based **rule engine** (real, non-placeholder: DR-grade proxy,
cup–disc ratio → glaucoma-suspect, disc-oedema → emergency, macular-oedema → urgent, etc.),
behind a provider seam identical to the Vision AI Router — register a richer LLM clinical
provider (`SMD_FUNDX_CLINICAL.register(impl); setActive(id)`) and the router validates +
falls back to rules on error/invalid output. Surfaced in the UI behind the nested flag
`smd_fundx_clinical` (**default OFF**; Settings toggle) on the Result + Detail screens.

## Phase C handoff / connecting real AI

The engine boundaries are versioned JSON, so real intelligence connects without any UI or
contract change:
- **Retinal inference** → `SMD_FUNDX_PROVIDERS.configure("vertex-gemini", {endpoint, model});
  setActive("vertex-gemini")` (or `cerebras`/`onnx`/`tflite`).
- **Clinical reasoning** → register an LLM-backed clinical provider on `SMD_FUNDX_CLINICAL`.
Both need external credentials / a backend endpoint / trained model weights — that is the
only remaining blocker; everything up to that seam is complete and tested.

## Testing

`npm test` runs headless (Node, no browser):
- `test/fundx.test.mjs` — engine (alignment/readiness/state-machine/quality/best-frame/
  mock-model/findings/validation), store round-trip, flag gating, capture processing +
  9-field ScanRecord build, ICU-integration + training-mode source guards.
- `test/fundx-detect.test.mjs` — heuristic pixel math, sim-retina progression, hub merge.

**Not headless-testable** (verify on a real device): live camera (`getUserMedia`),
MediaPipe eye/pupil detection, and on-device coaching/haptics/voice. To verify:
open `?fundx=1` on a phone, Home → Retinal Scan → Start guided capture; the reticle
readiness ring + coaching should respond to a real (or model) eye, and auto-capture
fires when readiness holds.

## Known limitations (MVP)

- Retinal detection defaults to a swappable **mock** provider; disc/macula/red-reflex live
  signals are proxies, not true detection (see design Deviations log). Real providers
  connect through the AI Router (above) with no UI/contract change.
- MediaPipe loads from CDN unless vendored locally.
- Voice coaching (TTS) is Web-Speech, off by default; reliable iOS TTS is a fast-follow.
- No cloud sync (local-only by design).
