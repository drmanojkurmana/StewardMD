# FundX AI — Product Validation Program (v1)

**Purpose.** Move FundX from *production software* to a *clinically validated product*. The
software engineering phase is complete and deployed (backend live, real Vertex vision +
clinical verified). No new features or providers are added by this program — it **measures,
grades, and gates**. The user-facing flag `smd_fundx` stays **OFF** for real users until the
Stage 10 beta gate is passed.

---

## 0. Scope, claim, and ground rules (read first)

### 0.1 Intended-use claim being validated (LOCKED)

> **FundX is an AI-assisted retinal image acquisition and clinical support tool for qualified
> healthcare professionals.** It helps clinicians capture retinal images, assess image quality,
> organize findings, and generate AI-assisted suggestions. The software is **advisory only**.
> It does not make autonomous diagnoses or treatment decisions, and it does not replace clinical
> judgment. A qualified clinician is responsible for reviewing all information and making the
> final clinical decision.

This is the **fixed** claim the whole program is sized against; it matches the shipped code
(every output carries `advisory:true` / "Not a diagnosis. Requires clinician review") and keeps
FundX in a **moderate-risk software-as-a-medical-device (SaMD)** posture. Two consequences
constrain every stage below:

- **Operators are qualified healthcare professionals** (e.g. nurses, junior/general doctors,
  optometrists) who may be **novices at retinal imaging** — *not* lay users. Usability testing
  targets that population (Stage 3).
- **No autonomous screening, diagnosis, or treatment.** The diagnostic-accuracy study
  (Stage 9 Tier 2) is **out of scope** and must not be run, advertised, or implied **without
  explicit written approval** to expand the intended use.

### 0.2 Regulatory / quality posture (ASSUMED)

Structured so the collected evidence can support **India CDSCO SaMD** notification and a later
CE/FDA path if desired. All human testing runs under an **ethics-committee (IEC/IRB)-approved
protocol** with informed consent and **DPDP-compliant** data handling
([[stewardmd-privacy-baseline]]). Adjust if your target is internal-quality-gate-only.

### 0.3 Two-tier clinical validation

| Tier | Validates | When | Gates |
|---|---|---|---|
| **Tier 1 — Gradeability** (core MVP claim) | Can a non-expert capture a retina-specialist-**gradeable** image? Are advisory findings safe (labelled, clinician-reviewed)? | Now | Stages 1–8 + Stage 9-T1 |
| **Tier 2 — Diagnostic accuracy** (OUT OF SCOPE — needs explicit approval to expand the intended use) | Sensitivity/specificity/AUC of the AI findings vs a reference standard for referable disease | Only if the claim is formally expanded | Stage 9-T2 |

### 0.4 Ground rules for every stage

- **Pre-registered, objective thresholds.** Each stage's pass/fail is fixed *before* data
  collection; no moving the bar after seeing results.
- **Telemetry on, PHI off.** All validation builds run with `smd_fundx_telemetry` **ON**.
  `fundx-telemetry.js` records only acquisition **mechanics** (no images, no identifiers, no
  clinical findings). Images and clinical data live in the consented study record, never in
  telemetry.
- **Stage-gate.** A stage's **blockers** are hard gates: you may not start stage *N+1* until
  stage *N*'s blockers clear. Any P0 (safety) finding halts the program until resolved.
- **Reversible.** Rollout is flag-gated with a kill switch throughout ([[stewardmd-reversible-changes]]).

### 0.5 What can / cannot be executed in this repo

| Executable here (done / re-runnable) | Requires hardware + humans + IEC |
|---|---|
| Engine logic, headless tests, backend e2e, security scan, heuristic benchmark, sim validation (`test/run-fundx-validation.mjs`) | Stages 2–10 real-world execution (devices, operators, patients, graders, ethics) |

---

## Stage 1 — Internal developer testing

**Objective.** Prove the software is correct, safe, and instrumented on the bench *before* any
real hardware or human is involved. This is the gate to touch a phone.

