# Reuse vs. rebuild — feature by feature

Format: Feature → OpenMRS → Bahmni → WardSynQ status → recommendation → why.

## Terminology / concept dictionary (ICD/SNOMED/LOINC)
- OpenMRS: mature, first-class Concept Dictionary with multi-vocabulary mapping.
- Bahmni: uses OpenMRS's concept dictionary as-is.
- WardSynQ: recognizes vocabulary URIs, has no actual code tables. Confirmed gap.
- **Recommendation: REUSE (integrate, not fork).** Stand up OpenMRS's concept dictionary + REST API
  as a dedicated terminology microservice WardSynQ calls over HTTP/FHIR `$lookup`/`$validate-code`,
  or adopt a standalone terminology server (e.g. a hosted SNOMED/LOINC/ICD-10 FHIR terminology
  service) rather than the whole OpenMRS platform. Do not import OpenMRS's domain model wholesale —
  WardSynQ's own FHIR-native Patient/Encounter/Observation model is already better suited to its
  architecture than OpenMRS's Hibernate entities would be.
- Complexity: medium. Risk: low (read-mostly integration, doesn't touch WardSynQ's own record
  authority).

## Patient master data (relationships, deceased, fuzzy search, document storage)
- OpenMRS: has Relationship, PersonAttribute-based deceased tracking, decent search.
- Bahmni: inherits OpenMRS's.
- WardSynQ: missing all four.
- **Recommendation: REBUILD NATIVE**, not reuse. These are small, well-understood data-model
  additions (a Relationship resource, a deceased flag + cause on Patient, a search index) that fit
  naturally into WardSynQ's existing FHIR-shaped model and RBAC/audit discipline. Pulling in
  OpenMRS's Person/Relationship Java entities would mean adopting an entirely different data layer
  for four fields. Document storage is blocked on WardSynQ having no object storage at all — that's
  an infrastructure decision (R2/S3-compatible bucket), independent of OpenMRS/Bahmni.
- Complexity: low-medium. Risk: low.

## IPD / bed management / nursing workflow
- OpenMRS: none in core.
- Bahmni: mature, years of production hardening.
- WardSynQ: already built and, per this session's live testing, working (admission, bed board,
  transfer, discharge, discharge summary, fluid balance, flowsheets, handover).
- **Recommendation: KEEP WARDSYNQ'S OWN.** This is the clearest "do not reuse" case in the whole
  audit. WardSynQ's version is FHIR-native, has the two-layer permission model integrated, and (once
  this session's fixes land) is functionally comparable to Bahmni's for the core workflow. Rebuilding
  it on Bahmni's IPD module would mean adopting Bahmni's AngularJS frontend or reimplementing its
  bahmnicore APIs against WardSynQ's data model anyway — net negative.

## Lab workflow
- OpenMRS: none in core.
- Bahmni: real specimen→result lifecycle, historically integrates with OpenELIS for a real LIS.
- WardSynQ: real specimen lifecycle, HL7-inbound for external LIS results — architecturally the same
  shape as Bahmni's approach (accept that a real LIS/analyzer is a separate system, integrate via a
  message interface) but built independently.
- **Recommendation: KEEP WARDSYNQ'S OWN**, but study the specific HL7/ASTM message profiles Bahmni's
  OpenELIS integration uses as a reference for exact field mapping — that's a spec worth borrowing,
  not code.

## Pharmacy inventory (stock, batch, purchase, vendor)
- OpenMRS: none in core.
- Bahmni: thin, not a mature answer either.
- WardSynQ: explicitly, honestly thin (own admission: "nothing here purchases anything").
- **Recommendation: REBUILD NATIVE, scoped down.** Neither open-source project has solved this well;
  don't go looking for a component to reuse that doesn't exist in a form worth taking. Build a
  minimal purchase-order/goods-receipt/vendor model as a P1 item (see roadmap), sized to what an
  Indian hospital pharmacy actually needs, not a full ERP.

