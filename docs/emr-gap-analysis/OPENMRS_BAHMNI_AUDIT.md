# OpenMRS + Bahmni architecture audit

Both halves of this audit are now fully verified against actual cloned source — OpenMRS: 69 tool
calls across `openmrs-core`, the REST module, FHIR2, emrapi, reporting, appointment scheduling,
dispensing, stock management, bed management, and billing modules; Bahmni: 87 tool calls, 160 repos
enumerated via the GitHub API, 14 cloned and read. Every claim below carries a file path, table
name, or class name from that reading, not a general reputation.

## OpenMRS — verified against source

**What it is.** A live, actively-released (Java/Spring/Hibernate) open-source **electronic medical
record platform**, not a full HMS — confirmed by its own schema: **117 core tables**, and not one of
them is a bill, a bed, a stock item, an appointment, a radiology study, or a lab specimen. Three
release lines are maintained in parallel (2.6/2.7/2.8, most recent tag 2.8.9) plus an active 3.0
development line on `master` already targeting Java 21 / Jakarta EE / Spring 7 / Hibernate 7 — a
real, in-progress framework migration worth timing your dependency around, not something already
finished.

**The terminology dictionary — real machinery, confirmed EMPTY of actual content.** `Concept`,
`ConceptMap`→`ConceptReferenceTerm`→`ConceptSource`, and `ConceptMapType` (SAME-AS/NARROWER-THAN/
BROADER-THAN) are a genuinely well-designed, locale-aware, multi-vocabulary mapping *mechanism* —
`ConceptSource.java`'s own doc-comment names ICD9, ICD10, SNOMED explicitly as the intended targets.
**But the core seed data contains zero `concept_reference_source` rows and only 2 concept inserts.**
OpenMRS core ships the shelving, not the books — a real ICD-10/SNOMED/LOINC dictionary is sourced
separately (CIEL or OCL, via `openmrs-module-openconceptlab`), and populating and licensing it
(SNOMED CT specifically requires a national member licence) is its own real workstream, not a
config step. **This changes the reuse recommendation below**: the specific asset worth taking isn't
"OpenMRS's terminology," it's "a terminology *service* populated with real vocabulary content" —
OpenMRS's own machinery is one way to build that, not automatically the fastest one.

**Domain model, concretely.** Patient IS-A Person by inheritance (shared id, but two separate
audit/void blocks — a known source of confusion). `PersonAttribute.value` is a raw, untyped
`String` (an EAV escape hatch Person never got migrated off, unlike newer entities' typed
`*Attribute`/`*AttributeType` + `CustomDatatype` pattern). `Encounter` **has no status field at
all** — no draft/signed/amended lifecycle, no co-signature model anywhere in core; a hospital
needing attested notes builds that layer itself (WardSynQ's own `note-cosign.js` already exists —
a real point in WardSynQ's favor here). `Visit` is a bare time-boxed container with **no status, no
disposition, no bed** — admission/discharge logic lives in the separate `emrapi` module
(`AdtService`, `InpatientAdmission`), beds in a further separate `bedmanagement` module. `Order` is
genuinely excellent: immutable and append-only (never edited, only revised via
`action=REVISE`/`previousOrder` or discontinued via a new DISCONTINUE order), state derived on read
(`Order.isActive(date)`), with real order-set/order-group nesting already in core.

**Pharmacy — your instinct partly refuted.** `MedicationDispense` **is now in core** (table
`medication_dispense`, writable over REST and FHIR R4) — the dispense *record* is a real, modern,
core-level resource. But **stock/batch/expiry/procurement is still not in core** — that's the
separate `openmrs-module-stockmanagement` (21 tables), and it has **no foreign key at the database
level** back to `medication_dispense`. So: prescribing→dispensing-the-fact is core-solved;
inventory is still exactly the separate, bolt-on problem this audit already found in both Bahmni
and WardSynQ.

**API surface — one finding that matters a lot for a CPOE product.** Neither REST nor FHIR is in
core (both are separately-versioned modules; core's own webapp has zero JSPs and one controller —
it is genuinely headless by design, the same way you'd want to consume it). The REST module exposes
~113 resources at `/ws/rest/v1/`, versioned by *source directory per platform release* rather than
by URL — the path never changes, but the shape of what it returns can, silently, across an upgrade.
Auth is HTTP Basic + session cookie only; no OAuth2/OIDC/JWT in a maintained state (the OAuth2
module is stale since 2022). **FHIR R4 cannot write orders**: `MedicationRequestFhirResourceProvider`
and `ServiceRequestFhirResourceProvider` both implement read/search only, no `@Create`/`@Update`/
`@Delete` — a CPOE integration would have to go through the legacy REST module for its single most
important write path, not FHIR. This is the sharpest, most concrete reason a "just call OpenMRS's
FHIR API" integration plan needs a second look before committing to it.

**Permission model — verb-on-type only, confirmed at scale.** 186 named privilege constants, 213
seeded privilege rows, enforced by Spring AOP (`AuthorizationAdvice`) across 704 `@Authorized`
annotations on 20 service interfaces — real, broad coverage. But confirmed **no row-level, ward-
level, or consent-scoped access control anywhere in core** — a doctor privileged to edit orders can
edit any patient's orders in the whole hospital. WardSynQ's own two-layer capability+grant model,
which scopes exactly this kind of thing down to a ward/department/patient level and was verified
working correctly multiple times this session, is a genuine, confirmed advantage over OpenMRS here,
not a gap to close by adopting OpenMRS's model.

**Licensing**: core is **MPL-2.0**, confirmed from the license header on every source file — file-
level copyleft, commercially comfortable, but with one important practical corollary the header
itself pushes toward: don't patch core files directly (each one you modify must be published and
maintained against upstream) — extend via modules and AOP advice instead, which is also just how
the platform is designed to be used.

**The realistic build/buy question, stated by the person who read the code**: "*can your team absorb
the integration surface of eight-plus independently-versioned modules, an empty concept dictionary,
and a REST contract that shifts under you on upgrade?*" If not, the honest alternative — and the one
this audit already recommends — is to take the *shape* of OpenMRS's model (immutable order
revisions, void-not-delete, concept-to-external-vocabulary mapping) as a design reference, and keep
building WardSynQ's own tighter, fully-owned schema rather than adopting the federation.

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

- What OpenMRS has that's genuinely hard to build well is the terminology-mapping *machinery*
  (Concept ↔ external vocabulary, locale-aware, MPL-licensed, safe to call externally) — but it
  ships with **zero actual ICD/SNOMED/LOINC content**. The real asset to acquire is a *populated*
  terminology service; OpenMRS's own machinery is one legitimate way to build one (adopt it and feed
  it CIEL/OCL content), not a shortcut that arrives pre-loaded. Weigh it against a dedicated,
  purpose-built FHIR terminology server, which may be a lighter integration for the same end result.
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