**Test cases.**
- All headless suites green: `clinical / detect / enhance / providers / fundx / backend /
  telemetry` + `test/run-fundx.mjs` (fake-camera integration) + `test/run-fundx-validation.mjs`.
- Backend e2e against **live** prod: `/health` (vertex `available:true`, developer
  `available:false` in prod, cerebras fallback), real `/vision`, real `/clinical` — already
  passing (200; `is_mock:false`; sensible outputs).
- Provider priority + failover: Vertex primary → developer excluded in prod → Cerebras last;
  no-provider → 503; retry-once path exercised.
- Security: API keys absent from client bundle, git history, logs, and responses (grep sweep).
- Static analysis: `node --check` on all `fundx-*.js` and `functions/_fundx_ai.js`.
- Heuristic benchmark: per-frame analysis cost measured on the dev bench.
- Telemetry PHI-absence assertions pass; `export()` has no network path.

**Success criteria.** 100% of suites pass; e2e endpoints return valid schema-v1 JSON; zero
secret leakage; heuristics real-time on the bench (< ~2 ms/frame excl. MediaPipe).

**Pass/fail thresholds.**
| Metric | Pass |
|---|---|
| Automated suites | 100% pass (0 fail, 0 skip of safety tests) |
| Live backend e2e (`/health`,`/vision`,`/clinical`) | all HTTP 200, `is_mock:false`, schema valid |
| Secret exposure | 0 occurrences (client/history/logs/responses) |
| Heuristic frame cost (bench) | ≤ 2 ms/frame (measured 0.58 ms) |
| Provider-priority + failover assertions | all pass |

**Telemetry to collect.** CI test report; benchmark numbers; backend `/health?metrics=1`
(per-provider count/errors/errorRate/avgLatencyMs/tokens/costUsd); secret-scan log.

**Blockers before progressing.** Any suite failing, any secret exposure, any e2e non-200, or
developer/mock reachable in prod → **hard stop**. All must be green.

---

## Stage 2 — Real device testing (iPhone + Android)

**Objective.** Prove the app **runs and captures correctly on real hardware** across the
target device matrix — the single biggest untested risk (R3/R4 in the risk file). Purely
technical compatibility; no clinical judgement yet.

**Test cases (per device).**
- App loads in the Capacitor WebView; `smd_fundx` flag on via `?fundx=1`.
- Camera: `getUserMedia` grants the **rear** camera; live preview renders inline (iOS
  `allowsInlineMediaPlayback` / `playsinline`; no fullscreen takeover); torch if used.
- MediaPipe loads from the **vendored** local assets (offline/CDN-blocked); eye/pupil/distance
  cues update; heuristic-only fallback still coaches if MediaPipe is absent.
- Device-orientation (roll) permission prompt appears (iOS 13+); rotate cue works; level gate
  is a no-op when denied (never blocks).
- Auto-capture fires on a model eye; burst best-frame selection produces a saved scan with all
  11 persisted fields incl. enhanced image.
- Lifecycle: backgrounding releases the camera (`visibilitychange`); resume re-acquires; lock
  screen; incoming call; rotation.
- Consent + health-gated provider auto-activation (`/api/fundx/health`) on device network.

**Device matrix (minimum).**
| Tier | iOS | Android |
|---|---|---|
| Flagship | iPhone 15/16 Pro | Pixel 8/9, Galaxy S23+ |
| Mid | iPhone SE / 12 | Mid Snapdragon (e.g. Galaxy A-series) |
| Budget | — | Low-RAM Android (MediaPipe stress) |

**Success criteria.** On every matrix device: camera opens, preview is inline, MediaPipe (or
fallback) coaches, auto-capture fires on a model eye, scan persists, no crash, camera released
on background.

**Pass/fail thresholds.**
| Metric | Pass |
|---|---|
| Devices where capture completes on a model eye | 100% of matrix |
| Camera-release-on-background | 100% (no stuck camera / thermal drain) |
| MediaPipe load (local) or graceful fallback | 100% |
| Crashes / white-screens | 0 |
| Median heuristic+MediaPipe frame budget on device | ≤ 33 ms (≥ ~15 fps guidance) |

