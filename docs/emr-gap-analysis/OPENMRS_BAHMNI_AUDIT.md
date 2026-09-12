# OpenMRS + Bahmni architecture audit

A deep source-level verification pass (cloning openmrs-core, the REST/FHIR2 modules, bahmnicore,
bahmni-config-example, and the IPD/lab/pharmacy modules) was launched as two parallel research agents
alongside this document. **The Bahmni section below is now fully corrected against verified source**
(87 tool calls, 160 repos enumerated via the GitHub API, 14 repos cloned and read) — every claim
carries a file path. The OpenMRS section still reflects architecture-level knowledge pending that
agent's own completion; it will be corrected the same way when it lands.

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

## Bahmni — verified against source (full report: 87 tool calls, 14 repos cloned)

**Repo reality.** The Bahmni GitHub org has **160 repos**, not a tidy handful: `bahmni-core` (backend,
renamed from `openmrs-module-bahmnicore`), `openmrs-module-bedmanagement`, `openmrs-module-ipd`
(2023+, newest nursing/task engine), `openmrs-module-medicationadministration` (FHIR R4 MAR),
`openmrs-module-appointments`, plus THREE separate frontend generations shipping at once — the
classic AngularJS 1.4.9 monolith (`bahmniapps`), React 16 module-federation micro-frontends embedded
inside it, and a from-scratch React 19 + Carbon rewrite (`bahmni-apps-frontend`, 100+ commits/25
authors since mid-2025 — clearly where current investment is going). Lab, billing, and imaging are
NOT Bahmni modules at all — they're separate systems (OpenELIS, Odoo, dcm4chee) bridged in.

**Central idea worth adopting outright**: `BahmniEncounterTransaction`
(`bahmni-emr-api/…/encountertransaction/contract/`). Every clinical write in a consultation — obs,
diagnoses, drug orders, disposition — is ONE composite POST, fanned out through pluggable
command handlers. This is a genuinely better pattern than a screen making six separate API calls per
visit, and it's worth copying the shape of into WardSynQ's own note/order composer, independent of
everything else in this audit.

**The config-as-JSON pattern, confirmed real but with real cracks.** `app.json` (extension points +
free config) + `extension.json` (privilege-gated tab/link registry) + `dashboard.json` (672 lines,
display-control registry) genuinely let an implementer add a consultation tab or dashboard widget
with zero deploy. But: **no JSON Schema anywhere** — a typo in `"type"` silently renders nothing, and
`dashboard.json` hardcodes disease-specific controls (`"type":"tuberculosis"`) directly in config,
so the pattern is only as extensible as a fixed, code-defined vocabulary of controls. And the config
repo implementers actually deploy (`default-config`) has had 5 commits since mid-2025 versus 53 for
the backend — it is not where current effort goes.

**IPD/bed management**: mature and complete on the bed side (~40 classes in `bedmanagement`, full
occupancy guards, layout grid, a decade of field use) — genuinely more built than WardSynQ's own on
raw feature count. But **admission/transfer/discharge is NOT a state machine** — it's a typed
OpenMRS Encounter plus a Visit Attribute (`"Admission Status"`), and transfer specifically has **no
entity at all**, just two bed-assignment rows. Discharge is one 33-line controller. A verified code
quality tell: a public enum ships the literal typo `DISHCARGE ("DISCHARGE")`. **WardSynQ's own IPD
module, once this session's reachability fixes are counted, is comparably real and is a genuine
state machine — this is one of the few areas where WardSynQ's design is arguably ahead**, not behind.

**Nursing**: better than reputation suggests, and confirmed real — a genuine FHIR R4
`MedicationAdministration` model plus a full nursing-task/drug-schedule engine (`Schedule`/`Slot`,
scheduled/PRN/stat all modelled, shift-rollover scheduled jobs, acknowledge/amend workflow). Its own
README calls it "temporary," pending a merge into openmrs-core/fhir2 — an API-stability warning
worth taking seriously if depended on. **Handover is confirmed absent** — zero hits for
handover/hand-over/SBAR across the whole nursing codebase. Vitals are generic obs with no dedicated
early-warning-score entity.

**Lab: confirmed to be an ordering/viewing CLIENT, not a LIS.** Specimen lifecycle, accessioning,
reference ranges, and abnormal flagging all live in the **external OpenELIS** system; Bahmni's own
code (`openmrs-elis-atomfeed-client-omod`) receives validated results over the atomfeed and stores
them as Obs — including a runtime-loaded Groovy class for site-specific result mapping, a real
operational-complexity cost. WardSynQ's own specimen.js lifecycle is arguably closer to "a real LIS
workflow" than Bahmni's own module is; Bahmni's actual answer for the hard LIS part is "someone
else's system."

**Pharmacy: confirmed, precisely, to be prescribing only — dispensing and inventory both live in
Odoo, not in any OpenMRS module.** A repo-wide search for "dispens" across bahmni-core turns up
nothing but a unit-of-measure field; `InventoryStockService` is a single method that calls Odoo over
HTTP and only ever *reads* stock — batch and expiry are owned and written by
`bahmni_stock/models/stock_production_lot.py` in a completely separate PHP-free Odoo v16 install.
This is the single most concrete confirmation in this whole audit that **neither Bahmni nor
WardSynQ has solved pharmacy inventory**, and Bahmni's answer is explicitly "buy an ERP," not
"we solved it and you should take our module."

