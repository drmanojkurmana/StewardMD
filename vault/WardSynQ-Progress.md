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
| 4 | Orders — investigations (Beaker/Radiant order entry) | 5 | 85 | ServiceRequest write path + UI, and order sets that apply through the ordinary ordering route. No priority or specimen-collection workflow. |
| 5 | Prescribing (Willow Ambulatory) | 6 | 85 | #908. MedicationOrder, dose parsing, print, and transmission with a real outbox: queued/sent/acknowledged kept distinct, a failure that stays outstanding until a human deals with it, and a payload versioned to the order. No transport is implemented (a site plugs in its own), no formulary. |
| 6 | Clinical decision support (Best Practice Advisories) | 7 | 80 | Allergy + cross-reactivity + interactions + dose ceilings, fail-closed, Indian drug DB + FDA, and override analytics per rule. No BPA authoring, no firing counts so no override RATE yet. |
| 7 | Problem list (Problem List) | 4 | 70 | #887. Coded/text, provisional default, versioned resolve, feeds the summary. Read-only on the ward screen; no entry UI. |
| 8 | Inpatient admission / ward (ADT) | 7 | 90 | #889. Admit, ward list, ward vitals, discharge, **with a UI**. Transfer with a bed-collision refusal, and a bed board. No admission scheduling. |
| 9 | eMAR / medication administration (Willow Inpatient) | 8 | 90 | #889 + #890. State machine, five rights, barcode scan, weight-based refusal, AI blocked, **UI**, **and a real schedule**. Plus medicines reconciliation on admission. No high-alert witness config. |
| 10 | Nursing documentation (Flowsheets) | 5 | 95 | #895. Vitals, fluid balance with charted-hour gaps, SBAR shift handover with a read-back loop, care plans with measurable goals, and scored risk assessments whose bands carry actions. No wound charting, no observation charts beyond vitals. |
| 11 | Discharge + summary (Discharge Navigator) | 4 | 90 | #892. Assembler, per-section clinician correction with recorded provenance, immutable signed version, outstanding-items review, A4 print, and the home-medicine reconciliation. Not device-proven. |
| 12 | Results — lab / rad (Beaker, Radiant) | 6 | 85 | #894 + #900. Native resulting by a `lab` role with its own authority, corrections that keep the prior value, and a closed critical-value loop. No radiology reporting, no autoverification, no delta checks. |
| 13 | Pharmacy verification + inventory (Willow) | 5 | 55 | #897. Verification as its OWN authority with a narrow grant: reads what a check needs, writes only the verification. No inventory, no dispensing. |
| 14 | Notes / documentation (SmartText, NoteWriter) | 4 | 90 | #909. Signed clinical notes, versioned, per-section provenance, org note templates that supply headings and never content, and co-sign routing: a note by a clinician with no verified registration is submitted, listed and countersigned, with both names kept on the record. No macros, no dictation. |
| 15 | Billing / revenue (Resolute) | 5 | 15 | Clinic billing config only. No charge capture from orders, no claims, no payer. |
| 16 | Security / audit / break-glass | 5 | 95 | #898 + #903. Capability RBAC, append-only audit, tiered AI, break-glass with a mandatory reason, and a consent model where a refusal is a first-class fact. No per-field redaction. |
| 17 | Interoperability (Care Everywhere, HL7/FHIR) | 4 | 70 | #899. Read-only FHIR R4 export with an honest CapabilityStatement; GHIS adapter works. No FHIR write, no HL7v2, no CDA. |
| 18 | Reporting / analytics (Reporting Workbench, Caboodle) | 3 | 40 | Live ward open-item metrics: unacknowledged criticals, doses in flight, handovers waiting, medicines undecided, orders unverified. No registries, no quality measures, no warehouse. |
| 19 | Patient portal (MyChart) | 3 | 0 | Not built. |
| 20 | Deployment / uptime / DR (on-prem, HA) | 3 | 25 | Cloudflare edge + D1, live domain. No on-prem, no DR drill, no downtime procedures. |

**Weighted total: 74.3%.**

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

## What is left, in order of what actually moves the number
0. **Device proof of the whole inpatient vertical** — none of the ward, eMAR, discharge or nursing
   screens have been run on a phone. Everything above is proven by test, not by a clinician's hands.
   This is the largest honest caveat on this entire table.
2. **A category-scoped write grant.** Write scope is by resource TYPE, so the `lab` role's
   Observation write technically permits a vital sign as well as a result. The resulting route
   stamps `laboratory` and a lab actor has no clinical screen, but that is a narrower control than
   the scope itself. Closing it properly is a change to the store's authorisation model.
3. ~~E-prescribing transmission (#908) and co-sign routing (#909)~~ - both closed. No prescription
   transport is implemented, and that is stated rather than faked.
4. **Firing counts for the CDSS.** Overrides are now recorded per rule, but nothing counts how
   often a rule FIRES - so the override RATE, which is the number that actually identifies a rule
   training people to click through, still has no denominator. The report says `null` rather than
   inventing one.

## Deliberately not built
Patient portal, full billing and claims, on-premise deployment, DICOM/PACS and regulatory
certification are excluded by the owner's instruction, not by oversight. Together they are 11
weight points, so this table cannot reach 100 while they stand excluded.

Pharmacy verification as its own authority is deliberately still open (see the note in
`functions/api/queue/[[path]].js`): granting it would give the pharmacy role write access to
`MedicationAdministration`, which needs its own narrower grant, not a widened one.