**Telemetry to collect.** Dev-mode frame recorder (`recordDevFrame` / `exportDevLog`): fps,
per-frame ms, state timeline; telemetry `meta.device`; per-device pass/fail checklist;
OS-level thermal/memory via Xcode Instruments / Android Profiler.

**Blockers before progressing.** Any matrix device that cannot open the camera, cannot render
inline preview, cannot capture on a model eye, or leaks the camera on background → fix + retest
before humans. Sub-10-fps guidance on a target device → CFG/perf work first.

---

## Stage 3 — Non-expert clinician operator testing (human factors)

**Objective.** Prove a **qualified healthcare professional who is a novice at retinal imaging**
can capture a gradeable image with only brief instruction — the product's core value claim.
Measures usability, learning curve, and whether the coaching is understood and acted on. (Per
the intended use, operators are HCPs, not lay users.)

**Test cases.**
- Cohorts, **n ≥ 5 each** (all qualified HCPs, novice at fundus imaging): nurse, junior/general
  doctor, optometrist (ophthalmologist is the Stage 4 expert reference). A lay-person cohort may
  be run **only** as an out-of-population usability stress test — never an acceptance cohort.
- Standard onboarding: one **2-minute instruction video**, no live coaching from staff.
- Protocol: 10 supervised captures on a **model eye**, then 10 on **consenting volunteers**
  (both eyes), same device + lens across a cohort.
- Comprehension probe: after session, operator explains what each coaching cue meant
  (rotate cw/ccw, move closer, hold steady, reduce glare).
- SUS (System Usability Scale) + free-text friction log.

**Success criteria.** Learning curve rises across attempts 1–10; trained-state success meets
the pre-registered bar; coaching cues are correctly understood; no operator is unable to ever
capture.

**Pass/fail thresholds.**
| Metric | Pass |
|---|---|
| First-time success (after the 2-min video, first real attempts) | **≥ 80%** |
| Trained success (attempts after 20-capture warm-up) | **≥ 90%** |
| Coaching-cue comprehension | ≥ 90% of cues correctly explained |
| SUS score | ≥ 70 (good) |
| Operators who never achieve a capture | 0 |

**Telemetry to collect.** Per session: `outcome`, `captureMs`, guidance `steps` timeline,
`trace` (readiness/diagnostic progression), corrections count, `rejectReasons` histogram,
`meta.sensitivity` + `meta.eye`; plus SUS + friction notes (outside telemetry, in study log).

**Blockers before progressing.** First-time < 80% or trained < 90% after CFG calibration →
investigate coaching/thresholds, do not proceed to clinical claims. A cue that ≥ 30% of
operators misunderstand → reword coaching copy (copy-only change, allowed).

---

## Stage 4 — Ophthalmologist testing (expert reference + grader calibration)

**Objective.** Two jobs: (a) establish the **expert operator ceiling** (best achievable
capture with FundX), and (b) **stand up the grading panel** that defines "gradeable" and
"diagnostic quality" for Stages 5/9, and measure grader agreement.

**Test cases.**
- **≥ 2 ophthalmologists / retina specialists** as expert operators: capture with FundX on
  consenting patients across normal + pathological fundi.
- **Grading calibration:** the same specialists (masked to which operator/device captured
  each image) grade a shared set of ≥ 100 captured images on a fixed **gradeability rubric**
  (field of view, focus, illumination, media clarity, artefact) and, for Tier-1, an
  adequate/inadequate call. Compute **inter-rater reliability** (Cohen's/Fleiss' κ).
- **Reference reading** (Tier 2 prep): specialists record findings (DR level, disc, macula,
  vessels) to seed the reference standard.

**Success criteria.** Expert operator success establishes the ceiling; the grading rubric is
reproducible (acceptable κ); disagreements are adjudicated by a defined rule (e.g. third
senior grader / consensus).

**Pass/fail thresholds.**
| Metric | Pass |
|---|---|
| Expert-operator capture success | ≥ 95% (defines the achievable ceiling) |
| Inter-rater agreement on gradeability (κ) | **≥ 0.6** (substantial); adjudicate below |
| Adjudication rule defined + applied | Yes |
| Rubric documented + version-locked | Yes |

