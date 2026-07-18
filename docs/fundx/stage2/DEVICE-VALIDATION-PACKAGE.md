# FundX AI — Stage 2 Real Device Validation Package

**Purpose.** Systematically verify FundX **runs and captures correctly on real iOS and Android
hardware** — the gate before any human-factors or clinical testing. This is **technical
compatibility only** (does the camera open, does guidance render, does auto-capture fire, is the
image saved, is nothing leaked). No clinical judgement of the image happens here (that is Stage
5). No new features are added — this package only measures.

**Reference:** `docs/fundx/VALIDATION-PROGRAM.md` §Stage 2. Intended use is **advisory-only, for
qualified healthcare professionals** — do not expand scope.

**Companion artifacts (print these):**
- `SESSION-TEST-SHEET.md` — one printable sheet per device/session (item 9).
- `BUG-REPORT.md` — one per defect found (item 10).

**Gate to advance to Stage 3:** every matrix device passes the acceptance criteria below;
**zero P0 (safety/data) bugs open**; camera released on background on 100% of devices;
≥ 15 fps guidance on target devices.

---

## 0. How to set up a test device (do once per device)

FundX camera + MediaPipe + motion sensors require the **native Capacitor build** (iOS
TestFlight/dev, Android debug APK) — a plain mobile browser will not exercise the real WebView
camera path, and the production `/api/*` **coming-soon gate** only opens for the native app
(`X-SMD-App`) or a `/realapp` browser cookie.

1. Install the current native build on the device. Record **build/app version** and **OS
   version** on the session sheet.
2. Confirm native permissions are declared in the build (pre-flight §1): camera usage string,
   motion usage string.
3. Open the app → enable FundX: append `?fundx=1` to the URL, or Settings → enable FundX.
4. **Settings → turn ON:** Telemetry (`smd_fundx_telemetry`), Developer overlay
   (`smd_fundx_dev`; or open with `?fundxdev=1`). Set **Sensitivity = med** (default) unless a
   test says otherwise.
5. Leave **Lens-confirm fallback OFF** (`smd_fundx_lens_confirm`, default OFF) — it is not part
   of the standard path.
6. For telemetry/JSON export, connect a remote inspector: **iOS** = Safari → Develop → *device*
   → Web Inspector; **Android** = `chrome://inspect`. The dev overlay's **Export frames** button
   downloads the per-frame CSV on-device.
7. Prepare a **model eye** (or printed fundus target) for artefact-free repeatable runs, plus a
   consenting volunteer only where the sheet calls for a live eye.

Enable/read reference:

| What | How |
|---|---|
| FundX on | `?fundx=1` / `localStorage.smd_fundx="1"` / Settings |
| Dev overlay + frame CSV | `?fundxdev=1` / Settings; **Export frames** button → `fundx-dev-<ts>.csv` |
| Telemetry | Settings toggle; `SMD_FUNDX_TELEMETRY.summary()` / `.export()` (JSON) via inspector |
| Sensitivity | Settings low/med/high (`smd_fundx_sens`, default med) |
| Cloud findings | health-gated auto-activation on open (`GET /api/fundx/health`); consent prompt once |

---

## 1. Pre-flight checklist (before touching a patient)

Do this once per device, before the test cases. All must be ✅ to proceed.

- [ ] Correct **native build + version** installed; version recorded.
- [ ] OS + device model recorded (matches a matrix row in §2).
- [ ] Build declares **camera** permission usage string (iOS `NSCameraUsageDescription`).
- [ ] Build declares **motion/orientation** usage string (iOS `NSMotionUsageDescription`) — for the rotate/level cue.
- [ ] MediaPipe assets load from the **local vendored** copy (works with network off) — see §2.
- [ ] Device **battery ≥ 50%**, not charging (thermal test needs a clean baseline), **not in Low Power Mode**.
- [ ] Device **storage** free for saved scans.
- [ ] FundX flag ON; **Telemetry ON**; **Dev overlay ON**; Sensitivity = med; Lens-confirm OFF.
- [ ] Remote inspector connected and `SMD_FUNDX_TELEMETRY` reachable.
- [ ] `GET /api/fundx/health` reachable from the device and returns `ok:true` (for the cloud-activation checks); provider state noted.
- [ ] Clean telemetry: run `SMD_FUNDX_TELEMETRY` reset/note the session count so this device's runs are isolatable.
- [ ] Model eye / fundus target ready; consent obtained for any live-eye run (per IEC/DPDP).
- [ ] Session sheet printed and headers filled in.

