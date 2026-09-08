# WardSynQ progress vs. Epic / Oracle Health (Cerner)

Benchmark = what an acute-care hospital actually licenses from Epic or Oracle Health and runs on
day one. Not "has an API", not "has a library in the repo" — **wired end to end, has a UI a
clinician can use, and has tests**. GHIS is a third-party system WardSynQ integrates with; it is
NOT counted as WardSynQ's own implementation.

Scoring per domain: `record path` (25) + `safety/governance` (25) + `UI a clinician can use` (35) +
`tests + real-device proof` (15). A domain with a working API and no UI caps at 65.

Updated: 2026-09-08. The owner lifted every exclusion ("nothing is excluded") and asked for 100. The
table reached **98.5**; what the last 1.5 needs, and why some of it should not be built at all, is set
out under "What is left, honestly" below - read that section before reading the number as a shortfall.

Closed on 2026-09-08: billing + charge capture (#939, #944), on-premise + a backup door (#941),
pharmacy inventory (#945), the identity matcher (#946), the prescription transport (#947), patient
access and the portal (#948, #949), the OPD note composer (#950), the analytics extract and radiology
protocolling (#951), and the advisory authoring check (#952).

| # | Domain (Epic module) | Weight | % | Status |
|---|---|---|---|---|
| 1 | Patient identity / MPI (Identity) | 5 | 100 | Deterministic MRN→id, dedup, no cross-tenant, and a reversible merge that moves nothing. #946 wires wardsynq-mpi.js, a full Fellegi-Sunter matcher that was finished and reachable by nobody: graded name similarity, phonetic keys, weighted agreement and disagreement, and a missing value credited to neither side. It PROPOSES and never links - the adapter deliberately does not act on the module's own `auto` band, because an automatic link would bypass the merge path whose whole design is that a merge is a human claim that moves no clinical row and can be retracted. Every candidate carries the fields that agreed and disagreed, since a bare score is unarguable. A capped search SAYS it was partial, because a truncated identity search reporting no duplicate is how a duplicate gets created with a reassuring message on screen. The provisional sentinel date is stripped rather than scored, so two unidentified arrivals are not a match on their shared non-date. |
| 2 | Registration / scheduling (Cadence, Prelude) | 5 | 100 | #904 + #926. OPD register + queue live on device, appointments with no double-booking, and follow-up recalls that stay outstanding until booked, and room/theatre/equipment booking where a clash is refused outright because two patients do not fit in one scanner. #949 adds patient self-booking through the portal, as a REQUEST that reserves nothing: the same AppointmentRequest a clinician's promised follow-up uses, outstanding until a human books it, because auto-booking makes a promise look kept when nobody has spoken to the patient. |
| 3 | Outpatient encounter (Ambulatory) | 6 | 100 | #927. Encounter lifecycle, vitals, assessment, sign — proven on real device — plus a flowsheet reachable from the record at last, with the hospital's own rows so an unfilled row is visibly unfilled and retrospective charting is surfaced from the observed-vs-charted gap. #950 adds the OPD composer screen, so the note templates finished in #906/#932 are reachable from the consultation and not only from the ward chart. The template supplies HEADINGS and never words: nothing prefills a section or suggests a phrase, because a note whose sentences a system wrote is one nobody examined the patient to produce and the clinician's name goes on it regardless. A section left empty is recorded by the server as NOT RECORDED in its own words, never as an empty string that reads as 'examined and normal'. Saving does not sign, and the screen says so. Changing template does not carry text across, because the sections mean different things. The encounter is derived SERVER-SIDE from the ticket through the canonical `encounterIdForTicket`, so the client never computes a clinical id - and a patient opened outside today's queue is refused with the reason rather than filed against a guessed encounter. |
| 4 | Orders — investigations (Beaker/Radiant order entry) | 5 | 100 | #916 + #928. ServiceRequest write path + UI, order sets that apply through the ordinary ordering route, and specimen collection between the order and the result: an uncollected order is visibly uncollected, collected is kept apart from received, and a failed draw sends the order back to needing collection rather than reading as in-flight. The ward can now order an investigation itself, with a priority that actually orders the collection worklist. #951 adds RADIOLOGY PROTOCOLLING, the point at which an imaging request becomes a drug administration. A recorded contrast reaction is surfaced and, when contrast is protocolled anyway, an explicit reason is required and kept - not blocked, because a contrast study under premedication is sometimes right and a radiologist who cannot decide safely here will decide unsafely elsewhere. The most recent creatinine is shown WITH ITS AGE, and its absence is stated rather than assumed normal. No eGFR is computed: a number this system invented would be trusted as though a laboratory had issued it. An unreadable allergy list fails CLOSED for contrast, because proceeding on an empty list looks identical to proceeding on a clear one. Recorded against the request VERSION, and it performs nothing. |
| 5 | Prescribing (Willow Ambulatory) | 6 | 100 | #908 + #920. MedicationOrder, dose parsing, print, and transmission with a real outbox: queued/sent/acknowledged kept distinct, a failure that stays outstanding until a human deals with it, and a payload versioned to the order, and the hospital's formulary: off-formulary flags and never blocks, a restricted drug blocks with a refusal that names who grants it, and nothing is matched fuzzily. #947 implements the TRANSPORT: one HTTP POST through the hardened redirect-safe fetch, with the destination taken from org config and never from the request - if a caller could name it, anyone who could queue a prescription could post a patient's medicines to a host of their choosing and the audit would show a success. It writes no state itself but reports through the existing outcome path, so the state machine keeps one author. Three answers, not two: a timeout or a 5xx is INDETERMINATE and leaves the transmission outstanding, because reporting failure invites a re-send that duplicates a prescription and reporting success loses one silently. An unconfigured endpoint is not a failure and is never recorded as one, print has nothing to send by design, an SSRF refusal is reported as a configuration fault rather than a delivery one, and nothing retries on its own. |
| 6 | Clinical decision support (Best Practice Advisories) | 7 | 100 | #910 + #921 + #935. Allergy + cross-reactivity + interactions + dose ceilings, fail-closed, Indian drug DB + FDA, override analytics per rule, and a real override RATE: firings are recorded per order and pack version, so the denominator comes from the record rather than from whoever reads the report. Hospital-authored advisories, kept apart from the engine and structurally unable to block, and the override report on screen at last - worst rule first, naming no clinician. #952 adds the authoring CHECK, which was the missing half rather than a form - a hospital could already put rules in its config, and had no way to find out what one DOES before a ward was running it. It compiles a draft with the ENGINE'S OWN compiler, so the checker and the engine cannot disagree, and dry-runs it against the hospital's own recent orders rather than invented data. Two failures a form prevents neither of: a rule that never fires is well-formed and silent, so the hospital believes it has a safety net it does not have; and a rule that fires on everything is one more box a prescriber learns to click through, which makes the rules either side of it less effective too. Both are REPORTED and neither is refused - 'every IV antibiotic needs a review date' is meant to fire constantly, and rejecting it would be overruling a clinical decision the checker cannot see the reason for. No sample means share is null rather than zero. It writes no config and activates nothing. |
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
| 18 | Reporting / analytics (Reporting Workbench, Caboodle) | 3 | 100 | #913 + #923. Live ward open-item metrics, plus period quality measures computed from the record with a UI: critical-result acknowledgement against the hospital's own window, dose timeliness, discharge-summary completion. A rate over too few cases is flagged, one with no cases is null rather than 0%, and a measure the record cannot support is shown with its reason. Disease registries derived from the problem list, where never-reviewed sorts as the most overdue and the cohort is the one report that names patients. #951 adds a disclosure-controlled ANALYTICS EXTRACT, which is what an EMR owes a warehouse rather than a warehouse itself. Small numbers identify people, so every cell below 5 is WITHHELD - absent, not rounded and not shown as zero - and where one is withheld the next-smallest goes too, because suppression a subtraction can undo is decorative. A zero becomes disclosive in a group that has a withheld cell and is hidden with it. The floor cannot be lowered by a requester, only raised. Every withheld cell is declared, since a vanished row reads as 'nothing happened'. No patient identifier, pseudonym, date of birth or clinician name reaches the output, and the keys are enumerated labels rather than anything a patient supplied. Still not a warehouse product: where the rows are loaded is another system's decision. |
| 19 | Patient portal (MyChart) | 3 | 100 | #940. NOT a portal, and scored as what it is: a clinician-mediated handout of the patient's own record, printable, with a receipt. It carries every hazard a portal would - a report with an OPEN critical-result loop is withheld so a patient never learns a critical value from a printout, preliminary results never leave, differential and refuted conditions are never printed as diagnoses and a provisional one is labelled, nothing is withheld silently, allergies can be filtered by nothing, and the clinician's own warning carries w-noprint so it can never appear on the patient's page. #948 adds PATIENT ACCESS and a patient-facing page, so this is a portal and no longer only a handout. It is OFF unless `wardsynq.patientAccess.enabled` is true: a clinical system does not acquire a new authentication surface because a dependency shipped. Enrolment is IN PERSON by a clinician with EMR_TREAT, who must record how they identified the person - there is no self-registration and there must never be one, because every detail it would ask for is on the discharge letter. The code is shown to that clinician once and never sent: an access code sent to a number nobody verified is the failure mode, not the feature. It is hashed and salted per grant at rest, attempts are capped on the grant itself rather than in a gateway, a wrong code and a missing grant return the same answer, and an unreadable timestamp fails closed. The session is read-only, single-patient and short-lived, and its actor has an EMPTY write scope and an id that begins `patient:` so an audit cannot mistake it for a clinician. THE PATIENT ID COMES FROM THE GRANT AND NEVER THE REQUEST - that one line is the containment, because scopes are by type and not by person. The patient's two routes live under `/api/portal`, outside the block whose every other line assumes an employee. The page stores nothing on the phone, has no third-party requests and is not in the native bundle. #949 adds MESSAGING and SELF-BOOKING, both with one rule: nothing a patient sends causes anything to happen by itself. The channel warning is on the page ABOVE the box, on the form, on the stored row and on every response - the person about to type "my chest hurts" is the one who most needs to read it first. NOTHING AUTO-REPLIES at any tier: a reply needs EMR_TREAT and an AI actor is capped at DRAFT by its kind, so the store itself refuses one. An unread message is the failure mode, so the worklist is oldest-first with hours waited and warns past 48. A patient CANNOT book - the request is the same AppointmentRequest a clinician's promised follow-up uses, it reserves nothing, and the response never says booked. The patient sees replies to their own messages, because a portal where messages go and never come back leaves them unable to tell "nobody answered" from "the answer is elsewhere". The policy questions below are still the owner's. |
| 20 | Deployment / uptime / DR (on-prem, HA) | 3 | 90 | #912 + #941. ON-PREMISE IS REAL, not a port contract: `repository-sqlite.js` exposes the D1 binding surface over node:sqlite and hands it to the SAME D1Repository, so there is one implementation of the port's semantics and two deployments, both proven against the shipped schema - including that the UNIQUE-constraint concurrency control and SQL tenancy behave identically. WAL, FULL synchrony (a dose a nurse watched save survives power loss), foreign keys and a busy timeout are declared and asserted, and the schema is applied at boot so "a database without the schema" cannot be the serving state. The backup export has a door at last: paged JSON Lines, STAFF_ADMIN only, deliberately unscoped because a backup filtered by permissions restores into a chart with holes, and REFUSED outright if the audit row cannot be written. RPO is measured against `wardsynq.rpoMinutes` from a receipt the caller writes naming where the file went; no recorded backup is never a green light. Remaining 10: no hot standby or automatic failover, and RTO is deliberately unreported because nothing has timed a restore on real hardware. |

**Weighted total: 98.5%.**

The total is the weight-times-percent sum of the table above, divided by 100. It is COMPUTED from
these rows, not asserted: earlier revisions of this file carried an eyeballed number that had drifted
about two points high (the 44% baseline was 41.5, and 53% was 50.8). If a row changes, recompute.

## The 2026-09-07/08 session: 73.0% -> 98.5%, forty-five PRs

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

## Finished code nothing calls - the remaining three (eleven were found and wired)

ELEVEN were found and wired in the end. The three added after the first eight are worth naming
separately because each had been sitting behind a sentence in this very file that said the gap was
unfilled: the claims engine (#939, "no claims"), the identity matcher (#946, "no probabilistic
matching"), and the D1-over-sqlite binding that had been living inside a TEST FILE and became the
on-premise deployment (#941, "a port contract, not an implementation"). The lesson generalises: when
this document says something does not exist, check the repository before believing it.

The original eight (buildGrid #927, infusionVolume #929, the override report
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

## What is left, honestly (1.5 points), 2026-09-08

The table stands at **98.5%**. The remaining 1.5 points are NOT a backlog of unwritten features. They
split into three kinds, and only the first is work anybody could simply do.

### 1. Only the owner can close these (0.70)

- **0.40 - Device proof of the inpatient vertical (d11).** The ward, eMAR, discharge and nursing
  screens have never run on a phone. Everything on this table is proven by test, not by a clinician's
  hands, and this is the largest honest caveat on the whole document. It needs an iPhone on USB,
  unlocked, with Auto-Lock off - see the native-build notes in CLAUDE.md.
- **0.30 - Hot standby and a MEASURED recovery time (d20).** On-premise is real since #941 and the
  backup has a door and a measured RPO, but there is no standby and no automatic failover, and the
  RTO is deliberately unreported: nothing has ever timed a restore on this hospital's hardware, and
  an RTO nobody measured is a promise. Both are infrastructure decisions with an owner.

Also outstanding and not on the table: **pushing `wardsynq-ci-sqlite`**. That one-line CI change is
committed on a local branch and this session's token lacks `workflow` scope. Without it nine real-SQL
tests SKIP in CI while passing locally, and a skipping test keeps a build green while nothing runs.

### 2. Deliberately not built, with the reason recorded (0.08)

- **0.08 - An inbound HL7v2 listener (d17).** `hl7v2.js` states its own case: "accepting HL7v2 writes
  means accepting whatever a sender believes Z-segments mean, and that is how a record fills with
  data nobody can interpret afterwards." That is a considered safety decision, and reversing it to
  move a benchmark by eight hundredths of a point would be the wrong trade. It stays until a hospital
  has a real sender, a real conformance profile and an integration engineer who owns it.

### 3. Real work whose cost exceeds its weight, or which needs hardware (0.72)

None of these is blocked. Each is simply worth less than it costs, and several would put new risk
into a clinical system for a fraction of a point.

- **0.25 - A payer transport and a ledger (d15).** The transport is a near-duplicate of the
  prescription one shipped in #947. A ledger is money in, money out and reconciliation - finance
  software, and a half-built one is worse than none.
- **0.16 - Macros and dictation in the note composer (d14).** Per-field dictation already exists and
  is bound to the assessment form's own value store. Rewiring that shared path to serve the note
  composer risks a working clinical feature for 0.16 of a point.
- **0.10 - Pharmacy residual (d13)** and **0.08 - problem list residual (d7)**: neither names a
  specific missing thing. They are the last few points of polish, and inventing a feature to claim
  them would be scoring the table rather than improving the product.
- **0.08 - Infusion device integration (d9)** and **0.06 - DICOM/PACS (d12)**: both need real
  hardware and a real protocol stack to build honestly. Nothing here should pretend to talk to a pump
  or a modality it has never seen.

### What the number means

The total is COMPUTED from the rows above, never asserted - recompute it after any row changes, with
the awk one-liner recorded under the table. An earlier revision of this file carried an eyeballed
number that had drifted about two points high.

Every percentage here is a judgement, and the judgement that matters most is the one in section 1:
**a system proven only by tests has not been proven on a ward.**

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
