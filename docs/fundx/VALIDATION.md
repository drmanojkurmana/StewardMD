# FundX AI — Acquisition Validation Plan

Scope: validate the FundX acquisition pipeline (Vision Engine) for real-world use. The
acquisition **architecture is frozen** (observable optical/image-quality cues, no lens
detection); this plan does not change it — it measures it and defines acceptance.

## What is executed here vs. what needs field execution

| Part | Status |
|---|---|
| Engine-level computational validation (`test/run-fundx-validation.mjs`) | **Executed** — real numbers below |
| Anonymized telemetry to capture field data (`fundx-telemetry.js`) | **Built** (flag `smd_fundx_telemetry`, off) |
| CFG threshold-calibration analysis | **Executed** (baseline) + field-tune method |
| Operator, device, lens, clinical, robustness testing | **Protocol provided** — requires devices, real operators, real patients + ethics/consent. Cannot be executed in this environment; run per the protocols below. |

---

## 1. Acquisition Performance

**Metrics:** time-to-first-successful-capture (median + IQR), success rate, guidance
corrections per session, auto-capture accuracy, false-capture rate, missed-capture rate.

**Executed (engine simulation — `node test/run-fundx-validation.mjs`, 400 sessions/scenario,
~20 s budget, seeded).** These validate gating *logic* + threshold *separation*, not
real-world rates:

| Scenario | Adequate? | Capture % | Median time | Median corrections |
|---|---|---|---|---|
| Skilled, normal eye | yes | 100% | 2.9 s | 1 |
| Junior doctor | yes | 100% | 4.0 s | 2 |
| Nurse | yes | 100% | 5.1 s | 3 |
| First-time beginner | yes | 100% | 7.4 s | 6 |
| Dark iris (marginal reflex) | yes | 100% | 8.0 s | 8 |
| Hand shake | yes | 100% | 6.7 s | 3 |
| Small pupil | **no** | **0% false-capture** | — | 2 |
| Media opacity / cataract | **no** | **0% false-capture** | — | 2 |
| Bright room / glare | **no** | **0% false-capture** | — | 38 |
| Not on the eye (decoy) | **no** | **0% false-capture** | — | 0 |

Interpretation: the quality gate captures all *adequate* trajectories and refuses all
*inadequate* ones (0% false-capture, including the decoy), and never stalls waiting for a
lens. Glare produces high correction churn (38) — a real UX signal to prioritise glare
guidance. Real-world numbers will be lower/noisier — that is what the field protocol measures.

**Field protocol.** Instrument every session with telemetry (§8). Report: success rate,
median/IQR time-to-capture, corrections, and auto-capture accuracy = (captures that a
grader deems ≥ adequate) / (all auto-captures). False capture = auto-capture graded
inadequate. Missed = adequate view present > 15 s but no auto-capture. Target ≥ 200 sessions.

---

## 2. Operator Experience

**Cohorts (n ≥ 5 each):** complete beginner (no clinical background), nurse, junior doctor,
ophthalmologist (expert reference).

**Protocol.** 2-minute standard instruction video → 10 supervised acquisitions on a model
eye, then 10 on consenting volunteers (both eyes). Same device + lens across a cohort.

**Measures:** learning curve (success rate over attempts 1–10), time-to-first-successful
capture, common failure modes (coded from telemetry rejection reasons + observer notes), UI
confusion points (think-aloud + a post-task SUS questionnaire). Expert cohort sets the
"experienced-user" ceiling.

**Acceptance (per §9):** first-time users > 80% success after instruction; trained users
(nurse/junior after the 20-attempt warm-up) > 90%.

---

## 3. Device Validation

Test matrix — cover camera diversity (sensor, autofocus behaviour, torch, FOV):

| Platform | Suggested models |
|---|---|
| iPhone | SE (small sensor), 12/13 (mid), 15 Pro (multi-lens/telephoto) |
| Android | Pixel (6/8), Samsung A-series (budget) + S-series (flagship), a Xiaomi/Realme mid |

Per device record: camera start time, preview FPS stability, autofocus hunting, torch
availability, `getUserMedia` inline-video behaviour (iOS WKWebView `playsinline`), and the
success rate + median time for one trained operator (≥ 20 sessions each). Flag any device
where fundus/vessel/focus heuristics need per-device thresholds.

---

## 4. Lens Validation (power-agnostic)

