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

**STATUS: IMPLEMENTED, verified by software (in-process suite) and by a real local D1 run. NOT
clinically validated, NOT clinically approved, NOT deployed (flag OFF, schema not yet applied to the
production D1).** The deployment modes other than Cloudflare D1 are a port contract, not code.

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

**Deliberately NOT done.** No GHIS write migrated (`opd-emr.js` still posts to `/api/ghis`); the
cut-over flag untouched; the 18 queue roles not yet mapped onto actor tiers (only Connect membership
reaches the record today, so a nurse has no route in yet); no on-prem repository; no connector
write-back (an external record is read-only natively and the path back to Epic is not built); no
AI actor at the door (an AI draft arriving via a doctor's token is stamped as that doctor, with
`aiDrafted` preserved as a field only); no push fan-out from the server bus; polling, not push, for
the change feed. The safety case did not move: 14 of 16, 2 partial.

## Not built yet

The `ghis-ward.js` cut-over, still the biggest remaining piece of the owner's architecture: moving
the live mobile path onto the adapter. `wardsynq-shadow.js` exists for it and `icu.js` is untouched;
it awaits a shadow run against real ward data.

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
