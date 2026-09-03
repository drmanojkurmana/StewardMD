# WardSynQ (Clinical OS / EMR)

Hospital Clinical OS and EMR **inside StewardMD**, not a separate repo or product codebase.
`wardsynq.com` is its web surface. Owner decision 2026-09-04. Spec: `~/Downloads/implementation_planfinal.md`.

STATUS: **P0 scaffolding only.** Domain model, event bus and eMAR state machine exist and are
tested. Nothing is wired to the app, nothing is flagged on, no UI. Not reachable by any user.

## Ward Sync and WardSynQ are ONE system

The existing "Ward Sync" (GIMSR GHIS integration: `ghis-ward.js`, plus `wardSync` state in `icu.js`,
`medlist.js`, `autofetch.js`, `pro-notice.js` paywall key `"wardsync"`) is **not a parallel feature**.
It is the first hospital-data adapter of WardSynQ, and will move under the Integration Hub:

```
GHIS / existing Ward Sync connector      <- adapter (site-specific)
  -> WardSynQ canonical clinical model   <- wardsynq/wardsynq-model.js
  -> Clinical Event Bus                  <- wardsynq/wardsynq-events.js
  -> Safety / Workflow / AI / Patient 360 / EMR
```

**INVARIANT: no adapter-specific logic in WardSynQ core.** GHIS lab-name mapping, GHIS unit
conversion, GHIS session/token handling and the GIMSR patient picker belong in the adapter. The core
must stay meaningful if every current adapter were replaced. Future adapters (HL7 v2, FHIR R4,
DICOM/DICOMweb, LIS, ABDM, IoMT) plug in the same way.

Existing StewardMD mobile behaviour must keep working while it migrates onto this layer. The
migration of `ghis-ward.js` has **not** started; it is its own reviewed change against live code.

## Files (P0)

- `wardsynq/wardsynq-model.js` — canonical entities: Patient, Encounter, Condition,
  AllergyIntolerance, Observation, MedicationOrder, MedicationAdministration, ServiceRequest,
  DiagnosticReport, CarePlan, ClinicalNote. Every entity carries a `meta` envelope:
  `recordedAt` / `effectiveAt` / `amendedAt` (bi-temporal axes), `source` (which system produced it)
  and `derivedFrom` (lineage parents). Required clinical identifiers throw on construction rather
  than producing a half-valid record.
- `wardsynq/wardsynq-events.js` — `ClinicalEventBus`: vector-clock stamping, idempotent emit,
  bounded retry, dead-letter queue. Adapters emit here; they never call safety/workflow code directly.
- `wardsynq/wardsynq-meds.js` — closed-loop eMAR: `ORDERED -> VERIFIED -> DISPENSED -> SCANNED ->
  ADMINISTERED`, with `HELD` / `REFUSED` / `CANCELLED` exits. Five-rights bedside check, append-only
  audit trail, high-alert second-nurse witness.
- `test/wardsynq-p0-core.test.mjs` — 44 tests. `node --test test/wardsynq-p0-core.test.mjs`.

## Design rules worth not re-litigating

**The eMAR contains no clinical pharmacology.** No interaction matrix, no dose ceilings, no allergy
subsumption, no renal adjustment. `wardsynq-meds.js` decides "has this dose passed every workflow
gate"; the injected `safetyCheck` hook decides "is this dose clinically safe". Mixing them is how a
workflow refactor silently weakens a clinical control. The safety engine itself
(`wardsynq-safety.js`) is NOT written yet.

**The default safety hook refuses everything** (`denyWithoutSafetyEngine`). With no engine wired in,
the correct behaviour for a medication system is to refuse to administer, not to wave doses through.
A caller that genuinely wants no checking has to say so explicitly.

**`ADMINISTERED` is reachable only from `SCANNED`.** Skipping the bedside scan is the wrong-patient
hazard, so the state machine refuses it structurally rather than by convention. A `HELD` dose
likewise cannot resume straight to `ADMINISTERED`; it goes back through the scan.

**A missing scan is a failure, not a skip.** No wristband barcode = right-patient fails. Identity
also requires `patient.id === order.patientId`: a matching band on the wrong chart is still
wrong-patient. Dose unit mismatch is a dose failure (500 mcg is not 500 mg).

**Every eMAR mutation returns a promise**, including ones whose guard clause fails immediately, so a
refusal always arrives as a rejection and never as an uncaught synchronous throw.

**Duplicate events do not tick the vector clock.** A redelivered event (adapter reconnect, sync
replay) is not a new causal step; ticking for it makes ordering comparisons lie.

## Not built yet

Everything else in the spec. Named explicitly because the file list looks more complete than it is:
`wardsynq-safety.js`, `wardsynq-safety-case.js`, `wardsynq-temporal.js` (the bi-temporal QUERY engine
- P0 only carries the fields), `wardsynq-mpi.js`, `wardsynq-store.js` (no persistence at all yet),
`wardsynq-interop.js` (the Integration Hub), and every specialty, enterprise, MLOps and UI file.
The spec routes the clinical-safety files to Opus-level review; they must not be filled in as a side
effect of scaffolding.
