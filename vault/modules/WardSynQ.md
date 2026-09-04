# WardSynQ (Clinical OS / EMR)

Hospital Clinical OS and EMR **inside StewardMD**, not a separate repo or product codebase.
`wardsynq.com` is its web surface. Owner decision 2026-09-04. Spec: `~/Downloads/implementation_planfinal.md`.

STATUS: **P0 complete, P1 in progress.** 493 tests across 19 suites. The clinical workstation UI
exists at `wardsynq/ui/` and is wired to a `GovernedStore`, but it is behind no route in the mobile
app and is not reachable by any user. All clinical content (interaction, allergy, dose ceiling and
critical threshold packs) is UNAPPROVED seed data and must not gate a real order until pharmacy and
the relevant committee sign it off.

The safety case is executable: `node scripts/wardsynq-assurance.mjs` runs the real suites and
cross-references the hazard table against what actually passed. It currently reports **11 of 13
verified, 2 partial**. Read the caveats; the summary line alone is not the state of the system.

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

Existing StewardMD mobile behaviour must keep working while it migrates onto this layer.

**The adapter now exists** (`wardsynq/adapters/wardsynq-ghis-adapter.js`, 23 tests) and is the
reference implementation for every adapter that follows. **The cut-over has NOT happened**:
`ghis-ward.js` and `icu.js` are untouched and still own the live path. The adapter is pure mapping
only. It does no fetching, holds no GHIS token, and touches no live state; `ghis-ward.js` keeps
transport, the bearer token, the 401 silent refresh and the patient picker. That split is on
purpose: transport and auth change per site, mapping has to be verifiable in a test without a
network.

### Three traps in the GHIS payload (surveyed 2026-09-04, all pinned by tests)

1. **`dob` IS AN AGE.** GHIS sends age in years as a string (`"45"`). Parsed as a date it yields a
   patient born in the year 45. Age drives weight-based paediatric dosing, so this is a dosing
   hazard, not a display bug. The adapter records `ageYears` and leaves `dob` as the sentinel
   `0000-00-00`, which deliberately does not parse as a date. Related: `vault/modules/Insulin.md`
   records an earlier "pediatric-flag-not-a-fake-age" fix, so this family of bug has bitten before.
2. **`wardToSI` does not convert to SI.** Despite the name, `icu.js` converts an SI-labelled result
   *back* to conventional units. The adapter therefore does NOT normalise units at all: it stores
   value and unit exactly as reported with `unitNormalised: false`, and keeps `sourceValue` and
   `sourceUnit` verbatim. A silently mis-converted electrolyte is worse than an unconverted one.
3. **`patientId` is the MRN.** There is no separate UHID anywhere in the payload. `episodeId` is a
   visit, not a person.

### Adapter contract every future adapter must meet

- **Stable ids.** Built only from source-stable parts, never from ingestion time, so a reconnect or
  offline replay versions a record instead of duplicating it.
- **Nothing silently dropped.** An unmapped test keeps its original name and raises an `issue`; one
  bad row never discards the rest of the import; junk input never throws.
- **The raw survives.** `sourceTestName`, `sourceValue`, `sourceUnit` are always kept, so a mapping
  error is recoverable from the record without the source system being reachable.
- **No invented clinical values.** A non-numeric result stays a string, an unparseable date becomes
  null plus an issue, an unreported scan is `preliminary` not `final`.
- **Source assertions do not become controls.** GHIS's own `critical` flag is carried as
  `sourceCritical` and gates nothing; critical-value escalation belongs to the safety engine.

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
- `wardsynq/wardsynq-store.js` — append-only persistence. `MemoryBackend` (Node, tests) and
  `IndexedDBBackend` (browser) behind one interface. Every `put` writes a NEW version and keeps all
  prior ones; `get` returns the latest, `history` returns all. Deep-copies on read and write so a
  caller cannot mutate stored state through a shared reference. `transaction(fn)` is all-or-nothing.