**Telemetry to collect.** Expert-session acquisition telemetry (as Stage 3); grading rubric
scores + κ (study database); adjudication log. Images/findings live in the consented study
record, never in `fundx-telemetry`.

**Blockers before progressing.** κ < 0.6 on gradeability → refine the rubric and re-calibrate
before any gradeability threshold can be trusted (Stages 5/9 depend on it).

---

## Stage 5 — Image quality assessment

**Objective.** Quantify the **gradeability** of images FundX captures, and validate that the
engine's internal quality score tracks expert judgement — the bar for any downstream analysis.

**Test cases.**
- Masked retina-specialist grading (Stage 4 panel) of **every saved scan** from Stages 3–4:
  gradeable / borderline / ungradeable, with the failure axis (focus, illumination, FOV,
  artefact, media).
- Correlate the engine's `qualityAtCapture` + `diagnosticScore` against the human grade
  (ROC / correlation) to confirm the score is meaningful, not decorative.
- Field-of-view + eye (OD/OS) stratification; original vs enhanced-image gradeability delta
  (does `fundx-enhance.js` help or hurt?).
- Compare against a reference fundus camera on a subset (relative gradeability, not identity).

**Success criteria.** A high fraction of saved scans are specialist-gradeable; the internal
quality score separates gradeable from ungradeable; enhancement does not degrade gradeability.

**Pass/fail thresholds.**
| Metric | Pass |
|---|---|
| **Gradeable rate** of saved scans (masked specialist) | **≥ 80%** |
| Ungradeable-but-auto-captured (quality false-positive) | **< 5%** |
| Quality-score vs human-grade separation (AUROC) | ≥ 0.80 |
| Enhanced-image gradeability vs original | ≥ original (no net loss) |

**Telemetry to collect.** `qualityAtCapture` + capture-time `trace`; `rejectReasons` for
non-captures; per-image human grade + failure axis (study DB); FOV/eye stratification;
per-device gradeable rate (`meta.device`).

**Blockers before progressing.** Gradeable rate < 80% or quality false-positive ≥ 5% → CFG
calibration (§7 of `VALIDATION.md`; `diagnosticMin`/`fundusMin`/`vesselMin`/`redReflexMin`)
before clinical validation. If the internal score doesn't track human grade (AUROC < 0.8),
the gate logic — not just thresholds — needs review.

---

## Stage 6 — Acquisition success metrics

**Objective.** Establish the real-world **acquisition performance envelope** across cohorts,
devices, and conditions — the aggregate operating characteristics of the capture pipeline.

**Test cases.** Aggregate all instrumented sessions (Stages 2–5) plus dedicated runs to reach
**≥ 200 sessions** total, stratified by cohort × device × lighting × pupil (dark iris / small
pupil). Report the metrics below with dispersion.

**Success criteria.** Success, time, and correction metrics meet the pre-registered bars, with
false/missed capture controlled, across the strata (not just in aggregate).

**Pass/fail thresholds.**
| Metric | Definition | Pass |
|---|---|---|
| Success rate (trained) | captured & gradeable / sessions | **≥ 90%** |
| Success rate (first-time) | after 2-min video | **≥ 80%** |
| Median time-to-capture (trained) | `captureMs` | **≤ 20 s** (stretch ≤ 12 s) |
| Median time-to-capture (first-time) | `captureMs` | **≤ 45 s** |
| **False-capture rate** | auto-capture graded inadequate | **< 5%** |
| Decoy / not-on-eye false-capture | robustness set | **~0%** |
| Missed capture | gradeable view > 15 s, no capture | ≤ 10% |
| Median corrections/session | guidance churn | trend ↓ with training |

**Telemetry to collect.** `outcome`, `captureMs`, `steps`, `trace`, corrections,
`rejectReasons` histogram, `meta.{device,sensitivity,eye,provider}`; `summary()` rollup
(captureRate / median time / rejection histogram) per stratum.

