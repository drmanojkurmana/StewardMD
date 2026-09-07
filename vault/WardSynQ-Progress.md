# WardSynQ progress vs. Epic / Oracle Health (Cerner)

Benchmark = what an acute-care hospital actually licenses from Epic or Oracle Health and runs on
day one. Not "has an API", not "has a library in the repo" — **wired end to end, has a UI a
clinician can use, and has tests**. GHIS is a third-party system WardSynQ integrates with; it is
NOT counted as WardSynQ's own implementation.

Scoring per domain: `record path` (25) + `safety/governance` (25) + `UI a clinician can use` (35) +
`tests + real-device proof` (15). A domain with a working API and no UI caps at 65.

Updated: 2026-09-07 (PR #887)

| # | Domain (Epic module) | Weight | % | Status |
|---|---|---|---|---|
| 1 | Patient identity / MPI (Identity) | 5 | 70 | Deterministic MRN→id, dedup, no cross-tenant. No merge/unmerge, no probabilistic match. |
| 2 | Registration / scheduling (Cadence, Prelude) | 5 | 55 | OPD register + queue live on device. No appointments, no recall, no bed-linked scheduling. |
| 3 | Outpatient encounter (Ambulatory) | 6 | 75 | Encounter lifecycle, vitals, assessment, sign — proven on real device. No templates, no flowsheet designer. |
| 4 | Orders — investigations (Beaker/Radiant order entry) | 5 | 60 | ServiceRequest write path + UI. No order sets, no priority/collection workflow. |
| 5 | Prescribing (Willow Ambulatory) | 6 | 70 | MedicationOrder, dose parsing, print. No e-prescribing transmission, no formulary. |
| 6 | Clinical decision support (Best Practice Advisories) | 7 | 65 | Allergy + cross-reactivity + interactions + dose ceilings, fail-closed, Indian drug DB + FDA. No BPA authoring, no override analytics. |
| 7 | Problem list (Problem List) | 4 | 60 | **NEW #887.** Coded/text, provisional default, versioned resolve, feeds the summary. **No UI.** |
| 8 | Inpatient admission / ward (ADT) | 7 | 45 | Admit, ward list, ward vitals, discharge. **API only, no UI.** No transfer, no bed board. |
| 9 | eMAR / medication administration (Willow Inpatient) | 8 | 45 | Full state machine, five rights, barcode scan, weight-based refusal, AI blocked. **API only, no UI.** No MAR scheduling — nothing computes what is due. |
| 10 | Nursing documentation (Flowsheets) | 5 | 20 | Ward vitals only. No assessments, no I/O, no shift handover, no care plans. |
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

**Weighted total: 44%.**

## The three things that most move this number
1. **Ward UI** — domains 8, 9, 10, 11 are all capped at ~45-55 purely because a nurse cannot open
   a screen. That single deliverable is worth ~8 points of the total.
2. **MAR scheduling** — nothing computes what dose is due when. Without it the eMAR is a state
   machine nobody can drive.
3. **Results + critical-value loop** — the biggest pure-clinical gap after that.