---

## 2. Device compatibility checklist (iPhone + Android)

Run per device. Target matrix (minimum):

| Tier | iOS | Android |
|---|---|---|
| Flagship | iPhone 15/16 Pro | Pixel 8/9, Galaxy S23+ |
| Mid | iPhone SE / 12 | Mid Snapdragon (e.g. Galaxy A-series) |
| Budget | — | Low-RAM Android (MediaPipe stress) |

Per device, all must pass:

- [ ] App loads in the WebView; FundX entry (Home "Retinal Scan" tile / ICU Records → FundX) opens the overlay.
- [ ] Camera opens the **rear** camera (not front/selfie).
- [ ] Live preview renders **inline** (no fullscreen video takeover, no black rectangle). *(iOS `playsinline`/`allowsInlineMediaPlayback`.)*
- [ ] Preview is upright and correctly oriented in portrait; rotating the device does not break the overlay.
- [ ] **MediaPipe loads locally** (turn network OFF and reopen): eye/pupil/distance cues still update. If MediaPipe cannot load, heuristic-only coaching still guides (no crash).
- [ ] Device-orientation (roll) permission prompt appears once (iOS 13+); after granting, the rotate/level cue works. If denied, the level gate is a **no-op** (never blocks capture).
- [ ] Guidance loop is smooth — **≥ 15 fps** (read fps from the dev overlay; confirm with Instruments/Profiler).
- [ ] A capture on the model eye **saves a scan** with all persisted fields (original + enhanced image, metrics, metadata, provider/model version, audit).
- [ ] **Lifecycle:** background the app mid-scan → camera **releases** (LED/preview stops); resume re-acquires; incoming call / lock screen do not wedge the camera.
- [ ] No crash, white-screen, or unrecoverable freeze during a full session.

Acceptance: **100% of the above per device**, across the whole matrix.

---

## 3. Camera permission checklist

- [ ] First open triggers the OS **camera permission** prompt.
- [ ] **Grant** → preview starts within a few seconds; rear camera; no black frame.
- [ ] **Deny** → a clear in-app message explains camera is required + how to enable in Settings; app does **not** hang or crash; retry works after enabling.
- [ ] Revoke permission in OS Settings mid-life → app detects loss gracefully on next open (message, no crash).
- [ ] Backgrounding releases the camera (`visibilitychange`); returning re-requests/re-acquires cleanly.
- [ ] No second app can be seen holding the camera after FundX is backgrounded (torch/LED off).
- [ ] Motion/orientation permission (iOS) prompt behaves the same: grant → rotate cue; deny → level gate skipped, capture unaffected.

Acceptance: grant path works; **deny + revoke paths fail safe** (message, no crash, no stuck camera).

---

## 4. Lens compatibility checklist (20D / 28D — power-agnostic)

FundX is **power-agnostic by design**: it never identifies or requires a specific lens power and
never shows a "lens detected/lens power" prompt. This checklist confirms capture works with
whatever indirect condensing lens the clinician uses.

