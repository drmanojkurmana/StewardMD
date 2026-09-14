# WardSynQ FHIR strategy

## What is served now: R4 (4.0.1)

Every WardSynQ FHIR door speaks R4 4.0.1 and only R4:

- `/api/queue/ward/fhir/...` for a staff session, and `/api/fhir/{orgId}/...` for a SMART on FHIR bearer.
- Read, vread, history and search over the exported canonical types (fhir.js, fhir-search.js), `$everything`,
  `$validate`, Provenance derived from each version's audit stamp, and Bulk Data `$export` (fhir-bulk.js).
- Terminology (fhir-terminology.js): CodeSystem and ValueSet read and search, `ValueSet/$expand` (filter,
  count, offset) and `$validate-code` on both. The hospital's own lists (order-set investigations, formulary,
  allergy classes) are complete. LOINC, HL7 code systems and anything the hospital loaded are served as
  fragments under their owners' URIs, and every expansion of a fragment carries a warning. No SNOMED CT,
  LOINC or ICD release is shipped, and the server never answers as an authoritative source for one.
- `Patient/{id}/$summary` (fhir-ips.js): an International Patient Summary document. Authorised exactly like a
  compartment read. An empty section says "none recorded" as text; a section whose source could not be read
  says `unavailable` (or `withheld`) and lists nothing. No IPS profile is claimed, because none is validated.
- AuditEvent (fhir-audit.js): the hospital's audit trail, read-only, the envelope the audit screen shows and
  nothing more. A `system/` token or staff.admin only; never a `patient/` or `user/` scope.
- Consent: read and search, mapped from PatientConsent.
- Subscription (R4 Subscriptions Backport, rest-hook, id-only payload): a projection of the hospital's
  webhooks (webhooks.js) that were registered with the FHIR payload format. Created and managed by the
  administrator on the Integrations screen, not over FHIR. Delivery is the webhooks outbox, not a second system.

The CapabilityStatement at `metadata` is generated from the same tables the code reads, and declares all of
the above, including what is not supported.

## Why not R4B or R5 yet

1. **Partners are on R4.** The national profiles a hospital in India exchanges under (the NRCES FHIR
   implementation guide that ABDM uses) are R4, as are most vendor integrations this product has met. A
   server that answered R5 would be answering a question few partners ask yet, while every real integration
   still needs R4.
2. **Two versions on one door is a conformance claim we cannot keep.** R4B and R5 are not supersets of R4:
   elements were renamed and moved (for example `MedicationRequest.medication[x]` becomes a CodeableReference,
   `Encounter.class` becomes a list, AuditEvent and Consent were restructured, Subscription was redesigned
   around SubscriptionTopic). Serving them honestly means a separate mapper per version and a validator per
   version, and each mapper is a place where "never invent a code" can quietly break.
3. **The backport already gives R4 clients the R5 idea.** Topic-based subscriptions are the main R5 feature
   integrators ask for, and the R4 Subscriptions Backport IG delivers it to R4 clients now.
4. **Validation first.** `$validate` checks R4 base structure only. Serving a second version before the first
   one is validated against the profiles partners use would widen the surface faster than it can be trusted.

## The path to R4B and R5

1. **Keep the canonical model version-neutral.** The canonical records are FHIR-shaped but not FHIR; every
   version is a rendering at the boundary (fhir.js `MAPPERS`). This is already true and must stay true.
2. **Version negotiation by media type.** Accept `application/fhir+json; fhirVersion=4.0` (default) and later
   `fhirVersion=4.3` / `5.0`, answering 406 for a version not served. No version-specific URL paths.
3. **One mapper table per version**, sharing the pure helpers (`codeable`, identifiers, Provenance), each with
   its own golden tests and its own CapabilityStatement generated from its own tables.
4. **R4B first** (small delta, mostly additive), then R5, starting with the types partners actually request.
5. **Terminology and Subscription move to native R5 forms** (SubscriptionTopic, SubscriptionStatus) on the R5
   door only; the R4 door keeps the backport.
6. **Validate before declaring.** A version is added to the CapabilityStatement only when its resources pass
   that version's base validation in CI.