## Radiology / RIS / PACS
- OpenMRS: none.
- Bahmni: no real RIS either; relies on an external PACS/viewer.
- WardSynQ: explicitly, deliberately metadata-only (DICOMweb QIDO-RS in, worklist out; WADO-RS/STOW-RS
  and DIMSE MWL explicitly out of scope given the serverless runtime).
- **Recommendation: KEEP WARDSYNQ'S APPROACH.** All three projects correctly treat "store and view
  pixel data" as a job for a real PACS, not the EMR. There is nothing to reuse here because nobody
  in this space has solved it inside the EMR itself — that's the right call, not a gap to chase.

## Billing / insurance / claims
- OpenMRS: none.
- Bahmni: no first-party module; hospitals bolt on separate ERPs.
- WardSynQ: a genuinely more sophisticated engine than either (upcoding detection, governed invoice
  ledger with discount/refund/write-off as first-class audited events) — the reachability bugs found
  and fixed this session were the only thing making it look incomplete.
- **Recommendation: KEEP WARDSYNQ'S OWN**, and treat "no live payment gateway wired" (confirmed:
  `NullAdapter` default) as the actual remaining gap — that's an integration task (Razorpay/PayU/UPI),
  not a reuse-from-OpenMRS-or-Bahmni task, since neither has one either.

## The composite clinical write (verified: `BahmniEncounterTransaction`)
- OpenMRS: no equivalent — a plain Encounter/Obs CRUD API.
- Bahmni: `bahmni-emr-api/…/encountertransaction/contract/BahmniEncounterTransaction.java` — every
  clinical write in a consultation (obs, diagnoses, drug orders, disposition) is ONE composite POST,
  fanned out through pluggable command handlers. Confirmed via source read, MPL-licensed
  (`bahmni-emr-api` ships under `bahmni-core`'s MPL/AGPL split — verify the specific file, but the
  PATTERN itself is what's being recommended, not the code).
- WardSynQ: ward.js's chart currently issues several independent API calls per screen action
  (problems, criticals, timeline load separately; medication order, investigation order, vitals each
  their own POST) — this session found and partially fixed the resulting "shared error slot" race
  this pattern produces (see BUGS.md's cashier/blood-bank findings).
- **Recommendation: REBUILD NATIVE, copying the PATTERN.** A single composite "save this
  consultation" endpoint, still built from WardSynQ's own FHIR-shaped resources and going through
  the same two-layer permission grant, would remove an entire class of bug this session kept finding
  by hand. This is the single most concrete, actionable idea worth taking from Bahmni.
- Complexity: medium (a real API/UI change, not additive). Risk: medium — touches a lot of existing
  call sites in ward.js.

## Clinical form building
- OpenMRS: form module (older, XML-based).
- Bahmni: config-driven JSON forms — a genuinely good pattern, actively used across many real
  deployments.
- WardSynQ: fixed-shape note templates only; no dynamic form builder.
- **Recommendation: REBUILD, but copy the PATTERN not the code.** Bahmni's JSON-config-driven form
  concept (a hospital admin defines a form's fields/sections without a deploy) is worth reproducing
  natively in WardSynQ's own template engine (`note-templates.js` already has the right philosophy —
  "a template provides headings, never content" — extending it to admin-configurable field TYPES,
  not just headings, is a natural, native extension).

## Interoperability (FHIR/HL7/ABDM)
- OpenMRS: FHIR2 module (bolt-on), decent but not the platform's design center.
- Bahmni: inherits OpenMRS's FHIR support.
- WardSynQ: FHIR-native from the ground up (7 dedicated files, SMART-on-FHIR launch), plus ABDM
  (India-specific) which neither open-source project has.
- **Recommendation: KEEP AND INVEST FURTHER IN WARDSYNQ'S OWN.** This is WardSynQ's clearest
  competitive advantage over both projects and should not be touched.

## Staff scheduling / shift rostering
- OpenMRS: none.
- Bahmni: none found.
- WardSynQ: none found (patient/resource scheduling exists, staff rostering doesn't).
- **Recommendation: REBUILD NATIVE, P2.** Nobody in this comparison set has solved it; not a reuse
  candidate from either source project.
