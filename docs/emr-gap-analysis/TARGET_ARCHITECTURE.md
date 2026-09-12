# Target architecture decision

## The five options, scored against WardSynQ's actual constraints

**A. Continue building everything ourselves.**
Fits WardSynQ's existing architecture (Cloudflare Pages Functions, FHIR-native model, the two-layer
capability/grant permission system) perfectly, by definition — zero migration cost. Cost: the
terminology gap and a handful of others (patient relationships, deceased tracking, fuzzy search,
staff rostering, purchase/procurement) stay unsolved until someone builds them, which — per the gap
matrix — is mostly small, well-scoped, native work, not years of effort.

**B. Fork OpenMRS/Bahmni and replace the frontend.**
Rejected. WardSynQ's runtime is serverless edge (Cloudflare Workers/Pages Functions); OpenMRS/Bahmni
are JVM/Spring monoliths designed to run as a long-lived application server with a relational DB
connection pool. Forking means either running that JVM stack somewhere else (abandoning the
serverless architecture that gives WardSynQ its cost/ops profile) or attempting to port
Java/Hibernate domain logic to WardSynQ's JS runtime, which is not a fork at that point, it's a
rewrite with extra steps. AGPL licensing on Bahmni pieces (see `LICENSING_ANALYSIS.md`) makes this
commercially dangerous besides.

**C. Use OpenMRS/Bahmni as backend/domain services, WardSynQ as the new frontend.**
Rejected as a wholesale strategy, viable narrowly. Running bahmnicore or OpenMRS core as a called
service means operating a second, heavyweight JVM stack alongside WardSynQ's edge-native one —
real added infrastructure, latency (edge function calling back to a centralized JVM service defeats
some of the point of running on the edge), and for Bahmni specifically, the AGPL network-use
copyleft problem. The ONE place this is worth doing narrowly is **terminology** (OpenMRS's Concept
Dictionary, MPL-licensed, safe to call as an external service) — see option D.

**D. Extract/reimplement selected proven components while keeping WardSynQ's existing architecture.**
**This is the recommended option**, combined with narrow use of C for terminology only. Concretely:
- Keep 100% of WardSynQ's own architecture: Cloudflare Pages Functions, the FHIR-native record model,
  the two-layer capability/grant RBAC, the whole UI/UX layer (`ward.js`, `wardsynq/site/`).
- Fix the reachability problem first (see roadmap) — this alone closes a large share of the
  "10% feeling" at near-zero architectural risk, since the domain logic already exists and is
  frequently well-built.
- Call an external, MPL-licensed terminology/FHIR-terminology service (either a lightweight OpenMRS
  concept-dictionary deployment used ONLY for `$lookup`/`$validate-code`/`$expand`, or a
  purpose-built FHIR terminology server) for ICD/SNOMED/LOINC — this is the one clear "their juice"
  worth pulling in, and it fits cleanly as an HTTP call from a Cloudflare Function.
- Study (never import the code of) Bahmni's JSON-config-driven clinical form pattern and its
  OpenELIS/HL7 lab-integration message profiles as reference specs for native WardSynQ features.
- Rebuild everything else natively, scoped to what a real Indian hospital needs (P0/P1 list in the
  roadmap), matching WardSynQ's existing code style, permission model, and audit discipline rather
  than importing a foreign one.

**E. Hybrid.**
This IS option D in substance — a hybrid that's honest about where the seam is (terminology only,
via a safe license and a clean network boundary) rather than a vague "some of each."

## Recommended architecture diagram

```
                              WARDSYNQ (unchanged)
                                      |
                    ┌─────────────────┴─────────────────┐
                    |                                     |
             EXISTING FRONTEND                    EXISTING CLINICAL PLATFORM
        (ward.js, shell.js, opd.html —              (functions/_wardsynq/*,
         no rewrite; keep fixing                      wardsynq/*.js — no
         reachability, add native                     rewrite; add the P0/P1
         forms/rostering/etc.)                        native modules from the
                    |                                  roadmap)
                    |                                     |
                    |                          ┌──────────┴──────────┐
                    |                          |                     |
                    |                   NATIVE DOMAIN         ONE EXTERNAL CALL:
                    |                   LOGIC (99% of it,     TERMINOLOGY SERVICE
                    |                   stays exactly as is)  (OpenMRS concept
                    |                                          dictionary or a FHIR
                    |                                          terminology server,
                    |                                          MPL-licensed, called
                    |                                          over HTTP for
                    |                                          $lookup/$validate-code)
                    |
                    └──────────── FHIR (already native) ──────────────┘
```

No new frontend. No new backend platform. One new, narrowly-scoped external dependency
(terminology), chosen for its safe license and because it is the single largest, hardest-to-rebuild-
well gap this audit found. Everything else genuinely missing gets built the same way WardSynQ has
built everything else so far — as a native `functions/_wardsynq/*.js` module wired all the way
through to a real UI route, which is the discipline this whole audit says has been the actual
problem, not a shortage of backend sophistication.