**Blockers before progressing.** Any pre-registered acquisition threshold unmet after
calibration → do not proceed to clinical validation (the clinical study assumes a working
capture pipeline). A stratum failing while aggregate passes (e.g. dark-iris) → per-device /
per-condition CFG override before beta.

---

## Stage 7 — Performance metrics

**Objective.** Confirm FundX is **fast, stable, and affordable** on real devices and in the
cloud backend under sustained use.

**Test cases.**
- **On-device:** guidance-loop fps and per-frame ms (heuristics + MediaPipe) over a 2-minute
  continuous session; memory growth (leak check); thermal state; battery drain per 10-capture
  session; behaviour under thermal throttling.
- **Backend:** `/vision` and `/clinical` latency (p50/p95), error rate, and cost per call under
  normal and burst load; rate-limit behaviour; retry-once path; timeout handling (20 s).
- **Offline / degraded network:** capture still works locally (findings queue or degrade
  gracefully); no hang.
- **Cold vs warm:** WIF token-mint cold-start latency vs warm.

**Success criteria.** Real-time guidance sustained; no memory leak or runaway heat; backend
latency/cost within budget; graceful degradation offline.

**Pass/fail thresholds.**
| Metric | Pass |
|---|---|
| Guidance loop fps (target devices) | **≥ 15 fps** sustained |
| Per-frame processing (heuristics+MediaPipe) | ≤ 33 ms median on mid-tier |
| Memory growth over 2 min | no unbounded growth (< ~50 MB drift) |
| Thermal | no shutdown / no forced fps collapse in a 10-capture session |
| Backend `/vision` p95 latency | ≤ 8 s (observed ~4.7 s warm) |
| Backend `/clinical` p95 latency | ≤ 10 s (observed ~7.2 s) |
| Backend error rate | < 1% |
| Cost per completed scan (vision+clinical) | ≤ ~$0.005 (observed ~$0.001–0.002) |
| Offline capture | works; no crash/hang |

**Telemetry to collect.** Dev frame recorder (`recordDevFrame`/`exportDevLog`) fps + frame ms;
Instruments/Profiler memory/thermal/battery; backend `/health?metrics=1` per-provider
count/errors/errorRate/avgLatencyMs/tokens/costUsd; load-test log.

**Blockers before progressing.** Sub-15-fps guidance, memory leak, thermal shutdown, backend
error rate ≥ 1%, or cost/scan materially over budget → optimise before beta.

---

## Stage 8 — Failure mode documentation (FMEA)

**Objective.** Systematically enumerate how FundX fails, how each failure is **detected and
mitigated**, and the **residual risk** — the safety backbone of the whole program and the
CDSCO risk file.

**Test cases.** Deliberately induce and document each mode; verify the app's response is safe
(coaches / refuses / degrades — never captures or asserts garbage).
| Mode | Induce | Expected safe response |
|---|---|---|
| Small pupil | undilated / bright room | no false capture; coach; optional confirm-fallback (off by default) |
| Media opacity (cataract) | mature cataract patient | no false capture; coach; grader-ungradeable |
| Glare / bright room | strong ambient | glare cue; refuse until `reflectionMax` met |
| Not-on-eye / decoy | point at skin/wall | ~0% capture (decoy test) |
| Dark iris / weak reflex | pigmented iris | still captures via combined gate; no forced capture |
| MediaPipe fails to load | block assets | heuristic-only coaching; no crash |
| Camera permission denied | deny prompt | clear message; no hang |
| Device-orientation denied | deny prompt | level gate no-op; capture unaffected |
| Network loss mid-scan | airplane mode | local capture ok; findings degrade gracefully |
| Backend 5xx / timeout / rate-limited | force | typed error; retry-once; user-safe message; no fabricated finding |
| Motion blur under tremor | shaky hand | `readySustainFrames` + best-frame reject blur |
| **AI over-trust** | plausible-but-wrong finding | "Not a diagnosis / clinician review" labelling on every output |

**Success criteria.** Every mode has a documented detection + mitigation + residual-risk
rating; no mode produces a **silent unsafe** outcome (false capture presented as good, or a
fabricated finding shown without the advisory label).

