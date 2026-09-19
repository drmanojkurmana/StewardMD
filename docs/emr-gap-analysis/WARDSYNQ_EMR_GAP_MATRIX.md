# WardSynQ EMR/HMS Gap Matrix — audited against source, 2026-09-12

Method: every claim below is checked against actual files in this repo (`functions/_wardsynq/*.js`,
`wardsynq/*.js`, `ward.js`, `wardsynq/site/shell.js`, `functions/api/queue/[[path]].js`), not against
what a screen merely looks like. A feature only counts as done if it works UI → API → DB → permission →
audit, matching this session's own standard (this session found and fixed 8+ cases this exact session
where the backend was fully built, correct, and tested, with literally no UI route to it at all —
see "The reachability problem" below, it is the single most important finding in this whole audit).

Legend: ✅ production-grade and reachable · 🟡 partial · 🔴 backend real, UI/reachability broken or
absent · ❌ missing · ⚠️ present but unsafe/insufficient

## The reachability problem (read this first)

`functions/_wardsynq/` holds ~130 domain modules, ~35,000 lines, backing genuinely sophisticated
clinical logic — an RCA engine that refuses "human error" as a root cause, a billing engine that
detects upcoding by comparing claim severity to chart evidence, a stock ledger that treats a negative
count as a finding rather than clamping it to zero, a DICOM worklist that explicitly refuses to touch
pixel data because this runtime has no object storage to leak it through. This is not shallow code.

But at least seven of those modules carry a comment, verbatim in the source, admitting the module was
finished and **nothing in the product ever called it**: `billing.js`, `incidents.js`,
`migrate-emar.js`, `news2-view.js`, `mpi-view.js`, `read-log.js`, `wardsynq-safety-case.js`. This
session alone found and fixed the incident-reporting one — a full report → triage → RCA → CAPA →
close safety system with zero UI anywhere, including for the safety_officer role whose entire job it
is. The others were wired up by earlier work in this same session (verified: `billing.js`'s
`codeClaimForEncounter`/`claimAction` are now called from the router).

**This is WardSynQ's real disease, and it explains the "10%" feeling exactly**: individual domain
modules are frequently more rigorous than a fresh build would produce, but the discipline that gets a
finished module an actual route, an actual tile, and an actual test that opens the screen and clicks
the button has been inconsistent. A raw line-count or module-count audit would call WardSynQ 60-70%
of an EMR. An audit that requires "can a signed-in nurse actually reach this and have it work" is
correctly closer to the owner's own estimate — this document tries to give the honest number, domain
by domain, and to flag every remaining case of this exact pattern found in this pass.

---

## PATIENT / MASTER DATA

