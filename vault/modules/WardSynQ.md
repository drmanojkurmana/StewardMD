# WardSynQ (Clinical OS / EMR)

Hospital Clinical OS and EMR **inside StewardMD**, not a separate repo or product codebase.
`wardsynq.com` is its web surface. Owner decision 2026-09-04. Spec: `~/Downloads/implementation_planfinal.md`.

STATUS: **P0 to P3 built.** The clinical workstation UI exists at `wardsynq/ui/` and is wired to a
`GovernedStore`, but it is behind no route in the mobile app and is not reachable by any user. All
clinical content (interaction, allergy, dose ceiling and critical threshold packs) is UNAPPROVED seed
data and must not gate a real order until pharmacy and the relevant committee sign it off.

## Read the status words carefully — they are not synonyms

This note uses four levels and they mean different things. Most of what follows is at level 2 or 3,
and NOTHING in WardSynQ is at level 4.

| Level | Means | Who can grant it |
|---|---|---|
| **IMPLEMENTED** | The code exists and its unit tests pass. | Anyone |
| **VERIFIED (software)** | The behaviour was driven end to end in a harness or a real browser, not only asserted in a unit test. | Anyone |
| **VERIFIED (device)** | The behaviour was driven on real hardware — a real push to a real handset, a real human answering. | Anyone with the device |
| **CLINICALLY APPROVED** | A named clinician or committee has signed off the clinical content and the policy attached to it. | **Only them. Nothing here has this.** |

A thing can be VERIFIED (device) and still be clinically worthless: the notification chain works and
the escalation policy it carries is unapproved seed content. Do not read the first as the second.

The safety case is executable: `node scripts/wardsynq-assurance.mjs` runs the real suites and
cross-references the hazard table against what actually passed. It currently reports **14 of 16
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
reference implementation for every adapter that follows. **THE CUT-OVER IS BUILT** (owner-approved 2026-09-05, flag still default OFF):
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
- Tests: `node --test test/wardsynq-*.test.mjs` runs every suite. See the table below for the P1
  modules; `node scripts/wardsynq-assurance.mjs` is the one that cross-references them against the
  hazard table.

## Design rules worth not re-litigating

