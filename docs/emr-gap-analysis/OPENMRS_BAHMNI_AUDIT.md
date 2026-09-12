# OpenMRS + Bahmni architecture audit

A deep source-level verification pass (cloning openmrs-core, the REST/FHIR2 modules, bahmnicore,
bahmni-config-example, and the IPD/lab/pharmacy modules) was launched as two parallel research agents
alongside this document. Their full findings will be appended/corrected into this file once they
land. What follows is the architecture-level picture that is well-established and documented about
both projects, used to frame the gap matrix and the reuse decision — treat specific claims about
"what's in core vs. a module" as subject to the pending source-verification pass, and specific file
paths as unconfirmed until then.

## OpenMRS

**What it is.** A 20+ year old, still-maintained (Java/Spring/Hibernate) open-source **electronic
medical record platform**, not a full HMS. Its core strength and reason it still exists in 2025 is
the **Concept Dictionary**: a genuinely rich, hierarchical, multi-vocabulary terminology model where
every observation, diagnosis, and order references a `Concept`, and a Concept can carry mappings to
LOINC, SNOMED CT, ICD-10, RxNorm, and others simultaneously. This is the single thing WardSynQ's own
`terminology.js` explicitly admits it does not have ("this build carries no LOINC release and
cannot validate a code").

**Domain model** (Patient/Person, Encounter/Obs, Visit, Order incl. DrugOrder/TestOrder, Provider,
Location, User/Role/Privilege, PatientIdentifier, PersonAttribute, Relationship) is mature, has been
battle-tested across thousands of low-resource-setting deployments, and is genuinely more complete
on the "master data" side than WardSynQ (Relationship, deceased-patient handling, and fuzzy patient
search are all real gaps WardSynQ has today — see the gap matrix).

**What OpenMRS core does NOT do**, by design: no billing, no bed/ward management, no nursing
workflow, no radiology/RIS, no pharmacy dispensing or inventory. It is a records-and-terminology
platform that other systems (Bahmni chief among them) build a hospital on top of.

**API surface**: a mature REST module and a FHIR2 module (FHIR R4). The REST API is resource-based
and reasonably complete for CRUD on the core domain, but was designed API-first for a UI that reads
concepts and encounters, not as a headless backend for an arbitrary modern frontend — expect real
integration friction (XML-heavy legacy config in places, a module system that assumes you're running
inside the same JVM, not calling in over HTTP from a serverless edge function).

**Licensing**: MPL 2.0 / Apache-2.0 depending on module — generally commercial-friendly, unlike
Bahmni's core pieces (see below).

**Maintenance**: still actively released, with a real community (OpenMRS is used in dozens of
countries' national health systems), but the stack itself (Java 8/11-era Spring, Hibernate, Maven
multi-module) is dated relative to a 2025 serverless/edge architecture like WardSynQ's.

## Bahmni

**What it is.** A hospital-management layer built ON TOP OF OpenMRS: `bahmnicore` (backend services)
+ an AngularJS 1.x frontend (registration, clinical, IPD, nursing apps) + `openmrs-atomfeed` (an
event-feed integration bus connecting modules).

**The clinical-config-as-JSON pattern.** Bahmni's most genuinely reusable IDEA (not necessarily its
code) is that clinical forms, tabs, and dashboard extensions are driven by JSON configuration
(`bahmni-config-example`) rather than hardcoded screens — a hospital can add a new clinical form
without a deploy. This is architecturally similar to what a good form-builder inside WardSynQ could
achieve, and is worth studying as a pattern even where the AngularJS implementation itself is not.

**IPD/bed management, nursing, lab**: real and mature — admission, ward/bed model, transfer,
discharge, discharge summary, nursing flowsheets/MAR, and a specimen→result lifecycle with a known
integration pattern for external LIS (historically OpenELIS). This is Bahmni's strongest area and the
one most directly comparable to WardSynQ's own IPD module — both are now genuinely built; the
difference is Bahmni's has years more production hardening across many real hospitals.

**Pharmacy**: Bahmni's pharmacy support (drug order + dispense) is real but has historically been
thinner on **inventory** (stock, batch, expiry, purchase) than a full HMS needs — closer to WardSynQ's
own honest gap ("nothing here purchases anything") than to a mature pharmacy-ERP. This is a case
where neither project has fully solved the problem; a real hospital in India typically bolts on a
separate pharmacy/inventory ERP regardless of which clinical platform it runs.

**Radiology**: Bahmni does not ship a real RIS (worklist beyond a generic order, DICOM/PACS
integration is typically via a separate viewer, similar in spirit to WardSynQ's own honest
metadata-only DICOMweb approach). Neither project solves this fully in-house; both correctly treat
image storage/viewing as a job for a dedicated PACS.

**Billing**: Bahmni has historically had **no first-party billing/insurance module** — hospitals using
Bahmni typically integrate a separate ERP/HIS for billing, or use community-contributed billing
modules of varying maturity. WardSynQ's own billing/claims/invoice engine (once its reachability
bugs are fixed, which this session did) is arguably **more built than Bahmni's own**, particularly
the upcoding-detection and governed-ledger discipline — this is a real point in WardSynQ's favor,
not a gap to fill from Bahmni.

**Licensing**: this is the sharpest practical issue. Several core Bahmni pieces are licensed **AGPL
v3**, which has real, non-trivial obligations for a commercial SaaS product (network-use copyleft —
if you modify AGPL code and offer it as a service, you generally must offer the modified source to
your users). This materially constrains option (B) "fork Bahmni and replace the frontend" and even
option (C) "run bahmnicore as a backend service" for a closed-source commercial product — see
`LICENSING_ANALYSIS.md`.

**Maintenance**: Bahmni is maintained but with a smaller, slower-moving community than OpenMRS core;
the frontend stack (AngularJS 1.x) has been end-of-life for years. Treat "years of production
hardening on the clinical workflow logic" as the real asset, not "modern software to build on."

## Bottom line going into the reuse decision

- The thing OpenMRS has that is genuinely hard to rebuild well and genuinely missing from WardSynQ is
  the **Concept Dictionary / terminology service**. That is the strongest, most specific candidate for
  "reuse their juice."
- The thing Bahmni has that's valuable is **years of validated hospital workflow logic** (IPD, lab,
  nursing) — but it comes wrapped in an AGPL, AngularJS-1.x-frontend package that is expensive to
  extract cleanly, and its most novel PATTERN (config-driven clinical forms) is worth copying the
  idea of, not the code.
- Neither project solves pharmacy inventory, RIS/PACS, or billing better than WardSynQ's own
  (post-fix) domain logic already does — reusing them there would be a downgrade, not an upgrade.