**Pass/fail thresholds.**
| Metric | Pass |
|---|---|
| Failure modes with detection + mitigation + residual rating | 100% |
| Modes producing a silent unsafe outcome | **0** |
| Decoy / not-on-eye false-capture | ~0% |
| Advisory label present on every findings output | 100% |

**Telemetry to collect.** `rejectReasons` frequency by mode; `outcome` distribution under each
induced fault; backend error taxonomy + `failReason` (`/health` metrics); FMEA table with
Severity × Likelihood × Detectability → RPN in the risk file.

**Blockers before progressing.** Any mode with a **silent unsafe** outcome, or any Severity-high
mode without an effective mitigation → **hard stop** (P0). This stage feeds the residual-risk
statement required for the clinical protocol and beta.

---

## Stage 9 — Clinical validation protocol

**Objective.** Establish, under an ethics-approved protocol, that FundX is **clinically safe
and fit for its claim**. Tier 1 is required for the current claim; Tier 2 is only if a
screening claim is made.

### Tier 1 — Gradeability & safety study (required for current claim)

**Test cases.**
- Prospective, IEC-approved, informed consent, DPDP-compliant. Consecutive/representative
  patients across a realistic disease mix (normal, DR spectrum, glaucomatous discs, media
  opacity) at ≥ 1 clinical site.
- Each patient: FundX capture (by a **trained non-expert**, the real use case) → masked
  specialist grading (Stage 4 panel) → paired with the site's **reference standard** (dilated
  fundus exam by an ophthalmologist and/or a reference fundus camera, masked, adjudicated).
- Safety endpoint: no patient harm; no clinical decision made *on FundX alone* (clinician
  reviews every case).

**Success criteria / thresholds.**
| Metric | Pass |
|---|---|
| **Gradeable-by-non-expert rate** vs reference | **≥ 80%** |
| Agreement (FundX-captured vs reference-camera image) on gradeability | κ ≥ 0.6 |
| Adverse events attributable to FundX | **0** |
| Advisory-only workflow adhered to (clinician review documented) | 100% |
| Sample size | powered for an 80% gradeable rate at ±7% CI (≈ 130–150 gradings min; confirm with a statistician) |

### Tier 2 — Diagnostic-accuracy study (OUT OF SCOPE — requires explicit intended-use expansion)

> **Do not run, publish, or imply Tier 2 results without explicit written approval to expand the
> intended use** beyond advisory support. It is specified here only so the path is defined if
> that approval is ever granted.

**Test cases.** Same enrolment, but the endpoint is the **AI findings** vs an adjudicated
reference standard for a defined target condition (e.g. **referable DR**: moderate-NPDR-or-worse
/ DME). Pre-register the target condition, reference standard, and analysis plan.

**Success criteria / thresholds (screening-grade, pre-registered).**
| Metric | Pass (indicative — set with a biostatistician + clinical lead) |
|---|---|
| Sensitivity for referable disease | ≥ 90% (screening safety bar) |
| Specificity | ≥ 80% |
| AUC | ≥ 0.90 |
| Sample size | powered for the above at the expected prevalence (typically several hundred graded eyes) |

**Telemetry to collect.** Acquisition telemetry (mechanics only) links to the study record by
an anonymised session id; clinical data (images, grades, reference standard, AE log) lives in
the **consented study database**, never in `fundx-telemetry`. Provider/model version is
persisted per scan (audit) so results are traceable to `gemini-2.5-flash` (or successor).

**Blockers before progressing.** No IEC approval / no consent process → cannot start. Tier 1
gradeability < 80%, any attributable adverse event, or any breach of the advisory-only
workflow → **hard stop**. Tier 2 must **not** be run, advertised, or implied without explicit
written approval to expand the intended use beyond advisory support.

---

## Stage 10 — Beta rollout strategy

**Objective.** Move to real users **gradually and reversibly**, with monitoring and a kill
switch, only after Stages 1–9 (Tier 1) pass.

