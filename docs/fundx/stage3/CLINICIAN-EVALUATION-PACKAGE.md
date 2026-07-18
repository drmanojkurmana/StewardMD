# FundX AI — Stage 3 Clinician Operator Testing Package

> **Intended use (locked).** FundX is an AI-assisted retinal image **acquisition and clinical
> support** tool **for qualified healthcare professionals**. It is **advisory only**. It does
> **not** make autonomous diagnoses or treatment decisions. **A qualified clinician reviews all
> information and makes the final clinical decision.** Nothing in this package expands that scope;
> formal diagnostic-accuracy (sensitivity/specificity) testing is **out of scope** (Stage 9
> Tier 2) and must not be run or implied without written approval.

**Purpose.** Evaluate whether a **qualified healthcare professional who is a novice at retinal
imaging** can use FundX to capture gradeable images, understand the coaching, and use the
advisory output safely — measuring usability, learning curve, image quality, advisory
helpfulness/safety, and any safety events. This is **documentation and validation only; no
application code is changed.** Flag `smd_fundx` stays OFF for end users; testing runs on
whitelisted validation builds.

**Prerequisite:** Stage 2 (real device validation) passed for the device(s) used here.
**Reference:** `docs/fundx/VALIDATION-PROGRAM.md` §Stage 3; device details reuse
`docs/fundx/stage2/DEVICE-VALIDATION-PACKAGE.md`.

**Package contents**
| # | Item | Where |
|---|---|---|
| 1 | Clinician onboarding guide | §1 (this doc) |
| 2 | Operator inclusion/exclusion criteria | §2 |
| 3 | Device & lens checklist | §3 |
| 4 | Standard operating procedure (SOP) | §4 |
| 5 | Test scenarios (normal, DR, HTN, glaucoma, media opacity, small pupil, poor lighting) | §5 |
| 6 | Workflow timing sheet | `WORKFLOW-TIMING-SHEET.md` |
| 7 | Usability questionnaire (SUS + comprehension) | `USABILITY-QUESTIONNAIRE.md` |
| 8 | Image quality grading form | `IMAGE-QUALITY-GRADING-FORM.md` |
| 9 | AI recommendation assessment form (advisory) | `AI-RECOMMENDATION-ASSESSMENT.md` |
| 10 | Error classification guide | §6 |
| 11 | Safety event reporting form | `SAFETY-EVENT-REPORT.md` |
| 12 | Clinician feedback questionnaire | `CLINICIAN-FEEDBACK-QUESTIONNAIRE.md` |
| 13 | Acceptance criteria | §7 |
| 14 | Pass/fail thresholds | §7 |
| 15 | Stage 3 completion checklist | §8 |

**Ethics/data.** All human testing runs under IEC/IRB approval with informed consent (operators
**and** imaged subjects) and DPDP-compliant handling. Telemetry is PHI-free; images/clinical data
live only in the consented study record. Use anonymous operator IDs and session IDs on every form.

---

## 1. Clinician onboarding guide (operator-facing)

**What FundX is.** A phone-based tool that **coaches you** to capture a retinal (fundus) image
through an indirect condensing lens, checks the image quality, and offers **advisory** AI
suggestions. It supports you; it does not decide. You remain responsible for every clinical
decision.

**Your role in this study.** After a short standard instruction you will (a) practise on a model
eye, then (b) capture images on consenting volunteers. We measure how easily you can capture a
good image and how clearly the app guides you. There is no "wrong" performance — we are testing
the software, not you.

**Before you start.** The app is already set up on the device (FundX on, telemetry on, developer
overlay on, sensitivity = medium). You do **not** need to identify the lens power — FundX works
with 20D/28D/other lenses without any setting.

**How to hold it.** Hold the phone steady in one hand and the condensing lens in the other, as you
would for indirect ophthalmoscopy; bring the phone camera and lens in line with the patient's
pupil. Follow the on-screen cues — do not force a capture.

**What the coaching cues mean.** FundX moves through stages and shows a cue for each:

| Stage | You'll be guided to | Cue examples |
|---|---|---|
| searching_eye | get the eye in frame | "find the eye" |
| centering_pupil | centre on the pupil | "centre", move left/right/up/down |
| working_distance | set the right distance | "move closer" / "move back" |
| red_reflex | get the red glow | "adjust for red reflex" |
| locating_fundus | bring the retina into view | "hold position" |
| optimizing | fine-tune focus/exposure/glare | "reduce glare", "hold steady", **"rotate clockwise/counter-clockwise"** |
| assessing_quality → ready | wait — it will capture itself | "hold for capture" |

