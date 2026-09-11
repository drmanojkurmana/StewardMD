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

## FHIR R4: the strict capability audit (2026-09-08, after #954-#959)

The baseline was the audit taken before this work: a read-only export of ten types with `patient` as
its only search parameter, `application/json` served under a CapabilityStatement that declared
`application/fhir+json`, no versionId, no history, no Provenance, no Consent, no inbound path (two
finished halves joined to nothing), no SMART server. FHIR maturity then: about 35 percent of the
agreed scope. This table is the state after six pull requests, and it is deliberately strict.

**This is not 100 percent, and it is not claimed to be.** The material gaps within the agreed scope
are listed in the last column and summarised after the table.

| FHIR capability | Implemented | Tested | Production wired | Remaining gap |
|---|---|---|---|---|
| read, vread, history-instance, search-type for Patient, Encounter, Condition, Observation, MedicationRequest, MedicationAdministration, ServiceRequest, DiagnosticReport, AllergyIntolerance, DocumentReference, Consent | yes | pure + route | yes - `/api/queue/ward/fhir` for any `org.mode=wardsynq`, staff session | none material |
| `application/fhir+json` on every response including errors; ETag `W/"versionId"`, Last-Modified; OperationOutcome on every error path incl. 404/405 | yes | route | yes | none |
| `meta.versionId` = record version, `meta.lastUpdated`, `meta.source` URN naming the originating system | yes | pure + route | yes | none |
| search: `_id`, `patient`, `_lastUpdated` (+`_since` alias), `date`, `code` (bare, `system\|code`, `:text`), `_count`, `_sort`, paging with self/next/previous links; strict 400 on unknown params, `Prefer: handling=lenient` reports drops in-bundle; a roster search names its pool cap | yes | pure + route | yes | offset paging (keyset when volumes require it); no `_summary`, `_elements`, chained or reverse-chained params, `_has`, composite params |
| `_include` (report→observations, administration→request, *→patient/encounter), `_revinclude=Provenance:target` | yes | pure + route | yes | no other reverse includes |
| `Patient/{id}/$everything` | yes | route | yes | no `_since` on the operation |
| CapabilityStatement derived from the parser's own tables (cannot drift); declares SMART security block when enabled; states vocabulary coverage | yes | pure (walks every declared param through the parser) | yes | not profile-validated, and says so |
| Provenance: one per VERSION, derived from the store's stamp (author vs assembler, onBehalfOf for AI/adapters, source entity with the sender's id); read by id, search by target (required), `_revinclude` | yes | pure + route | yes | derived, never stored; `agent.who` is a display, not a Practitioner reference (no Practitioner resource exists) |
| Consent export from PatientConsent (refusal = rejected + deny provision) | yes | pure + route | yes | no inbound Consent |
| Identifiers with system URIs and v2-0203 types; MRN under our namespace only for native records, the sender's namespace for imported ones | yes | pure + route | yes | none |
| Terminology registry (`terminology.js`): one place for systems (LOINC, SNOMED, ICD-10/-10-CM/-11, RxNorm, ATC, UCUM, NDC); 34 verified LOINC codes; unmapped codings kept verbatim under the sender's system with an extension | yes | pure + route | yes | 34 verified codes only; no code validation against any LOINC/SNOMED/ICD release (none shipped) - a recognised system with an unverified code is `recognised`, never `verified` |
| Inbound create: `POST /fhir` (Bundle), `POST /fhir/{Type}`; update `PUT /fhir/{Type}/{id}` with If-Match (412 without, 409 stale); through normalizeFhir → SCCM → sccmAdapter → governedForIngest; sender in id prefix, `meta.source` and adapter actor; clinician as `onBehalfOf` | yes | pure + route (partner bundle end to end) | behind `wardsynq.fhir.inbound.enabled` (default off), clinician `emr.treat` door | no conditional create/update (`If-None-Exist`); a `transaction` Bundle is processed entry by entry with per-entry outcomes, NOT atomically; no DELETE; inbound types are Patient, Encounter, Condition, Observation, MedicationRequest/Statement, AllergyIntolerance, DiagnosticReport, DocumentReference - MedicationAdministration, ServiceRequest, Consent, Provenance are export-only and are reported as unsupported on the way in |
| Identity reconciliation: deterministic identifier match links (writes no Patient; local demographics authoritative); ambiguous or probable held WHOLE; source-id-as-MRN guard; per tenant; a person's decision recorded once and consulted first | yes | pure + route | behind inbound flag | probable matches are always held (by design); no national MPI |
| Exception queue + resolution: link / create / reject / accept-feed / keep-local, reason required, `emr.treat`, append-only, re-drive through the same pipeline | yes | route | behind inbound flag | API only - no screen in ward.js yet |
| Conflict handling: local-authoritative, other-source, patient-mismatch (never overridable), If-Match version | yes | pure + route | behind inbound flag | none |
| Idempotency by content digest (never by id); replay lands nothing | yes | route | behind inbound flag | none |
| SMART on FHIR server: `.well-known/smart-configuration`, authorize (PKCE S256 required, exact redirect match, errors about client/redirect never redirected), token (authorization_code; client_credentials with private_key_jwt RS256/ES256 against REGISTERED jwks, iss/sub/aud/exp≤5min/jti checked, jti replay refused), revoke (RFC 7009 shape); scopes never widened; bearer → READ-tier actor with empty write scope; tokens hashed at rest, code spent on exchange | yes | pure (real ES256 assertion) + route | `/api/fhir/{orgId}` deployed; behind `wardsynq.fhir.smart.enabled` with clients registered in org config (default off) | no EHR/standalone launch context, no `patient/` scopes, no refresh tokens, no OpenID Connect `id_token`, no `jwks_uri` fetching (inline jwks only), no consent screen (the clinician's own session authorises), no dynamic client registration, no SMART writes |
| Rate limiting on authorize/token per client with Retry-After | yes | pure + route | memory store per isolate unless `WSQ_RL_KV` is bound (not yet in wrangler.toml) | not on the clinician write door |
| Audit / observability: `record.read`/`list`/`ingest` per row with actor and source; `smart.authorize`/`token`/`token.denied`/`revoke`; PHI-free; token never logged | yes | route | yes | no metrics, latency or dashboard - the audit trail is the observability |
| Tenant isolation at both doors (chart, import, token) | yes | route (two tenants) | yes | none |
| Malformed input: non-JSON, entry without resource, resource without id, bundle without Patient, single resource with no local subject → OperationOutcome, nothing written | yes | route | yes | no StructureDefinition/profile validation |
| Round trip WardSynQ → external EMR → WardSynQ, field for field (Patient, Encounter, Condition, Observation, MedicationRequest, DiagnosticReport, DocumentReference, Provenance) | yes | route | - | MedicationAdministration and AllergyIntolerance are one-directional in the test (export-only / inbound-tested only) |
| Outbound FHIR client (pull), SMART client, ABDM HIP/HIU | exists in Connect | Connect suites | behind `CONNECT_FLAG` + `CONNECT_FHIR_FLAG`, both unset in wrangler.toml | Connect's normalised output is not auto-piped into WardSynQ: the join is the inbound door, which a caller POSTs to; ABDM serves FollowCare only, no WardSynQ hip-source |

**Honest maturity within the agreed scope: about 85 percent implemented, all of it tested, and all
of it deployed behind flags that default off** except the read side, which was already live. What
would make it 100: conditional operations and an atomic `transaction` Bundle; SMART launch context,
`patient/` scopes and a consent screen; inbound MedicationAdministration and Consent; and a
terminology release to validate codes against. None of those was quietly redefined out of scope.

**Can WardSynQ now exchange a real patient's record with another standards-compliant FHIR EMR?**
Outbound: yes, today, from any hospital running in `wardsynq` mode - a compliant client can pull a
patient's chart with Provenance and Consent, page it, and filter it. Inbound: yes, once the hospital
enables `wardsynq.fhir.inbound` - and it will hold rather than guess. Via an external application:
yes, once `wardsynq.fhir.smart` is enabled with a client registered by name.

Defects in SHARED infrastructure that this work exposed and fixed, none of which any test had
caught because no code path ran the halves together: Connect's normaliser dropped
`Patient.identifier` entirely and dropped `Encounter.period`; the SCCM adapter passed a name
object into a string constructor and refused every FHIR patient, and did not recognise the v2
`MR` type; an imported patient's MRN was exported under this hospital's own MRN namespace; the
`DocumentReference` export carried a title and no words; and a stale `If-Match` PUT was silently
treated as a replay because idempotency keyed on the resource id. The last three were in code this
session wrote.

## FHIR R4: the fresh read-only audit (2026-09-08, after #961-#966; the 85 percent baseline above stands as history)

Read from the code and the tests as they are on the six stacked branches, not from memory. The
benchmark table's interoperability row was NOT changed by this audit. Every inbound and SMART
capability below is still OFF by default (`wardsynq.fhir.inbound.enabled`, `wardsynq.fhir.smart.enabled`,
`wardsynq.hl7.inbound.enabled` all absent; `CONNECT_FLAG`/`CONNECT_FHIR_FLAG` unset in wrangler.toml).

| FHIR capability | Implemented | Tested | Production wired | Remaining gap |
|---|---|---|---|---|
| Full search grammar: per-type named params (status, category, identifier on every type, name, birthdate, gender, active, class, clinical-status, verification-status, criticality, intent, based-on, result, request, context, onset-date, recorded-date, issued, authored, effective-time, scope), comma OR / & AND, `:not` `:text` `:missing` `:exact` `:contains`, typed references, implicit code systems, chaining (one hop, fixed-target refs), `_has`, generic `_revinclude`, `_include`, `_summary` (true/text/data/count/false), `_elements` with SUBSETTED tag, `_count=0`, `_total`, `_sort` by any date/string/token param, accent-folded strings, paging with links, strict 400 / lenient in-bundle | yes | 17 pure + route | yes, staff door | offset paging (a declared ceiling, not a conformance gap); no `_include:iterate`, `_contained`, composite params (none declared) |
| `Patient/$everything`: paged searchset, Patient first, `_since`, `_type`, `_count`, `_page`, `_summary`, `_elements`, `_total`; 404 for a patient not here; `start`/`end` named unsupported | yes | pure + route | yes | none material |
| R4 conformance validation: structure (unknown elements are errors), cardinality, datatypes, primitive formats, choice types, required bindings with their HL7 systems, reference targets, invariants obs-6/7, ext-1, ele-1, pat-1, bdl-1/3/4/5/7/8/11/12; hospital-loaded profile constraints; `$validate` (POST body, Parameters, or GET stored) and inbound 422 whole-request; every export mapper validates clean | yes | 15 pure + route | yes | no implementation guide is shipped (US Core / NDHM profiles are the hospital's to load); a declared unknown profile is an information issue, never a pass |
| Terminology validation service: seed (LOINC vitals/lab, HL7's own code systems), hospital code lists, external `$validate-code` server through the hardened fetch with a 3 s timeout and KV/memory cache; verified / recognised / unmapped / invalid; an outage never rejects; invalid codes filed verbatim and exported marked; `$validate-code` operation; `$validate` consults it | yes | pure + route (stubbed server) | yes; server and lists are hospital config | no code release is shipped, by design (the hospital names its server); KV cache is optional (`WSQ_TX_KV`) |
| Conformant ids: canonical ids over 64 chars exported as `wsq-<sha256>` with the canonical id as an Identifier (`urn:stewardmd:record-id`), resolved back on every read path; Provenance ids fit | yes | pure (SHA-256 test vectors) + route | yes | resolution of a hashed id not seen by this isolate scans the compartment or the type pool (declared ceiling) |
| Inbound MedicationAdministration, ServiceRequest, Consent through SCCM 1.1 (additive minor), honestly bounded: doses only in past-tense states, against the feed's own order, performed by an external party; orders draft and external; consents witnessed elsewhere, capacity never asserted; external rows never bill, never reach the collection worklist or pending results, never match a result here | yes | pure + governance negatives + route + round trip | behind inbound flag | the ONE narrow governance grant (`isExternalDoseRecord`) is recorded in Decisions.md and is the owner's to veto |
| Atomic `transaction` Bundles (authorise all, one append), `batch` entry by entry, `If-None-Exist` header and per-entry (0/1/many), per-entry `If-Match`, DELETE named and refused, Bundle envelope validated (bdl-3), `Prefer: return=minimal`, CapabilityStatement declares create/update/conditional/transaction only on the clinician's door with inbound on | yes | pure + governance + route | behind inbound flag | conditional update by search is not offered (declared `conditionalUpdate: false`); GET entries in a batch are not offered |
| SMART: consent screen (CSP, no script, single-use transaction bound to the clinician), EHR launch from the ward (`POST /ward/smart-launch`), standalone `launch/patient` by MRN, `patient/` scopes fenced by the read layer (get, history, compartment, roster, `$everything`), user/system scopes lift the fence per type, refresh tokens rotated with family revocation on reuse, OpenID `id_token` (ES256, `jwks.json`, `nonce`, `fhirUser` to the subject's own Practitioner), registered `jwksUri` for backend clients through the hardened fetch with cache and one refetch, `smart-configuration` derived from what exists | yes | 18 pure + route (7 flows) | `/api/fhir/{orgId}` deployed; behind smart flag; `WSQ_SMART_SIGNING_JWK` optional and documented | no symmetric confidential clients (`client_secret`; SMART v2 recommends asymmetric and this server offers only that); no dynamic client registration by design; no writes by design |
| Rate limiting: Workers rate-limit binding first (exact), KV with indexed windows, memory per isolate, each named in the result | yes | pure + route | code paths deployed; `WSQ_RL` / `WSQ_RL_KV` bindings are the owner's to add (Infra.md) | none in code; the exact path needs the binding bound |
| Exception / reconciliation UI: the ward card lists held messages with reason verbatim and in plain words, candidates, our conflicting record, only the decisions that fit, a required reason, refusals verbatim, unreadable never looks empty | yes | 3 pure render + a real headless-Chrome CDP run | yes (ward.js, ward17-xchg) | none |
| Provenance, Consent export, identifiers, media types, ETag/vread/history, tenant isolation, malformed input, audit, round trip | yes (unchanged from the 85 percent audit) | pure + route | yes | Provenance `agent.who` is a display, not a Practitioner reference: WardSynQ holds no Practitioner resources (the SMART subject-only read is the one exception) |

**Within the agreed WardSynQ FHIR R4 scope there is no material implementation gap left. Every
item of the ten was built, tested at both levels, and left OFF by default.** The remaining lines
in the last column are declared ceilings, deliberate designs, or owner-gated deployment steps
(bindings and a secret), each stated in the code and in Infra.md. Two things are the owner's to
decide, not this session's: the narrow governance grant that lets a feed file a dose another
hospital gave (Decisions.md, reversible), and whether to bind `WSQ_RL` for exact rate limiting.

### HL7 v2 gateway (BUILT 2026-09-08, after FHIR reached the agreed scope; OFF by default)

Built exactly as the note below prescribed, with one refinement: the gateway does not copy the FHIR
door's landing, it CALLS it. `ingestFhir` was split into its FHIR half and `landBundle`, and the HL7
gateway (`functions/_wardsynq/hl7-inbound.js`) parses with Connect's hardened parser, checks the
hospital's integration profile (`wardsynq.hl7.profile`: messages, required segments, sending
applications, processing ids, keepRaw), normalises to SCCM 1.1 (`hl7-normalize.js`: PID-3
repetitions with authority and type, PV1-19 visit number, PV1-3 location as sent, DG1, AL1, OBR/OBX
with NM/SN/ST/CE values, OBX-8 flags carried never recomputed, OBX-11 D/W not filed), and lands
through `landBundle` as one transaction. ADT A01/A02/A03/A04/A08 and ORU R01 are accepted; an A02
or A03 versions the same visit (PV1-19) rather than forking it. ACK/NACK in ER7: AA filed or
already processed, AE held (ERR names the exception) or refused for content, AR refused by the
profile before content; HTTP 200 whenever an ACK could be built, 4xx only when it could not.
Z-segments ride verbatim in the exception payload (the raw message) and in the optional
`ExchangeMessage` receipt; nothing reads them. A held HL7 message is decided from the same ward
card and re-driven through the HL7 door. The listener is HTTPS (`POST /api/queue/ward/hl7`,
`x-application/hl7-v2+er7`, staff session with `emr.treat`); MLLP does not exist on Pages Functions
and is not pretended to. Tests: 7 pure, 3 route-level (link by MRN, held look-alike with Z-segment
kept and decided, replay, A02/A03 versioning, profile AR, ORU report off the worklists, receipt).

### HL7 v2 (deferred by the owner on 2026-09-08 - after the core EMR/UI; recorded here so it is built right)

HL7 v2 must NOT become a second clinical model. The design that fits what now exists: listener →
parser → per-hospital Integration Profile (which segments, which Z-segments, which code tables) →
an HL7v2 → SCCM normaliser beside `fhir-r4/normalize.js` → the SAME `sccmAdapter` → the SAME
inbound pipeline (`ingestFhir`'s identity reconciliation, ownership partition, terminology marking,
exception queue, provenance, idempotency), so ADT A01/A02/A03/A08 and ORU R01 land through exactly
the doors a FHIR bundle does. ACK/NACK at the listener, with an AE for anything held; unknown and
Z-segments preserved verbatim on the exception or the record's source coding and NEVER interpreted;
the dead-letter queue IS `ExchangeException`. A blind listener that wrote what it parsed would be a
second clinical model with a pipe symbol in it.

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