| Feature | Status | Evidence |
|---|---|---|
| Registration | ✅ | `migrate-registration.js`, `opd-identity.js`; reachable via OPD desk and ward Patients tile |
| Demographics | ✅ | part of Patient resource, native FHIR-shaped model (`wardsynq-model.js`) |
| Identifiers (MRN etc.) | ✅ | `opd-identity.js` (`patientIdForMrn`), identifier scheme is real, not a raw counter |
| Duplicate detection | 🟡 | `mpi-view.js` + `identity-key.js` exist (MPI = master patient index); `mpi-view.js` was one of the "nothing called it" modules — confirm it is wired before trusting it in production |
| Patient merge | ✅ | `identity-merge.js`, 260 lines, has its own identifier-release-on-correction logic (a corrected wrong ABHA/MRN doesn't permanently block the real owner) — more careful than most homegrown builds |
| Relationships (next of kin etc.) | ❌ | no `Relationship`-equivalent resource or UI found in this pass; OpenMRS's `Relationship` model has no WardSynQ counterpart |
| Patient search | 🟡 | MRN-based lookup exists everywhere (ward admit flow, OPD, billing); no evidence of fuzzy/phonetic name search, which OpenMRS/Bahmni both have via their patient-search index |
| Patient history / timeline | ✅ | ward.js `timelineView` — this is a genuine strength, built and re-verified working this session, includes a "records with no timestamp" honesty flag most homegrown timelines lack |
| Allergies | ✅ | AllergyIntolerance-shaped resource, wired into the downtime pack, order-safety workstation, and chart print |
| Alerts (clinical) | 🟡 | critical-results.js, deterioration/NEWS2 exist; a general "clinical alert" subsystem (like OpenMRS's alert framework) was not found as a distinct concept |
| Deceased patients | ❌ | no deceased/cause-of-death field or disposition workflow found distinct from discharge |
| Consent | ✅ | `consent.js`, 300 lines — genuinely built (what a patient agreed to/refused), reachable from the chart's Consent tab, tested this session |
| Documents (scanned uploads, ID proof, etc.) | ❌ | no document/attachment storage subsystem found; this build has no object storage at all (confirmed by `dicom.js`'s own header explaining why), so a document-upload feature is architecturally blocked until that's solved |

## CLINICAL EMR

| Feature | Status | Evidence |
|---|---|---|
| Encounters | ✅ | `migrate-encounter.js`, FHIR-shaped, real state machine |
| Clinical notes | ✅ (fixed this session) | `note-templates.js` — was completely unusable out of the box (no template existed, so /ward/note 404'd on every attempt) until fixed this session; now has a real composer, admin-configurable extra writer roles (also found broken and fixed this session — see BUGS.md), incomplete-section honesty |
| Problem list | ✅ | ICD/free-text problems, verification status (provisional/differential/confirmed/refuted), resolve-as-new-version not delete |
| Diagnoses / coding | 🟡 | problem list supports an optional ICD code; no dedicated diagnosis-coding workflow beyond that |
| Symptoms | ❌ | no distinct symptom-capture model; folded into free-text notes/problems only |
| Vitals | ✅ | `migrate-vitals.js`, NEWS2 scoring (`news2-view.js`, fixed reachability this session) |
| Observations (general) | ✅ | Observation resource is the backbone of vitals, labs, fluid balance, device readings — well-modeled with category-scoped write grants (a nurse can chart a vital but not a lab value, enforced at the record layer, not just the UI) |
| Clinical forms/templates | 🟡 | note templates exist; no generic dynamic-form-builder equivalent to Bahmni's config-driven forms (see REUSE_VS_REBUILD.md) |
| Care plans | ✅ | `care-plan.js`, 294 lines |
| Procedures | 🟡 | surgery/theatre module exists (`migrate-surgery.js`, 462 lines, WHO checklist referenced in UI) but a general non-surgical procedure-note type was not confirmed |
| Longitudinal timeline | ✅ | strong — see Patient history above |
| Terminology (ICD/SNOMED/LOINC) | 🔴 | **Confirmed gap, in the code's own words**: `terminology.js` states outright "this build carries no LOINC release and cannot [validate a code]". It recognizes vocabulary *systems* (URIs for LOINC/SNOMED/ICD-10/ICD-11) but has no actual code tables, hierarchy, or search — every code is whatever a hospital manually seeds. This is the single clearest gap versus OpenMRS, whose Concept Dictionary is a first-class, richly modeled terminology service. |

## OPD

| Feature | Status | Evidence |
|---|---|---|
| Appointments | ✅ | `scheduling.js` (396 lines), resource booking, blackout periods |
| Queue | ✅ | this is one of WardSynQ's oldest, most-used subsystems (OPD desk, `opd.html`) |
| Triage | 🟡 | ED triage exists (`migrate-ed.js`); general OPD triage folded into queue status, not a distinct clinical triage form |
| Consultation | ✅ | full chart access from OPD |
| Prescriptions | ✅ | order-safety workstation (fixed a real crash bug this session — see BUGS.md), prescription-transmit.js |
| Investigations (lab/imaging orders) | ✅ | reachable, tested this session (Laboratory and Radiology boards, both built new this session on top of pre-existing backend) |
| Follow-up | 🟡 | scheduling exists; no explicit "follow-up visit" linkage type distinct from a normal appointment |
| Referrals | ❌ | no referral resource/workflow found |

## IPD

| Feature | Status | Evidence |
|---|---|---|
| Admission | ✅ | tested this session (reception role, admit-by-MRN flow) |
| Bed management | ✅ | real occupancy, ward layout, self-healing bed-claim reconciler (`migrate-inpatient.js`) — unusually careful, tracks stale claims by the simple fact that a moved patient's Encounter location changed under it |
| Ward management | ✅ | 16-ward demo layout, real |
| Transfers | ✅ | reachable from the chart |
| Discharge | ✅ | tested |
| Discharge summary | ✅ | `migrate-discharge.js` |
| Nursing workflows | 🟡 | see NURSING below |
| Care plans | ✅ | shared with clinical EMR |
| Rounds / progress notes | ✅ | note composer + templates |
| Fluid balance / intake-output | ✅ | `fluid-balance.js`, tested this session (resident chart) |
| Escalation | ✅ | NEWS2/deterioration scoring, critical-results closed loop |
| Death / disposition | 🔴 | discharge exists; a distinct death/mortuary disposition pathway was not confirmed present |

## ORDERS / CPOE

| Feature | Status | Evidence |
|---|---|---|
| Medication orders | ✅ | tested live this session, real safety-engine checks (310 interaction rules loaded, allergy/weight/kidney-function aware) |
| Lab orders | ✅ | specimen.js lifecycle (collection → transit → result), tested |
| Radiology orders | ✅ | tested this session, real worklist |
| Procedure orders | 🟡 | surgical case scheduling exists; general non-surgical procedure order type unconfirmed |
| Order sets | ✅ | `order-sets.js`, 294 lines |
| Order lifecycle (cancel/modify) | 🟡 | present for medication (verify/dispense states); not independently confirmed for every order type |
| Results linking | ✅ | lab/imaging results link back to the originating order by ID, tested |

## MEDICATION / PHARMACY

| Feature | Status | Evidence |
|---|---|---|
| Formulary | ✅ | `formulary.js` |
| Medication catalog | 🟡 | drug-lookup.js exists; unclear if it's a real national drug database or a small seed list |
| Prescribing | ✅ | tested live, real safety checks |
| Dispense | ✅ | `pharmacy-dispense.js` |
| Administration (eMAR) | ✅ (fixed this session) | `migrate-emar.js` was one of the "nothing called it" modules — confirmed wired now |
| Medication reconciliation | ✅ | `med-reconciliation.js` — genuinely present, most homegrown EMRs skip this entirely |
| Drug interactions | ✅ | tested live this session (had a severe crash bug — `smdLazy is not defined` — that made the whole screen unusable from the first keystroke; fixed and verified this session) |
| Allergies | ✅ | integrated into the safety check |
| Dosage rules | ✅ | part of the safety engine |
| **Inventory / stock** | 🔴 confirmed gap, in the code's own words | `stock.js` (372 lines) is a real, careful append-only movement ledger — but its own header states plainly: **"A REORDER LEVEL PRODUCES A LIST, NEVER AN ORDER. Nothing here purchases anything."** and **"UNITS ARE NOT CONVERTED"** (no product catalogue, no box-to-tablet conversion). There is no purchase-order, vendor, or goods-receipt workflow anywhere in this codebase. |
| Batch / expiry | 🟡 | the dispense path blocks on an expired box (a physical fact, per the file's own reasoning); batch-level stock tracking beyond that was not confirmed |
| Purchase / procurement | ❌ | confirmed absent (see stock.js quote above) |
| Returns | ❌ | not found |

## LABORATORY

| Feature | Status | Evidence |
|---|---|---|
| Test catalog | 🟡 | order codes exist; no evidence of a rich, LOINC-backed test catalog (same terminology gap as above) |
| Specimen collection | ✅ | `specimen.js`, tested (Laboratory board built this session, hospital-wide) |
| Accessioning | 🟡 | specimen lifecycle exists; formal accession-number workflow not independently confirmed |
| Workflow (collect→transit→result) | ✅ | tested live, correct states |
| Analyzer integration | ❌ | no bidirectional analyzer (ASTM/POCT1-A) integration found; HL7 inbound exists for external LIS results (`hl7-inbound.js`), which is a real and useful substitute for many hospitals |
| Result entry | ✅ | tested (lab role) |
| Validation / abnormal flags | ✅ | critical-results.js closed-loop notification, tested |
| Reference ranges | 🟡 | present at a basic level; depth (age/sex-specific ranges) not independently confirmed |
| Result approval | ✅ | release-result capability, distinct from entry |
| Corrected results | 🟡 | `lab-delta.js` exists (suggests amendment tracking); depth not independently confirmed |
| Microbiology / pathology | ❌ | no specialised culture/sensitivity or pathology-specific workflow found (generic result entry only) |
| Reports | 🟡 | Reports screen (fixed a display bug this session), depth of lab-specific reporting not confirmed |

## RADIOLOGY

| Feature | Status | Evidence |
|---|---|---|
| Orders | ✅ | tested |
| Scheduling | 🟡 | shares the general scheduling module; no radiology-modality-specific scheduling confirmed |
| Modality/technician workflow | ✅ (built this session) | Radiology board — acquisition-agnostic by design (a study stays on the worklist from order to report "whether or not it has been scanned yet" — an honest simplification, not a gap dressed up) |
| Radiologist reporting | ✅ | tested live this session end to end, including the correction-required guard on re-reporting |
| Report approval/amendment | ✅ | discrepancy-flagging on a changed impression, tested |
| **DICOM / PACS** | 🔴 confirmed, deliberate gap | `dicom.js` implements DICOMweb QIDO-RS *metadata* inbound and a worklist *outbound* — explicitly and deliberately **does not** implement WADO-RS (pixel retrieval) or STOW-RS (image storage), because this runtime (Cloudflare Pages Functions) has no object storage. This is architecturally correct given the constraint, but it means **WardSynQ cannot host or serve a single image** — a real PACS/viewer must sit beside it. |
| RIS depth | 🟡 | acquisition-agnostic worklist is a real, honest RIS-lite; no modality worklist over true DICOM MWL (C-FIND, a TCP protocol) — again explicitly and correctly out of scope for this runtime |

## NURSING

| Feature | Status | Evidence |
|---|---|---|
| Assessment | ✅ | risk-assessment.js, part of chart |
| Notes | ✅ | shared note composer (admin can now grant nurses note-writing — built earlier this session, found BROKEN by the config not actually working, fixed this session) |
| Medication administration (eMAR) | ✅ (fixed this session) | see Pharmacy above |
| Vitals | ✅ | see Clinical EMR above |
| Care plans | ✅ | shared |
| **Handover** | ✅ | `handover.js` exists as a distinct module — a real strength, most homegrown builds skip shift handover entirely |
| Task management | ❌ | no distinct nursing task/to-do list module found |
| Flowsheets | ✅ | `flowsheet-view.js`, tested |
| Escalation | ✅ | shared with IPD |

## EMERGENCY

| Feature | Status | Evidence |
|---|---|---|
| Registration | ✅ | shares OPD/ward registration |
| Triage | ✅ | `migrate-ed.js` |
| Assessment | ✅ | ED chart |
| Orders | ✅ | shared |
| Treatment | ✅ | shared with IPD |
| Observation (ED holding) | ✅ | ED board tested |
| Resuscitation | ✅ | `migrate-resus.js` — a distinct, dedicated module; genuine strength |
| Disposition | ✅ | admit/discharge from ED, tested (bed board disposition flow) |

## BILLING / FINANCE

| Feature | Status | Evidence |
|---|---|---|
| Charge capture | ✅ | `charge-capture.js`, derives charges from real chart events only, never a typed-in amount |
| Invoices | ✅ (fixed this session, was "nothing called it") | `invoice.js` — full ledger: discount/deposit/payment/refund/adjustment/write-off, each a governed event, reconciliation, receipts |
| Payments | 🔴 | `wardsynq-payment-adapter.js` exists but defaults to a `NullAdapter` — **no real payment gateway (Razorpay/UPI/PayU/card) is wired anywhere**; a payment is recorded as a fact, never actually collected through this system |
| Insurance / claims | ✅ | genuinely sophisticated — `billing.js`'s upcoding detector (compares claim severity to chart evidence, refuses claims coded from a refuted/differential diagnosis) is more rigorous than most homegrown systems |
| Packages | ❌ | no package/bundle-pricing concept found |
| Discounts | ✅ | one of invoice.js's governed event types |
| Refunds | ✅ | governed event type, cannot exceed amount paid (engine-enforced) |
| Claims (payer submission) | 🔴 | claim lifecycle (submit/deny/resubmit/adjudicate) is real; actual payer transport defaults to `NullAdapter` too — **no live TPA/insurer integration exists**, by explicit design ("no real adapter is configured anywhere in this codebase") |
| Payer rules | 🟡 | pre-authorisation state machine exists; payer-specific rule engines not found |

## ADMINISTRATION

| Feature | Status | Evidence |
|---|---|---|
| Users | ✅ | full staff lifecycle (add/PIN/password/disable/restore/reset), tested this session |
| Roles | ✅ | 22 roles as of this session (added radiographer/radiologist), each with a documented capability rationale in `_queue_roles.js` — genuinely more disciplined than most systems' RBAC |
| Permissions | ✅ | two-layer model: route capability check + a SEPARATE, more granular record-level grant (`actor.js`) that many roles cannot widen even if the route lets them through — this is a real architectural strength, verified multiple times this session catching bugs where one layer said yes and the other correctly said no |
| Departments | ✅ | Admin Center tab |
| Locations (wards/beds/rooms) | ✅ | full CRUD, tested |
| Providers | ✅ | staff = provider in this model |
| Schedules (staff rostering) | ❌ | no shift/roster module found — scheduling.js is for patient appointments/resources, not staff shifts |
| Configuration | ✅ | org-level config (`_opd_org_store.js`) covers formulary, MAR times, critical limits, note-writer roles, and more |
| Terminology | 🔴 | see Terminology gap above |
| Audit | ✅ | Audit and security screen, fixed a real layout bug this session (a long id broke the whole table), record-change log is real |
| Security | 🟡 | strong RBAC and audit; no evidence of session-timeout policy, password complexity enforcement, or 2FA in this pass |

## REPORTING / ANALYTICS

| Feature | Status | Evidence |
|---|---|---|
| Operational reports | ✅ | Hospital command center — rich, tested, real numbers |
| Clinical reports | 🟡 | Reports screen exists (fixed a rendering bug this session); depth of clinical-outcome reporting not confirmed |
| Financial reports | 🟡 | billing/claims report exists; depth not confirmed |
| Dashboards | ✅ | Digital Twin module (`digital-twin.js`, 381 lines) — an unusual, genuinely differentiated feature: fused hospital state with freshness/prediction/simulation |
| Exports | 🟡 | analytics-extract.js exists; format/scope not confirmed |
| Audit reports | ✅ | see Administration |

## INTEROPERABILITY

| Feature | Status | Evidence |
|---|---|---|
| FHIR | ✅ strong | 7 dedicated files (`fhir.js`, `fhir-inbound.js`, `fhir-outbound.js`, `fhir-search.js`, `fhir-validate.js`, `fhir-id.js`, `fhir-identity.js`) plus SMART on FHIR launch (`smart-server.js`) — this is genuinely more FHIR-native than either OpenMRS core (FHIR is a bolt-on module) or Bahmni |
| HL7 v2 | ✅ | `hl7-inbound.js`, `hl7v2.js`, `hl7-normalize.js` — explicitly states MLLP (the TCP transport real HL7 v2 devices use) is out of scope for this runtime and requires a broker in front; the parsing/normalization logic itself is real |
| Terminology services | 🔴 | see gap above |
| External labs | ✅ | HL7 inbound is the real integration path |
| PACS | 🔴 | metadata only, see DICOM gap above |
| National integrations (India) | ✅ notable strength | `abdm-land.js` — ABDM (India's Ayushman Bharat Digital Mission) landing/HIU integration exists; this is something **neither OpenMRS nor Bahmni has out of the box** and is a genuine India-market differentiator |