**Auto-capture.** FundX captures **automatically** only when image quality is good enough. If it
does not capture, the image is not yet diagnostic — keep following the cues. It will **not** save a
poor image, and it will **not** get stuck waiting for a lens.

**The advisory output.** After capture, FundX may show image-quality feedback and **advisory**
suggestions. These are **not a diagnosis**. Read them as a second opinion to consider; you decide.
If a suggestion seems wrong or unsafe, note it on the AI assessment form (§9) — that is exactly
what we want to catch.

**If something goes wrong.** App crash, camera won't open, stuck guidance, or any concern about a
patient → stop, note it, and use the Error guide (§6) / Safety form (§11). Never continue a capture
that is uncomfortable for the patient.

---

## 2. Operator inclusion / exclusion criteria

**Target population:** qualified healthcare professionals who are **novices at retinal imaging**.

**Include**
- Qualified HCP: **registered nurse, junior/general physician (non-ophthalmology), or optometrist**.
- Novice at fundus/indirect imaging (little or no prior routine fundus photography).
- Provides informed consent to participate.
- Able to physically operate a smartphone + handheld lens.

**Exclude**
- **Ophthalmologists / retina specialists** as the *test* cohort — they serve as the **Stage 4
  expert reference and image graders**, recorded separately (not counted in the novice cohorts).
- **Lay persons / non-HCPs** — outside the intended-use population (a lay run may be kept only as
  a labelled out-of-population stress test, never an acceptance cohort).
- Uncorrected visual/motor impairment that prevents device use.
- No consent.

**Cohorts & sample size:** **n ≥ 5 per cohort** (nurse, junior/general doctor, optometrist).
Record cohort on every form. Balance across the device matrix from Stage 2 where feasible.

**Imaged-subject eligibility** (for the live-eye portion; per-scenario detail in §5): consenting
adults; a clinician on site confirms it is safe to image; exclude acute painful/photophobic eye
conditions or any situation where imaging is clinically inadvisable.

---

## 3. Device & lens checklist (per session)

Condensed from the Stage 2 package — confirm before each operator session:

- [ ] Device passed Stage 2; correct **native build + version** recorded.
- [ ] FundX ON, **Telemetry ON**, **Dev overlay ON**, **Sensitivity = med**, Lens-confirm **OFF**.
- [ ] Battery ≥ 50%, not Low-Power; storage free; lens clean and undamaged.
- [ ] Camera + motion permissions granted; MediaPipe loads (or graceful fallback confirmed).
- [ ] Remote inspector connected for telemetry export; `GET /api/fundx/health` ok.
- [ ] Condensing lens available (**20D and/or 28D**); **no lens-power setting required** (power-agnostic).
- [ ] Model eye / fundus target ready; volunteer consent obtained for live-eye runs.
- [ ] All Stage 3 forms printed with operator ID + session ID filled in.

---

## 4. Standard operating procedure (SOP)

Run identically for every operator to keep results comparable.

1. **Consent & IDs.** Obtain operator consent; assign anonymous operator ID + session ID. Confirm
   device/lens checklist (§3).
2. **Standard instruction (fixed).** Play the **2-minute standard instruction video once**. No
   additional live coaching beyond the standard script below. Read verbatim if no video:
   > "This app helps you capture a retinal image. Hold the phone steady and the lens in your other
   > hand, line them up with the pupil, and follow the on-screen cues — move closer or back, centre,
   > hold steady, reduce glare, rotate as shown. It captures by itself when the image is good; it
   > will not save a poor image. The suggestions it shows afterwards are advisory only — you make the
   > clinical decision."
3. **Model-eye practice (attempts 1–10).** Operator performs 10 captures on the model eye. Record
   each on the **Workflow timing sheet** (time-to-capture, corrections, outcome). This is the
   **learning-curve** measure.
4. **Comprehension probe.** After practice, operator explains what each coaching cue meant
   (Usability questionnaire §comprehension). Do this **before** live-eye work.
