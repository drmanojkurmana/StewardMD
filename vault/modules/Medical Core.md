---
tags: [module, clinical, ai]
status: phase-1-built
flag: smd_medcore + smd_medcore_shadow (both default OFF)
---
# Medical Core — Final Implementation Plan

## Status (2026-09-19)

Steps 1 to 11 of the Implementation Order are DONE. The work can go no further than step 12, the
data gate, which is not an engineering task.

One deviation from the file table below: `medcore/medcore-outcomes.js` was added. The plan put the
risk-set and blanking rules in `backend/medcore/` (training only), but the bedside needs the SAME
rules to decide whether a decision may be produced about a patient at all, and two copies of a
HAZ-ML-02 control is how one of them quietly stops matching. It is one function, used by both.

| Step | State | What exists |
|---|---|---|
| 1 flags | done | `medcore-flags.js`, both flags OFF, tag `medcore-pre-integration` (local; the tag push is 403 on this credential) |
| 2 units | done | `medcore/data/units.json` (29 params) + `medcore/medcore-units.js`. HAZ-ML-03 |
| 3 state | done | `medcore/data/freshness.json` + `medcore/medcore-state.js` (`fromIcuState`). `asOf` leakage control, HAZ-ML-04 |
| 4 missing | done | `medcore/medcore-missing.js`, unioned with `icu-autoscores.js` `{__missing:[...]}` |
| 5 changes | done | `medcore/data/change-bands.json` + `medcore/medcore-changes.js` |
| 6 panel | done | `medcore-boot.js`, one flag-gated card in `icu.js`, `index.html`, `scripts/build-www.sh`, `test/run-medcore-ui.mjs` (19 browser assertions) |
| 7 Phase 1 ships | done | this note, `vault/Home.md`, `vault/Flags.md`, `vault/decisions/Decisions.md` |
| 8 WardSynQ adapter | done | `fromWardSynQ()` reading through `wardsynq-temporal.js` |
| 9 features | done | `medcore/medcore-features.js` + the banned-feature list. HAZ-ML-01 |
| 10 hazards | done | HAZ-ML-01..04 in `wardsynq/wardsynq-safety-case.js`, cross-referenced by `scripts/wardsynq-assurance.mjs` |
| 11 outcomes | done | `medcore/data/outcomes.json` (5 outcomes, unapproved) + `medcore/medcore-outcomes.js` + `test/medcore-labels.test.mjs`. HAZ-ML-02 |
| 12 DATA GATE | **BLOCKED** | No dataset, no access approval, no adjudication, no named clinical approver. Nothing past here is an engineering task |
| 13 to 21 | not started | Everything from dataset construction onward waits on step 12 |

**What a clinician gets today, with the flag on:** two deterministic lists on the ICU overview,
"what changed" and "missing information". No probability, no alert, no prediction, nothing written.

**What is NOT true today:** there is no model, no training data, no calibrated probability, no
outcome anybody has approved, and no Medical Core signal reaches any alert, prompt or notification.

Supersedes the external "StewardMD + MAiK Medical Core" plan. Written against the repo as it exists
on 2026-09-19; the gap analysis that produced it is `MEDICAL_CORE_PLAN_REVIEW.md`.

Nothing here is clinically approved. Read the status taxonomy in [[WardSynQ]] before quoting any
milestone as done.

## 1. Objective

Medical Core adds ONE thing to StewardMD: a calibrated probability, with an honest abstention, that a
named clinical event will happen to this patient inside a named time window.

It does not alert, escalate, deduplicate, notify, score, diagnose or order. Every one of those already
exists and stays where it is. Medical Core produces typed decisions; the existing WardSynQ
recognition and orchestrator layers decide whether a human is asked anything.

