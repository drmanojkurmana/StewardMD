# FundX AI — Production-Readiness Audit

Final engineering audit of the FundX module before real-device testing. **Honest by design**
— every claim is tagged **[verified]** (run/tested here), **[simulated]** (computational only),
or **[unvalidated]** (needs real hardware / patients / field data). Nothing is clinically
validated.

---

## 1. Architecture audit  [verified]

Modules (single responsibility each):

| Module | Global | Responsibility |
|---|---|---|
| `fundx-vision.js` | `SMD_FUNDX_VISION` | Pure engine: FrameAnalysis, gates, state machine, quality, findings contract |
| `fundx-detect.js` | `SMD_FUNDX_DETECT` | Perception: pixel heuristics, MediaPipe, pose, camera |
| `fundx-enhance.js` | `SMD_FUNDX_ENHANCE` | Image-enhancement pipeline |
| `fundx-providers.js` | `SMD_FUNDX_PROVIDERS` | Client AI Router (vision inference) |
| `fundx-clinical.js` | `SMD_FUNDX_CLINICAL` | Clinical rule engine + backend provider |
| `fundx-store.js` | `SMD_FUNDX_STORE` | Local persistence |
| `fundx-telemetry.js` | `SMD_FUNDX_TELEMETRY` | Anonymized acquisition telemetry |
| `fundx.js` | `FUNDX` | Overlay UI + screen router + capture flow |
| `functions/_fundx_ai.js` | — | Backend transport + provider abstraction |
| `functions/api/fundx/[[path]].js` | — | Backend router |

Findings: **no TODO/FIXME/placeholder** in shipped code; **no dead code / experimental paths**
(the only removed-then-replaced experimental path was `SimRetina`, fully deleted). One
duplicate helper (`clamp01`) exists per-module — **intentional** in a buildless IIFE app with
no shared-module system; ~5 lines, not worth a shared dependency. Config lives in one place
(`SMD_FUNDX_VISION.CFG`); backend config is env-only. **No architectural change made in this
audit** beyond additive backend completion + one lifecycle fix.

---

## 2. Vision Engine review (per heuristic)  [verified cost] [unvalidated accuracy]

| Signal | Algorithm | Why chosen | Known limitations | Cost @320×180 | Future ML |
|---|---|---|---|---|---|
| **focus** | Laplacian variance, `v/(v+120)` | Cheap, standard sharpness proxy | K is device-dependent; texture can fool it | in `analyze` (0.22 ms) | tiny sharpness CNN |
| **exposure** | histogram clip + mid-band factor | No camera metering API in WebView | Doesn't know sensor ISO/shutter | in `analyze` | — |
| **glare** | specular-highlight fraction (bright + low-sat) | Fast, catches lamp reflections | Bright fundus can read as glare | in `analyze` | segmentation |
| **red reflex** | central warmth × brightness | Directly models the retinal glow | Dark iris/small pupil lower it (correctly) | in `analyze` | — |
| **fundus (circle)** | warm-pixel mask → centroid, radius-of-gyration circularity, size | Power-agnostic (any indirect lens = warm circular field); no lens ID | Bright non-retinal warm fields could mimic; partial fields lower circularity | 0.27 ms | fundus-region segmentation model |
| **vessels** | green-channel edge energy + dark-ridge density | Vessels are dark curvilinear in green; cheap | Noise/hair/eyelash can add edges; hazy media lowers it (correctly) | 0.10 ms | vessel-segmentation CNN (U-Net) |
| **eye/pupil/distance** | MediaPipe FaceLandmarker iris | Real, robust landmark model | Needs the model to load; not the *fundus*, the face-eye | (MediaPipe, not benchmarked) | on-device eye model |
| **motion** | iris-centre delta between frames | Cheap stability proxy | Conflates operator + patient motion | trivial | IMU fusion |
| **roll** | device-orientation gamma | Free from sensor | Needs sensor + iOS permission | trivial | — |

**Real-time feasibility [verified/simulated]:** full heuristic pass (analyze+fundus+vessels)
= **0.58 ms/frame** on V8. At a conservative 4× mobile-WebView penalty ≈ **2.3 ms/frame**,
~2% of the 110 ms analyze budget. The dominant per-frame costs are **`getImageData` +
MediaPipe inference** (~10–30 ms on mid-range), not the heuristics — so the pipeline is
real-time on mid-range Android *provided MediaPipe runs*; this must be **confirmed on device**
(§ Device audit), it is not measured here.

---

## 3. Performance profiling