5. **Live-eye captures (attempts 1–10).** With a consenting volunteer, operator captures **both
   eyes** as conditions allow, following the scenario mix in §5. Record timing per attempt.
6. **First-time vs trained.** "First-time" = the operator's earliest real attempts (start of step
   3); "trained" = attempts after the 20-capture warm-up (end of step 5). Both are computed from
   the timing sheet.
7. **Image grading (masked).** A reference grader (ophthalmologist / Stage 4 panel), **blinded to
   operator and device**, grades each saved image on the **Image quality grading form**.
8. **AI advisory assessment.** For each scan, a clinician completes the **AI recommendation
   assessment form** (advisory helpfulness + safety; not accuracy).
9. **Usability + feedback.** Operator completes the **Usability questionnaire** (SUS +
   comprehension) and the **Clinician feedback questionnaire**.
10. **Safety check.** Review for any safety event (§11). Any patient harm or unsafe advisory acted
    upon → **stop**, file the safety form, escalate to the IEC per protocol.
11. **Data export.** Export telemetry JSON + dev-frame CSV; attach filenames to the timing sheet.
    Store images/clinical data only in the consented study record.
12. **Session close.** Complete the timing-sheet outcome + sign-off.

**Standardization rules:** same device + lens within a cohort where possible; same instruction;
no over-the-shoulder coaching during measured attempts; note any deviation.

---

## 5. Test scenarios

Each scenario is an **acquisition condition**, not a diagnostic test. Across a session, aim to
cover the mix below (subject availability permitting). For every scenario record timing, outcome,
telemetry, image grade, and advisory assessment. **Difficulty scenarios expect *safe behaviour*
(coach / refuse), not a forced capture.**

| # | Scenario | Subject / setup | What we observe | Expected FundX behaviour | Acceptance |
|---|---|---|---|---|---|
| S1 | **Normal retina** | healthy consenting eye | baseline capture | progresses to `ready`, auto-captures a gradeable image | operator captures gradeable image within trained-time target |
| S2 | **Diabetic retinopathy** | known DR patient (consented) | capture across lesions | captures gradeable image; advisory findings labelled advisory | gradeable capture; advisory output present + correctly labelled; clinician retains decision |
| S3 | **Hypertensive retinopathy** | known HTN retinopathy patient | vessel changes | gradeable capture; advisory only | gradeable capture; advisory labelled; no over-reliance |
| S4 | **Glaucoma (where appropriate)** | known/suspected glaucoma | optic disc capture | gradeable disc image; **advisory** cup:disc note only | gradeable disc image; advisory clearly not a glaucoma diagnosis (needs IOP/fields — note in onboarding) |
| S5 | **Media opacity (e.g. cataract)** | consenting patient with opacity | degraded view | coaches; likely refuses (ungradeable) rather than false-capture | **no false capture**; graceful coaching; grader marks ungradeable |
| S6 | **Small / undilated pupil** | undilated eye | limited red reflex | coaches; may not capture | **no false capture**; safe refusal or gradeable capture only if genuinely adequate |
| S7 | **Poor lighting** | dim or bright/glare room | exposure/glare stress | glare/exposure cues; refuses until adequate | **no false capture**; recovers when lighting corrected |

**Safety note for S2–S4:** advisory suggestions are a prompt for the clinician, never a diagnosis.
Glaucoma and retinopathy grading require clinical correlation the tool does not perform. Any
advisory that could mislead → AI assessment form + safety form.

**Telemetry per scenario:** `meta.{device,sensitivity,eye,provider}`, `steps`, `trace`,
`outcome`, `captureMs`, `qualityAtCapture`, `rejectReasons`; dev-frame CSV for the run.

---

## 6. Error classification guide (item 10)

Classify every deviation. Distinguish **operator technique** (a training signal) from **system**
(a defect → `docs/fundx/stage2/BUG-REPORT.md`) and **safety** (→ §11). Severity: **P0** safety/data,
**P1** blocks a test, **P2** degraded UX, **P3** cosmetic.