**Radiology: confirmed, no RIS exists anywhere in the org.** Imaging is a generic order plus one
frontend directive (`pacsOrders.js`) that builds a hyperlink to an external Oviyam2/PACS viewer by
matching a DICOM accession number. A separate standalone app, `pacs-integration`, bridges OpenMRS's
own atomfeed to HL7 ORM messages that a real modality worklist (dcm4chee) understands — a real,
useful pattern, but it confirms there is no radiographer worklist, no structured radiologist
reporting, no sign-off/addendum inside Bahmni itself. WardSynQ's own honest, deliberately
metadata-only DICOMweb approach (see gap matrix) is arguably a cleaner design for the same
underlying constraint (no image storage) than Bahmni's HL7-bridge-to-a-separate-app pattern.

**Billing: confirmed, unambiguously, zero billing code in any OpenMRS module.** Every clinical order
becomes an Odoo `sale.order` line via a literal integration contract
(`bahmni_api_feed/models/api_event_worker.py`) that raises an error for any event category it
doesn't recognize. Patient = Odoo customer, order = Odoo sale line, invoice = Odoo invoice. Insurance
integration code exists and is dead (last real commit 2022). **This makes WardSynQ's own
billing/claims/invoice engine — once its reachability bugs are fixed, which this session did —
genuinely more built than Bahmni's own answer to the same problem, which is "run Odoo."**

**Appointment scheduling**: one of Bahmni's better-built modules — a real state machine with a
waitlist state, multi-provider appointments, recurrence, weekly availability, and first-class
double-booking conflict detection. Worth studying the state model specifically. OT (theatre)
scheduling is a separate, unmaintained fork (0 commits since mid-2025) — a real warning sign about
which parts of "Bahmni" are alive and which are historical.

**Permission model**: adds no new authorization concept over OpenMRS's own Privilege/Role — coarse
(screen/tab granularity, scattered across three separate mechanisms: module-declared privileges,
config-string privileges, and form-level privileges), and confirmed to have **no ward- or
location-scoped access control at all** — a nurse privileged for medication tasks is privileged for
every ward in the hospital. WardSynQ's own two-layer capability+grant model, verified working
correctly multiple times this session, is a genuine advantage here, not a gap to close.

**Integration architecture (atomfeed)**: a real, well-designed transactional-outbox pattern — the
event row is written in the SAME database transaction as the business write (via Spring AOP advice),
so there's no dual-write problem. Consumers poll and track their own read position. The pattern is
worth copying; the specific library it depends on (`ICT4H/openmrs-atomfeed`) hasn't been touched
since 2017, and Bahmni is mid-migration to a second, JMS-based event system that coexists with the
first, unfinished — a maintenance-burden warning, not just a curiosity.

**Maintenance, honestly**: genuinely alive — 25 authors on the new frontend, coordinated
cross-repo releases, fiscal sponsorship by OpenMRS Inc with named funders. But effort has visibly
shifted to the frontend rewrite; the backend domain modules implementers actually deploy
(`default-config`, `ipd`) get a fraction of that attention, and roughly 30 repos in the org haven't
been touched since 2015-2017. This is an implementer ecosystem (many hospitals running it, few
outside developers extending it) — forking any one module means owning it going forward.

**Licensing — confirmed per-repo, and it inverts the technical instinct.** `bahmni-core`,
`openmrs-module-bedmanagement`, `bahmnicommons`, and `openmrs-module-bahmni.ie.apps` — **exactly the
backend pieces you would most want to reuse headlessly — are all AGPL-3.0**, confirmed from the
actual LICENSE file in each clone (GitHub's own license-detection API reports some of these
incorrectly as unlicensed). The newer, mostly-frontend pieces (`bahmniapps`, `bahmni-apps-frontend`,
`ipd`, `appointments`, `medicationadministration`) are MPL-2.0, and `default-config` (the
config/pattern layer) is plain MIT — freely reusable. See `LICENSING_ANALYSIS.md` for what this
means for each architecture option.

## Bottom line going into the reuse decision

- The thing OpenMRS has that is genuinely hard to rebuild well and genuinely missing from WardSynQ is
  the **Concept Dictionary / terminology service**. That is the strongest, most specific candidate for
  "reuse their juice" — and it's MPL-licensed, so it's safe to call as an external service.
- Bahmni's genuinely valuable, safely-reusable asset is not code at all: it's the
  **`BahmniEncounterTransaction` composite-write pattern**, the **config-as-JSON idea** (MIT-licensed,
  free to copy outright), and the **appointment state machine**. All three are worth adopting as
  patterns inside WardSynQ's own native codebase.
- The Bahmni CODE most worth reusing (bahmnicore, bedmanagement) is exactly the code that's
  AGPL-licensed and hardest to adopt safely for a closed-source product — and even setting licensing
  aside, a verified technical read says adopting it headlessly would take 12-18 months for a small
  team before being net ahead of building natively, because you'd be reimplementing every workflow
  currently living in Angular + JSON config against a data model designed for a different runtime.
- Confirmed, not assumed: **neither OpenMRS nor Bahmni solves pharmacy inventory, billing, or RIS
  better than WardSynQ's own (post-fix) domain logic already does** — Bahmni's actual answer to all
  three is "integrate a separate external system" (Odoo, Odoo, dcm4chee respectively), which is a
  different strategy from WardSynQ having tried to solve them natively, not evidence that Bahmni
  solved them and WardSynQ hasn't.