Phases 1 and 2 of the plan deliver clinical value with no model at all ("what changed", "missing
information"), and that deterministic layer is also the feature pipeline the model later consumes.

## 2. Final Architecture

```text
GHIS / adapters                                      EXISTS  wardsynq/adapters/*
        |
ClinicalEventBus                                     EXISTS  wardsynq/wardsynq-events.js
        |
Append-only store + bi-temporal query                EXISTS  wardsynq-store.js / wardsynq-temporal.js
        |
Observation usability gate (artefact, staleness)     EXISTS  wardsynq-vitals.js (scoreable)
        |
        v
MedicalCoreState                                     BUILD   medcore/medcore-state.js
  canonical, de-identified, unit-checked
        |
        +--> What changed                            BUILD   medcore/medcore-changes.js
        +--> Missing information                     BUILD   medcore/medcore-missing.js
        +--> Temporal features                       BUILD   medcore/medcore-features.js
        |
        v
ML decision layer (LR / GBM artifacts, pure JS)      BUILD   medcore/medcore-decide.js
                                                             medcore/medcore-models.js
        |
        v
Calibration, confidence, abstention, OOD             BUILD   medcore/medcore-calibration.js
        |
        v
Typed decisions (BOOLEAN / ORDINAL / ABSTAIN)        BUILD   contract in medcore-decide.js
        |
        v
Deterministic authority                              EXISTS  wardsynq-safety.js, calculators.js,
  scores, thresholds, refusals                               icu-autoscores.js, wardsynq-deterioration.js
        |
        v
Recognition prompt (a human must answer)             EXISTS  wardsynq-recognition.js
        |
        v
One alert identity across channels                   EXISTS  wardsynq-orchestrator.js
        |
        v
ICU / Ward UI, thin push                             EXISTS  icu.js injectCSS, wardsynq-alert-ui.js
        |
        v
MaiK + RAG, only on clinician request                EXISTS  StewardRAG.buildPackage ->
                                                             SMD_AI.explainGrounded
```

Two properties of this shape that are not negotiable:

1. **Medical Core never reaches the UI directly.** Its output enters the existing pipeline at
   recognition, as evidence for a prompt, never as its own alert channel.
2. **Inference runs on the device, inside the existing bundle.** Model artifacts are versioned JSON
   (coefficients, tree ensembles, calibration maps) fetched from R2 like every other pack. There is
   no Medical Core service, no `patient_id` payload and no clinical values crossing the network.
   This is what keeps O3 (thin push, no PHI) and the de-identified MaiK posture intact by
   construction rather than by policy.

## 3. What We Reuse (do not rebuild)

| Concern | File | Why it is already done |
|---|---|---|
| Event delivery | `wardsynq/wardsynq-events.js` | Vector clocks, idempotent emit, bounded retry, dead-letter |
| Persistence and history | `wardsynq/wardsynq-store.js` | Append-only, every put versions, `history()` |
| Point-in-time truth | `wardsynq/wardsynq-temporal.js` | `recordedAt` / `effectiveAt` / `amendedAt`. This is the leakage control |
| Usable observation | `wardsynq/wardsynq-vitals.js` | `scoreable()`, IoMT artefact filter, staleness rejection with reason |
| Early warning + refusals | `wardsynq/wardsynq-deterioration.js`, `wardsynq-pews.js`, `wardsynq-obstetrics.js` | NEWS2 INCOMPLETE semantics, Scale 2, under-16 and obstetric refusals |
| Deterministic safety | `wardsynq/wardsynq-safety.js` | Pure, injected rule pack |
| Scores | `calculators.js` (`window.MEDCALC`), `icu-autoscores.js` (`window.ICU_AUTOSCORES`) | SOFA, qSOFA, APACHE II, NEWS2, GCS, RASS, CURB-65, MELD, Child-Pugh, Wells, CHA2DS2-VASc, plus `{__missing:[...]}` per score |
| Prompt, not alert | `wardsynq/wardsynq-recognition.js` | Timestamped prompt, `pinsTimeZero`, per patient per code dedup, decline is an answer |
| One alert identity | `wardsynq/wardsynq-orchestrator.js` | `alertId` / `noticeId` / `patientId` across channels |
| Critical result loop | `wardsynq/wardsynq-critical.js` | Closed loop, injected thresholds, escalation cannot be suppressed |
| Shadow observation | `wardsynq/wardsynq-shadow.js` | Wrapper installed from outside, legacy result returned first, cannot throw into the caller |
| Model governance | `wardsynq/wardsynq-mlops.js` | Refuses retrospective-only deployment, shadow means reaching nobody, input drift, subgroup gate, automatic rollback |
| Lineage | `wardsynq/wardsynq-lineage.js`, entity `meta` envelope | `source`, `derivedFrom` |
| Assurance | `wardsynq/wardsynq-safety-case.js`, `scripts/wardsynq-assurance.mjs` | Executable hazard table, currently 14 of 16 verified |
| Flags | `wardsynq-flags.js` pattern, `vault/Flags.md` | Flag registry and the reason each is OFF |
| Current vitals in ICU | `mergedVitals()` in `icu.js` | Forward-filled per field. `latestVitals()` and bare `latestByTs()` are the documented trap |

## 4. What We Build

Eleven files, one directory, one flag, one UI panel. Everything else is an edit to something that
already exists.

- `medcore/medcore-state.js` — the canonical input state
- `medcore/medcore-units.js` + `medcore/data/units.json` — unit whitelist and refusal
- `medcore/medcore-features.js` — deterministic temporal features (the single feature implementation)
- `medcore/medcore-changes.js` — what changed
- `medcore/medcore-missing.js` — missing information
- `medcore/medcore-models.js` — artifact registry, version pinning, integrity check
- `medcore/medcore-decide.js` — typed decision contract, scorer, one entry point
- `medcore/medcore-calibration.js` — calibration, confidence, abstention, OOD
- `medcore-flags.js` (repo root, module convention) — `SMD_MEDCORE_FLAGS`
- `medcore-boot.js` (repo root) — subscribes to the event bus, flag-gated, shadow first
- `backend/medcore/` — offline training, mirroring `backend/kardiox/app/training/`

## 5. Phase 0 — Architecture and Data Contract

`MedicalCoreState` is built ONLY from WardSynQ entities read through `wardsynq-temporal.js` at an
explicit `asOf`, or from `ICU_STATE` through an adapter. It is a plain object, deep-frozen, with no
identifiers.

```js
{
  schema: "medcore-state/1",
  asOf: "2026-09-19T10:04:00Z",     // the ONLY clock. Nothing later may be read.
  subjectKey: "<opaque, per-session, non-reversible>",  // never MRN, never patient_id
  demographics: {
    ageYears: 65,                    // ONLY from ageYears. Never derived from dob. HAZ-ML-04
    ageSource: "reported" | "derived-from-dob" | "unknown",
    sex: "M" | "F" | "other" | "unknown",
    weightKg: 72 | null
  },
  params: {
    // one entry per canonical parameter id, absent means never observed
    hr:      { value: 128, unit: "bpm", at: "...", ageMin: 6,  usable: true,  refusal: null },
    map:     { value: 55,  unit: "mmHg", at: "...", ageMin: 6, usable: true,  refusal: null },
    lactate: { value: 4.1, unit: "mmol/L", at: "...", ageMin: 190, usable: false,
               refusal: "STALE" },
    creat:   { value: null, unit: null, at: null, ageMin: null, usable: false,
               refusal: "UNIT_UNKNOWN", sourceValue: "2.1", sourceUnit: "umol/l?" }  // HAZ-ML-03
  },
  series: {
    // bounded history per parameter, oldest first, already artefact-filtered
    hr: [ { v: 98, at: "..." }, { v: 108, at: "..." }, { v: 119, at: "..." }, { v: 128, at: "..." } ]
  },
  interventions: {
    // presence and start time only, never dose inference
    vasopressor:  { active: true,  startedAt: "...", agents: ["noradrenaline"] },
    ventilation:  { active: false, mode: null, startedAt: null },
    oxygen:       { active: true,  device: "nasal_cannula", flowLpm: 4, fio2: null },
    rrt:          { active: false, startedAt: null }
  },
  windows: { lookbackHours: 24, seriesCapPerParam: 48 },
  provenance: {
    sources: ["ghis-adapter@<ver>", "manual"],
    unitNormalised: false,           // carried verbatim from the adapter contract
    builtBy: "medcore-state@<ver>"
  }
}
```

Rules that make this contract worth having:

1. **`asOf` is the whole leakage control.** The builder takes it as an argument and reads through
   `wardsynq-temporal.js` with it. There is no code path that reads "now".
2. **`ageMin` (minutes since observation) is carried, raw timestamps are not fed to the model.** See
   HAZ-ML-01: `ageMin` is the only recency feature permitted, and it is capped.
3. **An unusable value is not a value.** Stale, artefactual and unknown-unit observations carry
   `value: null` plus a `refusal` reason. Nothing downstream may coerce a refusal into a number.
4. **The raw survives**, exactly as the adapter contract requires: `sourceValue` and `sourceUnit`
   are kept on any parameter that was refused for a unit reason.
5. **No identifiers.** `subjectKey` exists to join a state to its own prior states inside one
   session. It is not stored, not transmitted, and not derivable back to an MRN.

Fit with existing structures: for WardSynQ patients the builder reads `Observation`,
`MedicationAdministration` and `ServiceRequest` entities; for today's ICU it reads `ICU_STATE`
through `mergedVitals()` and `state.labs.recent`, never `latestVitals()` or a bare `latestByTs()`.

## 6. Phase 1 — Deterministic Feature Layer (no ML)

This phase ships on its own, behind `smd_medcore`, and is the first clinician-visible value.

### 6.1 Patient State Snapshot
`medcore-state.js`: `buildState({ source, asOf, windows })`. Pure, no I/O, no DOM. Two adapters:
`fromWardSynQ(store, patientId, asOf)` and `fromIcuState(ICU_STATE, asOf)`. Every parameter passes
through `wardsynq-vitals.js` `scoreable()` before it enters `params`; the refusal reason is kept.

### 6.2 What Changed
`medcore-changes.js`: `changes(state, prevState | null)` returns a bounded, ranked list:

```js
[ { param: "map", direction: "down", from: 78, to: 55, overMin: 180,
    magnitude: "large", basis: "absolute+rate" } ]
```

Ranking is by clinical magnitude bands defined per parameter in `medcore/data/change-bands.json`
(seed, UNAPPROVED, carries `approvalStatus`), never by percentage change, because a 20 percent fall
in sodium and in heart rate are not the same event. Maximum 5 entries. A change computed across a
refused observation is not a change and is not reported.

### 6.3 Trend and Trajectory Features
`medcore-features.js`: `features(state, prevStates)` returns a flat `{ [featureId]: number|null }`
map plus a `featureSet` id and version. Per parameter, at most: current value, delta over 1h / 4h /
24h, slope over the window, min and max in window, `ageMin` (capped at 720), and a `present` flag.
Interventions contribute presence and hours-since-start. Derived: shock index, PF ratio when both
components are usable, pulse pressure, urine output mL/kg/h when weight is known.

**This is the only feature implementation in the project.** Training does not re-implement it; see
Phase 3.

### 6.4 Missing Information
`medcore-missing.js`: `missing(state, { needs })` where `needs` is the union of what the enabled
outcomes require and what `icu-autoscores.js` already reports through `{__missing:[...]}`. Output is
a deduplicated, human-readable list with a reason per item (`NEVER_RECORDED`, `STALE`,
`UNIT_UNKNOWN`, `REFUSED_ARTEFACT`). This is the item that makes the panel useful on day one.

### 6.5 Freshness and Staleness
No new staleness logic. Per-parameter windows are declared in `medcore/data/freshness.json` and
enforced by passing them into `wardsynq-vitals.js`. A parameter with no declared window is treated
as unusable rather than as fresh.

### 6.6 Unit and Semantic Normalisation
`medcore-units.js` + `medcore/data/units.json`: an explicit allow-list of `(parameter, unit)` pairs
with a single canonical unit per parameter and an exact conversion factor. Anything not in the list
is `UNIT_UNKNOWN` and the value becomes null. There is deliberately no heuristic, no string
similarity and no "probably mmol/L". HAZ-ML-03 exists because `wardToSI` in `icu.js` converts an
SI-labelled result back to conventional units and the GHIS adapter therefore refuses to normalise at
all; Medical Core is where normalisation finally happens, once, in a table a clinician can read.

Phase 1 exit: `node --test test/medcore-state.test.mjs test/medcore-changes.test.mjs
test/medcore-missing.test.mjs test/medcore-units.test.mjs` green, plus `test/run-medcore-ui.mjs`
driving the ICU panel in a real browser.

## 7. Phase 2 — V1 Clinical Outcomes

Five, not eight. Each is an event with a timestamp in the record, which is what makes it labellable.
"Respiratory deterioration" is not on this list because it cannot be adjudicated consistently.

| # | Outcome | Horizon | Required inputs (minimum usable set) | Label definition | Clinical workflow | Abstention requirement |
|---|---|---|---|---|---|---|
| MC-1 | Unplanned ICU transfer or ICU review request | 24 h | RR, SpO2, HR, SBP or MAP, temperature, consciousness | First ICU admission or documented ICU review request for a ward patient, excluding elective post-operative admission and admission planned before t0 | Raises evidence for an existing recognition prompt to the ward registrar | Any two of the six inputs unusable |
| MC-2 | Cardiac arrest or death | 24 h | Same as MC-1 | First in-hospital resuscitation call or death. Excludes patients with a documented do-not-resuscitate decision at t0, who are censored, not labelled negative | Highest-weight evidence on the same prompt. Never its own alert | Any two inputs unusable, or DNR status unknown |
| MC-3 | First vasopressor initiation | 12 h | MAP or SBP+DBP, HR, lactate if present, fluid balance if present | First vasopressor administration recorded in the eMAR. **Patients already on a vasopressor at t0 are excluded from the risk set** (HAZ-ML-02) | Evidence on a haemodynamic prompt; the deterministic shock rules remain authoritative | MAP unusable, or vasopressor status at t0 unknown |
| MC-4 | First invasive or non-invasive ventilation | 24 h | SpO2, RR, FiO2 or device+flow, consciousness | First recorded initiation of NIV or intubation. Already-ventilated patients excluded from the risk set | Evidence on a respiratory prompt | SpO2 or RR unusable, or oxygen device unknown |
| MC-5 | AKI KDIGO stage 2 or worse | 48 h | Creatinine with a usable baseline, urine output if charted, weight | KDIGO creatinine criterion against the documented baseline. Patients already at stage 2+ at t0 excluded | Evidence on a renal prompt plus a drug-review nudge through existing renal-dose logic | No usable creatinine baseline, or creatinine unit unknown |

Every outcome carries, in its definition file, the risk-set entry rule, the exclusion list, the
censoring rule and the look-back used to establish "first". These live in
`medcore/data/outcomes.json` with `approvalStatus: "unapproved"` until a named clinician signs each
one.

## 8. Phase 3 — Data Preparation

Gate (must be satisfied before any of this runs; not elaborated further here): a usable dataset,
written access approval, clinician-authored label definitions, an adjudication process for
ambiguous labels, and agreed leakage controls. If the gate is not met, Phase 1 still ships and the
project stops there.

Implementation, in `backend/medcore/`:

1. **Extract** into a de-identified, per-encounter event log. Identifiers replaced before the data
   leaves the hospital boundary.
2. **Prediction points.** For each encounter, sample `t0` on a fixed grid (every 4 h) plus at every
   new observation, then subsample. The grid matters: sampling only at observation times bakes in
   measurement frequency.
3. **State and features by replay.** `node backend/medcore/featurize.mjs` calls the SAME
   `medcore/medcore-state.js` and `medcore/medcore-features.js` with `asOf = t0` and emits the
   feature matrix as Parquet or CSV. **Python never implements a feature.** This removes train and
   serve skew as a class of bug.
4. **Splitting.** Patient-level grouping first, then temporal: train on the earliest period,
   validate on the middle, test on the most recent, with a washout so an encounter never spans two
   splits. Reported per split: n encounters, n prediction points, event rate.
5. **Leakage prevention.** Every read goes through the bi-temporal query at `t0`; a unit test
   asserts that shifting an amendment's `recordedAt` after `t0` removes it from the state.
6. **Treatment leakage (HAZ-ML-02).** Prevalent cases excluded from the risk set per Phase 2. A
   blanking window before the event removes features recorded in the final 60 minutes, where
   preparation for the treatment contaminates the state (a pressor charted as "prepared", a
   pre-intubation ABG). The blanking window is a declared constant, not a tuned hyperparameter.
7. **Measurement-frequency bias (HAZ-ML-01).** Banned features: observation counts, inter-
   observation intervals, total number of labs, nurse-check frequency, anything derived from them.
   Permitted: `ageMin` per parameter, capped at 720 minutes, and the `present` flag. Required
   evidence: a frequency-only model is trained and its AUROC reported in the bench report; if the
   full model does not beat it by a stated margin, the model is not a clinical model.
8. **Unit validation.** Every extracted value passes `medcore-units.js`. A site whose unit
   distribution contains more than 1 percent `UNIT_UNKNOWN` for a required parameter fails the
   extract, loudly, before training.
9. **Age validation (HAZ-ML-04).** `ageYears` only. Any record where age was derived from a `dob`
   that equals the `0000-00-00` sentinel, or that yields an age outside 0 to 120, is dropped and
   counted. The drop count is in the dataset card.
10. **Missingness.** Missing is a state, not a value. Every feature ships with its `present`
    indicator; no imputation of clinical values, ever. Median imputation for the model input is
    permitted ONLY alongside the indicator, and the imputation constants are frozen into the
    artifact.
11. **Adjudication.** A sample of at least 200 positives and 200 near-misses per outcome is reviewed
    by a clinician; disagreements resolve the written definition, and the definition file version is
    bumped. Inter-rater agreement is reported in the dataset card.

Output of this phase: a versioned dataset card (`backend/medcore/cards/<dataset>.md`) with n, event
rates, split boundaries, drop counts, unit distribution and adjudication agreement.

## 9. Phase 4 — Baseline Models

Strict order. Each stage must beat the previous one on the SAME split before the next is attempted.

1. **Deterministic baseline.** NEWS2 as it is already computed by `wardsynq-deterioration.js`,
   plus the single-parameter escalation rule. This is the incumbent and the bar.
2. **Logistic regression.** Regularised, on the Phase 1 features, one model per outcome. Exports as
   `{ featureIds, coefficients, intercept, imputations, calibration }`.
3. **Calibrated GBM.** Gradient-boosted trees, depth-limited, monotonic constraints where physiology
   demands them (rising lactate must not lower risk). Exports as a JSON tree ensemble.

**The decision rule for whether ML adds value at all**, evaluated on the held-out temporal test set,
per outcome, at an operating point fixed to the alert budget of the deterministic baseline (same
alerts per patient per day):

- Missed events reduced by at least 25 percent relative, or sensitivity improved at equal alert
  burden by an equivalent margin.
- Expected Calibration Error at or below 0.05, and calibration slope between 0.9 and 1.1.
- No subgroup (age band, sex, ward vs ICU, data-completeness quartile, site) with AUROC more than
  0.10 below the overall figure.
- Selective prediction improves monotonically: error at 80 percent coverage below error at 100
  percent coverage.
- Frequency-only model beaten by at least 0.05 AUROC (HAZ-ML-01).

An outcome that fails any of these does not ship. It is not tuned until it passes; the failure is
reported and the outcome is dropped from V1.

Bench harness: `node bench/medcore/run.mjs`, report at `bench/medcore/out/report.md`, following the
`bench/icu-monitor` convention, with `--ablate <featureGroup>` support.

**Parity.** `backend/medcore/export_artifact.py` emits, alongside every artifact,
`medcore/data/parity-vectors.json`: 100 feature vectors with the probability Python produced.
`test/medcore-parity.test.mjs` asserts the JS scorer reproduces each within 1e-6. An artifact
without passing parity vectors cannot be loaded by `medcore-models.js`.

## 10. Phase 5 — Calibration and Abstention

- **Calibration**: isotonic regression fitted on the validation split only, shipped inside the
  artifact as a monotonic lookup. Never fitted on test.
- **Confidence**: reported as the width of a bootstrap interval on the calibrated probability,
  precomputed per probability decile and stored in the artifact. It is a property of the model, not
  a second opinion from the model about itself.
- **Insufficient information**: deterministic and checked BEFORE the model runs. Each outcome
  declares its minimum usable input set in `outcomes.json`; if it is not met, the result is
  `INSUFFICIENT_INFORMATION` with the list of what is missing, and no probability is computed. This
  mirrors the existing NEWS2 rule that an incomplete score is reported incomplete and can never be
  reported as reassuring.
- **OOD**: Mahalanobis distance to the training feature distribution, per outcome, with the
  threshold set at the 99th percentile of the validation split and stored in the artifact. Beyond
  it, `ABSTAIN` with reason `OUT_OF_DISTRIBUTION`. Population refusals (under 16, pregnancy and
  puerperium) are delegated to the existing refusals in `wardsynq-deterioration.js`, not
  re-implemented.
- **Selective prediction**: the coverage and risk curve is a required figure in the bench report.
- Abstention is a first-class output, never a low probability, and never a suppressed decision.

## 11. Phase 6 — Decision Interface

One entry point: `decide(state, { outcomes, artifacts })` in `medcore-decide.js`. Pure, synchronous,
no DOM, no network, no clock.

```js
{
  schema: "medcore-decision/1",
  asOf: "2026-09-19T10:04:00Z",
  featureSet: "medcore-features@1.2.0",
  decisions: [
    { id: "MC-1", type: "BOOLEAN", status: "OK",
      probability: 0.34, confidence: { lo: 0.27, hi: 0.42 },
      horizonHours: 24, model: "mc1-gbm@0.3.1", calibration: "iso-val-2026-09" },

    { id: "MC-3", type: "BOOLEAN", status: "INSUFFICIENT_INFORMATION",
      missing: [ { param: "map", reason: "STALE", ageMin: 410 } ] },

    { id: "MC-5", type: "BOOLEAN", status: "ABSTAIN",
      reason: [ "OUT_OF_DISTRIBUTION" ], distance: 4.7, threshold: 3.1 }
  ],
  changed: [ /* medcore-changes.js output */ ],
  missingInformation: [ /* medcore-missing.js output */ ],
  provenance: { state: "medcore-state@1.0.0", artifacts: ["mc1-gbm@0.3.1", "mc3-lr@0.2.0"] }
}
```

Types: `BOOLEAN` (probability), `ORDINAL` (ordered level probabilities, reserved, unused in V1),
`CHOICE` (reserved, unused in V1), `REGRESSION` (reserved, unused in V1). Statuses: `OK`,
`INSUFFICIENT_INFORMATION`, `ABSTAIN`. There is no fifth status, and a missing decision is never
implied to be negative.

## 12. Phase 7 — Integration

| Existing module | How Medical Core connects | What Medical Core must NOT do |
|---|---|---|
| `wardsynq-events.js` | `medcore-boot.js` subscribes to observation, medication-administration and device events; debounces to at most one evaluation per patient per 60 s; emits `medcore.decision` back onto the bus | Own a queue, retry, or its own delivery semantics |
| `wardsynq-recognition.js` | A decision above an outcome's declared threshold is supplied as EVIDENCE to raise a prompt, carrying the evidence timestamp so `pinsTimeZero` is correct | Raise an alert, deduplicate, or decide who is asked |
| `wardsynq-orchestrator.js` | Untouched. It sees only the prompt, with its existing `alertId` / `noticeId` / `patientId` identity | Send anything, or create a second alert identity |
| `wardsynq-safety.js` | Remains authoritative. A Medical Core probability never gates, relaxes or overrides a deterministic rule | Contribute any rule |
| `wardsynq-shadow.js` | Reused as the pattern and, where possible, the mechanism: Phase 8 installs the evaluator from outside, discards its output, counts failures | Modify any host file to observe |
| `wardsynq-mlops.js` | Every artifact is registered here; shadow, drift, subgroup gate and rollback are its decisions, not Medical Core's | Implement drift, subgroup metrics or rollback |
| `calculators.js` / `icu-autoscores.js` | Read-only consumers for `missing()` needs and for the deterministic baseline. **Add the missing CAM-ICU calculator here**, not in Medical Core | Recompute any score |
| `wardsynq-critical.js` | Untouched. Critical results remain a deterministic closed loop | Participate in critical-result handling |
| ICU UI | ONE panel added in `icu.js` `injectCSS()` and the existing render path, flag-gated, showing "what changed" and "missing information" first and at most ONE risk line, with correlated systems as its evidence | Add a CSS file, a colour vocabulary, or four HIGH rows |
| MaiK / RAG | Unchanged path: a clinician taps Review with MaiK, the existing de-identified `StewardRAG.buildPackage` -> `SMD_AI.explainGrounded` runs | Call a model on its own, or send state anywhere |

## 13. Phase 8 — Shadow Deployment

Flag `smd_medcore_shadow`, default OFF, installed with the `wardsynq-shadow.js` pattern so that not
loading `medcore-boot.js` removes the change completely.

- **Logged** (device-local ring buffer, no identifiers, exported only by an explicit owner action):
  decision id, status, calibrated probability decile, abstention reason, which inputs were unusable
  and why, feature-set and artifact versions, evaluation latency, and the deterministic baseline's
  verdict at the same `asOf`.
- **Compared**: Medical Core against the deterministic baseline at the same instant, and against
  the eventual recorded outcome when one exists.
- **False positives**: counted as decisions above threshold with no event in the horizon, reported
  as alerts per patient per day at the fixed operating point, next to the baseline's own number.
- **False negatives**: every missed event triggers a stored feature snapshot at the missed `t0` for
  review; these are the cases a clinician reads, not the aggregate.
- **Alert burden**: measured as the DELTA in prompts that would have been raised, not as Medical
  Core's own count. A net increase in prompts is a failure even if accuracy improved.
- **Subgroups, drift, rollback**: `wardsynq-mlops.js` decides. Medical Core registers the artifact
  and reports inputs to it.
- Shadow means the output reaches nobody. No panel, no prompt, no log line a clinician can see.

Minimum shadow duration before any clinician-visible evaluation: whichever is later, 90 days or
300 observed events for the rarest enabled outcome.

## 14. Phase 9 — Compact Neural Model (only if justified)

Promotion criteria, all required, on the same temporal test split:

1. GBM has already passed every Phase 4 gate and completed a full shadow period.
2. The residual error is demonstrably temporal: a sequence-aware model beats the tabular GBM by at
   least 0.02 AUPRC with ECE no worse, on the SAME features plus raw series.
3. Training set has at least 50,000 labelled prediction points and 1,000 positives for the outcome
   in question. Below that, no neural model is trained, regardless of how well it scores.
4. On-device p95 latency stays under 50 ms per evaluation for all enabled outcomes combined.
5. Artifact size and load time fit the existing on-demand asset strategy (`vault/Roadmap.md`,
   install size), served from `models.stewardmd.in` like the MaiK Lite and KardiQ X packs.

Only then: a compact temporal encoder (GRU or a 2 to 4 layer attention encoder over the parameter
series) with per-outcome heads, sized by criterion 3 and benchmarked against the GBM. Runtime reuses
the existing ONNX path (`kardiox-ort.js`, `thorex-ort.js` are the reference implementations). No
parameter count is prescribed here, and none should be chosen before criterion 3 is measured.

## 15. Phase 10 — RLCD-Inspired Optimization (optional, deferred)

Deferred by default. Supervised training plus isotonic calibration plus a declared abstention policy
already delivers calibrated probabilities with honest refusals, which is the entire clinical
requirement.

Revisit only if shadow shows a specific failure this would fix: probabilities that are individually
well calibrated but systematically overconfident on the cases where abstaining would have been
right, meaning the abstention policy cannot be tuned to fix it. In that case the objective adds
rewards for proper scoring, calibration and useful abstention alongside correctness, and is compared
against the supervised baseline on the identical split. If it does not beat it, it is discarded.

This is our own calibrated-decision stage. It does not reproduce, and must not be described as
reproducing, any vendor's training method.

## 16. Safety and Hazard Requirements

Added to the hazard table in `wardsynq/wardsynq-safety-case.js` and to the suites cross-referenced
by `scripts/wardsynq-assurance.mjs`. No parallel safety system.

| Id | Hazard | Control | Verification |
|---|---|---|---|
| HAZ-ML-01 | Measurement-frequency shortcut: the model learns how often a patient was observed | Banned feature list enforced in `medcore-features.js`; only capped per-parameter `ageMin` and `present` permitted; frequency-only model trained and reported | `test/medcore-shortcut.test.mjs` asserts the shipped artifact's `featureIds` contain no banned id; bench report must carry the frequency-only comparison |
| HAZ-ML-02 | Treatment paradox: outcomes are contaminated by the care already delivered | Prevalent cases excluded from the risk set; pre-event blanking window; treatment features excluded inside the window | `test/medcore-labels.test.mjs` asserts a patient already on a vasopressor at t0 is excluded from MC-3, and that a feature inside the blanking window is dropped |
| HAZ-ML-03 | `wardToSI` conversion: SI-labelled results converted back to conventional units, and adapter values carrying `unitNormalised: false` | Explicit `(parameter, unit)` allow-list; unknown unit yields null plus `UNIT_UNKNOWN`; no heuristic conversion exists in the codebase | `test/medcore-units.test.mjs` asserts an unknown unit is refused and never coerced, and that `sourceValue` / `sourceUnit` survive on the refused parameter |
| HAZ-ML-04 | `dob` is an age: GHIS sends age in years as a string, sentinel `0000-00-00` | `ageYears` is the only age source; no code path derives age from `dob`; age outside 0 to 120 is dropped | `test/medcore-age.test.mjs` asserts a record carrying the sentinel yields no age and an `INSUFFICIENT_INFORMATION` decision, never an age near 1981 |

Standing requirements:

- `smd_medcore` default OFF, registered in `vault/Flags.md` with its reason. `smd_medcore_shadow`
  default OFF. A git tag before the first integration commit.
- No autonomous treatment or diagnostic action. There is no code path from a probability to an
  order, a dose, or a prescription change.
- Deterministic rules, scores and refusals remain authoritative everywhere they disagree with a
  model output.
- Abstention is safe behaviour and is never penalised in the UI, the metrics or the operating point.
- Full auditability: every decision carries `featureSet`, artifact versions, calibration id and
  `asOf`, and can be recomputed from the stored state.
- No PHI leaves the device for inference. There is no Medical Core service.

## 17. Exact Files and Modules

### New files

| File/module | Action | Purpose |
|---|---|---|
| `medcore/medcore-state.js` | create | `buildState()`, `fromWardSynQ()`, `fromIcuState()`; the canonical input contract |
| `medcore/medcore-units.js` | create | Unit allow-list, canonicalisation, refusal. HAZ-ML-03 |
| `medcore/medcore-features.js` | create | The single feature implementation; banned-feature enforcement. HAZ-ML-01 |
| `medcore/medcore-changes.js` | create | What changed, ranked by clinical magnitude bands |
| `medcore/medcore-missing.js` | create | Missing information, unioned with `icu-autoscores.js` `__missing` |
| `medcore/medcore-models.js` | create | Artifact registry, version pinning, parity-vector gate, integrity check |
| `medcore/medcore-decide.js` | create | Typed decision contract and scorer; the one entry point |
| `medcore/medcore-calibration.js` | create | Isotonic lookup, confidence intervals, OOD distance, abstention |
| `medcore/data/units.json` | create | Parameter and unit allow-list with conversion factors |
| `medcore/data/freshness.json` | create | Per-parameter staleness windows passed to `wardsynq-vitals.js` |
| `medcore/data/change-bands.json` | create | Clinical magnitude bands, UNAPPROVED seed |
| `medcore/data/outcomes.json` | create | The five outcomes: horizon, minimum inputs, risk set, exclusions, thresholds, approval status |
| `medcore/data/parity-vectors.json` | create (generated) | 100 vectors with Python-produced probabilities |
| `medcore-flags.js` | create | `SMD_MEDCORE_FLAGS`, repo-root module-flag convention |
| `medcore-boot.js` | create | Event-bus subscription, debounce, shadow install from outside |
| `backend/medcore/` | create | `config.py`, `dataset.py`, `labels.py`, `leakage_checks.py`, `train_baselines.py`, `calibrate.py`, `evaluate.py`, `export_artifact.py`, `featurize.mjs`, `cards/` |
| `bench/medcore/run.mjs` | create | Benchmark harness, `out/report.md`, `--ablate` |
| `test/medcore-state.test.mjs` | create | State builder, `asOf` leakage, refusal propagation |
| `test/medcore-units.test.mjs` | create | HAZ-ML-03 |
| `test/medcore-age.test.mjs` | create | HAZ-ML-04 |
| `test/medcore-features.test.mjs` | create | Feature values, capping, determinism |
| `test/medcore-shortcut.test.mjs` | create | HAZ-ML-01 banned-feature assertion |
| `test/medcore-labels.test.mjs` | create | HAZ-ML-02 risk set and blanking window |
| `test/medcore-changes.test.mjs` | create | Ranking, refusal handling, bounded output |
| `test/medcore-missing.test.mjs` | create | Union with autoscores, reason codes |
| `test/medcore-decide.test.mjs` | create | Decision contract, statuses, provenance |
| `test/medcore-parity.test.mjs` | create | JS and Python agree within 1e-6 |
| `test/run-medcore-ui.mjs` | create | Real-browser test of the ICU panel |

### Existing files to modify

| File/module | Action | Purpose |
|---|---|---|
| `icu.js` | modify | One flag-gated panel in the existing render path; styles inside `injectCSS()`; reads only `mergedVitals()` |
| `calculators.js` | modify | Add the missing CAM-ICU calculator (unrelated to ML, closes the gap the review found) |
| `wardsynq/wardsynq-safety-case.js` | modify | Add HAZ-ML-01 to HAZ-ML-04 rows |
| `scripts/wardsynq-assurance.mjs` | modify | Include `test/medcore-*.test.mjs` in the cross-reference |
| `scripts/build-www.sh` | modify | Ship `medcore/`, `medcore-flags.js`, `medcore-boot.js` into `www/` |
| `index.html` | modify | Load `medcore-flags.js` and `medcore-boot.js` with the `?v=goldNNN` token |
| `package.json` | modify | Test script glob picks up `test/medcore-*.test.mjs` |

### Docs to update

| File | Action |
|---|---|
| `vault/modules/Medical Core.md` | this document, kept current as phases land |
| `vault/Home.md` | add Medical Core under AI |
| `vault/Flags.md` | register `smd_medcore` and `smd_medcore_shadow`, both OFF, with reasons |
| `vault/Roadmap.md` | the data gate as a people-blocked item, phases as engineering items |
| `vault/decisions/Decisions.md` | one entry: on-device inference, baselines before transformers, five outcomes, features implemented once |
| `MEDICAL_CORE_PLAN_REVIEW.md` | leave as the record of why this plan differs from the original |

## 18. Implementation Order

1. Create `medcore-flags.js` with `smd_medcore` and `smd_medcore_shadow`, both default OFF; register
   both in `vault/Flags.md`. Tag the repo (`medcore-pre-integration`).
2. Write `medcore/data/units.json` and `medcore/medcore-units.js` with `test/medcore-units.test.mjs`.
   HAZ-ML-03 first, because everything downstream depends on a value being trustworthy.
3. Write `medcore/data/freshness.json` and `medcore/medcore-state.js` (`fromIcuState` only) with
   `test/medcore-state.test.mjs`, including the `asOf` leakage test and the HAZ-ML-04 age test
   (`test/medcore-age.test.mjs`).
4. Write `medcore/medcore-missing.js` with `test/medcore-missing.test.mjs`, unioning the existing
   `icu-autoscores.js` `{__missing:[...]}` output.
5. Write `medcore/data/change-bands.json` and `medcore/medcore-changes.js` with
   `test/medcore-changes.test.mjs`.
6. Add the flag-gated ICU panel in `icu.js` (what changed, missing information; no risk line yet),
   styles inside `injectCSS()`. Add `test/run-medcore-ui.mjs`. Wire `scripts/build-www.sh` and
   `index.html`.
7. **Phase 1 ships here.** Deterministic value, no model, flag OFF by default. Update
   `vault/modules/Medical Core.md`, `vault/Home.md`, `vault/decisions/Decisions.md`.
8. Add `medcore/medcore-state.js` `fromWardSynQ()` reading through `wardsynq-temporal.js`; extend
   `test/medcore-state.test.mjs`.
9. Write `medcore/medcore-features.js` plus the banned-feature list, with
   `test/medcore-features.test.mjs` and `test/medcore-shortcut.test.mjs`.
10. Add HAZ-ML-01 to HAZ-ML-04 to `wardsynq/wardsynq-safety-case.js`; extend
    `scripts/wardsynq-assurance.mjs`; confirm the assurance run still reports cleanly.
11. Write `medcore/data/outcomes.json` for the five outcomes with `approvalStatus: "unapproved"`,
    and `test/medcore-labels.test.mjs` for the risk sets and blanking windows (HAZ-ML-02).
12. **Data gate.** Stop unless dataset, approval, label definitions, adjudication and leakage
    controls are all in place.
13. Build `backend/medcore/` extract, prediction-point sampling and `featurize.mjs` calling the
    shipped JS feature code; produce the dataset card.
14. Run leakage, unit, age, frequency and prevalence checks; fail the extract loudly on any breach.
15. Train the deterministic baseline, then logistic regression, then the GBM; produce
    `bench/medcore/out/report.md` with every Phase 4 metric per outcome.
16. Drop every outcome that fails a Phase 4 gate. Export artifacts plus parity vectors.
17. Write `medcore/medcore-models.js`, `medcore/medcore-calibration.js`, `medcore/medcore-decide.js`
    with `test/medcore-decide.test.mjs` and `test/medcore-parity.test.mjs`.
18. Write `medcore-boot.js`: event-bus subscription, 60 s debounce, shadow install from outside.
19. Register artifacts with `wardsynq/wardsynq-mlops.js`; run shadow with `smd_medcore_shadow`.
20. Run the shadow period. Review every false negative with a clinician. Report alert-burden delta,
    subgroups and drift through the existing MLOps surface.
21. Only then: propose the clinician-visible evaluation, with the risk line added to the panel as
    one line with its evidence.

## 19. Definition of Done

**OFF to shadow** requires all of: every `test/medcore-*.test.mjs` suite green; HAZ-ML-01 to
HAZ-ML-04 reported verified by `scripts/wardsynq-assurance.mjs`; parity vectors passing; a dataset
card with adjudication agreement; every enabled outcome passing every Phase 4 gate; artifacts
registered in `wardsynq-mlops.js`; and the shadow path demonstrably unable to reach a clinician
(no panel, no prompt, no visible log).

**Shadow to clinician-visible evaluation** requires all of: the minimum shadow duration met (90 days
or 300 events for the rarest enabled outcome, whichever is later); prospective calibration holding
at ECE 0.05 or better; no subgroup failure by the Phase 4 definition; a net alert-burden delta at or
below zero at the proposed operating point; every false negative reviewed; no drift-triggered
rollback in the final 30 days; and a NAMED clinician signing `outcomes.json` and
`change-bands.json` to `approvalStatus: "approved"`.

**Clinician-visible evaluation to production consideration** requires all of: a controlled
evaluation with recorded usefulness, override and acknowledgement rates; no increase in missed
events versus the deterministic baseline; the owner's decision recorded in
`vault/decisions/Decisions.md`; and the relevant committee accepting the evidence. Nothing in this
plan grants CLINICALLY APPROVED status; only that committee does.

## 20. Explicit Non-Goals

Not building: a new alert engine; a new MLOps, drift, subgroup or rollback system; a new safety
engine or rule framework; a new calculator framework; a second notification or escalation path; a
Medical Core service, server or application; autonomous diagnosis; autonomous treatment, dosing or
prescription change; a large model by default; a second RAG or a second MaiK; a parallel
architecture document; a second idea of what "current", "delivered" or "deployable" means.

---

## NEXT STEP

Create `medcore-flags.js` with `smd_medcore` and `smd_medcore_shadow` both default OFF, register both
in `vault/Flags.md` with their reasons, and tag the repo `medcore-pre-integration`. That is step 1
and it touches no clinical path.
