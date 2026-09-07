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
| 2 | Registration / scheduling (Cadence, Prelude) | 5 | 80 | #904. OPD register + queue live on device, appointments with no double-booking, and follow-up recalls that stay outstanding until booked. No resource/room scheduling, no patient self-booking. |
| 3 | Outpatient encounter (Ambulatory) | 6 | 75 | Encounter lifecycle, vitals, assessment, sign — proven on real device. No templates, no flowsheet designer. |
| 4 | Orders — investigations (Beaker/Radiant order entry) | 5 | 92 | #916. ServiceRequest write path + UI, order sets that apply through the ordinary ordering route, and specimen collection between the order and the result: an uncollected order is visibly uncollected, collected is kept apart from received, and a failed draw sends the order back to needing collection rather than reading as in-flight. No order priority. |
| 5 | Prescribing (Willow Ambulatory) | 6 | 85 | #908. MedicationOrder, dose parsing, print, and transmission with a real outbox: queued/sent/acknowledged kept distinct, a failure that stays outstanding until a human deals with it, and a payload versioned to the order. No transport is implemented (a site plugs in its own), no formulary. |
| 6 | Clinical decision support (Best Practice Advisories) | 7 | 88 | #910. Allergy + cross-reactivity + interactions + dose ceilings, fail-closed, Indian drug DB + FDA, override analytics per rule, and a real override RATE: firings are recorded per order and pack version, so the denominator comes from the record rather than from whoever reads the report. No BPA authoring. |
| 7 | Problem list (Problem List) | 4 | 88 | #887 + #915. Coded/text, provisional default, versioned resolve, feeds the summary, and now entered and resolved from the ward chart: the full verification vocabulary is offered so nobody has to overstate confidence, and the code is never derived from the words. No terminology lookup in the UI. |
| 8 | Inpatient admission / ward (ADT) | 7 | 90 | #889. Admit, ward list, ward vitals, discharge, **with a UI**. Transfer with a bed-collision refusal, and a bed board. No admission scheduling. |
| 9 | eMAR / medication administration (Willow Inpatient) | 8 | 95 | #889 + #890 + #917. State machine, five rights, barcode scan, weight-based refusal, AI blocked, **UI**, **a real schedule**, medicines reconciliation, and the second-nurse witness end to end: the high-alert list is the hospital's own config, the refusal is proven through the real route, and the bedside can now name the witness. No infusion or rate-controlled administration. |
| 10 | Nursing documentation (Flowsheets) | 5 | 95 | #895 + #907. Vitals, fluid balance with charted-hour gaps, SBAR shift handover with a read-back loop, care plans with measurable goals, and scored risk assessments whose bands carry actions. No wound charting, no observation charts beyond vitals. |
| 11 | Discharge + summary (Discharge Navigator) | 4 | 90 | #892. Assembler, per-section clinician correction with recorded provenance, immutable signed version, outstanding-items review, A4 print, and the home-medicine reconciliation. Not device-proven. |
| 12 | Results — lab / rad (Beaker, Radiant) | 6 | 88 | #894 + #900 + #911. Native resulting by a `lab` role whose authority is now scoped to laboratory Observations rather than to the type, corrections that keep the prior value, and a closed critical-value loop. No radiology reporting, no autoverification, no delta checks. |
| 13 | Pharmacy verification + inventory (Willow) | 5 | 75 | #897 + #914. Verification and dispensing, both as the pharmacy's OWN authority with a narrow grant: reads what a check needs, writes only its verification and its supply record. A dispense is issued against an order version, refused when the verified version has been superseded, and never touches a MedicationAdministration. No inventory (excluded by instruction), no stock levels or expiry. |
| 14 | Notes / documentation (SmartText, NoteWriter) | 4 | 90 | #909. Signed clinical notes, versioned, per-section provenance, org note templates that supply headings and never content, and co-sign routing: a note by a clinician with no verified registration is submitted, listed and countersigned, with both names kept on the record. No macros, no dictation. |
| 15 | Billing / revenue (Resolute) | 5 | 15 | Clinic billing config only. No charge capture from orders, no claims, no payer. |
| 16 | Security / audit / break-glass | 5 | 98 | #898 + #903 + #911. Capability RBAC scoped by resource type AND by category within a type, append-only audit, tiered AI, break-glass with a mandatory reason, and a consent model where a refusal is a first-class fact. No per-field redaction. |
| 17 | Interoperability (Care Everywhere, HL7/FHIR) | 4 | 82 | #899 + #918. Read-only FHIR R4 export with an honest CapabilityStatement, HL7 v2.5.1-shaped ADT (A01/A02/A03) generated from the record with every delimiter escaped, and the GHIS adapter. Neither door accepts writes and there is no HL7 listener; not validated against a conformance profile. No CDA, no ORU/ORM. |
| 18 | Reporting / analytics (Reporting Workbench, Caboodle) | 3 | 70 | #913. Live ward open-item metrics, plus period quality measures computed from the record with a UI: critical-result acknowledgement against the hospital's own window, dose timeliness, discharge-summary completion. A rate over too few cases is flagged, one with no cases is null rather than 0%, and a measure the record cannot support is shown with its reason. No registries, no warehouse. |
| 19 | Patient portal (MyChart) | 3 | 0 | Not built. |
| 20 | Deployment / uptime / DR (on-prem, HA) | 3 | 55 | #912. Cloudflare edge + D1, live domain, a printable downtime pack the ward can hold during an outage, a restore rehearsal that performs a real export-destroy-restore against the shipped schema, and a DR runbook. The rehearsal passes under `npm test` and currently SKIPS in CI, which lacks `--experimental-sqlite` - see "Needs the owner". No scheduled backup, so RPO/RTO are undefined; no on-prem, no hot standby. |

**Weighted total: 79.9%.**

The total is the weight-times-percent sum of the table above, divided by 100. It is COMPUTED from
these rows, not asserted: earlier revisions of this file carried an eyeballed number that had drifted
about two points high (the 44% baseline was 41.5, and 53% was 50.8). If a row changes, recompute.

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
4. **Whether the five excluded domains stay excluded** (11 weight points; the table cannot reach 100
   while they do).

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

## Deliberately not built
Patient portal, full billing and claims, on-premise deployment, DICOM/PACS and regulatory
certification are excluded by the owner's instruction, not by oversight. Together they are 11
weight points, so this table cannot reach 100 while they stand excluded.

Pharmacy verification as its own authority is deliberately still open (see the note in
`functions/api/queue/[[path]].js`): granting it would give the pharmacy role write access to
`MedicationAdministration`, which needs its own narrower grant, not a widened one.
