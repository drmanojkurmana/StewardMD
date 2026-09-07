# WardSynQ progress vs. Epic / Oracle Health (Cerner)

Benchmark = what an acute-care hospital actually licenses from Epic or Oracle Health and runs on
day one. Not "has an API", not "has a library in the repo" — **wired end to end, has a UI a
clinician can use, and has tests**. GHIS is a third-party system WardSynQ integrates with; it is
NOT counted as WardSynQ's own implementation.

Scoring per domain: `record path` (25) + `safety/governance` (25) + `UI a clinician can use` (35) +
`tests + real-device proof` (15). A domain with a working API and no UI caps at 65.

Updated: 2026-09-07 (PRs #887 problem list, #889 ward UI, #890 MAR scheduling)

| # | Domain (Epic module) | Weight | % | Status |
|---|---|---|---|---|
| 1 | Patient identity / MPI (Identity) | 5 | 70 | Deterministic MRN→id, dedup, no cross-tenant. No merge/unmerge, no probabilistic match. |
| 2 | Registration / scheduling (Cadence, Prelude) | 5 | 55 | OPD register + queue live on device. No appointments, no recall, no bed-linked scheduling. |
| 3 | Outpatient encounter (Ambulatory) | 6 | 75 | Encounter lifecycle, vitals, assessment, sign — proven on real device. No templates, no flowsheet designer. |
| 4 | Orders — investigations (Beaker/Radiant order entry) | 5 | 60 | ServiceRequest write path + UI. No order sets, no priority/collection workflow. |
| 5 | Prescribing (Willow Ambulatory) | 6 | 70 | MedicationOrder, dose parsing, print. No e-prescribing transmission, no formulary. |
| 6 | Clinical decision support (Best Practice Advisories) | 7 | 65 | Allergy + cross-reactivity + interactions + dose ceilings, fail-closed, Indian drug DB + FDA. No BPA authoring, no override analytics. |
| 7 | Problem list (Problem List) | 4 | 70 | #887. Coded/text, provisional default, versioned resolve, feeds the summary. Read-only on the ward screen; no entry UI. |
| 8 | Inpatient admission / ward (ADT) | 7 | 75 | #889. Admit, ward list, ward vitals, discharge, **with a UI**. No transfer, no bed board. |
| 9 | eMAR / medication administration (Willow Inpatient) | 8 | 80 | #889 + #890. State machine, five rights, barcode scan, weight-based refusal, AI blocked, **UI**, **and a real schedule**. No pharmacy verification as its own authority, no high-alert witness config. |
| 10 | Nursing documentation (Flowsheets) | 5 | 40 | Ward vitals with a UI. No assessments, no I/O, no shift handover, no care plans. |
| 11 | Discharge + summary (Discharge Navigator) | 4 | 55 | Deterministic assembler, sign, corrections survive. **No UI.** Not device-proven. |
| 12 | Results — lab / rad (Beaker, Radiant) | 6 | 25 | DiagnosticReport read from GHIS. No native resulting, no autoverification, no critical-value loop. |
| 13 | Pharmacy verification + inventory (Willow) | 5 | 10 | Pharmacist role exists; verification is not its own authority. No inventory, no dispensing. |
| 14 | Notes / documentation (SmartText, NoteWriter) | 4 | 50 | Signed clinical notes, versioned. No templates, no macros, no co-sign routing. |
| 15 | Billing / revenue (Resolute) | 5 | 15 | Clinic billing config only. No charge capture from orders, no claims, no payer. |
| 16 | Security / audit / break-glass | 5 | 55 | Capability RBAC, append-only audit, tiered AI. **No break-glass**, no consent model. |
| 17 | Interoperability (Care Everywhere, HL7/FHIR) | 4 | 30 | Canonical model is FHIR-shaped; GHIS adapter works. No FHIR endpoint, no HL7, no CDA. |
| 18 | Reporting / analytics (Reporting Workbench, Caboodle) | 3 | 5 | Usage counters only. No clinical reporting, no registries, no quality measures. |
| 19 | Patient portal (MyChart) | 3 | 0 | Not built. |
| 20 | Deployment / uptime / DR (on-prem, HA) | 3 | 25 | Cloudflare edge + D1, live domain. No on-prem, no DR drill, no downtime procedures. |

**Weighted total: 53%.**

## Done since the baseline
- **Ward UI** (#889) — the inpatient stack was server-authoritative and tested with nothing calling
  it. `ward.js`/`ward.css`, same pattern as `queue.js`. Lifted 8/9/10 out of the no-screen cap.
- **MAR scheduling** (#890) — the frequency the prescriber wrote now becomes the doses that are due.
  PRN never scheduled, unreadable frequencies reported rather than dropped, TDS distinguished from
  Q8H, and `stopAt` so a course cannot run forever.

## The three things that most move it now
1. **Discharge UI + device proof** — the summary assembler is finished and nobody can reach it.
2. **Results + critical-value loop** — the biggest pure-clinical gap; a lab that goes nowhere.
3. **Transfer / bed management** — a ward you can admit to and discharge from but not move within.

Pharmacy verification as its own authority is deliberately still open (see the note in
`functions/api/queue/[[path]].js`): granting it would give the pharmacy role write access to
`MedicationAdministration`, which needs its own narrower grant, not a widened one.