**Goal:** confirm guidance works across indirect lenses **without identifying lens power.**
Test 20D, 28D, and (if available) 30D/40D condensing lenses, each by the same trained
operator on the same device (≥ 15 sessions/lens). **Pass = comparable success rate + no
lens-specific configuration**; the only expected difference is working-distance/field-size
(handled by distance + fundus-size cues, not lens ID). Confirm the app never asks for, or
branches on, lens power. (The optional operator-confirm fallback, §7, must remain off by
default and is not lens-power identification.)

---

## 5. Clinical Validation

**Requires ethics/IRB approval, informed consent, and a reference standard.** FundX
acquisition validation here = *image adequacy for the pathology*, not diagnostic accuracy
(that is Phase C / a separate study).

**Pathologies (target ≥ 15 gradeable eyes each where feasible):** normal, diabetic
retinopathy (mild→proliferative), diabetic macular oedema, glaucoma (large cup),
hypertensive retinopathy, papilloedema, AMD (drusen), CRVO/BRVO, CRAO/BRAO, plus
incidental (drusen, myelinated fibres).

**Reference standard.** For each captured image, two masked graders (retina specialists)
rate: (a) gradeability (adequate / borderline / ungradeable), (b) whether the relevant
pathology is visible in the captured field. **Primary endpoint: diagnostic-quality
(gradeable) rate ≥ target (§9), overall and per pathology.** Note pathologies that
systematically fail acquisition (e.g. media opacity from vitreous haemorrhage) — expected
and documented, not a defect.

---

## 6. Robustness Testing

Structured matrix; record success rate + median time + dominant rejection reason:

| Factor | Levels |
|---|---|
| Pupil | pharmacologically dilated · undilated (small) |
| Iris | light · dark |
| Media | clear · mild cataract · media opacity |
| Room light | dim (ideal) · normal · bright (glare) |
| Patient movement | still · fixating drift · non-cooperative |
| Operator hand | steady · tremor/shake |

Expected: small pupil / dense opacity / bright glare reduce success (engine sim shows these
are correctly *refused*, not falsely captured). The goal is graceful failure + useful
coaching, not capture at any cost. Bright-room glare is the top UX-churn factor (sim) — verify
the glare cue is clear and consider a torch/anti-glare tip.

---

## 7. Threshold Calibration — `SMD_FUNDX_VISION.CFG`

Baseline defaults (current) + acceptable operating ranges. Tune from field telemetry (§8):
raise a threshold if false-captures appear; lower it (or widen noise tolerance) if adequate
views are missed. **Priority = the ones marked ●** (most likely to need per-device/lens tuning).

| CFG key | Default | Range | Drives | Tune when |
|---|---|---|---|---|
| ● `diagnosticMin` | 0.62 | 0.55–0.72 | Auto-capture quality gate | ↑ if false-captures; ↓ if capable views never fire |
| ● `fundusMin` | 0.50 | 0.40–0.65 | Circular-fundus visibility | Per-device sensor/exposure differences |
| ● `fundusCircularityMin` | 0.45 | 0.35–0.60 | How circular the field must be | Wider lenses / partial fields |
| ● `vesselMin` | 0.40 | 0.30–0.55 | Vessel-structure presence | ↓ for hazy media; ↑ if noise passes as vessels |
| ● `redReflexMin` | 0.45 | 0.30–0.55 | Red-reflex gate | ↓ for dark irides / small pupils |
| `focusMin` | 0.55 | 0.45–0.70 | Sharpness gate | Per-camera autofocus behaviour |
| `exposureMin` | 0.50 | 0.40–0.65 | Exposure gate | Bright/dark rooms |
| `reflectionMax` | 0.40 | 0.25–0.55 | Glare tolerance | ↓ in glare-prone settings |
| `motionMax` | 0.35 | 0.25–0.50 | Steadiness | ↑ slightly for tremor tolerance |
| `pupilOffsetMax` | 0.22 | 0.15–0.30 | Centring tolerance | — |
| `rollLevelMax` | 18° | 12–25° | "Level" tolerance | Sensor availability/quality |
| `captureReadiness` | 0.85 | 0.75–0.92 | Overall gate composite | With `diagnosticMin` |
| `readySustainFrames` | 6 | 3–10 | Frames READY must hold | ↑ to reject fleeting good frames |
| `qualityAccept` | 60 | 50–70 | Post-capture accept score | Grader agreement |
| `stallFramesForFallback` | 90 (~10 s) | 60–150 | When the optional fallback may offer | UX preference |
| `lensConfirmFallback` | false | — | Optional operator-confirm | Keep **false** by default |