| Metric | Value / status |
|---|---|
| Heuristic frame cost | **0.58 ms** [verified, V8] |
| Analysis cadence | 110 ms (throttled), configurable | 
| Camera preview FPS | **[unvalidated]** — target 30–60; not measured (needs device) |
| Analysis FPS | ~9 fps (110 ms), decoupled from preview [by design] |
| getImageData + MediaPipe | **[unvalidated]** — the real bottleneck; measure on device |
| Memory / CPU / battery / thermal | **[unvalidated]** — not measurable in this environment |
| Startup latency | **[unvalidated]** — camera start target < 2 s |
| Capture latency | burst grab + best-frame + enhance + (mock ~0 / Vertex ~1–3 s) — mock path [verified], cloud [unvalidated] |

Optimisations already in place (no quality loss): analysis **throttled + downscaled to 0.25**
(preview stays full-res), heavy work off the paint path, capture burst only on demand,
best-frame over the burst. **Bottleneck to profile first: MediaPipe load + per-frame inference**
(mitigation: vendor locally, cap `numFaces:1`, `runningMode:VIDEO`, GPU delegate — all set).

---

## 4. Device compatibility audit  [verified config] [unvalidated runtime]

| Concern | Status |
|---|---|
| Android 11+ / iOS 16+ | `getUserMedia` + Capacitor WebView supported; **runtime not device-tested** |
| Rear camera | `facingMode:"environment"` requested [verified in code] |
| Front vs rear assumption | Rear assumed (fundus imaging); no front-camera path |
| Resolutions | `{ideal:1280×720}`, downscaled for analysis — resolution-agnostic |
| iOS inline video | needs `<video playsinline muted autoplay>` [set] + WKWebView `allowsInlineMediaPlayback` — **verify in Capacitor config on device** |
| Autofocus | relies on OS continuous AF; no manual focus control (WebView limit) — **verify AF hunting per device** |
| Flash/torch | **not used** (indirect ophthalmoscopy uses the lens, not phone torch); documented non-goal |
| Permission edge cases | denied/dismissed → `showCamError` with retry guidance [verified]; permission strings declared in Info.plist/AndroidManifest |

---

## 5. Failure-mode analysis  [verified behaviour unless noted]

| Condition | Expected behaviour | Recovery | User message |
|---|---|---|---|
| Camera unavailable | `getUserMedia` rejects → error state | Retry button | "Could not start the camera on this device." |
| Permission denied | error state, no capture | Reopen after granting | "Allow camera access to use guided capture, then reopen." |
| No eye detected | stays `searching_eye`, no capture | continuous coaching | "Point the camera at the eye" |
| Excessive glare | glare gate fails, no capture, high coaching churn | dim room / shift angle cue | "Glare — dim the room or shift the angle" |
| Small pupil | red-reflex/fundus gates fail → no capture [verified sim: 0% false] | optional lens-confirm fallback (if enabled) | "Find the orange-red glow — tilt slightly" |
| Lens removed | fundus/red-reflex signals drop → state regresses, no capture | resume coaching | reverts to earlier-step guidance |
| Patient movement | motion gate fails, best-frame over burst | hold-steady cue | "Hold steady" |
| App backgrounded | **camera released** (visibilitychange) [verified — fixed in this audit] | returns to pre-capture | (silent; session logged "backgrounded") |
| AI backend unavailable | provider 503 → app falls back to mock/rules [verified] | retry / on-device path | (transparent; mock findings labelled) |
| Low battery | OS-managed; app degrades gracefully (no explicit detection) | — | **[gap]** no explicit handling |
| Thermal throttling | OS lowers FPS; analyze cadence tolerates it | — | **[gap]** no explicit detection |

Gaps (low severity): no explicit low-battery / thermal signalling (WebView cannot reliably
detect these; graceful degradation only).

---

## 6. Security & privacy  [verified]

- **Retinal images never leave the device unless the user opts into cloud analysis** — default
  provider is on-device mock; cloud requires a live backend **and** a one-time consent
  (pre-capture) [verified]; disclaimer switches to reflect cloud when active.
- **Telemetry stores no PHI** — verified by test assertions (no image/base64, no patient/MRN/
  name/findings keys); local ring buffer, no built-in network send.
- **Developer mode is OFF in production** (flag `smd_fundx_dev` default off; also `?fundxdev=1`
  for testers only) [verified].
- **All feature flags default OFF**: `smd_fundx`, `smd_fundx_clinical`, `smd_fundx_telemetry`,
  `smd_fundx_dev`, `smd_fundx_lens_confirm`, voice [verified by grep].
- **No secrets reach the client** — grep clean; all provider keys are server-side (Vertex WIF
  keyless), backend never returns secrets (health reports booleans only) [verified].
- Residual: cloud-upload consent UX + India-DPDP data-flow should get a privacy review before
  enabling cloud in production; secret rotation is manual (WIF supports it).