| Class | Code | Examples | Route | Typical severity |
|---|---|---|---|---|
| Operator technique | OP | mis-alignment, wrong distance, unsteady hold, gave up early | training/coaching notes | n/a (not a defect) |
| Acquisition | ACQ-FALSE | **false capture** — saved a non-fundus/blown/blurred frame as good | Bug report + Safety | **P0** |
| Acquisition | ACQ-MISS | adequate view > ~15 s but no capture (missed) | Bug report | P1/P2 |
| Acquisition | ACQ-STALL | stuck in a state, never reaches `ready` on an adequate view | Bug report | P1 |
| Device/app | SYS-CAM | camera won't open / black / front camera / not released | Bug report | P1 |
| Device/app | SYS-MP | MediaPipe fails, no eye cues | Bug report | P2 |
| Device/app | SYS-CRASH | crash / white-screen / data loss | Bug report + Safety | **P0** |
| Image quality | IQ | captured image ungradeable (per grading form) | grading form; feeds Stage 5 | P2 |
| AI advisory | AI-IMPL | implausible/misleading advisory suggestion | AI assessment + Safety if acted upon | P1 (P0 if harm) |
| AI advisory | AI-LABEL | advisory/disclaimer label missing on output | Bug report + Safety | **P0** |
| Data/safety | SAFE-PHI | PHI in telemetry, or secret/key visible | Safety + Bug report — **halt** | **P0** |
| Data/safety | SAFE-HARM | patient discomfort/harm during imaging | Safety — **halt** | **P0** |

**Rule:** any P0 halts the affected path (or all testing for SAFE-PHI/SAFE-HARM) until resolved
and re-verified.

---

## 7. Acceptance criteria & pass/fail thresholds (items 13 & 14)

Pre-registered and objective. Stage 3 **passes** only if all are met.

| # | Criterion | Pass threshold |
|---|---|---|
| 1 | **First-time success** (earliest real attempts, after the 2-min instruction) | **≥ 80%** capture a gradeable image |
| 2 | **Trained success** (attempts after the 20-capture warm-up) | **≥ 90%** |
| 3 | **Coaching-cue comprehension** | **≥ 90%** of cues correctly explained |
| 4 | **Usability (SUS)** | mean **≥ 70** |
| 5 | **Operators who never capture** | **0** |
| 6 | **False-capture rate** (across all scenarios) | **< 5%**; **~0%** on decoy/clearly inadequate |
| 7 | **Advisory label present** on every AI output | **100%** |
| 8 | **Unsafe advisory suggestions acted upon** | **0** |
| 9 | **Safety events attributable to FundX** | **0** |
| 10 | Cohorts completed | **n ≥ 5** each (nurse, junior/general doctor, optometrist) |

Supporting (measured here, formally gated in Stage 5): **gradeable-image rate** by masked grader —
target ≥ 80%; if below, calibrate CFG (per `VALIDATION.md` §7) before Stage 5, do not change scope.

**Note:** criteria 6–9 are **safety gates** — any breach is a hard stop regardless of usability
scores. FundX remaining advisory (clinician reviews every case) is what keeps criterion 9 at zero.

---

## 8. Stage 3 completion checklist (item 15)

- [ ] All three operator cohorts completed with **n ≥ 5** each; operator IDs logged.
- [ ] Every operator: 10 model-eye + up to 10 live-eye attempts recorded on timing sheets.
- [ ] First-time ≥ 80% and trained ≥ 90% success achieved (or CFG calibrated + re-tested).
- [ ] Comprehension ≥ 90%; SUS mean ≥ 70; **0** operators who never captured.
- [ ] False-capture < 5% overall and ~0% on decoy/inadequate; **0** unresolved ACQ-FALSE.
- [ ] All saved images graded (masked) on the image-quality form; gradeable rate recorded.
- [ ] AI recommendation assessment completed for every scan; advisory label present 100%; **0**
      unsafe suggestions acted upon.
- [ ] Usability + clinician feedback questionnaires collected and summarised.
- [ ] All errors classified (§6); every P0 resolved and re-verified; **0** open P0.
- [ ] Safety review done; **0** attributable safety events; any event filed + IEC-notified.
- [ ] Telemetry JSON + dev-frame CSV exported and archived (PHI-free); images/clinical data in the
      consented study record only.
- [ ] Results written up; sign-off by study lead to proceed to **Stage 4/5**.

**Blockers to next stage:** any threshold in §7 unmet after calibration, any open P0, any
attributable safety event, or incomplete cohorts. Intended use unchanged throughout.

---

*Documentation and validation only. No application code is modified. FundX is advisory clinical
support; a qualified clinician makes the final decision.*
