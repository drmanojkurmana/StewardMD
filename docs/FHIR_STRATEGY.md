# WardSynQ FHIR strategy

## What is served now: R4 (4.0.1), R4B (4.3.0) and R5 (5.0.0)

R4 is the default and the complete surface. R4B and R5 are chosen per request by the MIME parameter FHIR
defines for this (owner decision D9, 2026-09-14), never by URL:

- `Accept: application/fhir+json; fhirVersion=4.3` answers R4B; `fhirVersion=5.0` answers R5; no
  `fhirVersion` answers R4. Any other value is a 406 naming the versions served. A response in R4B or R5
  carries the same parameter in its Content-Type.
- `/metadata` answers the CapabilityStatement of the version asked for. Each one declares only what that
  version actually serves.

Every WardSynQ FHIR door:

- `/api/queue/ward/fhir/...` for a staff session, and `/api/fhir/{orgId}/...` for a SMART on FHIR bearer.
- Read, vread, history and search over the exported canonical types (fhir.js, fhir-search.js), `$everything`,
  `$validate`, Provenance derived from each version's audit stamp.
- Immunization (G6): its own append-only record type (immunization.js), read and searched by patient, status,
  vaccine-code and date. The vaccine is the recorder's own words; a code travels only with a known system.
- Bulk Data (fhir-bulk.js): `$export`, `Patient/$export` and `Group/{id}/$export`, by GET or POST (a Parameters
  body). Group (fhir-group.js) is defined narrowly because this record has no patient-group concept: one Group
  per ward with at least one open encounter, members those patients now, frozen on the export job at
  kick-off. Admin Center > Data export has a ward picker and a Download button per file; every download goes
  through the same authorised, audited `$export-file` route.
- Terminology (fhir-terminology.js): CodeSystem and ValueSet read and search, `ValueSet/$expand` and
  `$validate-code`. The hospital's own lists are complete; other systems are fragments with a warning. No
  SNOMED CT, LOINC or ICD release is shipped.
- `Patient/{id}/$summary` (fhir-ips.js): an IPS document. Problems, allergies, medications and immunizations
  are always present; an empty section says "none recorded", an unreadable one says `unavailable` or `withheld`.
- AuditEvent (fhir-audit.js): read-only, a `system/` token or staff.admin only.
- Consent: read and search.
- Subscription (R4 Subscriptions Backport, rest-hook, id-only): a projection of the hospital's FHIR-payload
  webhooks (webhooks.js). G10: created over FHIR with `POST Subscription` on the staff door (validated, then
  narrowed to exactly what is delivered, then registered through the same address checks, sealed secret and
  audit as the Integrations screen; the secret is returned once in a response header), and
  `Subscription/{id}/$status` on both doors. Changed and turned off on the Integrations screen.

## What each version covers

| | R4 (default) | R4B (`fhirVersion=4.3`) | R5 (`fhirVersion=5.0`) |
|---|---|---|---|
| Resources | all of the above | every type with an R4B validator table: the stored types, Provenance, Practitioner, Organization, Subscription (read) | Patient, Encounter, Observation, Condition, AllergyIntolerance, MedicationRequest, Immunization |
| Rendering | fhir.js mappers | the R4 resource (the R4-to-R4B diff changes nothing emitted) | fhir-version.js `TO_R5`, per type |
| Checked against | R4 tables | R4B tables (derived from R4 by the published diff) | R5 tables generated from the R5 StructureDefinitions (fhir-validate-r5.js) |
| `$validate` | yes | yes, `Content-Type ... fhirVersion=4.3` | yes, `Content-Type ... fhirVersion=5.0` |
| `$everything` | yes | yes | 406 unless every entry is an R5 type |
| Writes, bulk export, Subscription create and `$status` | yes | 406 / 415 | 406 / 415 |
| CodeSystem, ValueSet, AuditEvent, Group, IPS `$summary` | yes | 406 (no R4B definition held to check them) | 406 |

Every R4B or R5 answer is validated against that version's tables before it is sent. One that does not
validate is not sent: the answer is a 406 naming what could not be rendered. A type not rendered in the version
asked for is a 406 naming it, even when the answer would have been empty.

What R5 loses, and says so in its CapabilityStatement: Immunization.recorded has no R5 element and is not
carried. A Condition with no recorded clinical status is sent as `clinicalStatus` `unknown` (R5 makes the
element required and `unknown` is the only true value).

Inbound writes read R4 only: a body declared R4B or R5 is a 415 and nothing is read, because the inbound
normaliser (fhir-inbound.js) maps R4 and a body read as the wrong version is how a record fills with facts
nobody wrote.

## Adding a type to R5

1. Add the type's StructureDefinition to the generator input and regenerate
   (`node scripts/fhir-gen-validator-tables.mjs <sdDir> <cacheDir> > functions/_wardsynq/fhir-validate-r5.js`,
   adding the type to its RESOURCES list). Required bindings are expanded from the spec's own value sets;
   anything not enumerable is listed in the generated header, never guessed.
2. Add the type's transform to `TO_R5` in fhir-version.js, moving every element this server emits that the R5
   diff renamed, retyped or removed, and add it to `R5_TYPES`.
3. Add a fixture to test/wardsynq-fhir-version.test.mjs that renders valid R5 and whose R4 shape is refused.

The rules that do not change: the canonical model stays version-neutral; one rendering per version at the
boundary; never invent a code; validate before declaring.

## Not built

- R5 for the other exported types (ServiceRequest, DiagnosticReport, DocumentReference, MedicationAdministration,
  MedicationDispense, Specimen, CarePlan, ImagingStudy, Procedure, Appointment, RiskAssessment, Consent), and
  R5-native Subscription (SubscriptionTopic, SubscriptionStatus). Each is a 406 naming it today.
- R4B or R5 inbound writes, bulk export in R4B or R5, and webhook notifications in anything but the R4 backport.
- R4B definitions for CodeSystem, ValueSet, AuditEvent, Group and Composition.
- Subscription create on the SMART door (this server issues no write scopes).
- The R4 search Bundle still emits `entry: []` for no matches, which the R4 validator itself flags (ele-1). R4B
  and R5 renderings omit it; the R4 shape is unchanged because existing tests and clients read it.