- [ ] Capture succeeds with a **20D** lens (or the site's standard) — no configuration change.
- [ ] Capture succeeds with a **28D** lens (if available) — **no configuration change, same build/settings**.
- [ ] **No lens-power prompt** ever appears; the workflow never blocks waiting for "lens detected".
- [ ] Guidance (working-distance / centering / rotate cues) adapts to the lens without a mode switch.
- [ ] Optional operator-confirm fallback stays **OFF**; if deliberately enabled for a stall test, it only *offers* after a stall and never bypasses the quality gate — then turn it back OFF.
- [ ] Field-of-view differences between lenses do not cause **false captures** (verify saved images are genuinely of the fundus, not a bright reflex/partial field).

Acceptance: capture works across the tested lenses **with no config change and no lens prompt**;
per-lens gradeability is judged later in Stage 5 (here we only confirm the pipeline fires).

---

## 5. Test cases

Run each on the model eye first (repeatable), then on a live eye where the sheet allows.
Record telemetry (§6) for every run. Each test lists its acceptance criteria and the CFG gate it
exercises. **CFG defaults referenced:** `focusMin 0.55`, `exposureMin 0.50`, `reflectionMax 0.40`
(glare), `motionMax 0.35`, `diagnosticMin 0.62`, `captureReadiness 0.85`, `readySustainFrames 6`.

### D2-ACQ — Image acquisition
- **Objective:** camera path produces live frames and a saved scan.
- **Steps:** open FundX → start guided capture on the model eye → let it run to auto-capture → review the saved scan.
- **Acceptance:** rear camera live preview inline; frames flow at ≥ 15 fps; on capture a scan is saved with original **and** enhanced image + metrics + metadata + provider/model version + audit (all persisted fields present). No crash.
- **Telemetry:** `meta.device`, `steps` timeline, `captureMs`, `outcome=captured/saved`.

### D2-OVL — Guidance overlay
- **Objective:** the coaching overlay renders and progresses through the real state machine.
- **Steps:** slowly move from "not on eye" → onto the model eye; watch the overlay cues and state.
- **Acceptance:** overlay shows live cues; state advances through `searching_eye → centering_pupil → working_distance → red_reflex → locating_fundus → optimizing → assessing_quality → ready`; directional cues (move closer/back, centre, **rotate cw/ccw**, hold steady, reduce glare) appear and are legible; no overlapping/garbled UI; dev overlay metrics update live.
- **Telemetry:** `steps` (state timeline), `trace` (readiness/diagnostic progression), corrections count.

### D2-FOC — Autofocus
- **Objective:** the camera focuses and the focus gate reflects sharpness.
- **Steps:** present a sharp target, then defocus (move closer/farther); watch the focus metric.
- **Acceptance:** image visibly sharpens; the dev-overlay **focus** metric rises above `focusMin 0.55` when sharp and drops when blurred; no permanent focus hunting/oscillation that blocks capture; capture only fires when focus is adequate.
- **Telemetry:** dev-frame CSV `focus` column across the run; `rejectReasons` including focus when blurred.

### D2-EXP — Exposure
- **Objective:** exposure is controlled and gated.
- **Steps:** run under normal room light, then dim, then bright; watch the exposure metric.
- **Acceptance:** preview is neither fully blown-out white nor black across conditions; the **exposure** metric stays within/returns to the acceptable band (gate `exposureMin 0.50`); capture is withheld when exposure is out of range; recovers when lighting normalises.
- **Telemetry:** dev-frame CSV `exposure`; `rejectReasons` including exposure.

### D2-GLR — Glare / reflection
- **Objective:** specular glare is detected and blocks bad captures.
- **Steps:** introduce a bright reflection (window/lamp) onto the lens/eye; then remove it.
- **Acceptance:** a **glare/reduce-reflection** cue appears when specular fraction is high; auto-capture is **refused** while glare exceeds `reflectionMax 0.40`; once glare is removed, the gate clears and capture can proceed; a glare-heavy frame is **never** saved as good.
- **Telemetry:** dev-frame CSV `reflection`; `rejectReasons` histogram (expect high glare count); corrections churn.

### D2-MOT — Motion / steadiness
- **Objective:** motion is detected and fleeting good frames don't trigger a capture.
- **Steps:** hold steady, then deliberately shake; watch the motion cue and capture behaviour.
- **Acceptance:** a **hold-steady** cue appears on shake; capture is withheld while motion exceeds `motionMax 0.35`; a brief accidental "good" frame does **not** auto-capture (the `readySustainFrames 6` sustain window holds); best-frame selection over the burst avoids motion-blurred saves.
- **Telemetry:** dev-frame CSV `motion`; `trace` showing readiness dropping on shake; `rejectReasons` motion.

### D2-CAP — Capture success (end-to-end)
- **Objective:** the composite quality gate fires correctly and only on adequate views.
- **Steps:** (a) present a good view on the model eye → expect capture; (b) present clearly inadequate views (small-pupil sim, cover the eye, point at a wall/skin decoy) → expect **no** capture.
- **Acceptance:** (a) auto-capture fires when `diagnosticScore ≥ 0.62` **and** overall readiness ≥ `0.85` sustained for `readySustainFrames 6`; scan saved. (b) **0% false-capture** on the decoy/inadequate views; the engine coaches and refuses rather than saving garbage; never stalls waiting for a lens.
- **Telemetry:** `outcome`, `qualityAtCapture`, `captureMs`; for (b) `outcome≠captured` + `rejectReasons`.

---

## 6. Telemetry to record (every run)

All PHI-free; images/clinical data are **not** in telemetry (they live in the consented study
record). Capture at minimum:

**Per session — `SMD_FUNDX_TELEMETRY` (export JSON via inspector, or `summary()` rollup):**
- `meta`: device, appVersion, provider, sensitivity, eye
- `steps`: state-transition timeline (which states, timestamps)
- `trace`: [overall readiness %, diagnostic %] progression
- `outcome`: captured / capture_failed / saved / superseded
- `captureMs`: time to capture
- `qualityAtCapture`: post-capture score
- `rejectReasons`: coded acquisition-quality rejections (focus/exposure/glare/motion/…)

**Per session — dev frame recorder (`fundx-dev-<ts>.csv` via Export frames):**
- per-frame: fps/frame-ms, state, focus, exposure, reflection(glare), motion, fundus,
  vessels, redReflex, diagnostic, readiness.

**Rollup — `SMD_FUNDX_TELEMETRY.summary()`:** captureRate, median captureMs, rejection histogram.

**Device-level (external tools, not in app):** fps, memory growth, thermal state, battery drain
— Xcode Instruments (iOS) / Android Profiler.

**Backend (for cloud-activation checks):** `GET /api/fundx/health?metrics=1` → per-provider
count/errors/errorRate/avgLatencyMs/tokens/costUsd.

Attach the exported JSON + CSV filenames to the session sheet.

---

## 7. Bugs to watch for (device-specific)

**iOS / WKWebView**
- Preview goes **fullscreen** or shows a **black rectangle** (inline-video attributes missing).
- Camera **not released** on background → LED stays on, battery/thermal drain.
- DeviceOrientation permission **never prompts** → no rotate/level cue (should degrade, not block).
- **Export frames** Blob download fails silently on WKWebView (note if the native share/save path is needed).
- Autofocus **hunting** on some models; front camera opened instead of rear.

**Android**
- **Front camera** selected instead of rear; wrong aspect/rotation.
- Autofocus stuck in continuous mode / never locks; exposure **oscillation** under fluorescent light.
- **MediaPipe fails to load** (CDN blocked, WebView version) → eye/pupil cues gone.
- **Low-RAM jank / OOM**; frame rate collapses under MediaPipe.
- WebView version differences change getUserMedia behaviour.

**Both / functional**
- **False capture** on glare or decoy (saving a non-fundus/blown frame as good) — **P0**.
- Stuck in a state / never reaches `ready` on a clearly adequate view (**stall**).
- Telemetry not recording, or `meta.device` blank.
- Cloud provider **not auto-activating** when `/health` says available (or activating without consent) — check the consent prompt fired once.
- Saved scan **missing a persisted field** (enhanced image, provider/model version, audit).
- **Any PHI in telemetry** (image, identifier, finding) — **P0, stop immediately.**
- **API key / secret** visible anywhere on device (network log, response, console) — **P0, stop.**

Log every occurrence with `BUG-REPORT.md`. Classify severity: **P0** = safety/data (false
capture, PHI/secret leak, crash-loss); **P1** = blocks a test on a target device; **P2** =
degraded UX; **P3** = cosmetic.

---

## 8. Acceptance criteria (Stage 2 exit)

Per device *and* across the matrix:

| Area | Pass threshold |
|---|---|
| Device compatibility | Capture completes on model eye on **100%** of matrix devices |
| Inline preview + rear camera | 100% of devices |
| MediaPipe local load **or** graceful fallback | 100% |
| Camera released on background | 100% (no stuck camera / drain) |
| Guidance frame rate | **≥ 15 fps** sustained on target devices |
| Per-frame processing | ≤ 33 ms median (mid-tier) |
| Autofocus / exposure / glare / motion gates | behave per D2-FOC/EXP/GLR/MOT acceptance on 100% of devices |
| False-capture (decoy/inadequate) | **~0%** |
| Saved-scan integrity | all persisted fields present, 100% |
| Crashes / white-screens | **0** |
| PHI in telemetry / secret exposure | **0** (P0 gate) |
| Memory / thermal over a 10-capture session | no leak, no thermal shutdown |

**Blockers to Stage 3:** any device that can't open the camera / render inline / capture on a
model eye / release the camera on background; sub-15-fps guidance on a target device; **any open
P0**. All must clear before human-factors (Stage 3) begins.

---

*This package prepares FundX for systematic real-world device validation. It adds no features
and changes no application behavior. Flag `smd_fundx` remains OFF for end users; testing runs on
whitelisted validation builds only.*
