# WardSynQ progress vs. Epic / Oracle Health (Cerner)

Benchmark = what an acute-care hospital actually licenses from Epic or Oracle Health and runs on
day one. Not "has an API", not "has a library in the repo" — **wired end to end, has a UI a
clinician can use, and has tests**. GHIS is a third-party system WardSynQ integrates with; it is
NOT counted as WardSynQ's own implementation.

Scoring per domain: `record path` (25) + `safety/governance` (25) + `UI a clinician can use` (35) +
`tests + real-device proof` (15). A domain with a working API and no UI caps at 65.

Updated: 2026-09-07 (PRs #887, #889, #890, #892, #894, #895, #897 pharmacy verification, #898 break-glass, #899 FHIR, #900 reconciliation + metrics)

| # | Domain (Epic module) | Weight | % | Status |
|---|---|---|---|---|
| 1 | Patient identity / MPI (Identity) | 5 | 90 | Deterministic MRN→id, dedup, no cross-tenant, and a reversible merge that moves nothing. No probabilistic matching, and none wanted without a human deciding. |
| 2 | Registration / scheduling (Cadence, Prelude) | 5 | 55 | OPD register + queue live on device. No appointments, no recall, no bed-linked scheduling. |
| 3 | Outpatient encounter (Ambulatory) | 6 | 75 | Encounter lifecycle, vitals, assessment, sign — proven on real device. No templates, no flowsheet designer. |
| 4 | Orders — investigations (Beaker/Radiant order entry) | 5 | 60 | ServiceRequest write path + UI. No order sets, no priority/collection workflow. |
| 5 | Prescribing (Willow Ambulatory) | 6 | 70 | MedicationOrder, dose parsing, print. No e-prescribing transmission, no formulary. |
| 6 | Clinical decision support (Best Practice Advisories) | 7 | 65 | Allergy + cross-reactivity + interactions + dose ceilings, fail-closed, Indian drug DB + FDA. No BPA authoring, no override analytics. |
| 7 | Problem list (Problem List) | 4 | 70 | #887. Coded/text, provisional default, versioned resolve, feeds the summary. Read-only on the ward screen; no entry UI. |
| 8 | Inpatient admission / ward (ADT) | 7 | 90 | #889. Admit, ward list, ward vitals, discharge, **with a UI**. Transfer with a bed-collision refusal, and a bed board. No admission scheduling. |
| 9 | eMAR / medication administration (Willow Inpatient) | 8 | 90 | #889 + #890. State machine, five rights, barcode scan, weight-based refusal, AI blocked, **UI**, **and a real schedule**. Plus medicines reconciliation on admission. No high-alert witness config. |
| 10 | Nursing documentation (Flowsheets) | 5 | 75 | #895. Vitals, fluid balance with charted-hour gaps, SBAR shift handover with a read-back loop. No structured assessments, no care plans. |
| 11 | Discharge + summary (Discharge Navigator) | 4 | 90 | #892. Assembler, per-section clinician correction with recorded provenance, immutable signed version, outstanding-items review, A4 print, and the home-medicine reconciliation. Not device-proven. |
| 12 | Results — lab / rad (Beaker, Radiant) | 6 | 85 | #894 + #900. Native resulting by a `lab` role with its own authority, corrections that keep the prior value, and a closed critical-value loop. No radiology reporting, no autoverification, no delta checks. |
| 13 | Pharmacy verification + inventory (Willow) | 5 | 55 | #897. Verification as its OWN authority with a narrow grant: reads what a check needs, writes only the verification. No inventory, no dispensing. |
| 14 | Notes / documentation (SmartText, NoteWriter) | 4 | 60 | Signed clinical notes, versioned, and a document surface with per-section provenance. No templates, no macros, no co-sign routing. |
| 15 | Billing / revenue (Resolute) | 5 | 15 | Clinic billing config only. No charge capture from orders, no claims, no payer. |
| 16 | Security / audit / break-glass | 5 | 80 | #898. Capability RBAC, append-only audit, tiered AI, break-glass with a mandatory reason and an append-only log. No consent model. |
| 17 | Interoperability (Care Everywhere, HL7/FHIR) | 4 | 70 | #899. Read-only FHIR R4 export with an honest CapabilityStatement; GHIS adapter works. No FHIR write, no HL7v2, no CDA. |
| 18 | Reporting / analytics (Reporting Workbench, Caboodle) | 3 | 40 | Live ward open-item metrics: unacknowledged criticals, doses in flight, handovers waiting, medicines undecided, orders unverified. No registries, no quality measures, no warehouse. |
| 19 | Patient portal (MyChart) | 3 | 0 | Not built. |
| 20 | Deployment / uptime / DR (on-prem, HA) | 3 | 25 | Cloudflare edge + D1, live domain. No on-prem, no DR drill, no downtime procedures. |

**Weighted total: 66.9%.**

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
2. **A consent model** — break-glass exists; consent does not.
3. **A category-scoped write grant.** Write scope is by resource TYPE, so the `lab` role's
   Observation write technically permits a vital sign as well as a result. The resulting route
   stamps `laboratory` and a lab actor has no clinical screen, but that is a narrower control than
   the scope itself. Closing it properly is a change to the store's authorisation model.
4. **Order sets, e-prescribing transmission, appointment scheduling, care plans, note templates** -
   each a self-contained gap in an otherwise wired domain.
5. **CDSS override analytics** - the engine refuses and warns; nothing records what clinicians
   override and why, which is where a rule pack learns it is wrong.

## Deliberately not built
Patient portal, full billing and claims, on-premise deployment, DICOM/PACS and regulatory
certification are excluded by the owner's instruction, not by oversight. Together they are 11
weight points, so this table cannot reach 100 while they stand excluded.

Pharmacy verification as its own authority is deliberately still open (see the note in
`functions/api/queue/[[path]].js`): granting it would give the pharmacy role write access to
`MedicationAdministration`, which needs its own narrower grant, not a widened one.