Method: with telemetry on, fit thresholds so that grader-adequate images ≈ engine captures
(maximise capture of adequate, keep false-capture < 5%). Persist per-device overrides if a
device diverges materially.

---

## 8. Telemetry (built)

`fundx-telemetry.js` (`window.SMD_FUNDX_TELEMETRY`), flag `smd_fundx_telemetry` **off by
default**, Settings toggle. **No PHI** — no images, no patient identifiers, no clinical
findings; only acquisition mechanics. Per session it records: guidance steps (state-transition
timeline), quality-score progression (readiness + diagnostic, thinned), capture
success/failure, acquisition time, guidance corrections, coded rejection reasons, and coarse
device/provider/sensitivity. Local capped ring buffer (last 100 sessions); `export()` returns
JSON for opt-in upload (no built-in network send, so it cannot leak). `summary()` gives
capture rate / median time / median corrections / rejection histogram for a QA dashboard.
Unit-tested (`test/fundx-telemetry.test.mjs`, incl. PHI-absence assertions).

---

## 9. Success Criteria (MVP acceptance)

Objective, pre-registered:

1. **Trained-user success ≥ 90%** (nurse/junior after the 20-attempt warm-up), auto-capture.
2. **First-time-user success ≥ 80%** after the 2-minute instruction.
3. **Median acquisition time ≤ 20 s** for trained users (stretch ≤ 12 s); ≤ 45 s first-time.
4. **False-capture rate < 5%** (auto-captures graded inadequate); **~0% on decoy/not-on-eye.**
5. **Diagnostic-quality (gradeable) rate ≥ 80%** of saved scans, by masked retina-specialist
   grading — the bar for downstream AI analysis.
6. **Lens power-agnostic:** ≥ 90% of trained-user success rate holds across 20D/28D with no
   configuration change and no lens-power prompt.
7. **No crashes / no PHI leakage**; graceful failure on inadequate media (coaches, never
   captures garbage).

Engine simulation meets the *logic* preconditions (100% adequate capture, 0% false-capture in
sim); criteria 1–6 are confirmed only by the field study above.

---

## Remaining technical risks (ranked by severity × likelihood)

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | Heuristic thresholds miscalibrated per device/lens → misses or false-captures on real hardware | High | High | Telemetry-driven CFG calibration (§7); per-device overrides; staged rollout |
| R2 | Fundus/vessel heuristics are approximations — may confuse a bright non-retinal field (glare, skin) for a fundus, or miss hazy real fundi | High | Med | Decoy test (sim = 0% false); combine fundus+vessel+red-reflex in the gate; grader audit of captures |
| R3 | Live camera / `getUserMedia` behaviour differs across WebViews (iOS WKWebView inline video, Android autofocus) | High | Med | Device matrix (§3); `playsinline`/`allowsInlineMediaPlayback` checks; fallback messaging |
| R4 | MediaPipe fails to load (CDN blocked/offline) → no eye/pupil/distance cues, coaching degrades | Med | Med | Vendor MediaPipe locally (`assets/vendor/mediapipe/`); heuristic-only still guides via fundus/red-reflex |
| R5 | Real retinal findings still mock until Vertex is live + validated; clinicians could over-trust the preview | High | Low (labelled) | Not-a-diagnosis labelling; findings only real via AI Router; clinical study before reliance |
| R6 | Phone-roll sensor absent/needs iOS permission → no rotate cue (level gate is a no-op, non-blocking) | Low | Med | Graceful: level gate skipped when roll unknown; request DeviceOrientation permission on start |
| R7 | Beginner frustration if guidance stalls in hard cases (small pupil/opacity) | Med | Med | Optional operator-confirm fallback (§7, off by default); clear "why" coaching; retake guidance |
| R8 | Cost/abuse once cloud inference is active | Med | Low | Backend rate-limit (`FUNDX_DAILY_LIMIT`) + auth gate; consent before cloud send |
| R9 | Motion blur under tremor passes focus intermittently → borderline captures | Med | Med | `readySustainFrames` sustain window; `motionMax`; best-frame selection over the burst |

Highest-priority pre-deployment work: **R1–R3** (on-device calibration + camera behaviour +
device coverage) — all addressed by executing §§1–7 on real hardware with telemetry on.