**The eMAR contains no clinical pharmacology.** No interaction matrix, no dose ceilings, no allergy
subsumption, no renal adjustment. `wardsynq-meds.js` decides "has this dose passed every workflow
gate"; the injected `safetyCheck` hook decides "is this dose clinically safe". Mixing them is how a
workflow refactor silently weakens a clinical control. The safety engine (`wardsynq-safety.js`) is
built and is injected, never imported by the eMAR.

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
| `wardsynq-obstetrics.js` | HAZ-MAT-01 (local) | MEOWS. Trigger-based with NO total; a visual blood-loss estimate is never a measurement. |
| `wardsynq-bundle-binding.js` | (closes TIME-01's evidence) | Completes bundle elements from real eMAR administrations. DERIVED and ATTESTED are never conflated. |
| `wardsynq-notify.js` | (infrastructure) | The single definition of delivery. Attempted is not delivered. |
| `wardsynq-vitals.js` | (infrastructure) | The single definition of a current, non-artefactual observation, shared by both charts. |
| `wardsynq-flowsheet.js` | HAZ-FLUID-01 (local, PARTIAL) | The ICU hourly chart. A missing hour is never zero, and an infusion volume is an integral. |
| `wardsynq-pews.js` | HAZ-PAED-01 (local) | Paediatric early warning. A child's normal is a curve, so every band is per age. |
| `wardsynq-transport.js` | (supports DET-01, TIME-01) | SENT is not DELIVERED is not SEEN. Durable outbox, failover ladder, channel health, sweep driver. |
| `wardsynq-readlog.js` | (supports FLUID-01) | Who was shown the value, so a correction produces a list of people rather than a count of totals. |

## P2 and P3 (governance, measurement, AI)

None of these carries a hazard row. They are governance, measurement and administration rather than
clinical controls, and inventing rows for them would inflate the assurance table with things that do
not stop a patient being harmed.

| Module | What it is really about |
| --- | --- |
| `wardsynq-quality.js` | The denominator is the attack surface. Every exclusion carries a reason and travels with the rate; `compare()` exists in order to refuse to rank unadjusted mortality. |
| `wardsynq-incidents.js` | The failure mode is silence. A person is never a root cause, and an incident cannot be closed on retraining alone. |
| `wardsynq-consent.js` | A signature is not consent. Capacity is presumed; a refusal is never evidence of incapacity. |
| `wardsynq-research.js` | The record that looks anonymous. k-anonymity catches what Safe Harbor passes, and failing rows are withheld rather than warned about. |
| `wardsynq-lineage.js` | Staleness propagates: a score is as old as its oldest input, not as its arithmetic. |
| `wardsynq-api-gov.js` | Scope is not access. A valid token is still refused for a patient it has no relationship with. |
| `wardsynq-billing.js` | Money must not decide what the chart says. Billing reads the record and never writes to it. |
| `wardsynq-population.js` | The patients nobody is looking at, and the recall letter you must not send. |
| `wardsynq-secops.js` | Assume the injection succeeds. The ceiling, not the prompt, is the control. |
| `wardsynq-mlops.js` | Retrospective numbers deploy nothing; a breach withdraws the model automatically. |
| `wardsynq-simulation.js` | Chaos that asserts invariants rather than outcomes, seeded so any failure replays. |

`test/wardsynq-scenarios.test.mjs` runs one patient through the whole stack with assertions at the
SEAMS between modules. It is the suite that found the future-dated observation defect, which every
unit suite missed because each file was consistent with itself.

## Defects found in already-VERIFIED controls

Worth reading before trusting any green row. Each was found by building the NEXT thing, not by
re-reading the control:

1. `scoreEligible` was set after `Observation()` construction, so the canonical model dropped it and
   every device reading would have been silently excluded from every automated score.
2. The critical-result ESCALATION path awaited its channel and ignored the result, so a channel
   reporting failure was recorded as though the consultant had been told.
3. Time zero was guarded against moving EARLIER than its evidence and not LATER, which is the
   direction that is actually gamed.
4. `can()` read `actor.tier` directly, so the AI ceiling was enforced only in `makeActor()`. Any
   hand-built or deserialised actor claiming EXECUTE held it. This sat inside HAZ-AI-01.
5. `gatherVitals` guarded staleness and not future-dating, so a clock-skewed reading became "the
   latest" and outranked the correct current value.

Five hazards are LOCAL: they are not in the spec's assurance table and were added because the
omission was real. Three are PARTIAL. Adding them lowered the verified fraction rather than raising it.

## The honest state of it

VERIFIED in the safety case means the named tests pass. It does not mean the control is clinically
adequate and it does not mean the clinical content is approved. Nothing in this build is CLINICALLY
VALIDATED or CLINICALLY APPROVED, the threshold, allergy and dose packs are marked seed content, and
`report()` prints that unconditionally so nobody can read the table without it.

**That paragraph used to say the largest gap was that no notification transport was shipped. As of
2026-09-05 that is no longer true**, and the correction matters because the sentence was quoted as a
reason both local hazards were PARTIAL. A StewardMD Mobile channel is shipped and has carried a real
escalation to a real handset. The gap that remains is not transport; it is approval.

## The notification chain (2026-09-05, nine PRs)

IMPLEMENTED and VERIFIED (device). The chain, end to end:

    NEWS2 / sepsis prompt / bundle breach
      -> wardsynq-orchestrator.js        one alert identity across every channel
      -> wardsynq-transport.js           durable outbox, failover ladder, SENT/DELIVERED/VIEWED/SEEN
      -> StewardMD Mobile (APNs/FCM)     the product's existing push, not a new backend
      -> wardsynq-alert-ui.js            forced acknowledgement screen on the handset
      -> receipt                         the handset says it arrived; a human says they took it
      -> ONE patient-timeline event      and re-escalation stops

What each piece is worth, stated separately:

- **One orchestrator, one state machine** (`wardsynq-orchestrator.js`). One alertId, noticeId and
  patientId travel across every channel. Acknowledgement delegates to `Transport.acknowledge`, still
  the only writer of the authoritative record, and emits exactly ONE bus event with a derived id, so
  a late acknowledgement from a second channel is a no-op rather than a second clinical fact.
  `VIEWED` was added between DELIVERED and SEEN: a phone buzzing in a pocket is delivered; a
  registrar opening the alert is not yet a registrar accepting it.
- **All three raising modules feed it, and none of them changed.** `wardsynq-deterioration.js`,
  `wardsynq-recognition.js` and `wardsynq-emergency.js` are byte-identical, verified by `git diff`.
  The transport reads their three payload shapes explicitly rather than reshaping tested clinical
  modules to suit a transport.
- **Escalation behaviour.** A re-escalation is NOT a repeat: the escalation's tier becomes the notice
  sequence, so an unanswered alert going to a tier above raises a NEW notice to a NEW responder.
  Answering ANY notice answers the alert. A bundle element's warning and its later breach are one
  alert escalating; the same warning swept twice raises nothing; the same element on a later episode
  is a different alert, because time zero is part of the derived identity.
- **The acknowledgement travels back to the monitor**, over that same single event
  (`connectDeterioration`). Without it the halves drift: the orchestrator knows an alert is answered
  while the monitor keeps re-escalating it, which is the alarm fatigue that makes a ward stop reading
  escalations.
- **Delivery is not assumed.** A push accepted by APNs is SENT. Only the handset's own receipt makes
  it DELIVERED. In the live demonstration the escalation correctly read `delivered: false` after the
  gateway accepted it for 4 of 11 devices — which is the system being right, and is what keeps the
  re-escalation timer running.
- **The forced acknowledgement screen** (`wardsynq-alert-ui.js`). No auto-dismiss, no timeout, and it
  cannot be dismissed beside it, by Escape or by the back gesture. Two answers, and only one closes
  the loop: ACKNOWLEDGE posts and stands every channel down; I CANNOT ATTEND deliberately posts no
  acknowledgement and leaves the escalation outstanding so the ladder finds somebody who can. A
  failed acknowledgement does not look like a successful one — the screen stays open and says the
  escalation is still live.

### The live demonstration, 2026-09-05

VERIFIED (device), on an iPhone 15 Pro, one run:

    NEWS2 total=16 risk=high, responder "critical care outreach, emergency", within 15min
    push accepted for 4 of 11 devices -> reported SENT, delivered=false
    [a named clinician tapped Acknowledge on the forced screen]
    timelineEntries : 1
    monitorState    : acknowledged
    shouldEscalate  : false

The patient was `DEMO-PAT-1`. No clinical threshold or response window was touched: the score came
from the shipped `news2()` and the window and responder from the module's own escalation table.

### Device identity and token hygiene

IMPLEMENTED. Registration now captures `installId` (survives app updates, NOT a reinstall — the
correct granularity, since a reinstall mints a new APNs token), an optional owner-set `label`,
best-effort `model`/`osVersion`/`appVersion` from the user agent, and `firstSeen` written once and
never rewritten. `GET /api/push/devices` lists the caller's own registrations, read-only, returning
an 8-character fingerprint and never the token. Rows predating this return `identified: false`
rather than blanks.

APNs environment is now resolved PER TOKEN. `APNS_ENV` is unchanged and still tried first, so
production sending is untouched; only a token Apple rejects as not-valid-here retries against the
other host, and success is remembered. Previously such a token was PRUNED, so a development handset
silently stopped receiving anything and it looked like a broken push system.

Fan-out behaviour is deliberately unchanged: an account-scoped alert still goes to every active
token. Pruning is evidence-based only — a token rejected by BOTH hosts is removed automatically, and
on 2026-09-05 four fell out that way during the demonstration. One further token was removed by hand
because identity demonstrated a superseded install; distinct active devices were kept regardless of
age.

## The Clinical Record Service (2026-09-06)

**STATUS: IMPLEMENTED, verified by software (in-process suite), by a real local D1 run, and
(2026-09-07) by one controlled OPD flow on a real iPhone against production for an `org.mode:
"wardsynq"` test org. NOT clinically validated, NOT clinically approved. Global flag `WARDSYNQ_RECORD`
stays OFF; a wardsynq-mode org bypasses it on both the write side (`wsqForcedMigration`) and, since
PR #871, the read side (`/api/wardsynq` door + the timeline `record` link).** The deployment modes
other than Cloudflare D1 are a port contract, not code.

**Production D1 schema (gotcha, 2026-09-07):** `functions/db/wardsynq_schema.sql` was NOT applied
to the production `stewardmd-connect` database until 2026-09-07, so every real wardsynq write failed
with `record_read_failed` (a D1 "no such table" surfacing as a 502 from the edge) while the code was
correct. Applied with the command in the file's own header; it is additive and idempotent. Two
latency fixes (#868, #869) were made while chasing it; they are real but were not the cause.

### Safety defects found and fixed overnight 2026-09-07

One defect class, five instances: **code asserting something clinically stronger than its input
supported, or reporting a check that never ran as a check that came back clean.** All merged, all
with regression tests; each was measured against the real rule pack or the real helper before fixing.

| # | PR | What it did |
|---|----|-------------|
| 1 | #874 | `migrate-allergy.js`'s denial regex only matched ADJACENT words, so `"no known amoxicillin allergy"` recorded a RESOLVED penicillin allergy for a patient documented as NOT allergic - which then makes the Allergy Shield report a first-line antibiotic contraindicated. Five plausible phrasings did it. The mirror bug too: `"Amoxicillin - rash, no known food allergies"` previously recorded NOTHING. |
| 2 | #875 | `opd-emr.js`'s prescribing note discarded `unresolvedDrug`, so `"Augmentin 625"` (a brand name the pack does not resolve) printed *"No interaction found"* to the prescriber. Nothing had been checked; Augmentin is a penicillin. |
| 3 | #876 | `parseFloat` / strip-then-parse coercion: `"120/80"` typed in the systolic box became a systolic of **12080**, `"98,6"` became 986, a `"1:320"` Widal titer became 1. Fixed with one guard, `numericValue()` in `wardsynq-model.js` - the whole string must be one number, optionally with a digit-free unit. A value that is not becomes *nothing recorded*, never a guess. |
| 4 | #878 | `checkInteractions()` silently dropped any active medication it could not resolve: a patient on warfarin prescribed ibuprofen got `INTERACTION_MAJOR` when the warfarin order carried a generic and **nothing at all** when it carried a GHIS material id. `evaluate()` now reports `unresolvedActiveMeds`. Same PR: `SafetyEngine.hook()` (the eMAR's wiring point) dropped `unresolvedDrug` entirely, so an unrecognised drug reached the bedside as `{allowed:true, warnings:[]}`. Both now travel as WARNINGS - never blocks, because this content is unapproved and must not invent a refusal at the moment of administration. |
| 5 | #879 | `RecordService` held the raw ungoverned `ClinicalStore` as a public property, under a comment claiming it did not. Latent (no caller reached it), now a constructor local. |

**Drug CONTENT was deliberately not touched.** Brand names common in India (Augmentin, Co-amoxiclav)
do not resolve, so no allergy or interaction check runs for them. That is a pharmacy sign-off
question per this file's STATUS line, not a code fix. What changed is that the gap is now reported
instead of being shown to the prescriber as reassurance.

### Testing the record without a phone (2026-09-07)

Until this night the only thing that had ever driven the real OPD request path end to end was a
human with an unlocked iPhone on a USB cable, and it was unavailable for hours when the phone
auto-locked. Two files fix that:

- **`test/wardsynq-opd-route-flow.test.mjs`** drives `onRequest()` itself - register, check in,
  vitals, assessment, sign-off, order, CDSS, prescribe, and the record write each triggers. One
  module is faked (`_fbfirestore.js`, in memory, real compare-and-set), the persistence seam points
  at `MemoryRepository`. Runs in CI today. **Import order matters and cost an hour: a static
  `import` is hoisted, so anything reaching `_fbfirestore.js` must be loaded with dynamic `import()`
  AFTER `mock.module()`, or the real Firestore is linked and the fake silently ignored.**
- **`test/wardsynq-d1-sql.test.mjs`** executes the shipped schema against real SQLite (`node:sqlite`,
  no dependency) - the first time any query had met the tables it declares. It pins the shape of the
  outage above: an unapplied schema throws `no such table: wardsynq_record`.

**One manual step outstanding:** the SQL file needs `--experimental-sqlite` on Node 22, and
`.github/workflows/ci.yml` does not pass it, so those tests SKIP in CI. Changing that file needs a
token with `workflow` scope. Make the `Run unit tests` step:
`node --test --experimental-test-module-mocks --experimental-sqlite test/*.test.mjs`

Until this, WardSynQ's record lived in the browser: `MemoryBackend` on the workstation,
`IndexedDBBackend` offline. A refresh erased it and a second device never saw it, so "hospital PC and
StewardMD Mobile against the same record" was impossible for want of a record, not of sync code. This
is the server-side record, and it is deliberately the SAME code, not a second implementation:

```
hospital PC  (wardsynq-app.js / opd-boot.js)        doctor's phone  (wardsynq-record-boot.js)
   ClinicalStore + GovernedStore                        ClinicalStore + GovernedStore
   over RemoteBackend  (wardsynq-store-remote.js)       over RemoteBackend
                 \                                        /
                  POST/GET /api/wardsynq/:tenant/...  (functions/api/wardsynq/[[path]].js)
                          identity: verified token -> connect_membership role -> WardSynQ actor
                          RecordService (functions/_wardsynq/service.js)
                            = ClinicalStore + GovernedStore, per request, over a TenantBackend
                          persistence PORT (functions/_wardsynq/repository.js, 8 methods)
                            D1Repository (repository-d1.js)   MemoryRepository (tests)   [on-prem: not built]
                          wardsynq_record  wardsynq_idempotency  connect_audit_event
```

**What the door enforces, and where each thing was reused rather than built:**
- Tenancy: `resolveActor` + `resolveTenant` from Connect. Membership decides the tenant; the request
  body never does. Every repository method takes `tenantId` first; there is no cross-tenant method.
- Roles: two actions added to the existing RBAC matrix, `record:read` and `record:write`. Clinician
  only, like `context:load`. Owner, admin and auditor get no chart. A platform super-admin is built
  as a READ-tier actor: can look for support, cannot write.
- Actor: `clinician` → HUMAN at EXECUTE, credential = the `regNo` custom claim the prescription
  route already uses. No claim, no signature. The server stamps `writtenBy`; the client's claim
  about itself does not survive the door, and the whole `authoriseWrite` ladder runs again server-side.
- Append-only and bi-temporal: unchanged. The UNIQUE key on (tenant, type, id, version) is the
  physical guarantee; the API's `expectedVersion` is the visible one. A stale write gets a 409
  WITH the current record, so the existing `Reconciler` can resolve it with a person.
- Idempotency: `Idempotency-Key` per write; a retry replays the original outcome (200, `replayed:
  true`) and never mints version N+2. Ingest uses the same table keyed on the source event id, so a
  re-sent connector bundle is a no-op on the next request too, not only within one.
- Audit: reused `connect_audit_event`, PHI-free, in the same atomic D1 batch as the version it
  describes. Reads, lists, change-feed polls, denials and ingests all leave rows.
- Change feed: `GET /:tenant/changes?since=<seq>`; how the other client learns what happened.

**Two modes, one contract.** `connect_tenant.settings.wardsynq.recordMode` is `system-of-record`
(default) or `integration`. In BOTH modes a record whose latest version came from another system
(`meta.source.system` ≠ `wardsynq-native`) is refused at the native door with `EXTERNAL_AUTHORITY`:
a LIS result is corrected by the LIS, an Epic patient is renamed in Epic. In integration mode the
external EMR additionally creates the masters (`externallyOwned`, default Patient and Encounter,
per tenant, configurable). This is ownership policy, not a clinical rule.

**The two canonical models, settled.** SCCM (`functions/_connect/canonical/model.js`) is the
ingest/read wire format the nine connectors normalise into. The WardSynQ model is THE RECORD. They
meet in exactly one file, `wardsynq/adapters/wardsynq-sccm-adapter.js`, registered on the
Integration Hub like the GHIS adapter: stable ids, provenance stamped with the connector name,
nothing invented (unknown dob → the `0000-00-00` sentinel and a flag, no name → the source id and a
flag), an external "active" order lands as a DRAFT with `externalStatus` beside it because the actor
model caps an adapter below EXECUTE. Imaging studies are reported as unmapped, not dropped.
`POST /:tenant/ingest/sccm` is the door.

**Proven, and how.** `test/wardsynq-record-service.test.mjs` (13 tests, the route handler is the
fetch): PC and phone read one record; a fresh client instance sees it; the loser of a race gets 409
with the winner's version; idempotent replay; cross-tenant 403; admin 403; forged signature and
wrong-chart refused server-side; PHI-free audit; integration-mode authority; SCCM replay. Then the
same script against a REAL local D1 (`wrangler pages dev`, miniflare, Cf-Access identities): 7
record rows, 15 audit rows, 2 idempotency keys, zero PHI in the audit table. `wrangler pages
functions build` compiles the bundle, which is what proves `functions/` may import `wardsynq/`.

**Who may do what, settled 2026-09-06 (PR after #848).** The hospital's eighteen operational roles
(`functions/_queue_roles.js`, granted per organisation in `q_members`, decided by the existing
`authorizeOrg()`) now reach the record through ONE path, `functions/_wardsynq/actor.js`. The grant is
derived from the CAPABILITIES a role already holds, not from its name, so the record cannot disagree
with the queue about what a nurse is:

| Capability the role holds | Tier | Writes | Reads | Roles |
|---|---|---|---|---|
| `emr.treat` | EXECUTE | every type | every type | doctor, pg_faculty, pg_hod, admin |
| `emr.vitals` (no treat) | EXECUTE | Observation only | every type | nurse, intern, resident, pg_resident |
| `emr.view` only | READ | nothing | every type | supervisor, reception |
| `order.read` only | READ | nothing | MedicationOrder, ServiceRequest | cashier, pharmacy |
| none of these | no clinical actor, 403 | | | hr, viewer, oncqis ×3, academic_cell |

Scope is a new, backward-compatible field on the actor (`scope.read` / `scope.write`, null = every
type, the pre-scope behaviour); a write outside it is `SCOPE_DENIED` and a read outside it is
`READ_SCOPE_DENIED`, both governance denials from `wardsynq-actors.js`, both audited. A nurse holds
EXECUTE because a recorded blood pressure is a committed fact, not a draft; scope keeps her off an
order, and having no registration number keeps her from signing anything. Identity is a Firebase or
Access session, or (with `QUEUE_STAFF_ENABLED=1`) the staff email+PIN session via `X-Staff-Token`,
org-bound. Precedence: the OPD organisation linked to the tenant (`settings.wardsynq.orgId`, or
`q_orgs.connectTenantId`, or a shared id) decides when the person is a member of it; Connect
membership (`clinician`) otherwise; Connect owner/admin/auditor never. `admin` inherits `emr.treat`
from the existing matrix and so writes as a doctor would; narrow `ROLE_CAPS.admin` if that is not
wanted, not this mapping.

**AI is a separate actor.** A write with `origin: {kind: "ai", id}` or an entity saying
`aiDrafted: true` is written by `ai:<id>`, KIND.AI, capped at DRAFT by its kind, with
`writtenBy.onBehalfOf` naming the clinician whose session it ran in, and no wider write scope than
that clinician holds. The doctor is the delegate, never the author; `aiDrafted` is forced true by the
store whatever the entity claimed; an active order or a signature from an AI is refused.

**The first clinical write on the record: nurse vitals (2026-09-06, `functions/_wardsynq/migrate-vitals.js`).**
The OPD console's "Record vitals" (`opd.html`) posted one text line to the encounter timeline
(`POST /api/queue/<session>/timeline`, kind `vitals`), encrypted in a Firestore document that
self-expires. It now ALSO sends the structured values, and the timeline handler dual-writes, per
tenant, by `connect_tenant.settings.wardsynq.migrations.vitals`:

| Mode | Order | On record failure |
|---|---|---|
| `off` (default, every tenant today) | timeline only; the handler is byte-for-byte what it was | n/a |
| `shadow` | timeline first, its result returned; then the record | reported on the response as `wardsynq`, audited, never thrown |
| `authoritative` | record FIRST, must succeed; then the timeline as the shadow | the request fails (`record_refused`, 403/422/502) and no timeline entry is made |

Also gated on `WARDSYNQ_RECORD=1` and on the OPD org naming its Connect tenant
(`q_orgs.connectTenantId`); any of those absent is `off`, and a broken lookup is `off`, so a hospital
that has not opted in sees nothing. The write is the request's own governed actor through
`resolveClinicalActor` (a nurse: EXECUTE on Observation only), one LOINC-coded Observation per value,
UCUM units AS REPORTED (Fahrenheit stays Fahrenheit), the note as `sourceText`, stable ids in ticket
and timestamp plus an idempotency key so a retry replays. Filed under `opd-pat-<mrn>`; NO Patient
record is created (a nurse cannot, and the ticket has no demographics), so a ticket without an MRN
is refused as `no_patient_identity`. Not a clinical rule: no threshold, no score, no alert reads
these yet.

**The record is read back (2026-09-06, same day).** The doctor's "Clinical notes" drawer in
`opd.html` now shows a "Vital signs · Clinical record" card above the timeline narrative. The server's
`GET /api/queue/timeline` names the record (`record: {tenantId, patientId, mode, ticketId}`) ONLY
when the tenant's vitals migration is on; the console then reads
`GET /api/wardsynq/:tenant/patient/opd-pat-<mrn>/Observation` with the credentials it already holds,
so the record's own door decides who may see them (a pharmacist is refused; another hospital's
clinician is refused). Readings are grouped per recorded moment, newest first, systolic and
diastolic paired, units as entered, "This visit" flagged from the observation's source ticket, and
the note shown. Every state has a sentence for the doctor: loading, empty, no MRN, sign in again,
role cannot view, record not available for this clinic, unreachable. The timeline is not duplicated;
it keeps its text line. Off (every tenant today): no `record` key, the drawer is exactly what it was.

**Patient registration creates the master (2026-09-06, third migration).** Vitals attached to
`opd-pat-<mrn>` with no Patient behind it. `functions/_wardsynq/migrate-registration.js` closes that:
after `_opd_patient_store.js registerPatient()` allocates the MRN (unchanged — the atomic counter is
untouched), the same `opd-pat-<mrn>` id (now shared from `_wardsynq/opd-identity.js`, so vitals and
registration provably agree) is written as a canonical `Patient` — name, dob, sex exactly as OPD's
own `validateRegistration` resolved them, ABHA identifiers only where OPD's own `abhaLinkable`
recorded consent, `provisional: true` for a TMP- id. Same three modes, same
`connect_tenant.settings.wardsynq.migrations.<key>` shape
(`migrate-vitals.js` and this file now share the tenant/mode lookup, `migration-tenant.js`), but
**authoritative differs from vitals' mechanics, deliberately**: MR allocation is a one-shot,
non-reversible counter, so Firestore registration always runs FIRST in every mode; authoritative
means a record refusal is surfaced to the desk rather than logged, not that the MR is un-issued.
Stated in the file, not only here.

**Who may register, and why it changed the actor grant.** `QUEUE_ADD` ("register / walk-in a
patient") now adds `Patient` to the write scope `functions/_wardsynq/actor.js` derives, and raises
the tier to EXECUTE for a role that held only READ before — reception and supervisor gained this;
nurse/intern/resident/pg_resident already held EXECUTE and gained Patient alongside Observation. HR,
viewer and the ONCQIS/academic-cell roles hold no QUEUE_ADD and remain refused entirely. This is the
SAME derive-from-capabilities rule PR #849 established, extended by one capability, not a new rule.

**Identity, not merely a write.** The WardSynQ id is deterministic from the MRN, so two different
Patient entities for one MRN is structurally impossible — a repeat registration is a new VERSION of
the one entity, and is SKIPPED entirely (no version written) when demographics are unchanged, so a
returning patient checking in again does not pad the append-only history with identical copies.
**Left as an explicit, separate, KNOWN gap**: `linkHospitalMrn` (promoting a provisional TMP- id to
a real hospital MR) is not touched. A patient registered while provisional keeps its WardSynQ Patient
at the OLD id after Firestore re-keys it; re-keying/merging that into the new id would be exactly the
identity merge this migration is told to keep an explicit, separate, governed operation — not
attempted here, and not silently swept under "it still works most of the time."

**The doctor's assessment, migrated (2026-09-06, fourth migration).** `opd-emr.js`'s Assessment tab
is a GHIS Initial Assessment form — 14 sections, ~90 fields, captured verbatim from a live GHIS
capture. `functions/_wardsynq/migrate-assessment.js` does NOT reproduce that schema in WardSynQ
(that would be the second model the task forbids); it groups the submission into the SOAP shape
`wardsynq-model.js` already documents as an example of `ClinicalNote.sections` (subjective /
objective / assessment / plan), from the small subset of fields universally meaningful across any
clinical form, and keeps the ENTIRE submitted payload verbatim under `sections.raw` so grouping
never discards anything nobody has decided a canonical shape for yet.

**The seam is the one vitals already uses, not a new one.** `submitAssessment()` posts the real
clinical content to GHIS's `/assessment-save` (a different backend file, untouched, never will be)
and, only on success, calls `addToTimeline("assessment", summary)` — the SAME
`POST /api/queue/timeline` endpoint vitals hooks. The queue route now dispatches on `kind` to either
`recordVitals` or `recordAssessment` through one shared `migrator`, gated by the SAME `EMR_TREAT`
capability the timeline handler already required for any non-vitals kind. `"note"`/`"medication"`
(investigation orders, prescriptions) remain entirely unrecognised — untouched, on purpose.

**One note per encounter, versioned, never a duplicate or a silent overwrite.** Every save of the
same visit's assessment is a new VERSION of the ONE `ClinicalNote` at
`noteIdForTicket(ticket, "assessment")` (`opd-identity.js`, sharing `encounterIdForTicket` with
vitals so both attach to the same encounter). Unchanged content: nothing written. Changed content: a
new version, with `expectedVersion` refusing a stale concurrent write exactly as registration does —
so two doctors (or two tabs) editing from the same version cannot both silently land. The append-only
store keeps every prior version; a correction is a new row, never a rewrite of the old one.

**Read back through the generic endpoint, no new route.** `GET /api/wardsynq/:tenant/patient/:id/
ClinicalNote` already existed (`ClinicalNote` was always in `RESOURCE_TYPES`) — the console's
"Clinical notes" drawer now fetches it exactly as it fetches Observation, and renders an "Assessment
· Clinical record" card above the timeline narrative. The GET timeline handler's `record` key is
now generalised (`recordLinkForOrg`, `migration-tenant.js`) from "is vitals on" to "is this tenant's
record reachable at all", so a tenant migrated for registration or the assessment alone still exposes
it — a read must not have to guess which specific write is turned on.

**`authoritative` carries the SAME honest limitation registration's does, for the SAME reason.** The
real clinical write (GHIS's `/assessment-save`) already happened via a wholly separate HTTP request
by the time this endpoint is even reached — there is no ordering trick available here the way there
is for vitals (whose record write and timeline write are peers in one request). Authoritative means a
WardSynQ refusal is reported to the caller, not swallowed; it cannot undo the GHIS save that already
landed. The console's `addToTimeline` gained a minimal, additive check (a `record_refused` response
now surfaces one toast) so that claim is not merely theoretical — every tenant today gets `{ok:true}`
and the toast never fires.

**The sign-off, migrated (2026-09-06, fifth migration), and a defect it found.** GHIS's Authorise is
real: `opd-emr.js authoriseConsult()` posts `/assessment-authorize` (`functions/api/ghis`,
`authorizeAssessment`, behind the same `QUEUE_EMR_WRITE` gate as every GHIS write); GHIS locks the
form and stamps "Authorized on <date> by <Dr name>", which `loadAssessment()` reads back as
`authorized: {on, by}`. On success the client posts the SAME `kind:"assessment"` timeline entry a
save does — which is the defect: with a tenant on for assessment, PR #854's content path would have
received that entry with no fields and written an empty-sections version over the note. Closed two
ways: the Authorise call now carries `signOff: true` and the route dispatches it to
`recordAssessmentSignOff`; and the content path refuses to write when it has no fields at all
(`skipped: "no_content"`), so no future caller can wipe a note by accident either.

**What a signature is here is what the actor model already said it is.** The signed version is the
SAME note, content copied verbatim, with `signedBy` set to the authenticated doctor's OWN id — never
GHIS's display-name string (`authorized.by` is prose, not an identity), never anyone else's. The
store's `authoriseWrite` then does what it has done since HAZ-AI-01: refuses a signature from a
non-human, from anyone but the signer (`SIGNATURE_NOT_OWN`), and from a signer holding no credential
(`NO_CREDENTIAL`). So a doctor on a staff PIN session, who has no registration number, can save the
assessment and cannot sign it, and the record says exactly that. Once signed the note is closed: a
further content save from any doctor is `note_signed` (409), mirroring GHIS locking its own form; a
second Authorise is `already_signed`, a no-op, not a fourth version. The append-only history keeps
draft, refinement and signed version in order. The console's Assessment card shows "Signed by <id>"
from the record, or "Unsigned". No new settings key: sign-off rides the tenant's `assessment` mode.

**Deliberately NOT done.** A correction after sign-off (an addendum on a new note) is not modelled;
`note_signed` refuses the edit and says so. GHIS's `authorized.on` timestamp is not copied in — the
signed version's own `meta.recordedAt` is the moment WardSynQ recorded the signature. Prescriptions
untouched. (Investigation orders were untouched at the time; they were migrated next — below.)

**The investigation order, migrated (2026-09-06, sixth migration).** `opd-emr.js`'s `submitInvOrder()`
posts `{serviceId, diagnosis, emergency}` to GHIS's `/inv-order` (→ `orderInvestigation` →
`/Doctor/Home/CreateServices`, untouched) and, only on success, mirrors it as a `kind:"note"` timeline
line. `functions/_wardsynq/migrate-inv-order.js` files that same order STRUCTURALLY as a
`ServiceRequest` — the canonical model already had one — rather than re-parsing the sentence the
timeline shows. The timeline keeps its sentence; nothing is duplicated into it, nothing removed.

**Recognised by a payload, never by the kind.** `"note"` carries many things (a free-text note, a
referral line). So the client now sends a structured `order:{serviceId,name,diagnosis,emergency}`
BESIDE the sentence, and the route treats a note as an order only when that payload is present
(`isInvOrder`). A plain note still migrates nothing, and `"medication"` (prescriptions) is still
entirely unrecognised. Its own settings key, `investigations` — a clinic can run vitals on and
investigations off.

**What maps, and what deliberately does not.** `code` is the GHIS service id the order is actually
placed against ("LAB1118"), with `codeSystem:"ghis-service-id"` bolted on so nobody later reads it as
a LOINC, and `display` the service name. `priority` is the Emergency toggle (stat / routine),
`reason` the typed provisional diagnosis, `requesterId` the AUTHENTICATED clinician from the session,
`status:"active"` because GHIS accepted the order before this code ran. `category` stays at the
model's default `"other"`: the service id prefix hints at lab vs procedure, and inferring a clinical
category from a naming convention would be inventing one. **Priority and reason are recorded here
even though GHIS drops them** — `orderInvestigation` maps neither (it reads `indication`/`antibiotics`
and has no emergency parameter at all). That is pre-existing GHIS behaviour, not touched; the record
simply keeps what the doctor actually entered.

**One order per test per encounter.** The id is deterministic from the encounter and the service id
(`serviceRequestIdForTicket`, `opd-identity.js`, anchored the same way a note is), so a retry or a
double-tap cannot mint a second `ServiceRequest`, and an identical re-order on one visit reports
`already_ordered`. The trade-off, stated rather than hidden: a doctor genuinely re-ordering the SAME
test within ONE visit is recorded once here, while GHIS and the visit timeline each keep both.
Governance is the existing rule, not a new one — `ServiceRequest` is an `INSTRUCTION_TYPE`, so
committing it active needs EXECUTE: a nurse is refused on scope, an AI is capped at DRAFT. Pharmacy,
whose read scope is exactly `MedicationOrder`/`ServiceRequest`, can read orders and write none.

**Read back through the generic endpoint, again no new route.** `GET /api/wardsynq/:tenant/patient/
:id/ServiceRequest` already worked; the console's notes drawer renders an "Investigations · Clinical
record" card, name over raw id, Emergency shown as a pill. It says plainly that results are not
recorded here.

**Deliberately NOT done.** Results (`DiagnosticReport`) are not migrated — nothing writes one yet, so
the card must not imply a result exists. Cancelling an order is not modelled. `authoritative` carries
the SAME honest limitation the assessment's does: GHIS accepted the order in a separate request
before this endpoint was reached, so a WardSynQ refusal is reported, never a rollback. (Prescriptions
were untouched at the time; they were migrated next — below.)

**The prescription, migrated (2026-09-06, seventh migration).** `opd-emr.js`'s `submitPrescribe()`
posts `{drugId, route, form, qty, frequency, duration, remarks}` to GHIS's `/prescribe` and, only on
success, mirrors it as a `kind:"medication"` timeline line.
`functions/_wardsynq/migrate-prescription.js` files that same prescription structurally as the
canonical `MedicationOrder`. Recognised by an explicit `rx` payload, never by the kind — a
`kind:"medication"` line without one (the local clinic store's "Medication added to the record") is
untouched. Own settings key, `prescriptions`.

**READ THIS FIRST: GHIS prescribing is inert, and this migration inherits that.** `functions/api/
ghis/[[path]].js` hard-blocks `/prescribe` unless `QUEUE_EMR_PRESCRIBE_OK=1`, because GHIS's real
CreateDrugs payload was never captured — every field name in `prescribe()` except `frequency` is an
UNVERIFIED guess, and a wrong field could mis-prescribe a drug. The endpoint answers 501
`prescribe_not_verified`, and `postWrite` returns BEFORE `addToTimeline`. So **a prescription GHIS
refused produces no record write at all**, which is the single most important safety property here:
an active medication order for a prescription that was never placed would be the worst thing this
code could produce. This migration therefore sits behind TWO gates, not one — the tenant's settings
key, and GHIS prescribing becoming real. The mapping is in place for the day the second opens.

**Status and signature: the existing lifecycle, preserved.** `MedicationOrder` is an
`INSTRUCTION_TYPE`, so beyond a draft it needs EXECUTE; a signature is an act, so only the writing
actor may sign and only a credentialed human may sign at all (`NON_HUMAN_SIGNATURE`,
`SIGNATURE_NOT_OWN`, `NO_CREDENTIAL`). The prescriber's credential therefore decides, and nothing is
fabricated either way: a credentialed doctor gets `status:"active"` with `signedBy` = their OWN id; a
doctor on a PIN session gets an **unsigned draft** rather than either vanishing (NO_CREDENTIAL would
refuse the whole write) or becoming an active order nobody signed. An AI never reaches active — it is
capped below EXECUTE, and `GovernedStore.put` stamps `aiDrafted` itself, so the guarantee cannot be
evaded by omitting or misspelling a claim.

**Quantity is not a dose, and is never mapped as one.** The OPD prescribe form has no dose field. It
has Quantity ("10"), which is how many units to dispense. `MedicationOrder.dose` is `{value, unit}`
and `wardsynq-safety.js checkDose()` does ceiling arithmetic on it, so mapping Quantity there would
silently check the wrong number against a real ceiling. `dose` is left null, `checkDose` reports
`DOSE_UNPARSEABLE` ("ceiling checks could not run"), and Quantity is bolted on as `quantity`. An
honest gap beats a plausible wrong number. `genericName` (`basic_material_desc` from GHIS's own drug
search) IS carried, because the safety engine indexes allergy classes and dose limits by generic.

**Deliberately NOT done.** Dispensing, administration/eMAR (`MedicationAdministration`) and
reconciliation are not migrated, and the console card says so rather than implying a dose was given.
PRN, timing, start/end, priority, indication and strength are not captured by the OPD form and are
not invented. The safety engine and its thresholds are untouched.

**Results, migrated (2026-09-06, eighth migration) — READ-SIDE.** Every migration before this one
hooked a doctor's WRITE. A result is not a write the doctor makes; it is GHIS data becoming
available, and `opd-emr.js openReport()` merely taps GHIS's `/lab-detail` or `/radiology-report`
(untouched, response unchanged). So the seam is a mirror of a READ: after GHIS answers, the client
separately posts what it saw to `POST /api/queue/result` (its own route segment, not "timeline" —
a result is not a new sentence in the visit summary), which
`functions/_wardsynq/migrate-results.js` maps into a canonical `DiagnosticReport` (+ `Observation`
per lab test) and writes it — GHIS's own read is never slowed, blocked, or altered.

**"authoritative" means something different here than in every migration before it.** Elsewhere,
authoritative meant WardSynQ was the write target and a refusal blocked the caller. There is no such
write for results — GHIS was never asked to write anything by this flow. Here it means only: the
console MAY ALSO read the DiagnosticReport back from WardSynQ (`record.results = true` on the GET
timeline handler, gated on the `results` key being `"authoritative"` SPECIFICALLY — narrower than
the other four cards, which appear whenever the tenant's record is reachable at ALL). "shadow"
ingests identically but exposes no such key: the console renders exactly as it does today.

**Two source shapes, one canonical model — no second result model.** Lab (`getLabOrders` +
`getLabDetail`) and radiology (`getRadiologyOrders` + `getRadiologyReport`) both map into the SAME
`DiagnosticReport`. Lab additionally produces one `Observation` per test row (structured values
belong there, as vitals already establishes); radiology has no discrete rows, so `conclusion`
carries the whole narrative and `resultObservationIds` stays empty.

**Terminology reused, not reinvented.** `LAB_CODE_SEED` already existed in
`wardsynq/adapters/wardsynq-ghis-adapter.js` (the ICU/ward feed's GHIS adapter, an UNRELATED
subsystem that already maps GHIS labs → Observation and GHIS imaging → DiagnosticReport) and is
IMPORTED here rather than re-seeded. An unmapped test keeps its own name with
`codeSystem: "ghis-local"` and is recorded in `issues`, never guessed at.

**`DiagnosticReport.critical` is left FALSE, always — the single most safety-relevant call in this
migration.** GHIS's own `critical` flag on a lab row is carried as `Observation.sourceCritical`
(informational), but is NEVER used to set the canonical `DiagnosticReport.critical` field.
`wardsynq-critical.js`'s own design rule #1 is explicit: "a source system's own critical flag is
advisory... it is never a substitute for classifying the value against the site's own [approved]
thresholds. An interface that trusted the sender's flag would inherit every one of the sender's
bugs." Setting the canonical field from GHIS's claim would be exactly that mistake. Nothing here
reads or writes `wardsynq-critical.js` at all — wiring results into closed-loop escalation is a
separate, later decision needing the site's own approved thresholds.

**LINKAGE is by name match, scoped and honest about its limit.** The lab/radiology order rows carry
NO ServiceRequest id or GHIS service id, only a display name. `matchServiceRequest` looks up the
patient's ServiceRequests on the SAME encounter and links to one whose `display` matches
case-insensitively — but ONLY when exactly one candidate matches. Zero or several both leave
`serviceRequestId: null` with `serviceRequestLinkage` recording `"unmatched"` or `"ambiguous"`,
because guessing among several same-named orders risks the WRONG linkage. Nothing here ever creates
a ServiceRequest to make a result look ordered.

**AMENDMENTS, without a source signal for them.** Neither GHIS read path exposes a
"preliminary → corrected" transition. A re-fetch of the SAME renderId/resultid that returns
DIFFERENT content is represented as this model already represents any change: a new VERSION of the
SAME `DiagnosticReport`, guarded by `expectedVersion`, prior version intact in history — `status` is
computed fresh each time from what is actually present, never advanced to `"corrected"`, because
claiming that source signal would be inventing one GHIS does not provide. A changed OBSERVATION
value (a corrected lab number under an unchanged test list) still versions the REPORT, not just the
observation, so the report's own history reflects the correction.

**A real, avoidable idempotency bug, found and fixed before this shipped.** The first draft gave
every observation and the report a STATIC `idempotencyKey` tied to the entity's own stable id
(`result-obs:${obs.id}`). `RecordService`'s `recall()` caches an idempotency key's outcome FOREVER —
so that key would have permanently frozen the FIRST value ever written: every later mirror sharing
the key would replay the original result and a genuine correction would silently never land. Every
sibling migration (`migrate-inv-order.js`, `migrate-prescription.js`, `migrate-assessment.js`) had
already established the right pattern — accept an OPTIONAL `ctx.idempotencyKey` from the caller,
rely on an explicit same-content check (`sameOrder`/`samePrescription`/here, `sameReport` +
`sameObservationValue`) plus `expectedVersion` for the actual dedup and concurrency guarantee. Fixed
to match before merge, caught by the amendment test (`written` came back `0` when it should have
been `1`) rather than by a hospital watching a corrected result never take effect.

**`DiagnosticReport` gained `encounterId`.** Missing from the model entirely — every other clinical
resource here (Observation, ServiceRequest, MedicationOrder, ClinicalNote) already carries the visit
it belongs to. Not a second model; the same field the rest of the model already has. The ICU/ward
adapter's own `toDiagnosticReports` was updated to set it too, since it already had `encounter` in
scope and had simply never had anywhere to put it.

**Deliberately NOT done.** GHIS remains the source of truth in every mode: nothing here caches a
copy the console serves INSTEAD of GHIS, and making WardSynQ the actual source of record for results
is a separate, later, deliberate decision this migration does not make. No abnormal-vs-reference-
range judgement is computed (GHIS's own `critical` flag is the only signal carried). Cancelling a
result, and correcting a ServiceRequest's linkage after the fact, are not modelled.

**Encounter, migrated (2026-09-06, ninth migration) — THE FOUNDATION.** Every migration before this
one writes `encounterId` (`opd-identity.js encounterIdForTicket`) but nothing ever wrote an
`Encounter` entity at that id — six resource types were all pointing at a record that did not exist.
This is the ONE place that creates and closes it, so vitals, the assessment, an investigation order,
a prescription and a result all resolve to the SAME real entity rather than a dangling reference
each happens to agree on the spelling of.

**One function serves open, continuation AND close**, because they are the same question asked at
different moments: "what does the canonical Encounter look like right now, given this ticket's
CURRENT state?" `recordEncounterSync` reads the ticket's own, already-governed lifecycle
(`_queue_eta.js STATUS`/`isTerminal`, mirrored rather than re-decided) and maps it:

```
registered / waiting / called                -> "planned"
in_consultation / investigation / followup    -> "in-progress"   (may return to the queue mid-visit)
completed                                     -> "finished"
cancelled / no_show                           -> "cancelled"
```

No discharge workflow is invented — these are the ticket's own three terminal states, unchanged.
Called at ticket creation (manual add and, diffed against the roster so a poll does not re-sync
every ticket every time, GHIS import), at every status change, and at checkout.

**A closed encounter is never reopened or overwritten** — not to a different status, terminal or
not, and not merely to refresh a field. `_queue_eta.js`'s own transition table already makes this
UNREACHABLE via the ticket engine (a terminal ticket status has no outgoing transitions at all), but
the record layer does not trust the caller's correctness for a fact this consequential, matching
`wardsynq-actors.js`'s own "a signature is an act, not a string" instinct applied to a different
guarantee. An identical repeat of the same close is still a harmless no-op.

**Governance is the existing rule, extended by exactly ONE entity, not a new mechanism.** Checking a
patient in for today's visit is the SAME administrative act registration was already judged to be
(`actor.js`'s 2026-09-06 QUEUE_ADD note). `actor.js` was extended so QUEUE_ADD's union also adds
`"Encounter"` to write scope, alongside `"Patient"`, for the identical reason already written there —
reception and the desk check patients in every day and must be able to open the visit record that
represents that, without a doctor's EMR_TREAT scope. Every role holding QUEUE_STATUS (closing a
visit) already holds QUEUE_ADD too, so no separate grant was needed for close. `Encounter` was
already NOT an `INSTRUCTION_TYPE` (`wardsynq-actors.js`'s own header names it as the worked example:
"an Encounter is born 'planned'"), so no EXECUTE requirement applies — SCOPE is the real gate here,
which is exactly what this change extends.

**Identity: two widenings to `opd-identity.js`, both because no tenant has ever run this in
production to have written under the old spelling.** (1) A native (non-GHIS) ticket's
`encounterIdForTicket` now falls back to the ticket's own id — the SAME fallback `anchoredOrderId`
already uses for every order/rx/result id. Before this, a native visit's `encounterId` was always
`null` on all five prior resource types; an Encounter cannot be created for a null anchor, so this is
what lets a native visit get a real one too, and every prior migration inherits it with zero code
change of its own. (2) The GHIS-episode branch now runs through the SAME slug every sibling id
helper already uses, rather than a plain lowercase with no character replacement — a needless third
convention removed, not a real id changed (identical output for every episode id ever actually used).

**Timestamps and attending clinician are what the ticket actually recorded, never a guess.**
`periodStart` is `ticket.registeredAt` (set once, unconditionally, at check-in — the model's own
field, not a bolt-on). `periodEnd` is `ticket.consultEndAt` when the ticket passed through a
consultation, or the moment of closing when there is no such timestamp (a cancellation from the
waiting room has no more precise "when did this end"). `attendingId` (bolted on — the model has no
participant field) is the SYNCING SESSION's own doctor at that moment, not whichever actor happens to
trigger a later resource write — a nurse recording vitals mid-visit is not the attending physician.

**A known, named gap.** The stale-import reconciliation in `_queue_ghis.js importRoster` (a ticket
that dropped off the GHIS worklist gets cancelled) calls the queue ENGINE's `setStatus` directly, a
different path from every route segment this migration hooks. An encounter for such a ticket is not
closed by that path today — every DELIBERATE front-desk action (manual status change, checkout) is
covered; this one background cleanup edge is named rather than silently missed.

**Deliberately NOT done.** Admissions, bed management and IPD/ICU/ED encounters — `class` is always
`"OPD"`, and this file has no input to represent anything else. No discharge workflow beyond the
ticket's own three terminal states. GHIS cut-over and eMAR remain untouched and unstarted.

**Deliberately NOT done _by the assessment migration_** (all three were later revisited; kept here as
the scope that migration shipped with). GHIS's "Authorise" (sign-off/lock) was untouched and a note
from it was never `signedBy` — migrated next, as the fifth migration above. `submitInvOrder` (kind
`"note"`) was untouched — migrated as the sixth, above. `submitPrescribe` (kind `"medication"`) was
untouched — migrated as the seventh, above.

**Deliberately NOT done.** No GHIS write migrated (`opd-emr.js` still posts to `/api/ghis`; the nurse-vitals timeline write is the one migrated, above, and only where a tenant opts in); the
cut-over flag untouched; the 18 queue roles mapped onto actor tiers on 2026-09-06 (see "Who may do what" above); no on-prem repository; no connector
write-back (an external record is read-only natively and the path back to Epic is not built); no
AI actor at the door (an AI draft arriving via a doctor's token is stamped as that doctor, with
`aiDrafted` preserved as a field only); no push fan-out from the server bus; polling, not push, for
the change feed. The safety case did not move: 14 of 16, 2 partial.

## The FIRST native, GHIS-independent clinical writes: registration, vitals, assessment, orders (2026-09-06)

Everything above this section is GHIS-shadow tooling: it makes WardSynQ a faithful mirror of GHIS,
never the primary record. This is the first write that goes to WardSynQ WITHOUT GHIS in the loop at
all — the pivot from "migrate GHIS into WardSynQ" to "WardSynQ operates as its own EMR."

**UPDATED same day, second pass — the native path now covers a full OPD visit, minus prescribing.**
One shared helper, `wsqForcedMigration(env, org)` in `functions/api/queue/[[path]].js`, forces
`{mode:"authoritative"}` (via the org's existing `connectTenantId` link, bypassing the global
`WARDSYNQ_RECORD` flag) for any `org.mode==="wardsynq"`. It is now used at every write site:
- **Registration** (`/patient/register`) — the org is already fetched there; one line.
- **Encounter** (`syncEncounter()`, the ONE shared call site for ticket-add/import/status/checkout).
- **Vitals, assessment, investigation orders** — the timeline handler's existing four-way
  `migrator`/`ctx` dispatch (unchanged) now runs against `wsqMig || <flag-gated call>`.
- **Vitals needed no client change at all**: the nurse-station console (`opd.html`'s `openVitals()`)
  already posts to the generic timeline endpoint with no GHIS-specific branching.
- **Investigation orders**: `submitInvOrder()` in `opd-emr.js` gets a `st.source==="wardsynq"` branch
  via a new shared `postWardsynqTimeline()` helper (refactored out of the assessment path's
  `postWardsynqAssessment`). **Known gap**: `runSearch()` still no-ops the investigation SEARCH for
  non-GHIS sources — there is no native test/service catalog yet, so the write path is wired but a
  doctor cannot yet pick a service to order for a wardsynq hospital without one.
- **Prescriptions are deliberately EXCLUDED**, on purpose, not an oversight: GHIS itself hard-blocks
  `/prescribe` because no drug-interaction/allergy/dose-ceiling CDSS is wired into OPD prescribing
  anywhere (`wardsynq-safety.js` exists, tested, unconnected). A wardsynq hospital has no external
  safety net to substitute — enabling native prescribing now would be LESS safe than GHIS's current
  posture. `submitPrescribe()` has no wardsynq branch; the server's forced-mode check never includes
  `isPrescription`. CDSS wiring is the prerequisite for this, not a follow-up nicety.

**Creating a test wardsynq hospital today needs no new endpoint**: `POST /api/connect/onboard/tenants
{name}` (creates the `connect_tenant` D1 row, self-service) → `POST /api/queue/org {name,
mode:"wardsynq"}` → `POST /api/queue/org/update {orgId, connectTenantId}`. All three already exist.

**The org's existing `mode` field gets a third, explicit value: `"wardsynq"`** (alongside `"native"` =
personal/shared clinic, on-device `_localStore`, and `"connect"` = external FHIR EMR hospital).
`functions/_opd_org.js`'s `org()` normalizer — the ONE choke point every org read/write passes
through (`_opd_org_store.js`'s `createOrg`/`getOrg`/`updateOrg`/`listOrgsForOwner` all call it) — was
widened from a two-way ternary (`o.mode === "connect" ? "connect" : "native"`) to a three-way check.
This was the exact trap the task's stop-condition anticipated: the ternary would have silently
collapsed any `mode:"wardsynq"` document down to `"native"`, and `queue.js`'s `_listClinics()`
filter (`o.mode !== "connect"`) would have listed a wardsynq hospital as a personal clinic. Both are
fixed at the root, not patched per caller. Never inferred from any other field — only an explicit
`mode:"wardsynq"` document gets it; every pre-existing org (no mode, or an unrecognised one) still
defaults to `"native"`, unchanged.

**Why not reuse `"native"` for this.** `org.mode === "native"` is ALREADY claimed, end-to-end, by the
personal/shared solo clinic feature: `_chooseType()`'s picker labels every non-connect org "Personal
clinic", `openTicketEmr()`'s `inClinicWorkplace()` branch ALWAYS routes to the on-device `opdClinic()`
store for it, and `openAdd()`'s `workplaceMode` computation feeds the same assumption into MR
allocation. Routing `"native"` to the WardSynQ record instead would have silently moved every
existing solo/shared clinic doctor's notes off-device into a multi-tenant server store they never
opted into — a real regression, not the smallest change. `"wardsynq"` is additive: `"native"` and
`"connect"` are byte-for-byte unchanged in meaning and behaviour.

**Routing, all three modes:**
- `native` → `queue.js` `_listClinics()` picker → `loadRoom()`/`startClinic()` (org+room session) →
  `openTicketEmr()`'s `inClinicWorkplace()` branch → on-device `opdClinic()`/`_localStore`. Unchanged.
- `connect` → `queue.js` `_listHospitals()` picker → `pickhosp` → `loadSession()` with
  `openOpts.source:"connect"` → `openTicketEmr()`'s hospital branch, `o.source` left unset →
  `opd-emr.js` defaults `st.source` to `"ghis"` → GHIS write-back endpoints. Unchanged.
- `wardsynq` → `queue.js` `_listHospitals()` picker (new `pickwsq` action, alongside GHIS/connect) →
  `loadSession()` with `openOpts.source:"wardsynq"` → `openTicketEmr()`'s hospital branch now passes
  `o.source = "wardsynq"` explicitly → `opd-emr.js`'s `st.source = "wardsynq"` → `submitAssessment()`
  posts straight to `POST /api/queue/timeline` (Firebase-authed, no GHIS token, no `ghisAuth()`).

**The server side reuses `recordAssessment`/`recordAssessmentSignOff` verbatim** — same
`ClinicalNote` versioning, `expectedVersion` concurrency and idempotency as the GHIS-shadow path —
via a NEW early-return branch in the `seg === "timeline"` handler, gated purely on
`org.mode === "wardsynq"`, checked BEFORE the flag-gated `assessmentMigration()` call. It builds
`mig = { mode: "authoritative", tenantId }` directly from `resolveTenantForOrg` (the SAME
`org.connectTenantId` → `connect_tenant` D1 row linkage every shadow migration already uses — no new
linkage mechanism), bypassing `resolveMigration`'s global `WARDSYNQ_RECORD` flag entirely. That flag
stays OFF and untouched: it governs the separate GHIS-shadow feature, meaningless for a hospital with
no GHIS relationship at all. A wardsynq org with no `connectTenantId` linked fails honestly
(`wardsynq_tenant_not_configured`) rather than silently no-opping. The WardSynQ write's own
acceptance is the success condition; a refusal (`record_refused`) returns before the legacy timeline
line is appended, never swallowed the way shadow mode's "report, never block" is.

**Client-side surface area actually needed for the assessment path to work at all, beyond the write
itself:** `st.emrLabel` gets an explicit "WardSynQ" label; `st.writeOn` no longer depends on
`smd_opd_emr_write`/`QUEUE_EMR_WRITE` (those gate GHIS write-back rollout specifically, and would
have hidden the Save button forever for a hospital with no GHIS); `loadProfile()` and
`loadAssessment()` skip their GHIS fetches for `st.source === "wardsynq"` (same as they already do
for `usesLocal`) instead of surfacing "Connect Ward Sync (GHIS) first" on every profile open. The
existing generic timeline read (`loadTimeline()`'s non-local, non-ghis fallback — already there,
unchanged) is the cross-device read-back: it hits the same `GET /api/queue/timeline` the new write
populates via `QT.appendTimeline`, so a second authorised device sees the saved assessment with zero
additional code.

**Explicitly not done in this task, and why it's fine to leave for now:** investigation orders and
prescriptions are untouched — a wardsynq hospital's Investigation/Medication tabs still target GHIS's
search endpoints (`runSearch()`'s existing `st.source !== "ghis"` guard already no-ops them cleanly
rather than erroring); patient registration, vitals and the Encounter migration for a wardsynq org
still route through the flag-gated shadow machinery (off, since `WARDSYNQ_RECORD` stays 0) — the
`ClinicalNote` write does not require a pre-existing `Patient`/`Encounter` resource (the record
service has no referential-integrity check; it is a document store keyed by id, governed by actor
tier/scope, not foreign keys), so the assessment note writes and reads back correctly on its own, but
a fuller native patient chart needs the same per-org "authoritative, no global flag" treatment
applied to those three migrations next. No admin UI creates a `mode:"wardsynq"` org yet — same as
`"connect"` today, it is a direct data write.

**Dormant duplicate, deliberately left alone:** `functions/_opd_model.js`'s `organization()` has the
identical two-way `mode` ternary `_opd_org.js`'s did. It is unimported anywhere ("Nothing imports
this yet — it is a contract, wired in Phase 2 onward", per its own header) and untouched by this
change — no runtime risk, but note it before wiring it in.

## Not built yet

**UPDATED 2026-09-06 — the cut-over is now wired, still off.** `wardsynq-ghis-live-boot.js` connects
`wardsynq/wardsynq-ghis-live.js` to the real page, mirroring `wardsynq-shadow-boot.js`'s own
architecture: polls for `window.ICU`, reads the EXISTING `smd_wardsynq_cutover` flag (no new one),
and — only when it is on — wraps BOTH `ingestWardHistory` and `ingestFromWard` (a `method` parameter
was added to `installLiveGhis` for this, mirroring `installShadow`'s own; without it, wiring only
`ingestFromWard` would have wired the cut-over to a door a current build's real ward sync never
walks through, the identical failure the shadow observer already found once). Exposed as
`window.SMD_WARDSYNQ_LIVE`. `SMD_WARDSYNQ_LIVE.halt('<reason>')` stops every wrapped door
in-process, no reload — the kill switch `installLiveGhis` already had, now reachable.

**Writes only through the connection that already exists, never a new one.** `recordDeps()` in the
boot script reads `window.SMD_WARDSYNQ_RECORD` — the SAME governed, tenant-bound session
`wardsynq-record-boot.js` opens, gated by its OWN separate `?wardsynq_record=<tenantId>`. If that
connection is live, a FRESH `KIND.ADAPTER` actor (never the signed-in doctor's own — capped at DRAFT
by the existing actor model regardless of what tier the doctor holds) writes through it. If it is
not — no tenant configured, which is the realistic state on any device today — `installLiveGhis` runs
in its own already-documented DRY RUN: mapped and counted, nothing written. Turning
`smd_wardsynq_cutover` on, alone, on a device with no `wardsynq_record` tenant, writes NOTHING. Real
writes need both flags, deliberately — a genuine two-key control, not an accident of one script
loading.

**This PR did not perform real-device verification, on purpose** — the owner's own instruction was
to wire the boot layer only and run that verification separately, next.

### Real-device verification of the live cut-over path, 2026-09-06

**STATUS: REAL-DEVICE SHADOW VERIFICATION PASSED.**

Following PR #861 (the boot wiring above), the live cut-over was run once, interactively, against
real GHIS ward-sync traffic on one controlled iPhone — the owner physically present and operating
the device throughout, with every step confirmed over a live WebView console before proceeding to
the next. No patient-identifying information was read or displayed at any point; only counts, status
strings, and coded fields ever left the device.

**Setup.** The device's installed build predated PR #861 (fetching `wardsynq-ghis-live-boot.js`
from it returned `Load failed`), confirming code merged to `main` does not reach a native install
until `build-www.sh` → `cap sync` → an Xcode rebuild → a reinstall — exactly as this vault's Deploy
section already says. The owner explicitly accepted the session reset a reinstall causes (GHIS
login, Firebase sign-in) and the app was rebuilt and reinstalled fresh before verification began.

**What was run:**

| | Before | During | After |
|---|---|---|---|
| `smd_wardsynq_cutover` | OFF | ON | **OFF**, confirmed on a fresh relaunch |
| `smd_wardsynq_record` | OFF | OFF | OFF |
| WardSynQ record connection | absent | absent | absent |
| Live adapter (`window.SMD_WARDSYNQ_LIVE`) | absent | loaded, both methods | absent |

One real ward-sync bundle came through — via `ingestWardHistory` specifically, the actual door
`ghis-ward.js` calls on a current build, not the fallback. Sanitised report:

```
bundlesSeen: 1        mapped: 1             written: 0
observationsMapped: 37
adapterErrors: 0       writeErrors: 0        skippedDuplicate: 0
divergences: 0 (no legacy/canonical row-count mismatch)
issues: 30, ALL coded GHIS_LAB_UNMAPPED
```

**Zero WardSynQ clinical writes occurred**, and not merely as an observed outcome: with no
`wardsynq_record` tenant connection on the device, `installLiveGhis` had no store to write through
at all — the two-key design (cut-over flag + a separately, deliberately configured record
connection) held exactly as designed. **GHIS behaviour was unchanged** by construction: the legacy
`ingestWardHistory` ran first and returned its result untouched before the canonical mapping ran, on
every one of the 693 real ward patients loaded in the roster at the time, not only the one bundle
mapped. The kill switch was proven working: the flag was set false, the app relaunched fresh (a new
process, not a stale in-memory instance), and after waiting past the boot script's own poll window,
`SMD_WARDSYNQ_LIVE` was confirmed absent alongside the flag, the record flag and the record
connection.

**The one thing worth a second look, not a defect.** The first ward-list card's `onPatient(...)`
argument for patient id came back empty for that particular entry — a real, if minor, GHIS data
quality fact (a blank field on one roster row), not a bug in this migration; verification simply
moved to a different patient rather than treat it as a blocker.

**NOT YET APPROVED by this verification, and not attempted:** WardSynQ authoritative clinical
writes; production cut-over; enabling either flag globally or for any tenant beyond this one
controlled device, which was returned to OFF before the session ended.

**OPEN QUALITY ITEM, named rather than hidden:** LOINC coverage for this ward's actual test menu.
30 of 37 real lab observations in the one bundle mapped fell outside `LAB_CODE_SEED`'s seed
vocabulary and were kept under their own GHIS name with `codeSystem: "ghis-local"` rather than a
guessed code — correct, honest behaviour, but it means most of this ward's real lab menu is not yet
LOINC-coded. Not a blocker to the shadow path itself; it must be addressed, by extending the seed
map against real terminology review, before canonical lab Observations from this ward are treated as
clinically complete. No code was changed to address it in this verification.

No defects were found. No code changes were made during this verification.

**Shadow mode itself, traced and hardened 2026-09-06 against the real `ghis-ward.js loadIntoICU`
bundle shape** (`{patient, patientId, source:'Ward Sync', labs}` — no `episodeId`, so
`toEncounter()` returns `null` for every real ward-sync bundle through this path; a stated, verified
divergence, not a bug). Field-by-field: `demoFromPatient()`'s `dem.age/sex/bed/dept/doctor` line up
exactly with what `toPatient`/`toEncounter` read, including the `age`-not-`dob` convention the
adapter's own header documents as trap 1. Lab rows carry `test/result/units/low/high/date`, matching
`toObservations` field-for-field with the optional ones simply absent. 38 existing tests already
covered the shadow module and the adapter; `wardsynq-shadow-boot.js` — the exact layer whose ordering
mistake (below) once made a real device look clean while seeing nothing — had ZERO test coverage
despite that history, so `mergeReports`/`hasAnyMethod`/`flagIsOn` were extracted and exported (pure
refactor, no behaviour change) and now have 7 tests of their own
(`test/wardsynq-shadow-boot.test.mjs`).

**How to run shadow mode, corrected 2026-09-05 after a device round.** On the web,
`?wardsynq_shadow=1`. On the NATIVE app there is no address bar, so the query param is unreachable
and the flag has to be set directly: `SMD_WARDSYNQ_FLAGS.set('smd_wardsynq_shadow', true)` in the
WebView console, then reload. Reading the WebView needs `ios_webkit_debug_proxy`; contrary to the
older note in CLAUDE.md it worked over a network pairing, though the page list empties whenever the
screen locks and the page id increments on every relaunch. Note that a reinstall clears
`localStorage`, so the flag does NOT survive one.

**Read `report().observed` BEFORE `report().clean`.** An observer that has been handed nothing has no
errors and no disagreements. `clean` used to be true in that state, which is how the first real
device run passed for a success while seeing nothing: the observer was wrapping `ingestFromWard`
while `ghis-ward.js:685` calls `ingestWardHistory` on every current build. Both are wrapped now and
`clean` requires `observed`, but the habit of checking what was actually seen is the durable lesson.
`report().byMethod` breaks the counts down per entry point.

**No tenant, actor or audit dimension exists in this mechanism, and none was added.** Unlike the
server-side OPD migrations (`functions/_wardsynq/migrate-*.js`, gated by `WARDSYNQ_RECORD` and a
per-tenant settings key), the shadow observer is pure client-side JS in the WebView: no server round
trip, no `RecordService`, no store, no bus, no authenticated-actor resolution — `installShadow`'s
deps are `{host, flags, method, logger}` and nothing else, and the boot script passes no store or
bus "deliberately and visibly: there is nothing here for the observer to write to or emit on even if
it tried." Tenant isolation, actor governance and audit rows are properties of the SERVER-SIDE record
service (unchanged, untouched, `WARDSYNQ_RECORD` still off) — they do not apply to, and were not
retrofitted onto, a mechanism whose entire safety property is that it writes nowhere at all.

P0, P1, P2 and the P3 core modules are built.

**The bedside renderer is now built and mounted, correcting a stale claim here.** This note said the
view was not written; `wardsynq/ui/opd-render.js` had in fact been written and covered by
`test/wardsynq-opd-render.test.mjs` (14 tests). What was actually missing was a BOOT: `opd.html`
mounted nothing, and its own markup argued why - a page that constructed its own actor would be a
page that decided who was allowed to give a drug.

`opd-boot.js` resolves that without overturning it. It REQUIRES store, actor and eMAR from
`window.WARDSYNQ_OPD_DEPLOYMENT`, so the site still holds the authority, and when they are absent it
paints an explicit "not connected to a patient record" state with every action disabled. That empty
state is the point: before it, an unconfigured page drew a plausible bedside screen with a wristband
field and three live-looking buttons and no system behind it, which is the worst available failure
because it looks like a working drug round.

`?opd_demo=1` mounts an in-memory demonstration behind a permanent undismissable banner. Driven in a
real browser: scanning `DEMO-0001` confirms identity and enables the three actions; scanning
`WRONG-PATIENT-9999` revokes identity, re-disables all three, and shows the ENGINE's message ("either
the wrong chart is open or you are at the wrong patient") rather than one the view invented.

What is genuinely unbuilt: **CTG and fetal monitoring** (see HAZ-MAT-01) — a large, separate hazard
that `wardsynq-obstetrics.js` explicitly does not cover and must not be read as covering. Not
started, and it should not be started without clinical scoping first.

Production gaps, load-bearing: **the record service is built but not deployed** (flag OFF, schema
not applied to production D1, no production tenant has `recordMode` set); no service worker for either surface; a CDN webfont; no barcode
hardware, so every scan is a supplied value; and the secops document "signing" is a content digest
that must be replaced by real cryptography. **The "no notification transport" gap that used to head
this list is closed** — see the notification chain section above.

## The two PARTIAL hazards: what is actually blocking each

Both remain PARTIAL after 2026-09-05, and in both cases the remaining blocker is a CLINICAL SIGN-OFF
rather than code. Recorded plainly so nobody re-does the engineering expecting the row to move.

**HAZ-DET-01 — unrecognised or unanswered deterioration (failure to rescue).**
- IMPLEMENTED and VERIFIED (device): the whole chain, demonstrated above.
- AWAITING CLINICAL SIGN-OFF: the ESCALATION POLICY — response windows and responder tiers — is
  UNAPPROVED and belongs to the **resuscitation committee**. The NEWS2 parameter bands themselves are
  the RCP's published 2017 chart; the policy attached to them is not.
- Also outstanding, and smaller: nothing has yet carried a REAL patient's escalation (the
  demonstration used `DEMO-PAT-1`), and the ladder below mobile still reaches only somebody at a
  screen — no pager, SMS or phone vendor is integrated.

**HAZ-TIME-01 — delayed time-critical treatment, and falsified bundle timing.**
- IMPLEMENTED: bundle warnings and breaches now address through the orchestrator to a handset.
- AWAITING CLINICAL SIGN-OFF: the local policy attached to the published Surviving Sepsis and ACLS
  intervals is UNAPPROVED.
- Structural, and not a sign-off problem: ATTESTATION IS STILL PERMITTED, deliberately. A bundle can
  be compliant on claims alone and only `provenanceReport()` will say so. Elements that are purely
  human acts with no observing system — taking blood cultures — can never be more than attested.
  Delivering a warning is not evidence that an antibiotic was given.

**Applies to all 16 hazards, not just these two:** zero have clinical sign-off. Every threshold pack
— MEOWS cut-offs, PEWS bands, critical-result limits, escalation policy — is UNAPPROVED seed content
owned by the relevant lead. `scripts/wardsynq-assurance.mjs` prints that unconditionally.