- `wardsynq/wardsynq-mpi.js` — Master Patient Index. `jaroWinkler`, `soundex`, `normalizeName`
  (verified against published reference values), Fellegi-Sunter style `scoreMatch` with a readable
  `breakdown`, `findCandidates` for live registration, `makeProvisionalIdentity` for unidentified
  trauma arrivals, and a REVERSIBLE `merge` / `unmerge` pair that round-trips deep-equal.
- `wardsynq/wardsynq-safety.js` — the deterministic safety engine. Allergy shield, interactions,
  dose ceilings, renal adjustment. Pure, injected rule pack, no drug data of its own.
- `wardsynq/adapters/wardsynq-rules-stewardmd.js` — maps StewardMD's existing
  `data/interaction-rules.json` into a WardSynQ rule pack. Adapter, not core.
- `wardsynq/data/allergy-classes.seed.json` — UNAPPROVED allergy class and cross-reactivity seed.
- Tests: `wardsynq-p0-core` 44, `wardsynq-store` 19 (+1 skipped in Node), `wardsynq-mpi` 27,
  `wardsynq-safety` 37. Total 127. `node --test test/wardsynq-*.test.mjs`.

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

## The safety engine, and what is real in it

**The mechanism is real. Most of the clinical content is not yet approved.** Keep these apart when
judging what this can be trusted with.

REUSED, not re-authored: `data/interaction-rules.json` already existed in StewardMD, 310 curated
rules and 2620 generic-to-class mappings derived from ONC HPDDI, openFDA SPL, CredibleMeds and
RxNorm, with its own tests (`test/interaction-*.test.mjs`, `interactions.js`). WardSynQ points at it
through the adapter rather than growing a second, divergent copy. **Check the CredibleMeds licence
before any commercial deployment.**

AUTHORED AS UNAPPROVED SEED, because StewardMD had nothing:
- `wardsynq/data/allergy-classes.seed.json` — allergy class membership and cross-reactivity. A
  survey on 2026-09-04 found NO allergy cross-reactivity data anywhere in the repo, which meant the
  Allergy Shield had nothing to run on. Beta-lactam figures follow the modern side-chain view, not
  the discredited 10 percent penicillin-to-cephalosporin figure. Needs Allergy Committee sign-off.
- `DOSE_LIMITS_SEED` in the adapter — eight drugs. StewardMD's max doses live only in free-text
  monograph strings ("Max 4 g/day (3 g if hepatic risk)") which must NOT be regex-parsed into a
  safety control. A short honest table is safe where a long guessed one is not. Needs pharmacy
  sign-off.

**GOTCHA that will bite again: two drug vocabularies.** StewardMD's RxNorm-derived data spells
amoxicillin `"amoxicillin anhydrous"`; clinicians and allergy lists write `"amoxicillin"`. Found by
an integration test that expected an amoxicillin order to trip a penicillin allergy and watched the
shield fail open. Handled by `buildFirstWordAliases()` in the adapter, which aliases a multi-word
generic's first word to it ONLY when exactly one generic in the pack starts with that word, and
allergy class membership is indexed under BOTH spellings. Where a first word is ambiguous
("penicillin" leads to both "penicillin g" and "penicillin v") no alias is made and the drug stays
unresolved, which is reported rather than guessed. Any new data source needs the same treatment.

**Performance is load-bearing, not incidental.** `resolveGeneric` tokenises and does Set lookups. An
earlier scan-every-key-with-a-regex version measured a p95 of 115 ms against the 10 ms budget with
100 concurrent drugs. The budget is pinned by a test.

## Bi-temporal queries

`wardsynq/wardsynq-temporal.js` (14 tests) answers the two questions a medico-legal record has to
separate: **what did we believe at time T**, and **what was actually true at time T**. A potassium
recorded as 4.0 at 10:00 and corrected to 6.5 at 14:00 must still be able to show that the chart
said 4.0 at noon, because that is what the clinician acted on. `asOf({knownAt, effectiveAt})` takes
both axes; `corrections()` is the chart-audit view; `timeline()` gives effective-time intervals with
adjacent identical versions merged.