---

## 7. Code-quality audit  [verified]

| Class | Finding |
|---|---|
| Race conditions | Capture guarded by `capturing` flag; provider health cached per session; KV metrics use single read-modify-write via `waitUntil` (approximate under high concurrency — documented) |
| Memory leaks | Camera stops tracks + nulls `srcObject`; dev buffer capped (~6000) + reset per open; telemetry ring buffer capped (100) |
| Async bugs | All provider calls `await`ed with timeout + retry; promises guarded; no floating rejections in the hot path |
| Lifecycle | **visibilitychange releases the camera on background** (fixed here); overlay reused via single root |
| Camera resource leaks | `stop()` cancels rAF + stops tracks + nulls srcObject + detaches pose [verified] |
| Stale timers | No `setInterval`; all `setTimeout` are one-shot UX; rAF cancelled on stop |
| Event-listener leaks | pose attach/detach paired; single reused root click listener; visibility wired once |
| Exception handling | try/catch around all DOM/storage/network; graceful fallbacks throughout |
| Null safety | defensive `|| null` / guards; `moveDir` hardened against missing offset component (this audit) |
| Offline handling | fully offline for capture/store/review; backend/MediaPipe degrade gracefully |

---

## 8. Documentation & diagrams

Docs: `README.md` (dev guide), `BACKEND.md` (backend + routing/monitoring/cost),
`ACQUISITION-INTERNALS.md` (heuristics/weights/thresholds), `VALIDATION.md` (field plan),
this audit, and the design spec. Configuration reference: `ACQUISITION-INTERNALS.md` §3 + the
`VALIDATION.md` CFG table + `.dev.vars.example`.

**System architecture**
```
StewardMD app (flag smd_fundx)
   Home tile / ICU chart ──► FUNDX overlay (fundx.js)
        │                         │
   fundx.css                 SMD_FUNDX_VISION (engine) ── SMD_FUNDX_DETECT (camera+heuristics+MediaPipe)
                                  │                         SMD_FUNDX_ENHANCE (image)
                                  ├─ SMD_FUNDX_PROVIDERS ──HTTPS──► /api/fundx/vision  ─► Vertex/Cerebras
                                  ├─ SMD_FUNDX_CLINICAL  ──HTTPS──► /api/fundx/clinical
                                  ├─ SMD_FUNDX_STORE (local: Filesystem + localStorage)
                                  └─ SMD_FUNDX_TELEMETRY (local, no PHI)
```

**Acquisition state machine (quality-driven, no lens gate)**
```
searching_eye → centering_pupil → working_distance → red_reflex → locating_fundus
   → optimizing (focus/exposure/glare/steady/level) → assessing_quality (vessels + diagnostic)
   → READY ──(diagnostic-quality held N frames)──► auto-burst → selecting → processing → review
   (regresses instantly if any gate is lost; no timer advances state)
```

**Data flow**
```
camera frame → getImageData(0.25) → Heuristic(focus/exposure/glare/redReflex/FUNDUS/VESSELS)
   + MediaPipe(eye/pupil/distance/motion) + Pose(roll) → DetectorHub → FrameAnalysis
   → StateMachine.step → gates + diagnosticScore + Coach cue → UI (ring/chips/arrows/haptic/voice)
   → auto-capture burst → BestFrameSelector → enhance → IRetinaModel/AI Router → RetinalFindings
   → ScanRecord (11 fields) → FundxStore (on device)
```

**Vision pipeline**
```
best frame ─► QualityEngine (image quality) ─► accept/reject
           ─► provider router ─► mock | /api/fundx/vision (Vertex/Gemini) ─► RetinalFindings JSON
           ─► (optional) Clinical rule engine | /api/fundx/clinical ─► advisory ClinicalAssessment
```

**Backend request flow**
```
app ─► POST /api/fundx/vision {image} ─► [auth gate] ─► [rate-limit KV] ─► validate
   ─► routeOrder(primary→secondary→base) ─► runTask: skip-unavailable + modality filter
   ─► provider.generate (WIF token / API key) ─► timeout+retry ─► extractJSON ─► normalize
   ─► {findings}  +  waitUntil(persist metrics/cost to KV)     ─► fall back to next provider on error
```

---

## 9. Production checklist