**Test cases / rollout rings.**
| Ring | Who | Flag state | Exit criteria |
|---|---|---|---|
| R0 Internal | dev + clinical lead | `?fundx=1` manual | Stages 1–2 pass |
| R1 Supervised pilot | trained staff at 1 site, patients consented, clinician reviews every case | `smd_fundx` ON for whitelisted accounts | Stages 3–8 pass; Stage 9-T1 enrolling |
| R2 Limited beta | multi-site, trained operators, telemetry ON, advisory-only enforced | flag ON for beta cohort | Stage 9-T1 pass; no P0 in 4 weeks |
| R3 Controlled GA | broader enablement, still advisory-only | flag default-ON gradually | stable field metrics; support in place |

**Success criteria.** Each ring's field metrics match validation targets before widening;
advisory-only workflow enforced; a working **kill switch** (flag OFF) and rollback at every
ring; support + incident process live.

**Pass/fail thresholds (per ring, from live telemetry).**
| Metric | Widen if |
|---|---|
| Field gradeable rate | ≥ 80% (matches Stage 5) |
| Field success rate (trained) | ≥ 90% |
| False-capture rate | < 5% |
| Backend error rate | < 1% |
| Crash-free sessions | ≥ 99.5% |
| Safety incidents (P0) | 0 |
| Cost/scan | within budget |

**Stopping rules (auto-halt / roll back a ring).** Any P0 safety incident; false-capture ≥ 5%
sustained; gradeable rate < 75%; backend error rate ≥ 2%; any confirmed patient harm; any PHI
/ key exposure. Halt = set `smd_fundx` OFF for the ring (instant, reversible).

**Telemetry to collect.** Live `summary()` rollups per ring (captureRate, median time,
rejection histogram, per-device); backend `/health?metrics=1` (latency/error/cost);
crash-free-sessions; support-ticket taxonomy; consent + advisory-review audit.

**Blockers before progressing.** Do not widen a ring until its exit criteria hold on **live**
data. Do not reach R3/GA without Stage 9 Tier 1 passed (and Tier 2 if a screening claim is
made). Kill switch + rollback must be verified working before R1.

---

## Program gate summary (single go/no-go per stage)

| Stage | One-line gate to advance |
|---|---|
| 1 Internal dev | All suites + live e2e green; zero secret leakage |
| 2 Real device | Capture works on 100% of matrix; camera released on background; ≥ 15 fps |
| 3 Beginner | First-time ≥ 80%, trained ≥ 90%, SUS ≥ 70 |
| 4 Ophthalmologist | Grading κ ≥ 0.6; rubric locked; expert ceiling set |
| 5 Image quality | Gradeable ≥ 80%; quality-false-positive < 5%; AUROC ≥ 0.80 |
| 6 Acquisition | ≥ 200 sessions meet success/time/false-capture bars across strata |
| 7 Performance | ≥ 15 fps, no leak/thermal, backend p95 + error + cost in budget |
| 8 Failure modes | 100% modes documented; **0 silent-unsafe**; advisory label 100% |
| 9 Clinical (T1) | IEC-approved; gradeable ≥ 80% vs reference; 0 attributable AE |
| 10 Beta | Ring exit criteria hold on live data; kill switch verified |

## Roles

- **Sponsor / clinical lead** (ophthalmologist): claim, rubric, reference standard, IEC.
- **Engineering:** Stages 1–2, 7–8; CFG calibration; telemetry + dev tooling.
- **Biostatistician:** Stage 6/9 sample size, thresholds, analysis plan.
- **Study coordinator:** consent, enrolment, data governance (DPDP).

## Cross-references

- Acquisition methods + CFG calibration detail: `docs/fundx/VALIDATION.md` (§§1–9).
- Backend / provider / cost: `docs/fundx/BACKEND.md`, `docs/fundx/PRODUCTION-AUDIT.md`.
- Acquisition internals (heuristics, gates): `docs/fundx/ACQUISITION-INTERNALS.md`.
- Privacy / consent baseline: StewardMD DPDP privacy baseline.

---

*This program adds no features and no providers. It defines how FundX earns the right to be
enabled for real patients. The user-facing flag `smd_fundx` stays OFF until Stage 10.*
