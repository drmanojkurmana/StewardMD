# WardSynQ (Clinical OS / EMR)

Hospital Clinical OS and EMR **inside StewardMD**, not a separate repo or product codebase.
`wardsynq.com` is its web surface. Owner decision 2026-09-04. Spec: `~/Downloads/implementation_planfinal.md`.

STATUS: **P0 complete, unwired.** Model, event bus, eMAR, persistence, MPI and the deterministic
safety engine exist and are tested (127 tests). Nothing is wired to the app, nothing is flagged on,
no UI, no route. Not reachable by any user. The clinical content in the safety engine is UNAPPROVED
seed data (see below) and must not gate a real order until pharmacy signs it off.

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

## Not built yet

`wardsynq-safety-case.js`, `wardsynq-temporal.js` (the bi-temporal QUERY engine; P0 only carries the
fields), `wardsynq-interop.js` (the Integration Hub), and every specialty, enterprise, MLOps and UI
file. Also unbuilt: the `ghis-ward.js` adapter migration described above.