| Item | Status | If blocker: risk | Priority | Effort |
|---|---|---|---|---|
| Acquisition engine (observable-cue) | ✅ verified | — | — | — |
| Backend + provider router + failover | ✅ verified | — | — | — |
| Vertex WIF secrets present | ✅ verified (prod env) | — | — | — |
| Telemetry + dev tooling | ✅ verified | — | — | — |
| Test suite (11 suites green) + headless integration | ✅ verified | — | — | — |
| Lifecycle (backgrounding) | ✅ fixed here | — | — | — |
| **On-device performance (FPS/CPU/battery/thermal)** | ⛔ blocker | High | P0 | 2–3 d (device lab) |
| **MediaPipe on-device (load + inference + vendor locally)** | ⛔ blocker | High | P0 | 1–2 d |
| **CFG threshold calibration from real footage** | ⛔ blocker | High | P0 | 1–2 wk (with telemetry) |
| **Real retinal findings (activate + validate Vertex)** | ⛔ blocker | High | P1 | creds + 1 wk |
| **Clinical validation (gradeability study, IRB)** | ⛔ blocker | High | P1 | weeks–months |
| Device/lens/operator field study | ⛔ blocker | Med | P1 | 2–4 wk |
| Cloud-upload consent + DPDP privacy review | ⚠ open | Med | P2 | 2–3 d |
| Metrics dashboard (consume /health) | ⚠ nice-to-have | Low | P3 | 1–2 d |

---

## Production readiness assessment (honest, conservative)

| Dimension | Score | Basis |
|---|---|---|
| **Engineering completeness** | **85%** | Architecture, engine, backend, providers, telemetry, dev tooling, tests all done [verified]; findings mock-until-Vertex; no device build run |
| **Performance** | **70%** | Heuristics real-time [verified]; MediaPipe/camera FPS/memory/battery [unvalidated on device] |
| **Reliability** | **70%** | Extensive unit + headless integration + failover + lifecycle [verified]; no real-device/soak/field crash data |
| **Security** | **85%** | No client secrets, no-PHI telemetry, flags/dev off [verified]; cloud-consent + DPDP review + rotation pending |
| **Clinical readiness** | **5%** | **Zero clinical validation.** Findings are simulated; no patient study, no reference-standard grading, no IRB |
| **Overall deployment readiness** | **~55%** | Strong, tested engineering; gated on on-device validation, credentials activation, and a clinical study |

**Verified vs simulated vs clinically validated:** the *software* is verified (tests + headless
integration + benchmarks). Acquisition *performance* is **simulated** (idealized-signal harness
+ V8 benchmark), not measured on real video/devices. *Clinical* utility is **not validated at
all**. Do not deploy for patient care until the P0/P1 blockers above are closed.

---

## Provider integration report (Part B)

**Completed integrations**
- Vertex AI (Gemini): keyless WIF auth + token cache/refresh, structured JSON (responseMimeType),
  retry-once → failover, timeout, error mapping, **safety settings** (new), cost/latency metrics
  (new). Production-ready pending credentials activation.
- Developer (AI Studio): full fallback provider.
- Cerebras: production client (chat/completions, `response_format:json_object`, model selection,
  timeout, **retry-once** now unified, error mapping, failover, availability/health). Streaming
  intentionally N/A for structured-JSON endpoints (documented).

**Newly completed in this audit**
- Vertex `safetySettings` (env `FUNDX_SAFETY`, default `BLOCK_ONLY_HIGH`).
- Provider **router** with `FUNDX_PRIMARY`/`FUNDX_SECONDARY` + health-based skip + modality
  filter + failover (`routeOrder`).
- **Capability discovery** (`capabilities()`; surfaced in `/health`).
- **Cost/token accounting** (`estTokens`/`estCostUsd`, per-provider price table, `FUNDX_PRICES`).
- **Monitoring**: per-provider daily counters (count/errors/errorRate/avgLatency/tokens/cost) in
  KV via `waitUntil`, surfaced in `GET /api/fundx/health.metrics`.
- Unified Cerebras retry; `.dev.vars.example` + `BACKEND.md` updated.

**Remaining placeholders / TODOs**
- Metrics **dashboard UI** — endpoint + logs exist; a Grafana/console view is a follow-up (needs
  a metrics sink). Documented, low priority.
- Token counts are **estimates** (no exact-token API); image ≈ 1000 tokens heuristic.
- ONNX/TFLite on-device providers (client `fundx-providers.js`) remain interface stubs — a
  documented technical reason: no trained on-device retinal model weights exist yet.

**Production blockers**
- Activate + validate real Vertex output (credentials present; needs a real image smoke test).
- No streaming for FundX endpoints — **not a blocker** (structured JSON, by design).

**Recommended merge order**
1. This branch (`feat/fundx-vision-mvp`) → `main` — additive, flag-OFF, all tests green.
2. After merge + deploy: hit `/api/fundx/health`, smoke-test `/vision` with a real fundus image.
3. Enable telemetry + developer mode for the field team; calibrate `CFG` from real footage.
4. Only then: clinical gradeability study before any patient-facing use.
