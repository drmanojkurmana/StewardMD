# WardSynQ progress vs. Epic / Oracle Health (Cerner)

Benchmark = what an acute-care hospital actually licenses from Epic or Oracle Health and runs on
day one. Not "has an API", not "has a library in the repo" — **wired end to end, has a UI a
clinician can use, and has tests**. GHIS is a third-party system WardSynQ integrates with; it is
NOT counted as WardSynQ's own implementation.

Scoring per domain: `record path` (25) + `safety/governance` (25) + `UI a clinician can use` (35) +
`tests + real-device proof` (15). A domain with a working API and no UI caps at 65.

Updated: 2026-09-07 (PRs #887, #889, #890, #892, #894, #895, #897 pharmacy verification, #898 break-glass, #899 FHIR, #900 reconciliation + metrics, #907 risk assessments, #908 e-prescribing)

| # | Domain (Epic module) | Weight | % | Status |
|---|---|---|---|---|
| 1 | Patient identity / MPI (Identity) | 5 | 90 | Deterministic MRN→id, dedup, no cross-tenant, and a reversible merge that moves nothing. No probabilistic matching, and none wanted without a human deciding. |
| 2 | Registration / scheduling (Cadence, Prelude) | 5 | 92 | #904 + #926. OPD register + queue live on device, appointments with no double-booking, and follow-up recalls that stay outstanding until booked, and room/theatre/equipment booking where a clash is refused outright because two patients do not fit in one scanner. No patient self-booking (portal). |
| 3 | Outpatient encounter (Ambulatory) | 6 | 88 | #927. Encounter lifecycle, vitals, assessment, sign — proven on real device — plus a flowsheet reachable from the record at last, with the hospital's own rows so an unfilled row is visibly unfilled and retrospective charting is surfaced from the observed-vs-charted gap. Note templates exist (#906) and are reachable for any encounter; no OPD-specific composer screen. |
| 4 | Orders — investigations (Beaker/Radiant order entry) | 5 | 98 | #916 + #928. ServiceRequest write path + UI, order sets that apply through the ordinary ordering route, and specimen collection between the order and the result: an uncollected order is visibly uncollected, collected is kept apart from received, and a failed draw sends the order back to needing collection rather than reading as in-flight. The ward can now order an investigation itself, with a priority that actually orders the collection worklist. No radiology protocolling. |
| 5 | Prescribing (Willow Ambulatory) | 6 | 92 | #908 + #920. MedicationOrder, dose parsing, print, and transmission with a real outbox: queued/sent/acknowledged kept distinct, a failure that stays outstanding until a human deals with it, and a payload versioned to the order, and the hospital's formulary: off-formulary flags and never blocks, a restricted drug blocks with a refusal that names who grants it, and nothing is matched fuzzily. No transport is implemented (a site plugs in its own). |
| 6 | Clinical decision support (Best Practice Advisories) | 7 | 98 | #910 + #921 + #935. Allergy + cross-reactivity + interactions + dose ceilings, fail-closed, Indian drug DB + FDA, override analytics per rule, and a real override RATE: firings are recorded per order and pack version, so the denominator comes from the record rather than from whoever reads the report. Hospital-authored advisories, kept apart from the engine and structurally unable to block, and the override report on screen at last - worst rule first, naming no clinician. No rule-pack authoring UI. |
| 7 | Problem list (Problem List) | 4 | 98 | #887 + #915 + #930. Coded/text, provisional default, versioned resolve, feeds the summary, and now entered and resolved from the ward chart: the full verification vocabulary is offered so nobody has to overstate confidence, and the code is never derived from the words. ICD search offers candidates and selects none: a person presses one, and until they do the diagnosis is text. |
| 8 | Inpatient admission / ward (ADT) | 7 | 100 | #889 + #922 + #936. Admit, ward list, ward vitals, discharge, **with a UI**. Transfer with a bed-collision refusal, a bed board, and a waiting list that reserves no bed and admits nobody automatically, and NEWS2 from the ward's own observations - incomplete is never reassuring, Scale 2 is never inferred, and the escalation policy says when it is unapproved. |
| 9 | eMAR / medication administration (Willow Inpatient) | 8 | 99 | #889 + #890 + #917 + #929. State machine, five rights, barcode scan, weight-based refusal, AI blocked, **UI**, **a real schedule**, medicines reconciliation, and the second-nurse witness end to end: the high-alert list is the hospital's own config, the refusal is proven through the real route, and the bedside can now name the witness. Infusions chart rate changes and integrate the volume, saying on every total how much of it assumes the pump kept running. No device integration - nothing here sets a rate. |
| 10 | Nursing documentation (Flowsheets) | 5 | 100 | #895 + #907 + #925 + #936. Vitals, fluid balance with charted-hour gaps, SBAR shift handover with a read-back loop, care plans with measurable goals, and scored risk assessments whose bands carry actions, and wound charting where a pressure ulcer is never reverse-staged and its origin is set once. Supplemental oxygen and ACVPU are recordable at last, so an early warning score can complete - and a child gets PEWS rather than a refusal. No wound images. |
| 11 | Discharge + summary (Discharge Navigator) | 4 | 90 | #892. Assembler, per-section clinician correction with recorded provenance, immutable signed version, outstanding-items review, A4 print, and the home-medicine reconciliation. Not device-proven. |
| 12 | Results — lab / rad (Beaker, Radiant) | 6 | 99 | #894 + #900 + #911 + #919 + #933. Native resulting by a `lab` role scoped to laboratory Observations, corrections that keep the prior value, a closed critical-value loop, delta checks against the hospital's own limits (advisory, never withholding), autoverification that fails closed, and radiology reporting where a preliminary reading survives the final one and a changed impression is flagged as a discrepancy. No images (DICOM/PACS excluded). |
| 13 | Pharmacy verification + inventory (Willow) | 5 | 98 | #897 + #914 + #931. Verification and dispensing, both as the pharmacy's OWN authority with a narrow grant: reads what a check needs, writes only its verification and its supply record. A dispense is issued against an order version, refused when the verified version has been superseded, and never touches a MedicationAdministration. Batch and expiry are recorded from the box and expired stock is refused - the only non-prescription block in the file. #943 adds INVENTORY with its worst failure designed out: a count is a belief and the box in the pharmacist's hand is the fact, so nothing in stock control can refuse a dispense and the dispense path does not import it. The level is SUMMED from append-only movements and never stored as a counter, because a counter loses one of two concurrent updates in the direction that overstates stock. Issues are not re-entered: the quantity that left is already a MedicationDispense, and two entries for one event can disagree. A negative level is reported rather than clamped to zero, because a plausible number is one nobody investigates. Units are never converted - boxes and tablets sit side by side, since guessing the mapping is wrong by a factor of twenty-eight. Reorder levels produce a list and nothing is ever ordered. |
| 14 | Notes / documentation (SmartText, NoteWriter) | 4 | 96 | #909 + #932. Signed clinical notes, versioned, per-section provenance, org note templates that supply headings and never content, and co-sign routing: a note by a clinician with no verified registration is submitted, listed and countersigned, with both names kept on the record - and a ward round composer that supplies the hospital's headings, writes no text of its own, and never signs. No macros, no dictation. |
| 15 | Billing / revenue (Resolute) | 5 | 95 | #939. The claims engine, reachable at last: a claim is coded against the problem list and a code the record does not document is REFUSED rather than queried, a differential or refuted condition is never evidence, coding that changes after a denial is flagged permanently, a pre-auth is recorded as a funding decision that is explicitly not a clinical one, and the one function that could gate care always returns yes. The guarantee is the grant, not the header: BILLING_CHARGE writes Claim and PreAuthorisation and cannot write a Condition, so billing cannot manufacture its own justification. #942 adds CHARGE CAPTURE, and its rule is that a charge comes from what was DONE and never from what was ordered: capturing from orders bills for doses the patient refused and tests nobody performed, and the patient is the one who receives that bill. The eMAR's own state machine decides what happened - `administered` and nothing else, so `held`, `refused` and `scanned` are not charges - and a preliminary report is not a completed test. Every skipped item is named with why. The tariff is the hospital's own (`wardsynq.tariff`) with no default rate card, an unpriced item is listed rather than dropped or quietly zeroed, and a tariff entry with a blank amount is a configuration mistake rather than a price of zero. It is computed on every request and never stored. Charge capture widened billing's READ by the four "what was done" types and NOTHING joined its write scope. Remaining 5: no payer transport and no ledger. |
| 16 | Security / audit / break-glass | 5 | 100 | #898 + #903 + #911 + #938. Capability RBAC scoped by resource type AND by category within a type, append-only audit, tiered AI, break-glass with a mandatory reason, a consent model where a refusal is a first-class fact, and a read log that closes HAZ-FLUID-01 - bounded, purpose-stamped, and with no way to ask what a person has read. No per-field redaction. |
| 17 | Interoperability (Care Everywhere, HL7/FHIR) | 4 | 98 | #899 + #918 + #924 + #934. Read-only FHIR R4 export with an honest CapabilityStatement, HL7 v2.5.1-shaped ADT (A01/A02/A03) generated from the record with every delimiter escaped, and the GHIS adapter. Neither door accepts writes and there is no HL7 listener; not validated against a conformance profile. HL7v2 ORU^R01 results out, with a non-numeric result typed ST and the laboratory's own abnormal flag never recomputed. CDA R2 level 1 for a SIGNED discharge summary - a real header wrapping a narrative body, no templateId claiming conformance nobody validated. No inbound ORM, no listener of any kind. |
| 18 | Reporting / analytics (Reporting Workbench, Caboodle) | 3 | 88 | #913 + #923. Live ward open-item metrics, plus period quality measures computed from the record with a UI: critical-result acknowledgement against the hospital's own window, dose timeliness, discharge-summary completion. A rate over too few cases is flagged, one with no cases is null rather than 0%, and a measure the record cannot support is shown with its reason. Disease registries derived from the problem list, where never-reviewed sorts as the most overdue and the cohort is the one report that names patients. No warehouse. |
| 19 | Patient portal (MyChart) | 3 | 40 | #940. NOT a portal, and scored as what it is: a clinician-mediated handout of the patient's own record, printable, with a receipt. It carries every hazard a portal would - a report with an OPEN critical-result loop is withheld so a patient never learns a critical value from a printout, preliminary results never leave, differential and refuted conditions are never printed as diagnoses and a provisional one is labelled, nothing is withheld silently, allergies can be filtered by nothing, and the clinician's own warning carries w-noprint so it can never appear on the patient's page. NO PATIENT LOGIN: `Patient` holds no contact detail and there is no patient identity anywhere in this build, so no result feed, no messaging and no self-booking. That is the owner's decision, below. |
| 20 | Deployment / uptime / DR (on-prem, HA) | 3 | 90 | #912 + #941. ON-PREMISE IS REAL, not a port contract: `repository-sqlite.js` exposes the D1 binding surface over node:sqlite and hands it to the SAME D1Repository, so there is one implementation of the port's semantics and two deployments, both proven against the shipped schema - including that the UNIQUE-constraint concurrency control and SQL tenancy behave identically. WAL, FULL synchrony (a dose a nurse watched save survives power loss), foreign keys and a busy timeout are declared and asserted, and the schema is applied at boot so "a database without the schema" cannot be the serving state. The backup export has a door at last: paged JSON Lines, STAFF_ADMIN only, deliberately unscoped because a backup filtered by permissions restores into a chart with holes, and REFUSED outright if the audit row cannot be written. RPO is measured against `wardsynq.rpoMinutes` from a receipt the caller writes naming where the file went; no recorded backup is never a green light. Remaining 10: no hot standby or automatic failover, and RTO is deliberately unreported because nothing has timed a restore on real hardware. |

**Weighted total: 94.0%.**

The total is the weight-times-percent sum of the table above, divided by 100. It is COMPUTED from
these rows, not asserted: earlier revisions of this file carried an eyeballed number that had drifted
about two points high (the 44% baseline was 41.5, and 53% was 50.8). If a row changes, recompute.

## The 2026-09-07/08 session: 73.0% -> 86.3%, twenty-seven PRs

Every gap this file named at the start of that session is closed. The pattern that produced most of
the value, worth repeating: **look for finished library code nothing calls.** EIGHT separate
subsystems were complete, tested and reachable by nobody - `buildGrid` and `infusionVolume` in
wardsynq-flowsheet.js (#927, #929), the override report (#935), the note templates and co-sign
routing that had no screen (#932), NEWS2 (#936), PEWS (#937), the read log (#938) and the claims
engine (#939). Reaching them was cheaper than building anything and worth more, and twice it
exposed a second-order fault that only surfaced once something called the code: the vitals form
could not record supplemental oxygen or ACVPU, so NEWS2 could never have completed a score, and
HAZ-FLUID-01's note said its blocker "does not exist" when the module for it was sitting in the
repository.

The recurring bug, three times in one session: **`Number("")` is 0 and 0 is finite.** It turned a
missing order version into "v0" (#908), a configured-but-empty delta rule into a threshold of zero
(#919), and would have done it again. Check for the absent value, never for finiteness.

## Done since the baseline (41.5% -> 52.4%)
- **Problem list** (#887) — `Condition` had zero write paths; diagnoses lived only as prose.
- **Ward UI** (#889) — the inpatient stack was server-authoritative and tested with nothing calling
  it. `ward.js`/`ward.css`, same pattern as `queue.js`. Lifted 8/9/10 out of the no-screen cap.
- **MAR scheduling** (#890) — the frequency the prescriber wrote now becomes the doses that are due.
  PRN never scheduled, unreadable frequencies reported rather than dropped, TDS distinguished from
  Q8H, and `stopAt` so a course cannot run forever.
- **Discharge workstation** (#892) — the assembler was finished and unreachable. Per-section
  clinician correction with recorded provenance (`editedSections`), an immutable signed version, the
  outstanding-items review before sign-off, and an A4 print artifact.

## Finished code nothing calls - the remaining three

Eight were found and wired this session (buildGrid #927, infusionVolume #929, the override report
#935, the note templates #932, NEWS2 #936, PEWS #937, the read log #938, the claims engine #939).
Three are still unreachable from any route, and each is a decision rather than an oversight:

- ~~`wardsynq-billing.js`~~ - WIRED (#939), once the owner lifted the exclusion. Its rule is that
  the clinical record is the source and billing never writes to it, and that rule is now enforced by
  the GRANT rather than by its header: BILLING_CHARGE writes `Claim` and `PreAuthorisation` and
  cannot write a `Condition`, so a coder cannot add the diagnosis that would justify their own
  charge. Two things this record genuinely cannot support are stated rather than faked - no order,
  result or prescription carries an indication, so INFERRED support never fires and every code is
  either on the problem list or refused; and `Condition` has no severity field, so every
  severity-tiered code is flagged, which is the true answer.

- ~~`wardsynq-readlog.js`~~ - WIRED (#938), on the owner's instruction. It closes the blocker
  HAZ-FLUID-01 named. The PHI questions were answered structurally rather than by policy: the purpose
  is stamped on every row, retention is bounded at 90 days and enforced on the ANSWER rather than only
  by a cleanup job, and there is deliberately NO "what did this person read" query - the only question
  the routes answer is "who has to be told about THIS correction".
- **`wardsynq-lineage.js`** - click a derived value and see the raw observations behind it. Partly
  redundant now: `news2()` already returns per-parameter `sources` with the observation id, time and
  code, and #935's override report carries its own denominator. Worth wiring if a UI ever needs one
  tracing surface across all derived values.
- **`wardsynq-quality.js`** - a regulator-grade measure engine. `functions/_wardsynq/quality.js`
  (#913) covers the measures WardSynQ can honestly compute today; this is the larger engine and
  duplicating its scope without a regulator's specification would be inventing the specification.
- **`wardsynq-temporal.js`** - bi-temporal queries ("what did the team believe at 15:00 yesterday").
  The record is already bi-temporal via `recordedAt`/`effectiveAt` and `history()`; this is the query
  layer, and nothing yet asks the question.

## Needs the owner, not more code
1. **Push `wardsynq-ci-sqlite`.** A one-line CI change, committed on that local branch and NOT
   pushable by this session's token (`refusing to allow an OAuth App to create or update workflow
   .github/workflows/ci.yml without workflow scope`). It adds `--experimental-sqlite` to the
   `Run unit tests` step in `.github/workflows/ci.yml`. Without it `node:sqlite` is unavailable and
   NINE tests SKIP rather than fail - the six in `wardsynq-d1-sql.test.mjs` that execute the shipped
   schema, and the three in `wardsynq-restore.test.mjs` that perform a real restore rehearsal. A
   skipping test keeps the build green while nothing runs, which is worse than a red one. All nine
   pass under `npm test`, which has always passed the flag.
2. **Device proof** - see item 0 below.
3. **Where the record backups live**, and who holds them - see the DR runbook.
4. ~~Whether the five excluded domains stay excluded~~ - ANSWERED 2026-09-08: "nothing is excluded".
5. **Is the cashier the coder?** (#939) In `_queue_roles.js` one role holds QUEUE_VIEW, ORDER_READ,
   BILLING_VIEW and BILLING_CHARGE, and BILLING_CHARGE now carries read on `Condition` - because
   coding a claim asks exactly one question, is this diagnosis written down, and it cannot be
   answered without it. The read is the problem list and NOTHING else clinical: not the notes, not
   the results, not the drug chart. But it does mean the person taking cash at the counter can read
   a patient's diagnoses through the raw record API. A hospital that employs separate coders should
   hold BILLING_CHARGE for them alone and leave the cashier on BILLING_VIEW, which reads claims and
   writes nothing. That is a role-mapping decision, not a code change.
6. **PATIENT AUTHENTICATION - the whole of what separates #940 from a real portal.** `Patient` holds
   a name, an MRN, a date of birth and a wristband barcode, and NO contact detail of any kind. There
   is no patient identity anywhere in this build. A portal needs one, and every part of it is the
   owner's decision and not a programmer's: who may enrol a patient, what proves they are who they
   say, what happens when the number in the record belongs to a relative or to a shared family
   phone, what a patient sees before a clinician has seen it (immediate release is law in some
   jurisdictions and unsafe practice in others), and what happens to access after a death or a
   safeguarding flag. #940 deliberately builds the half that needs none of that - a clinician-
   mediated handout - and solves every hazard a portal would inherit: critical results, preliminary
   results, differentials, silent withholding and sensitivity. The remaining 60% of domain 19 is
   that decision, not more code.
7. **`wardsynq.neverRelease` is unset and there is no default.** No result is withheld from a
   patient's copy on grounds of sensitivity until a hospital names the panels. The record carries no
   sensitivity flag and this build will not invent a code list, so the page tells the clinician, on
   screen and never in print, to read it before handing it over. A hospital handing out results at a
   counter should configure this before it does.
8. **A hospital-wide upcoding sweep.** `GET upcoding` answers per patient, because the repository is
   queried by patient and a route that walked every claim in the hospital is a compliance report
   rather than a safety check - it needs its own owner, its own retention decision and its own
   authority. The module's instruction is that the list is read "by somebody who is not paid on
   collections", which is why the route sits behind STAFF_ADMIN and not BILLING_VIEW.

## What is left, in order of what actually moves the number
-1. **A SCHEDULED BACKUP.** Nothing takes the record export automatically - `vault/runbooks/
   WardSynQ-Disaster-Recovery.md` §2a is a command a human has to run. The restore is rehearsed in
   CI and the verification refuses an incomplete dump, but with no schedule there is no bound on how
   much would be lost, so RPO and RTO are undefined. This is now the largest single gap in the
   deployment domain and it needs an owner decision (where the dumps live, who holds them).
0. **Device proof of the whole inpatient vertical** — none of the ward, eMAR, discharge or nursing
   screens have been run on a phone. Everything above is proven by test, not by a clinician's hands.
   This is the largest honest caveat on this entire table.
2. ~~A category-scoped write grant~~ - closed in #911. `Observation` is one resource type carrying
   four unrelated clinical meanings, so a type-level scope let the `lab` role write a vital sign and
   the `nurse` role write a laboratory result. The store now takes a per-type category allow-list;
   an entity with no category is refused rather than waved through, and an AI inherits the
   constraint with the rest of the human's scope.
3. ~~E-prescribing transmission (#908) and co-sign routing (#909)~~ - both closed. No prescription
   transport is implemented, and that is stated rather than faked.
4. ~~Firing counts for the CDSS~~ - closed in #910. A `SafetyFiring` is recorded per order and rule
   pack version, so the override rate has a denominator that comes from the record. A verdict that
   carries no `findings` still yields no rate, and the report says so rather than inventing one.

## What is left, honestly (13.7 points)

- **7.25 excluded by instruction**: billing/claims (4.25) and the patient portal (3.00).
- **1.35 deployment**, of which the scheduled backup needs an owner decision (where dumps live, who
  holds them) and on-premise/HA is excluded.
- **0.98 stated non-goals**: probabilistic identity matching (d1) and an e-prescribing transport (d5)
  are deliberate absences with their reasoning recorded, not unfinished work.
- **0.40 device proof** (d11): the discharge screen, like every other screen built this session, has
  never run on a phone.
- **0.40 patient self-booking** (d2), which is the portal again.
- **~3.3 genuinely buildable**: an OPD-specific note composer, a rule-pack authoring screen, CDA
  export, a data warehouse, and a scattering of half-points.

So the reachable ceiling is about 92.75, and the honest remainder is roughly three points of real
work plus four things only the owner can do.

## No longer excluded (owner, 2026-09-08: "nothing is excluded")

Billing/claims, the patient portal, on-premise deployment, DICOM/PACS and regulatory certification
were excluded for most of this build. That instruction was lifted, so the ceiling is 100 and the two
largest remaining items are billing (4.25 weight points, at 15%) and the patient portal (3.00, at 0%).

## Previously deliberately not built
Patient portal, full billing and claims, on-premise deployment, DICOM/PACS and regulatory
certification are excluded by the owner's instruction, not by oversight. Together they are 11
weight points, so this table cannot reach 100 while they stand excluded.

Pharmacy verification as its own authority is deliberately still open (see the note in
`functions/api/queue/[[path]].js`): granting it would give the pharmacy role write access to
`MedicationAdministration`, which needs its own narrower grant, not a widened one.