Pure functions over arrays of versions. It deliberately does NOT import the store, so the seam
between them is covered by explicit integration tests that run the engine over real store output
rather than fixtures.

## Clinical safety controls (P0 and P1)

Each is a module plus an adversarial suite, and each is argued against a row in the executable safety
case. Run `node scripts/wardsynq-assurance.mjs` for the current table; it runs the real suites and
cross-references them, so a renamed or deleted test shows as MISSING TEST rather than staying green.

| Module | Hazard | Notes |
| --- | --- | --- |
| `wardsynq-safety.js` | HAZ-MED-01/02/03 | Interactions, allergy shield, dose ceilings. Rule pack is injected; the StewardMD adapter maps the existing 310-rule DDI data. |
| `wardsynq-meds.js` | HAZ-MED-04 | eMAR state machine, five rights, fail-closed without a safety engine. |
| `wardsynq-critical.js` | HAZ-DIAG-01 | Closed-loop critical results. An unassessable paediatric result raises rather than vanishes. |
| `wardsynq-transfusion.js` | HAZ-BLD-01 | Red cell and plasma tables are inverse; bedside check re-derives from the physical bag. |
| `wardsynq-surgical.js` | HAZ-SURG-01 | WHO checklist as a hard gate, three different role signatures, laterality re-asserted against the booking. |
| `wardsynq-actors.js` | HAZ-AI-01, HAZ-ID-01 | Four-tier actor model with a ceiling by KIND. `GovernedStore` is what the UI holds. |
| `wardsynq-iomt.js` | HAZ-DEV-01 | Positive association, derived artefact, `scoreable()` as the only entry for automated scores. |
| `wardsynq-offline.js` | HAZ-DOWN-01 | Durable-before-resolve journal, three-way merge reconciliation. |
| `wardsynq-paediatrics.js` | (supports MED-03, DIAG-01) | Age banding. An unbanded range means adult and is REFUSED for a child rather than approximated. |
| `wardsynq-deterioration.js` | HAZ-DET-01 (local, PARTIAL) | NEWS2. A missing parameter is INCOMPLETE, never zero. |
| `wardsynq-emergency.js` | HAZ-TIME-01 (local, PARTIAL) | Sepsis/STEMI/arrest bundles. Time zero is immutable and pinned in both directions. |
| `wardsynq-recognition.js` | (closes TIME-01's trigger) | Prompts a human; never opens a bundle itself. |
| `wardsynq-notify.js` | (infrastructure) | The single definition of delivery. Attempted is not delivered. |

Two hazards are LOCAL: they are not in the spec's assurance table and were added because the omission
was real. Both are PARTIAL and both lower the verified fraction rather than raising it.

## The honest state of it

VERIFIED in the safety case means the named tests pass. It does not mean the control is clinically
adequate and it does not mean the clinical content is approved. Nothing in this build is CLINICALLY
VALIDATED or CLINICALLY APPROVED, the threshold, allergy and dose packs are marked seed content, and
`report()` prints that unconditionally so nobody can read the table without it.

The largest single gap is that NO NOTIFICATION TRANSPORT IS SHIPPED. Every channel is a function a
site supplies and this build supplies none, which is why both local hazards are PARTIAL. The modules
refuse rather than pretend: a monitor with no channel will not raise.

## Not built yet

The `ghis-ward.js` cut-over, still the biggest remaining piece of the owner's architecture: moving
the live mobile path onto the adapter. `wardsynq-shadow.js` exists for it and `icu.js` is untouched;
it awaits a shadow run against real ward data (`?wardsynq_shadow=1`, then check
`SMD_WARDSYNQ_SHADOW.report().clean`).

Also unbuilt: obstetrics and the ICU flowsheet; all of P2 (enterprise/RCM, quality measures,
incidents, research de-identification, API gateway) and P3 (MLOps, SecOps, digital twin); a second UI
screen to prove the design system scales. Production gaps beyond the transport: no service worker for
the workstation, a CDN webfont, and no barcode hardware, so every scan is a supplied value.
